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
- Preserve both MCP protocol eras. No new runtime dependency without explicit approval.
- Use synthetic documents in fixtures. Do not commit customer documents,
  extraction results, `.env` files or credentials.
- Treat output schema validation, OCR confidence and factual accuracy as different
  measurements. Publish only results from a recorded, reproducible evaluation.

## Releases

The stable release is `1.0.0`. See [MIGRATION.md](MIGRATION.md) for the changes
from `0.11.0`: six tools in the default profile, required `extraction_source`
and nullable OCR metadata. Installation examples pin `mistral-mcp@1.0.0`;
source examples require `git checkout v1.0.0`, `npm ci` and `npm run build`.
The scripts and fixtures are not included in the npm package.

Run the release checks and review live results before publishing. Keep package,
runtime, registry, plugin and documentation versions aligned. Stable releases use
the matching Git tag (`v1.0.0` for this release) and npm `latest`. Future release
candidates must use a separate npm tag such as `next`; prerelease Docker images
also stay off `latest`.

Record provider limitations in the release notes. An unavailable provider does
not justify hiding failures or describing unmeasured accuracy as verified.
The recorded 2026-09-28 text check covers one synthetic invoice with
`ministral-3b-latest`; it is not a general accuracy score. HTTP 429 / zero OCR
quota on the test account blocked live OCR validation.

## Contribuer en français

Le profil par défaut privilégie les documents et une surface réduite. Pour une
modification, fournissez un cas d'usage, un test significatif et une documentation
FR/EN cohérente. `npm run check:release` vérifie le logiciel sans appel Mistral ;
les tests live et `eval:docs` nécessitent une clé et un quota. Les documents du
corpus doivent rester synthétiques. Une validation de schéma ne prouve pas
l'exactitude des champs extraits. Consultez [MIGRATION.md](MIGRATION.md) pour la
transition de `0.11.0` vers la version stable `1.0.0`. Les exemples npm épinglent
`mistral-mcp@1.0.0` ; les scripts du dépôt exigent le tag `v1.0.0`, `npm ci` et
`npm run build`. Ces scripts et fixtures ne sont pas inclus dans le paquet npm.
Le contrôle texte du 2026-09-28 porte sur une seule facture synthétique avec
`ministral-3b-latest`. La validation OCR live reste bloquée par HTTP 429 / quota
OCR nul sur le compte de test. N'activez pas de facturation sans accord explicite
du titulaire du compte.
