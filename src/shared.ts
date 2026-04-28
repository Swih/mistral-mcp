/**
 * Shared schemas and helpers used across tool modules.
 *
 * MCP spec 2025-11-25:
 * - `content[]` is the human-facing fallback; `structuredContent` is the strict JSON payload.
 * - Errors must surface as `{ content, isError: true }` so the calling LLM can self-correct.
 *
 * Keep this module zod-only + pure helpers. No SDK imports.
 */

import { z } from "zod";

// ---------- Common message shapes ----------

/** Chat message (text-only). Used by mistral_chat / mistral_chat_stream. */
export const TextMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

/**
 * Multimodal content part — shape matches `@mistralai/mistralai` SDK `ContentChunk`
 * (camelCase). Supports text + image_url + document_url.
 * - `imageUrl` can be a string (URL or data:image/...;base64,... payload) or an
 *   object with url + optional detail hint.
 * - `documentUrl` accepts a PDF/document URL (used by vision-capable chat models).
 */
export const ContentPartSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    imageUrl: z.union([
      z
        .string()
        .describe("https URL or data:image/...;base64,... payload"),
      z.object({
        url: z.string(),
        detail: z.enum(["auto", "low", "high"]).optional(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("document_url"),
    documentUrl: z.string(),
    documentName: z.string().optional(),
  }),
]);

/** Multimodal chat message (text OR array of parts). */
export const MultimodalMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(ContentPartSchema).min(1)]),
});

/** Tool-augmented message (chat with function calling). Supports the `tool` role. */
export const ToolMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});

// ---------- Usage ----------

export const UsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

/** Map a Mistral SDK usage object to our strict zod shape (all fields optional). */
export function mapUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    promptTokens: typeof r.promptTokens === "number" ? r.promptTokens : undefined,
    completionTokens:
      typeof r.completionTokens === "number" ? r.completionTokens : undefined,
    totalTokens: typeof r.totalTokens === "number" ? r.totalTokens : undefined,
  };
}

// ---------- MCP content helpers ----------

export function toTextBlock(payload: unknown) {
  return {
    type: "text" as const,
    text: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

export function errorResult(tool: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [toTextBlock(`[mistral-mcp:${tool}] ${message}`)],
    isError: true as const,
  };
}

// ---------- Sampling-common param schema ----------

/**
 * Shared chat sampling params (temperature/top_p/max_tokens/seed).
 * Re-exported as a plain object spread into `inputSchema`.
 *
 * `seed` maps to the SDK's `randomSeed` parameter — same semantics as
 * OpenAI's `seed`: deterministic sampling across calls when set.
 */
export const ChatSamplingParams = {
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  seed: z
    .number()
    .int()
    .optional()
    .describe(
      "Random seed for deterministic sampling. Maps to Mistral's `random_seed`."
    ),
};

// ---------- response_format (structured outputs) ----------

/**
 * Mistral structured outputs — either JSON mode or strict JSON Schema mode.
 *
 * Source: https://docs.mistral.ai/capabilities/structured_output/
 *
 * - `{type: "text"}` is the SDK default and equivalent to omitting the field.
 * - `{type: "json_object"}` enables JSON mode. The caller MUST also instruct
 *   the model to produce JSON via a system or user message, per the API contract.
 * - `{type: "json_schema", json_schema: {...}}` enables strict JSON Schema mode.
 *   The model is constrained to the supplied schema. Recommended for agent
 *   pipelines that need machine-parseable output without prompt-engineering.
 *
 * The wire format uses `random_seed` and `response_format` (snake_case) on
 * the HTTP boundary; the SDK's TS surface uses camelCase (`responseFormat`,
 * `jsonSchema`, `schemaDefinition`). We translate at the call site.
 */
export const ResponseFormatSchema = z.union([
  z.object({ type: z.literal("text") }),
  z.object({ type: z.literal("json_object") }),
  z.object({
    type: z.literal("json_schema"),
    json_schema: z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .describe("Identifier for the schema; surfaced in API errors."),
      description: z.string().optional(),
      schema: z
        .record(z.string(), z.unknown())
        .describe("JSON Schema object the response must conform to."),
      strict: z
        .boolean()
        .optional()
        .describe(
          "If true, the API rejects responses that do not strictly match the schema."
        ),
    }),
  }),
]);

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

/**
 * Translate our snake_case `response_format` (zod-validated) to the SDK's
 * camelCase shape. Returns `undefined` for `{type:"text"}` so the SDK uses
 * its default.
 */
export function toSdkResponseFormat(rf: ResponseFormat | undefined) {
  if (!rf) return undefined;
  if (rf.type === "text") return undefined;
  if (rf.type === "json_object") return { type: "json_object" as const };
  return {
    type: "json_schema" as const,
    jsonSchema: {
      name: rf.json_schema.name,
      description: rf.json_schema.description,
      schemaDefinition: rf.json_schema.schema,
      strict: rf.json_schema.strict,
    },
  };
}

// ---------- Reasoning content (Magistral) ----------

/**
 * Mistral reasoning models (Magistral) return `message.content` as an array
 * of chunks. `ThinkChunk` items hold the model's reasoning trace; `TextChunk`
 * items hold the visible answer. Non-reasoning models return a plain string.
 *
 * Source: https://docs.mistral.ai/capabilities/reasoning/
 *
 * This helper splits the two so callers can surface reasoning separately
 * without polluting the user-visible text.
 */
export function extractTextAndReasoning(raw: unknown): {
  text: string;
  reasoning_content?: string;
} {
  if (typeof raw === "string") {
    return { text: raw };
  }
  if (!Array.isArray(raw)) {
    return { text: raw == null ? "" : JSON.stringify(raw) };
  }

  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const chunk of raw as Array<Record<string, unknown>>) {
    if (!chunk || typeof chunk !== "object") continue;
    const type = chunk.type;
    if (type === "thinking" && Array.isArray(chunk.thinking)) {
      for (const inner of chunk.thinking as Array<Record<string, unknown>>) {
        if (inner && typeof inner === "object" && typeof inner.text === "string") {
          reasoningParts.push(inner.text);
        }
      }
    } else if (type === "text" && typeof chunk.text === "string") {
      textParts.push(chunk.text);
    }
  }

  const text = textParts.join("");
  const reasoning_content =
    reasoningParts.length > 0 ? reasoningParts.join("") : undefined;
  return { text, reasoning_content };
}
