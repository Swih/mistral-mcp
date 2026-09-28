# Examples / Exemples

Run from the repository root after `npm ci` and `npm run build`.
Real examples require `MISTRAL_API_KEY` in the environment or `.env`. Check your
account allowance first: these scripts do not guarantee free provider access.

Depuis la racine, après `npm ci` et `npm run build`. Les exemples réels requièrent
`MISTRAL_API_KEY`. Vérifiez votre quota gratuit avant de les lancer.

## Offline verification / Vérification sans appel API

```bash
node dist/index.js --doctor
npm run test:package
```

The package check installs the tarball and calls only a local stub.
Le test installe le paquet et utilise uniquement un serveur local simulé.

## Invoice / Facture

```bash
node examples/invoice.mjs /path/to/your-invoice.pdf
node examples/invoice.mjs /path/to/your-invoice.png --output result.json
```

Supply your own local invoice; there is no default document or URL download.
Quote paths containing spaces. The script quietly loads `.env` from the current
directory. This example is **Mistral Cloud only**: a custom `MISTRAL_BASE_URL` is
rejected before upload. It makes real Files, OCR and extraction requests under
your existing account; it does not activate billing or guarantee free usage.

Accepted files are nonempty regular files up to **20 MiB**, with matching
extension and signature: PDF, PNG, JPEG (`.jpg`/`.jpeg`) or WebP. Signature checks
do not establish that the entire document is valid. Bytes go directly to the
Files SDK as a private (`visibility: user`) OCR upload; only its file ID goes
through MCP, never base64 in a model conversation. Only a failed `process_document`
response carrying the server's safe `OCR file not ready` diagnostic is retried,
at most three times after 1, 2 and 4 seconds. The server emits this marker only for
the known OCR 422 `invalid_file` / `1901` / `Could not get file.` response. There is
no additional OCR readiness probe on successful invoices. Rate limits use the SDK
retry policy; the example adds no manual 429 retries or other 422 retries.

The local server runs the **core** profile over stdio and calls `process_document`
with `kind: invoice` and `cache: bypass`. Its current default page limit is 50;
use smaller documents or split longer invoices beforehand. The result must pass
the exported `ProcessDocumentOutputSchema` and have `kind: invoice`. Missing or
low OCR confidence fails in the pipeline. Schema validation does not verify
extraction accuracy: review totals, currency, line items, due date and anomalies
against your original invoice.

Without `--output`, stdout contains only the validated JSON. With `--output`, it
contains only the absolute save destination; progress and safe errors use stderr.
The destination is exclusively created before provider calls, so existing files
(including the input) are never overwritten. Its parent directory must exist.
If extraction fails, no extraction is saved, but the reserved file may remain
empty. A write failure can leave an incomplete file. Remove it or choose a new
destination before retrying. Uploaded-file deletion runs in `finally`, even if
OCR, MCP or validation fails. If deletion fails after successful extraction, the
validated result is still printed or saved, and the process exits nonzero with a
separate stderr diagnostic asking you to remove the recent OCR upload in your
Mistral account. Do not reprocess a successfully saved invoice just to retry
cleanup. Forced process termination can prevent cleanup. Provider error bodies
and document data are not printed as diagnostics.

Fournissez votre propre facture locale, sans document par défaut ni téléchargement
d'URL. Mettez les chemins contenant des espaces entre guillemets. `.env` est chargé
silencieusement. Cet exemple est **réservé à Mistral Cloud** et refuse tout endpoint
personnalisé avant l'upload. Les appels utilisent votre compte existant et peuvent
être facturés ; le script n'active aucune facturation.

Formats acceptés : PDF, PNG, JPEG et WebP, fichier régulier non vide de **20 Mio**
maximum, avec extension et signature concordantes. Les octets sont envoyés au SDK
Files avec une visibilité limitée à l'utilisateur ; seul l'identifiant passe par
MCP, sans base64 dans le contexte du modèle. Seul un échec de `process_document`
portant le diagnostic sûr `OCR file not ready` déclenche trois reprises maximum
après 1, 2 et 4 secondes. Le serveur réserve ce marqueur à l'erreur OCR 422 précise
de fichier indisponible. Aucun appel OCR de vérification supplémentaire n'est
effectué. Les autres erreurs 422 ne sont pas reprises ; les erreurs 429 restent
gérées par le SDK.

Le serveur local utilise le profil **core**, `process_document`, `kind: invoice`
et `cache: bypass`, avec une limite par défaut de 50 pages. Découpez les factures
plus longues. Le schéma exporté valide le résultat ; une confiance OCR absente ou
trop faible provoque un échec. Vérifiez toujours les champs extraits sur l'original.
Stdout contient uniquement le JSON validé ou le chemin absolu du résultat ; les
messages vont sur stderr. La destination est créée exclusivement avant les appels,
sans écrasement. Son dossier doit exister. En cas d'échec de l'extraction, aucune
extraction n'est sauvegardée, mais le fichier réservé peut rester vide. Une erreur
d'écriture peut laisser un fichier incomplet : supprimez-le ou changez de
destination pour réessayer. La suppression du fichier distant est tentée même en
cas d'erreur. Si elle échoue après une extraction réussie, le résultat validé est
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
