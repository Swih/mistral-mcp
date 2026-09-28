# Migration: 0.11.0 → 1.0.0-rc.1

[English README](./README.md) · [README français](./README.fr.md) · [Français ci-dessous](#migration-en-français)

`1.0.0-rc.1` is a **source prerelease, not yet published to npm**. npm `latest`
is `0.11.0`. Build the source prerelease to try the new behavior; an unversioned
`npx mistral-mcp` or `mistral-mcp@latest` does not select this source checkout.

## Breaking change: the default tool set

With no custom endpoint or explicit profile, the server uses `core`. Its tool
set changes from 16 tools in `0.11.0` to six in `1.0.0-rc.1`:

```text
codestral_fim
mistral_chat
mistral_ocr
mistral_vision
process_document
voxtral_transcribe
```

`process_document` is added to `core`. The following 11 orchestration tools leave
`core` and remain available in `metier-docs`, `workflows` and `admin`:

| Family | Tools |
|---|---|
| Workflows | `workflow_execute`, `workflow_status`, `workflow_interact`, `workflow_deployments_list`, `workflow_runs_list`, `workflow_stop` |
| Connectors | `connectors_list`, `connectors_get`, `connectors_list_tools`, `connectors_call_tool` |
| Search-index discovery | `rag_indexes_list` |

The `mistral://workflows` resource follows the workflow family: it is no longer
registered in `core`, and remains in those three profiles. Clients that call
these tools or read this resource must select an appropriate profile.

| Profile | 0.11.0 tools | 1.0.0-rc.1 tools | Action |
|---|---:|---:|---|
| `core` | 16 | 6 | Migrate orchestration clients explicitly |
| `metier-docs` | 17 | 17 | Preserved legacy profile: the entire old core plus `process_document` |
| `workflows` | 11 | 11 | Use for orchestration only |
| `admin` | 46 | 46 | Use when Files, Batch, agents, Conversations or Libraries are also needed |
| `self-hosted` | 5 | 5 | Compatible inference subset; no document OCR pipeline |

There are still five profiles. `full` remains a deprecated alias of `admin`.
`metier-docs` keeps its existing 17 tools, including all 11 orchestration tools;
it is a superset of the old core, not a rename for the new six-tool core.

## Preserve an existing integration

Set the following environment variable on the MCP server process to preserve
the old core tool set and include `process_document`:

```dotenv
MISTRAL_MCP_PROFILE=metier-docs
```

Use `MISTRAL_MCP_PROFILE=workflows` for orchestration alone, or
`MISTRAL_MCP_PROFILE=admin` for all 46 tools. A profile selects exposed tools;
it does not grant provider permissions, quota, deployments or connectors.

Example client configuration for a built source checkout:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "node",
      "args": ["/absolute/path/to/mistral-mcp/dist/index.js"],
      "env": {
        "MISTRAL_API_KEY": "your_key_here",
        "MISTRAL_MCP_PROFILE": "metier-docs"
      }
    }
  }
}
```

Replace the path with your local checkout. Run `npm ci` and `npm run build`
before starting it. A `.env` file alone does not configure the server: set the
environment through your client or service manager. The invoice example has its
own `dotenv` loader.

To inspect this profile without API calls:

```bash
# POSIX shell
MISTRAL_MCP_PROFILE=metier-docs node dist/index.js --doctor
```

```powershell
# PowerShell
$env:MISTRAL_MCP_PROFILE = "metier-docs"
node dist/index.js --doctor
```

Restart the MCP process, refresh the client's tool catalog, and read
`mistral://capabilities`. Check that every tool your integration uses is listed.
Discovery and `--doctor` are local checks, not live provider validation.

An explicit profile overrides the `self-hosted` inference from
`MISTRAL_BASE_URL`. Only enable Mistral-specific tools on a custom endpoint if it
implements their APIs; selecting a profile does not supply an OCR backend.

The [Claude Code plugin](./claude-plugin/README.md) pins the exact RC npm version.
Until that version is published, use the local build configuration above. Review
the profile used by skills that need workflow or connector tools.

## Stay on or return to 0.11.0

Pin the exact published version instead of `latest` or a version range:

```json
{
  "mcpServers": {
    "mistral": {
      "command": "npx",
      "args": ["-y", "mistral-mcp@0.11.0"],
      "env": {
        "MISTRAL_API_KEY": "your_key_here",
        "MISTRAL_MCP_PROFILE": "core"
      }
    }
  }
}
```

This restores the published 16-tool core. Use `metier-docs` instead of `core` in
that configuration if you also need `process_document` on `0.11.0`. Restart and
refresh discovery after changing the command. Pinning preserves the package code
and profile definitions; it does not freeze the upstream Mistral API or guarantee
future availability.

## Document example and validation

After installation and build, with `MISTRAL_API_KEY` in the environment or `.env`:

```bash
npm run example:invoice -- test/fixtures/corpus/invoice-fr-table.pdf --output invoice-result.json
```

```text
node examples/invoice.mjs <local-file.pdf> [--output result.json]
```

The source example uploads the PDF to Mistral Cloud, checks OCR readiness, calls
`process_document` in `core` with `kind: "invoice"` and
`options.cache: "bypass"`, then attempts deletion of the uploaded provider file
in `finally`, including on extraction failure. File management uses the Files
API without adding admin tools to core. These are real API calls requiring quota;
free execution is not promised.

Without `--output`, the script prints JSON. With it, the script writes to a new
file and prints its path. It never overwrites an existing output file. The path
is reserved before API calls and may remain empty on failure; remove it or choose
a new path before retrying.

The known **OCR zero-quota blocker is unresolved**. A successful live invoice run
is not established for this prerelease. Compare any results with the
[source invoice](./test/fixtures/corpus/invoice-fr-table.pdf) and
[fixture ground truth](./test/fixtures/corpus.json), which is not a captured API
response. Schema validation checks response structure and types, not factual
accuracy, invoice arithmetic, tax treatment or accounting correctness.

Typed extraction now rejects OCR text above 60,000 characters instead of silently
truncating it. Split longer documents or use `kind: "generic"` for OCR text.
`options.languageHints` is applied to typed extraction. The evaluation harness
reports OCR text checks separately from expected extracted invoice fields;
fixture expectations alone establish no measured live accuracy.

## Migration en français

`1.0.0-rc.1` est une **préversion source non publiée** ; npm `latest` reste
`0.11.0`. Les commandes `npx` sans version ou avec `@latest` ne lancent pas votre
copie locale de la préversion.

La rupture concerne `core`, qui passe de 16 à six outils : `codestral_fim`,
`mistral_chat`, `mistral_ocr`, `mistral_vision`, `process_document` et
`voxtral_transcribe`. Les 11 outils d'orchestration listés plus haut et la ressource
`mistral://workflows` quittent `core`.

Pour conserver tous les outils de l'ancien core, ajoutez à l'environnement du
serveur :

```dotenv
MISTRAL_MCP_PROFILE=metier-docs
```

`metier-docs` conserve ses 17 outils : l'ancien core et `process_document`, dont
les 11 outils d'orchestration. Pour l'orchestration seule, choisissez
`MISTRAL_MCP_PROFILE=workflows` (11 outils) ; pour tous les outils,
`MISTRAL_MCP_PROFILE=admin` (46). `self-hosted` reste à cinq outils, sans OCR.
Il n'y a pas de sixième profil : `full` est un alias déprécié de `admin`.

Les configurations JSON et commandes POSIX/PowerShell ci-dessus s'appliquent aussi
en français. Compilez les sources, configurez l'environnement du client ou du
service, redémarrez le serveur et actualisez sa liste d'outils. `--doctor` et
`mistral://capabilities` permettent de contrôler le profil, sans prouver l'accès
API ou les quotas. Un profil explicite remplace celui déduit de
`MISTRAL_BASE_URL`, mais ne rend pas un backend compatible avec les API manquantes.
Le plugin Claude Code épingle la RC npm exacte : utilisez la compilation locale
tant qu'elle n'est pas publiée.

Pour rester sur la version publiée ou y revenir, épinglez exactement
`mistral-mcp@0.11.0` dans les arguments `npx` du client, comme dans le JSON
ci-dessus. Son profil `core` garde 16 outils ; choisissez `metier-docs` pour y
ajouter `process_document`. L'épinglage ne garantit pas la pérennité de l'API
Mistral sous-jacente.

Le nouvel exemple facture exige installation, build, clé API et quota. Il charge
`.env` via `dotenv`, téléverse le PDF, vérifie sa disponibilité OCR, appelle
`process_document` dans `core` avec `kind: "invoice"` et
`options.cache: "bypass"`, puis tente de supprimer le fichier dans `finally`,
même après un échec d'extraction. Sans `--output`, il affiche le JSON ; avec cette
option, il affiche le chemin du nouveau fichier. Le fichier est réservé avant les
appels et peut rester vide après un échec. Aucun fichier existant n'est écrasé.
Ce sont de vrais appels API, sans promesse de gratuité. **Le blocage OCR à quota
nul reste non résolu** ; le succès du parcours live n'est pas établi pour cette
préversion.

La [vérité terrain](./test/fixtures/corpus.json) décrit le corpus synthétique,
pas une sortie réelle capturée. La validation du schéma vérifie structure et
types, pas l'exactitude factuelle, les calculs, le traitement fiscal ou la justesse
comptable. L'évaluation sépare désormais texte OCR et champs de facture extraits.
Les extractions typées au-delà de 60 000 caractères sont refusées, sans troncature
silencieuse ; découpez le document ou utilisez `generic` pour le texte OCR.
`options.languageHints` s'applique à l'extraction typée.
