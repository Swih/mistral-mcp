# Deploying mistral-mcp on-prem

Two delivery shapes, both "here are the files, apply them on your infrastructure":

| File | For |
|---|---|
| [`docker-compose.yml`](./docker-compose.yml) | A single host. Optionally starts a local vLLM alongside. |
| [`k8s/mistral-mcp.yaml`](./k8s/mistral-mcp.yaml) | A cluster. ConfigMap + Service + Deployment + NetworkPolicy + PDB. |
| [`connector-public.md`](./connector-public.md) | Exposing the server publicly as a Mistral Connector (Cloudflare Tunnel, Fly.io, Cloud Run). |

Plain manifests, no Helm chart: the point is that whoever runs it can read and
diff exactly what lands on their cluster.

---

## Keeping inference on your own infrastructure

Set `MISTRAL_BASE_URL` to any OpenAI-compatible endpoint — vLLM, TGI, LiteLLM, an
internal token factory — and every request goes there instead of
`api.mistral.ai`:

```bash
MISTRAL_BASE_URL=http://vllm.internal:8000/v1 \
MISTRAL_DEFAULT_MODEL=my-org/mistral-small-3.2 \
npx mistral-mcp
```

Two things change automatically when the endpoint is not Mistral's:

1. **The profile switches to `self-hosted`.** Only the five tools an
   OpenAI-compatible server can actually serve stay registered:
   `mistral_chat`, `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call`,
   `mistral_vision`. OCR, Voxtral, Files, Batch, Workflows and the rest are
   Mistral-platform endpoints; advertising them against vLLM would only produce
   404s the calling model has to guess its way out of.
2. **Model identifiers are no longer checked against a list.** Any non-empty
   string is forwarded as-is, because your endpoint's model ids are yours
   (`my-org/mistral-small-3.2` is a normal answer, not an error).

Override the inference with `MISTRAL_MCP_PROFILE=admin` if your gateway does
proxy the full Mistral API. An explicit profile always wins over the inferred one.

Read `mistral://capabilities` from any MCP client to see, at runtime, which
families are on, which are off, and why:

```json
{
  "endpoint": "http://vllm.internal:8000/v1",
  "endpoint_kind": "custom",
  "profile": "self-hosted",
  "profile_inferred": true,
  "tool_families": {
    "chat":  { "available": true },
    "ocr":   { "available": false,
               "unavailable_reason": "Not served by an OpenAI-compatible endpoint..." }
  }
}
```

---

## Docker Compose

```bash
cp .env.example .env          # fill in MCP_HTTP_TOKEN, and MISTRAL_API_KEY or MISTRAL_BASE_URL
docker compose -f deploy/docker-compose.yml up -d
curl localhost:3333/healthz
```

With a local model server on the same host:

```bash
echo 'MISTRAL_BASE_URL=http://vllm:8000/v1' >> .env
docker compose -f deploy/docker-compose.yml --profile vllm up -d
```

The container runs as `node` (uid 1000), read-only root filesystem, all
capabilities dropped, and publishes on `127.0.0.1` only. Terminate TLS at your
own ingress before changing that binding.

---

## Kubernetes

```bash
kubectl create namespace mistral-mcp
kubectl -n mistral-mcp create secret generic mistral-mcp \
  --from-literal=MCP_HTTP_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=MISTRAL_API_KEY="sk-..."      # omit when using MISTRAL_BASE_URL
kubectl -n mistral-mcp apply -f deploy/k8s/mistral-mcp.yaml
kubectl -n mistral-mcp rollout status deploy/mistral-mcp
```

Then edit the ConfigMap for your endpoint and profile. Two things to adjust
before production:

- **Pin the image by digest.** The manifest ships `:latest` so the file is
  runnable as-is; that is not what you want in a controlled environment.
- **Narrow the NetworkPolicy.** The egress rule as written allows any in-cluster
  destination on 443/8000. Replace it with a selector or CIDR for your
  inference endpoint.

The cache volume is an `emptyDir` on purpose: `process_document` keys its cache
by content hash, so losing it costs a re-OCR and nothing else. Swap in a RWX PVC
if that re-OCR is expensive for you.

---

## Environment

| Variable | Required | What it does |
|---|---|---|
| `MISTRAL_API_KEY` | Unless `MISTRAL_BASE_URL` needs no auth | Mistral Cloud key. Read once at boot, never logged. |
| `MISTRAL_BASE_URL` | No | OpenAI-compatible endpoint. Setting it infers the `self-hosted` profile. |
| `MISTRAL_MCP_PROFILE` | No | `core` (default) / `admin` / `workflows` / `metier-docs` / `self-hosted`. Overrides inference. |
| `MISTRAL_DEFAULT_MODEL` | No | Default chat model id when a call omits `model`. |
| `MISTRAL_MCP_CACHE_DIR` | No | Where `process_document` caches results. |
| `MISTRAL_MCP_AUDIT` | No | `off` silences the per-call JSON audit line on stderr. On by default. |
| `MCP_TRANSPORT` | For HTTP | `http` to serve Streamable HTTP instead of stdio. |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` / `MCP_HTTP_PATH` | No | Bind address, port, path. Defaults `127.0.0.1:3333/mcp`. |
| `MCP_HTTP_TOKEN` | For HTTP | Bearer token clients must present. Without it the endpoint is unauthenticated. |
| `MCP_HTTP_ALLOWED_ORIGINS` | No | Comma-separated exact origins. Set it when browsers reach the server. |

`/healthz` is unauthenticated and never touches the MCP server, so it is safe as
a liveness and readiness probe.

---

## Verifying an install

```bash
# 1. The process is up
curl -s localhost:3333/healthz

# 2. The auth actually rejects
curl -s -o /dev/null -w '%{http_code}\n' localhost:3333/mcp     # 401

# 3. The tool surface matches the profile you expect
npx @modelcontextprotocol/inspector node dist/index.js
```

`test/stdio/self-hosted.test.ts` runs this same path in CI against a throwaway
OpenAI-compatible server: profile inference, hidden families, and a real chat
call landing on the custom endpoint. If you change the deployment, that is the
test to keep green.
