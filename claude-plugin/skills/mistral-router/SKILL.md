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
| `magistral-medium-latest` / `magistral-small-latest` | Reasoning models with explicit `reasoning_content` | Medium / Low | Math, logic puzzles, problems where you want the chain-of-thought separated |
| `codestral-latest` | Code-specialist (FIM, generation, review) | Medium | Code review, commit messages, code generation, refactors |
| `devstral-latest` / `devstral-small-latest` | Agent-style coding models | Medium / Low | Multi-turn coding agents, autonomous code edits |
| `voxtral-small-latest` | Audio (transcription + understanding) | Low | Used by `voxtral_transcribe` only |

### Tools (MCP server `mistral`)

| Tool | Use for |
|---|---|
| `mistral_chat` | Standard chat completion. Default entry point. |
| `mistral_chat_stream` | Same but streamed — use for long outputs |
| `mistral_embed` | Embeddings (RAG, similarity, clustering) |
| `mistral_tool_call` | Function-calling agent loops (model picks tools from a catalog) |
| `codestral_fim` | Fill-in-the-middle code completion (editor autocomplete) |
| `mistral_vision` | Multimodal chat with images |
| `mistral_ocr` | Document AI: extract text + bbox + annotations from PDFs/images |
| `voxtral_transcribe` | Audio → text |
| `voxtral_speak` | Text → speech (TTS) |
| `mistral_agent` | High-level agent orchestration |
| `mistral_moderate` | Content moderation classifier |
| `mistral_classify` | Custom multi-label classifier |
| `files_*` / `batch_*` | File uploads + async batch jobs |

## Decision rules

1. **Code-related task?** → `codestral-latest` (or `codestral_fim` for autocomplete-style FIM).
2. **Reasoning / math / multi-step logic?** → `magistral-medium-latest` (you'll get `reasoning_content` separate from the answer).
3. **High-volume cheap classification?** → `ministral-3b-latest` via `mistral_classify` or `mistral_chat` with `response_format: json_schema`.
4. **PDF / scanned docs / receipts?** → `mistral_ocr` (with `document_annotation_format` for structured extraction).
5. **Image understanding?** → `mistral_vision`.
6. **Audio in?** → `voxtral_transcribe`. Audio out? → `voxtral_speak`.
7. **Need deterministic output structure?** → any chat tool with `response_format: { type: "json_schema", json_schema: {...} }`.
8. **Cost-sensitive batch job (>1000 calls)?** → `batch_create` with the cheapest model that meets quality.
9. **Default for free-form FR/EN writing** → `mistral-medium-latest` via `mistral_chat`.

## Output format

When invoked, respond in this exact shape:

```
Task: <one-line restatement of what the user wants>
Recommended: <tool> + <model>
Why: <one sentence>
Params:
  <key>: <value>
  ...
```

Then either invoke the tool with those params (if you have all the inputs), or ask the user for the missing input.

## Examples

- `/mistral-mcp:mistral-router "transcribe and summarize this 30min meeting"` → `voxtral_transcribe` + `mistral-medium-latest` via `french_meeting_minutes` prompt.
- `/mistral-mcp:mistral-router "classify 5000 customer tickets into 4 categories"` → `mistral_classify` + `ministral-3b-latest` (cost-optimized, batch via `batch_create` if >1k volume).
- `/mistral-mcp:mistral-router "review this PR for security issues"` → `codestral-latest` via `codestral_review` prompt with `focus=security`.
