/**
 * Shared schemas and helpers used across tool modules.
 *
 * MCP spec 2026-07-28:
 * - `content[]` is the human-facing fallback; `structuredContent` is the strict JSON payload.
 * - Errors must surface as `{ content, isError: true }` so the calling LLM can self-correct.
 *
 * Keep this module zod-only + pure helpers and constants. Type-only SDK
 * imports are fine here; nothing in this module may run at import time.
 */

import { z } from "zod";
import type { Mistral } from "@mistralai/mistralai";

// ---------- Common message shapes ----------

/** Chat message (text-only). Used by mistral_chat / mistral_chat_stream. */
export const TextMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]).describe(
    "Message author: system for instructions, user for requests, or assistant for prior replies."
  ),
  content: z.string().describe("Text of the message."),
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
    type: z.literal("text").describe("Identifies a text content part."),
    text: z.string().describe("Text to include in the message."),
  }),
  z.object({
    type: z.literal("image_url").describe("Identifies an image content part."),
    imageUrl: z.union([
      z
        .string()
        .describe("https URL or data:image/...;base64,... payload"),
      z.object({
        url: z.string().describe("HTTPS URL or data:image/...;base64,... payload."),
        detail: z.enum(["auto", "low", "high"]).optional().describe(
          "Image detail hint: automatic, low, or high."
        ),
      }),
    ]).describe("Image source as a URL or base64 data URI, optionally with a detail hint."),
  }),
  z.object({
    type: z.literal("document_url").describe("Identifies a document content part."),
    documentUrl: z.string().describe("URL of the PDF or document to include in the message."),
    documentName: z.string().optional().describe("Filename of the referenced document."),
  }),
]);

/** Multimodal chat message (text OR array of parts). */
export const MultimodalMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]).describe(
    "Message author: system for instructions, user for requests, or assistant for prior replies."
  ),
  content: z.union([z.string(), z.array(ContentPartSchema).min(1)]).describe(
    "Message text or an ordered list of text, image, and document content parts."
  ),
});

/** Tool-augmented message (chat with function calling). Supports the `tool` role. */
export const ToolMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable().optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string().min(1),
    type: z.literal("function").default("function"),
    function: z.object({ name: z.string().min(1), arguments: z.string() }),
  })).optional().describe("Assistant tool calls to replay before their tool-role results."),
});

export const ReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"])
  .describe("Reasoning effort; supported values depend on the selected model.");

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

function retryAfterAdvice(headers: Headers | undefined): string {
  const value = headers?.get("retry-after")?.trim();
  if (value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
    return `Retry after ${Number(value)} seconds.`;
  }
  if (value && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return `Retry after ${new Date(timestamp).toUTCString()}.`;
    }
  }
  return "Wait before retrying.";
}

const OcrFileNotReadySchema = z.union([
  z.object({
    code: z.literal("1901"),
    message: z.enum(["Could not get file", "Could not get file."]),
  }),
  z.object({
    type: z.literal("invalid_file"),
    message: z.enum(["Could not get file", "Could not get file."]),
  }),
]);

function isOcrFileNotReady(err: object): boolean {
  if (!("body" in err) || typeof err.body !== "string") return false;
  try {
    return OcrFileNotReadySchema.safeParse(JSON.parse(err.body)).success;
  } catch {
    return false;
  }
}

function apiErrorMessage(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const rawResponse = "rawResponse" in err ? err.rawResponse : undefined;
  const response = rawResponse instanceof Response ? rawResponse : undefined;
  const statusCode = "statusCode" in err ? err.statusCode : undefined;
  const status = typeof statusCode === "number" && Number.isInteger(statusCode)
    && statusCode >= 100 && statusCode <= 599 ? statusCode : response?.status;
  const headers = response?.headers
    ?? ("headers" in err && err.headers instanceof Headers ? err.headers : undefined);

  // SDK HTTP error messages embed the response body, which may echo private input.
  if (status === undefined && !("statusCode" in err) && !("rawResponse" in err) && !("body" in err)) {
    return undefined;
  }
  if (status === 401) {
    return "Authentication failed (HTTP 401). Check MISTRAL_API_KEY and the configured API endpoint.";
  }
  if (status === 403) {
    return "Access denied (HTTP 403). Check the API key's permissions and account access to the requested model or endpoint.";
  }
  if (status === 422 && isOcrFileNotReady(err)) {
    return "OCR file not ready (HTTP 422). Wait briefly, then retry with the same file ID using a bounded number of attempts. If it persists, verify that the uploaded file is available.";
  }
  if (status === 429) {
    let zeroLimit = false;
    headers?.forEach((value, name) => {
      // A zero remaining balance is temporary exhaustion, not a zero allowance.
      if (/^(?:x-)?ratelimit-limit(?:-[a-z]+)*$/.test(name) && /^0+(?:\.0+)?$/.test(value.trim())) {
        zeroLimit = true;
      }
    });
    if (zeroLimit) {
      return "API quota limit is zero (HTTP 429). Check the account's configured limits and access to the requested model before retrying; waiting alone may not resolve this.";
    }
    return `Rate limit exceeded (HTTP 429). ${retryAfterAdvice(headers)} Reduce request frequency or size; if this persists, check account quota and limits.`;
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return `API server error (HTTP ${status}). ${retryAfterAdvice(headers)} If it persists, check the provider's service status or the configured endpoint.`;
  }
  const statusText = status === undefined ? "" : ` (HTTP ${status})`;
  return `API request or response failed${statusText}. Check the request parameters, model availability, and endpoint compatibility.`;
}

export function errorResult(tool: string, err: unknown) {
  const message = apiErrorMessage(err) ?? (err instanceof Error ? err.message : String(err));
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
  temperature: z.number().min(0).max(2).optional().describe(
    "Sampling temperature: higher values make output more random; lower values make it more focused. Prefer adjusting this or top_p, not both."
  ),
  max_tokens: z.number().int().positive().optional().describe(
    "Maximum number of tokens to generate. Input tokens plus this limit must fit within the model's context length."
  ),
  top_p: z.number().min(0).max(1).optional().describe(
    "Nucleus sampling probability mass: 0.1 considers tokens in the top 10% of probability mass. Prefer adjusting this or temperature, not both."
  ),
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
  z.object({
    type: z.literal("text").describe("Generate plain text without a JSON format constraint."),
  }),
  z.object({
    type: z.literal("json_object").describe(
      "Generate JSON. Also instruct the model to produce JSON in a system or user message."
    ),
  }),
  z.object({
    type: z.literal("json_schema").describe("Generate JSON conforming to the supplied json_schema."),
    json_schema: z.object({
      name: z
        .string()
        .min(1)
        .max(64)
        .describe("Identifier for the schema; surfaced in API errors."),
      description: z.string().optional().describe("Description of the response the schema defines."),
      schema: z
        .record(z.string(), z.unknown())
        .describe("JSON Schema object the response must conform to."),
      strict: z
        .boolean()
        .optional()
        .describe(
          "If true, the API rejects responses that do not strictly match the schema."
        ),
    }).describe("Named JSON Schema and optional strictness for the generated response."),
  }),
]);

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

/**
 * Restricted subset of ResponseFormatSchema for endpoints that only accept
 * `json_schema` (e.g. OCR annotation formats). Reuses the same `json_schema`
 * inner shape so callers stay consistent.
 */
export const JsonSchemaResponseFormatSchema = z.object({
  type: z
    .literal("json_schema")
    .describe("Only json_schema is accepted by OCR annotation formats."),
  json_schema: z.object({
    name: z.string().min(1).describe("Name identifying the annotation schema."),
    description: z.string().optional().describe("Description of the annotation to extract."),
    schema: z.record(z.string(), z.unknown()).describe(
      "JSON Schema object defining the fields to extract into the annotation."
    ),
    strict: z.boolean().optional().describe(
      "Whether the annotation must strictly follow the supplied JSON Schema."
    ),
  }).describe("Named JSON Schema and optional strictness for the extracted annotation."),
});

export type JsonSchemaResponseFormat = z.infer<typeof JsonSchemaResponseFormatSchema>;

/** Translate a `json_schema`-only format to the SDK's camelCase shape. */
export function toSdkJsonSchemaFormat(format: JsonSchemaResponseFormat | undefined) {
  if (!format) return undefined;
  return {
    type: "json_schema" as const,
    jsonSchema: {
      name: format.json_schema.name,
      description: format.json_schema.description,
      schemaDefinition: format.json_schema.schema,
      strict: format.json_schema.strict,
    },
  };
}

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

// ---------- Client policy ----------

type MistralClientOptions = NonNullable<ConstructorParameters<typeof Mistral>[0]>;

/**
 * The retry policy every Mistral client in this repo must use — production and
 * tests alike.
 *
 * It lives here because it drifted. `src/index.ts` carried the full policy while
 * each live test built its own client with a partial one, and one with none at
 * all. So the suite whose whole job is to prove the wrapper survives the real
 * API was the only code the policy did not cover: the first 503 under load
 * failed the run outright, even though the SDK lists 503 in its `retryCodes`
 * and the production client would have absorbed it.
 */
export const MISTRAL_RETRY_CONFIG: NonNullable<MistralClientOptions["retryConfig"]> = {
  strategy: "backoff",
  backoff: {
    initialInterval: 500,
    maxInterval: 5000,
    exponent: 2,
    maxElapsedTime: 30_000,
  },
  retryConnectionErrors: true,
};

/** Request timeout shared by production and tests. */
export const MISTRAL_TIMEOUT_MS = 60_000;
