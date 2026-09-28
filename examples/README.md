# Examples / Exemples

These examples use the **unpublished source prerelease `1.0.0-rc.1`**; npm
`latest` remains `0.11.0`. Ces exemples utilisent la **préversion source
`1.0.0-rc.1` non publiée** ; npm `latest` reste à `0.11.0`.

Run from the repository root after `npm ci` and `npm run build`.
Real examples require `MISTRAL_API_KEY` in the environment or `.env`. Check your
account allowance first: these scripts do not guarantee free provider access.

Depuis la racine, après `npm ci` et `npm run build`. Les exemples réels requièrent
`MISTRAL_API_KEY` dans l'environnement ou `.env`. Vérifiez les quotas de votre
compte ; ces scripts ne garantissent pas d'accès gratuit au fournisseur.

## Offline verification / Vérification sans appel API

```bash
node dist/index.js --doctor
npm run test:package
```

The package check installs the tarball and calls only a local stub.
Le test installe le paquet et utilise uniquement un serveur local simulé.

## Invoice / Facture

Set the model in your environment or local `.env` alongside `MISTRAL_API_KEY`.
Définissez le modèle dans l'environnement ou le `.env` local, avec `MISTRAL_API_KEY`.

```dotenv
MISTRAL_DEFAULT_MODEL=ministral-3b-latest
```

This model was verified on the test account; choose a model with quota on yours.
The default may have zero quota, and access or free usage is not guaranteed.
Ce modèle a été vérifié sur le compte de test ; choisissez un modèle disposant
de quota sur le vôtre. Le modèle par défaut peut avoir un quota nul ; accès et
gratuité ne sont pas garantis.

```bash
npm run example:invoice -- test/fixtures/invoice-text.md --output result.json
node examples/invoice.mjs /path/to/your-invoice.txt
node examples/invoice.mjs /path/to/your-invoice.md
```

Start with the [synthetic Markdown invoice](../test/fixtures/invoice-text.md) or
your own existing plain text or Markdown invoice. There is no default document
or URL download.
Quote paths containing spaces. The script quietly loads `.env` from the current
directory. This example is **Mistral Cloud only**: a custom `MISTRAL_BASE_URL` is
rejected before provider calls. It requires a Mistral key and chat access/quota
for **every invoice route**. Calls may be billed under your existing account;
the script does not activate billing or guarantee free usage.

For UTF-8 `.txt` and `.md`, the script reads the file and sends
`source: { type: "text", text: "..." }` through MCP. The text must contain
non-whitespace content and fit within **60,000 UTF-16 code units** (JavaScript
string length); Markdown and whitespace are preserved unchanged. This route
makes **no Files upload, deletion or OCR call**. Invoice extraction sends the
text to Mistral chat, so it still requires network access and chat quota.

On 2026-09-28, the [live text test](../test/live/docs-text.test.ts) and the CLI
example succeeded on this Markdown fixture with `ministral-3b-latest`, using no
Files or OCR calls. Vendor `ACME SAS`, total `12960` EUR, due date `2026-09-11`
and all three line quantities, unit prices and amounts were verified. This is
one synthetic invoice check, not a general accuracy or reliability score.

The local server runs the **core** profile over stdio and calls `process_document`
with `kind: invoice` and `cache: bypass`. The result must pass the exported
`ProcessDocumentOutputSchema` and have `kind: invoice`. A successful text result
has `extraction_source: "provided_text"`, `ocr_confidence: null`, `page_count: null`
and the original input in `ocr_text`. The name `ocr_text` is retained for both
source routes. `options.maxPages` and `options.minOcrConfidence` apply only to OCR
sources. Schema validation does not verify extraction accuracy: review totals,
currency, line items, due date and anomalies against your original invoice.

For direct `process_document` calls, `kind: "auto"` still uses chat for
classification when the cache is bypassed or has no matching result. Typed
extraction also uses chat. Explicit `kind: "generic"` with a text source makes
no API calls and preserves the input in both `ocr_text` and `structured_text`;
the invoice script always requests `invoice`.

If you already use [Docling](https://github.com/docling-project/docling) for local
conversion, you can supply its Markdown output as the input above. Docling is
an optional upstream step: this repository has no Docling integration,
dependency or automatic fallback. It does not make chat processing local or free.

The existing PDF/image route is also available:

```bash
node examples/invoice.mjs test/fixtures/corpus/invoice-fr-table.pdf
node examples/invoice.mjs /path/to/your-invoice.png --output result-ocr.json
```

PDF, PNG, JPEG (`.jpg`/`.jpeg`) and WebP inputs must be nonempty regular files up
to **20 MiB**, with matching extension and signature. Signature checks do not
establish that the entire document is valid. This route requires Files, OCR and
chat access/quota. Bytes go directly to the Files SDK as a private
(`visibility: user`) OCR upload; only its file ID goes through MCP. There is
**no separate OCR readiness probe**. Only a failed `process_document` response
carrying the server's safe `OCR file not ready` diagnostic is retried, at most
three times after 1, 2 and 4 seconds. The server emits this marker only for the
known OCR 422 `invalid_file` / `1901` / `Could not get file.` response. Rate limits
use the SDK retry policy; the example adds no manual 429 or other 422 retries.

The OCR route defaults to 50 pages; split longer invoices beforehand. Missing,
incomplete, invalid or low OCR confidence causes an error. Successful OCR results
have `extraction_source: "mistral_ocr"`, numeric `ocr_confidence` and `page_count`,
and OCR text in `ocr_text`. **The HTTP 429 / zero OCR quota blocker remains
unresolved.** The text route does not establish OCR availability. The
[synthetic PDF](../test/fixtures/corpus/invoice-fr-table.pdf) and
[fixture ground truth](../test/fixtures/corpus.json) describe test input and
expected content, not a captured live result or measured extraction accuracy.

Without `--output`, stdout contains only the validated JSON. With `--output`, it
contains only the absolute save destination; progress and safe errors use stderr.
The destination is exclusively created before provider calls, so existing files
(including the input) are never overwritten. Its parent directory must exist.
If extraction fails, no extraction is saved, but the reserved file may remain
empty. A write failure can leave an incomplete file. Remove it or choose a new
destination before retrying. For the PDF/image route, uploaded-file deletion
runs in `finally`, even if OCR, MCP or validation fails. If deletion fails after successful extraction, the
validated result is still printed or saved, and the process exits nonzero with a
separate stderr diagnostic asking you to remove the recent OCR upload in your
Mistral account. Do not reprocess a successfully saved invoice just to retry
cleanup. Forced process termination can prevent cleanup. Provider error bodies
and document data are not printed as diagnostics.

Commencez par la [facture Markdown synthétique](../test/fixtures/invoice-text.md)
ou votre propre facture existante en texte ou Markdown, sans document par défaut
ni téléchargement d'URL. Mettez les chemins contenant des espaces
entre guillemets. `.env` est chargé silencieusement depuis le dossier courant.
Cet exemple est **réservé à Mistral Cloud** et refuse tout endpoint personnalisé
avant les appels fournisseur. **Chaque parcours facture** exige une clé Mistral,
un accès et du quota de chat. Les appels utilisent votre compte existant et
peuvent être facturés ; le script n'active aucune facturation et ne garantit pas
la gratuité.

Pour `.txt` et `.md` en UTF-8, le script lit le fichier et transmet
`source: { type: "text", text: "..." }` via MCP. Le texte doit contenir autre
chose que des espaces et tenir dans **60 000 unités de code UTF-16** (la longueur
d'une chaîne JavaScript). Markdown et espaces restent inchangés. Ce parcours ne
fait **aucun téléversement ni suppression Files, ni appel OCR**. L'extraction de
facture envoie le texte au chat Mistral ; elle nécessite toujours le réseau et
du quota de chat.

Le 2026-09-28, le [test live texte](../test/live/docs-text.test.ts) et l'exemple CLI
ont réussi sur cette fixture Markdown avec `ministral-3b-latest`, sans appel Files
ni OCR. Fournisseur `ACME SAS`, total `12960` EUR, échéance `2026-09-11` et
quantités, prix unitaires et montants des trois lignes ont été vérifiés. Il s'agit
d'une facture synthétique, pas d'un score général de précision ou de fiabilité.

Le serveur local utilise le profil **core** en stdio, `process_document`,
`kind: invoice` et `cache: bypass`. Le résultat doit respecter
`ProcessDocumentOutputSchema` et avoir `kind: invoice`. Un résultat texte réussi
contient `extraction_source: "provided_text"`, `ocr_confidence: null`,
`page_count: null` et le texte d'entrée inchangé dans `ocr_text`. Ce nom est conservé
pour les deux parcours. `options.maxPages` et `options.minOcrConfidence` ne
s'appliquent qu'aux sources OCR. La validation du schéma ne vérifie pas la
précision : contrôlez total, devise, lignes, échéance et anomalies sur l'original.

Pour les appels directs à `process_document`, `kind: "auto"` utilise toujours le
chat pour classifier sans résultat en cache ou si le cache est contourné.
L'extraction typée utilise aussi le chat. Un `kind: "generic"` explicite avec une
source texte ne fait aucun appel API et conserve l'entrée dans `ocr_text` et
`structured_text` ; le script facture demande toujours `invoice`.

Si vous utilisez déjà [Docling](https://github.com/docling-project/docling) pour
une conversion locale, vous pouvez fournir le Markdown produit comme entrée.
C'est une étape optionnelle en amont : ce dépôt n'a ni intégration Docling,
ni dépendance, ni repli automatique. Elle ne rend pas le chat local ou gratuit.

Le parcours PDF/image des commandes ci-dessus reste disponible : PDF, PNG, JPEG
(`.jpg`/`.jpeg`) et WebP, fichiers réguliers non vides de **20 Mio** maximum, avec
extension et signature concordantes. Cette vérification ne garantit pas la
validité complète du document. Ce parcours nécessite accès et quota Files, OCR
et chat. Les octets sont envoyés au SDK Files avec une visibilité limitée à
l'utilisateur ; seul l'identifiant passe par MCP. **Aucun appel OCR de
vérification séparé** n'est effectué. Seul un échec de `process_document` portant
le diagnostic sûr `OCR file not ready` déclenche trois reprises maximum après
1, 2 et 4 secondes. Ce marqueur est réservé à l'erreur OCR 422
`invalid_file` / `1901` / `Could not get file.`. Les autres erreurs 422 ne sont pas
reprises ; les erreurs 429 restent gérées par le SDK.

Le parcours OCR se limite à 50 pages par défaut ; découpez les factures plus
longues. Une confiance OCR absente, incomplète, invalide ou trop faible provoque
un échec. Un résultat OCR réussi contient `extraction_source: "mistral_ocr"`,
une confiance `ocr_confidence` et un nombre de pages `page_count` numériques, et
le texte OCR dans `ocr_text`. **Le blocage HTTP 429 / quota OCR nul reste non
résolu.** Le parcours texte ne démontre pas la disponibilité OCR. Le
[PDF synthétique](../test/fixtures/corpus/invoice-fr-table.pdf) et sa
[vérité terrain](../test/fixtures/corpus.json) décrivent l'entrée et le contenu
attendu, pas un résultat réel capturé ni une précision mesurée.

Stdout contient uniquement le JSON validé ou le chemin absolu du résultat ; les
messages vont sur stderr. La destination est créée exclusivement avant les appels,
sans écrasement. Son dossier doit exister. En cas d'échec de l'extraction, aucune
extraction n'est sauvegardée, mais le fichier réservé peut rester vide. Une erreur
d'écriture peut laisser un fichier incomplet : supprimez-le ou changez de
destination pour réessayer. Pour le parcours PDF/image, la suppression du fichier
distant est tentée dans `finally`, même en cas d'erreur. Si elle échoue après une extraction réussie, le résultat validé est
quand même affiché ou sauvegardé ; le programme termine avec un code non nul et
un diagnostic séparé pour permettre une suppression manuelle. Ne relancez pas une
extraction réussie uniquement pour le nettoyage. Un arrêt forcé peut empêcher ce
nettoyage. Les diagnostics n'affichent ni corps d'erreur du fournisseur ni contenu
du document.

## Meeting / Réunion

```bash
node examples/workflows.mjs meeting https://YOUR_HOST/synthetic-meeting.mp3
```

Supply your own authorized recording at a public HTTPS URL. Inspect text and
segments when returned. No audio fixture or live validation is bundled here.
Fournissez un enregistrement autorisé. Aucun résultat réel n'est garanti par cet exemple.

## Sources / Recherche documentaire

```bash
node examples/workflows.mjs sources EXISTING_LIBRARY_ID "Summarize the documents and cite your sources."
```

Use an existing Studio library containing synthetic documents; `libraries_list`
provides IDs. Original content blocks preserve references when the API supplies
them. `store: false` does not delete the library: clean it up separately if needed.

Utilisez une bibliothèque Studio existante. Les références renvoyées par l'API
sont conservées. Le script ne crée ni ne supprime de bibliothèque.

## Chat smoke test / Test de conversation

```bash
node examples/try-it.mjs --local
node examples/try-it.mjs
```

`--local` uses the local build; the default uses the published npm package.
Both make a real chat call. Set `MISTRAL_DEFAULT_MODEL` to an available model.
Les deux variantes font un appel réel ; choisissez un modèle accessible à votre compte.
