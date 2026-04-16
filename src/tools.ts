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
import { z } from "zod";
import {
  CHAT_MODELS,
  ChatModelSchema,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  EmbedModelSchema,
} from "./models.js";

// ---------- shared types ----------

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const UsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});

// ---------- helpers ----------

function toTextBlock(payload: unknown) {
  return {
    type: "text" as const,
    text: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

function errorResult(tool: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [toTextBlock(`[mistral-mcp:${tool}] ${message}`)],
    isError: true as const,
  };
}

// ---------- registration ----------

export function registerMistralTools(server: McpServer, mistral: Mistral) {
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
          .array(MessageSchema)
          .min(1)
          .describe("Chat messages in role/content form."),
        model: ChatModelSchema.optional().describe(
          `Mistral chat model alias. Allowed: ${CHAT_MODELS.join(", ")}. Default: ${DEFAULT_CHAT_MODEL}.`
        ),
        temperature: z.number().min(0).max(2).optional(),
        max_tokens: z.number().int().positive().optional(),
        top_p: z.number().min(0).max(1).optional(),
      },
      outputSchema: {
        text: z.string(),
        model: z.string(),
        usage: UsageSchema.optional(),
        finish_reason: z.string().optional(),
      },
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
        });

        const choice = res.choices?.[0];
        const content = choice?.message?.content ?? "";
        const text = typeof content === "string" ? content : JSON.stringify(content);

        const structured = {
          text,
          model,
          usage: res.usage
            ? {
                promptTokens: res.usage.promptTokens,
                completionTokens: res.usage.completionTokens,
                totalTokens: res.usage.totalTokens,
              }
            : undefined,
          finish_reason: choice?.finishReason ?? undefined,
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
        messages: z.array(MessageSchema).min(1),
        model: ChatModelSchema.optional(),
        temperature: z.number().min(0).max(2).optional(),
        max_tokens: z.number().int().positive().optional(),
        top_p: z.number().min(0).max(1).optional(),
      },
      outputSchema: {
        text: z.string(),
        model: z.string(),
        chunks: z.number().int(),
        usage: UsageSchema.optional(),
      },
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
        });

        const progressToken = extra._meta?.progressToken;
        const parts: string[] = [];
        let chunks = 0;
        let lastUsage: z.infer<typeof UsageSchema> | undefined;

        for await (const event of stream) {
          const data = (event as { data?: unknown }).data as
            | {
                choices?: Array<{
                  delta?: { content?: string | null };
                  finishReason?: string | null;
                }>;
                usage?: {
                  promptTokens?: number;
                  completionTokens?: number;
                  totalTokens?: number;
                };
              }
            | undefined;

          const delta = data?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            parts.push(delta);
            chunks++;
            if (progressToken !== undefined) {
              // Per MCP spec 2025-11-25 basic/utilities/progress: server-initiated
              // progress notification. We use chunk count as the `progress` scalar.
              await extra.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: chunks,
                  message: delta,
                },
              });
            }
          }
          if (data?.usage) {
            lastUsage = data.usage;
          }
        }

        const text = parts.join("");
        const structured = { text, model, chunks, usage: lastUsage };

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
      outputSchema: {
        vectors: z.array(z.array(z.number())),
        dimensions: z.number().int(),
        model: z.string(),
        usage: UsageSchema.optional(),
      },
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
          usage: res.usage
            ? {
                promptTokens: res.usage.promptTokens,
                completionTokens: res.usage.completionTokens,
                totalTokens: res.usage.totalTokens,
              }
            : undefined,
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
}
