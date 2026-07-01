/**
 * Unit tests for v0.9 Mistral Libraries (RAG) tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerLibraryTools } from "../../src/tools-libraries.js";

const SAMPLE_LIBRARY = {
  id: "lib-1",
  name: "Product docs",
  description: "Internal product documentation.",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  ownerId: "user-1",
  ownerType: "user",
  totalSize: 12_345,
  nbDocuments: 3,
};

const SAMPLE_PAGINATION = {
  totalItems: 1,
  totalPages: 1,
  currentPage: 0,
  pageSize: 100,
  hasMore: false,
};

const SAMPLE_DOCUMENT = {
  id: "doc-1",
  libraryId: "lib-1",
  name: "handbook.pdf",
  mimeType: "application/pdf",
  extension: "pdf",
  size: 4096,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  processStatus: "done",
};

function makeMock(overrides: Partial<Record<string, unknown>> = {}): Mistral {
  return {
    beta: {
      libraries: {
        list: vi.fn(async () => ({ data: [SAMPLE_LIBRARY], pagination: SAMPLE_PAGINATION })),
        get: vi.fn(async () => SAMPLE_LIBRARY),
        documents: {
          list: vi.fn(async () => ({ data: [SAMPLE_DOCUMENT], pagination: SAMPLE_PAGINATION })),
          upload: vi.fn(async () => SAMPLE_DOCUMENT),
          status: vi.fn(async () => ({ documentId: "doc-1", processStatus: "in_progress" })),
          ...((overrides.documents as Record<string, unknown>) ?? {}),
        },
        ...((overrides.libraries as Record<string, unknown>) ?? {}),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "libraries-test", version: "0.0.0" });
  registerLibraryTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (libraries)", () => {
  it("exposes all five library tools with outputSchema + openWorldHint", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "libraries_documents_list",
      "libraries_documents_status",
      "libraries_documents_upload",
      "libraries_get",
      "libraries_list",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });
});

describe("libraries_list", () => {
  it("forwards filters and maps libraries + pagination", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "libraries_list",
      arguments: { page: 1, pageSize: 20, search: "docs" },
    });

    const beta = (mock as unknown as { beta: { libraries: { list: ReturnType<typeof vi.fn> } } }).beta;
    expect(beta.libraries.list.mock.calls[0]?.[0]).toMatchObject({ page: 1, pageSize: 20, search: "docs" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      libraries: Array<{ id: string; name: string; nb_documents: number }>;
      pagination: { total_items: number };
    };
    expect(sc.libraries).toHaveLength(1);
    expect(sc.libraries[0]).toMatchObject({ id: "lib-1", name: "Product docs", nb_documents: 3 });
    expect(sc.pagination.total_items).toBe(1);
  });
});

describe("libraries_get", () => {
  it("maps the library", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "libraries_get",
      arguments: { libraryId: "lib-1" },
    });
    const beta = (mock as unknown as { beta: { libraries: { get: ReturnType<typeof vi.fn> } } }).beta;
    expect(beta.libraries.get.mock.calls[0]?.[0]).toEqual({ libraryId: "lib-1" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { library: { id: string; owner_type: string } };
    expect(sc.library.id).toBe("lib-1");
    expect(sc.library.owner_type).toBe("user");
  });
});

describe("libraries_documents_list", () => {
  it("forwards libraryId and maps documents", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "libraries_documents_list",
      arguments: { libraryId: "lib-1" },
    });
    const beta = (mock as unknown as { beta: { libraries: { documents: { list: ReturnType<typeof vi.fn> } } } }).beta;
    expect(beta.libraries.documents.list.mock.calls[0]?.[0]).toMatchObject({ libraryId: "lib-1" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { documents: Array<{ id: string; process_status: string }> };
    expect(sc.documents).toHaveLength(1);
    expect(sc.documents[0]).toMatchObject({ id: "doc-1", process_status: "done" });
  });
});

describe("libraries_documents_upload", () => {
  it("decodes base64 content and uploads via the SDK", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "libraries_documents_upload",
      arguments: {
        libraryId: "lib-1",
        filename: "handbook.pdf",
        content_base64: Buffer.from("hello").toString("base64"),
      },
    });
    const beta = (mock as unknown as { beta: { libraries: { documents: { upload: ReturnType<typeof vi.fn> } } } }).beta;
    const arg = beta.libraries.documents.upload.mock.calls[0]?.[0];
    expect(arg.libraryId).toBe("lib-1");
    expect(arg.requestBody.file.fileName).toBe("handbook.pdf");
    expect(Buffer.from(arg.requestBody.file.content).toString()).toBe("hello");

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { document: { id: string; name: string } };
    expect(sc.document.id).toBe("doc-1");
    expect(sc.document.name).toBe("handbook.pdf");
  });
});

describe("libraries_documents_status", () => {
  it("forwards libraryId/documentId and maps status", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "libraries_documents_status",
      arguments: { libraryId: "lib-1", documentId: "doc-1" },
    });
    const beta = (mock as unknown as { beta: { libraries: { documents: { status: ReturnType<typeof vi.fn> } } } }).beta;
    expect(beta.libraries.documents.status.mock.calls[0]?.[0]).toEqual({ libraryId: "lib-1", documentId: "doc-1" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { document_id: string; process_status: string };
    expect(sc.document_id).toBe("doc-1");
    expect(sc.process_status).toBe("in_progress");
  });
});
