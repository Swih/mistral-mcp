/**
 * Contract tests — verify that every tool's returned `structuredContent` is a
 * strict match for its declared `outputSchema`.
 *
 * Why this matters: the MCP 2025-06-18 spec requires both fields to be present
 * AND consistent. If Mistral silently changes a response shape, this test
 * flags it before the package dreams about shipping broken. Unit tests catch
 * logic bugs; contract tests catch protocol drift.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";

import {
  registerMistralTools,
  ChatOutputSchema,
  ChatStreamOutputSchema,
  EmbedOutputSchema,
} from "../../src/tools.js";
import {
  registerFunctionTools,
  ToolCallOutputSchema,
  FimOutputSchema,
} from "../../src/tools-fn.js";
import {
  registerVisionTools,
  VisionOutputSchema,
  OcrOutputSchema,
} from "../../src/tools-vision.js";

function makeMock(): Mistral {
  return {
    chat: {
      complete: vi.fn(async (args: { tools?: unknown[] }) => ({
        choices: [
          {
            message: {
              content: args.tools ? null : "Bonjour.",
              toolCalls: args.tools
                ? [
                    {
                      id: "call_1",
                      function: {
                        name: "get_weather",
                        arguments: JSON.stringify({ city: "Paris" }),
                      },
                    },
                  ]
                : undefined,
            },
            finishReason: args.tools ? "tool_calls" : "stop",
          },
        ],
        usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
      })),
      stream: vi.fn(async function* () {
        yield { data: { choices: [{ delta: { content: "Bon" } }] } };
        yield {
          data: {
            choices: [{ delta: { content: "jour." }, finishReason: "stop" }],
            usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          },
        };
      }),
    },
    embeddings: {
      create: vi.fn(async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { promptTokens: 3, totalTokens: 3 },
      })),
    },
    fim: {
      complete: vi.fn(async () => ({
        choices: [
          {
            message: { content: "a + b" },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      })),
    },
    ocr: {
      process: vi.fn(async () => ({
        model: "mistral-ocr-latest",
        pages: [
          {
            index: 0,
            markdown: "# Heading",
            images: [],
            dimensions: { dpi: 150, height: 1000, width: 800 },
          },
        ],
        usageInfo: { pagesProcessed: 1 },
      })),
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "contract-test", version: "0.0.0" });
  registerMistralTools(server, mock);
  registerFunctionTools(server, mock);
  registerVisionTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client };
}

describe("contract: structuredContent matches outputSchema", () => {
  it("mistral_chat", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_chat",
      arguments: { messages: [{ role: "user", content: "Salut" }] },
    });
    expect(res.isError).toBeFalsy();
    const parsed = ChatOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_chat): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_chat_stream", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_chat_stream",
      arguments: { messages: [{ role: "user", content: "x" }] },
    });
    expect(res.isError).toBeFalsy();
    const parsed = ChatStreamOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_chat_stream): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_embed", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_embed",
      arguments: { inputs: ["hello"] },
    });
    expect(res.isError).toBeFalsy();
    const parsed = EmbedOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_embed): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_tool_call", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_tool_call",
      arguments: {
        messages: [{ role: "user", content: "weather in Paris?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Look up weather",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
        tool_choice: "any",
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = ToolCallOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_tool_call): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("codestral_fim", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "codestral_fim",
      arguments: {
        prompt: "def add(a, b):\n    return ",
        suffix: "\nprint(add(1, 2))",
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = FimOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (codestral_fim): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_vision", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", imageUrl: "https://example.com/x.png" },
            ],
          },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = VisionOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_vision): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_ocr", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "document_url",
          documentUrl: "https://example.com/doc.pdf",
        },
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = OcrOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_ocr): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });
});

describe("contract: every tool declares required spec-compliance hooks", () => {
  it("exposes outputSchema + annotations for all tools", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(7);
    for (const t of tools) {
      expect(t.outputSchema, `${t.name} missing outputSchema`).toBeTruthy();
      expect(t.annotations, `${t.name} missing annotations`).toBeTruthy();
      expect(
        typeof t.annotations?.readOnlyHint,
        `${t.name} missing readOnlyHint`
      ).toBe("boolean");
      expect(
        typeof t.annotations?.openWorldHint,
        `${t.name} missing openWorldHint`
      ).toBe("boolean");
      expect(
        typeof t.annotations?.destructiveHint,
        `${t.name} missing destructiveHint`
      ).toBe("boolean");
      expect(
        typeof t.annotations?.idempotentHint,
        `${t.name} missing idempotentHint`
      ).toBe("boolean");
    }
  });
});
