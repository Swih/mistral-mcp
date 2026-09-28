---
name: french-meeting-minutes
description: Transforme des notes, une transcription ou un enregistrement accessible en compte-rendu de réunion en français, avec décisions, actions et points ouverts.
---

# Compte-rendu de réunion en français

Pour du texte, utilise directement le prompt `french_meeting_minutes`, puis `mistral_chat`. Pour un enregistrement, commence par `voxtral_transcribe`. Ces deux outils sont disponibles dans `core`, `metier-docs` et `admin` ; le chat seul est aussi exposé dans `self-hosted`. Consulte `mistral://capabilities` en cas d'outil absent.

## Transcrire si nécessaire

Appelle `voxtral_transcribe` avec une URL audio accessible au fournisseur :

```json
{
  "audio": { "type": "file_url", "fileUrl": "https://example.com/reunion.mp3" },
  "diarize": true,
  "timestampGranularities": ["segment"]
}
```

Pour un fichier audio déjà téléversé, utilise `audio: {type: "file", fileId: "<identifiant audio>"}`. Ajoute `language: "fr"` seulement si la langue est connue ; sinon omets cette option. Un chemin local ne remplace pas `fileUrl`. Si aucune route de téléversement audio n'est disponible, demande une URL accessible, un identifiant audio existant ou une transcription. `files_upload` n'accepte pas `purpose: "audio"` dans son schéma actuel.

Après vérification de `isError`, récupère `structuredContent.text`. Les segments facultatifs contiennent `speaker_id`, `text`, `start` et `end` ; conserve ces repères si l'attribution des actions en dépend. Un identifiant de locuteur n'établit pas son identité.

## Produire le compte-rendu

Récupère le prompt MCP `french_meeting_minutes` avec `transcript` et `length` : `courte`, `moyenne` par défaut, ou `detaillee`. Convertis chaque message texte retourné en `{role, content: message.content.text}` et fournis ces messages à `mistral_chat`. Omet `model` pour respecter le modèle configuré ; ne change pas de modèle sur un seuil de longueur supposé.

Vérifie `isError`, puis relis `structuredContent.text` contre la transcription. Le compte-rendu comporte : contexte, participants, décisions prises, actions à mener au format `[Responsable] Action — échéance`, et points ouverts. Conserve « non précisé » pour les éléments absents et distingue une proposition d'une décision prise. Si la transcription est partielle, indique la couverture réelle.
