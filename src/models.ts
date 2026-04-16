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

export const ChatModelSchema = z.enum(CHAT_MODELS);
export const EmbedModelSchema = z.enum(EMBED_MODELS);

export const DEFAULT_CHAT_MODEL: (typeof CHAT_MODELS)[number] =
  "mistral-medium-latest";
export const DEFAULT_EMBED_MODEL: (typeof EMBED_MODELS)[number] =
  "mistral-embed";
