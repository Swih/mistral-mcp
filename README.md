# mistral-mcp

> **MCP server exposing Mistral AI models to any MCP client** — Claude Code, Cursor, Zed, Windsurf, Claude Desktop.

![version](https://img.shields.io/badge/version-v0.2.0-orange)
![license](https://img.shields.io/badge/license-MIT-black)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![typescript](https://img.shields.io/badge/typescript-strict-blue)
![mcp-spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)
![tests](https://img.shields.io/badge/tests-13%20passing-brightgreen)

---

## Why

Mistral ships excellent open-weights and hosted models, but most MCP-enabled IDEs (Claude Code, Cursor, Zed) default to Anthropic or OpenAI. `mistral-mcp` is a production-leaning MCP server that makes any Mistral model callable as a tool inside your agent workflow — without rewriting your plumbing.

Route specific tasks (French drafting, Codestral completions, cheap bulk classification, embeddings) to Mistral while keeping the rest of your agent loop on whatever you already use.

## Features (v0.2)

| Tool | Purpose | Notes |
|---|---|---|
| `mistral_chat` | Chat completion | Default: `mistral-medium-latest`. Returns `structuredContent` + text fallback. |
| `mistral_chat_stream` | Streaming chat | Emits `notifications/progress` per chunk when client provides a `progressToken`. |
| `mistral_embed` | Embeddings | `mistral-embed`. Batch up to 100 strings. |

### Spec compliance — MCP `2025-11-25`

- Built on the high-level `McpServer` + `registerTool` API ([sdk docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md))
- Every tool declares `inputSchema` + `outputSchema` + `annotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
- Every tool returns **both** `content[]` (serialized JSON) and `structuredContent` — [per spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/changelog)
- Streaming tool emits [progress notifications](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress) when `_meta.progressToken` is supplied
- API errors returned as `{ content: [text], isError: true }` so the calling LLM can self-correct

### Mistral-side hardening

- `@mistralai/mistralai` v2.2.0 (current)
- Built-in retry with exponential backoff (`initialInterval: 500ms`, `exponent: 2`, `maxElapsedTime: 30s`)
- Connection errors retried (`retryConnectionErrors: true`)
- 60s request timeout
- Model inputs validated against a **canonical allow-list** of `*-latest` aliases — dated models (with retirement dates) are rejected up-front

### Supported chat models

```
mistral-large-latest     mistral-medium-latest     mistral-small-latest
ministral-3b-latest      ministral-8b-latest       ministral-14b-latest
magistral-medium-latest  magistral-small-latest
devstral-latest          devstral-small-latest
codestral-latest         voxtral-small-latest
```

Source: [docs.mistral.ai/capabilities/function_calling](https://docs.mistral.ai/capabilities/function_calling/) (Available Models block).

## Install

```bash
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp
npm install
npm run build
```

## Configure

Get an API key at <https://console.mistral.ai/>, then export it:

```bash
export MISTRAL_API_KEY=your_key_here
```

Or use a local `.env` file (see `.env.example`). **Never commit `.env`.**

## Use in Claude Code

```bash
claude mcp add mistral -- node /absolute/path/to/mistral-mcp/dist/index.js
```

Or edit your MCP config directly:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "node",
      "args": ["/absolute/path/to/mistral-mcp/dist/index.js"],
      "env": {
        "MISTRAL_API_KEY": "your_key_here"
      }
    }
  }
}
```

Restart Claude Code, then:

> *"Use `mistral_chat` with `mistral-medium-latest` to draft a 120-word B2B invoice reminder in French, polite tone."*

## Use in Cursor / Zed / Windsurf / Claude Desktop

Any MCP-speaking client works the same way — point it at `node /absolute/path/to/mistral-mcp/dist/index.js` with `MISTRAL_API_KEY` in the process env.

- [Claude Desktop config format](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Cursor MCP docs](https://cursor.com/docs/context/mcp)

## Develop

```bash
npm run dev        # tsx watch
npm run build      # tsc
npm run lint       # type-check only
npm test           # vitest — unit + live API + stdio e2e
npm run inspector  # spawn the server under MCP Inspector UI
```

### Test strategy

13 tests across 3 layers:

1. **Unit** (`test/tools.unit.test.ts`) — `InMemoryTransport` between a real `McpServer` and `Client`, with a mocked Mistral SDK. Covers tool listing, schema validation, `structuredContent`, default model, all 12 model aliases, error propagation, streaming chunk assembly, embedding edge cases (empty input, over-limit batch).
2. **Live API** (`test/mistral.live.test.ts`) — hits the real Mistral API if `MISTRAL_API_KEY` is set. Verifies `chat.complete` returns content and `embeddings.create` returns 1024-dim vectors.
3. **Stdio e2e** (`test/mcp.stdio.test.ts`) — spawns `dist/index.js` as a child process, connects via `StdioClientTransport`, performs a real MCP handshake, runs a real `mistral_chat` call. Catches wiring bugs the in-memory tests can't.

## Roadmap (v0.3+)

- [ ] Function / tool calling (`mistral_tool_call`) with `parallelToolCalls` + `toolChoice`
- [ ] Codestral FIM completion (`mistral_fim`)
- [ ] Vision (multimodal via Mistral Large 3)
- [ ] `resource_link` output for large embedding payloads
- [ ] Resources primitive: `mistral://models`
- [ ] Prompts primitive: curated French/EU-business templates
- [ ] Streamable HTTP transport (spec 2025-03-26, replaces HTTP+SSE)
- [ ] Publish to npm (`npx -y mistral-mcp`)

## Project layout

```
mistral-mcp/
├── src/
│   ├── index.ts         # MCP server entry — stdio transport, env bootstrap
│   ├── models.ts        # canonical chat/embed model allow-list + Zod enums
│   └── tools.ts         # registerTool for mistral_chat / _stream / _embed
├── test/
│   ├── tools.unit.test.ts       # in-memory MCP + mocked Mistral
│   ├── mistral.live.test.ts     # real Mistral API (skipped w/o key)
│   └── mcp.stdio.test.ts        # spawns built server via stdio
├── dist/                # build output (gitignored)
├── .github/workflows/ci.yml
├── .env.example
└── package.json
```

## Contributing

Issues and PRs welcome. Keep it minimal, production-oriented, aligned with the [MCP 2025-11-25 spec](https://modelcontextprotocol.io/specification/2025-11-25).

## License

MIT © Dayan Decamp — [github.com/Swih](https://github.com/Swih)
