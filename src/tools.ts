/**
 * Tool registration for mistral-mcp.
 *
 * Implements the MCP 2025-11-25 server spec:
 * - registerTool with inputSchema + outputSchema
 * - content[] + structuredContent on every return (spec requires both for backwards compat)
 * - annotations (readOnlyHint / openWorldHint / destructiveHint)
 * - isError on failures so the calling LLM can self-correct
 * - progress notifications on streaming
 *
 * Sources:
 * - https://modelcontextprotocol.io/specification/2025-11-25/server/tools
 * - https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Mistral } from "@mistralai/mistralai";
import type { CompletionEvent } from "@mistralai/mistralai/models/components/completionevent.js";
import { z } from "zod";
import {
  CHAT_MODELS,
  ChatModelSchema,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  EmbedModelSchema,
} from "./models.js";
import type { MistralProfile } from "./profile.js";
import {
  ChatSamplingParams,
  ResponseFormatSchema,
  TextMessageSchema,
  UsageSchema,
  errorResult,
  extractTextAndReasoning,
  mapUsage,
  toSdkResponseFormat,
  toTextBlock,
} from "./shared.js";

// ---------- output schemas (exported for contract tests) ----------

export const ChatOutputShape = {
  text: z.string(),
  model: z.string(),
  usage: UsageSchema.optional(),
  finish_reason: z.string().optional(),
  reasoning_content: z
    .string()
    .optional()
    .describe(
      "Reasoning trace returned by Magistral models. Absent for non-reasoning models."
    ),
};
export const ChatOutputSchema = z.object(ChatOutputShape);

export const ChatStreamOutputShape = {
  text: z.string(),
  model: z.string(),
  chunks: z.number().int(),
  finish_reason: z.string().optional(),
  usage: UsageSchema.optional(),
  reasoning_content: z.string().optional(),
};
export const ChatStreamOutputSchema = z.object(ChatStreamOutputShape);

export const EmbedOutputShape = {
  vectors: z.array(z.array(z.number())),
  dimensions: z.number().int(),
  model: z.string(),
  usage: UsageSchema.optional(),
};
export const EmbedOutputSchema = z.object(EmbedOutputShape);

// ---------- registration ----------

export function registerMistralTools(
  server: McpServer,
  mistral: Mistral,
  profile: MistralProfile = "core"
) {
  if (profile === "workflows") return;

  // ========== mistral_chat (non-streaming) ==========
  server.registerTool(
    "mistral_chat",
    {
      title: "Mistral chat completion",
      description: [
        "Generate a chat completion using a Mistral model.",
        "",
        "When to use:",
        "- Drafting French (or any European-language) content where Mistral shines.",
        "- Codestral for code-specific generation/review.",
        "- Ministral for cheap / low-latency classification.",
        "",
        "Returns structured content with the assistant text and token usage.",
        "Does NOT stream — use mistral_chat_stream for long outputs with progress updates.",
      ].join("\n"),
      inputSchema: {
        messages: z
          .array(TextMessageSchema)
          .min(1)
          .describe("Chat messages in role/content form."),
        model: ChatModelSchema.optional().describe(
          `Mistral chat model alias. Allowed: ${CHAT_MODELS.join(", ")}. Default: ${DEFAULT_CHAT_MODEL}.`
        ),
        response_format: ResponseFormatSchema.optional().describe(
          'Force a structured output: `{type:"json_object"}` for JSON mode, `{type:"json_schema", json_schema:{...}}` for strict schema mode.'
        ),
        reasoning_effort: z
          .enum(["none", "high"])
          .optional()
          .describe(
            "Controls reasoning depth for Magistral models. 'high' enables full chain-of-thought; 'none' disables it. Ignored on non-reasoning models."
          ),
        ...ChatSamplingParams,
      },
      outputSchema: ChatOutputShape,
      annotations: {
        title: "Mistral chat completion",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // LLM outputs vary with temperature > 0
        openWorldHint: true, // calls external API
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_CHAT_MODEL;
        const res = await mistral.chat.complete({
          model,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
          randomSeed: input.seed,
          responseFormat: toSdkResponseFormat(input.response_format),
          reasoningEffort: input.reasoning_effort,
        });

        const choice = res.choices?.[0];
        const { text, reasoning_content } = extractTextAndReasoning(
          choice?.message?.content
        );

        const structured = {
          text,
          model,
          usage: mapUsage(res.usage),
          finish_reason: choice?.finishReason ?? undefined,
          reasoning_content,
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_chat", err);
      }
    }
  );

  if (profile === "full") {
  // ========== mistral_chat_stream (streaming with progress) ==========
  server.registerTool(
    "mistral_chat_stream",
    {
      title: "Mistral chat (streaming)",
      description: [
        "Like mistral_chat but streams tokens as they arrive.",
        "",
        "The client must pass _meta.progressToken to receive notifications/progress events",
        "for each streamed chunk. Final return payload is the assembled text.",
        "",
        "Use when: the expected completion is long (> ~500 tokens) or the calling UI",
        "wants live output. Otherwise use mistral_chat.",
      ].join("\n"),
      inputSchema: {
        messages: z.array(TextMessageSchema).min(1),
        model: ChatModelSchema.optional(),
        response_format: ResponseFormatSchema.optional(),
        ...ChatSamplingParams,
      },
      outputSchema: ChatStreamOutputShape,
      annotations: {
        title: "Mistral chat (streaming)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => {
      try {
        const model = input.model ?? DEFAULT_CHAT_MODEL;
        const stream = await mistral.chat.stream({
          model,
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
          randomSeed: input.seed,
          responseFormat: toSdkResponseFormat(input.response_format),
        });

        const progressToken = extra._meta?.progressToken;
        const parts: string[] = [];
        const reasoningParts: string[] = [];
        let chunks = 0;
        let lastUsage: z.infer<typeof UsageSchema> | undefined;
        let finishReason: string | undefined;

        for await (const event of stream as AsyncIterable<CompletionEvent>) {
          const data = event.data;
          const choice = data.choices?.[0];
          const delta = choice?.delta?.content;
          // Magistral streams reasoning as ThinkChunk arrays interleaved with TextChunks.
          const split = extractTextAndReasoning(delta);
          const deltaText = split.text;

          if (split.reasoning_content) {
            reasoningParts.push(split.reasoning_content);
          }

          if (deltaText) {
            parts.push(deltaText);
            chunks++;
            if (progressToken !== undefined) {
              // Per MCP spec 2025-11-25 basic/utilities/progress.
              await extra.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: chunks,
                  message: deltaText,
                },
              });
            }
          }
          if (choice?.finishReason) {
            finishReason = choice.finishReason;
          }
          if (data.usage) {
            lastUsage = mapUsage(data.usage);
          }
        }

        const text = parts.join("");
        const reasoning_content =
          reasoningParts.length > 0 ? reasoningParts.join("") : undefined;
        const structured = {
          text,
          model,
          chunks,
          finish_reason: finishReason,
          usage: lastUsage,
          reasoning_content,
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_chat_stream", err);
      }
    }
  );

  // ========== mistral_embed ==========
  server.registerTool(
    "mistral_embed",
    {
      title: "Mistral embeddings",
      description: [
        "Generate embeddings for one or more strings via the mistral-embed model.",
        "",
        "Returns one 1024-dimensional vector per input, plus token usage.",
        "",
        "Warning: embedding payloads can be large. For > 50 inputs, consider batching",
        "client-side and storing vectors yourself instead of routing through the MCP",
        "tool channel.",
      ].join("\n"),
      inputSchema: {
        inputs: z
          .array(z.string().min(1))
          .min(1)
          .max(100)
          .describe("Strings to embed. Capped at 100 per call."),
        model: EmbedModelSchema.optional(),
      },
      outputSchema: EmbedOutputShape,
      annotations: {
        title: "Mistral embeddings",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_EMBED_MODEL;
        const res = await mistral.embeddings.create({
          model,
          inputs: input.inputs,
        });

        const vectors: number[][] = (res.data ?? [])
          .map((d: { embedding?: number[] | null }) => d.embedding ?? [])
          .filter((v: number[]) => v.length > 0);

        const dimensions = vectors[0]?.length ?? 0;

        const structured = {
          vectors,
          dimensions,
          model,
          usage: mapUsage(res.usage),
        };

        // Text fallback: a compact summary — not the raw 1024-float arrays
        // (those are in structuredContent.vectors for clients that parse it).
        const summary = `Embedded ${vectors.length} input(s) into ${dimensions}-dim vectors via ${model}.`;

        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_embed", err);
      }
    }
  );
  } // end profile === "full"
}
