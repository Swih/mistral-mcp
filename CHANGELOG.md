# Changelog

All notable changes to `mistral-mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-04-XX

### Added
- Docker image support: multi-stage `Dockerfile` and `.dockerignore` for `docker run -i --rm` usage with MCP stdio clients.
- `mistral_ocr` can request Mistral Document AI annotations through `document_annotation_format`, `bbox_annotation_format`, and `document_annotation_prompt`.
- `mistral_ocr` now exposes `document_annotation`, per-image `image_annotation`, optional grouped `annotations`, and OCR confidence scores in `structuredContent`.
- Placeholder for Lot B: `seed`, Magistral reasoning output, and `response_format: json_schema` for chat/function-calling tools.

### Changed
- README and README.fr realigned to the v0.5.0 development surface and Docker usage.

### Notes
- This is a SemVer minor bump: new optional inputs and output fields, no breaking changes.

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
