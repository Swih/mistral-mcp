/**
 * Unit tests for v0.4 agents + classifier tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerAgentTools } from "../../src/tools-agents.js";

function makeMock(): Mistral {
  return {
    agents: {
      complete: vi.fn(async () => ({
        id: "cmpl_agent_1",
        model: "agent-backend-mistral-medium-latest",
        choices: [
          {
            message: { content: "Hello from the agent." },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 10, completionTokens: 6, totalTokens: 16 },
      })),
    },
    classifiers: {
      moderate: vi.fn(async () => ({
        id: "mod_1",
        model: "mistral-moderation-latest",
        results: [
          {
            categories: {
              sexual: false,
              hate_and_discrimination: false,
              violence_and_threats: false,
              selfharm: false,
            },
            categoryScores: {
              sexual: 0.001,
              hate_and_discrimination: 0.002,
              violence_and_threats: 0.003,
              selfharm: 0.0001,
            },
          },
        ],
      })),
      classify: vi.fn(async () => ({
        id: "cls_1",
        model: "ft:classifier:xyz",
        results: [
          { sentiment: { scores: { positive: 0.9, negative: 0.1 } } },
        ],
      })),
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "agents-test", version: "0.0.0" });
  registerAgentTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (agents + classifiers)", () => {
  it("exposes mistral_agent, mistral_moderate, mistral_classify", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "mistral_agent",
      "mistral_classify",
      "mistral_moderate",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });
});

describe("mistral_agent", () => {
  it("forwards agentId + messages and returns structured text", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "mistral_agent",
      arguments: {
        agentId: "ag:1234",
        messages: [{ role: "user", content: "Hi agent" }],
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      text: string;
      model: string;
      agent_id: string;
      finish_reason?: string;
    };
    expect(sc.text).toContain("agent");
    expect(sc.agent_id).toBe("ag:1234");
    expect(sc.finish_reason).toBe("stop");

    const arg = (mock.agents.complete as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.agentId).toBe("ag:1234");
    expect(Array.isArray(arg?.messages)).toBe(true);
  });

  it("rejects empty messages", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_agent",
      arguments: { agentId: "ag:1", messages: [] },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects missing agentId", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_agent",
      arguments: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.agents.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("agent_not_found")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_agent",
      arguments: {
        agentId: "ag:missing",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("agent_not_found");
    expect(text).toContain("mistral_agent");
  });
});

describe("mistral_moderate", () => {
  it("accepts a single string input and returns structured results", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: "Bonjour, tout va bien." },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      model: string;
      results: Array<{
        categories?: Record<string, boolean>;
        category_scores?: Record<string, number>;
      }>;
    };
    expect(sc.id).toBe("mod_1");
    expect(sc.results.length).toBe(1);
    expect(sc.results[0]?.categories?.selfharm).toBe(false);
    expect(sc.results[0]?.category_scores?.sexual).toBeLessThan(0.01);

    const arg = (mock.classifiers.moderate as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.model).toBe("mistral-moderation-latest"); // default
    expect(arg?.inputs).toBe("Bonjour, tout va bien.");
  });

  it("accepts an array of texts", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: ["one", "two", "three"] },
    });
    const arg = (mock.classifiers.moderate as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.inputs).toEqual(["one", "two", "three"]);
  });

  it("reports flagged count in the text summary", async () => {
    const mock = makeMock();
    (
      mock.classifiers.moderate as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: "mod_flag",
      model: "mistral-moderation-latest",
      results: [
        { categories: { violence_and_threats: true }, categoryScores: {} },
        { categories: { violence_and_threats: false }, categoryScores: {} },
      ],
    });
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: ["bad", "ok"] },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("2 input(s)");
    expect(text).toContain("1 flagged");
  });

  it("rejects an empty inputs array", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: [] },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (
      mock.classifiers.moderate as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("rate_limit"));
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: "hi" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("rate_limit");
    expect(text).toContain("mistral_moderate");
  });
});

describe("mistral_classify", () => {
  it("forwards model + inputs and returns per-target scores", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "mistral_classify",
      arguments: {
        model: "ft:classifier:xyz",
        inputs: "Ce produit est génial !",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      model: string;
      results: Array<Record<string, { scores: Record<string, number> }>>;
    };
    expect(sc.results[0]?.sentiment?.scores.positive).toBe(0.9);

    const arg = (mock.classifiers.classify as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.model).toBe("ft:classifier:xyz");
    expect(arg?.inputs).toBe("Ce produit est génial !");
  });

  it("rejects a missing model", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_classify",
      arguments: { inputs: "hi" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (
      mock.classifiers.classify as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("classifier_not_found"));
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_classify",
      arguments: { model: "ft:classifier:unknown", inputs: "hi" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("classifier_not_found");
    expect(text).toContain("mistral_classify");
  });
});
