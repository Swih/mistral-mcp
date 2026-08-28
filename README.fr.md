# mistral-mcp

> **Serveur MCP pour Mistral AI — chat, OCR, audio (Voxtral), code (Codestral), vision, agents, batch et workflows durables.**
> Connectez-vous à Claude Code, Cursor, Zed, Windsurf ou Claude Desktop en une commande.
>
> _English version: [README.md](./README.md)_

[![npm version](https://img.shields.io/npm/v/mistral-mcp?color=brightgreen)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![Glama MCP score](https://glama.ai/mcp/servers/Swih/mistral-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Swih/mistral-mcp)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
![MCP spec](https://img.shields.io/badge/MCP%20spec-2026--07--28-purple)

---

## Ce que c'est

`mistral-mcp` expose l'API Mistral AI complète sous forme de tools, resources et prompts MCP. Un client MCP (Claude Code, Cursor, etc.) peut appeler `mistral_ocr` pour extraire le texte d'un PDF, `voxtral_transcribe` pour transcrire un enregistrement de réunion, ou `workflow_execute` pour démarrer un processus multi-étapes durable — sans quitter la boucle agent.

**Unique à Mistral, non disponible dans d'autres serveurs MCP :**
- `mistral_ocr` — Mistral Document AI : texte structuré + annotations bbox depuis n'importe quel PDF ou image
- `voxtral_transcribe` — Voxtral : transcription avec diarisation optionnelle par locuteur
- `codestral_fim` — Codestral fill-in-the-middle (FIM) pour la complétion de code inline
- `workflow_execute / status / interact` — exécution durable Temporal avec signaux humains-dans-la-boucle
- Modèles optimisés français (`mistral-large-latest`, `mistral-medium-latest`) et prompts curés en français

**Ce que ce serveur n'expose pas :** fine-tuning, gestion des utilisateurs, prompts hors FR/EN.

---

## Pourquoi c'est pertinent pour les équipes européennes

`mistral-mcp` est conçu pour les équipes qui veulent utiliser les capacités Mistral depuis des clients MCP (Claude Code, Cursor, Zed, Windsurf, Claude Desktop) tout en gardant la main sur le déploiement, les clés API, le comportement du cache et l'exposition des tools.

Cela peut être utile pour les organisations européennes qui évaluent une stack IA sous RGPD, DORA, contraintes sectorielles (HDS, EBA), ou exigences internes de souveraineté.

**Ce que ce projet apporte :**

- serveur MCP auto-hébergeable, pas de proxy SaaS obligatoire
- bring-your-own Mistral API key (BYOK) — Mistral déclare ne pas utiliser les données API pour entraîner ses modèles
- `MISTRAL_BASE_URL` route tous les appels vers votre propre endpoint OpenAI-compatible (vLLM, TGI, LiteLLM, une gateway interne) — aucun trafic vers `api.mistral.ai`
- profil `core` léger et profil `metier-docs` ciblé pour limiter l'exposition de tools
- cache `process_document` configurable par appel et via `MISTRAL_MCP_CACHE_DIR`
- bypass du cache pour les documents d'identité activé par défaut, même quand `kind:"auto"` résout en `id_document`
- transport Streamable HTTP + bearer pour déploiements contrôlés / on-premise
- prompts et skills français de série (compte-rendu de réunion, résumé juridique, relance facture, message de commit, réponse email)
- tier Experiment gratuit côté Mistral suffisant pour évaluer (~1 milliard de tokens/mois)

**Ce que ce projet ne prétend PAS être :**

- ce n'est pas une certification RGPD, DORA, HDS ou ISO, et il ne remplace ni une AIPD, ni un vendor review, ni un audit de sécurité, ni une analyse juridique
- les conditions Mistral, la résidence des données, la liste des sous-traitants, les paramètres de rétention et la gestion d'incidents doivent être revus séparément sur [mistral.ai/terms](https://mistral.ai/terms) et [legal.mistral.ai](https://legal.mistral.ai)
- ce repo est maintenu par la communauté, ce n'est pas une intégration Mistral officielle ; rien ici ne modifie vos conditions contractuelles avec Mistral

En pratique, `mistral-mcp` réduit la surface d'intégration à évaluer. Il ne remplace pas le travail juridique et conformité lui-même.

---

## Démarrage rapide

**Claude Code** (recommandé — auto-installe, demande la clé API, ship 11 skills) :
```text
/plugin install mistral-mcp@swih-plugins
```

**Cursor / Zed / Windsurf / Claude Desktop** — ajoutez à votre JSON de config MCP :
```json
{
  "mcpServers": {
    "mistral": {
      "command": "npx",
      "args": ["-y", "mistral-mcp@latest"],
      "env": { "MISTRAL_API_KEY": "votre_cle" }
    }
  }
}
```

**Enregistrement manuel Claude Code :**
```bash
claude mcp add mistral -- npx -y mistral-mcp@latest
```

---

## Profils

`MISTRAL_MCP_PROFILE` contrôle le nombre de tools exposés (défaut : `core`).

| Profil | Tools | Quand l'utiliser |
|---|---|---|
| `core` (défaut) | 13 | Usage agentique quotidien — contexte minimal |
| `admin` | 41 | Surface API complète — embeddings, streaming, batch, classify, files, agents, TTS, extraction documentaire, conversations stateful, libraries RAG. Pour debug, CI, scripts. |
| `workflows` | 8 | Orchestration de pipeline + connecteurs uniquement |
| `metier-docs` | 14 | Vertical documents — core + macro-tool `process_document` |
| `self-hosted` | 5 | Inférence sur votre propre endpoint OpenAI-compatible — déduit de `MISTRAL_BASE_URL` |

> `full` est accepté comme alias déprécié de `admin` pour rétro-compatibilité.

```bash
MISTRAL_MCP_PROFILE=admin npx mistral-mcp
```

Lisez `mistral://capabilities` depuis n'importe quel client pour savoir quelles
familles de tools sont actives, lesquelles ne le sont pas, et pourquoi — pas
besoin de comparer ce tableau à votre déploiement.

---

## Tools

### Profil core (16 tools — toujours disponibles)

| Tool | Ce qu'il fait |
|---|---|
| `mistral_chat` | Complétion de chat. Supporte tous les modèles Mistral, `response_format`, `reasoning_effort` pour Magistral. |
| `mistral_vision` | Chat multimodal avec images (URL ou base64). |
| `mistral_ocr` | Document AI — extrait texte, bbox et annotations JSON depuis PDFs/images. Passez `includeBlocks: true` pour les blocs OCR 4 au niveau paragraphe (text/title/table/image/equation/... avec bounding boxes). |
| `codestral_fim` | Complétion de code fill-in-the-middle (modèle Codestral). |
| `voxtral_transcribe` | Audio → texte. Passez `diarize: true` pour la séparation par locuteur. |
| `workflow_execute` | Démarre un Mistral Workflow (exécution durable Temporal). |
| `workflow_status` | Interroge un workflow en cours — retourne `RUNNING \| COMPLETED \| FAILED \| ...`. |
| `workflow_interact` | Signale / interroge un workflow en cours. Utilisé pour les checkpoints humains-dans-la-boucle. |
| `workflow_deployments_list` | Liste les déploiements de workflow et indique lesquels ont un worker vivant. À appeler avant `workflow_execute` — un workflow listé sans déploiement actif répond 404. |
| `workflow_runs_list` | Liste les exécutions de workflow, filtrables par workflow, statut ou déploiement. |
| `workflow_stop` | Arrête une exécution — `cancel` (gracieux, exécute les handlers de nettoyage) ou `terminate` (immédiat). |
| `connectors_list` | Découvre les Connecteurs Mistral (intégrations MCP/HTTP) visibles par l'appelant. |
| `connectors_get` | Récupère les métadonnées publiques d'un connecteur (jamais les credentials). |
| `connectors_list_tools` | Liste les tools MCP exposés par un connecteur, avec leur schéma d'entrée. |
| `connectors_call_tool` | Invoque un tool d'un connecteur — passthrough du `CallToolResult` MCP réel. |
| `rag_indexes_list` | Liste les déploiements d'index de recherche du compte, avec backend et nombre de documents. |

### Vertical documents (`MISTRAL_MCP_PROFILE=metier-docs`)

| Tool | Ce qu'il fait |
|---|---|
| `process_document` | Macro-tool en un appel : OCR → classification (kind=auto) → extraction typée → validation → cache. Kinds : `contract` / `invoice` / `id_document` / `generic`. Retourne une union discriminée. Cache PII-safe (auto-bypass id_document). `minOcrConfidence` configurable. |

### Profil admin uniquement (+28 tools, `MISTRAL_MCP_PROFILE=admin`)

| Groupe | Tools |
|---|---|
| Génération | `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call` |
| Agents | `mistral_agent`, `mistral_moderate`, `mistral_classify` |
| Audio | `voxtral_speak` (TTS) |
| Fichiers | `files_upload`, `files_list`, `files_get`, `files_delete`, `files_signed_url` |
| Batch | `batch_create`, `batch_get`, `batch_list`, `batch_cancel` |
| Conversations | `conversation_start`, `conversation_append`, `conversation_get`, `conversation_list`, `conversation_history`, `conversation_delete` — boucles agentiques multi-tours avec les tools intégrés Mistral (web_search, code_interpreter, image_generation, document_library) |
| Libraries (RAG) | `libraries_list`, `libraries_get`, `libraries_documents_list`, `libraries_documents_upload`, `libraries_documents_status` — découvre et alimente des Mistral Libraries déjà créées ; à combiner avec `documentLibraryIds` sur `conversation_start` pour les interroger |

---

## Resources

| URI | Ce qu'elle retourne |
|---|---|
| `mistral://capabilities` | Quelles familles de tools sont enregistrées, lesquelles ne le sont pas et pourquoi — plus le profil et l'endpoint actifs |
| `mistral://models` | Catalogue de modèles live, lu depuis l'endpoint réellement utilisé |
| `mistral://voices` | Catalogue de voix Voxtral TTS live — enregistrée seulement si la famille `tts` est active (`admin`) |
| `mistral://workflows` | Liste live des workflows déployés (utiliser `name` comme `workflowIdentifier`) — non enregistrée sous `self-hosted` |

---

## Prompts

Prompts curés avec arguments structurés et support de completion MCP :

| Prompt | Entrée | Sortie |
|---|---|---|
| `french_meeting_minutes` | texte de transcription | Compte-rendu de réunion structuré en français |
| `french_email_reply` | email reçu + contexte | Réponse française soignée |
| `french_commit_message` | git diff | Message Conventional Commits en français |
| `french_legal_summary` | texte juridique | Résumé en français clair + clauses clés |
| `french_invoice_reminder` | débiteur, montant, retard, ton | Lettre de relance B2B en français |
| `codestral_review` | git diff | Code review orientée sécurité / logique / style |

---

## Skills Claude Code (11)

Installez via la marketplace `swih-plugins` pour obtenir ces skills nommés :

**Routage**
- `/mistral-mcp:mistral-router` — sélectionne le bon modèle + tool Mistral pour n'importe quelle tâche

**Code**
- `/mistral-mcp:codestral-review` — récupère le diff courant, lance une review ciblée

**Workflows français**
- `/mistral-mcp:french-commit-message` — message Conventional Commits en français
- `/mistral-mcp:french-meeting-minutes` — audio ou texte → compte-rendu structuré FR
- `/mistral-mcp:french-invoice-reminder` — relance B2B avec ton contrôlé

**Traitement documents & audio**
- `/mistral-mcp:contract-analyzer` — OCR → extraction de clauses avec niveau de risque (JSON)
- `/mistral-mcp:pdf-invoice-extractor` — OCR → champs de facture structurés pour réconciliation
- `/mistral-mcp:audio-dispatch` — transcription + diarisation → plan d'action par locuteur

**Workflows humains-dans-la-boucle**
- `/mistral-mcp:contract-review-workflow` — revue de contrat durable avec portes d'approbation
- `/mistral-mcp:compliance-audit-workflow` — audit multi-étapes avec résultats intermédiaires + décisions
- `/mistral-mcp:research-pipeline-workflow` — recherche par hypothèses avec injection d'amendements

---

## Installation

```bash
# Exécution directe (sans install globale)
npx mistral-mcp

# Installation globale
npm install -g mistral-mcp && mistral-mcp

# Docker
docker build -t mistral-mcp .
docker run -i --rm -e MISTRAL_API_KEY=votre_cle mistral-mcp

# Depuis les sources
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp && npm install && npm run build
node dist/index.js
```

---

## Ingestion documentaire, évaluée

`process_document` est livré avec un corpus et un harnais, parce que « gère les
PDF hétérogènes » est une affirmation, et qu'une affirmation sans mesure est du
marketing.

```bash
npm run fixtures:generate   # régénère le corpus depuis les sources (sans clé)
npm run eval:docs           # le confronte à l'OCR réel (requiert MISTRAL_API_KEY)
```

Le corpus compte huit documents synthétiques choisis pour les cas qui cassent
réellement les pipelines d'ingestion, pas pour ceux qui les flattent : un scan
paysage pivoté (`/Rotate 90`), des tables de lignes réglées, des blocs
d'adresses en colonnes, une page blanche au milieu d'un document, du FR/EN
mélangé, des accents et le signe euro, et une page quasi vide. La vérité
terrain de chaque document — type attendu, nombre de pages, chaînes qui doivent
survivre à l'OCR — est dans `test/fixtures/corpus.json`.

Tout y est inventé : sociétés, personnes et identifiants fictifs. **Aucune
donnée personnelle réelle dans ce dépôt, et il ne faut pas en ajouter** — le
corpus n'a d'intérêt que s'il est publiable.

`npm run eval:docs` indique, par document, si `kind: "auto"` a bien classé, si
les champs requis ont survécu, et la confiance OCR. Il en dérive ensuite un
`minOcrConfidence` : le milieu entre le pire document extrait proprement et le
meilleur document marqué à faible signal. Quand les deux se recouvrent, il dit
qu'aucun seuil n'est défendable plutôt que d'en inventer un.

La valeur par défaut de `0.3` est un point de départ conservateur, **pas** une
valeur mesurée. Lancez le harnais sur vos propres documents et retenez le
nombre que ce run justifie.

---

## Observabilité

Chaque appel de tool émet une ligne JSON sur stderr, et le contexte de trace
W3C de l'appelant suit la requête jusqu'à l'endpoint d'inférence.

```json
{"ts":"2026-08-28T09:14:02.117Z","kind":"tool_call","tool":"mistral_ocr","outcome":"ok","duration_ms":1840,"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7"}
```

- **Continuité de trace.** `traceparent`, `tracestate` et `baggage` arrivent
  dans le `_meta` de la requête MCP et sont apposés sur l'appel HTTP sortant :
  votre collecteur relie le span MCP au span Mistral (ou vLLM) qu'il a causé,
  au lieu d'afficher deux traces sans lien. Un en-tête malformé est ignoré,
  jamais fatal.
- **Jamais de payload.** Une ligne dit ce qui a tourné, combien de temps, et si
  ça a échoué. Prompts, documents, transcriptions, arguments et sorties de
  modèle n'y figurent pas : ce sont vos données, et ce process n'a pas à les
  recopier dans un log qui ne lui appartient pas.
  `test/stdio/observability.test.ts` vérifie ce négatif directement sur le
  binaire compilé.
- **Rien à activer, une seule chose à désactiver.** C'est actif par défaut :
  une piste d'audit qu'il faut découvrir est une piste qu'on n'aura pas le jour
  où elle sert. `MISTRAL_MCP_AUDIT=off` la coupe. On écrit sur stderr parce que
  stdout porte le JSON-RPC, et parce que la capacité `logging` de MCP est
  dépréciée en 2026-07-28 au profit de stderr et d'OpenTelemetry.

L'instrumentation enveloppe `registerTool` plutôt que chaque handler : un tool
ne peut pas manquer à la piste d'audit sans manquer au serveur lui-même.

---

## Inférence auto-hébergée

Pointez `MISTRAL_BASE_URL` vers n'importe quel endpoint OpenAI-compatible — vLLM,
TGI, LiteLLM, une token factory interne — et toutes les requêtes y vont au lieu
d'`api.mistral.ai` :

```bash
MISTRAL_BASE_URL=http://vllm.internal:8000/v1 MISTRAL_DEFAULT_MODEL=my-org/mistral-small-3.2 npx mistral-mcp
```

Deux choses changent quand l'endpoint n'est pas celui de Mistral :

1. **Le profil devient `self-hosted`.** Seuls les cinq tools qu'un tel endpoint
   sait réellement servir restent enregistrés — `mistral_chat`,
   `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call`, `mistral_vision`.
   OCR, Voxtral, Files, Batch et Workflows sont des endpoints de la plateforme
   Mistral ; les annoncer devant vLLM ne produirait que des 404 dont le modèle
   appelant doit se dépatouiller. Fixez `MISTRAL_MCP_PROFILE` explicitement si
   votre gateway proxifie bien l'API complète.
2. **Les identifiants de modèles ne sont plus validés contre une liste.** Toute
   chaîne non vide est transmise telle quelle : les identifiants de votre
   endpoint vous appartiennent.

`mistral://capabilities` indique l'endpoint actif, le profil, s'il a été déduit,
et la raison pour laquelle chaque famille indisponible est désactivée.

Manifests Compose et Kubernetes, plus la référence complète des variables
d'environnement, dans [`deploy/README.md`](./deploy/README.md).

---

## Protocole

Le serveur parle **MCP 2026-07-28** et le handshake 2025, depuis les mêmes
enregistrements de tools, sur le même endpoint. C'est important parce que
quasiment tous les clients diffusés aujourd'hui ouvrent encore avec le
handshake 2025 : mettre le serveur à jour n'oblige personne à mettre son client
à jour.

| | Client 2025 | Client 2026-07-28 |
|---|---|---|
| Handshake | `initialize` | `server/discover` |
| Tools, resources, prompts | jeu identique | jeu identique |
| `structuredContent` + `outputSchema` | oui | oui |
| Cache hints (`ttlMs`/`cacheScope`) | absent de la révision | oui |

`test/stdio/protocol-eras.test.ts` pilote le binaire compilé avec un vrai client
1.30.x et un vrai client 2026-07-28, et vérifie que les deux voient les mêmes
tools — l'affirmation ci-dessus est un test, pas une promesse.

Basé sur `@modelcontextprotocol/server` 2.x. Aucun tool de sampling ni
d'elicitation n'est exposé : le sampling est déprécié en 2026-07-28, et son
remplaçant multi-aller-retour est une capacité client dont ce serveur n'a pas
l'usage.

---

## Transport

| Mode | Comment activer | Défaut |
|---|---|---|
| **stdio** | Par défaut | `node dist/index.js` |
| **Streamable HTTP** | `MCP_TRANSPORT=http` ou flag `--http` | `127.0.0.1:3333/mcp` |

Variables HTTP : `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH`, `MCP_HTTP_TOKEN` (bearer auth), `MCP_HTTP_ALLOWED_ORIGINS`.

Le service HTTP est stateless par requête dans les deux ères du protocole : `MCP_HTTP_STATELESS` ne fait donc plus rien et a été retiré en 0.10.0. Le définir reste sans effet.

`/healthz` est public et ne touche pas au serveur MCP.

---

## Utilisation comme Mistral Connector (beta)

`mistral-mcp` embarque le transport [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/) et l'auth bearer que [Mistral Connectors](https://docs.mistral.ai/agents/tools/mcp) requièrent. Guides de déploiement Cloudflare Tunnel, Fly.io et Cloud Run dans [`deploy/connector-public.md`](./deploy/connector-public.md).

| Surface | Statut |
|---|---|
| Clients MCP locaux (Claude Code, Cursor, Zed, Windsurf, Claude Desktop) | Stable |
| Transport Streamable HTTP + auth bearer | Testé localement (handshake + 401 + initialize vérifiés) |
| Enregistrement Connector via `POST /v1/connectors` | **Guide fourni — Connectors est une feature beta, l'API peut évoluer** |
| Appels Connector depuis Conversations/Agents | Non testé end-to-end (nécessite un déploiement HTTPS public) |
| Auth Connector OAuth 2.1 | À venir — bearer uniquement aujourd'hui |

```bash
curl -X POST https://api.mistral.ai/v1/connectors \
  -H "Authorization: Bearer $MISTRAL_API_KEY" \
  -d '{"name":"mistral_self","server":"https://votre-deploy/mcp","visibility":"private"}'
```

> Mistral Connectors exposent **uniquement les tools** aujourd'hui. Resources et prompts restent disponibles via les clients locaux.

---

## Comparaison avec d'autres serveurs MCP Mistral

| Projet | Périmètre | Idéal pour |
|---|---|---|
| **mistral-mcp** | API Mistral complète + Workflows + 11 skills Claude Code | Tout-en-un auto-hébergé |
| `mcp-mistral-ocr` (communauté) | OCR uniquement | Setup OCR léger |
| Speakeasy `mistral-mcp-server-example` | Démo générée | Référence / template SDK |
| Composio `mistral_ai` toolkit | Tools Mistral routés en SaaS | Hébergé, sans infra |

`mistral-mcp` se différencie en combinant OCR, diarisation Voxtral, FIM Codestral, et Workflows durables Temporal dans un seul serveur, avec prompts français par défaut et une marketplace de plugins Claude Code.

---

## Développement

```bash
npm run dev      # tsx watch
npm run build    # tsc → dist/
npm run lint     # tsc --noEmit
npm test         # 190+ tests (unit + contract + stdio e2e + live API)
npm run inspector
```

Pyramide de tests : unit → contract → stdio e2e → live API (nécessite `MISTRAL_API_KEY`).

---

## Licence

MIT — Copyright Dayan Decamp
