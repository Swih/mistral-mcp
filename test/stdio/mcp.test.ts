/**
 * End-to-end test — spawns the built server as a child process over stdio
 * and verifies the full MCP protocol handshake with the official Client.
 *
 * This catches wiring bugs that InMemoryTransport can't:
 *   - missing shebang / broken bin
 *   - env var propagation
 *   - transport wire format
 *
 * Skipped if MISTRAL_API_KEY is not set (the server refuses to boot without it).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);
const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

describe.skipIf(!HAS_KEY || !DIST_EXISTS)("stdio e2e (built server)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: [DIST_PATH],
      env: {
        ...(process.env as Record<string, string>),
        MISTRAL_API_KEY: process.env.MISTRAL_API_KEY!,
      },
    });
    client = new Client({ name: "e2e-client", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("handshakes and lists the expected tools, resources, prompts", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "codestral_fim",
      "mistral_chat",
      "mistral_chat_stream",
      "mistral_embed",
      "mistral_ocr",
      "mistral_tool_call",
      "mistral_vision",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
    }

    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "mistral://models")).toBe(true);

    const { prompts } = await client.listPrompts();
    const promptNames = prompts.map((p) => p.name).sort();
    expect(promptNames).toEqual(["codestral_review", "french_invoice_reminder"]);
  });

  it("performs a real mistral_chat call through the built server", async () => {
    const result = await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [
          {
            role: "user",
            content:
              'Reply with exactly the single word: "pong". No punctuation.',
          },
        ],
        model: "mistral-small-latest",
        temperature: 0,
        max_tokens: 8,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { text: string; model: string };
    expect(sc.text.toLowerCase()).toContain("pong");
    expect(sc.model).toBe("mistral-small-latest");
  }, 30_000);
});
