# mistral-mcp

Extrayez des données structurées de factures, contrats et autres documents via MCP.
`process_document` combine OCR Mistral, classification documentaire et extraction
typée en un appel d'outil. Le profil par défaut comprend aussi le chat, la vision,
la transcription et la complétion de code.

[English](./README.md) · [Guide de migration](./MIGRATION.md) · [Exemples](./examples/README.md) · [Déploiement](./deploy/README.md)

**Préversion source : `1.0.0-rc.1`, pas encore publiée.** npm `latest` est `0.11.0`.
Les instructions ci-dessous utilisent la compilation locale des sources.
**Rupture de compatibilité :** `core` expose désormais six outils ; les clients
d'orchestration existants doivent choisir un profil explicite.
[Migration et retour à la version publiée](./MIGRATION.md).

## Démarrage rapide : une facture locale

Prérequis : Node.js 20+, npm et une clé API Mistral avec accès et quota pour Files,
OCR et l'extraction par chat. Depuis une copie locale de la branche de préversion
`codex/document-first-v1`, exécutez à la racine du dépôt :

```bash
npm ci
npm run build
```

Définissez `MISTRAL_API_KEY` dans l'environnement ou dans un fichier `.env` local :

```dotenv
MISTRAL_API_KEY=votre_cle
```

L'exemple charge `.env` avec `dotenv`. Ne versionnez pas la clé.

```bash
npm run example:invoice -- test/fixtures/corpus/invoice-fr-table.pdf --output invoice-result.json
```

Pour votre propre PDF, la syntaxe est :

```text
node examples/invoice.mjs <local-file.pdf> [--output result.json]
```

Le script téléverse le fichier chez Mistral, appelle `process_document` avec
`kind: "invoice"` via le profil `core` par défaut du serveur local et contourne
le cache d'extraction. Il tente de supprimer le fichier téléversé dans `finally`,
y compris après un échec d'extraction. Sans `--output`, il affiche le JSON ; avec
cette option, il écrit dans un nouveau fichier et affiche son chemin. Les fichiers
existants ne sont pas écrasés. Le fichier de sortie est réservé avant les appels
API et peut rester vide après un échec ; supprimez-le ou choisissez un autre chemin
avant de réessayer. Le téléversement et le nettoyage utilisent l'API Files sans
exposer les outils admin dans `core`.

L'exemple accepte les fichiers jusqu'à 20 Mio et utilise uniquement Mistral Cloud.
Il vérifie aussi la disponibilité du fichier par un appel OCR avant l'extraction.
Ce sont des **appels API réels**, soumis aux accès, quotas et conditions de
facturation du compte ; aucun accès gratuit n'est promis. **Le blocage connu lié
à un quota OCR nul reste non résolu** : le succès du parcours facture sur l'API
réelle n'est donc pas établi pour cette préversion. Consultez les
[limites du compte](https://console.mistral.ai/limits).

Comparez le résultat à la [facture synthétique](./test/fixtures/corpus/invoice-fr-table.pdf)
et à sa [vérité terrain](./test/fixtures/corpus.json). Le corpus décrit le contenu
attendu du document, pas une sortie capturée sur l'API réelle. **La validation du
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
| `process_document` | OCR, classification optionnelle et extraction validée par schéma pour factures, contrats, documents d'identité ou texte générique |
| `mistral_ocr` | Texte OCR brut, tables, annotations et blocs optionnels depuis des PDF ou images |
| `mistral_vision` | Chat avec images fournies par URL ou base64 |
| `mistral_chat` | Complétion de chat, avec formats de réponse structurés |
| `voxtral_transcribe` | Transcription audio avec diarisation optionnelle des locuteurs |
| `codestral_fim` | Complétion de code fill-in-the-middle |

`process_document` accepte une URL de document, une image en base64 ou l'identifiant
d'un fichier téléversé. `kind` vaut `auto` (défaut), `invoice`, `contract`,
`id_document` ou `generic`. Un succès retourne un `content` lisible et un JSON
`structuredContent` ; un échec retourne `isError: true`.

- Les scores de confiance OCR absents, incomplets ou invalides provoquent une
  erreur, tout comme les scores sous `options.minOcrConfidence`. Son défaut `0.3`
  est non mesuré. La confiance OCR n'établit pas l'exactitude de l'extraction.
- `options.maxPages` vaut 50 par défaut (maximum 200). L'extraction typée refuse
  un texte OCR au-delà de 60 000 caractères : découpez le document ou choisissez
  `generic` pour le texte OCR. `options.languageHints` guide l'extraction typée,
  pas le modèle OCR.
- `options.cache: "bypass"` désactive lecture et écriture du cache. Les autres modes
  sont `read_only` et `read_write`. Les documents d'identité contournent le cache
  par défaut, y compris après classification `auto` ; un `read_write` explicite
  active leur mise en cache.
- Le cache contient les données extraites. `MISTRAL_MCP_CACHE_DIR` fixe son
  emplacement ; `MISTRAL_MCP_CACHE_TTL_HOURS` vaut 168 heures par défaut (`0`
  désactive réutilisation et nouvelles écritures). Le nettoyage est opportuniste
  lors des opérations de cache. Un bypass n'efface pas les anciennes entrées,
  et l'expiration ne garantit pas une suppression à heure fixe.

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
