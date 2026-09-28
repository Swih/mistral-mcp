# Mistral MCP server for document extraction

[![npm version](https://img.shields.io/npm/v/mistral-mcp)](https://www.npmjs.com/package/mistral-mcp)
[![npm downloads](https://img.shields.io/npm/dm/mistral-mcp)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/mistral-mcp)](https://github.com/Swih/mistral-mcp/blob/main/LICENSE)

**Turn text or Markdown invoices into typed JSON through MCP.** `mistral-mcp`
uses Mistral chat to extract vendors, totals, line items and due dates, then
validates the response schema. Optional Mistral OCR handles PDF and image inputs.
`process_document` also supports contracts, identity documents and automatic
classification. Six tools are available by default, including chat, vision,
transcription and code completion.

[Français](./README.fr.md) · [Migration guide](./MIGRATION.md) · [Examples](./examples/README.md) · [Deployment](./deploy/README.md)

[npm package](https://www.npmjs.com/package/mistral-mcp) · [1.0.0 release notes](./CHANGELOG-v1.0.0.md) · [GitHub releases](https://github.com/Swih/mistral-mcp/releases) · [Mistral API docs](https://docs.mistral.ai/api/)

**Version 1.0.0 — breaking changes from 0.11.0:** `core` now exposes six tools;
existing orchestration clients must choose an explicit profile. Document results
require `extraction_source`, and `ocr_confidence` / `page_count` can be `null`.
[Migration and rollback instructions](./MIGRATION.md).

## Install in an MCP client

Requires Node.js 20+, npm and a Mistral API key with access and quota for the
requested model. For clients using `mcpServers` JSON, configure the stdio server:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "npx",
      "args": ["-y", "mistral-mcp@1.0.0"],
      "env": {
        "MISTRAL_API_KEY": "your_key_here",
        "MISTRAL_DEFAULT_MODEL": "ministral-3b-latest",
        "MISTRAL_MCP_PROFILE": "core"
      }
    }
  }
}
```

This runs `npx -y mistral-mcp@1.0.0`. Restart the client and refresh its tool
catalog. The server reads the environment supplied by the client; it does not
load `.env` automatically. Use your client's secret configuration for the key.
`ministral-3b-latest` was verified on the test account; model access and free
quota depend on your account. Check your [limits](https://console.mistral.ai/limits)
before making calls. Local MCP hosting still sends extraction requests to Mistral.

## Quick start: an existing text or Markdown invoice

The invoice script and fixtures are **source examples, not included in the npm
package**. Check out the release tag and build from the repository root:

```bash
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp
git checkout v1.0.0
npm ci
npm run build
```

Set the key and chat model in your environment or in a local `.env` file:

```dotenv
MISTRAL_API_KEY=your_key_here
MISTRAL_DEFAULT_MODEL=ministral-3b-latest
```

The example loads `.env` with `dotenv`. Keep the key out of version control.
Choose a chat model with quota on your account; the default may have zero quota.

```bash
npm run example:invoice -- test/fixtures/invoice-text.md --output invoice-result.json
```

This uses the [synthetic Markdown invoice](./test/fixtures/invoice-text.md).
For your own existing UTF-8 `.txt` or `.md` invoice, the command syntax is:

```text
node examples/invoice.mjs <local-file.txt|local-file.md> [--output result.json]
```

The script reads the text locally and calls `process_document` with
`source: { type: "text", text: "..." }`, `kind: "invoice"` and
`options.cache: "bypass"` through the local server's `core` profile. The text must
contain non-whitespace content and fit within 60,000 UTF-16 code units (JavaScript
string length). Markdown and whitespace are preserved unchanged. There is no
Files upload or OCR call; **invoice extraction sends the text to Mistral chat**.
The example uses Mistral Cloud only and still requires a key and chat quota;
processing is not entirely local or guaranteed free. Check your account's
[limits](https://console.mistral.ai/limits).

Without `--output`, it prints validated JSON; with it, it writes to a new file and
prints that path. Existing files are not overwritten. The output path is reserved
before API calls and may remain empty after failure; remove it or choose a new
path before retrying.

On 2026-09-28, the [live text test](./test/live/docs-text.test.ts) and the CLI
example succeeded with `ministral-3b-latest`, using chat only. The verified fields
were vendor `ACME SAS`, total `12960` EUR, due date `2026-09-11` and the quantities,
unit prices and amounts of all three invoice lines. This verifies one synthetic
invoice, not a general accuracy or reliability score.

For a PDF or image, the existing OCR route remains available:

```bash
npm run example:invoice -- test/fixtures/corpus/invoice-fr-table.pdf --output invoice-ocr-result.json
```

PDF, PNG, JPEG and WebP files up to 20 MiB require Files, OCR and chat access and
quota. The script uploads the file, calls `process_document` and attempts to
delete the upload in `finally`, including after extraction failure. There is no
separate OCR readiness probe. Upload and cleanup use the Files API without
exposing admin tools in `core`. **Known limitation:** the test account's HTTP 429
/ zero OCR quota blocked live OCR validation. The successful text run does not
validate OCR extraction.

Compare any extracted result against its source. The
[synthetic PDF](./test/fixtures/corpus/invoice-fr-table.pdf) and
[fixture ground truth](./test/fixtures/corpus.json) describe expected document
content, not captured live output. **Schema validation checks
the shape and types of the response; it does not verify factual accuracy, invoice
arithmetic, tax treatment or accounting correctness.** Review extracted fields
against the source before using them.

## Profiles

`MISTRAL_MCP_PROFILE` selects one of five profiles. The default is `core` for
Mistral Cloud; a custom `MISTRAL_BASE_URL` infers `self-hosted` unless you set a
profile explicitly.

| Profile | Tools | Scope in `1.0.0` |
|---|---:|---|
| `core` (default) | 6 | Documents, chat, vision, transcription and code completion |
| `metier-docs` | 17 | Preserved legacy profile: the six core tools plus all 11 orchestration tools; a superset of the old 16-tool core |
| `workflows` | 11 | Workflows, connectors and search-index discovery |
| `admin` | 46 | All tools implemented by this server, including Files, Batch, Conversations and Libraries |
| `self-hosted` | 5 | Chat, streaming chat, embeddings, function calling and vision on a compatible endpoint |

`full` remains a deprecated alias of `admin`, not a sixth profile. Set
`MISTRAL_MCP_PROFILE=metier-docs` to preserve the old core tool set after upgrading;
choose `workflows` for orchestration alone or `admin` for the complete tool set.
Restart the server and refresh tool discovery after changing profiles.

`npx -y mistral-mcp@1.0.0 --doctor` reports the local profile and tool list without API
calls. The `mistral://capabilities` resource reports the active endpoint, tool
families and reasons for omitted tools. Neither proves account access or quota.

## Core tools and document behavior

| Tool | Purpose |
|---|---|
| `process_document` | Supplied text/Markdown or OCR, optional classification and schema-validated extraction for invoices, contracts, identity documents or generic text |
| `mistral_ocr` | Raw OCR text, tables, annotations and optional blocks from PDFs or images |
| `mistral_vision` | Chat with images supplied by URL or base64 |
| `mistral_chat` | Chat completion, including structured response formats |
| `voxtral_transcribe` | Audio transcription with optional speaker diarization |
| `codestral_fim` | Fill-in-the-middle code completion |

`process_document` accepts `source: { type: "text", text: string }`, a document
URL, a base64 image or an uploaded file ID. Text may contain Markdown and is
preserved unchanged; blank or whitespace-only strings and strings above 60,000
UTF-16 code units are rejected for every `kind`, including `generic`.
`kind` is `auto` (default), `invoice`, `contract`, `id_document` or `generic`.
Successful calls return readable `content` and JSON `structuredContent`; failures
return `isError: true`.

For example, these are tool arguments using synthetic input, not a live result:

```json
{
  "source": {
    "type": "text",
    "text": "# Invoice DEMO-001\nVendor: Example Studio\nService: 2 hours at EUR 50\nTotal due: EUR 100\nDue date: 2026-10-15\n"
  },
  "kind": "invoice",
  "options": { "cache": "bypass" }
}
```

On a cache miss or with `cache: "bypass"`, `auto` calls chat to classify even a
text source; `invoice`, `contract` and `id_document` use chat for typed extraction.
Explicit `kind: "generic"` with a text source makes **no API calls** and returns
the supplied text as both `ocr_text` and `structured_text`.

Every successful result includes these fields:

| Field | Provided text / Markdown | Successful OCR source |
|---|---|---|
| `extraction_source` (required) | `"provided_text"` | `"mistral_ocr"` |
| `ocr_text` (name retained) | Original input text, unchanged | OCR text |
| `ocr_confidence` | `null` | Number from 0 to 1 |
| `page_count` | `null` | Number of processed pages |

- `options.maxPages` and `options.minOcrConfidence` apply only to OCR sources.
  They do not paginate or score supplied text. For OCR, missing, incomplete or
  invalid confidence scores cause an error, as do scores below the requested
  minimum. The default `0.3` is unmeasured; OCR confidence does not establish
  extraction accuracy.
- For OCR sources, `options.maxPages` defaults to 50 (maximum 200). Typed
  extraction rejects OCR text above 60,000 UTF-16 code units: split the document
  or use `generic` for OCR text. The text-source input limit still applies to
  `generic`. `options.languageHints` guides typed extraction, not the OCR model.
- `options.cache: "bypass"` skips cache reads and writes. Other modes are
  `read_only` and `read_write`. Identity documents bypass the cache by default,
  including after `auto` classification; explicit `read_write` opts them in.
- Cache files contain extracted content. `MISTRAL_MCP_CACHE_DIR` sets the location;
  `MISTRAL_MCP_CACHE_TTL_HOURS` defaults to 168 hours (`0` disables reuse and new
  writes). Cleanup is opportunistic during cache operations. Bypass does not
  erase older entries, and expiration does not guarantee deletion at a set time.
  Pipeline version `v1.0.0-text.1` invalidates reuse of older cache entries; it
  does not guarantee their immediate deletion.

The [synthetic corpus](./test/fixtures/corpus.json) separates required OCR text
from expected extracted invoice fields. `npm run eval:docs` evaluates these
separately through real API calls. Fixture truth is not a live accuracy result;
text-based synthetic PDFs do not establish accuracy on degraded scans.
[Development and evaluation guidance](./CONTRIBUTING.md).

## API and deployment references

`mistral://capabilities` describes the active tool set. `mistral://models` reads the
upstream catalog and reports fallback if the API call fails. `mistral://voices`
is available in `admin`; `mistral://workflows` is available in `metier-docs`,
`workflows` and `admin`. Catalog presence does not establish access or quota.

You can host the MCP process and configure its upstream endpoint, credentials,
tool exposure and cache policy. By default, requests go to Mistral Cloud: local
MCP hosting does not make document inference local. These controls alone do not
establish data residency or regulatory compliance.

A custom `MISTRAL_BASE_URL` infers `self-hosted`: chat, streaming chat, embeddings,
function calling and vision, subject to endpoint/model support. It does not
include OCR or `process_document`. An explicit profile overrides inference but
does not add missing APIs to a backend.

| Reference | Contents |
|---|---|
| [Migration](./MIGRATION.md) | Removed core tools, explicit profiles, pinned `0.11.0` fallback |
| [Examples](./examples/README.md) | Local invoices, transcription and library-backed conversations |
| [Tool families](./src/profile.ts) and MCP tool input schemas | Complete tool membership and argument reference |
| [Prompts](./src/prompts.ts) | Meeting minutes, email replies, commits, legal summaries, invoice reminders and code review |
| [Deployment](./deploy/README.md) and [.env.example](./.env.example) | Docker, Compose, Kubernetes, custom endpoints, cache and HTTP settings |
| [Public connector guide](./deploy/connector-public.md) | HTTPS deployment; public connector calls are not established as end-to-end validated here |
| [Claude Code plugin](./claude-plugin/README.md) | Optional plugin with 11 skills, pinned to `mistral-mcp@1.0.0` |
| [Contributing](./CONTRIBUTING.md) | Build, tests, evaluation and release checks |
| [Changelog](./CHANGELOG.md) and [security policy](./SECURITY.md) | Changes and security reporting |

stdio is the default transport. `--http` or `MCP_TRANSPORT=http` enables
Streamable HTTP at `127.0.0.1:3333/mcp` by default, with configurable bearer
authentication and allowed origins. Integrated OAuth is not provided.
Tool audit records go to stderr and omit arguments and result payloads;
`MISTRAL_MCP_AUDIT=off` disables them.

The [protocol-era tests](./test/stdio/protocol-eras.test.ts) cover MCP 2026-07-28
and the 2025 handshake using the same registrations. `npm run check:release`
checks the build and local tests, including the installed package against an API
stub. Live API validation is separate; skipped tests do not count as success.
Package pinning does not guarantee future upstream availability or compatibility.

[MIT license](./LICENSE) — Copyright Dayan Decamp.
