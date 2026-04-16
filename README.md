# mistral-mcp

> **MCP server exposing Mistral AI models to any MCP client** — Claude Code, Cursor, Zed, Windsurf, Claude Desktop.

![status](https://img.shields.io/badge/status-v0.1-orange)
![license](https://img.shields.io/badge/license-MIT-black)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![typescript](https://img.shields.io/badge/typescript-strict-blue)

---

## Why

Mistral ships excellent open-weights and hosted models, but most MCP-enabled IDEs (Claude Code, Cursor, Zed) default to Anthropic or OpenAI. `mistral-mcp` is a minimal, production-leaning MCP server that makes any Mistral model callable as a tool from within your agent workflow — without leaving your IDE or rewriting your agent plumbing.

Use it to route specific tasks (French drafting, Codestral completions, cheap bulk classification, private-by-design embeddings) to a Mistral model while keeping the rest of your agent loop on whatever you already use.

## Features (v0.1)

| Tool | Description |
|---|---|
| `mistral_chat` | Chat completion (default: `mistral-medium-latest`) — supports `temperature`, `max_tokens`, `top_p`, model override |
| `mistral_embed` | Embeddings via `mistral-embed` — batch inputs, returns vectors + usage |

- Stdio transport, no server to host
- Zero config beyond `MISTRAL_API_KEY`
- ESM TypeScript, strict mode, typed input validation via `zod`

### Roadmap

- [ ] Streaming chat (`mistral_chat_stream`)
- [ ] Function / tool calling
- [ ] Codestral FIM completion (`codestral_fim`)
- [ ] Vision support (Pixtral)
- [ ] Prompt caching awareness

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
# Optional
export MISTRAL_DEFAULT_MODEL=mistral-medium-latest
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

Restart Claude Code. Then ask things like:

> *"Use the `mistral_chat` tool with model `mistral-medium-latest` to draft a French B2B invoice reminder for a 1 200 € overdue case, polite tone, under 120 words."*

## Use in Cursor, Zed, Windsurf, Claude Desktop

Any MCP-speaking client works the same way — configure it to spawn `node /absolute/path/to/mistral-mcp/dist/index.js` with `MISTRAL_API_KEY` in the process env.

## Develop

```bash
npm run dev        # tsx watch
npm run build      # tsc
npm run lint       # type-check only, no emit
```

## Project layout

```
mistral-mcp/
├── src/
│   └── index.ts         # MCP server + tool handlers
├── dist/                # build output (gitignored)
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Contributing

Issues and PRs welcome. Keep it minimal, production-oriented, aligned with the MCP specification.

## License

MIT © Dayan Decamp — [github.com/Swih](https://github.com/Swih)
