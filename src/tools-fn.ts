/**
 * v0.3 tools — function calling (tool use) and Codestral FIM.
 *
 * Sources:
 * - Function calling API contract: https://docs.mistral.ai/capabilities/function_calling/
 *   (tool schema OpenAI-compatible, toolChoice: "auto"|"any"|"none"|"required"|{type,function},
 *    parallelToolCalls boolean)
 * - FIM API contract: https://docs.mistral.ai/capabilities/code_generation/ — Codestral
 *   (mistral.fim.complete({ model: "codestral-latest", prompt, suffix }))
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Mistral } from "@mistralai/mistralai";
import type { ChatCompletionRequest } from "@mistralai/mistralai/models/components/chatcompletionrequest.js";
import { z } from "zod";
import {
  DEFAULT_FIM_MODEL,
  DEFAULT_TOOL_MODEL,
  FimModelSchema,
  ToolModelSchema,
} from "./models.js";
import type { MistralProfile } from "./profile.js";
import {
  ChatSamplingParams,
  ResponseFormatSchema,
  ToolMessageSchema,
  UsageSchema,
  errorResult,
  extractTextAndReasoning,
  mapUsage,
  toSdkResponseFormat,
  toTextBlock,
} from "./shared.js";

const FunctionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(64),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()),
  }),
});

const ToolChoiceSchema = z.union([
  z.enum(["none", "auto", "any", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

// ---------- output schemas (exported for contract tests) ----------

export const ToolCallOutputShape = {
  tool_calls: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      arguments: z.string(),
    })
  ),
  text: z.string().optional(),
  model: z.string(),
  finish_reason: z.string().optional(),
  usage: UsageSchema.optional(),
};
export const ToolCallOutputSchema = z.object(ToolCallOutputShape);

export const FimOutputShape = {
  text: z.string(),
  model: z.string(),
  finish_reason: z.string().optional(),
  usage: UsageSchema.optional(),
};
export const FimOutputSchema = z.object(FimOutputShape);

export function registerFunctionTools(
  server: McpServer,
  mistral: Mistral,
  profile: MistralProfile = "core"
) {
  if (profile === "workflows") return;

  if (profile === "admin") {
  // ========== mistral_tool_call ==========
  server.registerTool(
    "mistral_tool_call",
    {
      title: "Mistral function calling",
      description: [
        "Run a chat completion with function-calling enabled.",
        "",
        "The model inspects the provided `tools` (OpenAI-style function schemas)",
        "and decides whether to emit one or more `tool_calls`. This tool does NOT",
        "execute the tools — it only returns the model's decision and arguments,",
        "which the caller then routes to the appropriate local handlers.",
        "",
        "Use when: building agent loops where Mistral picks actions from a tool catalog.",
        "Supported models (via Mistral docs): mistral-*/magistral-*/ministral-*/devstral-*/codestral-*.",
      ].join("\n"),
      inputSchema: {
        messages: z.array(ToolMessageSchema).min(1),
        tools: z.array(FunctionToolSchema).min(1).max(128),
        model: ToolModelSchema.optional(),
        tool_choice: ToolChoiceSchema.optional(),
        parallel_tool_calls: z.boolean().optional(),
        response_format: ResponseFormatSchema.optional().describe(
          'Force structured output for the assistant text payload (json_object or json_schema). Tool-call arguments are independent and remain JSON per the function-calling spec.'
        ),
        ...ChatSamplingParams,
      },
      outputSchema: ToolCallOutputShape,
      annotations: {
        title: "Mistral function calling",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_TOOL_MODEL;
        const request: ChatCompletionRequest = {
          model,
          messages: input.messages,
          tools: input.tools,
          toolChoice: input.tool_choice,
          parallelToolCalls: input.parallel_tool_calls,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
          randomSeed: input.seed,
          responseFormat: toSdkResponseFormat(input.response_format),
        };
        const res = await mistral.chat.complete(request);

        const choice = res.choices?.[0];
        const rawCalls = choice?.message?.toolCalls ?? [];
        const tool_calls = rawCalls.map((c: {
          id?: string;
          function?: { name?: string; arguments?: string | Record<string, unknown> };
        }) => ({
          id: c.id,
          name: c.function?.name ?? "",
          arguments:
            typeof c.function?.arguments === "string"
              ? c.function.arguments
              : JSON.stringify(c.function?.arguments ?? {}),
        }));

        const { text: rawText } = extractTextAndReasoning(choice?.message?.content);
        const text = rawText || undefined;

        const structured = {
          tool_calls,
          text,
          model,
          finish_reason: choice?.finishReason ?? undefined,
          usage: mapUsage(res.usage),
        };

        return {
          content: [toTextBlock(structured)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_tool_call", err);
      }
    }
  );
  } // end profile === "admin"

  // ========== codestral_fim ==========
  server.registerTool(
    "codestral_fim",
    {
      title: "Codestral fill-in-the-middle completion",
      description: [
        "Fill-in-the-middle code completion with Codestral.",
        "",
        "Given `prompt` (code preceding the cursor) and `suffix` (code after the cursor),",
        "Codestral writes the middle. Use for editor autocomplete scenarios, code-patching",
        "agents, or structured refactors where you know the target boundaries.",
        "",
        "Default stop tokens: [] — let the model decide. Override with `stop` if needed.",
      ].join("\n"),
      inputSchema: {
        prompt: z.string().min(1).describe("Code preceding the cursor."),
        suffix: z.string().describe("Code after the cursor. Can be empty string."),
        model: FimModelSchema.optional(),
        stop: z.array(z.string()).optional(),
        ...ChatSamplingParams,
      },
      outputSchema: FimOutputShape,
      annotations: {
        title: "Codestral FIM",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_FIM_MODEL;
        const res = await mistral.fim.complete({
          model,
          prompt: input.prompt,
          suffix: input.suffix,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
          randomSeed: input.seed,
          stop: input.stop,
        });

        const choice = res.choices?.[0];
        const content = choice?.message?.content ?? "";
        const text =
          typeof content === "string" ? content : JSON.stringify(content);

        const structured = {
          text,
          model,
          finish_reason: choice?.finishReason ?? undefined,
          usage: mapUsage(res.usage),
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("codestral_fim", err);
      }
    }
  );
}
