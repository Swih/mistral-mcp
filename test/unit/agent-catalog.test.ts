import { describe, it, expect, vi } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import type { Mistral } from "@mistralai/mistralai";
import { registerAgentCatalogTools, AgentsListOutputSchema, AgentsGetOutputSchema } from "../../src/tools-agent-catalog.js";

describe("modern agent discovery", () => {
  it("forwards pagination and version, validates outputs and omits credentials", async () => {
    const agent = { id: "a1", name: "Research", model: "m", version: 1,
      tools: [{ type: "connector", authorization: { secret: "never-return-this" } }] };
    const mock = { beta: { agents: { list: vi.fn(async () => [agent]), get: vi.fn(async () => agent) } } };
    const server = new McpServer({ name: "test", version: "0" });
    registerAgentCatalogTools(server, mock as unknown as Mistral);
    const client = new Client({ name: "test", version: "0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const listed = await client.callTool({ name: "agents_list", arguments: { search: "Research", page: 2, pageSize: 3 } });
      expect(listed.isError).toBeFalsy();
      expect(AgentsListOutputSchema.parse(listed.structuredContent).agents[0].id).toBe("a1");
      expect(mock.beta.agents.list).toHaveBeenCalledWith({ search: "Research", page: 2, pageSize: 3 });
      const got = await client.callTool({ name: "agents_get", arguments: { agentId: "a1", agentVersion: 1 } });
      expect(AgentsGetOutputSchema.parse(got.structuredContent).agent.name).toBe("Research");
      expect(mock.beta.agents.get).toHaveBeenCalledWith({ agentId: "a1", agentVersion: 1 });
      expect(JSON.stringify([listed, got])).not.toContain("never-return-this");
      mock.beta.agents.list.mockRejectedValueOnce(new Error("Unavailable"));
      expect((await client.callTool({ name: "agents_list", arguments: {} })).isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});
