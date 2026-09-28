---
name: contract-analyzer
description: Extract contract parties, clauses, dates, and model-assessed risks using process_document. Use when the user supplies contract text, Markdown, or a PDF/image for analysis.
---

# Contract analysis

Use `process_document` in `core`, `metier-docs`, or `admin`. Check `mistral://capabilities` for the current endpoint and tool availability.

## Process the source

Prefer supplied contract text or Markdown:

```json
{
  "source": { "type": "text", "text": "<contract text or Markdown>" },
  "kind": "contract",
  "options": { "cache": "bypass" }
}
```

For a PDF or image requiring OCR, replace `source` with `{ "type": "url", "url": "https://example.com/contract.pdf" }` or `{ "type": "file_id", "fileId": "<existing Mistral file ID>" }`.

For local files, use an available converter to obtain text, or upload document bytes with `files_upload` in `admin`: `filename`, `content_base64`, `purpose: "ocr"`. Its `structuredContent.id` becomes `source.fileId`. Do not pass a filesystem path as a URL. If these routes are unavailable, request text or a provider-accessible source.

Text skips OCR and uploads, but contract extraction still sends text to the configured chat endpoint. OCR is optional and depends on account access and quota; no free-processing guarantee applies. The tool uses the configured chat default and has no `model` argument. Cache bypass affects the local extraction cache only; it does not establish provider retention or data residency.

## Review the extraction

Check `isError` before consuming `structuredContent`. The contract payload contains:

- `parties[]`: `name` and optional nullable `role`.
- `clauses[]`: `heading`, `text`, and optional nullable `risk` (`low`, `medium`, or `high`).
- `risk_score`: a nullable number from 0 to 1.
- `key_dates[]`: `label` and `iso`.
- `summary`: nullable text.
- `ocr_text`, `extraction_source`, `ocr_confidence`, and `page_count` for provenance. The last two are null for supplied text.

Present the summary, parties, dates, and clauses with their returned risk labels. Put high-risk clauses first, then medium, low, and unassessed clauses. Ground each concern in the clause text and the user's context. Treat `risk_score` as a model assessment, not a calibrated legal probability. Do not add a `critical` level, invented missing-protection fields, or categorical rules about enforceability.

Typed extraction accepts up to 60,000 UTF-16 code units. OCR selects the first 50 pages by default, adjustable with `options.maxPages` up to 200. State coverage limits, preserve clause context when splitting long documents, and do not present partial analysis as a complete review. An OCR confidence error requires a clearer source or reviewed text, not a silently weakened threshold.

For a requested French summary, retrieve the MCP prompt `french_legal_summary` with `legal_text` and `audience` (`juriste`, `dirigeant`, or `grand_public`). Convert each returned text message to `{role, content: message.content.text}` before calling `mistral_chat`; omit `model` to honor the server default. Keep extracted facts distinct from interpretation and carry through any missing information.
