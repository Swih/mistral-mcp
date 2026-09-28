# mistral-mcp

Extrayez des données structurées de factures, contrats et autres documents via MCP.
`process_document` accepte du texte ou du Markdown existant pour l'extraction
typée, ou utilise l'OCR Mistral pour les PDF et images. Il peut aussi classifier
le document dans le même appel d'outil. Le profil par défaut comprend le chat,
la vision, la transcription et la complétion de code.

[English](./README.md) · [Guide de migration](./MIGRATION.md) · [Exemples](./examples/README.md) · [Déploiement](./deploy/README.md)

**Préversion source : `1.0.0-rc.1`, pas encore publiée.** npm `latest` est `0.11.0`.
Les instructions ci-dessous utilisent la compilation locale des sources.
**Rupture de compatibilité :** `core` expose désormais six outils ; les clients
d'orchestration existants doivent choisir un profil explicite. Les résultats
documentaires ajoutent le champ obligatoire `extraction_source` et des métadonnées
OCR pouvant valoir `null`.
[Migration et retour à la version publiée](./MIGRATION.md).

## Démarrage rapide : une facture existante en texte ou Markdown

Prérequis : Node.js 20+, npm et une clé API Mistral avec accès et quota de chat.
Le parcours texte n'utilise ni téléversement Files ni appel OCR. Depuis une copie
locale de la branche de préversion `codex/document-first-v1`, exécutez à la racine
du dépôt :

```bash
npm ci
npm run build
```

Définissez la clé et le modèle de chat dans l'environnement ou un fichier `.env` local :

```dotenv
MISTRAL_API_KEY=votre_cle
MISTRAL_DEFAULT_MODEL=ministral-3b-latest
```

L'exemple charge `.env` avec `dotenv`. Ne versionnez pas la clé.
`ministral-3b-latest` a été vérifié pour ce parcours sur le compte de test ;
choisissez un modèle disposant de quota sur votre compte. Le modèle par défaut
peut avoir un quota nul ; ce réglage ne garantit ni accès ni gratuité sur d'autres
comptes.

```bash
npm run example:invoice -- test/fixtures/invoice-text.md --output invoice-result.json
```

Cette commande utilise la [facture Markdown synthétique](./test/fixtures/invoice-text.md).
Pour votre propre facture existante en UTF-8 `.txt` ou `.md`, la syntaxe est :

```text
node examples/invoice.mjs <local-file.txt|local-file.md> [--output result.json]
```

Le script lit le texte localement et appelle `process_document` avec
`source: { type: "text", text: "..." }`, `kind: "invoice"` et
`options.cache: "bypass"` via le profil `core` du serveur local. Le texte doit
contenir autre chose que des espaces et tenir dans 60 000 unités de code UTF-16
(la longueur d'une chaîne JavaScript). Le Markdown et les espaces sont conservés
à l'identique. Aucun téléversement Files ni appel OCR n'est effectué ;
**l'extraction de facture envoie le texte au chat Mistral**. L'exemple utilise
uniquement Mistral Cloud et exige toujours une clé et du quota de chat ; le
traitement n'est ni entièrement local ni garanti gratuit. Consultez les
[limites du compte](https://console.mistral.ai/limits).

Sans `--output`, le script affiche le JSON validé ; avec cette option, il écrit
dans un nouveau fichier et affiche son chemin. Les fichiers existants ne sont
pas écrasés. Le fichier de sortie est réservé avant les appels API et peut rester
vide après un échec ; supprimez-le ou choisissez un autre chemin avant de réessayer.

Le 2026-09-28, le [test live texte](./test/live/docs-text.test.ts) et l'exemple CLI
ont réussi avec `ministral-3b-latest`, en utilisant uniquement le chat. Les champs
vérifiés sont le fournisseur `ACME SAS`, le total de `12960` EUR, l'échéance
`2026-09-11` et les quantités, prix unitaires et montants des trois lignes.
Cela valide une facture synthétique, pas un score général de précision ou de
fiabilité.

Pour un PDF ou une image, le parcours OCR existant reste disponible :

```bash
npm run example:invoice -- test/fixtures/corpus/invoice-fr-table.pdf --output invoice-ocr-result.json
```

Les fichiers PDF, PNG, JPEG et WebP jusqu'à 20 Mio nécessitent accès et quota pour
Files, OCR et chat. Le script téléverse le fichier, appelle `process_document`,
puis tente de supprimer le fichier dans `finally`, même après un échec
d'extraction. Aucun appel séparé de vérification OCR n'est effectué. L'upload et
le nettoyage utilisent l'API Files sans exposer les outils admin dans `core`.
**Le blocage connu HTTP 429 / quota OCR nul reste non résolu.** Le parcours texte
évite l'OCR, mais ne résout pas ce blocage et n'établit pas le succès de
l'extraction OCR sur l'API réelle pour cette préversion.

Comparez tout résultat extrait à sa source. Le
[PDF synthétique](./test/fixtures/corpus/invoice-fr-table.pdf) et sa
[vérité terrain](./test/fixtures/corpus.json) décrivent le contenu attendu,
pas une sortie capturée sur l'API réelle. **La validation du
schéma contrôle la structure et les types de la réponse ; elle ne vérifie ni
l'exactitude factuelle, ni les calculs de facture, ni le traitement fiscal, ni la
justesse comptable.** Relisez les champs extraits face à la source avant usage.

### Connecter un client MCP aux sources compilées

Utilisez la configuration stdio du client. Pour les clients au format JSON
`mcpServers` :

```json
{
  "mcpServers": {
    "mistral": {
      "command": "node",
      "args": ["/chemin/absolu/vers/mistral-mcp/dist/index.js"],
      "env": {
        "MISTRAL_API_KEY": "votre_cle",
        "MISTRAL_DEFAULT_MODEL": "ministral-3b-latest",
        "MISTRAL_MCP_PROFILE": "core"
      }
    }
  }
}
```

Remplacez le chemin par celui de votre copie locale (les barres obliques `/`
fonctionnent aussi sous Windows). Le serveur lit son environnement ; le chargement
de `.env` propre à l'exemple ne configure pas votre client MCP.

Pour utiliser la **version publiée `0.11.0`**, avec ses anciens profils :

```bash
npx -y mistral-mcp@0.11.0
```

Cette commande ne lance pas la préversion et ne fournit pas le nouvel exemple de
facture locale. Le [guide de migration](./MIGRATION.md) montre comment épingler
la version dans une configuration MCP.

## Profils

`MISTRAL_MCP_PROFILE` sélectionne l'un des cinq profils. Le défaut est `core` sur
Mistral Cloud ; un `MISTRAL_BASE_URL` personnalisé déduit `self-hosted`, sauf si
vous choisissez explicitement un profil.

| Profil | Outils | Périmètre dans `1.0.0-rc.1` |
|---|---:|---|
| `core` (défaut) | 6 | Documents, chat, vision, transcription et complétion de code |
| `metier-docs` | 17 | Profil historique conservé : les six outils core et les 11 outils d'orchestration ; contient tout l'ancien core à 16 outils |
| `workflows` | 11 | Workflows, connecteurs et découverte d'index de recherche |
| `admin` | 46 | Tous les outils implémentés par ce serveur, dont Files, Batch, Conversations et Libraries |
| `self-hosted` | 5 | Chat, chat en streaming, embeddings, appels de fonctions et vision sur un endpoint compatible |

`full` reste un alias déprécié de `admin`, pas un sixième profil. Définissez
`MISTRAL_MCP_PROFILE=metier-docs` pour conserver les outils de l'ancien core après
migration ; choisissez `workflows` pour l'orchestration seule ou `admin` pour
l'ensemble des outils. Redémarrez le serveur et actualisez la découverte des outils
après un changement de profil.

`node dist/index.js --doctor` affiche le profil et les outils locaux sans appel API.
La ressource `mistral://capabilities` décrit l'endpoint actif, les familles d'outils
et les raisons d'absence d'un outil. Aucun des deux ne prouve les accès ou quotas
du compte.

## Outils core et comportement documentaire

| Outil | Fonction |
|---|---|
| `process_document` | Texte/Markdown fourni ou OCR, classification optionnelle et extraction validée par schéma pour factures, contrats, documents d'identité ou texte générique |
| `mistral_ocr` | Texte OCR brut, tables, annotations et blocs optionnels depuis des PDF ou images |
| `mistral_vision` | Chat avec images fournies par URL ou base64 |
| `mistral_chat` | Complétion de chat, avec formats de réponse structurés |
| `voxtral_transcribe` | Transcription audio avec diarisation optionnelle des locuteurs |
| `codestral_fim` | Complétion de code fill-in-the-middle |

`process_document` accepte `source: { type: "text", text: string }`, une URL de
document, une image en base64 ou l'identifiant d'un fichier téléversé. Le texte
peut contenir du Markdown et reste inchangé ; les chaînes vides, composées
uniquement d'espaces ou dépassant 60 000 unités de code UTF-16 sont refusées pour
tous les `kind`, y compris `generic`. `kind` vaut `auto` (défaut), `invoice`,
`contract`, `id_document` ou `generic`. Un succès retourne un `content` lisible et
un JSON `structuredContent` ; un échec retourne `isError: true`.

Voici des arguments d'outil avec une entrée synthétique, pas un résultat réel :

```json
{
  "source": {
    "type": "text",
    "text": "# Invoice DEMO-001\nVendor: Example Studio\nService: 2 hours at EUR 50\nTotal due: EUR 100\nDue date: 2026-10-15\n"
  },
  "kind": "invoice",
  "options": { "cache": "bypass" }
}
```

Sans résultat en cache ou avec `cache: "bypass"`, `auto` appelle le chat pour la
classification, même avec une source texte ; `invoice`, `contract` et
`id_document` utilisent le chat pour l'extraction typée. Un `kind: "generic"`
explicite avec une source texte ne fait **aucun appel API** et renvoie le texte
fourni dans `ocr_text` et `structured_text`.

Chaque résultat réussi inclut ces champs :

| Champ | Texte / Markdown fourni | Source OCR traitée avec succès |
|---|---|---|
| `extraction_source` (obligatoire) | `"provided_text"` | `"mistral_ocr"` |
| `ocr_text` (nom conservé) | Texte d'entrée inchangé | Texte OCR |
| `ocr_confidence` | `null` | Nombre entre 0 et 1 |
| `page_count` | `null` | Nombre de pages traitées |

- `options.maxPages` et `options.minOcrConfidence` ne s'appliquent qu'aux sources
  OCR. Ils ne paginent ni ne notent le texte fourni. Pour l'OCR, les scores de
  confiance absents, incomplets ou invalides provoquent une erreur, tout comme
  les scores sous le minimum demandé. Le défaut `0.3` est non mesuré ; la
  confiance OCR n'établit pas l'exactitude de l'extraction.
- Pour l'OCR, `options.maxPages` vaut 50 par défaut (maximum 200). L'extraction
  typée refuse le texte OCR au-delà de 60 000 unités de code UTF-16 : découpez le
  document ou choisissez `generic` pour le texte OCR. La limite d'entrée des
  sources texte s'applique toujours à `generic`. `options.languageHints` guide
  l'extraction typée, pas le modèle OCR.
- `options.cache: "bypass"` désactive lecture et écriture du cache. Les autres modes
  sont `read_only` et `read_write`. Les documents d'identité contournent le cache
  par défaut, y compris après classification `auto` ; un `read_write` explicite
  active leur mise en cache.
- Le cache contient les données extraites. `MISTRAL_MCP_CACHE_DIR` fixe son
  emplacement ; `MISTRAL_MCP_CACHE_TTL_HOURS` vaut 168 heures par défaut (`0`
  désactive réutilisation et nouvelles écritures). Le nettoyage est opportuniste
  lors des opérations de cache. Un bypass n'efface pas les anciennes entrées,
  et l'expiration ne garantit pas une suppression à heure fixe.
  La version de pipeline `v1.0.0-text.1` invalide la réutilisation des anciennes
  entrées, sans garantir leur suppression immédiate.

Si vous utilisez déjà [Docling](https://github.com/docling-project/docling), il
peut servir de convertisseur local optionnel en amont pour produire du Markdown.
Transmettez ce Markdown comme source texte. Ce dépôt ne fournit ni intégration
Docling, ni dépendance, ni repli automatique. Une conversion locale ne rend pas
la classification par chat ou l'extraction typée suivante locale ou gratuite.

Le [corpus synthétique](./test/fixtures/corpus.json) distingue le texte OCR requis
des champs de facture attendus. `npm run eval:docs` les évalue séparément par de
vrais appels API. La vérité terrain n'est pas un résultat de précision live ;
les PDF synthétiques à base de texte n'établissent pas la précision sur des scans
dégradés. [Guide de développement et d'évaluation](./CONTRIBUTING.md).

## Références API et déploiement

`mistral://capabilities` décrit les outils actifs. `mistral://models` lit le
catalogue de l'endpoint et signale le fallback si l'appel API échoue.
`mistral://voices` est disponible dans `admin` ; `mistral://workflows` dans
`metier-docs`, `workflows` et `admin`. La présence au catalogue ne prouve ni accès
ni quota.

Vous pouvez héberger le processus MCP et configurer son endpoint, ses identifiants,
ses outils exposés et son cache. Par défaut, les requêtes vont vers Mistral Cloud :
héberger MCP localement ne rend pas l'inférence documentaire locale. Ces contrôles
seuls n'établissent ni résidence des données ni conformité réglementaire.

Un `MISTRAL_BASE_URL` personnalisé déduit `self-hosted` : chat, chat en streaming,
embeddings, appels de fonctions et vision, selon les capacités de l'endpoint et du
modèle. Ce profil n'inclut ni OCR ni `process_document`. Un profil explicite
remplace le profil déduit, sans ajouter les API manquantes au backend.

| Référence | Contenu |
|---|---|
| [Migration](./MIGRATION.md) | Outils retirés de core, profils explicites, retour épinglé à `0.11.0` |
| [Exemples](./examples/README.md) | Factures locales, transcription et conversations avec bibliothèques |
| [Familles d'outils](./src/profile.ts) et schémas d'entrée MCP | Liste complète des outils par profil et référence des arguments |
| [Prompts](./src/prompts.ts) | Comptes-rendus, réponses email, commits, résumés juridiques, relances facture et revue de code |
| [Déploiement](./deploy/README.md) et [.env.example](./.env.example) | Docker, Compose, Kubernetes, endpoints personnalisés, cache et HTTP |
| [Guide des connecteurs publics](./deploy/connector-public.md) | Déploiement HTTPS ; la validation de bout en bout des appels publics n'est pas établie ici |
| [Plugin Claude Code](./claude-plugin/README.md) | Plugin optionnel avec 11 skills ; sa version npm RC exacte nécessite la publication et ne lance pas la copie locale |
| [Contribuer](./CONTRIBUTING.md) | Build, tests, évaluation et contrôles de release |
| [Changelog](./CHANGELOG.md) et [politique de sécurité](./SECURITY.md) | Évolutions et signalement de sécurité |

stdio est le transport par défaut. `--http` ou `MCP_TRANSPORT=http` active
Streamable HTTP sur `127.0.0.1:3333/mcp` par défaut, avec authentification bearer
et origines autorisées configurables. OAuth intégré n'est pas fourni.
Les journaux d'audit vont sur stderr et omettent arguments et données de sortie ;
`MISTRAL_MCP_AUDIT=off` les désactive.

Les [tests des deux ères](./test/stdio/protocol-eras.test.ts) couvrent MCP 2026-07-28
et le handshake 2025 depuis les mêmes enregistrements. `npm run check:release`
vérifie le build et les tests locaux, dont le paquet installé face à une API
simulée. La validation live est distincte ; un test ignoré ne compte pas comme
succès. L'épinglage du paquet ne garantit pas la disponibilité ou la compatibilité
future du fournisseur.

[Licence MIT](./LICENSE) — Copyright Dayan Decamp.
