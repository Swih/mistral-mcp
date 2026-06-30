/**
 * Unit tests for v0.9 Mistral Conversations tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerConversationTools } from "../../src/tools-conversations.js";

const SAMPLE_RESPONSE = {
  object: "conversation.response" as const,
  conversationId: "conv-1",
  outputs: [
    {
      object: "entry" as const,
      type: "message.output" as const,
      id: "e1",
      role: "assistant" as const,
      content: "Hello there!",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

const SAMPLE_CONVERSATION = {
  object: "conversation" as const,
  id: "conv-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  model: "mistral-medium-latest",
  instructions: "Be concise.",
  tools: [{ type: "web_search" }, { type: "document_library", libraryIds: ["lib-1"] }],
};

function makeMock(overrides: Partial<Record<string, unknown>> = {}): Mistral {
  return {
    beta: {
      conversations: {
        start: vi.fn(async () => SAMPLE_RESPONSE),
        append: vi.fn(async () => SAMPLE_RESPONSE),
        get: vi.fn(async () => SAMPLE_CONVERSATION),
        list: vi.fn(async () => [SAMPLE_CONVERSATION]),
        getHistory: vi.fn(async () => ({
          object: "conversation.history",
          conversationId: "conv-1",
          entries: [
            {
              type: "message.output",
              id: "e1",
              role: "assistant",
              content: "Hi!",
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
            {
              type: "function.call",
              id: "e2",
              toolCallId: "call-1",
              name: "search_docs",
              arguments: { query: "foo" },
            },
            {
              type: "tool.execution",
              id: "e3",
              name: "web_search",
              arguments: "{}",
            },
            {
              type: "agent.handoff",
              id: "e4",
              previousAgentId: "a1",
              previousAgentName: "router",
              nextAgentId: "a2",
              nextAgentName: "specialist",
            },
          ],
        })),
        delete: vi.fn(async () => undefined),
        ...((overrides.conversations as Record<string, unknown>) ?? {}),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "conversations-test", version: "0.0.0" });
  registerConversationTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (conversations)", () => {
  it("exposes all six conversation tools with outputSchema + openWorldHint", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "conversation_append",
      "conversation_delete",
      "conversation_get",
      "conversation_history",
      "conversation_list",
      "conversation_start",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.openWorldHint).toBe(true);
    }
    const del = tools.find((t) => t.name === "conversation_delete");
    expect(del?.annotations?.destructiveHint).toBe(true);
  });
});

describe("conversation_start", () => {
  it("defaults to model when agentId is absent, builds tools + completionArgs, maps output", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "conversation_start",
      arguments: {
        input: "Hello",
        tools: ["web_search"],
        documentLibraryIds: ["lib-1"],
        temperature: 0.5,
        max_tokens: 200,
      },
    });

    const beta = (mock as unknown as { beta: { conversations: { start: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.conversations.start.mock.calls[0]?.[0];
    expect(arg.inputs).toBe("Hello");
    expect(arg.agentId).toBeUndefined();
    expect(arg.model).toBe("mistral-medium-latest");
    expect(arg.tools).toEqual([
      { type: "web_search" },
      { type: "document_library", libraryIds: ["lib-1"] },
    ]);
    expect(arg.completionArgs).toMatchObject({ temperature: 0.5, maxTokens: 200 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      conversation_id: string;
      outputs: Array<{ type: string; text?: string; role?: string }>;
      usage: { total_tokens: number };
    };
    expect(sc.conversation_id).toBe("conv-1");
    expect(sc.outputs[0]).toMatchObject({ type: "message.output", role: "assistant", text: "Hello there!" });
    expect(sc.usage.total_tokens).toBe(15);
  });

  it("omits model when agentId is provided", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "conversation_start",
      arguments: { input: "Hello", agentId: "agent-123" },
    });
    const beta = (mock as unknown as { beta: { conversations: { start: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.conversations.start.mock.calls[0]?.[0];
    expect(arg.agentId).toBe("agent-123");
    expect(arg.model).toBeUndefined();
  });
});

describe("conversation_append", () => {
  it("forwards conversationId + input and maps the response", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "conversation_append",
      arguments: { conversationId: "conv-1", input: "Follow-up" },
    });
    const beta = (mock as unknown as { beta: { conversations: { append: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.conversations.append.mock.calls[0]?.[0];
    expect(arg.conversationId).toBe("conv-1");
    expect(arg.conversationAppendRequest.inputs).toBe("Follow-up");

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { conversation_id: string };
    expect(sc.conversation_id).toBe("conv-1");
  });
});

describe("conversation_get", () => {
  it("maps conversation metadata including tool_types", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "conversation_get",
      arguments: { conversationId: "conv-1" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      conversation: { id: string; model?: string; tool_types?: string[] };
    };
    expect(sc.conversation.id).toBe("conv-1");
    expect(sc.conversation.model).toBe("mistral-medium-latest");
    expect(sc.conversation.tool_types).toEqual(["web_search", "document_library"]);
  });
});

describe("conversation_list", () => {
  it("maps the list response", async () => {
    const { client } = await boot();
    const result = await client.callTool({ name: "conversation_list", arguments: {} });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { conversations: Array<{ id: string }> };
    expect(sc.conversations).toHaveLength(1);
    expect(sc.conversations[0]?.id).toBe("conv-1");
  });
});

describe("conversation_history", () => {
  it("maps every entry type (message, function.call, tool.execution, agent.handoff)", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "conversation_history",
      arguments: { conversationId: "conv-1" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      entries: Array<Record<string, unknown>>;
    };
    expect(sc.entries).toHaveLength(4);
    expect(sc.entries[0]).toMatchObject({ type: "message.output", role: "assistant", text: "Hi!" });
    expect(sc.entries[1]).toMatchObject({ type: "function.call", tool_name: "search_docs", tool_call_id: "call-1" });
    expect(sc.entries[2]).toMatchObject({ type: "tool.execution", tool_name: "web_search" });
    expect(sc.entries[3]).toMatchObject({
      type: "agent.handoff",
      previous_agent_name: "router",
      next_agent_name: "specialist",
    });
  });
});

describe("conversation_delete", () => {
  it("calls delete and returns deleted:true", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "conversation_delete",
      arguments: { conversationId: "conv-1" },
    });
    const beta = (mock as unknown as { beta: { conversations: { delete: ReturnType<typeof vi.fn> } } }).beta;
    expect(beta.conversations.delete).toHaveBeenCalledWith({ conversationId: "conv-1" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { deleted: boolean };
    expect(sc.deleted).toBe(true);
  });
});
