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
node --env-file=.env examples/upload-file.mjs test/fixtures/corpus/invoice-fr-table.pdf
node examples/workflows.mjs invoice FILE_ID_FROM_UPLOAD
```

Inspect the extracted fields and OCR confidence against `test/fixtures/corpus.json`.
The example checks the response shape, not extraction accuracy. Missing OCR
confidence is an error. Delete the uploaded file afterwards with `files_delete`.

Comparez les champs extraits à la vérité terrain du corpus. Le script vérifie la
forme du résultat, pas son exactitude. Supprimez ensuite le fichier importé.

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
