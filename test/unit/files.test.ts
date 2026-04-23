/**
 * Unit tests for v0.4 Files API tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerFileTools } from "../../src/tools-files.js";

function makeFile(id = "file_abc", extras: Record<string, unknown> = {}) {
  return {
    id,
    object: "file",
    sizeBytes: 12,
    createdAt: 1_700_000_000,
    filename: "hello.txt",
    purpose: "batch",
    sampleType: "batch_request",
    numLines: 3,
    mimetype: "text/plain",
    source: "upload",
    signature: null,
    expiresAt: null,
    visibility: "user",
    ...extras,
  };
}

function makeMock(): Mistral {
  return {
    files: {
      upload: vi.fn(async () => makeFile()),
      list: vi.fn(async () => ({
        data: [makeFile("file_1"), makeFile("file_2", { filename: "b.txt" })],
        object: "list",
        total: 2,
      })),
      retrieve: vi.fn(async () => ({ ...makeFile(), deleted: false })),
      delete: vi.fn(async () => ({
        id: "file_abc",
        object: "file",
        deleted: true,
      })),
      getSignedUrl: vi.fn(async () => ({
        url: "https://signed.example.com/file_abc?sig=xxx",
      })),
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "files-test", version: "0.0.0" });
  registerFileTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (files)", () => {
  it("exposes 5 files tools with annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "files_delete",
      "files_get",
      "files_list",
      "files_signed_url",
      "files_upload",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations).toBeTruthy();
      expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint).toBe("boolean");
    }
  });

  it("flags files_delete as destructive and files_upload as non-readOnly", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const del = tools.find((t) => t.name === "files_delete");
    const up = tools.find((t) => t.name === "files_upload");
    expect(del?.annotations?.destructiveHint).toBe(true);
    expect(up?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("files_upload", () => {
  it("decodes base64 and forwards purpose/visibility", async () => {
    const { client, mock } = await boot();
    // "Hello World!" = SGVsbG8gV29ybGQh
    const result = await client.callTool({
      name: "files_upload",
      arguments: {
        filename: "hello.txt",
        content_base64: "SGVsbG8gV29ybGQh",
        purpose: "batch",
        visibility: "user",
        expiry_days: 30,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      filename: string;
      size_bytes: number;
      sample_type: string;
    };
    expect(sc.id).toBe("file_abc");
    expect(sc.filename).toBe("hello.txt");
    expect(sc.sample_type).toBe("batch_request");

    const arg = (mock.files.upload as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.file?.fileName).toBe("hello.txt");
    expect(arg?.file?.content).toBeInstanceOf(Uint8Array);
    expect(arg?.purpose).toBe("batch");
    expect(arg?.visibility).toBe("user");
    expect(arg?.expiry).toBe(30);
    // Decoded bytes must match "Hello World!"
    const decoded = Buffer.from(arg?.file?.content as Uint8Array).toString();
    expect(decoded).toBe("Hello World!");
  });

  it("strips a data: URI prefix before decoding", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "files_upload",
      arguments: {
        filename: "hello.txt",
        content_base64: "data:text/plain;base64,SGVsbG8gV29ybGQh",
      },
    });
    const arg = (mock.files.upload as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const decoded = Buffer.from(arg?.file?.content as Uint8Array).toString();
    expect(decoded).toBe("Hello World!");
  });

  it("rejects a missing filename", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "files_upload",
      arguments: { content_base64: "aGk=" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects an invalid purpose enum", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "files_upload",
      arguments: {
        filename: "x.jsonl",
        content_base64: "aGk=",
        purpose: "not-a-purpose",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.files.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("file_too_large")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "files_upload",
      arguments: { filename: "big.pdf", content_base64: "aGk=" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("file_too_large");
  });
});

describe("files_list", () => {
  it("forwards pagination + filters and returns normalized entries", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "files_list",
      arguments: {
        page: 0,
        page_size: 50,
        purpose: "batch",
        search: "contract",
        include_total: true,
      },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      data: Array<{ id: string; filename: string }>;
      count: number;
      total?: number;
    };
    expect(sc.count).toBe(2);
    expect(sc.total).toBe(2);
    expect(sc.data[0]?.id).toBe("file_1");

    const arg = (mock.files.list as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.page).toBe(0);
    expect(arg?.pageSize).toBe(50);
    expect(arg?.purpose).toBe("batch");
    expect(arg?.search).toBe("contract");
    expect(arg?.includeTotal).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.files.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("unauthorized")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({ name: "files_list", arguments: {} });
    expect(result.isError).toBe(true);
  });
});

describe("files_get", () => {
  it("retrieves a file and surfaces `deleted`", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "files_get",
      arguments: { fileId: "file_abc" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { id: string; deleted: boolean };
    expect(sc.id).toBe("file_abc");
    expect(sc.deleted).toBe(false);
    const arg = (mock.files.retrieve as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.fileId).toBe("file_abc");
  });

  it("rejects missing fileId", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "files_get",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});

describe("files_delete", () => {
  it("deletes and returns { deleted: true }", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "files_delete",
      arguments: { fileId: "file_abc" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { deleted: boolean; id: string };
    expect(sc.deleted).toBe(true);
    expect(sc.id).toBe("file_abc");
  });
});

describe("files_signed_url", () => {
  it("defaults expiry to 24h and forwards file_id", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "files_signed_url",
      arguments: { fileId: "file_abc" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      url: string;
      file_id: string;
      expiry_hours: number;
    };
    expect(sc.url).toContain("signed.example.com");
    expect(sc.expiry_hours).toBe(24);
    const arg = (mock.files.getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.fileId).toBe("file_abc");
    expect(arg?.expiry).toBe(24);
  });

  it("respects a custom expiry", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "files_signed_url",
      arguments: { fileId: "file_abc", expiry_hours: 72 },
    });
    const arg = (mock.files.getSignedUrl as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.expiry).toBe(72);
  });

  it("rejects an expiry out of [1, 168]", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "files_signed_url",
      arguments: { fileId: "file_abc", expiry_hours: 200 },
    });
    expect(result.isError).toBe(true);
  });
});
