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

## Current surface (`v0.4.0`)

### Tools (22)

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
- `mcp_sample` - delegates generation to the client model via MCP sampling

### Resources (2)

- `mistral://models` - accepted aliases and live model catalog
- `mistral://voices` - live voice catalog for Voxtral TTS

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
- Dual transport support: stdio by default, Streamable HTTP for remote deployments
- Structured outputs everywhere: `structuredContent` plus text fallback
- MCP sampling support through `mcp_sample`
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

```bash
claude mcp add mistral -- node /absolute/path/to/mistral-mcp/dist/index.js
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

The suite currently contains 148 tests across 4 layers:

1. Unit tests for tools, resources, prompts, transport, audio, agents, files, batch, and sampling
2. Contract tests for tool metadata and MCP-facing guarantees
3. Live API tests against the real Mistral API when `MISTRAL_API_KEY` is set
4. Stdio end-to-end tests against the built server

Without `MISTRAL_API_KEY`, the local default is `139 passing` plus `9 gated` live/stdio tests.

## Project layout

```text
mistral-mcp/
|-- src/
|   |-- index.ts
|   |-- transport.ts
|   |-- tools.ts
|   |-- tools-fn.ts
|   |-- tools-vision.ts
|   |-- tools-audio.ts
|   |-- tools-agents.ts
|   |-- tools-files.ts
|   |-- tools-batch.ts
|   |-- tools-sampling.ts
|   |-- resources.ts
|   `-- prompts.ts
|-- test/
|-- examples/
|-- .github/workflows/ci.yml
|-- package.json
`-- tsconfig.test.json
```

## Status

`v0.4.0` — shipped. See [CHANGELOG.md](./CHANGELOG.md) for the full diff against `v0.3.0`:

- shared helpers, live model + voice catalogs, contract tests
- vision + OCR
- audio transcription + speech
- agents + moderation + classification
- files + batch APIs
- Streamable HTTP transport + MCP sampling
- 5 French curated prompts + 1 English prompt + prompt argument completion

## Examples

Runnable scripts live in [`examples/`](./examples/). See [`examples/README.md`](./examples/README.md).

## License

MIT Copyright Dayan Decamp
