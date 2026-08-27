# Changelog

All notable changes to `mistral-mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-08-28

Two things: the server moves to the current protocol revision without asking a
single client to move with it, and it can run entirely against your own
OpenAI-compatible endpoint.

### Added

- **MCP 2026-07-28, with the 2025-era handshake served alongside it.** Built on `@modelcontextprotocol/server` 2.x: `serveStdio(factory, { legacy: "serve" })` and `createMcpHandler(factory, { legacy: "stateless" })` both take one factory and decide the era from the opening exchange, so the same registrations answer a 2026-07-28 client and a 2025-era one. That second half is the point — practically every client shipping today (Claude Code, Cursor, Zed, Windsurf, Claude Desktop) still opens with `initialize`, and upgrading this server must not ask them to upgrade too. `test/stdio/protocol-eras.test.ts` drives the built binary with a real 1.30.x client and a real pinned-2026 client and asserts both see an identical tool set; `@modelcontextprotocol/sdk` stays as a devDependency for exactly that purpose.
- **Cache hints (`ttlMs` / `cacheScope`, SEP-2549).** The catalogue is fixed at boot by the profile, so `tools/list`, `prompts/list`, `resources/list` and `server/discover` are advertised as `public` for 5 minutes. Resource reads carry their own: `mistral://capabilities` `public`/5 min (it is a projection of the process config), `mistral://models` and `mistral://voices` `private`/5 min (entitlements are per-key, and each read is a live API call), `mistral://workflows` `private`/30 s (the account holder deploys and retires those). The default for anything unhinted stays the conservative `ttlMs: 0, cacheScope: "private"`. 2025-era responses are untouched — the revision has no cache fields.
- **Trace propagation and an audit trail** (`src/observability.ts`). `traceparent` / `tracestate` / `baggage` arrive in an MCP request's `_meta` and are stamped onto every outgoing call to Mistral (or to your own endpoint) through a `beforeRequest` hook on the SDK's HTTP client, with the context held in an `AsyncLocalStorage` for the life of the handler — so a customer's collector joins the MCP span to the inference span it caused, and no tool handler has to know any of this exists. Alongside it, one JSON line per tool call on stderr: tool, outcome, duration, trace and span ids. **Never a payload** — no prompts, documents, transcripts, arguments or model output, asserted as a negative against the built binary in `test/stdio/observability.test.ts`. On by default (`MISTRAL_MCP_AUDIT=off` silences it): an audit trail an operator has to discover is one they will not have when they need it, and MCP's own `logging` capability is deprecated in 2026-07-28 in favour of exactly this. Zero new dependencies — `node:async_hooks` is core and the traceparent grammar is 55 characters of hex parsed here.
- **`test/stdio/http-transport.test.ts`** — the Streamable HTTP path over a real socket: `/healthz`, 401 unauthenticated, 401 on a wrong token, 404 on an unknown path, and both protocol eras against the same endpoint.
- **`MISTRAL_BASE_URL`** — point the server at any OpenAI-compatible endpoint (vLLM, TGI, LiteLLM, an internal token factory) and every request goes there instead of `api.mistral.ai`. Wired to the Mistral SDK's `serverURL`. Validated at boot: absolute http(s) only, trailing slashes stripped, and `https://api.mistral.ai` recognised as *not* custom so the default path is unchanged.
- **`self-hosted` profile** — inferred automatically from a custom `MISTRAL_BASE_URL`, and registering only the five families such an endpoint actually serves: `mistral_chat`, `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call`, `mistral_vision`. OCR, Voxtral, Files, Batch, Agents, Conversations, Libraries and Workflows are Mistral-platform endpoints — advertising them in front of vLLM only produces 404s the calling model has to guess its way out of. An explicit `MISTRAL_MCP_PROFILE` always wins over the inference, for gateways that do proxy the full API.
- **`mistral://capabilities` resource** — the active profile, whether it was inferred, the endpoint and its kind (`mistral` / `custom`), the list of registered tools, and for every tool family whether it is available plus a one-line reason when it is not. An agent can now discover *why* a tool is missing instead of calling it to find out.
- **`rag_indexes_list`** — lists the search-index deployments on the account (backend, status, per-index document counts, ISO timestamps). Read-only, `core` profile. Deliberately not a retrieval tool: Mistral's Agentic Search ships its own MCP server, and reimplementing hybrid retrieval here would duplicate it badly. Register/unregister stay out for the same reason `connectors_*` and `libraries_*` writes do — they are deploy-pipeline operations, not agent-loop operations.
- **On-prem deployment deliverables** — `deploy/docker-compose.yml` (bearer token required, loopback-only publish, read-only rootfs, all capabilities dropped, healthcheck; optional `vllm` profile for local inference) and `deploy/k8s/mistral-mcp.yaml` (ConfigMap, Service, Deployment with `runAsNonRoot`/`readOnlyRootFilesystem`/`seccompProfile: RuntimeDefault`, default-deny NetworkPolicy, PodDisruptionBudget). Plain manifests, no Helm chart: the delivery model is files the customer can read, diff and apply. `deploy/README.md` documents both plus the full environment reference.
- **`test/stdio/self-hosted.test.ts`** — spins up a real OpenAI-compatible HTTP server, spawns the built binary against it, and asserts the profile inference, the 5-tool catalogue, the absent Mistral-only resources, and a real `mistral_chat` call landing on the fake endpoint with a non-Mistral model id. No key, no egress, runs on every push.

### Changed
- **`@modelcontextprotocol/sdk` 1.30.0 → `@modelcontextprotocol/server` 2.0.0** (runtime), with the v1 SDK retained as a devDependency for the compatibility test. `@modelcontextprotocol/node` was deliberately not taken: it exists to bridge web-standard `Request`/`Response` into `node:http` and pulls `@hono/node-server` to do it, while Node 20 has `Request`, `Response` and `Readable.toWeb` natively — the bridge is forty lines in `src/transport.ts` and the runtime dependency budget stays at three.
- **zod 3 → 4** (the v2 SDK's floor is 4.2.0; `@mistralai/mistralai` accepts `^3.25 || ^4`). One real breaking change in this repo: `.default()` now applies to the *output* type, so `process_document`'s `options` object — whose inner fields carry their own defaults — became `.prefault({})`, which is the zod 4 spelling of the old semantics. Two unit tests that asserted zod's exact size-error prose now assert the rejection and the offending field instead.
- **Model identifiers are no longer validated against a closed `z.enum`.** They are now non-empty strings whose `.describe()` carries the known Mistral aliases and points at `mistral://models`. This is the same failure class as the `ConfidenceScoresGranularity` enum fixed in 0.9.1: a client-side allow-list rejects valid identifiers before the API can answer, goes stale on every Mistral release, and made `MISTRAL_BASE_URL` unusable (`my-org/mistral-small-3.2` is a normal answer, not an error). Empty strings are still rejected; the endpoint remains the authority on what it serves.
- **Profile gating is table-driven** (`TOOL_FAMILIES` in `src/profile.ts`). The rules had been duplicated across `index.ts`, four `tools-*.ts` modules and `resources.ts`, which is how 0.8.0 leaked `codestral_fim` and `voxtral_transcribe` into the `workflows` profile. A third instance of the same class is fixed here: `resources.ts` accepted a `profile` argument it never read, so `mistral://voices` and `mistral://workflows` were advertised under every profile. Unit tests now assert the table's invariants directly.
- Docker image `node:20-alpine → node:22-alpine`, runs as `USER node`, npm cache cleaned, cache directory created and owned so a read-only root filesystem works.
- `engines.node` `>=18 → >=20`. Node 18 reached end-of-life on 2025-04-30 and CI has only tested 20 and 22 for several releases.
- `OCR_MODELS` gains `mistral-ocr-4-1` and `mistral-ocr-4-0` as documented aliases.

### Removed
- **`mcp_sample` (breaking).** It asked the *client* to run a completion via MCP sampling — a capability almost no client implements, so the tool's honest answer to nearly every caller was an error. Sampling is deprecated in MCP 2026-07-28 besides. Use `mistral_chat`, which does the same job against an endpoint that exists.
- `examples/rate-it.mjs` and the `clawhub/` directory — neither was reachable from the documented surface.
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
