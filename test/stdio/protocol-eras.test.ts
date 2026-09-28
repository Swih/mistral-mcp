/**
 * The compatibility contract of the v2 migration, pinned as a test.
 *
 * v0.10.0 moved the server onto `@modelcontextprotocol/server@2` and MCP
 * 2026-07-28. Practically every client shipping today (Claude Code, Cursor,
 * Zed, Windsurf, Claude Desktop) still opens with the 2025 handshake, so the
 * migration is only safe if BOTH eras are served from the same registrations.
 *
 * So this file drives the built binary twice:
 *   1. with the v1 SDK client (1.30.x) — literally the code those clients ship;
 *   2. with the v2 client pinned to 2026-07-28 — `server/discover` and the
 *      per-request envelope.
 *
 * Both must see the same tools. `@modelcontextprotocol/sdk` is a devDependency
 * for exactly this reason: the old client is the contract being tested.
 *
 * No API key and no network — discovery and generic text processing never
 * reach Mistral. The tool call also exercises nullable output fields in both eras.
 */

import { describe, expect, it } from "vitest";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as LegacyStdio } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client as ModernClient } from "@modelcontextprotocol/client";
import { StdioClientTransport as ModernStdio } from "@modelcontextprotocol/client/stdio";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

/** A key in the developer's shell must not change what is exercised. */
function cleanEnv(): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) };
  delete env.MISTRAL_BASE_URL;
  delete env.MISTRAL_MCP_PROFILE;
  delete env.MISTRAL_API_KEY;
  return env;
}

describe.skipIf(!DIST_EXISTS)("protocol eras served from one registration", () => {
  it("serves a 2025-era client (the SDK every shipping client uses today)", async () => {
    const client = new LegacyClient({ name: "legacy-era-probe", version: "0.0.0" });
    await client.connect(
      new LegacyStdio({ command: "node", args: [DIST_PATH], env: cleanEnv() })
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain("mistral_chat");
      expect(tools.map((t) => t.name)).toContain("process_document");
      expect(tools).toHaveLength(6);

      // The 2025-era surface must keep everything it had: a tool without
      // annotations or an outputSchema is a regression for those clients.
      for (const tool of tools) {
        expect(tool.outputSchema, `${tool.name} lost its outputSchema`).toBeTruthy();
        expect(
          typeof tool.annotations?.readOnlyHint,
          `${tool.name} lost its annotations`
        ).toBe("boolean");
      }

      const { resources } = await client.listResources();
      expect(resources.map((r) => r.uri)).toContain("mistral://capabilities");
      const result = await client.callTool({ name: "process_document", arguments: {
        source: { type: "text", text: "# Legacy text\n\nPreserve this.\n" }, kind: "generic", options: { cache: "bypass" },
      } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        extraction_source: "provided_text", ocr_confidence: null, page_count: null,
        structured_text: "# Legacy text\n\nPreserve this.\n",
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("serves a 2026-07-28 client and answers server/discover", async () => {
    const client = new ModernClient(
      { name: "modern-era-probe", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(
      new ModernStdio({ command: "node", args: [DIST_PATH], env: cleanEnv() })
    );
    try {
      const discovered = await client.discover();
      expect(discovered.supportedVersions).toContain("2026-07-28");
      expect(discovered.capabilities.tools).toBeTruthy();

      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("mistral_chat");
      const result = await client.callTool({ name: "process_document", arguments: {
        source: { type: "text", text: "# Modern text\n\nPreserve this.\n" }, kind: "generic", options: { cache: "bypass" },
      } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        extraction_source: "provided_text", ocr_confidence: null, page_count: null,
        structured_text: "# Modern text\n\nPreserve this.\n",
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it("emits the configured cache hints on the modern era", async () => {
    const client = new ModernClient(
      { name: "cache-hint-probe", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(
      new ModernStdio({ command: "node", args: [DIST_PATH], env: cleanEnv() })
    );
    try {
      // The catalogue is fixed at boot, so it is cacheable and shareable.
      const discovered = await client.discover();
      expect(discovered.ttlMs).toBe(300_000);
      expect(discovered.cacheScope).toBe("public");

      const tools = await client.listTools();
      expect(tools.ttlMs).toBe(300_000);
      expect(tools.cacheScope).toBe("public");

      // A per-resource hint must beat the conservative resources/read default.
      const read = await client.readResource({ uri: "mistral://capabilities" });
      expect(read.ttlMs).toBe(300_000);
      expect(read.cacheScope).toBe("public");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("exposes the identical tool set to both eras", async () => {
    const legacy = new LegacyClient({ name: "legacy-parity", version: "0.0.0" });
    const modern = new ModernClient(
      { name: "modern-parity", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await legacy.connect(
      new LegacyStdio({ command: "node", args: [DIST_PATH], env: cleanEnv() })
    );
    await modern.connect(
      new ModernStdio({ command: "node", args: [DIST_PATH], env: cleanEnv() })
    );
    try {
      const legacyNames = (await legacy.listTools()).tools.map((t) => t.name).sort();
      const modernNames = (await modern.listTools()).tools.map((t) => t.name).sort();
      expect(modernNames).toEqual(legacyNames);
    } finally {
      await legacy.close();
      await modern.close();
    }
  }, 30_000);
});
