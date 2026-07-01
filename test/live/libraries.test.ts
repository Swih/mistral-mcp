/**
 * Live integration tests for Mistral Libraries (RAG) tools.
 *
 * Skipped unless MISTRAL_API_KEY is set in the environment.
 * Covers five tools: libraries_list, libraries_get, libraries_documents_list,
 * libraries_documents_upload, libraries_documents_status.
 *
 * Library creation is out of scope for this tool surface (see tools-libraries.ts),
 * so these tests are tolerant of an account with zero Libraries: only
 * libraries_list and the bogus-id error case always run.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Mistral } from "@mistralai/mistralai";
import { registerLibraryTools } from "../../src/tools-libraries.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

async function bootLibraryServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: { strategy: "backoff", retryConnectionErrors: true },
    timeoutMs: 30_000,
  });
  const server = new McpServer({ name: "test-libraries", version: "0.0.0" });
  registerLibraryTools(server, mistral);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return { client };
}

describe.skipIf(!HAS_KEY)("live Mistral Libraries", () => {
  let client: Client;
  let firstLibraryId: string | null = null;
  let uploadedDocumentId: string | null = null;

  beforeAll(async () => {
    ({ client } = await bootLibraryServer());
  });

  it("libraries_list returns a valid (possibly empty) library summary list", async () => {
    const res = await client.callTool({ name: "libraries_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { libraries: Array<{ id: string; name: string }> };
    expect(Array.isArray(sc.libraries)).toBe(true);
    for (const l of sc.libraries) {
      expect(typeof l.id).toBe("string");
      expect(typeof l.name).toBe("string");
    }
    if (sc.libraries.length > 0) {
      firstLibraryId = sc.libraries[0]!.id;
    }
  });

  it("libraries_get fetches a library's metadata", async () => {
    if (!firstLibraryId) {
      console.warn("[skip] No library visible on this account — skipping get test.");
      return;
    }
    const res = await client.callTool({
      name: "libraries_get",
      arguments: { libraryId: firstLibraryId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { library: { id: string } };
    expect(sc.library.id).toBe(firstLibraryId);
  });

  it("libraries_documents_list lists documents in the library", async () => {
    if (!firstLibraryId) {
      console.warn("[skip] No library visible on this account — skipping documents_list test.");
      return;
    }
    const res = await client.callTool({
      name: "libraries_documents_list",
      arguments: { libraryId: firstLibraryId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { documents: Array<{ id: string }> };
    expect(Array.isArray(sc.documents)).toBe(true);
  });

  it("libraries_documents_upload uploads a small text document", async () => {
    if (!firstLibraryId) {
      console.warn("[skip] No library visible on this account — skipping upload test.");
      return;
    }
    const res = await client.callTool({
      name: "libraries_documents_upload",
      arguments: {
        libraryId: firstLibraryId,
        filename: `mistral-mcp-live-test-${Date.now()}.txt`,
        content_base64: Buffer.from("mistral-mcp live test document").toString("base64"),
      },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { document: { id: string; process_status: string } };
    expect(typeof sc.document.id).toBe("string");
    uploadedDocumentId = sc.document.id;
  });

  it("libraries_documents_status reports the uploaded document's status", async () => {
    if (!firstLibraryId || !uploadedDocumentId) {
      console.warn("[skip] No uploaded document — skipping status test.");
      return;
    }
    const res = await client.callTool({
      name: "libraries_documents_status",
      arguments: { libraryId: firstLibraryId, documentId: uploadedDocumentId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { document_id: string; process_status: string };
    expect(sc.document_id).toBe(uploadedDocumentId);
    expect(typeof sc.process_status).toBe("string");
  });

  it("libraries_get with a bogus id returns isError:true (not a crash)", async () => {
    const res = await client.callTool({
      name: "libraries_get",
      arguments: { libraryId: "non-existent-library-00000000" },
    });
    expect(res.isError).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
  });
});
