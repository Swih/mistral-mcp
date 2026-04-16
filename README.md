# mistral-mcp

> **MCP server exposing Mistral AI models to any MCP client** — Claude Code, Cursor, Zed, Windsurf, Claude Desktop.

![version](https://img.shields.io/badge/version-v0.3.0-orange)
![license](https://img.shields.io/badge/license-MIT-black)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![typescript](https://img.shields.io/badge/typescript-strict-blue)
![mcp-spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)
![tests](https://img.shields.io/badge/tests-32%20passing-brightgreen)
![primitives](https://img.shields.io/badge/primitives-tools%20%2B%20resources%20%2B%20prompts-blueviolet)

---

## Why

Mistral ships excellent open-weights and hosted models, but most MCP-enabled IDEs (Claude Code, Cursor, Zed) default to Anthropic or OpenAI. `mistral-mcp` is a production-leaning MCP server that makes any Mistral model callable as a tool inside your agent workflow — without rewriting your plumbing.

Route specific tasks (French drafting, Codestral completions, cheap bulk classification, embeddings) to Mistral while keeping the rest of your agent loop on whatever you already use.

## Features (v0.3)

### Tools (5)

| Tool | Purpose | Notes |
|---|---|---|
| `mistral_chat` | Chat completion | Default `mistral-medium-latest`. `structuredContent` + text fallback. |
| `mistral_chat_stream` | Streaming chat | Emits `notifications/progress` per chunk when client provides a `progressToken`. Captures `finish_reason`. |
| `mistral_embed` | Embeddings | `mistral-embed`. Batch up to 100 strings. |
| `mistral_tool_call` | **Function calling** | OpenAI-style `tools` + `tool_choice` + `parallel_tool_calls`. Does not execute tools — returns the model's decision for the caller to route. |
| `codestral_fim` | **Codestral FIM** | Fill-in-the-middle code completion (`mistral.fim.complete`). |

### Resources (1)

- `mistral://models` — canonical JSON catalog of supported model aliases, grouped by capability (chat / embed / fim / tool_capable).

### Prompts (2 curated)

- `french_invoice_reminder(debtor_name, amount_eur, days_overdue, tone)` — tone-controlled B2B reminder in French (polite / firm / final).
- `codestral_review(diff, focus)` — senior-code-review prompt focused on correctness / performance / security / api_design.

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

## Examples

Two runnable scripts in [`examples/`](./examples/) that talk to the server over
the same stdio pipe a client like Claude Code uses:

- **`examples/try-it.mjs`** — smoke test: handshake, list tools, run
  `mistral_chat` with "cc le chat". Defaults to the npm-published package
  (`npx -y mistral-mcp`); pass `--local` to point at `./dist`.
- **`examples/rate-it.mjs`** — feeds this README to Mistral Large through the
  MCP and asks for a critical review.

```bash
cd mistral-mcp
# export MISTRAL_API_KEY (or put it in .env)
node examples/try-it.mjs
node examples/rate-it.mjs
```

See [`examples/README.md`](./examples/README.md) for expected output.

## Develop

```bash
npm run dev        # tsx watch
npm run build      # tsc
npm run lint       # type-check only
npm test           # vitest — unit + live API + stdio e2e
npm run inspector  # spawn the server under MCP Inspector UI
```

### Test strategy

32 tests across 5 files / 3 layers:

1. **Unit** (`test/tools.unit.test.ts`, `test/fn.unit.test.ts`, `test/resources-prompts.unit.test.ts`) — `InMemoryTransport` between a real `McpServer` and `Client`, with a mocked Mistral SDK. Covers tool listing, schema validation, `structuredContent`, default model, all 12 chat model aliases, error propagation, streaming chunk assembly + `finish_reason` + empty stream + mid-stream throw, embedding edge cases, function calling (tool_choice/parallel_tool_calls propagation, API error surfacing), FIM (model allow-list + stop tokens), resources catalog read, prompts argument validation.
2. **Live API** (`test/mistral.live.test.ts`) — hits the real Mistral API if `MISTRAL_API_KEY` is set. Verifies `chat.complete`, `embeddings.create` (1024-dim), function calling with `toolChoice: "any"`, and `fim.complete` on Codestral.
3. **Stdio e2e** (`test/mcp.stdio.test.ts`) — spawns `dist/index.js` as a child process, connects via `StdioClientTransport`, performs a real MCP handshake, lists tools/resources/prompts, runs a real `mistral_chat` call. Catches wiring bugs the in-memory tests can't.

## Roadmap

### Shipped in v0.3

- [x] Function calling (`mistral_tool_call`) with `parallel_tool_calls` + `tool_choice`
- [x] Codestral FIM (`codestral_fim`)
- [x] Resources primitive (`mistral://models`)
- [x] Prompts primitive (french_invoice_reminder, codestral_review)
- [x] `finish_reason` captured in streaming
- [x] **Published on npm** — `npx -y mistral-mcp` works out of the box ([npm page](https://www.npmjs.com/package/mistral-mcp))

### v0.4+

- [ ] Vision (multimodal via Mistral Large 3)
- [ ] `resource_link` output for large embedding payloads
- [ ] Streamable HTTP transport (spec 2025-03-26, replaces HTTP+SSE)
- [ ] Docker image (`docker run ghcr.io/swih/mistral-mcp`)
- [ ] ESLint + Prettier in CI (currently only `tsc --noEmit`)
- [ ] Example payloads in README for every tool

## Project layout

```
mistral-mcp/
├── src/
│   ├── index.ts         # MCP server entry — stdio, env bootstrap, wiring
│   ├── models.ts        # chat/embed/fim/tool-capable allow-lists + Zod enums
│   ├── tools.ts         # mistral_chat, mistral_chat_stream, mistral_embed
│   ├── tools-fn.ts      # mistral_tool_call, codestral_fim
│   ├── resources.ts     # mistral://models catalog
│   └── prompts.ts       # french_invoice_reminder, codestral_review
├── test/
│   ├── tools.unit.test.ts                 # v0.2 tools (11 tests)
│   ├── fn.unit.test.ts                    # v0.3 fn/fim (8 tests)
│   ├── resources-prompts.unit.test.ts     # v0.3 primitives (7 tests)
│   ├── mistral.live.test.ts               # real Mistral API (4 tests)
│   └── mcp.stdio.test.ts                  # e2e over stdio (2 tests)
├── examples/
│   ├── try-it.mjs       # smoke test over MCP stdio
│   ├── rate-it.mjs      # Mistral Large reviews this README via MCP
│   └── README.md
├── dist/                # build output (gitignored)
├── .github/workflows/ci.yml
├── .env.example
└── package.json
```

## Contributing

Issues and PRs welcome. Keep it minimal, production-oriented, aligned with the [MCP 2025-11-25 spec](https://modelcontextprotocol.io/specification/2025-11-25).

## License

MIT © Dayan Decamp — [github.com/Swih](https://github.com/Swih)
