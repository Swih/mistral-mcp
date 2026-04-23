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
 * Shared chat sampling params (temperature/top_p/max_tokens).
 * Re-exported as a plain object spread into `inputSchema`.
 */
export const ChatSamplingParams = {
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
};
