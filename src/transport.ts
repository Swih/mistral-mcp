/**
 * Transport selection — stdio (default) or Streamable HTTP.
 *
 * Both entries take a *factory*, not a server instance, because the SDK owns
 * the protocol-era decision: one factory serves 2026-07-28 clients and 2025-era
 * clients (Claude Code, Cursor, Zed and every other shipping client today) from
 * the same tool registrations.
 *   - stdio  — `serveStdio(factory, { legacy: "serve" })`: the opening exchange
 *     picks the era and pins one instance for the connection.
 *   - http   — `createMcpHandler(factory, { legacy: "stateless" })`: modern
 *     traffic gets the per-request envelope, 2025-era traffic gets the
 *     stateless fallback, on one endpoint.
 *
 * The Node adapter below is hand-written rather than taking
 * `@modelcontextprotocol/node`: that package exists to bridge web-standard
 * `Request`/`Response` into `node:http`, and pulls `@hono/node-server` to do
 * it. Node 20 has `Request`, `Response` and `Readable.toWeb` natively, so the
 * bridge is the forty lines below and the dependency budget stays at three.
 *
 * Security notes:
 *   - Binds to 127.0.0.1 by default (never 0.0.0.0 unless the operator opts in
 *     via MCP_HTTP_HOST).
 *   - Optional bearer-token auth via MCP_HTTP_TOKEN.
 *   - Optional origin allow-list via MCP_HTTP_ALLOWED_ORIGINS (comma-separated).
 *     Enforces strict equality; CORS reflection is intentionally not supported.
 *   - Exposes a `/healthz` probe that requires no auth and never touches the
 *     MCP server — useful for load balancers.
 */

import {
  createMcpHandler,
  type McpHttpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { createHash, timingSafeEqual } from "node:crypto";

export type TransportMode = "stdio" | "http";

export interface TransportOptions {
  mode: TransportMode;
  httpPort: number;
  httpHost: string;
  httpPath: string;
  httpAuthToken?: string;
  httpAllowedOrigins?: string[];
}

export interface ConnectedTransport {
  mode: TransportMode;
  /** Close the transport and any underlying HTTP server. */
  close: () => Promise<void>;
  /** For http only: the bound address (undefined for stdio). */
  address?: { host: string; port: number };
}

export function timingSafeTokenEquals(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

/**
 * Parse CLI flags + env vars into a normalized TransportOptions.
 * Pure function — no side effects, easy to unit-test.
 */
export function resolveTransportOptions(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): TransportOptions {
  const flagHttp = argv.includes("--http");
  const envHttp = env.MCP_TRANSPORT === "http";
  const mode: TransportMode = flagHttp || envHttp ? "http" : "stdio";

  const portRaw = env.MCP_HTTP_PORT ?? "3333";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(
      `[mistral-mcp] invalid MCP_HTTP_PORT=${portRaw} (expected 1-65535)`
    );
  }

  return {
    mode,
    httpPort: port,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPath: env.MCP_HTTP_PATH ?? "/mcp",
    httpAuthToken: env.MCP_HTTP_TOKEN,
    httpAllowedOrigins: env.MCP_HTTP_ALLOWED_ORIGINS
      ? env.MCP_HTTP_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
}

/** Serve the factory over the chosen transport and return a close handle. */
export async function connectTransport(
  factory: McpServerFactory,
  opts: TransportOptions
): Promise<ConnectedTransport> {
  if (opts.mode === "stdio") {
    const handle = serveStdio(factory, {
      legacy: "serve",
      onerror: (err) => console.error("[mistral-mcp:stdio]", err.message),
    });
    return { mode: "stdio", close: () => handle.close() };
  }
  return startHttpTransport(factory, opts);
}

async function startHttpTransport(
  factory: McpServerFactory,
  opts: TransportOptions
): Promise<ConnectedTransport> {
  const handler = createMcpHandler(factory, {
    legacy: "stateless",
    onerror: (err) => console.error("[mistral-mcp:http]", err.message),
  });

  const httpServer: HttpServer = createServer((req, res) => {
    handleHttpRequest(req, res, handler, opts).catch((err) => {
      console.error("[mistral-mcp:http]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal transport error");
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.httpPort, opts.httpHost, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  console.error(
    `[mistral-mcp] http listening on http://${opts.httpHost}:${opts.httpPort}${opts.httpPath}`
  );

  return {
    mode: "http",
    address: { host: opts.httpHost, port: opts.httpPort },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await handler.close();
    },
  };
}

/** node:http request to a web `Request`, so the web-standard handler can serve it. */
function toWebRequest(req: IncomingMessage, host: string): Request {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const one of value) headers.append(key, one);
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    // `duplex` is mandatory in the fetch spec whenever a stream is the body.
    ...(hasBody
      ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" }
      : {}),
  } as RequestInit & { duplex?: "half" });
}

/** A web `Response` back onto node:http, chunk by chunk so SSE streams live. */
async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  const headers: Record<string, string> = {};
  web.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(web.status, headers);
  if (!web.body) {
    res.end();
    return;
  }
  const reader = web.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: McpHttpHandler,
  opts: TransportOptions
): Promise<void> {
  const url = req.url ?? "/";

  // Health probe — no auth, no MCP.
  if (url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", transport: "http" }));
    return;
  }

  // Origin allow-list (strict equality).
  if (opts.httpAllowedOrigins && opts.httpAllowedOrigins.length > 0) {
    const origin = req.headers.origin;
    if (origin && !opts.httpAllowedOrigins.includes(origin)) {
      res.statusCode = 403;
      res.setHeader("content-type", "text/plain");
      res.end("Forbidden origin");
      return;
    }
  }

  // Bearer auth if configured.
  if (opts.httpAuthToken) {
    const header = req.headers.authorization ?? "";
    const got = header.replace(/^Bearer\s+/i, "").trim();
    if (!timingSafeTokenEquals(got, opts.httpAuthToken)) {
      res.statusCode = 401;
      res.setHeader("content-type", "text/plain");
      res.setHeader("www-authenticate", "Bearer");
      res.end("Unauthorized");
      return;
    }
  }

  // Route MCP requests.
  if (url === opts.httpPath || url.startsWith(`${opts.httpPath}?`)) {
    const web = await handler.fetch(toWebRequest(req, opts.httpHost));
    await writeWebResponse(res, web);
    return;
  }

  res.statusCode = 404;
  res.setHeader("content-type", "text/plain");
  res.end("Not found");
}
