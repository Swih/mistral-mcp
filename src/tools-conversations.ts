/**
 * Mistral Conversations tools — stateful, multi-turn agent loops with
 * Mistral's built-in tools (web_search, code_interpreter, image_generation,
 * document_library).
 *
 * Source: https://docs.mistral.ai/agents/agents_introduction/ (Conversations)
 * SDK: mistral.beta.conversations.{start,append,get,list,getHistory,delete}
 *
 * Scope (v1, deliberately conservative):
 *   - `inputs` only accepts a plain string (single user turn). The SDK also
 *     accepts a structured `InputEntries[]` array (function results, replayed
 *     entries, ...) — out of scope until a concrete agent-loop need surfaces.
 *   - `tools` only covers Mistral's built-in flag tools (web_search,
 *     web_search_premium, code_interpreter, image_generation) plus
 *     document_library (via `documentLibraryIds`). `function` tools and
 *     `custom_connector` tools are out of scope: function tools need a
 *     client-side execution loop (see mistral_tool_call for that pattern),
 *     and custom connectors duplicate the dedicated connectors_* tools.
 *   - Streaming (startStream/appendStream/restartStream) and `restart`
 *     (forking history) are not exposed — symmetry with how mistral_chat_stream
 *     is admin-only and separate from mistral_chat; can follow later if needed.
 *
 * Five tools: conversation_start, conversation_append, conversation_get,
 * conversation_list, conversation_history, conversation_delete.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import type { ConversationRequestTool } from "@mistralai/mistralai/models/components/conversationrequest.js";
import { z } from "zod";
import { ChatModelSchema, DEFAULT_CHAT_MODEL } from "./models.js";
import { ChatSamplingParams, errorResult, toTextBlock } from "./shared.js";

// ---------- shared sub-schemas ----------

const BUILTIN_TOOL_TYPES = [
  "web_search",
  "web_search_premium",
  "code_interpreter",
  "image_generation",
] as const;

function buildToolsParam(
  tools: (typeof BUILTIN_TOOL_TYPES)[number][] | undefined,
  documentLibraryIds: string[] | undefined
): ConversationRequestTool[] | undefined {
  const out: ConversationRequestTool[] = [];
  for (const t of tools ?? []) out.push({ type: t });
  if (documentLibraryIds && documentLibraryIds.length > 0) {
    out.push({ type: "document_library", libraryIds: documentLibraryIds });
  }
  return out.length > 0 ? out : undefined;
}

const ConversationEntrySummaryShape = {
  type: z.string(),
  id: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  tool_name: z.string().optional(),
  tool_call_id: z.string().optional(),
  arguments: z.string().optional(),
  agent_id: z.string().optional(),
  previous_agent_name: z.string().optional(),
  next_agent_name: z.string().optional(),
  created_at: z.string().optional(),
};
const ConversationEntrySummarySchema = z.object(ConversationEntrySummaryShape);

function entryText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string"
          ? (c as { text: string }).text
          : ""
      )
      .join("");
  }
  return undefined;
}

function toEntrySummary(raw: unknown): z.infer<typeof ConversationEntrySummarySchema> {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const type = typeof entry.type === "string" ? entry.type : "unknown";
  const created_at =
    entry.createdAt instanceof Date ? entry.createdAt.toISOString() : undefined;
  const id = typeof entry.id === "string" ? entry.id : undefined;

  switch (type) {
    case "message.output":
    case "message.input":
      return {
        type,
        id,
        role: typeof entry.role === "string" ? entry.role : undefined,
        text: entryText(entry.content),
        created_at,
      };
    case "function.call":
      return {
        type,
        id,
        tool_call_id: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
        tool_name: typeof entry.name === "string" ? entry.name : undefined,
        arguments:
          typeof entry.arguments === "string"
            ? entry.arguments
            : entry.arguments !== undefined
              ? JSON.stringify(entry.arguments)
              : undefined,
        created_at,
      };
    case "function.result":
      return {
        type,
        id,
        tool_call_id: typeof entry.toolCallId === "string" ? entry.toolCallId : undefined,
        text: typeof entry.result === "string" ? entry.result : undefined,
        created_at,
      };
    case "tool.execution":
      return {
        type,
        id,
        tool_name: typeof entry.name === "string" ? entry.name : undefined,
        arguments: typeof entry.arguments === "string" ? entry.arguments : undefined,
        created_at,
      };
    case "agent.handoff":
      return {
        type,
        id,
        agent_id: typeof entry.nextAgentId === "string" ? entry.nextAgentId : undefined,
        previous_agent_name:
          typeof entry.previousAgentName === "string" ? entry.previousAgentName : undefined,
        next_agent_name:
          typeof entry.nextAgentName === "string" ? entry.nextAgentName : undefined,
        created_at,
      };
    default:
      return { type, id, created_at };
  }
}

const ConversationUsageShape = {
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  connector_tokens: z.number().optional(),
  connectors: z.record(z.string(), z.number()).optional(),
};
const ConversationUsageSchema = z.object(ConversationUsageShape);

function toUsage(raw: unknown): z.infer<typeof ConversationUsageSchema> {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    prompt_tokens: typeof u.promptTokens === "number" ? u.promptTokens : 0,
    completion_tokens: typeof u.completionTokens === "number" ? u.completionTokens : 0,
    total_tokens: typeof u.totalTokens === "number" ? u.totalTokens : 0,
    connector_tokens: typeof u.connectorTokens === "number" ? u.connectorTokens : undefined,
    connectors:
      u.connectors && typeof u.connectors === "object"
        ? (u.connectors as Record<string, number>)
        : undefined,
  };
}

const ConversationSummaryShape = {
  id: z.string(),
  object: z.literal("conversation"),
  created_at: z.string(),
  updated_at: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  model: z.string().optional(),
  agent_id: z.string().optional(),
  agent_version: z.union([z.string(), z.number()]).optional(),
  instructions: z.string().optional(),
  tool_types: z.array(z.string()).optional(),
};
const ConversationSummarySchema = z.object(ConversationSummaryShape);

function toConversationSummary(raw: unknown): z.infer<typeof ConversationSummarySchema> {
  const c = (raw ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(c.tools) ? (c.tools as Array<Record<string, unknown>>) : undefined;
  return {
    id: String(c.id ?? ""),
    object: "conversation",
    created_at: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt ?? ""),
    updated_at: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt ?? ""),
    name: typeof c.name === "string" ? c.name : undefined,
    description: typeof c.description === "string" ? c.description : undefined,
    model: typeof c.model === "string" ? c.model : undefined,
    agent_id: typeof c.agentId === "string" ? c.agentId : undefined,
    agent_version:
      typeof c.agentVersion === "string" || typeof c.agentVersion === "number"
        ? c.agentVersion
        : undefined,
    instructions: typeof c.instructions === "string" ? c.instructions : undefined,
    tool_types: tools?.map((t) => String(t.type ?? "unknown")),
  };
}

// ---------- output schemas (exported for contract tests) ----------

export const ConversationResponseOutputShape = {
  conversation_id: z.string(),
  outputs: z.array(ConversationEntrySummarySchema),
  usage: ConversationUsageSchema,
};
export const ConversationResponseOutputSchema = z.object(ConversationResponseOutputShape);

export const ConversationGetOutputShape = {
  conversation: ConversationSummarySchema,
};
export const ConversationGetOutputSchema = z.object(ConversationGetOutputShape);

export const ConversationListOutputShape = {
  conversations: z.array(ConversationSummarySchema),
};
export const ConversationListOutputSchema = z.object(ConversationListOutputShape);

export const ConversationHistoryOutputShape = {
  conversation_id: z.string(),
  entries: z.array(ConversationEntrySummarySchema),
};
export const ConversationHistoryOutputSchema = z.object(ConversationHistoryOutputShape);

export const ConversationDeleteOutputShape = {
  conversation_id: z.string(),
  deleted: z.boolean(),
};
export const ConversationDeleteOutputSchema = z.object(ConversationDeleteOutputShape);

// ---------- registration ----------

export function registerConversationTools(server: McpServer, mistral: Mistral) {
  // ========== conversation_start ==========
  server.registerTool(
    "conversation_start",
    {
      title: "Start a Mistral conversation",
      description: [
        "Start a new stateful, multi-turn conversation. Returns a conversation_id",
        "to continue with conversation_append.",
        "",
        "Pass exactly one of `agentId` (a pre-configured Mistral Agent) or `model`",
        "(a base chat model — defaults to the standard chat model if neither is set).",
        "",
        "`tools` enables Mistral's built-in tools for this conversation:",
        "web_search, web_search_premium, code_interpreter, image_generation.",
        "Pass `documentLibraryIds` to additionally enable document_library search",
        "over specific Mistral Libraries.",
      ].join("\n"),
      inputSchema: {
        input: z.string().min(1).describe("User message that starts the conversation."),
        agentId: z
          .string()
          .optional()
          .describe("Pre-configured Mistral Agent ID. Mutually exclusive with model."),
        model: ChatModelSchema.optional().describe(
          `Base chat model. Mutually exclusive with agentId. Default: ${DEFAULT_CHAT_MODEL}.`
        ),
        instructions: z.string().optional().describe("System-level instructions."),
        tools: z
          .array(z.enum(BUILTIN_TOOL_TYPES))
          .optional()
          .describe("Built-in Mistral tools to enable."),
        documentLibraryIds: z
          .array(z.string().min(1))
          .optional()
          .describe("Library IDs to search via the document_library tool."),
        store: z
          .boolean()
          .optional()
          .describe("Persist the conversation server-side. Default: true."),
        ...ChatSamplingParams,
      },
      outputSchema: ConversationResponseOutputShape,
      annotations: {
        title: "Start Mistral conversation",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.conversations.start({
          inputs: input.input,
          agentId: input.agentId,
          model: input.agentId ? undefined : (input.model ?? DEFAULT_CHAT_MODEL),
          instructions: input.instructions,
          tools: buildToolsParam(input.tools, input.documentLibraryIds),
          store: input.store,
          completionArgs:
            input.temperature !== undefined ||
            input.max_tokens !== undefined ||
            input.top_p !== undefined ||
            input.seed !== undefined
              ? {
                  temperature: input.temperature,
                  maxTokens: input.max_tokens,
                  topP: input.top_p,
                  randomSeed: input.seed,
                }
              : undefined,
        });

        const structured = {
          conversation_id: res.conversationId,
          outputs: res.outputs.map(toEntrySummary),
          usage: toUsage(res.usage),
        };

        return {
          content: [
            toTextBlock(
              `Conversation ${structured.conversation_id} started — ${structured.outputs.length} new entr${structured.outputs.length === 1 ? "y" : "ies"}.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_start", err);
      }
    }
  );

  // ========== conversation_append ==========
  server.registerTool(
    "conversation_append",
    {
      title: "Continue a Mistral conversation",
      description:
        "Append a new user turn to an existing conversation and run completion. " +
        "Returns only the newly created entries (not the full history) — use " +
        "conversation_history for the complete entry log.",
      inputSchema: {
        conversationId: z.string().min(1).describe("Conversation ID from conversation_start."),
        input: z.string().min(1).describe("New user message to append."),
        store: z.boolean().optional(),
        ...ChatSamplingParams,
      },
      outputSchema: ConversationResponseOutputShape,
      annotations: {
        title: "Append to Mistral conversation",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.conversations.append({
          conversationId: input.conversationId,
          conversationAppendRequest: {
            inputs: input.input,
            store: input.store,
            completionArgs:
              input.temperature !== undefined ||
              input.max_tokens !== undefined ||
              input.top_p !== undefined ||
              input.seed !== undefined
                ? {
                    temperature: input.temperature,
                    maxTokens: input.max_tokens,
                    topP: input.top_p,
                    randomSeed: input.seed,
                  }
                : undefined,
          },
        });

        const structured = {
          conversation_id: res.conversationId,
          outputs: res.outputs.map(toEntrySummary),
          usage: toUsage(res.usage),
        };

        return {
          content: [
            toTextBlock(
              `Conversation ${structured.conversation_id}: ${structured.outputs.length} new entr${structured.outputs.length === 1 ? "y" : "ies"}.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_append", err);
      }
    }
  );

  // ========== conversation_get ==========
  server.registerTool(
    "conversation_get",
    {
      title: "Get a Mistral conversation's metadata",
      description: "Fetch a conversation's configuration (model/agent, tools, instructions).",
      inputSchema: {
        conversationId: z.string().min(1),
      },
      outputSchema: ConversationGetOutputShape,
      annotations: {
        title: "Get conversation metadata",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.conversations.get({ conversationId: input.conversationId });
        const structured = { conversation: toConversationSummary(res) };
        return {
          content: [toTextBlock(`Conversation ${structured.conversation.id}.`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_get", err);
      }
    }
  );

  // ========== conversation_list ==========
  server.registerTool(
    "conversation_list",
    {
      title: "List Mistral conversations",
      description: "List conversations created with this API key, most recent first.",
      inputSchema: {
        page: z.number().int().nonnegative().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
      },
      outputSchema: ConversationListOutputShape,
      annotations: {
        title: "List Mistral conversations",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.conversations.list({
          page: input.page,
          pageSize: input.pageSize,
        });
        const structured = { conversations: res.map(toConversationSummary) };
        return {
          content: [toTextBlock(`Found ${structured.conversations.length} conversation(s).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_list", err);
      }
    }
  );

  // ========== conversation_history ==========
  server.registerTool(
    "conversation_history",
    {
      title: "Get a Mistral conversation's full entry log",
      description:
        "Fetch every entry in a conversation, in order: messages, function calls/results, " +
        "tool executions, and agent handoffs.",
      inputSchema: {
        conversationId: z.string().min(1),
      },
      outputSchema: ConversationHistoryOutputShape,
      annotations: {
        title: "Get conversation history",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.conversations.getHistory({
          conversationId: input.conversationId,
        });
        const structured = {
          conversation_id: res.conversationId,
          entries: res.entries.map(toEntrySummary),
        };
        return {
          content: [
            toTextBlock(`Conversation ${structured.conversation_id}: ${structured.entries.length} entries.`),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_history", err);
      }
    }
  );

  // ========== conversation_delete ==========
  server.registerTool(
    "conversation_delete",
    {
      title: "Delete a Mistral conversation",
      description: "Permanently delete a conversation and its history.",
      inputSchema: {
        conversationId: z.string().min(1),
      },
      outputSchema: ConversationDeleteOutputShape,
      annotations: {
        title: "Delete Mistral conversation",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        await mistral.beta.conversations.delete({ conversationId: input.conversationId });
        const structured = { conversation_id: input.conversationId, deleted: true };
        return {
          content: [toTextBlock(`Deleted conversation ${input.conversationId}.`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("conversation_delete", err);
      }
    }
  );
}
