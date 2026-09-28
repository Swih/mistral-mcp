import type { McpServer } from "@modelcontextprotocol/server";
import type { Mistral } from "@mistralai/mistralai";
import type { Agent } from "@mistralai/mistralai/models/components/agent.js";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

const AgentSummary = z.object({
  id: z.string(), name: z.string(), model: z.string(), version: z.number(),
  description: z.string().nullable(), instructions: z.string().nullable(),
  tool_types: z.array(z.string()), handoffs: z.array(z.string()),
});
export const AgentsListOutputSchema = z.object({ agents: z.array(AgentSummary), page: z.number(), page_size: z.number() });
export const AgentsGetOutputSchema = z.object({ agent: AgentSummary });

function summarize(agent: Agent) {
  // Connector authorization and arbitrary metadata never belong in a discovery result.
  return AgentSummary.parse({
    id: agent.id, name: agent.name, model: agent.model, version: agent.version,
    description: agent.description ?? null, instructions: agent.instructions ?? null,
    tool_types: (agent.tools ?? []).map(t => t.type), handoffs: agent.handoffs ?? [],
  });
}

export function registerAgentCatalogTools(server: McpServer, mistral: Mistral) {
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  server.registerTool("agents_list", {
    title: "Find Mistral agents",
    description: "Find modern Mistral agents by name or ID. Use an id with conversation_start.agentId. Does not execute agents. An empty page ends pagination.",
    inputSchema: z.object({
      search: z.string().optional().describe("Search agent names or IDs."),
      page: z.number().int().nonnegative().default(0).describe("Zero-based page."),
      pageSize: z.number().int().min(1).max(100).default(20).describe("Maximum agents per page."),
    }),
    outputSchema: AgentsListOutputSchema, annotations: { ...annotations, title: "Find agents" },
  }, async input => {
    try {
      const agents = await mistral.beta.agents.list(input);
      const result = { agents: agents.map(summarize), page: input.page, page_size: input.pageSize };
      return { content: [toTextBlock(result)], structuredContent: result };
    } catch (error) { return errorResult("agents_list", error); }
  });
  server.registerTool("agents_get", {
    title: "Inspect a Mistral agent",
    description: "Inspect a modern agent's model, instructions and tool types before using conversation_start. Credentials are excluded.",
    inputSchema: z.object({
      agentId: z.string().min(1).describe("ID returned by agents_list."),
      agentVersion: z.union([z.number().int().nonnegative(), z.string().min(1)]).optional().describe("Optional version number or alias."),
    }),
    outputSchema: AgentsGetOutputSchema, annotations: { ...annotations, title: "Inspect agent" },
  }, async input => {
    try {
      const result = { agent: summarize(await mistral.beta.agents.get(input)) };
      return { content: [toTextBlock(result)], structuredContent: result };
    } catch (error) { return errorResult("agents_get", error); }
  });
}
