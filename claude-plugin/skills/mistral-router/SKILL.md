---
name: mistral-router
description: Choose an available Mistral tool and model for document extraction, chat, code, vision, audio, or deployed workflows. Use when the user asks which Mistral capability fits a task or needs help routing it.
---

# Mistral router

Read `mistral://capabilities` to identify the active profile, endpoint, and registered tools. Inspect the selected tool's input schema before calling it. Tool arguments mix snake_case and camelCase; preserve their exact spelling.

The default Mistral Cloud profile, `core`, exposes **six tools**:

| Task | Tool | Input shape |
|---|---|---|
| Invoice or contract extraction | `process_document` | `source`, explicit `kind`, `options` |
| Text generation, summaries, code review | `mistral_chat` | `messages: [{role, content: "text"}]` |
| Image understanding | `mistral_vision` | `messages` with text and image parts |
| Raw PDF or image OCR | `mistral_ocr` | `document` |
| Code insertion between known boundaries | `codestral_fim` | `prompt`, `suffix` |
| Audio transcription | `voxtral_transcribe` | `audio` |

For invoices and contracts, prefer `process_document` with supplied text or Markdown:

```json
{
  "source": { "type": "text", "text": "<document text or Markdown>" },
  "kind": "invoice",
  "options": { "cache": "bypass" }
}
```

Use `kind: "contract"` for contracts. OCR sources are `{ "type": "url", "url": "https://example.com/document.pdf" }` or `{ "type": "file_id", "fileId": "<existing upload ID>" }`. Text skips OCR and upload; typed extraction still calls chat. OCR depends on endpoint support and account quota. Do not promise free processing. Use the `pdf-invoice-extractor` or `contract-analyzer` skill for result interpretation.

Other common shapes:

- Raw OCR: `document: {type: "document_url", documentUrl: "https://..."}` or `document: {type: "file", fileId: "..."}`.
- Vision: a user message whose `content` contains `{type: "text", text: "..."}` and `{type: "image_url", imageUrl: "https://..."}`.
- Audio: `audio: {type: "file_url", fileUrl: "https://..."}` or `audio: {type: "file", fileId: "..."}`. See `audio-dispatch` for speaker attribution.
- Structured chat: `response_format: {type: "json_schema", json_schema: {name: "result", schema: {...}, strict: true}}`. The generated JSON is in `structuredContent.text`; parse and validate it before use.

## Profiles and model selection

| Profile | Available surface |
|---|---|
| `core` | The six tools above |
| `metier-docs` | Core plus workflows, connectors, and RAG deployment discovery |
| `workflows` | Workflows, connectors, and RAG deployment discovery |
| `admin` | All registered API tool families, including files, batches, classification, speech synthesis, conversations, and libraries |
| `self-hosted` | Chat, aggregated streaming chat, embeddings, function calling, and vision; actual endpoint support still matters |

`MISTRAL_MCP_PROFILE` selects the profile. `full` is a deprecated alias for `admin`; use `admin` in new configuration. A custom `MISTRAL_BASE_URL` selects `self-hosted` unless a profile is explicitly configured. A profile exposes tools; it does not add capabilities to the endpoint.

Omit `model` on `mistral_chat` unless an override is needed: this honors `MISTRAL_DEFAULT_MODEL` and the server fallback. `process_document` uses that configured chat default internally and has no `model` argument. Other tools have their own defaults.

For an override, read `mistral://models` and use the endpoint's `live.ids`. The `accepted` catalog is guidance, not proof of availability. If `fallback` is true, model availability was not verified. The resource does not provide prices or guarantee task compatibility; do not invent a cost table or infer capabilities from a model name.

Custom labels can be requested through `mistral_chat`. `mistral_classify` requires `admin`, a supported classifier `model`, and `inputs`; it has no `labels` argument.

## Deployed workflows

Workflow tools require `workflows`, `metier-docs`, or `admin`. Read `mistral://workflows`, then call `workflow_deployments_list` to check for live workers before `workflow_execute`. Obtain the chosen workflow's input and handler contracts from its documentation or owner; discovery does not supply them. Contract, compliance, and research workflow skills orchestrate existing deployments and do not install those capabilities.

State the chosen tool, required profile, and any explicit model override in one sentence. Execute when the request and inputs permit it; ask only for missing information. Check `isError` before using `structuredContent`, and report an unavailable tool or endpoint instead of claiming success.
