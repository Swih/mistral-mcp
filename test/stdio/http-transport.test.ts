/**
 * End-to-end coverage of the Streamable HTTP transport.
 *
 * v0.10.0 replaced the v1 `StreamableHTTPServerTransport` with
 * `createMcpHandler` plus a hand-written `node:http` <-> web-standard adapter
 * (see the header of src/transport.ts for why the adapter is not a
 * dependency). Hand-written request/response bridging is exactly the code that
 * must not be trusted to a type-check, so this drives the built binary over a
 * real socket: health probe, bearer auth, and both protocol eras.
 *
 * No API key and no egress — only tools/list, which never reaches Mistral.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyHttp } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client as ModernClient, StreamableHTTPClientTransport as ModernHttp } from "@modelcontextprotocol/client";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";

const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);
const TOKEN = "test-token-not-a-secret";

/** Ask the OS for a port, then hand it to the child. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => res(port));
    });
  });
}

async function waitForHealth(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited: ${child.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`no /healthz at ${url} within 20s`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!DIST_EXISTS)("streamable http transport", () => {
  let child: ChildProcess;
  let port: number;
  let base: string;

  beforeAll(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const env = { ...(process.env as Record<string, string>) };
    delete env.MISTRAL_BASE_URL;
    delete env.MISTRAL_MCP_PROFILE;

    child = spawn("node", [DIST_PATH], {
      env: {
        ...env,
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: String(port),
        MCP_HTTP_TOKEN: TOKEN,
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForHealth(`${base}/healthz`, child);
  }, 40_000);

  afterAll(() => {
    child?.kill();
  });

  it("answers /healthz without auth", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", transport: "http" });
  });

  it("rejects an unauthenticated MCP request", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects a wrong bearer token", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("404s an unknown path", async () => {
    const res = await fetch(`${base}/nope`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("serves a 2025-era client over HTTP", async () => {
    const client = new LegacyClient({ name: "legacy-http", version: "0.0.0" });
    await client.connect(
      new LegacyHttp(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      })
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("mistral_chat");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("serves a 2026-07-28 client over the same endpoint", async () => {
    const client = new ModernClient(
      { name: "modern-http", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(
      new ModernHttp(new URL(`${base}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
      })
    );
    try {
      const discovered = await client.discover();
      expect(discovered.supportedVersions).toContain("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("mistral_chat");
    } finally {
      await client.close();
    }
  }, 30_000);
});
