# mistral-mcp

> **MCP server for Mistral AI — chat, OCR, audio (Voxtral), code (Codestral), vision, agents, batch, and durable workflows.**
> Plug into Claude Code, Cursor, Zed, Windsurf, or Claude Desktop in one command.
>
> _Version française : [README.fr.md](./README.fr.md)_

[![npm version](https://img.shields.io/npm/v/mistral-mcp?color=brightgreen)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![Glama MCP score](https://glama.ai/mcp/servers/Swih/mistral-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Swih/mistral-mcp)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
![MCP spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)

---

## What this is

`mistral-mcp` exposes the full Mistral AI API as a set of MCP tools, resources, and prompts. An MCP client (Claude Code, Cursor, etc.) can call `mistral_ocr` to extract text from a PDF, `voxtral_transcribe` to transcribe a meeting recording, or `workflow_execute` to start a durable multi-step process — all without leaving the agent loop.

**Unique to Mistral and not available from other MCP servers:**
- `mistral_ocr` — Mistral Document AI: structured text + bbox annotations from any PDF or image
- `voxtral_transcribe` — Voxtral: transcription with optional speaker diarization
- `codestral_fim` — Codestral fill-in-the-middle (FIM) for inline code completion
- `workflow_execute / status / interact` — Temporal-backed durable execution with human-in-the-loop signals
- French-optimized models (`mistral-large-latest`, `mistral-medium-latest`) and curated French prompts

**What this server does not expose:** fine-tuning, user management, non-FR/EN prompts.

---

## Quick start

```bash
# Claude Code — recommended path (auto-installs, prompts for API key, ships 11 skills)
/plugin install mistral-mcp@swih-plugins

# Or: manual MCP registration via npx
claude mcp add mistral -- npx -y mistral-mcp@latest
```

Set your key:

```bash
export MISTRAL_API_KEY=your_key_here
```

---

## Profiles

`MISTRAL_MCP_PROFILE` controls how many tools are exposed (default: `core`).

| Profile | Tools | Use when |
|---|---|---|
| `core` (default) | 8 | Daily use — lean context footprint |
| `full` | 25 | Need embeddings, streaming, batch, classify, files, agents, TTS |
| `workflows` | 3 | Pipeline orchestration only |

```bash
MISTRAL_MCP_PROFILE=full npx mistral-mcp
```

---

## Tools

### Core profile (8 tools — always available)

| Tool | What it does |
|---|---|
| `mistral_chat` | Chat completion. Supports all Mistral models, `response_format`, `reasoning_effort` for Magistral. |
| `mistral_vision` | Multimodal chat with images (URL or base64). |
| `mistral_ocr` | Document AI — extract text, bbox, and JSON annotations from PDFs/images. |
| `codestral_fim` | Fill-in-the-middle code completion (Codestral model). |
| `voxtral_transcribe` | Audio → text. Pass `diarize: true` for speaker separation. |
| `workflow_execute` | Start a Mistral Workflow (Temporal-backed durable execution). |
| `workflow_status` | Poll a running workflow — returns `RUNNING \| COMPLETED \| FAILED \| ...`. |
| `workflow_interact` | Signal / query a running workflow. Used for human-in-the-loop checkpoints. |

### Full profile only (+17 tools, set `MISTRAL_MCP_PROFILE=full`)

| Group | Tools |
|---|---|
| Generation | `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call` |
| Agents | `mistral_agent`, `mistral_moderate`, `mistral_classify` |
| Audio | `voxtral_speak` (TTS) |
| Files | `files_upload`, `files_list`, `files_get`, `files_delete`, `files_signed_url` |
| Batch | `batch_create`, `batch_get`, `batch_list`, `batch_cancel` |
| Sampling | `mcp_sample` (delegates generation to the MCP client's own model) |

---

## Resources

| URI | What it returns |
|---|---|
| `mistral://models` | Live model catalog + accepted aliases |
| `mistral://voices` | Live Voxtral TTS voice catalog |
| `mistral://workflows` | Live list of deployed workflows (use `name` as `workflowIdentifier`) |

---

## Prompts

Curated prompts with structured arguments and MCP completion support:

| Prompt | Input | Output |
|---|---|---|
| `french_meeting_minutes` | transcript text | Structured French meeting minutes |
| `french_email_reply` | received email + context | Polished French reply |
| `french_commit_message` | git diff | Conventional Commits message in French |
| `french_legal_summary` | legal document text | Plain-French summary + key clauses |
| `french_invoice_reminder` | debtor, amount, days overdue, tone | B2B dunning letter in French |
| `codestral_review` | git diff | Focused code review (security / logic / style) |

---

## Claude Code skills (11)

Install via the `swih-plugins` marketplace to get these namespaced skills:

**Routing**
- `/mistral-mcp:mistral-router` — picks the right Mistral model + tool for any task

**Code**
- `/mistral-mcp:codestral-review` — fetches the current diff, runs a focused review

**French workflows**
- `/mistral-mcp:french-commit-message` — Conventional Commits message in French
- `/mistral-mcp:french-meeting-minutes` — audio or text → structured French minutes
- `/mistral-mcp:french-invoice-reminder` — B2B dunning letter with controlled tone

**Document & audio processing**
- `/mistral-mcp:contract-analyzer` — OCR → risk-rated clause extraction (JSON)
- `/mistral-mcp:pdf-invoice-extractor` — OCR → structured invoice fields for reconciliation
- `/mistral-mcp:audio-dispatch` — transcribe + diarize → per-speaker action plan

**Human-in-the-loop workflows**
- `/mistral-mcp:contract-review-workflow` — durable contract review with approval gates
- `/mistral-mcp:compliance-audit-workflow` — multi-step audit with mid-run findings + decisions
- `/mistral-mcp:research-pipeline-workflow` — hypothesis-driven research with amendment injection

---

## Install

```bash
# Run directly (no global install)
npx mistral-mcp

# Global install
npm install -g mistral-mcp && mistral-mcp

# Docker
docker build -t mistral-mcp .
docker run -i --rm -e MISTRAL_API_KEY=your_key mistral-mcp

# From source
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp && npm install && npm run build
node dist/index.js
```

---

## Transport

| Mode | How to enable | Default |
|---|---|---|
| **stdio** | Default | `node dist/index.js` |
| **Streamable HTTP** | `MCP_TRANSPORT=http` or `--http` flag | `127.0.0.1:3333/mcp` |

HTTP env vars: `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH`, `MCP_HTTP_TOKEN` (bearer auth), `MCP_HTTP_ALLOWED_ORIGINS`, `MCP_HTTP_STATELESS=1`.

`/healthz` is public and does not touch the MCP server.

---

## Development

```bash
npm run dev      # tsx watch
npm run build    # tsc → dist/
npm run lint     # tsc --noEmit
npm test         # all 174 tests
npm run inspector
```

Test pyramid: unit → contract → stdio e2e → live API (requires `MISTRAL_API_KEY`).

---

## License

MIT — Copyright Dayan Decamp
