# mistral-mcp

> **MCP server exposing Mistral AI capabilities to any MCP client** - Claude Code, Cursor, Zed, Windsurf, Claude Desktop.
>
> _Version française : [README.fr.md](./README.fr.md)_

[![npm version](https://img.shields.io/npm/v/mistral-mcp?color=brightgreen)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![Glama MCP score](https://glama.ai/mcp/servers/Swih/mistral-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Swih/mistral-mcp)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
![MCP spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)

## Why

Mistral has strong models for French, code, OCR, moderation, audio, and agent-style workflows, but most MCP-enabled IDEs default to Anthropic or OpenAI. `mistral-mcp` gives those Mistral capabilities a clean MCP surface so you can route the right subtask to the right model without rebuilding your agent loop.

The goal of this repo is not "yet another thin wrapper". It aims to be a robust, maintainable MCP server with explicit schemas, predictable outputs, transport flexibility, and good test coverage.

## Current surface (`v0.6.0`)

### Profiles

`MISTRAL_MCP_PROFILE` controls how many tools are exposed (default: `core`):

| Profile | Tools | Description |
|---|---|---|
| `core` (default) | 8 | `mistral_chat`, `mistral_vision`, `mistral_ocr`, `codestral_fim`, `voxtral_transcribe` + 3 workflow tools |
| `full` | 25 | All v0.5 tools + 3 workflow tools. Opt-in for `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call`, etc. |
| `workflows` | 3 | Workflow tools only — for pipeline orchestration use-cases |

```bash
MISTRAL_MCP_PROFILE=full node dist/index.js
```

### Tools (25 in `full` profile — 8 in `core`)

Core generation:
- `mistral_chat`
- `mistral_chat_stream`
- `mistral_embed`
- `mistral_tool_call`
- `codestral_fim`

Vision and audio:
- `mistral_vision`
- `mistral_ocr`
- `voxtral_transcribe`
- `voxtral_speak`

Agents and classifiers:
- `mistral_agent`
- `mistral_moderate`
- `mistral_classify`

Files and batch:
- `files_upload`
- `files_list`
- `files_get`
- `files_delete`
- `files_signed_url`
- `batch_create`
- `batch_list`
- `batch_get`
- `batch_cancel`

MCP-native utility:
- `mcp_sample` - delegates generation to the client model via MCP sampling (`full` profile)

Workflows (durable execution engine):
- `workflow_execute`
- `workflow_status`
- `workflow_interact` — polymorphic: `signal` or `query` against a running execution

### Resources (3)

- `mistral://models` - accepted aliases and live model catalog
- `mistral://voices` - live voice catalog for Voxtral TTS
- `mistral://workflows` - live list of deployed Mistral Workflows (use `name` as `workflowIdentifier`)

### Prompts (6)

French curated prompts:
- `french_invoice_reminder`
- `french_meeting_minutes`
- `french_email_reply`
- `french_commit_message`
- `french_legal_summary`

English curated prompt:
- `codestral_review`

Prompt enum arguments are wrapped with `completable()`, so MCP clients can call prompt argument completion via `completion/complete`.

## Highlights

- High-level `McpServer` API with `inputSchema`, `outputSchema`, and annotations on every tool
- Profile system: `MISTRAL_MCP_PROFILE=core|full|workflows` — `core` by default for a lean context footprint
- Mistral Workflows: `workflow_execute` / `workflow_status` / `workflow_interact` in every profile
- Dual transport support: stdio by default, Streamable HTTP for remote deployments
- Structured outputs everywhere: `structuredContent` plus text fallback
- OCR annotations: `mistral_ocr` can request document-level and image/bbox JSON annotations from Mistral Document AI
- MCP sampling support through `mcp_sample` (`full` profile)
- Prompt completion support for enum-like prompt arguments
- Resources and prompts registered alongside tools, not bolted on later
- Retry/backoff and request timeout on the Mistral SDK client

## Transport

### Stdio

Default mode. This is what Claude Code and most local MCP clients use.

```bash
node dist/index.js
```

### Streamable HTTP

Enable with `--http` or `MCP_TRANSPORT=http`.

```bash
MCP_TRANSPORT=http node dist/index.js
```

Relevant env vars:
- `MCP_HTTP_HOST` - default `127.0.0.1`
- `MCP_HTTP_PORT` - default `3333`
- `MCP_HTTP_PATH` - default `/mcp`
- `MCP_HTTP_TOKEN` - optional bearer token
- `MCP_HTTP_ALLOWED_ORIGINS` - optional comma-separated allow-list
- `MCP_HTTP_STATELESS=1` - stateless session mode

`/healthz` is intentionally public and does not touch the MCP server.

## Install

Run from npm:

```bash
npx mistral-mcp
```

Or install globally:

```bash
npm install -g mistral-mcp
mistral-mcp
```

Run with Docker:

```bash
docker build -t mistral-mcp:dev .
docker run -i --rm -e MISTRAL_API_KEY=your_key_here mistral-mcp:dev
```

The image uses a multi-stage build and keeps the runtime container to production dependencies plus `dist/`.

Build from source:

```bash
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp
npm install
npm run build
```

Set your API key:

```bash
export MISTRAL_API_KEY=your_key_here
```

Or use `.env` at the repo root. Never commit it.

## Use in Claude Code

### Option A — Claude Code plugin (recommended)

The fastest path: install the bundled Claude Code plugin from the `swih-plugins` marketplace. It auto-installs the MCP server, prompts for your API key (stored in Claude Code's secrets storage), and ships 5 curated skills.

```text
/plugin marketplace add Swih/mistral-mcp
/plugin install mistral-mcp@swih-plugins
```

The plugin adds these namespaced skills:

- `/mistral-mcp:mistral-router` — picks the right Mistral model + tool for a given task
- `/mistral-mcp:codestral-review` — auto-fetches the diff, runs a focused code review
- `/mistral-mcp:french-commit-message` — generates a Conventional Commits message in French
- `/mistral-mcp:french-meeting-minutes` — audio file or text → structured French meeting minutes
- `/mistral-mcp:french-invoice-reminder` — French B2B dunning letter with controlled tone

See [`claude-plugin/README.md`](./claude-plugin/README.md) for plugin-specific details.

### Option B — Manual MCP server registration

```bash
claude mcp add mistral -- node /absolute/path/to/mistral-mcp/dist/index.js
```

Or via npx, no global install needed:

```bash
claude mcp add mistral -- npx -y mistral-mcp@latest
```

Example prompt:

> Use `mistral_ocr` on this PDF, then run `french_meeting_minutes` on the extracted text.

## Develop

```bash
npm run dev
npm run build
npm run lint
npm test
npm run inspector
```

## Test strategy

The suite currently contains 172 tests across 4 layers:

1. Unit tests for tools, resources, prompts, transport, audio, agents, files, batch, and sampling
2. Contract tests for tool metadata and MCP-facing guarantees
3. Live API tests against the real Mistral API when `MISTRAL_API_KEY` is set
4. Stdio end-to-end tests against the built server

Without `MISTRAL_API_KEY`, the local default is `161 passing` plus `11 gated` live/stdio tests.

## Project layout

```text
mistral-mcp/
|-- src/
|   |-- index.ts
|   |-- profile.ts
|   |-- transport.ts
|   |-- tools.ts
|   |-- tools-fn.ts
|   |-- tools-vision.ts
|   |-- tools-audio.ts
|   |-- tools-agents.ts
|   |-- tools-files.ts
|   |-- tools-batch.ts
|   |-- tools-sampling.ts
|   |-- tools-workflows.ts
|   |-- resources.ts
|   `-- prompts.ts
|-- test/
|-- examples/
|-- .github/workflows/ci.yml
|-- package.json
`-- tsconfig.test.json
```

## Status

`v0.6.0` — See [CHANGELOG.md](./CHANGELOG.md) for the full diff against `v0.5.0`:

- profile system (`MISTRAL_MCP_PROFILE=core|full|workflows`) — `core` as default for lean tool context
- 3 new workflow tools: `workflow_execute`, `workflow_status`, `workflow_interact`
- `mistral://workflows` resource — live catalog of deployed workflows
- 172 tests (134 unit + 27 contract + 5 stdio e2e + 6 live API)

## Examples

Runnable scripts live in [`examples/`](./examples/). See [`examples/README.md`](./examples/README.md).

## License

MIT Copyright Dayan Decamp
