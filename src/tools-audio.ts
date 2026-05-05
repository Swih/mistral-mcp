/**
 * v0.4 tools — audio (Voxtral STT + TTS).
 *
 * Sources:
 * - Transcription (STT): https://docs.mistral.ai/capabilities/audio/
 *   POST /v1/audio/transcriptions (SDK: mistral.audio.transcriptions.complete)
 *   Input: { model, fileUrl | fileId, language?, temperature?, diarize?, ... }
 *   (Binary uploads are not supported over MCP's JSON-RPC transport; use the
 *   Files API to upload first, then reference fileId.)
 *
 * - Speech (TTS): POST /v1/audio/speech (SDK: mistral.audio.speech.complete)
 *   Input: { input, voiceId?, responseFormat?, model?, refAudio? }
 *   Output: base64-encoded audio; we pass it back as an audio content block
 *   plus structured metadata (format + mime type).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import {
  DEFAULT_STT_MODEL,
  STT_MODELS,
  SttModelSchema,
} from "./models.js";
import type { MistralProfile } from "./profile.js";
import { UsageSchema, errorResult, mapUsage, toTextBlock } from "./shared.js";

// ---------- output schemas (exported for contract tests) ----------

const TranscriptionSegmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  score: z.number().optional(),
  speaker_id: z.string().optional(),
});

export const TranscribeOutputShape = {
  text: z.string(),
  model: z.string(),
  language: z.string().nullable(),
  segments: z.array(TranscriptionSegmentSchema).optional(),
  usage: UsageSchema.optional(),
};
export const TranscribeOutputSchema = z.object(TranscribeOutputShape);

const SPEECH_FORMATS = ["mp3", "wav", "flac", "opus", "pcm"] as const;
type SpeechFormat = (typeof SPEECH_FORMATS)[number];

const MIME_BY_FORMAT: Record<SpeechFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  opus: "audio/ogg; codecs=opus",
  pcm: "audio/L16",
};

export const SpeakOutputShape = {
  audio_base64: z.string(),
  mime_type: z.string(),
  format: z.enum(SPEECH_FORMATS),
  voice_id: z.string().optional(),
  model: z.string().optional(),
};
export const SpeakOutputSchema = z.object(SpeakOutputShape);

// ---------- STT input: document-like discriminator ----------

const AudioSourceSchema = z.union([
  z.object({
    type: z.literal("file_url"),
    fileUrl: z
      .string()
      .describe("HTTPS URL to an audio file (mp3/wav/flac/ogg/webm/m4a)."),
  }),
  z.object({
    type: z.literal("file"),
    fileId: z
      .string()
      .describe(
        "ID of an audio file previously uploaded via the Files API (purpose=audio)."
      ),
  }),
]);

// ---------- registration ----------

export function registerAudioTools(
  server: McpServer,
  mistral: Mistral,
  profile: MistralProfile = "core"
) {
  if (profile === "workflows") return;

  // ========== voxtral_transcribe ==========
  server.registerTool(
    "voxtral_transcribe",
    {
      title: "Voxtral speech-to-text",
      description: [
        "Transcribe an audio file to text using Mistral Voxtral.",
        "",
        "Accepted models:",
        STT_MODELS.map((m) => `  - ${m}`).join("\n"),
        "",
        "Audio source is one of:",
        '  - { type: "file_url", fileUrl: "https://..." }  (public URL)',
        '  - { type: "file", fileId: "<id-from-files-api>" }',
        "",
        "Options:",
        "  - `language`: ISO-639-1 hint (e.g. 'fr', 'en'). Boosts accuracy when known.",
        "  - `temperature`: sampling temperature.",
        "  - `diarize`: return per-speaker segments (default false).",
        "  - `timestampGranularities`: ['segment'] to return per-segment timestamps.",
        "  - `contextBias`: list of phrases/terms that should bias the decoder.",
        "",
        "Returns plain `text`, detected `language`, optional `segments[]`, and token usage.",
      ].join("\n"),
      inputSchema: {
        audio: AudioSourceSchema,
        model: SttModelSchema.optional().describe(
          `STT model. Default: ${DEFAULT_STT_MODEL}.`
        ),
        language: z
          .string()
          .optional()
          .describe("ISO-639-1 language hint (e.g. 'fr', 'en')."),
        temperature: z.number().min(0).max(2).optional(),
        diarize: z.boolean().optional(),
        timestampGranularities: z
          .array(z.enum(["segment"]))
          .optional()
          .describe("Only 'segment' is currently supported."),
        contextBias: z.array(z.string()).optional(),
      },
      outputSchema: TranscribeOutputShape,
      annotations: {
        title: "Voxtral speech-to-text",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_STT_MODEL;
        const request: {
          model: string;
          fileUrl?: string;
          fileId?: string;
          language?: string;
          temperature?: number;
          diarize?: boolean;
          timestampGranularities?: Array<"segment">;
          contextBias?: string[];
        } = { model };
        if (input.audio.type === "file_url") request.fileUrl = input.audio.fileUrl;
        if (input.audio.type === "file") request.fileId = input.audio.fileId;
        if (input.language !== undefined) request.language = input.language;
        if (input.temperature !== undefined) request.temperature = input.temperature;
        if (input.diarize !== undefined) request.diarize = input.diarize;
        if (input.timestampGranularities !== undefined)
          request.timestampGranularities = input.timestampGranularities;
        if (input.contextBias !== undefined) request.contextBias = input.contextBias;

        const res = await mistral.audio.transcriptions.complete(
          request as never
        );

        const segments = res.segments?.map((s) => ({
          text: s.text,
          start: s.start,
          end: s.end,
          score: s.score ?? undefined,
          speaker_id: s.speakerId ?? undefined,
        }));

        const structured = {
          text: res.text,
          model: res.model,
          language: res.language,
          segments,
          usage: mapUsage(res.usage),
        };

        return {
          content: [toTextBlock(res.text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("voxtral_transcribe", err);
      }
    }
  );

  if (profile === "admin") {
  // ========== voxtral_speak ==========
  server.registerTool(
    "voxtral_speak",
    {
      title: "Mistral text-to-speech",
      description: [
        "Synthesize speech from text. Returns base64-encoded audio.",
        "",
        "Inputs:",
        "  - `input`: the text to speak.",
        "  - `voiceId`: preset or custom voice id (see resource `mistral://voices`).",
        "  - `responseFormat`: mp3 (default), wav, flac, opus, or pcm.",
        "  - `model`: optional model id. Leave empty to let the API pick the default.",
        "  - `refAudio`: base64 reference audio for voice cloning (when supported).",
        "",
        "Returns `audio_base64` plus `mime_type` and echoed `format`/`voice_id`.",
      ].join("\n"),
      inputSchema: {
        input: z.string().min(1).describe("Text to synthesize."),
        voiceId: z
          .string()
          .optional()
          .describe(
            "Voice id or slug (see mistral://voices). Omit for the server default."
          ),
        responseFormat: z.enum(SPEECH_FORMATS).optional(),
        model: z
          .string()
          .optional()
          .describe("Optional speech model override."),
        refAudio: z
          .string()
          .optional()
          .describe(
            "Reference audio (base64) for voice cloning, when supported by the model."
          ),
      },
      outputSchema: SpeakOutputShape,
      annotations: {
        title: "Mistral text-to-speech",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const format: SpeechFormat = input.responseFormat ?? "mp3";
        const res = await mistral.audio.speech.complete({
          input: input.input,
          voiceId: input.voiceId,
          responseFormat: format,
          model: input.model,
          refAudio: input.refAudio,
          stream: false,
        });

        const audioData = (res as { audioData?: string }).audioData;
        if (typeof audioData !== "string") {
          return errorResult(
            "voxtral_speak",
            "Speech API returned a streaming response; only non-streaming output is supported here."
          );
        }

        const mime = MIME_BY_FORMAT[format];
        const audioBytes = Buffer.from(audioData, "base64").length;
        const structured = {
          audio_base64: audioData,
          mime_type: mime,
          format,
          voice_id: input.voiceId,
          model: input.model,
        };

        return {
          content: [
            toTextBlock(
              `Synthesized ${audioBytes} byte(s) of ${format} audio.`
            ),
            {
              type: "audio" as const,
              data: audioData,
              mimeType: mime,
            },
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("voxtral_speak", err);
      }
    }
  );
  } // end profile === "admin"
}
