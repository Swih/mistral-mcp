/**
 * Self-review — spawns mistral-mcp, feeds the project's README to Mistral Large,
 * and asks for a critical engineering review with numeric scoring.
 *
 * A fun loop: the server reviews itself through the same protocol it implements.
 * Useful for catching stale documentation: if Mistral misreads a roadmap item,
 * a recruiter reading quickly will too.
 *
 * Run from the repo root:
 *   node examples/rate-it.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv();
if (!process.env.MISTRAL_API_KEY) {
  console.error("MISTRAL_API_KEY not set. Export it or drop it in .env.");
  process.exit(1);
}

const readme = readFileSync("README.md", "utf8");

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "mistral-mcp"],
  env: { ...process.env, MISTRAL_API_KEY: process.env.MISTRAL_API_KEY },
});
const client = new Client({ name: "rate-it", version: "0.0.0" });
await client.connect(transport);
console.log("✓ Connected to mistral-mcp\n");

const result = await client.callTool({
  name: "mistral_chat",
  arguments: {
    messages: [
      {
        role: "system",
        content:
          "You are a senior engineer reviewing open-source repos. Be direct, " +
          "non-sycophantic. Score /10 on four axes: (1) MCP spec compliance, " +
          "(2) code & test quality, (3) documentation, (4) distribution/DX. " +
          "Then give an overall score and 2 concrete improvement axes. " +
          "Max 300 words. Answer in French.",
      },
      {
        role: "user",
        content:
          "Review this repo based only on the README below. " +
          "The repo is published on npm (mistral-mcp@0.3.0) and on GitHub " +
          "(github.com/Swih/mistral-mcp).\n\n=== README.md ===\n" + readme,
      },
    ],
    model: "mistral-large-latest",
    temperature: 0.3,
    max_tokens: 700,
  },
});

const sc = result.structuredContent;
console.log("=== Mistral Large review ===\n");
console.log(sc.text);
console.log("\n---");
console.log("Tokens:", JSON.stringify(sc.usage));
console.log("Model :", sc.model);

await client.close();
