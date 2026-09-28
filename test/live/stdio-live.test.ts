import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defaultChatModel } from "../../src/models.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);
const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

function firstTextContent(result: {
  contents: Array<{ text?: string } | { blob?: string }>;
}): string {
  const first = result.contents[0];
  if (!first || !("text" in first) || typeof first.text !== "string") {
    throw new Error("Expected first resource content to be text.");
  }
  return first.text;
}

/**
 * Spawns the built server over stdio and returns a connected client plus its
 * teardown. Shared by both suites so the connection setup lives in one place.
 */
async function connectToBuiltServer(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MISTRAL_MCP_PROFILE: "admin",
  };
  // Only forward the key when there is one — an undefined value would be
  // stringified into the child env as "undefined" and look like a real key.
  if (process.env.MISTRAL_API_KEY) {
    env.MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  }
  const transport = new StdioClientTransport({
    command: "node",
    args: [DIST_PATH],
    env,
  });
  const client = new Client({ name: "e2e-client", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: async () => await client.close() };
}

describe.skipIf(!HAS_KEY || !DIST_EXISTS)("stdio e2e (built server) — live calls", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ client, close } = await connectToBuiltServer());
  });

  afterAll(async () => {
    await close?.();
  });

  it("reads the voices resource through stdio", async () => {
    const result = await client.readResource({ uri: "mistral://voices" });
    expect(result.contents.length).toBeGreaterThan(0);
    const parsed = JSON.parse(firstTextContent(result));
    expect(typeof parsed.fallback).toBe("boolean");
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.count).toBe("number");
  }, 60_000);

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
        model: defaultChatModel(),
        temperature: 0,
        max_tokens: 8,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { text: string; model: string };
    expect(sc.text.toLowerCase()).toContain("pong");
    expect(sc.model.length).toBeGreaterThan(0);
  }, 60_000);

  it("performs a real mistral_moderate call through the built server", async () => {
    const result = await client.callTool({
      name: "mistral_moderate",
      arguments: {
        inputs: "Bonjour, tout va bien.",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      model: string;
      results: Array<{
        categories?: Record<string, boolean>;
        category_scores?: Record<string, number>;
      }>;
    };
    expect(sc.id.length).toBeGreaterThan(0);
    // The API resolves the "-latest" alias to the dated build that actually
    // served the request (observed: mistral-moderation-2603). Asserting the
    // alias came back verbatim pinned a behaviour the API does not promise.
    expect(sc.model).toMatch(/^mistral-moderation/);
    expect(Array.isArray(sc.results)).toBe(true);
    expect(sc.results.length).toBeGreaterThan(0);
  }, 60_000);
});
