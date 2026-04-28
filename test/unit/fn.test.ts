/**
 * Unit tests for v0.3 function-calling + FIM tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerFunctionTools } from "../../src/tools-fn.js";

function makeMock() {
  return {
    chat: {
      complete: vi.fn(async (_args: Record<string, unknown>) => ({
        choices: [
          {
            message: {
              content: null,
              toolCalls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"city":"Paris"}',
                  },
                },
              ],
            },
            finishReason: "tool_calls",
          },
        ],
        usage: { promptTokens: 50, completionTokens: 8, totalTokens: 58 },
      })),
    },
    fim: {
      complete: vi.fn(async (_args: Record<string, unknown>) => ({
        choices: [
          {
            message: { content: "a + b" },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      })),
    },
  } as unknown as InstanceType<typeof import("@mistralai/mistralai").Mistral>;
}

async function bootPair(mock = makeMock()) {
  const server = new McpServer({ name: "fn-test", version: "0.0.0" });
  registerFunctionTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("mistral_tool_call", () => {
  it("returns parsed tool_calls in structuredContent", async () => {
    const { client } = await bootPair();
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "get_weather",
          description: "Look up city weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      },
    ];
    const result = await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "Weather in Paris?" }],
        tools,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      tool_calls: Array<{ id?: string; name: string; arguments: string }>;
      model: string;
      finish_reason?: string;
    };
    expect(sc.tool_calls.length).toBe(1);
    expect(sc.tool_calls[0]?.name).toBe("get_weather");
    expect(sc.tool_calls[0]?.arguments).toBe('{"city":"Paris"}');
    expect(sc.finish_reason).toBe("tool_calls");
  });

  it("rejects tools schema with empty array", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        tools: [],
      },
    });
    expect(result.isError).toBe(true);
  });

  it("passes tool_choice and parallel_tool_calls through to the SDK", async () => {
    const { client, mock } = await bootPair();
    await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        tools: [
          {
            type: "function",
            function: {
              name: "noop",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        tool_choice: "any",
        parallel_tool_calls: false,
      },
    });
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.toolChoice).toBe("any");
    expect(call?.parallelToolCalls).toBe(false);
  });

  it("surfaces API failures as isError:true", async () => {
    const mock = makeMock();
    (mock.chat.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("server_overloaded")
    );
    const { client } = await bootPair(mock);
    const result = await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        tools: [
          {
            type: "function",
            function: {
              name: "noop",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("server_overloaded");
  });
});

describe("codestral_fim", () => {
  it("returns the FIM completion with usage + model", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "codestral_fim",
      arguments: {
        prompt: "def add(a, b):\n    return ",
        suffix: "\n\nprint(add(1, 2))",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      text: string;
      model: string;
      usage?: { totalTokens: number };
    };
    expect(sc.text).toBe("a + b");
    expect(sc.model).toBe("codestral-latest");
    expect(sc.usage?.totalTokens).toBe(14);
  });

  it("rejects an unsupported FIM model", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "codestral_fim",
      arguments: {
        prompt: "x",
        suffix: "",
        model: "mistral-large-latest", // not a FIM model
      },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects empty prompt", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "codestral_fim",
      arguments: { prompt: "", suffix: "x" },
    });
    expect(result.isError).toBe(true);
  });

  it("passes stop tokens through to the SDK", async () => {
    const { client, mock } = await bootPair();
    await client.callTool({
      name: "codestral_fim",
      arguments: {
        prompt: "a",
        suffix: "b",
        stop: ["\n\n", "END"],
      },
    });
    const call = (mock.fim.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.stop).toEqual(["\n\n", "END"]);
  });

  it("propagates `seed` to the SDK as `randomSeed`", async () => {
    const { client, mock } = await bootPair();
    await client.callTool({
      name: "codestral_fim",
      arguments: { prompt: "a", suffix: "b", seed: 99 },
    });
    const call = (mock.fim.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.randomSeed).toBe(99);
  });
});

describe("mistral_tool_call — v0.5 surface", () => {
  const fnTools = [
    {
      type: "function" as const,
      function: {
        name: "get_weather",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    },
  ];

  it("propagates `seed` to the SDK as `randomSeed`", async () => {
    const { client, mock } = await bootPair();
    await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        tools: fnTools,
        seed: 13,
      },
    });
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.randomSeed).toBe(13);
  });

  it("translates response_format json_schema (snake_case) to SDK camelCase", async () => {
    const { client, mock } = await bootPair();
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        tools: fnTools,
        response_format: {
          type: "json_schema",
          json_schema: { name: "answer", schema, strict: false },
        },
      },
    });
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.responseFormat).toEqual({
      type: "json_schema",
      jsonSchema: {
        name: "answer",
        description: undefined,
        schemaDefinition: schema,
        strict: false,
      },
    });
  });
});
