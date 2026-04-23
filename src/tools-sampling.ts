/**
 * MCP sampling primitive — expose the client's own LLM back to itself as a tool.
 *
 * MCP spec 2025-11-25 / 2025-06-18: `sampling/createMessage` lets a server ask
 * the client to run an LLM completion on its behalf. The client has full
 * discretion over the model and is expected to surface a human-in-the-loop
 * confirmation. This is how an MCP server can chain reasoning without
 * spending tokens on its own API key — the client's subscription pays.
 *
 * We expose it as `mcp_sample`. Calling it from inside a Mistral-backed
 * server is surprisingly useful: you can moderate or rewrite a Mistral reply
 * using the *caller's* LLM (Claude, GPT, local model, whatever) before
 * returning it.
 *
 * The server declares the `sampling` capability automatically when we call
 * `server.server.createMessage(...)`. If the connected client does not support
 * sampling, the call errors with a clear message — we forward it via the
 * standard `{ isError: true }` envelope.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- output schema (exported for contract tests) ----------

export const SampleOutputShape = {
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  model: z.string(),
  stop_reason: z.string().optional(),
};
export const SampleOutputSchema = z.object(SampleOutputShape);

// ---------- input schemas ----------

const SamplingMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().describe("Plain text message content."),
});

const ModelHintSchema = z.object({
  name: z.string().describe("Substring match on model id (e.g. 'claude', 'gpt-4')."),
});

const ModelPreferencesSchema = z.object({
  hints: z.array(ModelHintSchema).optional(),
  cost_priority: z.number().min(0).max(1).optional(),
  speed_priority: z.number().min(0).max(1).optional(),
  intelligence_priority: z.number().min(0).max(1).optional(),
});

// ---------- registration ----------

export function registerSamplingTools(server: McpServer) {
  server.registerTool(
    "mcp_sample",
    {
      title: "Delegate to the client's LLM (MCP sampling)",
      description: [
        "Ask the connected MCP client to run an LLM completion on its own model.",
        "The client picks the model, and typically surfaces a confirmation dialog.",
        "",
        "Use this when you want the client's subscription to pay (rather than this",
        "server's Mistral key) — e.g. rewriting output, moderation passes, or",
        "building agent loops that mix Mistral and the client's LLM.",
        "",
        "Fails with `isError: true` if the client does not support sampling.",
      ].join("\n"),
      inputSchema: {
        messages: z.array(SamplingMessageSchema).min(1),
        system_prompt: z.string().optional(),
        max_tokens: z
          .number()
          .int()
          .positive()
          .describe("Upper bound on tokens the client may generate."),
        temperature: z.number().min(0).max(2).optional(),
        stop_sequences: z.array(z.string()).optional(),
        include_context: z
          .enum(["none", "thisServer", "allServers"])
          .optional()
          .describe(
            "Whether the client should prepend MCP context (defaults to 'none')."
          ),
        model_preferences: ModelPreferencesSchema.optional(),
      },
      outputSchema: SampleOutputShape,
      annotations: {
        title: "MCP sampling",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await server.server.createMessage({
          messages: input.messages.map((m) => ({
            role: m.role,
            content: { type: "text" as const, text: m.content },
          })),
          systemPrompt: input.system_prompt,
          maxTokens: input.max_tokens,
          temperature: input.temperature,
          stopSequences: input.stop_sequences,
          includeContext: input.include_context,
          modelPreferences: input.model_preferences
            ? {
                hints: input.model_preferences.hints,
                costPriority: input.model_preferences.cost_priority,
                speedPriority: input.model_preferences.speed_priority,
                intelligencePriority:
                  input.model_preferences.intelligence_priority,
              }
            : undefined,
        });

        const content = res.content;
        const text =
          content && typeof content === "object" && "type" in content && content.type === "text"
            ? content.text
            : JSON.stringify(content);

        const structured = {
          role: res.role,
          text,
          model: res.model,
          stop_reason: res.stopReason ?? undefined,
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mcp_sample", err);
      }
    }
  );
}
