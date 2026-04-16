/**
 * Smoke test — spawns mistral-mcp over stdio, performs the MCP handshake,
 * lists tools, and invokes `mistral_chat` with a short French greeting.
 *
 * Run from the repo root (the script loads `.env` from `process.cwd()`):
 *   node examples/try-it.mjs           # uses the published npm package via npx
 *   node examples/try-it.mjs --local   # uses the local build in ./dist
 *
 * Requires MISTRAL_API_KEY in your shell env or in a `.env` file at the repo root.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config as loadEnv } from "dotenv";

loadEnv();
if (!process.env.MISTRAL_API_KEY) {
  console.error("MISTRAL_API_KEY not set. Export it or drop it in .env.");
  process.exit(1);
}

const useLocal = process.argv.includes("--local");
const transport = new StdioClientTransport({
  command: useLocal ? "node" : "npx",
  args: useLocal ? ["dist/index.js"] : ["-y", "mistral-mcp"],
  env: { ...process.env, MISTRAL_API_KEY: process.env.MISTRAL_API_KEY },
});

const client = new Client({ name: "try-it", version: "0.0.0" });
await client.connect(transport);
console.log("✓ MCP handshake OK");

const { tools } = await client.listTools();
console.log("✓ Tools exposed:", tools.map((t) => t.name).join(", "));

console.log("\n→ calling mistral_chat with: 'cc le chat'");
const result = await client.callTool({
  name: "mistral_chat",
  arguments: {
    messages: [{ role: "user", content: "cc le chat" }],
    model: "mistral-small-latest",
    max_tokens: 100,
  },
});

const sc = result.structuredContent;
console.log("\n=== Mistral a répondu ===");
console.log(sc.text);
console.log("\n=== Meta ===");
console.log("  model         :", sc.model);
console.log("  finish_reason :", sc.finish_reason);
console.log("  tokens        :", JSON.stringify(sc.usage));

await client.close();
