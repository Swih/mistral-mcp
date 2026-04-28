/**
 * Transport selection — stdio (default) or Streamable HTTP.
 *
 * MCP spec 2025-03-26 / 2025-11-25 defines Streamable HTTP as the canonical
 * remote transport: a single endpoint that accepts POST for client→server
 * messages and GET + SSE for the server→client stream.
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

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type TransportMode = "stdio" | "http";

export interface TransportOptions {
  mode: TransportMode;
  httpPort: number;
  httpHost: string;
  httpPath: string;
  httpAuthToken?: string;
  httpAllowedOrigins?: string[];
  statelessHttp: boolean;
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
    statelessHttp: env.MCP_HTTP_STATELESS === "1",
  };
}

/** Connect the server to the chosen transport and return a close handle. */
export async function connectTransport(
  server: McpServer,
  opts: TransportOptions
): Promise<ConnectedTransport> {
  if (opts.mode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return {
      mode: "stdio",
      close: async () => {
        await transport.close();
      },
    };
  }
  return startHttpTransport(server, opts);
}

async function startHttpTransport(
  server: McpServer,
  opts: TransportOptions
): Promise<ConnectedTransport> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: opts.statelessHttp ? undefined : () => randomUUID(),
  });
  await server.connect(transport);

  const httpServer: HttpServer = createServer((req, res) =>
    handleHttpRequest(req, res, transport, opts)
  );

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
      await transport.close();
    },
  };
}

function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  transport: StreamableHTTPServerTransport,
  opts: TransportOptions
): void {
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
    transport.handleRequest(req, res).catch((err) => {
      console.error("[mistral-mcp:http]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal transport error");
      }
    });
    return;
  }

  res.statusCode = 404;
  res.setHeader("content-type", "text/plain");
  res.end("Not found");
}
