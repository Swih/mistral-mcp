import { describe, expect, it, vi } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { registerDocsTools, ProcessDocumentOutputSchema, ProcessDocumentOutputShape } from "../../src/tools-docs.js";

const payloads = {
  invoice: { vendor: { name: "Synthetic Vendor" }, total: 120, currency: "EUR",
    line_items: [{ desc: "Service", qty: 1, unit_price: 100, amount: 100 }], due_date: null, anomalies: [] },
  contract: { parties: [{ name: "Synthetic Party" }], clauses: [{ heading: "Term", text: "One year" }],
    risk_score: null, key_dates: [], summary: null },
  id_document: { document_type: "id_card", name: "Synthetic Person", dob: null, expiry: null, country: "FR" },
  generic: {},
};

async function withDocument(
  kind: keyof typeof payloads,
  run: (client: Client, mock: Mistral) => Promise<void>,
  text = "Synthetic document",
  extraction: unknown = payloads[kind],
) {
  const mock = {
    ocr: { process: vi.fn(async () => ({ pages: [{ index: 0, markdown: text,
      confidenceScores: { averagePageConfidenceScore: 0.9 } }] })) },
    chat: { complete: vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(extraction) } }] })) },
  } as unknown as Mistral;
  const server = new McpServer({ name: "document-contract", version: "1" });
  registerDocsTools(server, mock);
  const client = new Client({ name: "document-contract", version: "1" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try { await run(client, mock); } finally { await client.close(); }
}

function args(kind: keyof typeof payloads) {
  return { source: { type: "file_id", fileId: "synthetic-file" }, kind, options: { cache: "bypass" } };
}

describe("process_document advertised and runtime contracts", () => {
  it.each(["invoice", "contract", "id_document", "generic"] as const)("validates %s over MCP", async kind => {
    await withDocument(kind, async client => {
      // Client.callTool validates the returned payload against the advertised JSON Schema.
      const result = await client.callTool({ name: "process_document", arguments: args(kind) });
      expect(result.isError).toBeFalsy();
      expect(ProcessDocumentOutputSchema.safeParse(result.structuredContent).success).toBe(true);
      expect(z.object(ProcessDocumentOutputShape).safeParse(result.structuredContent).success).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }]);
    });
  });

  it("advertises nested invoice types instead of unknown JSON", async () => {
    await withDocument("invoice", async client => {
      const tool = (await client.listTools()).tools[0];
      const props = tool.outputSchema?.properties as Record<string, { type?: string; items?: { type?: string } }>;
      expect(props.vendor.type).toBe("object");
      expect(props.line_items.items?.type).toBe("object");
      expect(z.object(ProcessDocumentOutputShape).safeParse({
        kind: "invoice", source_id: "x", extraction_source: "mistral_ocr", ocr_text: "x", ocr_confidence: 0.9,
        page_count: 1, total_duration_ms: 1, cache_hit: false, pipeline_version: "test",
        vendor: "not-an-object",
      }).success).toBe(false);
    });
  });

  it("does not silently extract from a truncated document", async () => {
    await withDocument("invoice", async (client, mock) => {
      const result = await client.callTool({ name: "process_document", arguments: args("invoice") });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("60000-character");
      expect(mock.chat.complete).not.toHaveBeenCalled();
    }, "x".repeat(60_001));
  });

  it("applies the documented language hints to extraction", async () => {
    await withDocument("invoice", async (client, mock) => {
      const result = await client.callTool({ name: "process_document", arguments: {
        ...args("invoice"), options: { cache: "bypass", languageHints: ["fr"] },
      } });
      expect(result.isError).toBeFalsy();
      expect(mock.chat.complete).toHaveBeenCalledWith(expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({
          role: "system", content: expect.stringContaining("Document language hints: fr"),
        })]),
      }));
    });
  });

  it("does not allow generated fields to overwrite OCR provenance", async () => {
    await withDocument("invoice", async client => {
      const result = await client.callTool({ name: "process_document", arguments: args("invoice") });
      expect(result.isError).toBeFalsy();
      const payload = ProcessDocumentOutputSchema.parse(result.structuredContent);
      expect(payload.ocr_confidence).toBe(0.9);
      expect(payload.extraction_source).toBe("mistral_ocr");
      expect(payload.page_count).toBe(1);
      expect(payload.kind).toBe("invoice");
    }, "Invoice", { ...payloads.invoice, extraction_source: "provided_text", ocr_confidence: 1, page_count: 999, kind: "generic" });
  });

  it.each(["invoice", "contract", "id_document", "generic"] as const)("validates %s from provided Markdown without OCR", async kind => {
    await withDocument(kind, async (client, mock) => {
      const result = await client.callTool({ name: "process_document", arguments: {
        ...args(kind), source: { type: "text", text: "# Synthetic document\n\nSome text.\n" },
      } });
      expect(result.isError).toBeFalsy();
      const payload = ProcessDocumentOutputSchema.parse(result.structuredContent);
      expect(payload).toMatchObject({ extraction_source: "provided_text", ocr_confidence: null, page_count: null });
      expect(z.object(ProcessDocumentOutputShape).safeParse(payload).success).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }]);
      expect(mock.ocr.process).not.toHaveBeenCalled();
      expect(mock.chat.complete).toHaveBeenCalledTimes(kind === "generic" ? 0 : 1);
    });
  });

  it("does not allow generated fields to invent OCR evidence for provided text", async () => {
    await withDocument("invoice", async client => {
      const result = await client.callTool({ name: "process_document", arguments: {
        ...args("invoice"), source: { type: "text", text: "Synthetic invoice" },
      } });
      const payload = ProcessDocumentOutputSchema.parse(result.structuredContent);
      expect(payload).toMatchObject({ extraction_source: "provided_text", ocr_confidence: null, page_count: null, ocr_text: "Synthetic invoice" });
    }, "unused", { ...payloads.invoice, extraction_source: "mistral_ocr", ocr_confidence: 1, page_count: 999, ocr_text: "fabricated" });
  });

  it("returns a tool error for malformed typed extraction", async () => {
    await withDocument("invoice", async client => {
      const result = await client.callTool({ name: "process_document", arguments: args("invoice") });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }, "Invoice", { vendor: { name: "Synthetic" }, total: "not a number" });
  });
});
