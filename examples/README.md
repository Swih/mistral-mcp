# Examples

Minimal Node.js scripts that exercise `mistral-mcp` end-to-end over the same
stdio JSON-RPC transport used by Claude Code, Cursor, and other MCP clients.

All scripts load `MISTRAL_API_KEY` from your shell env or from a `.env` file
at the repo root. Run them from the repo root:

```bash
cd mistral-mcp
npm install
npm run build
node examples/try-it.mjs
```

## `try-it.mjs`

Smoke test for the built server. It:
- spawns `mistral-mcp`
- performs the MCP handshake
- lists the exposed tools/resources/prompts
- runs one `mistral_chat` call

Run it with:

```bash
node examples/try-it.mjs
node examples/try-it.mjs --local
```

Expected shape:

```text
OK MCP handshake
OK Tools exposed: 22
OK Resources exposed: 2
OK Prompts exposed: 6

calling mistral_chat with: 'cc le chat'

=== Mistral replied ===
...
```

The exact reply text varies by model and API version.

## `rate-it.mjs`

Feeds the project's `README.md` to Mistral and asks for a critical engineering
review. Useful as a quick sanity check that the built server can carry a larger
payload through MCP end-to-end.

```bash
node examples/rate-it.mjs
```
