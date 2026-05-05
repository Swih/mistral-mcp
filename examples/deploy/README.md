# Deploy mistral-mcp as a remote MCP server

This guide covers exposing `mistral-mcp` over HTTPS so it can be registered as a [Mistral Connector](https://docs.mistral.ai/agents/tools/mcp), or used by any remote MCP client.

The server speaks **Streamable HTTP** (the current MCP standard — SSE is deprecated). Bearer-token auth is built in.

---

## What you need

- A Mistral API key (`MISTRAL_API_KEY`).
- A bearer token for the MCP server itself (`MCP_HTTP_TOKEN`) — generate one with `openssl rand -hex 32`.
- A way to terminate TLS in front of the Node process. **Do not** expose the Node server directly without HTTPS.

---

## Option 1 — Cloudflare Tunnel (zero-config, no public IP needed)

Best for personal use or testing the Connector flow.

```bash
# 1. Run the server locally on HTTP
docker run -d \
  -e MISTRAL_API_KEY=sk-... \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_HTTP_PORT=3333 \
  -e MCP_HTTP_TOKEN=$(openssl rand -hex 32) \
  -p 3333:3333 \
  --name mistral-mcp \
  ghcr.io/swih/mistral-mcp:latest

# 2. Tunnel it (cloudflared installed locally)
cloudflared tunnel --url http://localhost:3333
# → prints a public https URL like https://random-name.trycloudflare.com
```

Your Connector endpoint is `https://random-name.trycloudflare.com/mcp`.

---

## Option 2 — Fly.io (durable deployment)

```bash
fly launch --no-deploy --copy-config --image ghcr.io/swih/mistral-mcp:latest
fly secrets set MISTRAL_API_KEY=sk-... MCP_HTTP_TOKEN=$(openssl rand -hex 32)
fly deploy
```

Edit your `fly.toml` so the http service points to port 3333 and set:

```toml
[env]
  MCP_TRANSPORT = "http"
  MCP_HTTP_HOST = "0.0.0.0"
  MCP_HTTP_PORT = "3333"
```

Fly terminates TLS for you. Your endpoint is `https://your-app.fly.dev/mcp`.

---

## Option 3 — Render / Railway / Cloud Run

Same idea: build from `Dockerfile`, expose port 3333, set the four env vars (`MISTRAL_API_KEY`, `MCP_TRANSPORT=http`, `MCP_HTTP_HOST=0.0.0.0`, `MCP_HTTP_TOKEN=...`). The platform terminates TLS.

---

## Register as a Mistral Connector

Once your endpoint is reachable over HTTPS:

```bash
curl -X POST https://api.mistral.ai/v1/connectors \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "mistral_mcp_self",
    "description": "Mistral capabilities exposed via mistral-mcp",
    "server": "https://your-deploy.example.com/mcp",
    "visibility": "private"
  }'
# → returns { "id": "<connector_id>", ... }
```

Use it from a Mistral conversation:

```bash
curl -X POST https://api.mistral.ai/v1/conversations \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{
    "model": "mistral-large-latest",
    "tools": [{
      "type": "connector",
      "connector_id": "<connector_id>",
      "authorization": { "type": "bearer", "value": "<MCP_HTTP_TOKEN>" }
    }],
    "messages": [{ "role": "user", "content": "OCR this PDF: https://..." }]
  }'
```

---

## Hardening

- `MCP_HTTP_ALLOWED_ORIGINS` — comma-separated allow-list for CORS / Origin checks.
- `MCP_HTTP_STATELESS=1` — recommended for serverless platforms (no session state across requests).
- `MISTRAL_MCP_PROFILE=core` — keep the tool surface lean to reduce LLM context overhead. Use `admin` only for debug.
- `/healthz` is public and does **not** touch the MCP server — safe for liveness probes.

---

## Caveats (Mistral Connectors specific)

Per the [Mistral Connectors docs](https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors): custom MCP Connectors currently expose **tools only**. Resources, prompts, sampling, and elicitation are visible from local clients (Claude Code, Cursor, Zed, Windsurf) but not from Mistral conversations.

Connectors are a beta feature. The API may change.
