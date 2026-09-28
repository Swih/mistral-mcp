/** One real chat extraction, independent of Files access and OCR quotas. */
import { describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";
import { ProcessDocumentOutputSchema, registerDocsTools } from "../../src/tools-docs.js";

loadEnv({ quiet: true });

describe.skipIf(!process.env.MISTRAL_API_KEY)("live process_document — provided text", () => {
  it("extracts known invoice fields from Markdown without requiring OCR", async () => {
    const mistral = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY,
      retryConfig: MISTRAL_RETRY_CONFIG,
      timeoutMs: MISTRAL_TIMEOUT_MS,
    });
    const server = new McpServer({ name: "live-text", version: "1" });
    registerDocsTools(server, mistral);
    const client = new Client({ name: "live-text", version: "1" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const text = readFileSync(resolve("test/fixtures/invoice-text.md"), "utf8");
      const result = await client.callTool({ name: "process_document", arguments: {
        source: { type: "text", text }, kind: "invoice", options: { cache: "bypass", languageHints: ["fr"] },
      } }, { timeout: 90_000 });
      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      const payload = ProcessDocumentOutputSchema.parse(result.structuredContent);
      expect(payload).toMatchObject({
        kind: "invoice", extraction_source: "provided_text", ocr_text: text,
        ocr_confidence: null, page_count: null, cache_hit: false,
        vendor: { name: "ACME SAS" }, total: 12960, currency: "EUR", due_date: "2026-09-11",
        line_items: [
          { qty: 12, unit_price: 650, amount: 7800 },
          { qty: 1, unit_price: 1200, amount: 1200 },
          { qty: 2, unit_price: 900, amount: 1800 },
        ],
      });
    } finally { await client.close(); }
  }, 90_000);
});
