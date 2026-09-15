/**
 * Live e2e tests for `process_document` against the synthetic corpus.
 *
 * Skipped unless MISTRAL_API_KEY is set. Regenerate the corpus with
 * `npm run fixtures:generate`; its ground truth lives in
 * `test/fixtures/corpus.json` and is checked against the bytes on disk by
 * `test/unit/eval-docs.test.ts` (no key needed).
 *
 * These tests assert the *shape* of each kind's extraction. For the wider
 * question — does every document in the corpus survive OCR, and what
 * `minOcrConfidence` is defensible — run `npm run eval:docs`, which scores the
 * whole corpus and prints the evidence behind the threshold.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";
import { registerDocsTools } from "../../src/tools-docs.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);
const FIXTURES = resolve(process.cwd(), "test/fixtures");
const CORPUS = resolve(FIXTURES, "corpus");
const HAS_CORPUS = existsSync(resolve(CORPUS, "contract-fr.pdf"));

async function bootDocsServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: MISTRAL_RETRY_CONFIG,
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });
  const server = new McpServer({ name: "test-docs", version: "0.0.0" });
  registerDocsTools(server, mistral);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(ct);
  return { client, mistral };
}

async function uploadFixture(mistral: Mistral, file: string): Promise<string> {
  const buf = readFileSync(resolve(CORPUS, file));
  const res = await mistral.files.upload({
    file: { fileName: file, content: buf },
    purpose: "ocr",
  });
  return res.id;
}

const USED = [
  "contract-fr.pdf",
  "invoice-fr-table.pdf",
  "id-card-synthetic.pdf",
  "meeting-notes-mixed.pdf",
  "report-landscape-rotated.pdf",
  "multipage-blank-inside.pdf",
];

describe.skipIf(!HAS_KEY || !HAS_CORPUS)("live process_document — synthetic corpus", () => {
  let client: Client;
  let mistral: Mistral;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ client, mistral } = await bootDocsServer());
    for (const f of USED) ids[f] = await uploadFixture(mistral, f);
  }, 90_000);

  it("classifies and extracts a contract", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["contract-fr.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("contract");
    expect(Array.isArray(sc.parties)).toBe(true);
    expect((sc.parties as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(sc.clauses)).toBe(true);
    expect((sc.clauses as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(sc.page_count).toBe(2);
  }, 90_000);

  it("classifies and extracts an invoice from a ruled table", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["invoice-fr-table.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("invoice");
    const vendor = sc.vendor as Record<string, unknown>;
    expect(typeof vendor.name).toBe("string");
    expect(Array.isArray(sc.line_items)).toBe(true);
    // The fixture has three line items; fewer means the table collapsed.
    expect((sc.line_items as unknown[]).length).toBeGreaterThanOrEqual(3);
  }, 90_000);

  it("classifies and extracts an id_document, auto-bypasses cache", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["id-card-synthetic.pdf"] },
        kind: "auto",
        // no cache option → must auto-bypass for id_document
      },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("id_document");
    expect(typeof sc.name).toBe("string");
    expect(["passport", "id_card", "driver_license", "other"]).toContain(sc.document_type);
    expect(sc.cache_hit).toBe(false);
  }, 90_000);

  it("classifies a generic document and returns structured_text", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["meeting-notes-mixed.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("generic");
    expect(typeof sc.structured_text).toBe("string");
    expect((sc.structured_text as string).length).toBeGreaterThan(100);
  }, 90_000);

  it("reads a rotated landscape page instead of returning noise", async () => {
    // /Rotate 90 is what a sheet feeder produces from an A4 fed sideways. A
    // pipeline that ignores it still returns text, so assert on content.
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["report-landscape-rotated.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.page_count).toBe(2);
    expect(sc.ocr_text as string).toContain("CMA-3391");
  }, 90_000);

  it("keeps page indexing correct across a blank page", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["multipage-blank-inside.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    // Four pages, the third of which is empty — a pipeline that drops empty
    // pages silently shifts every reference after it.
    expect(sc.page_count).toBe(4);
    const text = sc.ocr_text as string;
    expect(text).toContain("DT-2026-0091");
    expect(text).toContain("RG-2026");
  }, 90_000);
});
