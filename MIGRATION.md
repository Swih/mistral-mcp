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

## Breaking change: document result metadata

`process_document` now accepts `source: { type: "text", text: string }` alongside
the existing URL, base64-image and uploaded-file sources. Plain text and Markdown
are preserved unchanged. The string must contain non-whitespace content and
must not exceed 60,000 UTF-16 code units (JavaScript string length), including
when `kind: "generic"` is requested. Split longer text before submitting it.

Update response validators and consumers for these required result fields:

| Field | Supplied text / Markdown | Successful OCR source |
|---|---|---|
| `extraction_source` (new) | `"provided_text"` | `"mistral_ocr"` |
| `ocr_confidence` (now nullable) | `null` | Number from 0 to 1 |
| `page_count` (now nullable) | `null` | Number of processed pages |
| `ocr_text` (name retained) | Exact input text | OCR text |

Use `extraction_source` to distinguish the routes. Handle `null` explicitly:
provided text has no OCR score or page count; do not turn these values into an
invented confidence or page estimate. Successful OCR results retain numeric
metadata and still fail if confidence is absent, incomplete, invalid or below
the requested floor. `options.maxPages` and `options.minOcrConfidence` apply only
to OCR sources and do not paginate or score supplied text.

With the cache bypassed or no matching cached result, `auto` still calls chat
to classify and typed kinds (`invoice`, `contract`, `id_document`) call chat to
extract fields. Explicit `generic` with a text source makes no API calls and
returns the unchanged input in both `ocr_text` and `structured_text`. Skipping
OCR does not make classification or typed extraction local or free.

The pipeline version is now `v1.0.0-text.1`. Older cache entries are no longer
reused; invalidation does not guarantee their immediate deletion. Consumers that
validate cached results must also adopt the new required field and null handling.

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
that configuration if you also need `process_document` on `0.11.0`. That version
does not accept `source.type: "text"` or return the new `extraction_source` field;
use the previous OCR input and output contract when rolling back. Restart and
refresh discovery after changing the command. Pinning preserves the package code
and profile definitions; it does not freeze the upstream Mistral API or guarantee
future availability.

## Document example and validation

After installation and build, with `MISTRAL_API_KEY` in the environment or `.env`:

```dotenv
MISTRAL_DEFAULT_MODEL=ministral-3b-latest
```

Set this model in the environment or `.env`. It was verified on the test account;
choose a model with quota on yours. The default may have zero quota, and this
setting is not a general guarantee of access or free usage.

```bash
npm run example:invoice -- test/fixtures/invoice-text.md --output invoice-result.json
```

```text
node examples/invoice.mjs <local-file.txt|local-file.md> [--output result.json]
```

Use the [synthetic Markdown invoice](./test/fixtures/invoice-text.md) or your own
existing UTF-8 plain text or Markdown invoice. The source example reads it
locally and calls `process_document` in `core` with `source.type: "text"`,
`kind: "invoice"` and `options.cache: "bypass"`. It makes no Files upload,
deletion or OCR call. It **sends the text to Mistral Cloud chat** for extraction:
the key, chat access and quota are still required, and free execution is not
promised.

On 2026-09-28, the [live text test](./test/live/docs-text.test.ts) and CLI example
succeeded with `ministral-3b-latest` on this fixture, using chat only. Vendor
`ACME SAS`, total `12960` EUR, due date `2026-09-11`, and quantities, unit prices
and amounts for all three lines were verified. This establishes one synthetic
invoice result, not general extraction accuracy or reliability.

Without `--output`, the script prints JSON. With it, the script writes to a new
file and prints its path. It never overwrites an existing output file. The path
is reserved before API calls and may remain empty on failure; remove it or choose
a new path before retrying.

The existing PDF/image route remains available:

```bash
npm run example:invoice -- test/fixtures/corpus/invoice-fr-table.pdf --output invoice-ocr-result.json
```

It requires Files, OCR and chat access/quota, uploads the file, calls
`process_document`, then attempts deletion of the provider file in `finally`,
including on extraction failure. There is **no separate OCR readiness probe**.
File management uses the Files API without adding admin tools to core. See the
[examples guide](./examples/README.md) for file limits, bounded file-readiness
retries and cleanup behavior.

The known **HTTP 429 / zero OCR quota blocker is unresolved**. Avoiding OCR with
supplied text does not establish a successful live OCR invoice run for this
prerelease. Compare results against their source; the
[synthetic PDF](./test/fixtures/corpus/invoice-fr-table.pdf) and
[fixture ground truth](./test/fixtures/corpus.json) describe expected content,
not a captured API response. Schema validation checks structure and types, not factual
accuracy, invoice arithmetic, tax treatment or accounting correctness.

Typed extraction now rejects OCR text above 60,000 UTF-16 code units instead of
silently truncating it. Split longer documents or use `kind: "generic"` for OCR
text. Supplied text retains its 60,000-unit input limit for every kind.
`options.languageHints` is applied to typed extraction. The evaluation harness
reports OCR text checks separately from expected extracted invoice fields;
fixture expectations alone establish no measured live accuracy.

If you already convert documents locally with
[Docling](https://github.com/docling-project/docling), pass its Markdown output
as a text source. Docling is optional and upstream: this repository provides no
integration, dependency or automatic fallback. Chat classification and typed
extraction still use the configured provider.

## Migration en français

`1.0.0-rc.1` est une **préversion source non publiée** ; npm `latest` reste
`0.11.0`. Les commandes `npx` sans version ou avec `@latest` ne lancent pas votre
copie locale de la préversion.

La rupture concerne `core`, qui passe de 16 à six outils : `codestral_fim`,
`mistral_chat`, `mistral_ocr`, `mistral_vision`, `process_document` et
`voxtral_transcribe`. Les 11 outils d'orchestration listés plus haut et la ressource
`mistral://workflows` quittent `core`. Le contrat de sortie documentaire change
également.

`process_document` accepte désormais `source: { type: "text", text: string }`,
en plus des URL, images base64 et identifiants de fichiers téléversés. Texte et
Markdown restent inchangés. L'entrée doit contenir autre chose que des espaces
et ne pas dépasser 60 000 unités de code UTF-16 (longueur d'une chaîne JavaScript),
y compris pour `kind: "generic"`. Découpez tout texte plus long avant l'appel.

Adaptez les validateurs et consommateurs aux champs obligatoires suivants :

| Champ | Texte / Markdown fourni | Source OCR traitée avec succès |
|---|---|---|
| `extraction_source` (nouveau) | `"provided_text"` | `"mistral_ocr"` |
| `ocr_confidence` (désormais nullable) | `null` | Nombre entre 0 et 1 |
| `page_count` (désormais nullable) | `null` | Nombre de pages traitées |
| `ocr_text` (nom conservé) | Texte d'entrée exact | Texte OCR |

Distinguez les parcours avec `extraction_source`. Traitez `null` explicitement :
le texte fourni n'a ni confiance OCR ni nombre de pages ; n'inventez pas ces
valeurs. Les succès OCR gardent des métadonnées numériques et une confiance
absente, incomplète, invalide ou sous le seuil demandé provoque toujours un échec.
`options.maxPages` et `options.minOcrConfidence` s'appliquent uniquement à l'OCR ;
ils ne paginent ni ne notent le texte fourni.

Sans résultat en cache ou si le cache est contourné, `auto` appelle toujours le
chat pour classifier et les types `invoice`, `contract` et `id_document` pour
l'extraction. Seul un `generic` explicite avec une source texte ne fait aucun
appel API et renvoie l'entrée inchangée dans `ocr_text` et `structured_text`.
Éviter l'OCR ne rend pas la classification ou l'extraction typée locale ou gratuite.

Le pipeline passe à `v1.0.0-text.1`. Les anciennes entrées de cache ne sont plus
réutilisées ; cette invalidation ne garantit pas leur suppression immédiate.
Les consommateurs qui valident des résultats en cache doivent aussi gérer le
nouveau champ obligatoire et les valeurs `null`.

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
ajouter `process_document`. Cette version n'accepte pas `source.type: "text"` et
ne renvoie pas `extraction_source` : rétablissez l'ancien contrat d'entrée OCR et
de sortie en cas de retour arrière. L'épinglage ne garantit pas la pérennité de
l'API Mistral sous-jacente.

L'exemple facture exige installation, build, clé API et quota de chat. Définissez
`MISTRAL_DEFAULT_MODEL=ministral-3b-latest` dans l'environnement ou `.env`, comme
ci-dessus. Ce modèle a été vérifié sur le compte de test ; choisissez un modèle
avec quota sur le vôtre. Le modèle par défaut peut avoir un quota nul ; ce réglage
ne garantit ni accès ni gratuité.
Fournissez la [facture Markdown synthétique](./test/fixtures/invoice-text.md) ou
une facture existante en UTF-8 `.txt` ou `.md` aux commandes ci-dessus. Le script charge
`.env` via `dotenv`, lit le texte localement et appelle `process_document` dans
`core` avec `source.type: "text"`, `kind: "invoice"` et `options.cache: "bypass"`.
Il ne fait aucun téléversement ni suppression Files, ni appel OCR. Il **envoie le
texte au chat Mistral Cloud** pour l'extraction, sans promesse de gratuité.
Sans `--output`, il affiche le JSON ; avec cette option, il affiche le chemin du
nouveau fichier. Le fichier est réservé avant les appels et peut rester vide
après un échec. Aucun fichier existant n'est écrasé.

Le 2026-09-28, le [test live texte](./test/live/docs-text.test.ts) et l'exemple CLI
ont réussi sur cette fixture avec `ministral-3b-latest`, via le chat seul.
Fournisseur `ACME SAS`, total `12960` EUR, échéance `2026-09-11` et quantités,
prix unitaires et montants des trois lignes ont été vérifiés. Ce résultat sur une
facture synthétique n'établit pas une précision ou une fiabilité générale.

Le parcours PDF/image reste disponible et nécessite accès et quota Files, OCR
et chat. Il téléverse le fichier, appelle `process_document`, puis tente de
supprimer le fichier dans `finally`, même après un échec d'extraction.
**Aucun appel séparé de vérification OCR n'est effectué.** L'API Files gère les
fichiers sans ajouter d'outils admin dans core. Le
[guide des exemples](./examples/README.md) détaille les limites, les reprises
bornées en cas de fichier indisponible pour l'OCR et le nettoyage.
**Le blocage HTTP 429 / quota OCR nul reste non résolu** ; le parcours texte
n'établit pas le succès du parcours facture OCR live pour cette préversion.

La [vérité terrain](./test/fixtures/corpus.json) décrit le corpus synthétique,
pas une sortie réelle capturée. La validation du schéma vérifie structure et
types, pas l'exactitude factuelle, les calculs, le traitement fiscal ou la justesse
comptable. L'évaluation sépare désormais texte OCR et champs de facture extraits.
Les extractions typées de texte OCR au-delà de 60 000 unités de code UTF-16 sont
refusées, sans troncature silencieuse ; découpez le document ou utilisez `generic`
pour le texte OCR. La limite d'entrée de 60 000 unités du texte fourni reste
valable pour tous les types.
`options.languageHints` s'applique à l'extraction typée.

Si vous convertissez déjà vos documents localement avec
[Docling](https://github.com/docling-project/docling), transmettez le Markdown
produit comme source texte. Docling est optionnel et en amont : ce dépôt ne
fournit ni intégration, ni dépendance, ni repli automatique. Classification par
chat et extraction typée utilisent toujours le fournisseur configuré.
