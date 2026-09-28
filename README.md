# mistral-mcp

Extract structured data from invoices, contracts and other documents through MCP.
`process_document` accepts existing plain text or Markdown for typed extraction,
or uses Mistral OCR for PDFs and images. It can also classify the document in the
same tool call. The default profile includes chat, vision, transcription and code
completion.

[Français](./README.fr.md) · [Migration guide](./MIGRATION.md) · [Examples](./examples/README.md) · [Deployment](./deploy/README.md)

**Source prerelease: `1.0.0-rc.1`, not yet published.** npm `latest` is `0.11.0`.
The instructions below use the local source build. **Breaking change:** `core`
now exposes six tools; existing orchestration clients must choose an explicit
profile. Document results add a required `extraction_source` field and nullable
OCR metadata. [Migration and rollback instructions](./MIGRATION.md).

## Quick start: an existing text or Markdown invoice

Requires Node.js 20+, npm, and a Mistral API key with chat access and quota.
The text route needs no Files upload or OCR call. From a checkout of the source
prerelease branch `codex/document-first-v1`, run at the repository root:

```bash
npm ci
npm run build
```

Set the key and chat model in your environment or in a local `.env` file:

```dotenv
MISTRAL_API_KEY=your_key_here
MISTRAL_DEFAULT_MODEL=ministral-3b-latest
```

The example loads `.env` with `dotenv`. Keep the key out of version control.
`ministral-3b-latest` was verified for this walkthrough on the test account;
choose a model with quota on your account. The default model may have no quota,
and this override does not guarantee access or free usage on other accounts.

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
exposing admin tools in `core`. **The known HTTP 429 / zero OCR quota blocker
remains unresolved.** The text route avoids OCR but does not resolve that blocker
or establish successful live OCR extraction for this prerelease.

Compare any extracted result against its source. The
[synthetic PDF](./test/fixtures/corpus/invoice-fr-table.pdf) and
[fixture ground truth](./test/fixtures/corpus.json) describe expected document
content, not captured live output. **Schema validation checks
the shape and types of the response; it does not verify factual accuracy, invoice
arithmetic, tax treatment or accounting correctness.** Review extracted fields
against the source before using them.

### Connect an MCP client to the source build

Use the client's stdio server configuration. For clients using `mcpServers` JSON:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "node",
      "args": ["/absolute/path/to/mistral-mcp/dist/index.js"],
      "env": {
        "MISTRAL_API_KEY": "your_key_here",
        "MISTRAL_DEFAULT_MODEL": "ministral-3b-latest",
        "MISTRAL_MCP_PROFILE": "core"
      }
    }
  }
}
```

Replace the path with your checkout's absolute path (forward slashes also work
on Windows). The server itself reads its environment; the example's `.env` loader
does not configure your MCP client.

To use the **published `0.11.0` release**, with its previous profile definitions:

```bash
npx -y mistral-mcp@0.11.0
```

That command does not run this prerelease or provide the new local invoice
example. Use the [migration guide](./MIGRATION.md) to pin an MCP configuration.

## Profiles

`MISTRAL_MCP_PROFILE` selects one of five profiles. The default is `core` for
Mistral Cloud; a custom `MISTRAL_BASE_URL` infers `self-hosted` unless you set a
profile explicitly.

| Profile | Tools | Scope in `1.0.0-rc.1` |
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

`node dist/index.js --doctor` reports the local profile and tool list without API
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

If you already use [Docling](https://github.com/docling-project/docling), it can
serve as an optional upstream local converter that produces Markdown. Pass that
Markdown as a text source. This repository provides no Docling integration,
dependency or automatic fallback. Local conversion does not make subsequent
chat classification or typed extraction local or free.

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
| [Claude Code plugin](./claude-plugin/README.md) | Optional plugin with 11 skills; its exact RC npm pin requires publication and does not run the local checkout |
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
