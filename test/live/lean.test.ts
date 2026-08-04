import { describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerLeanTools } from "../../src/tools-lean.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

async function boot() {
  const { Mistral } = await import("@mistralai/mistralai");
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: {
      strategy: "backoff",
      backoff: {
        initialInterval: 500,
        maxInterval: 5000,
        exponent: 2,
        maxElapsedTime: 30000,
      },
      retryConnectionErrors: true,
    },
    timeoutMs: 60_000,
  });
  const server = new McpServer({ name: "lean-live-test", version: "0.0.0" });
  registerLeanTools(server, mistral);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe.skipIf(!HAS_KEY)("live Leanstral API", () => {
  it("prove_with_leanstral returns a Lean 4 proof proposal", async () => {
    const client = await boot();
    const result = await client.callTool({
      name: "prove_with_leanstral",
      arguments: {
        theorem: "theorem leanstral_smoke (n : Nat) : n = n := by",
        requirements: "Return the shortest proof.",
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { text: string; model: string };
    expect(structured.model).toBe("labs-leanstral-1-5");
    expect(structured.text.length).toBeGreaterThan(0);
    expect(structured.text).toMatch(/rfl|exact|simp/);
    await client.close();
  }, 90_000);

  it("review_lean_proof returns concrete review text", async () => {
    const client = await boot();
    const result = await client.callTool({
      name: "review_lean_proof",
      arguments: {
        source: "theorem leanstral_review (n : Nat) : n = n := by\n  rfl",
        objective: "Check this proof and keep the response concise.",
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { text: string; model: string };
    expect(structured.model).toBe("labs-leanstral-1-5");
    expect(structured.text.length).toBeGreaterThan(0);
    await client.close();
  }, 90_000);
});
