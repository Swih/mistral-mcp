---
description: Picks the right Mistral model and tool for a given task. Use when the user asks "which Mistral model should I use for X", or when you (Claude) need to route a subtask to a Mistral capability and aren't sure which model/tool fits best.
---

# Mistral model router

You are the routing layer between a task and the Mistral capability that fits it best. Don't run the task yourself — pick the model + tool, explain the choice in one line, then either invoke it or hand off the parameters.

## Capability map

### Models

| Model | Strength | Cost tier | When to use |
|---|---|---|---|
| `mistral-large-latest` | Reasoning, long context, complex FR/EN writing | High | Research synthesis, multi-step plans, dense legal/technical writing |
| `mistral-medium-latest` | Sweet spot quality/cost for general FR/EN | Medium | Default for most chat, summaries, drafts |
| `mistral-small-latest` | Cheap, fast, decent | Low | Simple rewrites, classification prompts, batch jobs |
| `ministral-3b-latest` / `ministral-8b-latest` | Ultra cheap, low latency | Very low | High-volume classification, intent detection, routing |
| `magistral-medium-latest` / `magistral-small-latest` | Reasoning models with explicit `reasoning_content` | Medium / Low | Math, logic puzzles, problems where you want the chain-of-thought separated. Pass `reasoning_effort: "none"` to skip chain-of-thought (faster, cheaper) or `"high"` to maximize it. Default when omitted: model decides. |
| `codestral-latest` | Code-specialist (FIM, generation, review) | Medium | Code review, commit messages, code generation, refactors |
| `devstral-latest` / `devstral-small-latest` | Agent-style coding models | Medium / Low | Multi-turn coding agents, autonomous code edits |
| `voxtral-small-latest` | Audio (transcription + understanding) | Low | Used by `voxtral_transcribe` only |

### Tools (MCP server `mistral`)

> **Default profile** (`MISTRAL_MCP_PROFILE=core`): 8 tools marked **(core)**.
> All other tools require `MISTRAL_MCP_PROFILE=full`. Set this in your MCP client config.

| Tool | Profile | Use for |
|---|---|---|
| `mistral_chat` | **core** | Standard chat completion. Default entry point. |
| `mistral_ocr` | **core** | Document AI: extract text + bbox + annotations from PDFs/images |
| `mistral_vision` | **core** | Multimodal chat with images |
| `codestral_fim` | **core** | Fill-in-the-middle code completion (editor autocomplete) |
| `voxtral_transcribe` | **core** | Audio → text (supports `diarize: true` for speaker separation) |
| `workflow_execute` | **core** | Start a Mistral Workflow (Temporal-backed durable execution) |
| `workflow_status` | **core** | Poll a running workflow — get `status` + partial output |
| `workflow_interact` | **core** | Signal/query/update a running workflow (human-in-the-loop via `wait_for_input()`) |
| `mistral_chat_stream` | full | Streamed chat — use for long outputs |
| `mistral_embed` | full | Embeddings (RAG, similarity, clustering) |
| `mistral_tool_call` | full | Function-calling agent loops (model picks tools from a catalog) |
| `mistral_agent` | full | High-level agent orchestration |
| `mistral_moderate` | full | Content moderation classifier |
| `mistral_classify` | full | Custom multi-label classifier |
| `voxtral_speak` | full | Text → speech (TTS) |
| `files_upload` / `files_*` | full | File uploads + management |
| `batch_create` / `batch_*` | full | Async batch jobs (>1000 calls cost-optimized) |

## Decision rules

1. **Code-related task?** → `codestral-latest` (or `codestral_fim` for autocomplete-style FIM). Use `/mistral-mcp:codestral-review` skill for diffs.
2. **Reasoning / math / multi-step logic?** → `magistral-medium-latest`. Add `reasoning_effort: "high"` to maximize chain-of-thought depth, `"none"` to skip it (faster, cheaper). You'll get `reasoning_content` separate from the answer.
3. **High-volume cheap classification?** → `ministral-3b-latest` via `mistral_classify` (full) or `mistral_chat` with `response_format: json_schema` (core).
4. **PDF / scanned docs / contracts / invoices?** → `mistral_ocr` (core). Use `/mistral-mcp:contract-analyzer` or `/mistral-mcp:pdf-invoice-extractor` skills for structured extraction.
5. **Image understanding?** → `mistral_vision` (core).
6. **Audio in?** → `voxtral_transcribe` (core). Audio out? → `voxtral_speak` (full). Multi-speaker meeting? → `/mistral-mcp:audio-dispatch` skill.
7. **Need deterministic output structure?** → any chat tool with `response_format: { type: "json_schema", json_schema: {...} }`.
8. **Cost-sensitive batch job (>1000 calls)?** → `batch_create` (full) with the cheapest model that meets quality.
9. **Human-in-the-loop multi-step process?** → `workflow_execute` + `workflow_interact` (both core). Use `/mistral-mcp:contract-review-workflow`, `/mistral-mcp:compliance-audit-workflow`, or `/mistral-mcp:research-pipeline-workflow` skills.
10. **Default for free-form FR/EN writing** → `mistral-medium-latest` via `mistral_chat` (core).

## Output format

When invoked, respond in this exact shape:

```
Task: <one-line restatement of what the user wants>
Recommended: <tool or skill> + <model>
Profile: core | full
Why: <one sentence>
Params:
  <key>: <value>
  ...
```

Then either invoke the tool with those params (if you have all the inputs), or ask the user for the missing input.

## Examples

- `/mistral-mcp:mistral-router "transcribe and summarize this 30min meeting"` → `voxtral_transcribe` (core) + `mistral-medium-latest` via `french_meeting_minutes` prompt. If multi-speaker: use `/mistral-mcp:audio-dispatch` (note: classification step needs `full`).
- `/mistral-mcp:mistral-router "classify 5000 customer tickets into 4 categories"` → `mistral_classify` (full) + `ministral-3b-latest`; or `mistral_chat` (core) with `json_schema` if on default profile.
- `/mistral-mcp:mistral-router "review this PR for security issues"` → `/mistral-mcp:codestral-review` with `focus=security` (core).
- `/mistral-mcp:mistral-router "analyze this contract PDF for risky clauses"` → `/mistral-mcp:contract-analyzer` (core if URL, full if local file).
- `/mistral-mcp:mistral-router "extract invoice data from this PDF"` → `/mistral-mcp:pdf-invoice-extractor` (core if URL, full if local file).
- `/mistral-mcp:mistral-router "transcribe this meeting and assign action items per speaker"` → `/mistral-mcp:audio-dispatch` (core for transcription, full for optimized classification).
- `/mistral-mcp:mistral-router "run our contract approval workflow with human checkpoints"` → `/mistral-mcp:contract-review-workflow` (core — uses `workflow_execute` + `workflow_interact`).
- `/mistral-mcp:mistral-router "solve this optimization problem step by step"` → `magistral-medium-latest` via `mistral_chat` (core) with `reasoning_effort: "high"`.
