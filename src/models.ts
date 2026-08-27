/**
 * Model identifiers this server knows about, and the schema used to validate
 * the `model` input of every tool.
 *
 * The lists below are **curated guidance, not an allow-list.** Until 0.10 they
 * were `z.enum(...)`, which rejected any identifier not literally present here
 * — client-side, before the request ever reached the API. That is the same
 * failure mode as the closed `ConfidenceScoresGranularity` enum fixed in 0.9.1:
 * Mistral ships models continuously, so a frozen enum turns "this build is
 * three months old" into "that model does not exist", with an error the calling
 * LLM cannot tell apart from a genuine typo.
 *
 * It also made `MISTRAL_BASE_URL` unusable: an OpenAI-compatible endpoint (vLLM
 * serving open weights, a token factory, a corporate gateway) names its models
 * whatever it likes — `mistralai/Mistral-Small-3.2-24B-Instruct-2506` is a
 * legitimate identifier that no Mistral Cloud alias list will ever contain.
 *
 * So `model` is now a free string. The curated list survives in the schema
 * description, which is what actually steers the calling LLM, and in
 * `mistral://models` — where the live `GET /v1/models` catalog is authoritative
 * anyway. An unknown identifier now produces a real API error instead of a
 * schema rejection.
 *
 * Only `*-latest` aliases are listed on purpose: dated variants carry
 * retirement dates, the aliases roll forward on their own.
 */

import { z } from "zod";

export const CHAT_MODELS = [
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
  "ministral-3b-latest",
  "ministral-8b-latest",
  "ministral-14b-latest",
  "magistral-medium-latest",
  "magistral-small-latest",
  "devstral-latest",
  "devstral-small-latest",
  "codestral-latest",
  "voxtral-small-latest",
] as const;

export const EMBED_MODELS = ["mistral-embed"] as const;

/**
 * Vision-capable models — accept multimodal content (text + image_url parts).
 * Source: https://docs.mistral.ai/capabilities/vision/
 */
export const VISION_MODELS = [
  "pixtral-large-latest",
  "pixtral-12b-latest",
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
] as const;

/**
 * OCR models. `mistral-ocr-latest` has pointed at OCR 4.1 since 2026-07-16;
 * `includeBlocks` needs OCR 4+ and block-level confidence scores need 4.1+.
 * Source: https://docs.mistral.ai/capabilities/document/
 */
export const OCR_MODELS = [
  "mistral-ocr-latest",
  "mistral-ocr-4-1",
  "mistral-ocr-4-0",
] as const;

/**
 * Speech-to-text (Voxtral) models.
 * Source: https://docs.mistral.ai/capabilities/audio/
 */
export const STT_MODELS = [
  "voxtral-mini-latest",
  "voxtral-small-latest",
] as const;

/**
 * Moderation classifier models.
 * Source: https://docs.mistral.ai/capabilities/guardrailing/
 */
export const MODERATION_MODELS = ["mistral-moderation-latest"] as const;

/**
 * Fill-in-the-middle code completion. FIM is a Mistral-specific endpoint
 * (`/v1/fim/completions`), not part of the OpenAI-compatible surface.
 * Source: https://docs.mistral.ai/capabilities/code_generation/
 */
export const FIM_MODELS = ["codestral-latest"] as const;

/**
 * Function-calling-capable models.
 * Source: https://docs.mistral.ai/capabilities/function_calling/
 */
export const TOOL_CAPABLE_MODELS = [
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
  "ministral-3b-latest",
  "ministral-8b-latest",
  "ministral-14b-latest",
  "magistral-medium-latest",
  "magistral-small-latest",
  "devstral-latest",
  "devstral-small-latest",
  "codestral-latest",
  "voxtral-small-latest",
] as const;

/**
 * Builds the `model` schema for a tool. Any non-empty identifier is accepted;
 * the known aliases go in the description, which is what the calling LLM reads.
 *
 * The 200-char ceiling is a sanity bound, not a business rule — it keeps a
 * pasted document out of the field without constraining any real model name.
 */
function modelSchema(known: readonly string[], kind: string) {
  return z
    .string()
    .min(1)
    .max(200)
    .describe(
      `${kind} model identifier. Any identifier your endpoint serves is accepted — ` +
        `read mistral://models for the live catalog. Known Mistral aliases: ` +
        `${known.join(", ")}.`
    );
}

export const ChatModelSchema = modelSchema(CHAT_MODELS, "Chat");
export const EmbedModelSchema = modelSchema(EMBED_MODELS, "Embedding");
export const FimModelSchema = modelSchema(FIM_MODELS, "FIM (fill-in-the-middle)");
export const ToolModelSchema = modelSchema(TOOL_CAPABLE_MODELS, "Function-calling");
export const VisionModelSchema = modelSchema(VISION_MODELS, "Vision");
export const OcrModelSchema = modelSchema(OCR_MODELS, "OCR");
export const SttModelSchema = modelSchema(STT_MODELS, "Speech-to-text");
export const ModerationModelSchema = modelSchema(MODERATION_MODELS, "Moderation");

const FALLBACK_CHAT_MODEL = "mistral-medium-latest";

/**
 * Chat/tool-calling default, overridable via `MISTRAL_DEFAULT_MODEL`.
 *
 * `.env.example` has advertised this variable since the first release but
 * nothing ever read it. It matters now: an operator pointing the server at
 * their own endpoint needs it, because `mistral-medium-latest` means nothing
 * to a self-hosted vLLM.
 *
 * Resolved lazily rather than at module load so importing this file stays
 * side-effect-free (CLAUDE.md §4) and tests can set the variable per-case.
 */
export function defaultChatModel(): string {
  return process.env.MISTRAL_DEFAULT_MODEL?.trim() || FALLBACK_CHAT_MODEL;
}

export const DEFAULT_EMBED_MODEL = "mistral-embed";
export const DEFAULT_FIM_MODEL = "codestral-latest";
export const DEFAULT_VISION_MODEL = "pixtral-large-latest";
export const DEFAULT_OCR_MODEL = "mistral-ocr-latest";
export const DEFAULT_STT_MODEL = "voxtral-mini-latest";
export const DEFAULT_MODERATION_MODEL = "mistral-moderation-latest";
