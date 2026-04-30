---
description: Transcribe a meeting audio file with Voxtral diarization, classify each speaker's turns by intent, and produce a per-speaker action plan. Use when the user provides a meeting or call recording with multiple speakers.
---

# Audio dispatch

Transcribes a multi-speaker audio recording with Voxtral diarization, classifies each turn, and produces structured action items and decisions per speaker.

**Profile requirements**:
- `voxtral_transcribe` — available in **core** profile (default)
- `mistral_chat` (for classification fallback) — available in **core** profile
- `files_upload` (to upload a local audio file) — requires `MISTRAL_MCP_PROFILE=full`
- `mistral_classify` (optimized classification) — requires `MISTRAL_MCP_PROFILE=full`
- `batch_create` (bulk processing of many speakers) — requires `MISTRAL_MCP_PROFILE=full`

**Core-compatible path**: if running on the default profile, classification uses `mistral_chat` with `json_schema` instead of `mistral_classify` — same quality, slightly different call shape (see Step 3).

## Steps

### Step 1 — Get the audio file

Ask the user for one of:
- A public URL to an audio file (MP3, WAV, M4A, FLAC, OGG — up to ~2h) — works with core profile
- A local file path → upload with `files_upload` (requires `MISTRAL_MCP_PROFILE=full`), note the `file_id`
- A language hint (ISO 639-1 code, e.g. `"fr"`, `"en"`) — optional, improves accuracy

### Step 2 — Transcribe with speaker diarization

Call `voxtral_transcribe` with diarization enabled:

```json
{
  "audio": {
    "type": "file_url",
    "fileUrl": "<URL>"
  },
  "diarize": true,
  "timestampGranularities": ["segment"],
  "language": "<ISO 639-1 code, or omit for auto-detection>"
}
```

For uploaded files: `"type": "file", "fileId": "<file_id>"` instead.

`structuredContent.segments` contains turns with `speakerId`, `text`, `start`, `end`, `score`.

### Step 3 — Classify speaker turns

Group segments by `speakerId`. For each speaker, concatenate their text.

**Option A — `mistral_classify` (requires `MISTRAL_MCP_PROFILE=full`):**

```json
{
  "model": "ministral-3b-latest",
  "inputs": "<speaker text>",
  "labels": ["action_item", "decision", "open_question", "context", "social"]
}
```

For >5 speakers or very long transcripts, use `batch_create` (requires `full`) to process all speakers concurrently.

**Option B — `mistral_chat` with `json_schema` (core profile, no extra flags needed):**

```json
{
  "model": "mistral-small-latest",
  "temperature": 0,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "speaker_classification",
      "schema": {
        "type": "object",
        "properties": {
          "action_items": { "type": "array", "items": { "type": "string" } },
          "decisions": { "type": "array", "items": { "type": "string" } },
          "open_questions": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["action_items", "decisions", "open_questions"]
      }
    }
  },
  "messages": [
    {
      "role": "user",
      "content": "<speaker text>\n\nExtract: (1) action items — tasks explicitly committed to, with any deadlines. (2) decisions — choices confirmed or made. (3) open questions — unresolved questions raised. Base your extraction only on the text above."
    }
  ]
}
```

### Step 4 — Build per-speaker dispatch

Aggregate results into a per-speaker structure:
- **Action items**: tasks explicitly committed to, with any mentioned deadlines
- **Decisions**: choices confirmed or made
- **Open questions**: unresolved questions raised

### Step 5 — Output

Present a summary table followed by a flat TODO list:

```
MEETING DISPATCH
────────────────────────────────────────
Duration: [Xmin]  Speakers: [N]  Segments: [N]

| Speaker | Action Items | Decisions | Open Questions |
|---------|-------------|-----------|----------------|
| spk_0   | 2           | 1         | 1              |
| spk_1   | 1           | 0         | 2              |

ACTIONS BY SPEAKER
──────────────────
[spk_0]
  □ [action item text] [deadline if mentioned]

DECISIONS
─────────
  • [decision text] (spk_X)

OPEN QUESTIONS
──────────────
  ? [question text] (spk_X)
```

Offer to pass the action items to `french_meeting_minutes` for a formatted compte-rendu, or to `mistral_chat` to draft follow-up emails per speaker.
