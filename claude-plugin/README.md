# mistral-mcp — Claude Code plugin

Extract typed JSON from text or Markdown documents in Claude Code, with optional
Mistral OCR for PDFs and images. The plugin runs `mistral-mcp@1.0.0` from npm and
adds 11 skills for document, audio, code and workflow tasks.

**Upgrading from 0.11.0:** the default now exposes six tools, including
`process_document`. Workflow skills require `MISTRAL_MCP_PROFILE=workflows` or
`admin`; `metier-docs` preserves the previous broader default. Document results
require `extraction_source` and accept `null` for OCR metadata. See the
[migration guide](../MIGRATION.md), then restart the MCP server after changing profiles.

## What you get

- **Auto-installed MCP server** (`mistral`) exposing the core profile by default, with additional tools available through profiles (chat, OCR, vision, Voxtral audio, Codestral, agents, moderation, files, batch, workflows). See the [main README](../README.md) for the full surface.
- **11 skills** that use the underlying tools and prompts:

| Skill | What it does |
|---|---|
| `/mistral-mcp:french-meeting-minutes` | Audio file or text → structured French meeting minutes (auto-transcribes with Voxtral if input is audio) |
| `/mistral-mcp:french-invoice-reminder` | Generates a French B2B dunning letter with controlled tone (polite / firm / final) |
| `/mistral-mcp:french-commit-message` | Pulls `git diff --staged`, picks the Conventional Commits scope, generates a French commit message via Codestral |
| `/mistral-mcp:codestral-review` | Auto-fetches the diff and runs a focused code review (correctness / perf / security / api_design) |
| `/mistral-mcp:mistral-router` | Picks the right Mistral model + tool for a given task (decision-tree skill) |

Additional skills: `pdf-invoice-extractor`, `contract-analyzer`, `audio-dispatch`,
`contract-review-workflow`, `compliance-audit-workflow`, and `research-pipeline-workflow`.
The final three require an orchestration profile and deployed Mistral workflows;
installing the plugin does not create those deployments.

## Install

### From the swih-plugins marketplace (recommended)

```text
/plugin marketplace add Swih/mistral-mcp
/plugin install mistral-mcp@swih-plugins
```

Requires Node.js 20+ and npm. Configure your **Mistral API key** in the client's
supported secret configuration. Get a key at [Mistral Console](https://console.mistral.ai/)
and check your [account limits](https://console.mistral.ai/limits): model access
and free quota depend on the account.

### Local development

Load the plugin files from the release tag:

```bash
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp
git checkout v1.0.0
claude --plugin-dir ./claude-plugin
```

The local plugin still starts the pinned npm server. To run the source invoice
example, use the [checkout and build instructions](../examples/README.md);
the example scripts are not included in the npm package.

## How it works

The plugin's `.mcp.json` declares one MCP server:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "npx",
      "args": ["-y", "mistral-mcp@1.0.0"],
      "env": {
        "MISTRAL_API_KEY": "${user_config.mistral_api_key}"
      }
    }
  }
}
```

When the plugin is enabled, Claude Code spawns `npx -y mistral-mcp@1.0.0` and connects to it over stdio. The skill files in `skills/` are loaded as namespaced commands (`/mistral-mcp:*`).

The recorded text extraction check covers one synthetic invoice with
`ministral-3b-latest`, not general accuracy. Live OCR validation was blocked by
HTTP 429 / zero OCR quota on the test account. See the [main README](../README.md)
for the measured fields and document behavior.

## Versioning

This plugin tracks the [`mistral-mcp`](https://www.npmjs.com/package/mistral-mcp) npm package version. Plugin `1.0.0` pins `mistral-mcp@1.0.0`. The plugin manifest, marketplace entry and `.mcp.json` are updated together.

## Security

- Keep your API key in the client's supported secret configuration. Do not commit it to this repository.
- The plugin runs `npx` with `-y` to auto-install `mistral-mcp@1.0.0` from npm. The version is pinned exactly to avoid unintended upgrades.

## Links

- [npm package](https://www.npmjs.com/package/mistral-mcp)
- [Source and releases](https://github.com/Swih/mistral-mcp)
- Official MCP Registry: `io.github.Swih/mistral-mcp`
- [Mistral documentation](https://docs.mistral.ai/)

## License

MIT — Copyright Dayan Decamp
