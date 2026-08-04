/**
 * Leanstral 1.5 tools for Lean 4 proof construction and review.
 *
 * Source: https://docs.mistral.ai/models/model-cards/leanstral-1-5
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import type { ChatCompletionRequest } from "@mistralai/mistralai/models/components/chatcompletionrequest.js";
import { z } from "zod";
import { DEFAULT_LEAN_MODEL } from "./models.js";
import type { MistralProfile } from "./profile.js";
import {
  UsageSchema,
  errorResult,
  extractTextAndReasoning,
  mapUsage,
  toTextBlock,
} from "./shared.js";

const LEAN_SYSTEM_PROMPT = `You are a Lean 4 formal-proof specialist assisting another coding agent. Produce robust, readable Lean 4 proofs that respect the imports, namespaces, local definitions, and library versions supplied by the caller.

Return proposed Lean code first, followed by a concise explanation, required assumptions, and remaining uncertainties. Never claim code compiles unless the caller supplied compiler feedback confirming that it does. If context is insufficient, identify the exact missing definitions, imports, or diagnostics.`;

export const LeanOutputShape = {
  text: z.string(),
  model: z.string(),
  finish_reason: z.string().optional(),
  usage: UsageSchema.optional(),
};
export const LeanOutputSchema = z.object(LeanOutputShape);

function proofPrompt(input: {
  theorem: string;
  context?: string;
  requirements?: string;
  previous_attempt?: string;
  compiler_errors?: string;
}) {
  return `## Proof obligation

\`\`\`lean
${input.theorem}
\`\`\`

## Relevant project context

\`\`\`lean
${input.context || "-- No additional context supplied."}
\`\`\`

## Requirements

${input.requirements || "Produce a correct, maintainable Lean 4 proof."}

## Previous attempt

\`\`\`lean
${input.previous_attempt || "-- No previous attempt supplied."}
\`\`\`

## Compiler feedback

\`\`\`text
${input.compiler_errors || "No compiler feedback supplied."}
\`\`\`

Produce the proposed Lean code first. Then briefly explain the proof and list assumptions that must be checked in the actual project.`;
}

function reviewPrompt(input: {
  source: string;
  objective?: string;
  compiler_errors?: string;
}) {
  return `Review the following Lean 4 source.

## Objective

${input.objective || "Check correctness and improve the proof."}

## Source

\`\`\`lean
${input.source}
\`\`\`

## Compiler feedback

\`\`\`text
${input.compiler_errors || "No compiler feedback supplied."}
\`\`\`

Identify concrete problems and return corrected replacement code where needed.`;
}

async function callLeanstral(mistral: Mistral, prompt: string) {
  const request: ChatCompletionRequest = {
    model: DEFAULT_LEAN_MODEL,
    messages: [
      { role: "system", content: LEAN_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    topP: 1,
  };
  const response = await mistral.chat.complete(request);
  const choice = response.choices?.[0];
  const { text } = extractTextAndReasoning(choice?.message?.content);
  if (!text) {
    throw new Error("Leanstral returned no proof text.");
  }
  return {
    text,
    model: DEFAULT_LEAN_MODEL,
    finish_reason: choice?.finishReason ?? undefined,
    usage: mapUsage(response.usage),
  };
}

export function registerLeanTools(
  server: McpServer,
  mistral: Mistral,
  profile: MistralProfile = "core"
) {
  if (profile === "workflows") return;

  server.registerTool(
    "prove_with_leanstral",
    {
      title: "Construct or repair a Lean 4 proof with Leanstral",
      description:
        "Construct or repair a Lean 4 proof using Mistral Leanstral 1.5. Supply the exact theorem and relevant project context; include the previous attempt and compiler diagnostics when repairing a proof. The model proposes code but does not run Lean locally.",
      inputSchema: {
        theorem: z
          .string()
          .min(1)
          .describe("Exact Lean 4 theorem statement or proof obligation to solve."),
        context: z
          .string()
          .optional()
          .describe(
            "Relevant imports, namespaces, variables, local definitions, and library-version constraints."
          ),
        requirements: z
          .string()
          .optional()
          .describe(
            "Proof-style, tactic, dependency, readability, or maintainability requirements."
          ),
        previous_attempt: z
          .string()
          .optional()
          .describe("Previous Lean 4 proof attempt to repair, if any."),
        compiler_errors: z
          .string()
          .optional()
          .describe("Exact Lean compiler or language-server diagnostics from the previous attempt."),
      },
      outputSchema: LeanOutputShape,
      annotations: {
        title: "Construct or repair a Lean 4 proof with Leanstral",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const structured = await callLeanstral(mistral, proofPrompt(input));
        return {
          content: [toTextBlock(structured.text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("prove_with_leanstral", err);
      }
    }
  );

  server.registerTool(
    "review_lean_proof",
    {
      title: "Review a Lean 4 proof with Leanstral",
      description:
        "Review, diagnose, or simplify Lean 4 source using Mistral Leanstral 1.5. Returns concrete replacement code where appropriate, but does not run Lean locally or claim compilation without supplied compiler feedback.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .describe("Lean 4 source code to review, diagnose, or simplify."),
        objective: z
          .string()
          .optional()
          .describe(
            "Review goal, such as fixing correctness, simplifying tactics, or improving maintainability."
          ),
        compiler_errors: z
          .string()
          .optional()
          .describe("Exact Lean compiler or language-server diagnostics relevant to the source."),
      },
      outputSchema: LeanOutputShape,
      annotations: {
        title: "Review a Lean 4 proof with Leanstral",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const structured = await callLeanstral(mistral, reviewPrompt(input));
        return {
          content: [toTextBlock(structured.text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("review_lean_proof", err);
      }
    }
  );
}
