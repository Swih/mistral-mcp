import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
assert.equal(process.argv.length, 3, "Usage: npm run build:bundles -- <new-output-directory>");
const output = resolve(process.argv[2]);
assert(!existsSync(output), `Output already exists: ${output}`);
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
assert(existsSync(npmCli), "Cannot locate npm CLI; run via npm run build:bundles");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const pkg = json(join(root, "package.json"));
const lock = json(join(root, "package-lock.json"));
assert.equal(lock.packages[""].version, pkg.version, "Package lock version drift");
assert(/^[a-z0-9-]+$/.test(pkg.name), "Unsafe artifact name");
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), "Invalid release version");
const stem = `${pkg.name}-${pkg.version}`;
const expectedTools = ["codestral_fim", "mistral_chat", "mistral_ocr", "mistral_vision", "process_document", "voxtral_transcribe"].sort();
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(MISTRAL_|MCP_|NODE_OPTIONS$)/i.test(key)));
const run = (command, args, cwd, capture = false, extraEnv = {}) => execFileSync(command, args, {
  cwd, env: { ...env, ...extraEnv }, timeout: 180_000,
  encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"], windowsHide: true,
});
const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);
const tempRoot = realpathSync(tmpdir());
const scratch = mkdtempSync(join(tempRoot, "mistral-bundles-"));
const bundle = join(scratch, "bundle");
const plugin = join(scratch, "claude-plugin");
const artifacts = join(scratch, "artifacts");
const timestamp = new Date("2000-01-01T00:00:00Z");

function copyAllowed(source, destination, allow) {
  const stat = lstatSync(source);
  assert(!stat.isSymbolicLink(), `Refusing symlink: ${source}`);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source).sort()) {
      assert(!/^(?:\.env(?:\..*)?|AGENTS\.md|node_modules|src|\.git)$/i.test(name), `Forbidden release input: ${name}`);
      copyAllowed(join(source, name), join(destination, name), allow);
    }
  } else {
    assert(stat.isFile() && allow(source), `Unexpected release input: ${source}`);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    utimesSync(destination, timestamp, timestamp);
  }
}

function assertCatalog(directory) {
  const card = json(join(directory, "server-card.json"));
  const manifest = json(join(directory, "manifest.json"));
  assert.equal(card.serverInfo.version, pkg.version, "Built dist version differs from package.json; run npm run build");
  assert.deepEqual(card.tools.map(t => t.name).sort(), expectedTools);
  assert(card.tools.every(t => t.outputSchema?.type === "object" && t.annotations
    && typeof t.annotations.title === "string"
    && ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].every(k => typeof t.annotations[k] === "boolean")), "Missing output schemas or annotations");
  assert.deepEqual(manifest.tools, card.tools.map(({ name, description }) => ({ name, description })));
  assert(card.resources.length > 0 && card.prompts.length > 0, "Missing resource/prompt catalogs");
}

try {
  mkdirSync(bundle);
  mkdirSync(artifacts);
  copyAllowed(join(root, "dist"), join(bundle, "dist"), path => /\.(?:js|js\.map|d\.ts)$/.test(path));
  for (const name of ["package.json", "package-lock.json", "README.md", "README.fr.md", "MIGRATION.md", "LICENSE", "SECURITY.md", "assets/icon.svg"]) {
    copyAllowed(join(root, name), join(bundle, name), () => true);
  }
  const pluginManifest = json(join(root, "claude-plugin/.claude-plugin/plugin.json"));
  assert.equal(pluginManifest.version, pkg.version, "Claude plugin version drift");
  const pluginConfig = json(join(root, "claude-plugin/.mcp.json"));
  assert(pluginConfig.mcpServers.mistral.args.includes(`${pkg.name}@${pkg.version}`), "Claude plugin must pin the release version");
  for (const name of [".claude-plugin/plugin.json", ".mcp.json", "README.md", "skills"]) {
    copyAllowed(join(root, "claude-plugin", name), join(plugin, name), path => /\.(?:json|md)$/.test(path));
  }
  npm(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], bundle);
  // The official validator requires PNG; conversion tooling stays outside the bundle.
  npm(["exec", "--yes", "--package=sharp-cli@6.1.0", "--", "sharp", "-i", join(bundle, "assets/icon.svg"), "-o", join(bundle, "assets/icon.png")], scratch);
  const manifest = {
    manifest_version: "0.3", name: pkg.name, version: pkg.version, description: pkg.description,
    display_name: "Mistral MCP — Document Extraction",
    author: typeof pkg.author === "string" ? { name: pkg.author } : pkg.author,
    homepage: "https://github.com/Swih/mistral-mcp", documentation: "https://github.com/Swih/mistral-mcp#readme",
    support: pkg.bugs.url, license: pkg.license, icon: "assets/icon.png",
    server: { type: "node", entry_point: "dist/index.js", mcp_config: {
      command: "node", args: ["${__dirname}/dist/index.js"], env: {
        MISTRAL_API_KEY: "${user_config.mistral_api_key}",
        MISTRAL_DEFAULT_MODEL: "${user_config.default_model}",
        MISTRAL_MCP_PROFILE: "${user_config.profile}",
      },
    } },
    compatibility: { runtimes: { node: ">=20" } },
    user_config: {
      mistral_api_key: { type: "string", title: "Mistral API key", description: "Your API key from https://console.mistral.ai/.", required: true, sensitive: true },
      default_model: { type: "string", title: "Default model", description: "Optional chat model override. Leave empty to use the server default.", required: false, default: "" },
      // MCPB 0.3 rejects enum; the server validates these profile names.
      profile: { type: "string", title: "Tool profile", description: "Allowed values: core, admin, workflows, metier-docs, self-hosted. Core exposes six everyday tools.", required: false, default: "core" },
    },
  };
  writeFileSync(join(bundle, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(bundle, ".mcpbignore"), "!/package-lock.json\n");
  const entry = join(bundle, "dist/index.js");
  const doctor = extra => JSON.parse(run(process.execPath, [entry, "--doctor"], bundle, true, extra));
  const report = doctor({ MISTRAL_DEFAULT_MODEL: "", MISTRAL_MCP_PROFILE: "core" });
  assert.equal(report.api_key_configured, false);
  assert.equal(report.api_access, "not_probed");
  assert.equal(report.profile, "core");
  assert.deepEqual(report.exposed_tools.slice().sort(), expectedTools);
  assert(report.default_chat_model.length > 0);
  assert.equal(report.default_chat_model, doctor({}).default_chat_model, "Empty model override must preserve the default");
  run(process.execPath, [join(root, "scripts/export-bundle-catalog.mjs"), bundle], bundle);
  assertCatalog(bundle);
  const mcpb = (...args) => npm(["exec", "--yes", "--package=@anthropic-ai/mcpb@2.1.2", "--", "mcpb", ...args], scratch);
  mcpb("validate", join(bundle, "manifest.json"));
  mcpb("pack", bundle, join(artifacts, `${stem}.mcpb`));
  const zipPath = join(artifacts, `${stem}-claude-plugin.zip`);
  if (process.platform === "win32") {
    // ZipFile includes dotfiles; paths travel as environment values, never shell code.
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $archive = [System.IO.Compression.ZipFile]::Open($env:BUNDLE_PLUGIN_ZIP, 'Create')
      try {
        Get-ChildItem -LiteralPath $env:BUNDLE_PLUGIN_SOURCE -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
          $entry = $_.FullName.Substring($env:BUNDLE_PLUGIN_SOURCE.Length + 1).Replace('\\', '/')
          [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry)
        }
      } finally { $archive.Dispose() }
    `], scratch, false, {
      BUNDLE_PLUGIN_SOURCE: plugin, BUNDLE_PLUGIN_ZIP: zipPath,
    });
  } else {
    run("zip", ["-q", "-r", "-X", zipPath, "."], plugin);
  }
  for (const name of ["manifest.json", "server-card.json"]) {
    copyFileSync(join(bundle, name), join(artifacts, `${stem}-${name}`), constants.COPYFILE_EXCL);
  }
  const files = readdirSync(artifacts).sort();
  writeFileSync(join(artifacts, "SHA256SUMS"), files.map(name => `${createHash("sha256").update(readFileSync(join(artifacts, name))).digest("hex")}  ${name}`).join("\n") + "\n");
  // mkdir without recursive/exist-ok reserves a fresh destination, including races.
  mkdirSync(output);
  for (const name of readdirSync(artifacts).sort()) {
    copyFileSync(join(artifacts, name), join(output, name), constants.COPYFILE_EXCL);
  }
  console.log(`Verified ${pkg.name}@${pkg.version}: packaged doctor, six core tools, output schemas, and official MCPB validation.\nArtifacts: ${output}`);
} finally {
  assert.equal(dirname(realpathSync(scratch)), tempRoot, "Refusing cleanup outside the temporary directory");
  assert(scratch.startsWith(join(tempRoot, "mistral-bundles-")), "Unexpected temporary directory");
  rmSync(scratch, { recursive: true, force: true });
}
