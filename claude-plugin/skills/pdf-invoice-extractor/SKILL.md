---
description: OCR a PDF invoice with mistral_ocr and extract structured line-item data (vendor, date, amounts, VAT) for accounting reconciliation. Use when the user provides an invoice PDF to process.
---

# PDF invoice extractor

Extracts structured invoice data from PDFs for accounting reconciliation and ERP import. Uses `mistral_ocr` for document understanding, then `mistral_chat` with `json_schema` for strict field extraction.

**Profile requirements**:
- `mistral_ocr` + `mistral_chat` — available in **core** profile (default)
- `files_upload` (to upload a local PDF) — requires `MISTRAL_MCP_PROFILE=full`
- `batch_create` (for bulk invoice processing) — requires `MISTRAL_MCP_PROFILE=full`
- If the user provides a public URL, this skill runs entirely on the core profile

Works with French, English, and multi-language invoices. Handles scanned PDFs, digital PDFs, and receipts.

## Steps

### Step 1 — Get the invoice

Ask the user for one of:
- A public URL (direct link to the PDF or image) — works with core profile
- A local file path → upload with `files_upload` (requires `MISTRAL_MCP_PROFILE=full`), note the `file_id`

If the user has multiple invoices, offer to use `batch_create` (requires `full` profile) to process them concurrently.

### Step 2 — OCR the invoice

Call `mistral_ocr`:

```json
{
  "document": {
    "type": "document_url",
    "documentUrl": "<URL>"
  }
}
```

Use `"type": "document_id", "documentId": "<file_id>"` for uploaded files.

Concatenate `structuredContent.pages[*].markdown` for multi-page invoices.

### Step 3 — Extract invoice fields

Pass the OCR text to `mistral_chat` with `response_format: json_schema`:

```json
{
  "model": "mistral-small-latest",
  "temperature": 0,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "invoice",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "invoice_number": { "type": "string" },
          "vendor_name": { "type": "string" },
          "vendor_address": { "type": "string" },
          "vendor_vat_number": { "type": "string" },
          "client_name": { "type": "string" },
          "client_address": { "type": "string" },
          "issue_date": { "type": "string", "description": "ISO 8601 if determinable" },
          "due_date": { "type": "string" },
          "currency": { "type": "string", "description": "ISO 4217 code, e.g. EUR" },
          "line_items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "description": { "type": "string" },
                "quantity": { "type": "number" },
                "unit_price": { "type": "number" },
                "total": { "type": "number" }
              },
              "required": ["description", "total"]
            }
          },
          "subtotal_ht": { "type": "number" },
          "vat_rate": { "type": "number", "description": "As decimal, e.g. 0.20 for 20%" },
          "vat_amount": { "type": "number" },
          "total_ttc": { "type": "number" },
          "payment_terms": { "type": "string" },
          "iban": { "type": "string" },
          "payment_reference": { "type": "string" }
        },
        "required": ["vendor_name", "issue_date", "total_ttc", "line_items"]
      }
    }
  },
  "messages": [
    {
      "role": "user",
      "content": "<OCR text>\n\nExtract all invoice fields from the document above. Use null for fields not present in the invoice. Convert dates to ISO 8601 format when possible (YYYY-MM-DD). Do not invent values that are not in the document."
    }
  ]
}
```

### Step 4 — Validate and display

Check for mandatory fields. Flag any that are null or missing:

```
✅ EXTRACTED INVOICE
──────────────────────────────
Invoice #: [number]       Date: [date]
Vendor:    [name]         Due:  [date]
Currency:  [EUR/USD/...]  Total: [amount]

LINE ITEMS
──────────
[table: description | qty | unit price | total]

Subtotal (HT): [amount]
VAT [rate]%:   [amount]
TOTAL (TTC):   [amount]

⚠️  MISSING FIELDS: [list of null mandatory fields]
```

Offer to export as CSV, JSON, or to pass to `french_invoice_reminder` if the invoice is overdue.
