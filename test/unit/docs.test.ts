/**
 * Unit tests for the documents vertical (process_document macro-tool).
 *
 * Verifies:
 * - input schema parsing for the three source variants and the kind enum
 * - tool registration
 * - cache write/read roundtrip with a temp dir
 * - generic-kind happy path with mocked OCR (no extraction call)
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  registerDocsTools,
  ProcessDocumentInputShape,
  ProcessDocumentOutputSchema,
} from "../../src/tools-docs.js";
import { z } from "zod";

const InputSchema = z.object(ProcessDocumentInputShape);

function mockMistral(ocrText = "Sample document text\n\npage 1 content") {
  return {
    ocr: {
      process: vi.fn(async () => ({
        pages: [
          {
            index: 0,
            markdown: ocrText,
            confidenceScores: { averagePageConfidenceScore: 0.95, minimumPageConfidenceScore: 0.9 },
          },
        ],
        model: "mistral-ocr-latest",
        pagesCount: 1,
      })),
    },
    chat: {
      complete: vi.fn(async () => ({
        choices: [{ message: { content: '{"kind":"generic"}' }, finishReason: "stop" }],
      })),
    },
  } as unknown as InstanceType<typeof import("@mistralai/mistralai").Mistral>;
}

async function bootClient(
  mistral = mockMistral(),
  cacheDir = mkdtempSync(join(tmpdir(), "mistral-mcp-docs-"))
) {
  process.env.MISTRAL_MCP_CACHE_DIR = cacheDir;
  const server = new McpServer({ name: "docs-test", version: "0.0.0" });
  registerDocsTools(server, mistral);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mistral, cacheDir };
}

describe("process_document — input validation", () => {
  it("accepts URL source with kind=auto and default options", () => {
    const parsed = InputSchema.parse({
      source: { type: "url", url: "https://example.com/invoice.pdf" },
    });
    expect(parsed.kind).toBe("auto");
    expect(parsed.options.maxPages).toBe(50);
    expect(parsed.options.cache).toBe("read_write");
  });

  it("accepts image_base64 source with explicit kind", () => {
    const parsed = InputSchema.parse({
      source: { type: "image_base64", data: "AAAA", mime: "image/png" },
      kind: "id_document",
    });
    expect(parsed.source.type).toBe("image_base64");
    expect(parsed.kind).toBe("id_document");
  });

  it("accepts file_id source", () => {
    const parsed = InputSchema.parse({
      source: { type: "file_id", fileId: "file_abc123" },
      kind: "contract",
    });
    expect(parsed.source.type).toBe("file_id");
  });

  it("rejects invalid mime type for image_base64", () => {
    expect(() =>
      InputSchema.parse({
        source: { type: "image_base64", data: "AAAA", mime: "application/pdf" },
      })
    ).toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() =>
      InputSchema.parse({
        source: { type: "file_id", fileId: "x" },
        kind: "audio_transcript" as unknown as "auto",
      })
    ).toThrow();
  });
});

describe("process_document — registration", () => {
  it("registers exactly one tool named process_document", async () => {
    const { client, cacheDir } = await bootClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["process_document"]);
      const t = tools[0];
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.idempotentHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("process_document — generic kind happy path", () => {
  it("returns a valid generic payload with cache_hit=false on first call", async () => {
    const mistral = mockMistral("Hello world. This is a generic doc.");
    const { client, cacheDir } = await bootClient(mistral);
    try {
      const res = await client.callTool({
        name: "process_document",
        arguments: {
          source: { type: "url", url: "https://example.com/doc.pdf" },
          kind: "generic",
          options: { cache: "bypass" },
        },
      });
      expect(res.isError).toBeFalsy();
      const sc = res.structuredContent as Record<string, unknown>;
      expect(sc.kind).toBe("generic");
      expect(sc.cache_hit).toBe(false);
      expect(sc.pipeline_version).toBe("v0.8.0");
      expect(typeof sc.ocr_text).toBe("string");
      expect(sc.page_count).toBe(1);
      // discriminated union validation
      const validated = ProcessDocumentOutputSchema.safeParse(sc);
      expect(validated.success).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("returns cache_hit=true on second call with same source", async () => {
    const mistral = mockMistral();
    const { client, cacheDir } = await bootClient(mistral);
    try {
      const args = {
        source: { type: "url", url: "https://example.com/cached.pdf" },
        kind: "generic" as const,
      };
      const r1 = await client.callTool({ name: "process_document", arguments: args });
      expect((r1.structuredContent as Record<string, unknown>).cache_hit).toBe(false);
      const r2 = await client.callTool({ name: "process_document", arguments: args });
      expect((r2.structuredContent as Record<string, unknown>).cache_hit).toBe(true);
      // SDK called only once across the two invocations
      expect((mistral.ocr.process as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("rejects with low OCR confidence", async () => {
    const m = {
      ocr: {
        process: vi.fn(async () => ({
          pages: [
            {
              index: 0,
              markdown: "garbled text",
              confidenceScores: { averagePageConfidenceScore: 0.1, minimumPageConfidenceScore: 0.05 },
            },
          ],
          model: "mistral-ocr-latest",
          pagesCount: 1,
        })),
      },
      chat: { complete: vi.fn() },
    } as unknown as InstanceType<typeof import("@mistralai/mistralai").Mistral>;
    const { client, cacheDir } = await bootClient(m);
    try {
      const res = await client.callTool({
        name: "process_document",
        arguments: {
          source: { type: "file_id", fileId: "low_quality_doc" },
          kind: "generic",
          options: { cache: "bypass" },
        },
      });
      expect(res.isError).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
