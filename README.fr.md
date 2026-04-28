# mistral-mcp

> **Serveur MCP exposant les capacités Mistral AI à n'importe quel client MCP** — Claude Code, Cursor, Zed, Windsurf, Claude Desktop.
>
> _English version: [README.md](./README.md)_

[![npm version](https://img.shields.io/npm/v/mistral-mcp?color=brightgreen)](https://www.npmjs.com/package/mistral-mcp)
[![CI](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Swih/mistral-mcp/actions/workflows/ci.yml)
[![Glama MCP score](https://glama.ai/mcp/servers/Swih/mistral-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Swih/mistral-mcp)
[![license](https://img.shields.io/badge/license-MIT-black)](./LICENSE)
![MCP spec](https://img.shields.io/badge/MCP%20spec-2025--11--25-purple)

## Pourquoi

Mistral propose des modèles solides sur le français, le code, l'OCR, la modération, l'audio et les workflows agent, mais la plupart des IDEs compatibles MCP défaultent sur Anthropic ou OpenAI. `mistral-mcp` donne à ces capacités Mistral une surface MCP propre, pour que vous puissiez router la bonne sous-tâche sur le bon modèle sans reconstruire votre boucle agent.

L'objectif de ce repo n'est pas « encore un wrapper ». C'est un serveur MCP robuste et maintenable, avec schémas explicites, sorties prédictibles, transports flexibles et bonne couverture de tests.

## Surface actuelle (`v0.5.0`)

### Tools (22)

Génération de base :
- `mistral_chat`
- `mistral_chat_stream`
- `mistral_embed`
- `mistral_tool_call`
- `codestral_fim`

Vision et audio :
- `mistral_vision`
- `mistral_ocr`
- `voxtral_transcribe`
- `voxtral_speak`

Agents et classifieurs :
- `mistral_agent`
- `mistral_moderate`
- `mistral_classify`

Fichiers et batch :
- `files_upload`
- `files_list`
- `files_get`
- `files_delete`
- `files_signed_url`
- `batch_create`
- `batch_list`
- `batch_get`
- `batch_cancel`

Utilitaire MCP natif :
- `mcp_sample` — délègue la génération au modèle du client via MCP sampling

### Resources (2)

- `mistral://models` — allow-list acceptée + catalogue modèles live
- `mistral://voices` — catalogue des voix Voxtral (TTS) live

### Prompts (6)

Prompts curés en français :
- `french_invoice_reminder`
- `french_meeting_minutes`
- `french_email_reply`
- `french_commit_message`
- `french_legal_summary`

Prompt curé en anglais :
- `codestral_review`

Les arguments enum des prompts sont enveloppés avec `completable()`, ce qui permet aux clients MCP d'appeler la completion d'arguments via `completion/complete`.

## Points forts

- API haut niveau `McpServer` avec `inputSchema`, `outputSchema` et annotations sur chaque tool
- Double transport : stdio par défaut, Streamable HTTP pour déploiements distants
- Sorties structurées partout : `structuredContent` plus fallback texte
- Annotations OCR : `mistral_ocr` peut demander des annotations JSON au niveau document et image/bbox via Mistral Document AI
- Support MCP sampling via `mcp_sample`
- Support completion sur les arguments de prompts (enums)
- Resources et prompts enregistrés à côté des tools, pas plaqués après coup
- Retry / backoff et timeout intégrés au client Mistral SDK

## Transport

### Stdio

Mode par défaut. C'est ce qu'utilisent Claude Code et la plupart des clients MCP locaux.

```bash
node dist/index.js
```

### Streamable HTTP

Activé avec `--http` ou `MCP_TRANSPORT=http`.

```bash
MCP_TRANSPORT=http node dist/index.js
```

Variables d'environnement pertinentes :
- `MCP_HTTP_HOST` — défaut `127.0.0.1`
- `MCP_HTTP_PORT` — défaut `3333`
- `MCP_HTTP_PATH` — défaut `/mcp`
- `MCP_HTTP_TOKEN` — bearer token optionnel
- `MCP_HTTP_ALLOWED_ORIGINS` — allow-list optionnelle, séparée par virgules
- `MCP_HTTP_STATELESS=1` — mode session stateless

`/healthz` est volontairement public et ne touche pas au serveur MCP.

## Installation

Depuis npm :

```bash
npx mistral-mcp
```

Ou en installation globale :

```bash
npm install -g mistral-mcp
mistral-mcp
```

Lancer avec Docker :

```bash
docker build -t mistral-mcp:dev .
docker run -i --rm -e MISTRAL_API_KEY=votre_cle mistral-mcp:dev
```

L'image utilise un build multi-stage et garde dans le conteneur runtime uniquement les dépendances de production plus `dist/`.

Build depuis les sources :

```bash
git clone https://github.com/Swih/mistral-mcp.git
cd mistral-mcp
npm install
npm run build
```

Déclarez votre clé API :

```bash
export MISTRAL_API_KEY=votre_cle
```

Ou utilisez un `.env` à la racine. Ne le committez jamais.

## Usage dans Claude Code

```bash
claude mcp add mistral -- node /chemin/absolu/vers/mistral-mcp/dist/index.js
```

Exemple de prompt :

> Utilise `mistral_ocr` sur ce PDF, puis lance `french_meeting_minutes` sur le texte extrait.

## Développement

```bash
npm run dev
npm run build
npm run lint
npm test
npm run inspector
```

## Stratégie de tests

La suite contient actuellement 151 tests sur 4 couches :

1. Tests unitaires pour tools, resources, prompts, transport, audio, agents, files, batch et sampling
2. Tests de contrat pour les métadonnées de tools et les garanties côté MCP
3. Tests live contre l'API Mistral réelle quand `MISTRAL_API_KEY` est définie
4. Tests stdio end-to-end contre le serveur buildé

Sans `MISTRAL_API_KEY`, le défaut local est `142 tests passants` plus `9 tests gated` live/stdio.

## Structure du projet

```text
mistral-mcp/
|-- src/
|   |-- index.ts
|   |-- transport.ts
|   |-- tools.ts
|   |-- tools-fn.ts
|   |-- tools-vision.ts
|   |-- tools-audio.ts
|   |-- tools-agents.ts
|   |-- tools-files.ts
|   |-- tools-batch.ts
|   |-- tools-sampling.ts
|   |-- resources.ts
|   `-- prompts.ts
|-- test/
|-- examples/
|-- .github/workflows/ci.yml
|-- package.json
`-- tsconfig.test.json
```

## Statut

`v0.5.0` — en développement. Voir [CHANGELOG.md](./CHANGELOG.md) pour le diff complet face à `v0.4.3` :

- helpers partagés, catalogues modèles + voix live, tests de contrat
- vision + OCR
- annotations OCR document et image/bbox exposées via `mistral_ocr`
- transcription + synthèse vocale
- agents + modération + classification
- APIs files + batch
- transport Streamable HTTP + MCP sampling
- 5 prompts curés FR + 1 prompt EN + completion sur arguments de prompts
- packaging registries : publié sur npm, l'[Official MCP Registry](https://registry.modelcontextprotocol.io/), [Glama](https://glama.ai/mcp/servers/Swih/mistral-mcp) et [ClawHub](https://clawhub.ai/swih/mistral-mcp-openclaw) (skill communautaire pour OpenClaw)

## Exemples

Des scripts exécutables sont dans [`examples/`](./examples/). Voir [`examples/README.md`](./examples/README.md).

## Licence

MIT — Copyright Dayan Decamp
