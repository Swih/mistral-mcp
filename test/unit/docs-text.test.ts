import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { ProcessDocumentInputShape, ProcessDocumentOutputSchema, registerDocsTools } from "../../src/tools-docs.js";

const Input = z.object(ProcessDocumentInputShape);
const invoice = { vendor: { name: "Synthetic Vendor" }, total: 120, currency: "EUR", line_items: [], due_date: null, anomalies: [] };
const identity = { document_type: "id_card", name: "Synthetic Person", dob: null, expiry: null, country: "FR" };
const text = "  # Facture fictive\n\nTotal : 120 EUR\n";
const base = { source: { type: "text", text }, kind: "invoice" };
let dir: string;
let client: Client;
let priorCache: string | undefined;
let mock: ReturnType<typeof mistralMock>;

function mistralMock() {
  return {
    chat: { complete: vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(invoice) } }] })) },
    ocr: { process: vi.fn(() => { throw new Error("Text ingestion must never call OCR"); }) },
    files: { upload: vi.fn(() => { throw new Error("Text ingestion must never upload a file"); }) },
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mmcp-text-"));
  priorCache = process.env.MISTRAL_MCP_CACHE_DIR;
  process.env.MISTRAL_MCP_CACHE_DIR = dir;
  mock = mistralMock();
  const server = new McpServer({ name: "text-docs", version: "1" });
  registerDocsTools(server, mock as unknown as Mistral);
  client = new Client({ name: "text-docs", version: "1" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
});

afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
  if (priorCache === undefined) delete process.env.MISTRAL_MCP_CACHE_DIR;
  else process.env.MISTRAL_MCP_CACHE_DIR = priorCache;
  expect(mock.ocr.process).not.toHaveBeenCalled();
  expect(mock.files.upload).not.toHaveBeenCalled();
});

function call(args: Record<string, unknown> = base) {
  return client.callTool({ name: "process_document", arguments: args });
}

describe("provided text ingestion", () => {
  it("preserves Markdown and whitespace and uses exactly one chat extraction", async () => {
    const result = await call({ ...base, options: { cache: "bypass", minOcrConfidence: 1, maxPages: 1 } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      kind: "invoice", extraction_source: "provided_text", ocr_confidence: null,
      page_count: null, ocr_text: text, vendor: invoice.vendor,
    });
    expect(mock.chat.complete).toHaveBeenCalledTimes(1);
    expect(mock.chat.complete).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([{ role: "user", content: text }]),
    }));
  });

  it("returns generic text without any provider requests", async () => {
    const result = await call({ ...base, kind: "generic", options: { cache: "bypass" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ structured_text: text, extraction_source: "provided_text" });
    expect(mock.chat.complete).not.toHaveBeenCalled();
  });

  it("classifies automatically before typed extraction", async () => {
    mock.chat.complete.mockResolvedValueOnce({ choices: [{ message: { content: '{"kind":"invoice"}' } }] });
    const result = await call({ ...base, kind: "auto", options: { cache: "bypass" } });
    expect(result.isError).toBeFalsy();
    expect(ProcessDocumentOutputSchema.parse(result.structuredContent).kind).toBe("invoice");
    expect(mock.chat.complete).toHaveBeenCalledTimes(2);
  });

  it.each(["", " \t\n", "x".repeat(60_001)])("rejects empty or oversized text before calling chat (%#)", async invalid => {
    expect(Input.safeParse({ source: { type: "text", text: invalid } }).success).toBe(false);
    const result = await call({ ...base, source: { type: "text", text: invalid } });
    expect(result.isError).toBe(true);
    expect(mock.chat.complete).not.toHaveBeenCalled();
  });

  it("accepts the full documented text limit without truncation", async () => {
    const full = "é".repeat(60_000);
    const result = await call({ ...base, source: { type: "text", text: full }, options: { cache: "bypass" } });
    expect(result.isError).toBeFalsy();
    expect(ProcessDocumentOutputSchema.parse(result.structuredContent).ocr_text).toBe(full);
  });

  it("reuses text results without applying an OCR confidence floor", async () => {
    await call();
    const result = await call({ ...base, options: { minOcrConfidence: 1, maxPages: 1 } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ cache_hit: true, ocr_confidence: null });
    expect(mock.chat.complete).toHaveBeenCalledTimes(1);
    await call({ ...base, source: { type: "text", text: text + "Updated" } });
    expect(mock.chat.complete).toHaveBeenCalledTimes(2);
  });

  it.each(["invoice", "auto"])("rejects cached invented OCR evidence (%s)", async kind => {
    if (kind === "auto") mock.chat.complete.mockResolvedValueOnce({ choices: [{ message: { content: '{"kind":"invoice"}' } }] });
    await call({ ...base, kind });
    for (const shard of readdirSync(dir)) for (const filename of readdirSync(join(dir, shard))) {
      const path = join(dir, shard, filename);
      const cached = JSON.parse(readFileSync(path, "utf8"));
      cached.payload.ocr_confidence = 1;
      writeFileSync(path, JSON.stringify(cached));
    }
    if (kind === "auto") mock.chat.complete.mockResolvedValueOnce({ choices: [{ message: { content: '{"kind":"invoice"}' } }] });
    const result = await call({ ...base, kind });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ cache_hit: false, ocr_confidence: null });
    expect(mock.chat.complete).toHaveBeenCalledTimes(kind === "auto" ? 4 : 2);
  });

  it.each(["auto", "id_document"])("does not cache identity text by default (%s)", async kind => {
    for (let i = 0; i < 2; i++) {
      if (kind === "auto") mock.chat.complete.mockResolvedValueOnce({ choices: [{ message: { content: '{"kind":"id_document"}' } }] });
      mock.chat.complete.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(identity) } }] });
    }
    for (let i = 0; i < 2; i++) {
      const result = await call({ ...base, kind });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ cache_hit: false, kind: "id_document" });
    }
    expect(readdirSync(dir).flatMap(shard => readdirSync(join(dir, shard)))).toEqual([]);
    expect(mock.chat.complete).toHaveBeenCalledTimes(kind === "auto" ? 4 : 2);
  });

  it("returns a tool error when text extraction fails", async () => {
    mock.chat.complete.mockRejectedValueOnce(new Error("Chat unavailable"));
    const result = await call({ ...base, options: { cache: "bypass" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("rejects missing OCR measurements and fabricated text measurements in output validation", async () => {
    const result = await call({ ...base, kind: "generic", options: { cache: "bypass" } });
    const payload = ProcessDocumentOutputSchema.parse(result.structuredContent);
    for (const fields of [
      { extraction_source: "mistral_ocr" }, { ocr_confidence: 1 }, { page_count: 1 },
    ]) expect(ProcessDocumentOutputSchema.safeParse({ ...payload, ...fields }).success).toBe(false);
  });
});
