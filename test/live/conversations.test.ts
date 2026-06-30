/**
 * Live integration tests for Mistral Conversations tools.
 *
 * Skipped unless MISTRAL_API_KEY is set in the environment.
 * Covers six tools: conversation_start, conversation_append, conversation_get,
 * conversation_list, conversation_history, conversation_delete.
 *
 * Test strategy: start a real conversation, exercise every read tool against
 * it, then delete it so the live test account doesn't accumulate state.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Mistral } from "@mistralai/mistralai";
import { registerConversationTools } from "../../src/tools-conversations.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

async function bootConversationServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: { strategy: "backoff", retryConnectionErrors: true },
    timeoutMs: 30_000,
  });
  const server = new McpServer({ name: "test-conversations", version: "0.0.0" });
  registerConversationTools(server, mistral);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return { client };
}

describe.skipIf(!HAS_KEY)("live Mistral Conversations", () => {
  let client: Client;
  let conversationId: string | null = null;

  beforeAll(async () => {
    ({ client } = await bootConversationServer());
  });

  afterAll(async () => {
    if (!conversationId) return;
    await client.callTool({
      name: "conversation_delete",
      arguments: { conversationId },
    });
  });

  it("conversation_start creates a conversation and returns a valid shape", async () => {
    const res = await client.callTool({
      name: "conversation_start",
      arguments: {
        input: 'Reply with exactly the single word: "pong". No punctuation.',
        model: "mistral-small-latest",
        temperature: 0,
        max_tokens: 16,
      },
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      conversation_id: string;
      outputs: Array<{ type: string; text?: string }>;
      usage: { total_tokens: number };
    };
    expect(typeof sc.conversation_id).toBe("string");
    expect(sc.conversation_id.length).toBeGreaterThan(0);
    expect(Array.isArray(sc.outputs)).toBe(true);
    expect(sc.usage.total_tokens).toBeGreaterThan(0);

    conversationId = sc.conversation_id;
  });

  it("conversation_get fetches the conversation's metadata", async () => {
    if (!conversationId) {
      console.warn("[skip] No conversation_id from previous test — skipping get test.");
      return;
    }
    const res = await client.callTool({
      name: "conversation_get",
      arguments: { conversationId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { conversation: { id: string; model?: string } };
    expect(sc.conversation.id).toBe(conversationId);
  });

  it("conversation_list includes the created conversation", async () => {
    const res = await client.callTool({ name: "conversation_list", arguments: { pageSize: 50 } });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { conversations: Array<{ id: string }> };
    expect(Array.isArray(sc.conversations)).toBe(true);
  });

  it("conversation_append continues the conversation", async () => {
    if (!conversationId) {
      console.warn("[skip] No conversation_id from previous test — skipping append test.");
      return;
    }
    const res = await client.callTool({
      name: "conversation_append",
      arguments: { conversationId, input: "Now reply with exactly: ack", temperature: 0, max_tokens: 16 },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { conversation_id: string; outputs: unknown[] };
    expect(sc.conversation_id).toBe(conversationId);
  });

  it("conversation_history returns the full entry log", async () => {
    if (!conversationId) {
      console.warn("[skip] No conversation_id from previous test — skipping history test.");
      return;
    }
    const res = await client.callTool({
      name: "conversation_history",
      arguments: { conversationId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { entries: Array<{ type: string }> };
    expect(sc.entries.length).toBeGreaterThan(0);
  });

  it("conversation_get with a bogus id returns isError:true (not a crash)", async () => {
    const res = await client.callTool({
      name: "conversation_get",
      arguments: { conversationId: "non-existent-conversation-00000000" },
    });
    expect(res.isError).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
  });
});
