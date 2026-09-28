# mistral-mcp 1.0.0 — Document extraction for AI agents

Turn invoices and documents into typed JSON through MCP. Supply existing text or
Markdown to use Mistral chat extraction without OCR, or use the Mistral OCR route
for PDFs and images when your account has access and quota.

## What changed

- The default `core` profile exposes six tools: `process_document`, `mistral_ocr`,
  `mistral_chat`, `mistral_vision`, `codestral_fim` and `voxtral_transcribe`.
- `process_document` accepts plain text and Markdown, enforces a 60,000-character
  input limit and returns typed invoice, contract, identity or generic results.
- Results declare `extraction_source`. Supplied text has null OCR confidence and
  page count; generated fields cannot replace provenance.
- The invoice example accepts UTF-8 `.txt`/`.md` directly and retains the PDF/image
  route with upload cleanup. It bypasses caching and never overwrites an output.
- Document output schemas, input descriptions, quota diagnostics, cache validation
  and synthetic invoice evaluation have been strengthened.
- English/French documentation leads with a reproducible Markdown invoice.
- The Claude Code plugin's 11 skills use the current tool parameters and profiles.
  Invoice and contract guides start with `process_document`.
- A repeatable bundle builder validates the MCPB and exports the actual tool
  catalog, with schemas and annotations, for distribution.

## Breaking changes and migration

The old core's 11 orchestration tools remain available through explicit profiles.
Set `MISTRAL_MCP_PROFILE=metier-docs` to preserve all former core tools (17 tools,
including document processing), `workflows` for orchestration, or `admin` for all
46 tools. Update result validators for the new provenance field and nullable OCR
metadata. See [MIGRATION.md](https://github.com/Swih/mistral-mcp/blob/v1.0.0/MIGRATION.md).

## Install

```bash
npx -y mistral-mcp@1.0.0
```

Configure `MISTRAL_API_KEY` in your MCP client. Select a chat model available to
your account with `MISTRAL_DEFAULT_MODEL`. The tested text invoice uses
`ministral-3b-latest`. Usage and quota depend on the provider account.

## Verification and limits

- 561 offline unit, contract and stdio/HTTP tests pass, including both MCP protocol
  eras. The installed npm package is smoke-tested against a local API stub.
- A real Mistral chat test and the end-user CLI extracted the synthetic Markdown
  invoice: vendor, total, currency, due date and three line items matched.
- This single synthetic case does not establish general extraction accuracy.
  Schema validation is not factual or accounting validation.
- **Live OCR remains blocked for the test account by HTTP 429 and an effective
  zero request quota.** Text ingestion avoids that endpoint; it does not fix the
  quota or validate the OCR path. No paid plan was activated.

The `.mcpb` asset bundles the stdio server and runtime dependencies. The Claude
Code plugin archive contains 11 skills and pins `mistral-mcp@1.0.0` from npm.
