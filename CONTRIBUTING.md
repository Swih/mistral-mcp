# Contributing

The default experience is document processing with a small, predictable tool
surface. Advanced Mistral API coverage lives in explicit profiles. Propose new
tools with a concrete use case and a testable result before expanding the default.

## Development

Node 20 or newer is required. From the repository root:

```sh
npm ci
npm run check:release
```

This runs type checks, builds, unit tests, contracts, stdio/HTTP protocol tests
and an installed-tarball smoke test. It does not call Mistral. The package smoke
test uses a local HTTP stub; it still needs npm registry access for dependencies.

`npm run test:live` and `npm run eval:docs` make real provider calls and need an
API key and available quota. A skipped or blocked test is not evidence of success.
Never enable billing as part of a test setup without the account owner's approval.

## Changes

- Keep EN and FR README instructions aligned and name the profiles a tool needs.
- Describe user inputs; return readable content and schema-validated structured
  output on success, and an MCP tool error on failure.
- Add a contract and a meaningful behavioral test when changing a tool. A source
  registration test alone does not prove the built server exposes that tool.
- Preserve both MCP protocol eras. No new runtime dependency without discussion.
- Use synthetic documents in fixtures. Do not commit customer documents,
  extraction results, `.env` files or credentials.
- Treat output schema validation, OCR confidence and factual accuracy as different
  measurements. Publish only results from a recorded, reproducible evaluation.

## Release candidates

The source on this branch targets `1.0.0-rc.1`. The published stable version is
still `0.11.0`. See [MIGRATION.md](MIGRATION.md) before changing profiles.

Run the release checks and review live results before publishing. Keep package,
runtime, registry and plugin versions aligned. Publish a candidate with an
explicit npm tag such as `next`; never move `latest` to an unvalidated candidate.
The distribution workflow similarly keeps prerelease Docker images off `latest`.

Record provider limitations in the release notes. An unavailable provider does
not justify hiding failures or describing unmeasured accuracy as verified.

## Contribuer en français

Le profil par défaut privilégie les documents et une surface réduite. Pour une
modification, fournissez un cas d'usage, un test significatif et une documentation
FR/EN cohérente. `npm run check:release` vérifie le logiciel sans appel Mistral ;
les tests live et `eval:docs` nécessitent une clé et un quota. Les documents du
corpus doivent rester synthétiques. Une validation de schéma ne prouve pas
l'exactitude des champs extraits. Consultez [MIGRATION.md](MIGRATION.md) pour la
transition vers la version candidate.
