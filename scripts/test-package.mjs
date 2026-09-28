import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
const plugin = JSON.parse(readFileSync(join(root, "claude-plugin/.claude-plugin/plugin.json"), "utf8"));
const marketplace = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
const pluginServer = JSON.parse(readFileSync(join(root, "claude-plugin/.mcp.json"), "utf8")).mcpServers.mistral;
assert.equal(registry.version, pkg.version, "Registry version drift");
assert.equal(registry.packages[0].version, pkg.version, "Registry package version drift");
assert(registry.description.length <= 100, "MCP Registry description exceeds 100 characters");
assert.equal(plugin.version, pkg.version, "Plugin version drift");
assert.equal(marketplace.plugins[0].version, pkg.version, "Marketplace version drift");
assert(pluginServer.args.includes(`${pkg.name}@${pkg.version}`), "Plugin must pin the tested version");
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run via npm run test:package");
const scratch = mkdtempSync(join(tmpdir(), "mistral-mcp-package-"));
const npm = (args, cwd = root) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, npm_config_update_notifier: "false" },
});
let http;
try {
  const packResult = JSON.parse(npm(["pack", "--ignore-scripts", "--json", "--pack-destination", scratch]));
  // npm versions expose either an array or a package-name keyed object.
  const packed = Array.isArray(packResult) ? packResult[0] : packResult[pkg.name];
  assert(packed?.filename && Array.isArray(packed.files), "Unexpected npm pack JSON");
  for (const required of ["dist/index.js", "README.md", "README.fr.md", "MIGRATION.md", "SECURITY.md", "LICENSE"]) {
    assert(packed.files.some(file => file.path === required), `Missing packaged file: ${required}`);
  }
  for (const file of packed.files) {
    assert(/^(dist\/|README(?:\.fr)?\.md$|LICENSE$|MIGRATION\.md$|SECURITY\.md$|package\.json$)/.test(file.path), `Unexpected packaged file: ${file.path}`);
  }
  npm(["install", "--prefix", scratch, "--ignore-scripts", "--no-audit", "--no-fund", join(scratch, packed.filename)], scratch);
  const entry = join(scratch, "node_modules", "mistral-mcp", "dist", "index.js");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !/^(MISTRAL_|MCP_)/.test(k)));
  // A fresh installation can start slowly on Windows while files are scanned.
  const report = JSON.parse(execFileSync(process.execPath, [entry, "--doctor"], { env, encoding: "utf8", timeout: 60_000 }));
  assert.equal(report.api_key_configured, false);
  assert.equal(report.api_access, "not_probed");
  const client = new Client({ name: "package-smoke", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry],
      env: { ...env, MISTRAL_API_KEY: "package-test-not-a-real-key", MISTRAL_MCP_PROFILE: "admin" }, stderr: "pipe" }));
    assert.equal(client.getServerVersion()?.version, pkg.version);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 46);
    assert(tools.some(t => t.name === "process_document"));
    assert(tools.some(t => t.name === "agents_list"));
    assert(tools.every(t => t.outputSchema && t.annotations));
    assert((await client.listResources()).resources.length > 0);
    assert((await client.listPrompts()).prompts.length > 0);
  } finally { await client.close(); }
  let calls = 0;
  http = createServer((req, res) => {
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") { res.writeHead(404).end(); return; }
    req.resume();
    req.on("end", () => {
      calls++;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        id: "smoke", object: "chat.completion", created: 1, model: "local-smoke",
        choices: [{ index: 0, message: { role: "assistant", content: "package works" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }));
    });
  });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
  const localClient = new Client({ name: "package-call", version: "1" });
  try {
    await localClient.connect(new StdioClientTransport({ command: process.execPath, args: [entry],
      env: { ...env, MISTRAL_BASE_URL: `http://127.0.0.1:${http.address().port}`, MISTRAL_DEFAULT_MODEL: "local-smoke" }, stderr: "pipe" }));
    const result = await localClient.callTool({ name: "mistral_chat", arguments: { messages: [{ role: "user", content: "hello" }] } });
    assert(!result.isError, JSON.stringify(result.content));
    assert.equal(result.structuredContent.text, "package works");
    assert.equal(calls, 1);
  } finally { await localClient.close(); }
  console.log(`Verified installed ${pkg.name}@${pkg.version}: file allow-list, doctor, MCP catalogs, and local inference. No Mistral API calls.`);
} finally {
  if (http) await new Promise(resolve => http.close(resolve));
  assert.equal(dirname(scratch), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true });
}
