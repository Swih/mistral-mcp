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
import {
  registerAudioTools,
  TranscribeOutputSchema,
  SpeakOutputSchema,
} from "../../src/tools-audio.js";
import {
  registerAgentTools,
  AgentOutputSchema,
  ModerateOutputSchema,
  ClassifyOutputSchema,
} from "../../src/tools-agents.js";
import {
  registerFileTools,
  FileUploadOutputSchema,
  FileListOutputSchema,
  FileGetOutputSchema,
  FileDeleteOutputSchema,
  FileSignedUrlOutputSchema,
} from "../../src/tools-files.js";
import {
  registerBatchTools,
  BatchJobOutputSchema,
  BatchListOutputSchema,
} from "../../src/tools-batch.js";
import {
  registerSamplingTools,
  SampleOutputSchema,
} from "../../src/tools-sampling.js";

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
    audio: {
      transcriptions: {
        complete: vi.fn(async () => ({
          model: "voxtral-mini-latest",
          text: "Bonjour.",
          language: "fr",
          usage: { promptTokens: 0, completionTokens: 4, totalTokens: 4 },
        })),
      },
      speech: {
        complete: vi.fn(async () => ({ audioData: "Zm9v" })),
      },
    },
    agents: {
      complete: vi.fn(async () => ({
        id: "cmpl_agent",
        model: "agent-backend",
        choices: [
          {
            message: { content: "Agent reply." },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      })),
    },
    classifiers: {
      moderate: vi.fn(async () => ({
        id: "mod_ct",
        model: "mistral-moderation-latest",
        results: [
          {
            categories: { sexual: false },
            categoryScores: { sexual: 0.001 },
          },
        ],
      })),
      classify: vi.fn(async () => ({
        id: "cls_ct",
        model: "ft:classifier:abc",
        results: [{ label: { scores: { a: 0.7, b: 0.3 } } }],
      })),
    },
    files: {
      upload: vi.fn(async () => ({
        id: "file_ct",
        object: "file",
        sizeBytes: 5,
        createdAt: 1_700_000_000,
        filename: "x.txt",
        purpose: "batch",
        sampleType: "batch_request",
        source: "upload",
      })),
      list: vi.fn(async () => ({
        data: [
          {
            id: "file_ct",
            object: "file",
            sizeBytes: 5,
            createdAt: 1_700_000_000,
            filename: "x.txt",
            purpose: "batch",
            sampleType: "batch_request",
            source: "upload",
          },
        ],
        object: "list",
        total: 1,
      })),
      retrieve: vi.fn(async () => ({
        id: "file_ct",
        object: "file",
        sizeBytes: 5,
        createdAt: 1_700_000_000,
        filename: "x.txt",
        purpose: "batch",
        sampleType: "batch_request",
        source: "upload",
        deleted: false,
      })),
      delete: vi.fn(async () => ({
        id: "file_ct",
        object: "file",
        deleted: true,
      })),
      getSignedUrl: vi.fn(async () => ({
        url: "https://example.com/signed",
      })),
    },
    batch: {
      jobs: {
        create: vi.fn(async () => ({
          id: "batch_ct",
          object: "batch",
          inputFiles: ["file_ct"],
          endpoint: "/v1/chat/completions",
          errors: [],
          status: "QUEUED",
          createdAt: 1_700_000_000,
          totalRequests: 1,
          completedRequests: 0,
          succeededRequests: 0,
          failedRequests: 0,
        })),
        get: vi.fn(async () => ({
          id: "batch_ct",
          object: "batch",
          inputFiles: ["file_ct"],
          endpoint: "/v1/chat/completions",
          errors: [],
          status: "SUCCESS",
          createdAt: 1_700_000_000,
          totalRequests: 1,
          completedRequests: 1,
          succeededRequests: 1,
          failedRequests: 0,
        })),
        list: vi.fn(async () => ({
          data: [
            {
              id: "batch_ct",
              object: "batch",
              inputFiles: ["file_ct"],
              endpoint: "/v1/chat/completions",
              errors: [],
              status: "QUEUED",
              createdAt: 1_700_000_000,
              totalRequests: 1,
              completedRequests: 0,
              succeededRequests: 0,
              failedRequests: 0,
            },
          ],
          object: "list",
          total: 1,
        })),
        cancel: vi.fn(async () => ({
          id: "batch_ct",
          object: "batch",
          inputFiles: ["file_ct"],
          endpoint: "/v1/chat/completions",
          errors: [],
          status: "CANCELLATION_REQUESTED",
          createdAt: 1_700_000_000,
          totalRequests: 1,
          completedRequests: 0,
          succeededRequests: 0,
          failedRequests: 0,
        })),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "contract-test", version: "0.0.0" });
  registerMistralTools(server, mock);
  registerFunctionTools(server, mock);
  registerVisionTools(server, mock);
  registerAudioTools(server, mock);
  registerAgentTools(server, mock);
  registerFileTools(server, mock);
  registerBatchTools(server, mock);
  registerSamplingTools(server);
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

  it("voxtral_transcribe", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: { type: "file_url", fileUrl: "https://example.com/a.mp3" },
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = TranscribeOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (voxtral_transcribe): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("voxtral_speak", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "Salut" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = SpeakOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (voxtral_speak): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_agent", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_agent",
      arguments: {
        agentId: "ag:ct",
        messages: [{ role: "user", content: "hi" }],
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = AgentOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_agent): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_moderate", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_moderate",
      arguments: { inputs: "hello" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = ModerateOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_moderate): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mistral_classify", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "mistral_classify",
      arguments: { model: "ft:classifier:abc", inputs: "hello" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = ClassifyOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (mistral_classify): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("files_upload", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "files_upload",
      arguments: { filename: "x.txt", content_base64: "aGk=" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = FileUploadOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (files_upload): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("files_list", async () => {
    const { client } = await boot();
    const res = await client.callTool({ name: "files_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const parsed = FileListOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (files_list): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("files_get", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "files_get",
      arguments: { fileId: "file_ct" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = FileGetOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (files_get): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("files_delete", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "files_delete",
      arguments: { fileId: "file_ct" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = FileDeleteOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (files_delete): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("files_signed_url", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "files_signed_url",
      arguments: { fileId: "file_ct" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = FileSignedUrlOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (files_signed_url): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("batch_create", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "batch_create",
      arguments: {
        input_files: ["file_ct"],
        endpoint: "/v1/chat/completions",
      },
    });
    expect(res.isError).toBeFalsy();
    const parsed = BatchJobOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (batch_create): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("batch_get", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "batch_get",
      arguments: { jobId: "batch_ct" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = BatchJobOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (batch_get): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("batch_list", async () => {
    const { client } = await boot();
    const res = await client.callTool({ name: "batch_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const parsed = BatchListOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (batch_list): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("batch_cancel", async () => {
    const { client } = await boot();
    const res = await client.callTool({
      name: "batch_cancel",
      arguments: { jobId: "batch_ct" },
    });
    expect(res.isError).toBeFalsy();
    const parsed = BatchJobOutputSchema.safeParse(res.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `Contract violation (batch_cancel): ${JSON.stringify(parsed.error.format(), null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("mcp_sample has an outputSchema (runtime shape validated in unit tests)", () => {
    const shape = SampleOutputSchema.shape;
    expect(shape.role).toBeTruthy();
    expect(shape.text).toBeTruthy();
    expect(shape.model).toBeTruthy();
  });
});

describe("contract: every tool declares required spec-compliance hooks", () => {
  it("exposes outputSchema + annotations for all tools", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(22);
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
