# mistral-mcp — Claude Code plugin

Mistral AI capabilities for Claude Code, packaged as a one-click plugin. Auto-installs the [`mistral-mcp`](https://www.npmjs.com/package/mistral-mcp) server from npm and adds five curated skills for the most common Mistral workflows.

## What you get

- **Auto-installed MCP server** (`mistral`) exposing 25 Mistral tools, 3 resources, and 6 prompts (chat, OCR, vision, Voxtral audio, Codestral, agents, moderation, files, batch, workflows). See the [main README](../README.md) for the full surface.
- **Five curated skills** that orchestrate the underlying tools/prompts with smart defaults:

| Skill | What it does |
|---|---|
| `/mistral-mcp:french-meeting-minutes` | Audio file or text → structured French meeting minutes (auto-transcribes with Voxtral if input is audio) |
| `/mistral-mcp:french-invoice-reminder` | Generates a French B2B dunning letter with controlled tone (polite / firm / final) |
| `/mistral-mcp:french-commit-message` | Pulls `git diff --staged`, picks the Conventional Commits scope, generates a French commit message via Codestral |
| `/mistral-mcp:codestral-review` | Auto-fetches the diff and runs a focused code review (correctness / perf / security / api_design) |
| `/mistral-mcp:mistral-router` | Picks the right Mistral model + tool for a given task (decision-tree skill) |

## Install

### From the swih-plugins marketplace (recommended)

```text
/plugin marketplace add Swih/mistral-mcp
/plugin install mistral-mcp@swih-plugins
```

Claude Code will prompt for your **Mistral API key** (stored in the system keychain). Get a key at <https://console.mistral.ai/>.

### Local development

Clone the repo and load the plugin directly:

```bash
git clone https://github.com/Swih/mistral-mcp.git
claude --plugin-dir ./mistral-mcp/claude-plugin
```

Then, inside Claude Code, configure the API key when prompted, or set `MISTRAL_API_KEY` in your environment.

## How it works

The plugin's `.mcp.json` declares one MCP server:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "npx",
      "args": ["-y", "mistral-mcp@^0.6.0"],
      "env": {
        "MISTRAL_API_KEY": "${user_config.mistral_api_key}"
      }
    }
  }
}
```

When the plugin is enabled, Claude Code spawns `npx -y mistral-mcp@^0.5.0` and connects to it over stdio. The skill files in `skills/` are loaded as namespaced commands (`/mistral-mcp:*`).

## Versioning

This plugin tracks the [`mistral-mcp`](https://www.npmjs.com/package/mistral-mcp) npm package version. Plugin `0.6.x` pulls `mistral-mcp@^0.6.0` (any `0.6.x` patch, no minor bump). When `mistral-mcp@0.7.0` ships, this plugin will be bumped to `0.7.x` and `.mcp.json` updated in the same release.

## Security

- The API key is stored in the system keychain (or `~/.claude/.credentials.json` as fallback) — never written to settings.json.
- The plugin runs `npx` with `-y` to auto-install `mistral-mcp@^0.5.0` from npm. If you'd rather pin to an exact version, edit `.mcp.json` and replace the spec with `mistral-mcp@0.5.0` (no caret).

## Links

- npm: <https://www.npmjs.com/package/mistral-mcp>
- Source: <https://github.com/Swih/mistral-mcp>
- Official MCP Registry: `io.github.Swih/mistral-mcp`
- Mistral docs: <https://docs.mistral.ai/>

## License

MIT — Copyright Dayan Decamp
