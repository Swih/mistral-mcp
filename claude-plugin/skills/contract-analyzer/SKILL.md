---
description: OCR a contract PDF with mistral_ocr, then extract structured clauses and risk scores with mistral_chat + json_schema. Use when the user provides a contract document to analyze for risks, obligations, and key terms.
---

# Contract analyzer

Extracts and risk-rates contract clauses from a PDF or scanned document using Mistral's native document AI. No third-party OCR dependency.

**Profile requirements**:
- `mistral_ocr` + `mistral_chat` — available in **core** profile (default)
- `files_upload` (to upload a local PDF) — requires `MISTRAL_MCP_PROFILE=full`
- If the user provides a public URL, this skill runs entirely on the core profile

**EU data residency**: both `mistral_ocr` and `mistral_chat` stay within Mistral's EU infrastructure when the API key is an EU-region key.

## Steps

### Step 1 — Get the document

Ask the user for one of:
- A public URL (direct link to the PDF) — works with core profile
- A local file path → upload with `files_upload` (requires `MISTRAL_MCP_PROFILE=full`), note the returned `file_id`

### Step 2 — OCR the contract

Call `mistral_ocr` with `document_annotation_format: "markdown"` for structured extraction:

```json
{
  "document": {
    "type": "document_url",
    "documentUrl": "<URL from step 1>"
  },
  "document_annotation_format": "markdown"
}
```

If using a file upload: `"type": "document_id", "documentId": "<file_id>"` instead.

Concatenate `structuredContent.pages[*].markdown` across all pages.

### Step 3 — Extract structured clauses

Pass the concatenated OCR text to `mistral_chat` with `mistral-large-latest` and a `json_schema` response format:

```json
{
  "model": "mistral-large-latest",
  "temperature": 0,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "contract_analysis",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "parties": { "type": "array", "items": { "type": "string" } },
          "effective_date": { "type": "string" },
          "duration": { "type": "string" },
          "governing_law": { "type": "string" },
          "clauses": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "title": { "type": "string" },
                "summary": { "type": "string" },
                "risk_level": {
                  "type": "string",
                  "enum": ["low", "medium", "high", "critical"]
                },
                "risk_reason": { "type": "string" }
              },
              "required": ["title", "summary", "risk_level", "risk_reason"]
            }
          },
          "overall_risk": {
            "type": "string",
            "enum": ["low", "medium", "high", "critical"]
          },
          "missing_protections": {
            "type": "array",
            "items": { "type": "string" }
          }
        },
        "required": ["parties", "clauses", "overall_risk"]
      }
    }
  },
  "messages": [
    {
      "role": "user",
      "content": "<OCR text>\n\nExtract all clauses from the contract above. For each clause, provide a title, one-sentence summary, and risk level (low/medium/high/critical) with the reason. Apply these risk escalation rules: termination-for-convenience → at least medium; unlimited liability → critical; IP assignment to other party → high; non-compete > 12 months → high; automatic renewal without notice → medium; governing law in foreign jurisdiction → medium."
    }
  ]
}
```

### Step 4 — Display results

Present clauses sorted by risk level (critical → high → medium → low).

Show a summary box for critical and high-risk clauses:

```
⚠️  HIGH / CRITICAL CLAUSES
──────────────────────────────
[clause title] — [one-line risk reason]
...

FULL ANALYSIS
─────────────
[table or list of all clauses with risk level]

OVERALL RISK: [level]
MISSING PROTECTIONS: [list if any]
```

Offer to pass the full JSON to `mistral_chat` for negotiation suggestions, or to `french_legal_summary` for a plain-language summary.
