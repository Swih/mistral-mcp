/**
 * Unit tests for the MCP sampling tool (mcp_sample).
 *
 * We wire a pair of InMemoryTransports so the "server-calling-client-LLM"
 * loop is real. The test client registers its own sampling handler, so the
 * server's `createMessage(...)` actually round-trips.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerSamplingTools } from "../../src/tools-sampling.js";

async function boot(opts: {
  clientSupportsSampling?: boolean;
  sampleImpl?: (req: unknown) => Promise<unknown> | unknown;
} = {}) {
  const server = new McpServer({ name: "sampling-test", version: "0.0.0" });
  registerSamplingTools(server);

  const client = new Client(
    { name: "c", version: "0.0.0" },
    opts.clientSupportsSampling === false
      ? undefined
      : { capabilities: { sampling: {} } }
  );

  const handler =
    opts.sampleImpl ??
    (async () => ({
      role: "assistant",
      content: { type: "text", text: "Delegated reply." },
      model: "claude-test",
      stopReason: "endTurn",
    }));
  client.setRequestHandler(CreateMessageRequestSchema, handler);

  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

describe("tool listing (sampling)", () => {
  it("exposes mcp_sample with the right annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const sample = tools.find((t) => t.name === "mcp_sample");
    expect(sample).toBeTruthy();
    expect(sample?.outputSchema).toBeTruthy();
    expect(sample?.annotations?.readOnlyHint).toBe(true);
    expect(sample?.annotations?.openWorldHint).toBe(true);
  });
});

describe("mcp_sample", () => {
  it("delegates to the client's LLM and returns structured text", async () => {
    const sampleSpy = vi.fn(async () => ({
      role: "assistant",
      content: { type: "text", text: "Delegated reply." },
      model: "claude-haiku",
      stopReason: "endTurn",
    }));
    const { client } = await boot({ sampleImpl: sampleSpy });

    const result = await client.callTool({
      name: "mcp_sample",
      arguments: {
        messages: [{ role: "user", content: "Summarize: hello world." }],
        system_prompt: "Be terse.",
        max_tokens: 64,
        temperature: 0.1,
        include_context: "none",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      role: string;
      text: string;
      model: string;
      stop_reason?: string;
    };
    expect(sc.role).toBe("assistant");
    expect(sc.text).toBe("Delegated reply.");
    expect(sc.model).toBe("claude-haiku");
    expect(sc.stop_reason).toBe("endTurn");

    expect(sampleSpy).toHaveBeenCalledTimes(1);
    const callReq = sampleSpy.mock.calls[0]?.[0] as {
      params: {
        messages: Array<{ role: string; content: { type: string; text: string } }>;
        systemPrompt?: string;
        maxTokens: number;
        temperature?: number;
        includeContext?: string;
      };
    };
    expect(callReq.params.messages[0]?.content.text).toContain("Summarize");
    expect(callReq.params.systemPrompt).toBe("Be terse.");
    expect(callReq.params.maxTokens).toBe(64);
    expect(callReq.params.temperature).toBe(0.1);
    expect(callReq.params.includeContext).toBe("none");
  });

  it("forwards model preferences (hints + priorities)", async () => {
    const sampleSpy = vi.fn(async () => ({
      role: "assistant",
      content: { type: "text", text: "ok" },
      model: "claude",
    }));
    const { client } = await boot({ sampleImpl: sampleSpy });

    await client.callTool({
      name: "mcp_sample",
      arguments: {
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 16,
        model_preferences: {
          hints: [{ name: "claude" }],
          cost_priority: 0.9,
          speed_priority: 0.3,
          intelligence_priority: 0.8,
        },
      },
    });

    const req = sampleSpy.mock.calls[0]?.[0] as {
      params: {
        modelPreferences?: {
          hints?: Array<{ name: string }>;
          costPriority?: number;
          speedPriority?: number;
          intelligencePriority?: number;
        };
      };
    };
    expect(req.params.modelPreferences?.hints?.[0]?.name).toBe("claude");
    expect(req.params.modelPreferences?.costPriority).toBe(0.9);
    expect(req.params.modelPreferences?.speedPriority).toBe(0.3);
    expect(req.params.modelPreferences?.intelligencePriority).toBe(0.8);
  });

  it("rejects an empty messages array", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mcp_sample",
      arguments: { messages: [], max_tokens: 16 },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects a missing max_tokens", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mcp_sample",
      arguments: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError when the client rejects sampling", async () => {
    const { client } = await boot({
      sampleImpl: async () => {
        throw new Error("user_denied_sampling");
      },
    });

    const result = await client.callTool({
      name: "mcp_sample",
      arguments: {
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 16,
      },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("mcp_sample");
    expect(text).toContain("user_denied_sampling");
  });
});
