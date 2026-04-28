/**
 * Unit tests for v0.4 vision + OCR tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerVisionTools } from "../../src/tools-vision.js";
import { VISION_MODELS } from "../../src/models.js";

function makeMock(overrides: Partial<Record<string, unknown>> = {}): Mistral {
  return {
    chat: {
      complete: vi.fn(async () => ({
        choices: [
          {
            message: { content: "Une licorne verte sur un vélo rose." },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
      })),
    },
    ocr: {
      process: vi.fn(async () => ({
        model: "mistral-ocr-latest",
        pages: [
          {
            index: 0,
            markdown: "# Title\n\nBody text.",
            images: [
              {
                id: "img-0",
                topLeftX: 10,
                topLeftY: 20,
                bottomRightX: 110,
                bottomRightY: 120,
                imageBase64: null,
                imageAnnotation: JSON.stringify({
                  image_type: "logo",
                  short_description: "Example logo",
                }),
              },
            ],
            tables: undefined,
            hyperlinks: ["https://example.com"],
            header: "Page header",
            footer: null,
            dimensions: { dpi: 150, height: 1200, width: 800 },
            confidenceScores: {
              averagePageConfidenceScore: 0.98,
              minimumPageConfidenceScore: 0.91,
              wordConfidenceScores: [
                { text: "Title", confidence: 0.99, startIndex: 2 },
              ],
            },
          },
          {
            index: 1,
            markdown: "Second page content.",
            images: [],
            dimensions: null,
          },
        ],
        documentAnnotation: JSON.stringify({ vendor: "ACME", total: 42 }),
        usageInfo: { pagesProcessed: 2, docSizeBytes: 12345 },
      })),
    },
    ...overrides,
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "vision-test", version: "0.0.0" });
  registerVisionTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (vision + ocr)", () => {
  it("exposes mistral_vision and mistral_ocr with annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["mistral_ocr", "mistral_vision"]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });
});

describe("mistral_vision", () => {
  it("accepts multimodal content (text + image_url)", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image." },
              { type: "image_url", imageUrl: "https://example.com/cat.png" },
            ],
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { text: string; model: string };
    expect(sc.text).toContain("licorne");
    expect(sc.model).toBe("pixtral-large-latest"); // default vision model

    const callArg = (mock.chat.complete as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(callArg?.model).toBe("pixtral-large-latest");
    expect(Array.isArray(callArg?.messages)).toBe(true);
  });

  it("accepts plain-string content too (pure text prompt)", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [{ role: "user", content: "Tell me about vision models." }],
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("rejects a non-vision model", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hi" }],
          },
        ],
        model: "codestral-latest",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("accepts every vision-capable model alias", async () => {
    const { client } = await boot();
    for (const model of VISION_MODELS) {
      const result = await client.callTool({
        name: "mistral_vision",
        arguments: {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "x" }],
            },
          ],
          model,
        },
      });
      expect(result.isError).toBeFalsy();
    }
  });

  it("accepts data:image/...;base64 inline payload", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              {
                type: "image_url",
                imageUrl: {
                  url: "data:image/png;base64,iVBOR...",
                  detail: "high",
                },
              },
            ],
          },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("propagates `seed` to the SDK as `randomSeed`", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [{ role: "user", content: "x" }],
        seed: 77,
      },
    });
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.randomSeed).toBe(77);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.chat.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("image_too_large")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_vision",
      arguments: {
        messages: [{ role: "user", content: "x" }],
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("image_too_large");
    expect(text).toContain("mistral_vision");
  });
});

describe("mistral_ocr", () => {
  it("accepts document_url and returns structured pages", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "document_url",
          documentUrl: "https://example.com/contract.pdf",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      pages: Array<{ index: number; markdown: string; hyperlinks?: string[] }>;
      model: string;
      pages_count: number;
      document_annotation?: string;
      annotations?: {
        document_annotation?: string;
        image_annotations?: Array<{ annotation: string }>;
      };
      usage?: { pages_processed?: number };
    };
    expect(sc.pages_count).toBe(2);
    expect(sc.pages[0]?.markdown).toContain("Title");
    expect(sc.pages[0]?.hyperlinks?.[0]).toBe("https://example.com");
    expect(sc.model).toBe("mistral-ocr-latest");
    expect(sc.document_annotation).toContain("ACME");
    expect(sc.annotations?.document_annotation).toContain("vendor");
    expect(sc.annotations?.image_annotations?.[0]?.annotation).toContain(
      "logo"
    );
    expect(sc.usage?.pages_processed).toBe(2);
  });

  it("accepts image_url input", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "image_url",
          imageUrl: "https://example.com/receipt.jpg",
        },
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("accepts file fileId input (from Files API)", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: { type: "file", fileId: "file_abc123" },
      },
    });
    expect(result.isError).toBeFalsy();
  });

  it("forwards tableFormat, extractHeader, pages options", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "document_url",
          documentUrl: "https://example.com/c.pdf",
        },
        tableFormat: "html",
        extractHeader: true,
        extractFooter: true,
        pages: [0, 2, 4],
      },
    });
    const arg = (mock.ocr.process as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.tableFormat).toBe("html");
    expect(arg?.extractHeader).toBe(true);
    expect(arg?.pages).toEqual([0, 2, 4]);
  });

  it("forwards OCR annotation formats and confidence granularity", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "document_url",
          documentUrl: "https://example.com/invoice.pdf",
        },
        document_annotation_format: {
          type: "json_schema",
          json_schema: {
            name: "invoice",
            schema: {
              type: "object",
              properties: {
                vendor: { type: "string" },
              },
              required: ["vendor"],
            },
            strict: true,
          },
        },
        bbox_annotation_format: {
          type: "json_schema",
          json_schema: {
            name: "figure",
            schema: {
              type: "object",
              properties: {
                short_description: { type: "string" },
              },
            },
          },
        },
        document_annotation_prompt: "Extract invoice metadata.",
        confidence_scores_granularity: "word",
      },
    });
    const arg = (mock.ocr.process as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.documentAnnotationFormat).toEqual({
      type: "json_schema",
      jsonSchema: {
        name: "invoice",
        description: undefined,
        schemaDefinition: {
          type: "object",
          properties: {
            vendor: { type: "string" },
          },
          required: ["vendor"],
        },
        strict: true,
      },
    });
    expect(arg?.bboxAnnotationFormat?.jsonSchema?.name).toBe("figure");
    expect(arg?.documentAnnotationPrompt).toBe("Extract invoice metadata.");
    expect(arg?.confidenceScoresGranularity).toBe("word");
  });

  it("rejects missing document", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "mistral_ocr",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.ocr.process as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("document_parse_failed")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "mistral_ocr",
      arguments: {
        document: {
          type: "document_url",
          documentUrl: "https://example.com/bad.pdf",
        },
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("document_parse_failed");
  });
});
