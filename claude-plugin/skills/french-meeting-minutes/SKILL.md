---
description: Génère un compte-rendu de réunion structuré en français à partir d'une transcription brute ou d'un fichier audio. Utilise voxtral_transcribe pour l'audio puis le prompt mistral french_meeting_minutes. À utiliser quand l'utilisateur demande un compte-rendu, un CR, des minutes de réunion, ou résumé de meeting en français.
---

# Compte-rendu de réunion (FR)

Tu transformes des notes ou un fichier audio de réunion en compte-rendu structuré professionnel en français.

## Inputs

L'utilisateur fournit `$ARGUMENTS`. Plusieurs formats acceptés :

1. **Texte brut** : transcription déjà tapée → passe directement à l'étape 2.
2. **Chemin de fichier audio** (`.mp3`, `.wav`, `.m4a`, `.webm`, `.ogg`, `.flac`) ou URL audio → étape 1 puis étape 2.
3. **Vide** : demande à l'utilisateur la transcription ou le chemin du fichier audio.

## Workflow

### Étape 1 — Transcription (uniquement si audio)

Appelle l'outil MCP `voxtral_transcribe` :
- `audio_url` : chemin local ou URL de l'audio
- `language` : `fr` (par défaut)

Récupère le `text` du résultat. C'est ta transcription.

### Étape 2 — Compte-rendu structuré

Appelle le prompt MCP `french_meeting_minutes` exposé par le serveur `mistral` :
- `transcript` : la transcription (étape 1 ou input direct)
- `length` : `moyenne` par défaut. Demande `courte` ou `detaillee` si l'utilisateur le précise.

Le prompt génère des messages prêts à passer à `mistral_chat`. Utilise-les avec `mistral_chat` (model `mistral-medium-latest` par défaut, ou `mistral-large-latest` si `length=detaillee` ou si la transcription dépasse ~10 000 tokens).

## Output attendu

Un compte-rendu en français avec sections obligatoires :
1. **Contexte** (1-2 phrases)
2. **Participants**
3. **Décisions prises**
4. **Actions à mener** (format `[Responsable] Action — échéance`)
5. **Points ouverts**

Reste factuel, n'invente pas de participant/date/chiffre. Si une info manque, écris « non précisé ».

## Exemples d'invocation

- `/mistral-mcp:french-meeting-minutes /tmp/standup.mp3`
- `/mistral-mcp:french-meeting-minutes "Notes : Alice propose X, Bob valide, deadline jeudi..."`
- `/mistral-mcp:french-meeting-minutes` → l'utilisateur fournit ensuite l'input
