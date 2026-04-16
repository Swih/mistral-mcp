# Examples

Minimal Node.js scripts that exercise `mistral-mcp` end-to-end via the same
stdio JSON-RPC pipe that Claude Code, Cursor, or any MCP client uses.

All scripts load `MISTRAL_API_KEY` from your shell env or from a `.env` file
at the **repo root** (not at `examples/`). Run them from the repo root:

```bash
cd mistral-mcp
npm install
# put MISTRAL_API_KEY in .env (gitignored) or export it
node examples/try-it.mjs
```

## `try-it.mjs` — smoke test

Spawns `mistral-mcp` via `npx`, performs the MCP handshake, lists tools,
then calls `mistral_chat` with `"cc le chat"`. Useful to verify your env
before wiring the server into an IDE.

```bash
node examples/try-it.mjs           # via published npm package
node examples/try-it.mjs --local   # via local ./dist build
```

Expected output:

```
✓ MCP handshake OK
✓ Tools exposed: mistral_chat, mistral_chat_stream, mistral_embed, mistral_tool_call, codestral_fim

→ calling mistral_chat with: 'cc le chat'

=== Mistral a répondu ===
Bonjour ! 😊 Comment puis-je vous aider aujourd'hui ?
```

## `rate-it.mjs` — self-review

Feeds the project's `README.md` to Mistral Large and asks for a critical
engineering review (scored /10 on four axes). Doubles as a sanity check that
your docs read correctly to an outside reader.

```bash
node examples/rate-it.mjs
```
