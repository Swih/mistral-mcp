# Changelog

All notable changes to `mistral-mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The source version is `1.0.0-rc.1`; npm `latest` remains `0.11.0` until a separate release.

### Changed

- **Breaking:** the default `core` profile now exposes six tools: `process_document`,
  `mistral_ocr`, `mistral_chat`, `mistral_vision`, `codestral_fim` and `voxtral_transcribe`.
  Workflows, connectors and RAG index discovery require an explicit profile.
  `metier-docs` preserves its 17-tool surface, including every former core tool;
  `workflows` and `admin` remain unchanged. See [MIGRATION.md](MIGRATION.md).
- Document processing is the primary README walkthrough, with a local invoice
  example led by existing plain text or Markdown, and explicit separation between
  schema validation and extraction accuracy. English/French guides describe
  Docling only as an optional upstream local converter producing Markdown, with
  no integration, dependency or automatic fallback.
- **Breaking:** every successful `process_document` result includes the required
  `extraction_source` field (`provided_text` or `mistral_ocr`). `ocr_confidence` and
  `page_count` are `null` for supplied text and remain numeric for successful OCR.
  `ocr_text` retains its name and holds the unchanged input for text sources.
  `options.maxPages` and `options.minOcrConfidence` apply only to OCR sources.
- Pipeline version `v1.0.0-text.1` prevents reuse of older cache entries after the
  result-contract change; it does not guarantee immediate deletion of old files.
- The evaluation harness checks synthetic invoice field values separately from
  OCR text retention. Reports identify checks that have not been measured.

### Added

- `process_document` accepts `source: { type: "text", text: string }` for existing
  plain text or Markdown, preserved unchanged. Blank/whitespace-only strings and
  inputs above 60,000 UTF-16 code units are rejected for every kind. Text with
  explicit `kind: "generic"` makes no API calls; `auto` still uses chat for
  classification and typed kinds use chat for extraction on a cache miss or bypass.
- `npm run example:invoice -- <file> [--output result.json]` reads local `.txt` or
  `.md` invoices without Files upload, deletion or OCR calls. It still requires a
  Mistral API key and chat quota for invoice extraction. The PDF/image route
  uploads the file and attempts deletion on success or failure. Both routes use
  MCP, bypass the document cache and never overwrite existing output files.
- Synthetic Markdown invoice [fixture](./test/fixtures/invoice-text.md) and a
  [chat-only live extraction test](./test/live/docs-text.test.ts). On
  2026-09-28, that test and the full CLI example passed with
  `MISTRAL_DEFAULT_MODEL=ministral-3b-latest`: vendor `ACME SAS`, total `12960` EUR,
  due date `2026-09-11` and quantities, unit prices and amounts for all three lines
  were verified without Files or OCR calls. The walkthrough sets this tested
  model explicitly; users still need a model with quota on their own account.
  This is one synthetic invoice result, not an accuracy or reliability score.
- Built-binary tests for all five profiles, default-profile migration and
  capability/resource consistency. Document contract tests cover all four kinds.

### Fixed

- Document output schemas expose nested invoice, contract and identity fields
  rather than untyped JSON. Generated fields cannot overwrite source provenance.
- Typed extraction rejects text beyond its 60,000-UTF-16-code-unit limit instead
  of silently dropping the rest. `kind=generic` remains available for longer OCR
  text; supplied text keeps its input limit for every kind.
- README and migration instructions no longer claim a separate OCR readiness
  probe in the invoice example. The PDF/image route retries only the recognized
  file-not-ready tool error; successful calls need no extra OCR probe.
- Language hints are described, applied during extraction and included in cache
  identity. Core input parameters now include usage descriptions.
- API errors distinguish authentication, quota and provider failures without
  copying provider HTTP bodies into tool results.

### Known limitations

- Live OCR and OCR-based extraction accuracy remain unverified for this candidate while the
  CI account's effective OCR request quota is zero (HTTP 429). The text route
  avoids OCR but does not resolve that blocker or make chat processing local or
  free. No paid plan was activated.
  Offline checks do not establish provider availability or extraction accuracy.

## [0.11.0] - 2026-09-28

### Known limitations

- Live OCR validation remains blocked for the CI account: an isolated one-page
  request returns HTTP 429 with an effective limit of zero requests per minute.
  Document extraction has not been revalidated against the provider for this
  release. Other account access depends on Mistral's availability and quotas.
  Offline tests and Node 20/22/24 CI pass; this release does not claim a green
  complete live suite. No paid plan is required by the server itself, but free
  provider access is not guaranteed.

### Fixed

- Document cache keys include page limits, models and endpoint; cached payloads
  are schema-validated and checked against the current quality floor. Old cache
  entries are invalidated. Missing or partial OCR confidence returns a tool error
  instead of a fabricated score of 1.
- Function-calling history preserves assistant calls and maps tool result IDs
  to the SDK. Conversation and library text fallbacks include usable results;
  conversations preserve JSON content blocks and file/source references.
- Live tests explicitly report missing account resources as skipped; workflow
  discovery no longer hides unexpected API failures. CI retains a JSON report.
- README coverage claims and profile counts match the implemented surface.
- Stdio protocol checks no longer load `.env` and trigger inference implicitly.
  Real stdio calls run in the live suite and respect the configured chat model.
- Live document fixtures verify OCR readability after upload, with three bounded
  retries only for `422 invalid_file / 1901 / Could not get file.` responses.
  Persistent errors still fail; this adds one OCR page per fixture.

### Added

- Read-only `agents_list` and `agents_get` for modern agents, available in `admin`.
  The legacy completion tool is retained and marked as deprecated in its description.
- `--doctor` prints local configuration without API requests or entitlement claims.
- Current reasoning effort values for chat, streaming chat and function calling.
- Release checks install the packed npm artifact in a temporary directory, verify
  its contents and catalogs, and exercise inference against a local stub.
- Local-file upload example and three explicit live example routes. No billing
  configuration changes or automatic provider probes are performed.
- Manual isolated OCR diagnostic in GitHub Actions, without retries.

## [0.10.1] - 2026-09-15

### Changed

- Live API tests use the existing `MISTRAL_DEFAULT_MODEL` override, set to
  `ministral-3b-latest` in the scheduled workflow. The CI organization reports
  a zero request-per-minute limit for Small and Medium while Ministral 3B is
  available, so the suite now exercises Chat, forced tool calls, JSON Schema,
  and document extraction against a model the account can actually call.

### Fixed

- `process_document` structured extraction now honours
  `MISTRAL_DEFAULT_MODEL`; classification already used Ministral 3B, but
  extraction was hard-coded to `mistral-medium-latest`. This made the documented
  override incomplete and caused all typed document flows to fail on accounts
  where Medium has no quota.
- Vitest allows 45 seconds per test instead of racing the SDK's 30-second retry
  budget. API failures such as 429 now surface with their real cause, and live
  document assertions include the tool error content in CI annotations.
- Release metadata and the supported-version table are aligned on 0.10.1. The
  obsolete claim that Free mode provides roughly one billion tokens per month
  is replaced with the current model-specific limits wording.

### Notes

- 0.10.0 was released on GitHub but not published to npm. The npm package moves
  directly from 0.8.2 to 0.10.1.

## [0.10.0] - 2026-08-28

Two things: the server moves to the current protocol revision without asking a
single client to move with it, and it can run entirely against your own
OpenAI-compatible endpoint.

### Added

- **Workflow operations: `workflow_deployments_list`, `workflow_runs_list`, `workflow_stop`.** The first live run against a real account exposed the gap: `hello-world` was listed by `mistral://workflows`, `workflow_execute` answered `404 No active deployment found`, and nothing in the tool surface let an agent see that coming. A workflow returned by `getWorkflows` is a *definition*; running it needs a deployment with at least one live worker, which is a separate object with separate state. `workflow_deployments_list` reports it — `is_active`, `worker_count`, `active_worker_count`, `is_hardened`, managed vs self-hosted — and computes `runnable_count`, the one field an agent has to read before it executes anything; when it is zero the summary says so in words rather than returning an empty list. `workflow_runs_list` finds executions (filterable by workflow, status or deployment) so an agent can obtain an `execution_id` without having started the run itself, and `workflow_stop` ends one: `cancel` by default, which lets the workflow run its cleanup handlers, and `terminate` only on request, which does not — hence `destructiveHint: true`. Together they close the operations loop the three original tools left open: what can run, what is running, and how to stop it. A live test asserts the two halves agree, executing a listed workflow when `runnable_count` is zero and requiring the deployment error.

- **MCP 2026-07-28, with the 2025-era handshake served alongside it.** Built on `@modelcontextprotocol/server` 2.x: `serveStdio(factory, { legacy: "serve" })` and `createMcpHandler(factory, { legacy: "stateless" })` both take one factory and decide the era from the opening exchange, so the same registrations answer a 2026-07-28 client and a 2025-era one. That second half is the point — practically every client shipping today (Claude Code, Cursor, Zed, Windsurf, Claude Desktop) still opens with `initialize`, and upgrading this server must not ask them to upgrade too. `test/stdio/protocol-eras.test.ts` drives the built binary with a real 1.30.x client and a real pinned-2026 client and asserts both see an identical tool set; `@modelcontextprotocol/sdk` stays as a devDependency for exactly that purpose.
- **Cache hints (`ttlMs` / `cacheScope`, SEP-2549).** The catalogue is fixed at boot by the profile, so `tools/list`, `prompts/list`, `resources/list` and `server/discover` are advertised as `public` for 5 minutes. Resource reads carry their own: `mistral://capabilities` `public`/5 min (it is a projection of the process config), `mistral://models` and `mistral://voices` `private`/5 min (entitlements are per-key, and each read is a live API call), `mistral://workflows` `private`/30 s (the account holder deploys and retires those). The default for anything unhinted stays the conservative `ttlMs: 0, cacheScope: "private"`. 2025-era responses are untouched — the revision has no cache fields.
- **Trace propagation and an audit trail** (`src/observability.ts`). `traceparent` / `tracestate` / `baggage` arrive in an MCP request's `_meta` and are stamped onto every outgoing call to Mistral (or to your own endpoint) through a `beforeRequest` hook on the SDK's HTTP client, with the context held in an `AsyncLocalStorage` for the life of the handler — so a customer's collector joins the MCP span to the inference span it caused, and no tool handler has to know any of this exists. Alongside it, one JSON line per tool call on stderr: tool, outcome, duration, trace and span ids. **Never a payload** — no prompts, documents, transcripts, arguments or model output, asserted as a negative against the built binary in `test/stdio/observability.test.ts`. On by default (`MISTRAL_MCP_AUDIT=off` silences it): an audit trail an operator has to discover is one they will not have when they need it, and MCP's own `logging` capability is deprecated in 2026-07-28 in favour of exactly this. Zero new dependencies — `node:async_hooks` is core and the traceparent grammar is 55 characters of hex parsed here.
- **`test/stdio/http-transport.test.ts`** — the Streamable HTTP path over a real socket: `/healthz`, 401 unauthenticated, 401 on a wrong token, 404 on an unknown path, and both protocol eras against the same endpoint.
- **`MISTRAL_BASE_URL`** — point the server at any OpenAI-compatible endpoint (vLLM, TGI, LiteLLM, an internal token factory) and every request goes there instead of `api.mistral.ai`. Wired to the Mistral SDK's `serverURL`. Validated at boot: absolute http(s) only, trailing slashes stripped, and `https://api.mistral.ai` recognised as *not* custom so the default path is unchanged.
- **`self-hosted` profile** — inferred automatically from a custom `MISTRAL_BASE_URL`, and registering only the five families such an endpoint actually serves: `mistral_chat`, `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call`, `mistral_vision`. OCR, Voxtral, Files, Batch, Agents, Conversations, Libraries and Workflows are Mistral-platform endpoints — advertising them in front of vLLM only produces 404s the calling model has to guess its way out of. An explicit `MISTRAL_MCP_PROFILE` always wins over the inference, for gateways that do proxy the full API.
- **`mistral://capabilities` resource** — the active profile, whether it was inferred, the endpoint and its kind (`mistral` / `custom`), the list of registered tools, and for every tool family whether it is available plus a one-line reason when it is not. An agent can now discover *why* a tool is missing instead of calling it to find out.
- **`rag_indexes_list`** — lists the search-index deployments on the account (backend, status, per-index document counts, ISO timestamps). Read-only, `core` profile. Deliberately not a retrieval tool: Mistral's Agentic Search ships its own MCP server, and reimplementing hybrid retrieval here would duplicate it badly. Register/unregister stay out for the same reason `connectors_*` and `libraries_*` writes do — they are deploy-pipeline operations, not agent-loop operations.
- **A document ingestion corpus and evaluation harness.** `npm run fixtures:generate` rebuilds eight synthetic PDFs from readable source; `npm run eval:docs` scores them against real OCR and reports, per document, whether `kind: "auto"` classified correctly, whether the required fields survived, and the OCR confidence. The corpus is chosen for what breaks ingestion rather than what flatters it: a `/Rotate 90` landscape scan, ruled line-item tables, side-by-side address columns, a blank page mid-document, mixed FR/EN, accents and the euro sign, and one near-empty page. Ground truth lives in `test/fixtures/corpus.json` and is checked against the bytes on disk without a key, so a manifest that drifts from the PDFs fails the build instead of quietly invalidating every eval result. All content is invented — no real PII, by design, because a corpus is only useful if it can be published.
- **On-prem deployment deliverables** — `deploy/docker-compose.yml` (bearer token required, loopback-only publish, read-only rootfs, all capabilities dropped, healthcheck; optional `vllm` profile for local inference) and `deploy/k8s/mistral-mcp.yaml` (ConfigMap, Service, Deployment with `runAsNonRoot`/`readOnlyRootFilesystem`/`seccompProfile: RuntimeDefault`, default-deny NetworkPolicy, PodDisruptionBudget). Plain manifests, no Helm chart: the delivery model is files the customer can read, diff and apply. `deploy/README.md` documents both plus the full environment reference.
- **`test/stdio/self-hosted.test.ts`** — spins up a real OpenAI-compatible HTTP server, spawns the built binary against it, and asserts the profile inference, the 5-tool catalogue, the absent Mistral-only resources, and a real `mistral_chat` call landing on the fake endpoint with a non-Mistral model id. No key, no egress, runs on every push.

### Changed

- **A thesis line instead of a feature list.** The npm description and both README taglines enumerated ten capabilities, which reads as a server that has wandered. They now lead with what the ten have in common — *Mistral, wherever you run it* / *Mistral, où que vous le fassiez tourner* — and keep the enumeration behind it for discovery. The scope rule that follows from it: a feature that only makes sense when the model is not Mistral does not belong here.

- **One retry policy for the whole repo** (`MISTRAL_RETRY_CONFIG` / `MISTRAL_TIMEOUT_MS` in `src/shared.ts`). Three had drifted apart: `src/index.ts` carried the full backoff policy, five live tests carried `{ strategy, retryConnectionErrors }` without any backoff parameters, and `test/live/mistral.test.ts` carried none at all. So the suite whose entire job is to prove the wrapper survives the real API was the only code the policy did not cover, and the first `503 Service temporarily unavailable` failed the run outright — even though the SDK lists 503 in its `retryCodes` and the production client would have absorbed it. Every client now reads the same constant.
- **The document classifier decides on what a document is, not how it is laid out.** The first prompt listed categories without criteria, and a technical dossier with numbered annexes and a "Procédure de recette" was filed as `contract`: numbered articles and annexes are as common in technical documentation as in agreements. `contract` now requires named parties and mutual obligations, `generic` explicitly names technical dossiers, specifications and procedures, and the tie-break says to choose `generic` when both are not present. Measured, not assumed: the corpus went from 7/8 to 8/8 correctly classified against real OCR.

- **`minOcrConfidence`'s default no longer claims to be empirical.** It shipped as `0.3` with a comment calling it "empirical — tune via eval", and nothing had ever measured it. A threshold nobody can reproduce is folklore, and the first customer to hit a false reject has no way to argue with it. The value is unchanged (0.3 is a defensible conservative floor), but it is now described as a starting point, and `npm run eval:docs` derives a justified number from an actual run: the midpoint between the worst cleanly-extracted document and the best low-signal one. When those populations overlap the harness reports that no threshold is defensible rather than inventing one.
- **`@modelcontextprotocol/sdk` 1.30.0 → `@modelcontextprotocol/server` 2.0.0** (runtime), with the v1 SDK retained as a devDependency for the compatibility test. `@modelcontextprotocol/node` was deliberately not taken: it exists to bridge web-standard `Request`/`Response` into `node:http` and pulls `@hono/node-server` to do it, while Node 20 has `Request`, `Response` and `Readable.toWeb` natively — the bridge is forty lines in `src/transport.ts` and the runtime dependency budget stays at three.
- **zod 3 → 4** (the v2 SDK's floor is 4.2.0; `@mistralai/mistralai` accepts `^3.25 || ^4`). One real breaking change in this repo: `.default()` now applies to the *output* type, so `process_document`'s `options` object — whose inner fields carry their own defaults — became `.prefault({})`, which is the zod 4 spelling of the old semantics. Two unit tests that asserted zod's exact size-error prose now assert the rejection and the offending field instead.
- **Model identifiers are no longer validated against a closed `z.enum`.** They are now non-empty strings whose `.describe()` carries the known Mistral aliases and points at `mistral://models`. This is the same failure class as the `ConfidenceScoresGranularity` enum fixed in 0.9.1: a client-side allow-list rejects valid identifiers before the API can answer, goes stale on every Mistral release, and made `MISTRAL_BASE_URL` unusable (`my-org/mistral-small-3.2` is a normal answer, not an error). Empty strings are still rejected; the endpoint remains the authority on what it serves.
- **Profile gating is table-driven** (`TOOL_FAMILIES` in `src/profile.ts`). The rules had been duplicated across `index.ts`, four `tools-*.ts` modules and `resources.ts`, which is how 0.8.0 leaked `codestral_fim` and `voxtral_transcribe` into the `workflows` profile. A third instance of the same class is fixed here: `resources.ts` accepted a `profile` argument it never read, so `mistral://voices` and `mistral://workflows` were advertised under every profile. Unit tests now assert the table's invariants directly.
- Docker image `node:20-alpine → node:22-alpine`, runs as `USER node`, npm cache cleaned, cache directory created and owned so a read-only root filesystem works.
- `engines.node` `>=18 → >=20`. Node 18 reached end-of-life on 2025-04-30 and CI has only tested 20 and 22 for several releases.
- `OCR_MODELS` gains `mistral-ocr-4-1` and `mistral-ocr-4-0` as documented aliases.

### Fixed

- **The document cache never expired.** `stored_at` was written on every entry and never read back, so the only invalidation was a `PIPELINE_VERSION` bump: extracted content — a contract's parties and clauses, an invoice's line items — stayed on disk in plaintext indefinitely. It is personal data, and a server sold on European compliance cannot hold it without a retention rule. Entries now carry a window (`MISTRAL_MCP_CACHE_TTL_HOURS`, default 168 h, `0` to disable reuse entirely) and are **deleted** past it, on read and by a sweep, so the content stops existing rather than merely stops being served. The sweep advances a cursor one shard per write on top of the shard just written: read-time expiry alone only reaches entries somebody asks for again, which would have left a document processed once and never revisited on disk forever. An entry with no usable `stored_at` — anything written before this existed — is treated as expired.

- **`npm run eval:docs` could not have worked.** Two defects that only surfaced the first time it ran with a key: it never loaded `.env` (every live test does), so it reported a missing key on a machine where every other live target worked; and it sent `source: { type: "file" }` where the schema's discriminated union declares `"file_id"`, so every document would have failed input validation. The harness had been written, committed and documented without ever being executed.
- **The threshold calibration accepted a separation that was noise.** On the first real run every document scored between 0.950 and 0.985 — the deliberately low-signal one included — and the midpoint rule proposed `minOcrConfidence: 0.95`, a value that would reject essentially every genuine scan. The overlap guard missed it by 0.009. `suggestThreshold` now also compares the gap between populations against the clean population's own spread, which needs no invented constant: it asks whether confidence separates these documents any better than it separates documents of the same quality from each other. On this corpus it now refuses to suggest anything and says why — the synthetic PDFs are pure vector text with no image stream, so they exercise the pipeline, not OCR difficulty. A real threshold needs genuinely degraded documents.
- **Two live tests encoded assumptions the API does not honour.** `test/live/workflows.test.ts` assumed a listed workflow is executable and `test/live/connectors.test.ts` assumed a listed connector is authenticated; against a real account the first answers 404 and the second 401 `No credentials found ... Please authenticate`. Both are legitimate states that the tools already handled correctly, so the tests now assert the error contract — that the reason reaches the caller as readable text — instead of asserting a success that depends on how the workspace happens to be provisioned.
- **`mistral_moderate` pinned an alias the API resolves.** The stdio test asserted the response echoed `mistral-moderation-latest`; the API returns the dated build that actually served the request (observed: `mistral-moderation-2603`).

### Removed
- **`mcp_sample` (breaking).** It asked the *client* to run a completion via MCP sampling — a capability almost no client implements, so the tool's honest answer to nearly every caller was an error. Sampling is deprecated in MCP 2026-07-28 besides. Use `mistral_chat`, which does the same job against an endpoint that exists.
- `examples/rate-it.mjs` and the `clawhub/` directory — neither was reachable from the documented surface.
- `test/fixtures/generate-pdfs.py` and the four PDFs it produced, replaced by the corpus above. The generator needed Python and a third-party package, neither of which the repo's own toolchain provides, so the fixtures were frozen binaries nobody could regenerate or review. The replacement is dependency-free Node with uncompressed content streams — a reviewer can `grep` a fixture and see the text it is supposed to contain.
- `DEFAULT_TOOL_MODEL` — callers use `defaultChatModel()`, which honours `MISTRAL_DEFAULT_MODEL`.
- **`MCP_HTTP_STATELESS`.** Both protocol eras are served per-request now, so there is no sessionful mode left for it to switch off. Setting it is harmless; it just does nothing, and pretending otherwise in the docs would be a lie.

### Moved
- `examples/deploy/README.md` → `deploy/connector-public.md`, next to the manifests it belongs with. Both READMEs' links updated.

## [0.9.1] - 2026-08-27

### Fixed
- **`npm run test:stdio` ran zero tests in CI.** The whole stdio e2e suite was gated on `MISTRAL_API_KEY`, on the premise that "the server refuses to boot without it" — no longer true since 0.8.2, which made boot-without-key deliberate. CI has no `MISTRAL_API_KEY`, so every push saw 5 skipped tests and a green check. The suite is now split: **protocol surface** (handshake, 29-tool catalog, complete `annotations` on every tool, prompt resolution, argument completion) runs with no key and is what CI now actually exercises; **live calls** (voices resource, `mistral_chat`, `mistral_moderate`) stay gated on the key.
- **The daily "Live API tests" cron reported success while running nothing.** The `MISTRAL_API_KEY` repository secret is unset, so all 33 live tests `skipIf`-ed out and the job went green — every day, for weeks. `live.yml` now fails with an explicit `::error::` when the secret is missing, so an unconfigured live suite is visible instead of silently reassuring.
- Version strings had drifted across four files (`package.json` 0.9.0, `server.json` 0.8.2, `marketplace.json` 0.8.2, plugin `.mcp.json` pinned `^0.8.0`) and twice inside `src/index.ts`. All aligned, and the runtime version is now a single `SERVER_VERSION` constant so the advertised identity and the boot log cannot disagree again.

### Added
- **Block-level OCR confidence** — `mistral_ocr` accepts `confidence_scores_granularity: "block"` (added to the Mistral OCR API on 2026-07-16) alongside `"page"` and `"word"`, and maps the result to `pages[].blocks[].confidence_scores`: `average_content_confidence_score`, `minimum_content_confidence_score`, `block_type_confidence_score`. Every field is nullable — Mistral returns `null` for a signal it could not compute (an image-only block has no content tokens to score) rather than omitting it, and a block returned without scores does not gain an empty object. Requires OCR 4.1 (`mistral-ocr-4-1`, which `mistral-ocr-latest` has pointed at since 2026-07-16). 1 new unit test.

### Changed
- `@mistralai/mistralai` `2.3.0 → 2.6.4`. Required, not cosmetic: `ConfidenceScoresGranularity` is a closed enum in the generated SDK, so `"block"` was rejected client-side before reaching the API. The Connectors activation surface changed upstream in this range (`activateFor{Organization,Workspace,User}` replaced by `share`/`unshare` + `activateForConsumer`/`deactivateForConsumer`) but this server never wrapped those endpoints, and `connectors.{list,get,listTools,callTool}` are unchanged — full suite green across the bump.
- `@modelcontextprotocol/sdk` `1.29.0 → 1.30.0` (last release of the v1 line).
- `npm audit --omit=dev --audit-level=high` is a blocking CI step and had started failing on two high-severity transitive advisories (`fast-uri`, `ip-address` via `express-rate-limit`). Lockfile refreshed — 0 production vulnerabilities.

### Notes
- CI has not run since 2026-07-01 (no push to `main`), so none of the above was visible on the badge.
- v0.9.0 was never tagged or published; its changes ship here for the first time. npm and the MCP registry both go 0.8.2 → 0.9.1.

## [0.9.0] - 2026-06-30

### Added
- **OCR 4 paragraph-level blocks** — `mistral_ocr` accepts `includeBlocks: true` and returns `pages[].blocks[]`: bounding box + one of 13 content-block types (`text`, `title`, `list`, `table`, `image`, `equation`, `caption`, `code`, `references`, `aside_text`, `header`, `footer`, `signature`) in reading order, each carrying its own `top_left_x/y` / `bottom_right_x/y`. `type:"table"` blocks carry `table_id` linking back to `pages[].tables[]`; `type:"image"` blocks carry `image_id` linking back to `pages[].images[]`. Requires OCR 4 (`mistral-ocr-4-0`); older OCR models accept the flag but return an empty `blocks` array (verified against `@mistralai/mistralai` SDK source, not assumed).
- `@mistralai/mistralai` bumped `^2.2.0 → ^2.3.0` (ships the OCR 4 block types).
- **Mistral Connectors tools** — four new tools to discover and call already-activated Mistral Connectors (MCP/HTTP integrations) directly from the agent loop: `connectors_list` (discovery, with `active` filter + pagination), `connectors_get` (public metadata for one connector), `connectors_list_tools` (a connector's MCP tool catalog with JSON Schema input shape), `connectors_call_tool` (invoke a connector tool — passes through the real MCP `CallToolResult.content` blocks alongside a flattened snake_case `structuredContent` summary). Connector admin (create/update/delete, activation, credentials management) is deliberately out of scope: those endpoints mutate org-wide state and/or return connection secrets, which doesn't fit a tool an LLM drives unattended. `connectors_get` never forwards the SDK's `fetchUserData`/`fetchCustomerData` flags for the same reason. Present in every profile, like Workflows.
- **Mistral Conversations tools** (admin profile) — six new tools wrapping `mistral.beta.conversations.*` for stateful, multi-turn agent loops: `conversation_start`, `conversation_append`, `conversation_get`, `conversation_list`, `conversation_history`, `conversation_delete`. Supports Mistral's built-in tools (`web_search`, `web_search_premium`, `code_interpreter`, `image_generation`) and `document_library` search via `documentLibraryIds`. v1 scope is deliberately conservative: `inputs` only accepts a plain string (no structured `InputEntries[]` replay), `function`/`custom_connector` tool types are out of scope (the former needs a client-side execution loop, the latter duplicates `connectors_*`), and streaming/`restart` (history forking) are not exposed yet.
- **Mistral Libraries (RAG) tools** (admin profile) — five new tools wrapping `mistral.beta.libraries.*`: `libraries_list`, `libraries_get`, `libraries_documents_list`, `libraries_documents_upload`, `libraries_documents_status`. Same scoping philosophy as Connectors: library lifecycle (create/update/delete) and sharing (`accesses`) are out of scope as org-structural operations; document upload is in scope since adding source documents to an existing Library is the core "use it for RAG" action. Pair a Library's `id` with `documentLibraryIds` on `conversation_start` to search it.
- `npm audit --omit=dev --audit-level=high` now runs as a blocking CI step (was previously unautomated).

### Changed
- 1 new unit test (forwards `includeBlocks`, validates `blocks[]` mapping incl. `table_id`), 1 contract test extended to exercise `includeBlocks`, 1 new live test (skipIf no API key) asserting block shape when the API returns blocks.
- Connectors: 6 new unit tests, 4 new contract tests, 5 new live tests (skipIf no API key, tolerant of accounts with zero activated connectors).
- Conversations: 8 new unit tests, 6 new contract tests, 6 new live tests (skipIf no API key) that create, exercise, and clean up a real conversation.
- Libraries: 6 new unit tests, 5 new contract tests, 6 new live tests (skipIf no API key, tolerant of accounts with zero Libraries since this surface doesn't expose library creation).
- **CI split**: live API tests (`test/live/`) no longer run on every push/PR — they were burning Mistral API quota and could flake on transient API issues, blocking unrelated merges. Moved to a new `.github/workflows/live.yml` running on a daily cron + manual `workflow_dispatch`. `ci.yml` now runs lint + build + unit + contract + stdio (no `MISTRAL_API_KEY` secret needed) plus `npm audit`. This matches the test pyramid documented in `CLAUDE.md` §6 ("Manuel + CI cron"), which the previous single-workflow setup did not.
- README / README.fr: corrected stale profile tool counts (`core` 8→12, `workflows` 3→7, `metier-docs` 9→13 — these had drifted out of sync since Connectors/OCR4 were added) and updated `admin` (26→41) to include Conversations + Libraries.

## [0.8.2] - 2026-05-06

### Fixed
- **Boot without `MISTRAL_API_KEY` no longer crashes the process.** Previous behaviour `process.exit(1)` broke sandbox builds (Glama, Smithery) and any introspection flow that needs `tools/list` without auth. The server now logs the same friendly onboarding warning, then continues startup with a placeholder key. Tool calls fail with a clean 401 from the Mistral SDK if no real key is provided. Fixes the Glama auto-build pipeline and lets MCP clients enumerate the tool catalog before the user enters credentials.

### Changed
- README "Why this matters for European teams" section softened: replaced strong claims (e.g. "no Cloud Act exposure", "GDPR-friendly defaults") with a precise "what this project provides" vs "what this project does NOT claim" framing. EN+FR mirror. A DPO / RSSI evaluating the project will trust this framing more — and it accurately reflects that mistral-mcp does not replace a DPIA, vendor review, or legal assessment.

## [0.8.1] - 2026-05-05

### Changed
- README and README.fr.md: removed leftover "coming v0.8" placeholder for `metier-docs` (now shipped). Corrected `admin` profile count `25 → 26` (process_document is registered in admin too). Added a dedicated `process_document` row in the Tools section. Added a new **"Why Mistral + mistral-mcp for European businesses"** section (EN+FR) framing GDPR / DORA / sovereignty / regulated-sectors positioning, with explicit disclaimer that this is not an official Mistral integration.
- `SECURITY.md`: supported-versions table updated `0.4.x → 0.8.x` (was stale since the v0.4 release).

### Fixed
- Documentation cohérence post-v0.8.0 release.

## [0.8.0] - 2026-05-05

### Added
- **`process_document` macro-tool** — single-call OCR + typed extraction pipeline. Kinds: `contract`, `invoice`, `id_document`, `generic` (auto-classification when `kind:"auto"`). Discriminated-union output, JSON-schema-strict extraction, file-based cache (sha256 + pipeline version, override via `MISTRAL_MCP_CACHE_DIR`).
- **PII-safe cache**: `id_document` payloads bypass cache by default. Two-layer safeguard: read-time refusal of cached id_document content, write-time bypass even when `kind:"auto"` resolves to id_document. Explicit `cache:"read_write"` opt-in is preserved.
- **Configurable OCR floor** — `options.minOcrConfidence` (default 0.3, empirical). Below the floor the tool returns `isError`.
- **`metier-docs` profile** — exposes the core tools + `process_document` for documents-vertical agents.
- **Mistral Connectors readiness** — `Dockerfile` exposes port 3333; new `examples/deploy/` guide for Cloudflare Tunnel / Fly.io / Render. README "Use as a Mistral Connector" section in EN+FR with a status matrix (tested locally vs. e2e pending vs. OAuth pending).
- **Comparison section** in README (positioning vs other Mistral MCP servers — `mcp-mistral-ocr`, Speakeasy example, Composio).
- **Better onboarding error** — missing `MISTRAL_API_KEY` prints a one-shot link to `console.mistral.ai/api-keys` and mentions the free Experiment tier.
- 14 new tests for `process_document`: 9 unit (input parsing, registration, cache modes, OCR confidence guard, schema permissiveness with null fields) + 1 contract pattern + 4 live e2e on synthetic PDFs (contract, invoice, id_document, generic).
- `test/fixtures/` with 4 synthetic reportlab-generated PDFs and the Python generator script.
- `.gitattributes` (PDFs as binary, LF-default text).

### Changed
- **Profile rename**: `full` → `admin` (with `full` accepted as a deprecated alias that emits a console warning). The new `metier-docs` profile is the place for vertical macro-tools.
- `workflows` profile no longer leaks `codestral_fim` / `voxtral_transcribe` (registration was unconditional, now gated).
- Schema robustness for `process_document`: `risk_score`, `summary`, `total`, `currency`, `clauses[].risk`, `parties[].role` are now nullable in both zod and the JSON schemas sent to the model. Real-world docs miss fields and the model should be able to say "unknown" rather than fabricate.
- npm keywords expanded (`mistral-ocr`, `document-ai`, `embeddings`, `function-calling`, `vision`, `agents`, `batch-api`, `agent-tools`, `mistral-connectors`, `workflows`).
- README and README.fr.md test-count phrasing made evergreen (`190+ tests` instead of a hard count).

## [0.7.1] - 2026-05-05

### Changed
- README and README.fr.md fully rewritten: SEO-oriented, droit au but, human + AI-agent readable. Removes v0.6.0 relics. Adds Cursor/Zed/Windsurf JSON config block in quick start.
- All 11 Claude Code skills now documented (was 5 in previous README).
- Test count corrected to 174 throughout docs.

## [0.7.0] - 2026-04-30

### Added
- 6 new Claude Code skills: `contract-analyzer`, `pdf-invoice-extractor`, `audio-dispatch`, `contract-review-workflow`, `compliance-audit-workflow`, `research-pipeline-workflow`.
- Live integration test suite for Workflow tools (`test/live/workflows.test.ts`): connectivity, execute → poll → status cycle, bogus executionId graceful error, interact query.
- `marketplace.json` bumped to 0.7.0 with full 11-skill description.

### Changed
- `claude-plugin/` updated: all 11 skills registered, ClawHub SKILL.md bumped to 0.2.0.
- 174 tests total (added 2 live workflow tests vs. 0.6.0).

## [0.6.0] - 2026-04-28

### Added
- **Profile system** (`MISTRAL_MCP_PROFILE=core|full|workflows`): `core` is now the default profile, exposing only 8 tools to keep LLM tool context lean. `full` restores the complete v0.5 surface. `workflows` exposes workflow tools only.
- **`workflow_execute`**: start a Mistral Workflow execution (sync or async). Returns `execution_id` + status or inline `result` when `waitForResult=true`.
- **`workflow_status`**: poll execution state, status, and result by `execution_id`.
- **`workflow_interact`**: polymorphic tool — `action: "signal"` fires a named signal to a running workflow; `action: "query"` reads internal workflow state synchronously.
- **`mistral://workflows` resource**: live `GET /v1/workflows` catalog. Use the `name` field as `workflowIdentifier` in `workflow_execute`.
- 7 new tests (4 contract + 3 unit profile coverage tests), bringing the suite to **172 tests** (134 unit + 27 contract + 5 stdio e2e + 6 live API).

### Changed
- `core` profile (default): `mistral_chat`, `mistral_vision`, `mistral_ocr`, `codestral_fim`, `voxtral_transcribe` + 3 workflow tools.
- `full` profile (opt-in): all 22 v0.5 tools + 3 new workflow tools = 25 tools total.
- `resources.ts`, `tools.ts`, `tools-fn.ts`, `tools-audio.ts` accept a `profile` parameter.
- Plugin `.mcp.json` bumped to `mistral-mcp@^0.6.0`.

### Notes
- This is a SemVer minor bump: new tools/resource, no signature changes to existing tools.
- Workflow tools require a Mistral Workflows account and deployed workflows. They degrade gracefully with `isError:true` if the API is unavailable.
- `MISTRAL_MCP_PROFILE=full node dist/index.js` restores the complete v0.5 tool surface for existing integrations.

## [0.5.0] - 2026-04-28

### Added
- Docker image support: multi-stage `Dockerfile` and `.dockerignore` for `docker run -i --rm` usage with MCP stdio clients.
- `mistral_ocr` can request Mistral Document AI annotations through `document_annotation_format`, `bbox_annotation_format`, and `document_annotation_prompt`.
- `mistral_ocr` now exposes `document_annotation`, per-image `image_annotation`, optional grouped `annotations`, and OCR confidence scores in `structuredContent`.
- `seed` input parameter on `mistral_chat`, `mistral_chat_stream`, `mistral_tool_call`, and `codestral_fim` for deterministic sampling — maps to the SDK's `randomSeed`. Source: [Mistral chat completion API](https://docs.mistral.ai/api/).
- `response_format` input parameter on `mistral_chat`, `mistral_chat_stream`, and `mistral_tool_call` supporting `text`, `json_object`, and strict `json_schema` modes for structured outputs. Source: [Mistral structured outputs](https://docs.mistral.ai/capabilities/structured_output/).
- `reasoning_content` field in `mistral_chat` / `mistral_chat_stream` `structuredContent`: Magistral models now expose their reasoning trace separately from the visible answer, parsed from the SDK's `ThinkChunk` / `TextChunk` content array. Source: [Mistral reasoning models](https://docs.mistral.ai/capabilities/reasoning/).
- New shared helpers `toSdkResponseFormat` (snake_case ↔ camelCase translator) and `extractTextAndReasoning` (Magistral content splitter) in `src/shared.ts`.

### Changed
- README and README.fr realigned to the v0.5.0 development surface and Docker usage.
- `ChatSamplingParams` (shared) now includes `seed` so every chat-style tool that spreads it picks the parameter up.

### Notes
- This is a SemVer minor bump: new optional inputs and output fields, no breaking changes.
- Live test added for end-to-end `response_format: json_schema` against the Mistral API; runs only when `MISTRAL_API_KEY` is set.

## [0.4.3] - 2026-04-28

### Fixed
- Restored `README.md` and `LICENSE` after a tarball extraction overwrote them at the repo root during `mcp-publisher` setup. The previous two npm tarballs (`0.4.1`, `0.4.2`) shipped the wrong `README.md` and `LICENSE`; `0.4.3` is the first npm release with the canonical files restored.

### Changed
- User-facing `npx` invocation in the README is now `npx mistral-mcp` (was `npx -y mistral-mcp`). The `-y` flag silently accepts third-party package execution and was flagged as a supply-chain concern by an external reviewer.

### Added
- Community skill `mistral-mcp-openclaw@0.1.0` published on [ClawHub](https://clawhub.ai/swih/mistral-mcp-openclaw) to register this MCP server inside [OpenClaw](https://github.com/openclaw/openclaw). Source under `clawhub/mistral-mcp-openclaw/`.

### Notes
- Smithery submission was evaluated and skipped: their CLI requires either a hosted HTTPS endpoint or a `.mcpb` bundle, neither of which fits a stdio + bring-your-own-key model. `smithery.yaml` is kept on `main` so a hosted variant can be added later without re-doing the work.

## [0.4.2] - 2026-04-27

### Added
- `server.json` (MCP Registry schema `2025-12-11`) so the package can be listed in the [Official MCP Registry](https://registry.modelcontextprotocol.io/) under the namespace `io.github.Swih/mistral-mcp`.
- `mcpName` field in `package.json` to satisfy the registry's npm verification step.

### Fixed
- `mcpName` casing aligned with the GitHub username (`io.github.Swih/...`) after the registry rejected the lowercased form with a 403.
- `server.json` description trimmed to ≤ 100 ASCII characters to satisfy the registry validator.

### Notes
- Registry-packaging release. No tool, resource, or prompt surface change.

## [0.4.1] - 2026-04-25

### Fixed
- `package.json` `files` field now also ships `README.fr.md` and `SECURITY.md` in the npm tarball. The `0.4.0` tarball only included `dist/`, `README.md`, and `LICENSE`, so links to the French README and the security policy were broken on `npmjs.com`.

### Added
- `glama.json` (Glama MCP discovery service config) and `SECURITY.md` (vulnerability reporting policy via GitHub Security Advisories).

### Notes
- npm-tarball packaging release. No tool, resource, or prompt surface change.

## [0.4.0] - 2026-04-23

### Added
- Phase 0-1 foundation work: `v0.4-dev` branch workflow, `CLAUDE.md`, shared helpers, `mistral://models` live catalog refresh, and tool contract tests.
- Phase 2 multimodal support: `mistral_vision` and `mistral_ocr`.
- Phase 3 audio support: `voxtral_transcribe`, `voxtral_speak`, and `mistral://voices`.
- Phase 4 agent/classifier support: `mistral_agent`, `mistral_moderate`, and `mistral_classify`.
- Phase 5 storage/batch support: `files_upload`, `files_list`, `files_get`, `files_delete`, `files_signed_url`, `batch_create`, `batch_list`, `batch_get`, and `batch_cancel`.
- Phase 6 transport/runtime support: Streamable HTTP transport, `mcp_sample`, transport option resolver, graceful shutdown, and sampling round-trip tests.
- Phase 7 prompt layer: 5 French prompts plus 1 English prompt, with MCP prompt completion via `completable()`.
- New stdio e2e coverage for prompt hydration, prompt completion, `mistral://voices`, and `mistral_moderate`.
- `tsconfig.test.json` so TypeScript checks both `src/` and `test/`.

### Changed
- Public surface grew from 5 tools / 1 resource / 2 prompts in `v0.3.0` to 22 tools / 2 resources / 6 prompts in `v0.4.0-dev`.
- Test pyramid grew to 148 total tests across unit, contract, live API, and stdio e2e layers.
- `npm run lint` now type-checks test files as well as production sources.
- GitHub Actions CI now runs on Node 20 and Node 22 with `fail-fast: false`.
- README, examples, package metadata, and changelog were realigned with the current server surface.

### Fixed
- `french_invoice_reminder` now uses an MCP-compatible two-message pair without relying on unsupported `system` prompt roles.
- `mistral_agent` no longer exposes unsupported top-level `temperature` / `top_p` request parameters.
- `mistral_vision` description no longer claims an image is mandatory when text-only input is accepted.
- `voxtral_speak` now reports decoded binary size instead of base64 string length.
- Function tool schemas were tightened from `z.any()` to `z.unknown()` and one unsafe cast was removed.

## [0.3.0] - 2026-04-16

### Added
- **`mistral_tool_call` tool** - Mistral function calling with OpenAI-style tool
  schemas. Supports `tool_choice` (`none`/`auto`/`any`/`required`/specific function)
  and `parallel_tool_calls`. Returns parsed `tool_calls` in `structuredContent`.
  Source: https://docs.mistral.ai/capabilities/function_calling/
- **`codestral_fim` tool** - Fill-in-the-middle code completion via
  `mistral.fim.complete`. Accepts `prompt` + `suffix`, optional `stop` tokens.
  Model allow-list enforces `codestral-latest`.
- **Resources primitive** - `mistral://models` exposes a JSON catalog of
  supported model aliases grouped by capability (chat / embed / fim / tool_capable).
  Sources cited inline.
- **Prompts primitive** - two curated templates:
  - `french_invoice_reminder(debtor_name, amount_eur, days_overdue, tone)` -
    polite / firm / final tones, 120-word cap.
  - `codestral_review(diff, focus)` - senior code-review lens:
    correctness / performance / security / api_design.
- `publishConfig.access: public` for npm publish hygiene.
- `CHANGELOG.md`.

### Changed
- Test suite grew 13 -> 32 (9 -> 26 unit, 2 -> 4 live API, 2 e2e unchanged).
  New files: `test/fn.unit.test.ts`, `test/resources-prompts.unit.test.ts`.
- README restructured to reflect 5 tools / 1 resource / 2 prompts.
- Live tests extended to cover function calling (`toolChoice: "any"`) and
  Codestral FIM against the real API.

### Fixed
- Streaming handler now uses the proper `CompletionEvent` type imported from
  `@mistralai/mistralai/models/components/completionevent.js` - no more
  `as { data?: unknown }` escape hatch.
- Streaming output now captures `finish_reason` from the last choice and
  exposes it in `structuredContent`.

## [0.2.0] - 2026-04-16

### Added
- Migration to the high-level `McpServer` + `registerTool` API
  ([spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).
- `structuredContent` + `content[]` text fallback on every tool return
  (spec 2025-06-18).
- `outputSchema` declared on every tool.
- Tool annotations: `readOnlyHint`, `destructiveHint: false`, `openWorldHint: true`.
- New tool `mistral_chat_stream` - streaming via `mistral.chat.stream` with
  MCP `notifications/progress` when client supplies `_meta.progressToken`.
- `isError: true` on API failures so calling LLMs can self-correct.
- Canonical model allow-list via Zod enum (12 `*-latest` chat aliases).
- Built-in retry with exponential backoff (500ms -> 5s, exp 2,
  `retryConnectionErrors: true`, `timeoutMs: 60s`).
- 13-test vitest suite across InMemory + live API + stdio e2e layers.
- CI runs `npm test` with `MISTRAL_API_KEY` from repository secrets.

### Changed
- Bumped `@mistralai/mistralai` from `^1.3.0` to `^2.2.0` (major rewrite,
  Speakeasy-generated, built-in retry config).
- Bumped `@modelcontextprotocol/sdk` to `^1.29.0`.

## [0.1.0] - 2026-04-16

### Added
- Initial scaffold - TypeScript MCP server exposing
  `mistral_chat` + `mistral_embed` over stdio.
- MIT license, GitHub Actions CI, README.
