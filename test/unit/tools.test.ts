/**
 * Unit tests — verify tool registration, input validation, output shape, and error
 * handling without hitting the real Mistral API. We pass a fake Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerMistralTools } from "../../src/tools.js";
import { CHAT_MODELS } from "../../src/models.js";
import type { MistralProfile } from "../../src/profile.js";

type ChatArgs = Parameters<
  InstanceType<typeof import("@mistralai/mistralai").Mistral>["chat"]["complete"]
>[0];

function makeMockMistral(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chat: {
      complete: vi.fn(async (_args: ChatArgs) => ({
        choices: [
          {
            message: { content: "Bonjour." },
            finishReason: "stop",
          },
        ],
        usage: {
          promptTokens: 12,
          completionTokens: 4,
          totalTokens: 16,
        },
      })),
      stream: vi.fn(async function* () {
        yield { data: { choices: [{ delta: { content: "Bon" } }] } };
        yield { data: { choices: [{ delta: { content: "jour" } }] } };
        yield {
          data: {
            choices: [{ delta: { content: "." }, finishReason: "stop" }],
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          },
        };
      }),
    },
    embeddings: {
      create: vi.fn(async () => ({
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
        usage: { promptTokens: 8, totalTokens: 8 },
      })),
    },
    ...overrides,
  } as unknown as InstanceType<typeof import("@mistralai/mistralai").Mistral>;
}

async function bootPair(
  mockMistral = makeMockMistral(),
  profile: MistralProfile = "admin"
) {
  const server = new McpServer({ name: "mistral-mcp-test", version: "0.0.0" });
  registerMistralTools(server, mockMistral, profile);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { server, client, mockMistral };
}

describe("tool listing", () => {
  it("admin profile exposes all three tools with annotations + outputSchema", async () => {
    const { client } = await bootPair(makeMockMistral(), "admin");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["mistral_chat", "mistral_chat_stream", "mistral_embed"]);

    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });

  it("core profile exposes only mistral_chat", async () => {
    const { client } = await bootPair(makeMockMistral(), "core");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["mistral_chat"]);
  });

  it("workflows profile exposes no tools from this module", async () => {
    const { client } = await bootPair(makeMockMistral(), "workflows");
    // Server has no tools → SDK does not advertise the tools capability →
    // listTools throws McpError -32601. Treat that as an empty tool list.
    const result = await client.listTools().catch(() => ({ tools: [] as unknown[] }));
    expect(result.tools).toHaveLength(0);
  });
});

describe("mistral_chat", () => {
  it("returns both content[] text AND structuredContent (MCP 2025-06-18 spec)", async () => {
    const { client, mockMistral } = await bootPair();
    const result = await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "Salut" }],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.content)).toBe(true);
    const first = (result.content as Array<{ type: string; text: string }>)[0];
    expect(first.type).toBe("text");
    expect(first.text).toBe("Bonjour.");

    expect(result.structuredContent).toBeTruthy();
    const sc = result.structuredContent as {
      text: string;
      model: string;
      usage?: { totalTokens: number };
      finish_reason?: string;
    };
    expect(sc.text).toBe("Bonjour.");
    expect(sc.model).toBe("mistral-medium-latest"); // default
    expect(sc.usage?.totalTokens).toBe(16);
    expect(sc.finish_reason).toBe("stop");

    // verify default model actually propagates to the SDK call
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.model).toBe("mistral-medium-latest");
  });

  it("rejects an unsupported model via input schema validation", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        model: "mistral-does-not-exist",
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/Input validation error|invalid_enum_value/i);
  });

  it("accepts every model in the canonical allow-list", async () => {
    const { client, mockMistral } = await bootPair();
    for (const model of CHAT_MODELS) {
      const result = await client.callTool({
        name: "mistral_chat",
        arguments: { messages: [{ role: "user", content: "x" }], model },
      });
      expect(result.isError).toBeFalsy();
    }
    expect(
      (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBe(CHAT_MODELS.length);
  });

  it("returns isError:true when the Mistral API throws", async () => {
    const mock = makeMockMistral();
    (mock.chat.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("rate_limit_exceeded")
    );
    const { client } = await bootPair(mock);

    const result = await client.callTool({
      name: "mistral_chat",
      arguments: { messages: [{ role: "user", content: "x" }] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("rate_limit_exceeded");
    expect(text).toContain("mistral_chat");
  });
});

describe("mistral_chat_stream", () => {
  it("assembles streamed chunks, reports chunk count, captures finish_reason", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_chat_stream",
      arguments: { messages: [{ role: "user", content: "Salut" }] },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      text: string;
      chunks: number;
      model: string;
      finish_reason?: string;
      usage?: { totalTokens: number };
    };
    expect(sc.text).toBe("Bonjour.");
    expect(sc.chunks).toBe(3);
    expect(sc.model).toBe("mistral-medium-latest");
    expect(sc.finish_reason).toBe("stop");
    expect(sc.usage?.totalTokens).toBe(8);
  });

  it("handles an empty stream gracefully (no chunks, empty text)", async () => {
    const mock = makeMockMistral();
    (mock.chat.stream as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async function* () {
        /* empty */
      }
    );
    const { client } = await bootPair(mock);
    const result = await client.callTool({
      name: "mistral_chat_stream",
      arguments: { messages: [{ role: "user", content: "x" }] },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { text: string; chunks: number };
    expect(sc.text).toBe("");
    expect(sc.chunks).toBe(0);
  });

  it("returns isError:true when the stream throws mid-flight", async () => {
    const mock = makeMockMistral();
    (mock.chat.stream as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async function* () {
        yield { data: { choices: [{ delta: { content: "Bon" } }] } };
        throw new Error("upstream connection reset");
      }
    );
    const { client } = await bootPair(mock);
    const result = await client.callTool({
      name: "mistral_chat_stream",
      arguments: { messages: [{ role: "user", content: "x" }] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("upstream connection reset");
    expect(text).toContain("mistral_chat_stream");
  });
});

describe("mistral_chat — v0.5 surface", () => {
  it("propagates `seed` to the SDK as `randomSeed`", async () => {
    const { client, mockMistral } = await bootPair();
    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        seed: 42,
      },
    });
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.randomSeed).toBe(42);
  });

  it("propagates `response_format: json_object` to the SDK", async () => {
    const { client, mockMistral } = await bootPair();
    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        response_format: { type: "json_object" },
      },
    });
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.responseFormat).toEqual({ type: "json_object" });
  });

  it("translates snake_case json_schema to camelCase + schemaDefinition", async () => {
    const { client, mockMistral } = await bootPair();
    const schema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "address", schema, strict: true },
        },
      },
    });
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.responseFormat).toEqual({
      type: "json_schema",
      jsonSchema: {
        name: "address",
        description: undefined,
        schemaDefinition: schema,
        strict: true,
      },
    });
  });

  it("omits responseFormat when type is `text` (SDK default)", async () => {
    const { client, mockMistral } = await bootPair();
    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        response_format: { type: "text" },
      },
    });
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.responseFormat).toBeUndefined();
  });

  it("extracts Magistral reasoning into `reasoning_content` and keeps the visible text clean", async () => {
    const mock = makeMockMistral();
    (mock.chat.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: [
              {
                type: "thinking",
                thinking: [{ type: "text", text: "Let me reason... " }],
              },
              { type: "text", text: "Final answer." },
            ],
          },
          finishReason: "stop",
        },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const { client } = await bootPair(mock);

    const result = await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "Solve" }],
        model: "magistral-medium-latest",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      text: string;
      reasoning_content?: string;
    };
    expect(sc.text).toBe("Final answer.");
    expect(sc.reasoning_content).toBe("Let me reason... ");

    // text fallback in content[] must NOT include the reasoning trace
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toBe("Final answer.");
  });

  it("leaves `reasoning_content` undefined for non-reasoning models (string content)", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_chat",
      arguments: { messages: [{ role: "user", content: "Hi" }] },
    });
    const sc = result.structuredContent as { reasoning_content?: string };
    expect(sc.reasoning_content).toBeUndefined();
  });

  it("propagates `reasoning_effort` to the SDK as `reasoningEffort`", async () => {
    const { client, mockMistral } = await bootPair();
    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        reasoning_effort: "high",
      },
    });
    const call = (mockMistral.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.reasoningEffort).toBe("high");
  });
});

describe("mistral_chat_stream — v0.5 surface", () => {
  it("propagates `seed` and `response_format` to `mistral.chat.stream`", async () => {
    const { client, mockMistral } = await bootPair();
    await client.callTool({
      name: "mistral_chat_stream",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        seed: 7,
        response_format: { type: "json_object" },
      },
    });
    const call = (mockMistral.chat.stream as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.randomSeed).toBe(7);
    expect(call?.responseFormat).toEqual({ type: "json_object" });
  });
});

describe("mistral_embed", () => {
  it("returns vectors + dimensions + usage in structuredContent, summary in text", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_embed",
      arguments: { inputs: ["alpha", "beta"] },
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/Embedded 2 input\(s\) into 3-dim vectors/);

    const sc = result.structuredContent as {
      vectors: number[][];
      dimensions: number;
      model: string;
      usage?: { totalTokens: number };
    };
    expect(sc.vectors.length).toBe(2);
    expect(sc.dimensions).toBe(3);
    expect(sc.model).toBe("mistral-embed");
    expect(sc.usage?.totalTokens).toBe(8);
  });

  it("rejects an empty inputs array", async () => {
    const { client } = await bootPair();
    const result = await client.callTool({
      name: "mistral_embed",
      arguments: { inputs: [] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/at least 1 element/i);
  });

  it("rejects more than 100 inputs", async () => {
    const { client } = await bootPair();
    const inputs = Array.from({ length: 101 }, (_, i) => `s${i}`);
    const result = await client.callTool({
      name: "mistral_embed",
      arguments: { inputs },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/at most 100 element/i);
  });
});
