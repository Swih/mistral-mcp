/**
 * Canonical list of Mistral model aliases supported by mistral-mcp.
 *
 * Source (2026-04): https://docs.mistral.ai/capabilities/function_calling/
 * ("Available Models" block) + https://docs.mistral.ai/getting-started/models/models_overview/
 *
 * We only accept `*-latest` aliases on purpose: dated variants (e.g. codestral-2501)
 * all have retirement dates. Using the latest-alias lets Mistral roll us forward.
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
 * Source: https://docs.mistral.ai/capabilities/vision/ (Available Models block).
 */
export const VISION_MODELS = [
  "pixtral-large-latest",
  "pixtral-12b-latest",
  "mistral-large-latest",
  "mistral-medium-latest",
  "mistral-small-latest",
] as const;

/**
 * OCR models — accept documents (PDF / image) and return structured markdown.
 * Source: https://docs.mistral.ai/capabilities/document/
 */
export const OCR_MODELS = ["mistral-ocr-latest"] as const;

/**
 * Fill-in-the-middle code completion models.
 * Only Codestral supports FIM at Mistral.
 * (Source: https://docs.mistral.ai/capabilities/code_generation/ — "Codestral" section)
 */
export const FIM_MODELS = ["codestral-latest"] as const;

/**
 * Function-calling-capable models, per Mistral docs.
 * Source: https://docs.mistral.ai/capabilities/function_calling/ — "Available Models" block.
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

export const ChatModelSchema = z.enum(CHAT_MODELS);
export const EmbedModelSchema = z.enum(EMBED_MODELS);
export const FimModelSchema = z.enum(FIM_MODELS);
export const ToolModelSchema = z.enum(TOOL_CAPABLE_MODELS);
export const VisionModelSchema = z.enum(VISION_MODELS);
export const OcrModelSchema = z.enum(OCR_MODELS);

export const DEFAULT_CHAT_MODEL: (typeof CHAT_MODELS)[number] =
  "mistral-medium-latest";
export const DEFAULT_EMBED_MODEL: (typeof EMBED_MODELS)[number] =
  "mistral-embed";
export const DEFAULT_FIM_MODEL: (typeof FIM_MODELS)[number] = "codestral-latest";
export const DEFAULT_TOOL_MODEL: (typeof TOOL_CAPABLE_MODELS)[number] =
  "mistral-medium-latest";
export const DEFAULT_VISION_MODEL: (typeof VISION_MODELS)[number] =
  "pixtral-large-latest";
export const DEFAULT_OCR_MODEL: (typeof OCR_MODELS)[number] = "mistral-ocr-latest";
