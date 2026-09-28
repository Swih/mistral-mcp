import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { config } from "dotenv";
import { Mistral } from "@mistralai/mistralai";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { registerAgentCatalogTools, AgentsListOutputSchema, AgentsGetOutputSchema } from "../../src/tools-agent-catalog.js";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";

config({ quiet: true });
describe.skipIf(!process.env.MISTRAL_API_KEY)("live agent catalog (read only)", () => {
  const server = new McpServer({ name: "catalog-test", version: "0" });
  const client = new Client({ name: "test", version: "0" });
  let agentId: string | undefined;
  beforeAll(async () => {
    registerAgentCatalogTools(server, new Mistral({ apiKey: process.env.MISTRAL_API_KEY,
      retryConfig: MISTRAL_RETRY_CONFIG, timeoutMs: MISTRAL_TIMEOUT_MS }));
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });
  afterAll(async () => { await client.close(); await server.close(); });
  it("lists agents without executing one", async () => {
    const result = await client.callTool({ name: "agents_list", arguments: { pageSize: 1 } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    agentId = AgentsListOutputSchema.parse(result.structuredContent).agents[0]?.id;
  });
  it("reads an existing agent when available", async ctx => {
    if (!agentId) { console.warn("No agent available to inspect."); ctx.skip(); return; }
    const result = await client.callTool({ name: "agents_get", arguments: { agentId } });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(AgentsGetOutputSchema.parse(result.structuredContent).agent.id).toBe(agentId);
  });
});
