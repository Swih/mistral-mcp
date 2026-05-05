# mistral-mcp

> **Serveur MCP pour Mistral AI — chat, OCR, audio (Voxtral), code (Codestral), vision, agents, batch et workflows durables.**
> Connectez-vous à Claude Code, Cursor, Zed, Windsurf ou Claude Desktop en une commande.
>
> _English version: [README.md](./README.md)_

[![npm version](https://img.shields.io/npm/v/mistral-mcp?color=brightgreen)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![Glama MCP score](https://glama.ai/mcp/servers/Swih/mistral-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Swih/mistral-mcp)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
![MCP spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)

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

## Pourquoi Mistral + mistral-mcp pour les entreprises européennes

`mistral-mcp` est la première intégration MCP conçue de bout en bout autour d'un fournisseur de modèles basé en UE. Pour les organisations soumises au RGPD, à DORA, aux orientations EBA, à HDS, ou à des règles de souveraineté du secteur public, c'est un vrai avantage :

- **Données traitées en UE** — Mistral héberge ses modèles sur infrastructure européenne. Pas d'exposition Cloud Act US par défaut sur votre trafic d'inférence.
- **RGPD-friendly par défaut** — `process_document` bypass automatiquement le cache pour `id_document` afin d'éviter de persister du PII. Emplacement du cache disque configurable (`MISTRAL_MCP_CACHE_DIR`) pour contrôle on-premise. Transport HTTP avec bearer token et allow-list d'origines.
- **Secteurs régulés / souverains** — banques, assurances, santé (HDS), juridique (notaires, avocats), secteur public. Le positionnement produit Mistral vous permet d'entrer dans des appels d'offres qui excluent les fournisseurs uniquement US.
- **Prompts et skills français** — déjà shippés : `french_meeting_minutes`, `french_email_reply`, `french_commit_message`, `french_legal_summary`, `french_invoice_reminder`. Intégrés, pas en option.
- **Auto-hébergeable** — stdio pour agents locaux, Docker + Streamable HTTP pour déploiements internes. Pas de saut SaaS obligatoire.
- **Tier gratuit Experiment** — l'API gratuite Mistral fournit ~1 milliard de tokens/mois, suffisant pour évaluer le vertical documentaire sans engagement.

> Avertissement : ce repo est maintenu par la communauté, ce n'est pas une intégration Mistral officielle. Il ne modifie pas les conditions contractuelles de traitement des données de Mistral — consultez [mistral.ai/terms](https://mistral.ai/terms) pour votre cas d'usage spécifique.

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
| `core` (défaut) | 8 | Usage agentique quotidien — contexte minimal |
| `admin` | 26 | Surface API complète — embeddings, streaming, batch, classify, files, agents, TTS, extraction documentaire. Pour debug, CI, scripts. |
| `workflows` | 3 | Orchestration de pipeline uniquement |
| `metier-docs` | 9 | Vertical documents — core + macro-tool `process_document` |

> `full` est accepté comme alias déprécié de `admin` pour rétro-compatibilité.

```bash
MISTRAL_MCP_PROFILE=admin npx mistral-mcp
```

---

## Tools

### Profil core (8 tools — toujours disponibles)

| Tool | Ce qu'il fait |
|---|---|
| `mistral_chat` | Complétion de chat. Supporte tous les modèles Mistral, `response_format`, `reasoning_effort` pour Magistral. |
| `mistral_vision` | Chat multimodal avec images (URL ou base64). |
| `mistral_ocr` | Document AI — extrait texte, bbox et annotations JSON depuis PDFs/images. |
| `codestral_fim` | Complétion de code fill-in-the-middle (modèle Codestral). |
| `voxtral_transcribe` | Audio → texte. Passez `diarize: true` pour la séparation par locuteur. |
| `workflow_execute` | Démarre un Mistral Workflow (exécution durable Temporal). |
| `workflow_status` | Interroge un workflow en cours — retourne `RUNNING \| COMPLETED \| FAILED \| ...`. |
| `workflow_interact` | Signale / interroge un workflow en cours. Utilisé pour les checkpoints humains-dans-la-boucle. |

### Vertical documents (`MISTRAL_MCP_PROFILE=metier-docs`)

| Tool | Ce qu'il fait |
|---|---|
| `process_document` | Macro-tool en un appel : OCR → classification (kind=auto) → extraction typée → validation → cache. Kinds : `contract` / `invoice` / `id_document` / `generic`. Retourne une union discriminée. Cache PII-safe (auto-bypass id_document). `minOcrConfidence` configurable. |

### Profil admin uniquement (+18 tools, `MISTRAL_MCP_PROFILE=admin`)

| Groupe | Tools |
|---|---|
| Génération | `mistral_chat_stream`, `mistral_embed`, `mistral_tool_call` |
| Agents | `mistral_agent`, `mistral_moderate`, `mistral_classify` |
| Audio | `voxtral_speak` (TTS) |
| Fichiers | `files_upload`, `files_list`, `files_get`, `files_delete`, `files_signed_url` |
| Batch | `batch_create`, `batch_get`, `batch_list`, `batch_cancel` |
| Sampling | `mcp_sample` (délègue la génération au modèle du client MCP) |

---

## Resources

| URI | Ce qu'elle retourne |
|---|---|
| `mistral://models` | Catalogue de modèles live + alias acceptés |
| `mistral://voices` | Catalogue de voix Voxtral TTS live |
| `mistral://workflows` | Liste live des workflows déployés (utiliser `name` comme `workflowIdentifier`) |

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

## Transport

| Mode | Comment activer | Défaut |
|---|---|---|
| **stdio** | Par défaut | `node dist/index.js` |
| **Streamable HTTP** | `MCP_TRANSPORT=http` ou flag `--http` | `127.0.0.1:3333/mcp` |

Variables HTTP : `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_PATH`, `MCP_HTTP_TOKEN` (bearer auth), `MCP_HTTP_ALLOWED_ORIGINS`, `MCP_HTTP_STATELESS=1`.

`/healthz` est public et ne touche pas au serveur MCP.

---

## Utilisation comme Mistral Connector (beta)

`mistral-mcp` embarque le transport [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/) et l'auth bearer que [Mistral Connectors](https://docs.mistral.ai/agents/tools/mcp) requièrent. Guides de déploiement Cloudflare Tunnel, Fly.io et Render dans [`examples/deploy/README.md`](./examples/deploy/).

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

> Mistral Connectors exposent **uniquement les tools** aujourd'hui. Resources, prompts, sampling et elicitation restent disponibles via les clients locaux.

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
