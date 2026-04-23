/**
 * v0.4 tools — Agents + Classifiers (moderation + classification).
 *
 * Sources:
 * - Agents: https://docs.mistral.ai/agents/agents_introduction/
 *   POST /v1/agents/completions  (SDK: mistral.agents.complete)
 *   Requires an `agent_id` created in the Mistral dashboard; that's what
 *   differentiates this from plain chat — the agent carries its own
 *   system prompt, tools, and model configuration server-side.
 *
 * - Moderation: https://docs.mistral.ai/capabilities/guardrailing/
 *   POST /v1/moderations  (SDK: mistral.classifiers.moderate)
 *   Returns per-category boolean flags + float scores (0..1).
 *
 * - Classification: https://docs.mistral.ai/capabilities/classifier_factory/
 *   POST /v1/classifications  (SDK: mistral.classifiers.classify)
 *   Runs a fine-tuned classifier (or a preset) on one or more texts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import {
  DEFAULT_MODERATION_MODEL,
  ModerationModelSchema,
} from "./models.js";
import {
  ChatSamplingParams,
  TextMessageSchema,
  UsageSchema,
  errorResult,
  mapUsage,
  toTextBlock,
} from "./shared.js";

// ---------- output schemas (exported for contract tests) ----------

export const AgentOutputShape = {
  text: z.string(),
  model: z.string(),
  agent_id: z.string(),
  usage: UsageSchema.optional(),
  finish_reason: z.string().optional(),
};
export const AgentOutputSchema = z.object(AgentOutputShape);

const ModerationResultSchema = z.object({
  categories: z.record(z.string(), z.boolean()).optional(),
  category_scores: z.record(z.string(), z.number()).optional(),
});

export const ModerateOutputShape = {
  id: z.string(),
  model: z.string(),
  results: z.array(ModerationResultSchema),
};
export const ModerateOutputSchema = z.object(ModerateOutputShape);

const ClassificationResultSchema = z.record(
  z.string(),
  z.object({ scores: z.record(z.string(), z.number()) })
);

export const ClassifyOutputShape = {
  id: z.string(),
  model: z.string(),
  results: z.array(ClassificationResultSchema),
};
export const ClassifyOutputSchema = z.object(ClassifyOutputShape);

// ---------- registration ----------

export function registerAgentTools(server: McpServer, mistral: Mistral) {
  // ========== mistral_agent ==========
  server.registerTool(
    "mistral_agent",
    {
      title: "Mistral Agents completion",
      description: [
        "Run a completion against a pre-configured Mistral agent.",
        "",
        "Unlike `mistral_chat`, this tool requires an `agentId` pointing to an",
        "agent you've created in the Mistral dashboard. The agent carries its own",
        "system prompt, model, tools, and connectors (web_search, code_interpreter,",
        "document_library, image_generation) server-side — you just send messages.",
        "",
        "Use `mistral_chat` for direct model calls without stateful agent config.",
      ].join("\n"),
      inputSchema: {
        agentId: z
          .string()
          .min(1)
          .describe(
            "ID of the agent to call, as shown in the Mistral dashboard (e.g. 'ag:abcd...')."
          ),
        messages: z
          .array(TextMessageSchema)
          .min(1)
          .describe("Chat-style messages to send to the agent."),
        ...ChatSamplingParams,
      },
      outputSchema: AgentOutputShape,
      annotations: {
        title: "Mistral Agents completion",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.agents.complete({
          agentId: input.agentId,
          messages: input.messages as never,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
        } as never);

        const choice = res.choices?.[0];
        const content = choice?.message?.content ?? "";
        const text =
          typeof content === "string" ? content : JSON.stringify(content);

        const structured = {
          text,
          model: res.model,
          agent_id: input.agentId,
          usage: mapUsage(res.usage),
          finish_reason: choice?.finishReason ?? undefined,
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_agent", err);
      }
    }
  );

  // ========== mistral_moderate ==========
  server.registerTool(
    "mistral_moderate",
    {
      title: "Mistral moderation",
      description: [
        "Classify one or more texts for harmful content.",
        "",
        "Returns per-input `categories` (boolean flags) and `category_scores`",
        "(0..1 floats). Categories include: sexual, hate_and_discrimination,",
        "violence_and_threats, dangerous_and_criminal_content, selfharm,",
        "health, financial, law, pii.",
        "",
        "Use `mistral_chat_moderate` style pre-filtering by calling this before",
        "passing user input to a downstream LLM.",
      ].join("\n"),
      inputSchema: {
        inputs: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe("Single text or array of texts to moderate."),
        model: ModerationModelSchema.optional().describe(
          `Moderation model. Default: ${DEFAULT_MODERATION_MODEL}.`
        ),
      },
      outputSchema: ModerateOutputShape,
      annotations: {
        title: "Mistral moderation",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_MODERATION_MODEL;
        const res = await mistral.classifiers.moderate({
          model,
          inputs: input.inputs,
        });

        const results = (res.results ?? []).map((r) => ({
          categories: r.categories,
          category_scores: r.categoryScores,
        }));

        const flaggedCount = results.filter((r) =>
          Object.values(r.categories ?? {}).some((v) => v === true)
        ).length;
        const summary = `Moderated ${results.length} input(s); ${flaggedCount} flagged.`;

        const structured = {
          id: res.id,
          model: res.model,
          results,
        };

        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_moderate", err);
      }
    }
  );

  // ========== mistral_classify ==========
  server.registerTool(
    "mistral_classify",
    {
      title: "Mistral classification",
      description: [
        "Run a classifier on one or more texts and return per-target scores.",
        "",
        "Use this with a fine-tuned classifier model id (e.g. `ft:classifier:...`)",
        "trained via the Classifier Factory, or a preset classifier model.",
        "Each result is a dict of target_name → { scores: { label: score } }.",
      ].join("\n"),
      inputSchema: {
        inputs: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe("Single text or array of texts to classify."),
        model: z
          .string()
          .min(1)
          .describe(
            "Classifier model id (fine-tuned `ft:classifier:...` or preset)."
          ),
      },
      outputSchema: ClassifyOutputShape,
      annotations: {
        title: "Mistral classification",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.classifiers.classify({
          model: input.model,
          inputs: input.inputs,
        });

        const structured = {
          id: res.id,
          model: res.model,
          results: res.results ?? [],
        };

        const summary = `Classified ${structured.results.length} input(s) via ${res.model}.`;

        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_classify", err);
      }
    }
  );
}
