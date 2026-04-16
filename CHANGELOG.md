# Changelog

All notable changes to `mistral-mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-16

### Added
- **`mistral_tool_call` tool** — Mistral function calling with OpenAI-style tool
  schemas. Supports `tool_choice` (`none`/`auto`/`any`/`required`/specific function)
  and `parallel_tool_calls`. Returns parsed `tool_calls` in `structuredContent`.
  Source: https://docs.mistral.ai/capabilities/function_calling/
- **`codestral_fim` tool** — Fill-in-the-middle code completion via
  `mistral.fim.complete`. Accepts `prompt` + `suffix`, optional `stop` tokens.
  Model allow-list enforces `codestral-latest`.
- **Resources primitive** — `mistral://models` exposes a JSON catalog of
  supported model aliases grouped by capability (chat / embed / fim / tool_capable).
  Sources cited inline.
- **Prompts primitive** — two curated templates:
  - `french_invoice_reminder(debtor_name, amount_eur, days_overdue, tone)` —
    polite / firm / final tones, 120-word cap.
  - `codestral_review(diff, focus)` — senior code-review lens:
    correctness / performance / security / api_design.
- `publishConfig.access: public` for npm publish hygiene.
- CHANGELOG.md.

### Changed
- Test suite grew 13 → 32 (9→26 unit, 2→4 live API, 2 e2e unchanged).
  New files: `test/fn.unit.test.ts`, `test/resources-prompts.unit.test.ts`.
- README restructured to reflect 5 tools / 1 resource / 2 prompts.
- Live tests extended to cover function calling (`toolChoice: "any"`) and
  Codestral FIM against the real API.

### Fixed
- Streaming handler now uses the proper `CompletionEvent` type imported from
  `@mistralai/mistralai/models/components/completionevent.js` — no more
  `as { data?: unknown }` escape hatch.
- Streaming output now captures `finish_reason` from the last choice and
  exposes it in `structuredContent`.

## [0.2.0] — 2026-04-16

### Added
- Migration to the high-level `McpServer` + `registerTool` API
  ([spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).
- `structuredContent` + `content[]` text fallback on every tool return
  (spec 2025-06-18).
- `outputSchema` declared on every tool.
- Tool annotations: `readOnlyHint`, `destructiveHint: false`, `openWorldHint: true`.
- New tool `mistral_chat_stream` — streaming via `mistral.chat.stream` with
  MCP `notifications/progress` when client supplies `_meta.progressToken`.
- `isError: true` on API failures so calling LLMs can self-correct.
- Canonical model allow-list via Zod enum (12 `*-latest` chat aliases).
- Built-in retry with exponential backoff (500ms → 5s, exp 2,
  `retryConnectionErrors: true`, `timeoutMs: 60s`).
- 13-test vitest suite across InMemory + live API + stdio e2e layers.
- CI runs `npm test` with `MISTRAL_API_KEY` from repository secrets.

### Changed
- Bumped `@mistralai/mistralai` from `^1.3.0` to `^2.2.0` (major rewrite,
  Speakeasy-generated, built-in retry config).
- Bumped `@modelcontextprotocol/sdk` to `^1.29.0`.

## [0.1.0] — 2026-04-16

### Added
- Initial scaffold — TypeScript MCP server exposing
  `mistral_chat` + `mistral_embed` over stdio.
- MIT license, GitHub Actions CI (lint + build), README.
