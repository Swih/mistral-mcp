// MCPB accepts names/descriptions; Smithery's separate serverCard accepts full schemas.
// Export from the binary to avoid maintaining a second handwritten tool catalog.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

if (!process.argv[2]) throw new Error("Usage: node scripts/export-bundle-catalog.mjs <bundle-directory>");
const directory = resolve(process.argv[2]);
const manifestPath = join(directory, "manifest.json");
const entry = join(directory, "dist/index.js");
if (!existsSync(entry)) throw new Error("Bundle must contain dist/index.js");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(MISTRAL_|MCP_)/.test(key)));
const client = new Client({ name: "bundle-catalog", version: "1" });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: "pipe" }));
  const tools = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources;
  const prompts = (await client.listPrompts()).prompts;
  const serverCard = { serverInfo: client.getServerVersion(), tools, resources, prompts };
  manifest.tools = tools.map(({ name, description }) => ({ name, description }));
  manifest.display_name = "Mistral MCP — Document Extraction";
  manifest.homepage = "https://github.com/Swih/mistral-mcp";
  manifest.documentation = `${manifest.homepage}#readme`;
  manifest.support = `${manifest.homepage}/issues`;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(directory, "server-card.json"), JSON.stringify(serverCard, null, 2) + "\n");
  console.log(`Exported ${tools.length} tools with ${tools.filter(t => t.outputSchema).length} output schemas. No provider calls.`);
} finally {
  await client.close();
}
