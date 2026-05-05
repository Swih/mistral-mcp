/**
 * Live e2e tests for `process_document` against synthetic but realistic PDFs.
 *
 * Skipped unless MISTRAL_API_KEY is set. Generates fixtures with
 * `python test/fixtures/generate-pdfs.py` (or use the committed PDFs).
 *
 * Each test uploads a PDF via Files API → calls process_document → asserts
 * structured output shape and basic field correctness. Uses kind=auto so we
 * also exercise the classifier.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Mistral } from "@mistralai/mistralai";
import { registerDocsTools } from "../../src/tools-docs.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);
const FIXTURES = resolve(process.cwd(), "test/fixtures");
const HAS_FIXTURES = existsSync(resolve(FIXTURES, "contract.pdf"));

async function bootDocsServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: { strategy: "backoff", retryConnectionErrors: true },
    timeoutMs: 60_000,
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
  const buf = readFileSync(resolve(FIXTURES, file));
  const res = await mistral.files.upload({
    file: { fileName: file, content: buf },
    purpose: "ocr",
  });
  return res.id;
}

describe.skipIf(!HAS_KEY || !HAS_FIXTURES)("live process_document — synthetic PDFs", () => {
  let client: Client;
  let mistral: Mistral;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ client, mistral } = await bootDocsServer());
    for (const f of ["contract.pdf", "invoice.pdf", "id_card.pdf", "meeting_notes.pdf"]) {
      ids[f] = await uploadFixture(mistral, f);
    }
  }, 60_000);

  it("classifies and extracts a contract", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["contract.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("contract");
    expect(Array.isArray(sc.parties)).toBe(true);
    expect((sc.parties as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(sc.clauses)).toBe(true);
    expect((sc.clauses as unknown[]).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it("classifies and extracts an invoice", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["invoice.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("invoice");
    const vendor = sc.vendor as Record<string, unknown>;
    expect(typeof vendor.name).toBe("string");
    expect(Array.isArray(sc.line_items)).toBe(true);
    expect((sc.line_items as unknown[]).length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("classifies and extracts an id_document, auto-bypasses cache", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["id_card.pdf"] },
        kind: "auto",
        // no cache option → must auto-bypass for id_document
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("id_document");
    expect(typeof sc.name).toBe("string");
    expect(["passport", "id_card", "driver_license", "other"]).toContain(sc.document_type);
    expect(sc.cache_hit).toBe(false);
  }, 60_000);

  it("classifies a generic document and returns structured_text", async () => {
    const res = await client.callTool({
      name: "process_document",
      arguments: {
        source: { type: "file_id", fileId: ids["meeting_notes.pdf"] },
        kind: "auto",
        options: { cache: "bypass" },
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.kind).toBe("generic");
    expect(typeof sc.structured_text).toBe("string");
    expect((sc.structured_text as string).length).toBeGreaterThan(100);
  }, 60_000);
});
