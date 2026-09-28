---
name: audio-dispatch
description: Transcribe a multi-speaker recording with Voxtral and summarize decisions, actions, and open questions by speaker. Use for meeting or call recordings that need speaker attribution.
---

# Audio dispatch

`voxtral_transcribe` and `mistral_chat` are available in `core`, `metier-docs`, and `admin`. Check `mistral://capabilities` when a tool is missing.

## Transcribe

Use a provider-accessible audio URL:

```json
{
  "audio": { "type": "file_url", "fileUrl": "https://example.com/meeting.mp3" },
  "diarize": true,
  "timestampGranularities": ["segment"]
}
```

For an existing audio upload, replace `audio` with `{ "type": "file", "fileId": "<audio file ID>" }`. Add `language: "fr"` or `"en"` only when known; otherwise omit it. A local path is not a URL. Obtain an accessible URL, an existing audio file ID, or a transcript if no upload route is available. This server's `files_upload` schema does not accept `purpose: "audio"`.

Check `isError` first. Read `structuredContent.text` and optional `segments[]`: each segment has `text`, `start`, `end`, optional `score`, and optional **`speaker_id`**. Preserve timestamps and speaker IDs in the transcript. Do not map IDs to people without evidence; if diarization is absent, report that attribution is unavailable.

## Extract decisions and actions

Pass the labeled transcript to `mistral_chat` as string content in `messages`. Omit `model` to use the configured default. Ask it to extract explicit commitments, decisions, and unresolved questions, preserving speaker IDs and timestamps. Mark unspecified owners and deadlines as unknown, and distinguish proposals from accepted decisions.

For JSON output, use `response_format: {type: "json_schema", json_schema: {name: "meeting_dispatch", schema: <JSON Schema object>, strict: true}}` with a schema for the requested fields. Parse the JSON from `structuredContent.text`; it is not a separate typed dispatch payload.

Present actions by speaker with any stated deadlines, followed by decisions and open questions. Check attribution against the transcript. The `french-meeting-minutes` skill can format a requested French report from the same transcript. Custom intent labels can be requested through chat; there is no need to assume a classifier or batch deployment.
