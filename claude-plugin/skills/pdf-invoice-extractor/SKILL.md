---
name: pdf-invoice-extractor
description: Extract typed invoice data from supplied text, Markdown, or a PDF/image through process_document. Use for invoice totals, line items, due dates, and extraction anomalies.
---

# Invoice extraction

Use `process_document`, available in `core`, `metier-docs`, and `admin`. Check `mistral://capabilities` if it is unavailable. Prefer existing text or Markdown; request OCR only when the document still needs it.

## Process the source

Call `process_document` with an explicit invoice kind and local cache bypass:

```json
{
  "source": { "type": "text", "text": "<invoice text or Markdown>" },
  "kind": "invoice",
  "options": { "cache": "bypass" }
}
```

For OCR, replace `source` with one of:

- `{ "type": "url", "url": "https://example.com/invoice.pdf" }` for a provider-accessible PDF or image.
- `{ "type": "file_id", "fileId": "<existing Mistral file ID>" }` for an uploaded document.

A local path is not a source URL. If a local converter is available, use its extracted text. Otherwise `files_upload` requires `admin` and accepts `filename`, `content_base64` containing the file bytes, and `purpose: "ocr"`. Use its `structuredContent.id` as `source.fileId`. If neither route is available, request text, an accessible URL, or an existing upload ID.

Text input skips OCR and the Files API; invoice extraction still sends text to the configured chat endpoint. OCR requires account access and quota, and processing is not guaranteed to be free. Omit model selection: this tool uses the configured chat default internally. `options.cache: "bypass"` prevents this call from reading or writing the local extraction cache; it is not a provider retention setting.

## Interpret the result

Check `isError` first. On success, use `structuredContent` with `kind: "invoice"`:

| Field | Meaning |
|---|---|
| `vendor.name`, optional nullable `vendor.tax_id` | Extracted vendor identity |
| `total`, `currency` | Nullable total and three-character currency code |
| `line_items[]` | `desc`, `qty`, `unit_price`, `amount` |
| `due_date` | Nullable due date |
| `anomalies[]` | Reported extraction anomalies |
| `ocr_text`, `extraction_source` | Text used and whether it came from `provided_text` or `mistral_ocr` |
| `ocr_confidence`, `page_count` | Both null for supplied text; OCR metadata otherwise |

Present the total, currency, vendor, due date, line-item table, and anomalies. Preserve nulls as unknown. Check the reported amounts against the source; schema validation does not establish accounting accuracy. Distinguish discrepancies you find from the tool's `anomalies`.

Typed extraction is limited to 60,000 UTF-16 code units. OCR processes the first 50 pages by default; `options.maxPages` may select up to 200. State the selection and do not claim a complete invoice when pages or text are missing. Do not add totals across overlapping extracts.

`ocr_confidence` measures OCR, not field accuracy. If confidence is missing or below the requested floor, report the error and obtain a clearer source or reviewed text; do not silently lower the threshold. For several invoices, process and identify each separately. Export only the returned fields and explicitly identified derived checks when requested.
