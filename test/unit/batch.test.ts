/**
 * Unit tests for v0.4 Batch API tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerBatchTools } from "../../src/tools-batch.js";

function makeJob(id = "batch_1", overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: "batch" as const,
    inputFiles: ["file_in"],
    metadata: null,
    endpoint: "/v1/chat/completions",
    model: "mistral-small-latest",
    agentId: null,
    outputFile: null,
    errorFile: null,
    errors: [],
    status: "QUEUED",
    createdAt: 1_700_000_000,
    totalRequests: 100,
    completedRequests: 0,
    succeededRequests: 0,
    failedRequests: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeMock(): Mistral {
  return {
    batch: {
      jobs: {
        create: vi.fn(async () => makeJob()),
        get: vi.fn(async () =>
          makeJob("batch_1", {
            status: "RUNNING",
            completedRequests: 42,
            succeededRequests: 40,
            failedRequests: 2,
            startedAt: 1_700_000_500,
          })
        ),
        list: vi.fn(async () => ({
          data: [makeJob("b1"), makeJob("b2", { status: "SUCCESS" })],
          object: "list" as const,
          total: 2,
        })),
        cancel: vi.fn(async () =>
          makeJob("batch_1", { status: "CANCELLATION_REQUESTED" })
        ),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "batch-test", version: "0.0.0" });
  registerBatchTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (batch)", () => {
  it("exposes 4 batch tools with annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["batch_cancel", "batch_create", "batch_get", "batch_list"]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint).toBe("boolean");
    }
  });

  it("flags batch_cancel as destructive and batch_get as readOnly", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const cancel = tools.find((t) => t.name === "batch_cancel");
    const get = tools.find((t) => t.name === "batch_get");
    expect(cancel?.annotations?.destructiveHint).toBe(true);
    expect(get?.annotations?.readOnlyHint).toBe(true);
  });
});

describe("batch_create", () => {
  it("forwards input_files + endpoint and normalizes response", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "batch_create",
      arguments: {
        input_files: ["file_in"],
        endpoint: "/v1/chat/completions",
        model: "mistral-small-latest",
        metadata: { run: "nightly" },
        timeout_hours: 24,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      status: string;
      input_files: string[];
      endpoint: string;
      total_requests: number;
    };
    expect(sc.id).toBe("batch_1");
    expect(sc.status).toBe("QUEUED");
    expect(sc.input_files).toEqual(["file_in"]);
    expect(sc.endpoint).toBe("/v1/chat/completions");

    const arg = (mock.batch.jobs.create as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.inputFiles).toEqual(["file_in"]);
    expect(arg?.endpoint).toBe("/v1/chat/completions");
    expect(arg?.timeoutHours).toBe(24);
    expect(arg?.metadata).toEqual({ run: "nightly" });
  });

  it("rejects an invalid endpoint", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "batch_create",
      arguments: {
        input_files: ["file_in"],
        endpoint: "/v1/nope",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects an empty input_files array", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "batch_create",
      arguments: {
        input_files: [],
        endpoint: "/v1/chat/completions",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (mock.batch.jobs.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("quota_exceeded")
    );
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "batch_create",
      arguments: {
        input_files: ["file_in"],
        endpoint: "/v1/chat/completions",
      },
    });
    expect(result.isError).toBe(true);
  });
});

describe("batch_get", () => {
  it("returns progress and status", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "batch_get",
      arguments: { jobId: "batch_1" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      status: string;
      completed_requests: number;
      total_requests: number;
    };
    expect(sc.status).toBe("RUNNING");
    expect(sc.completed_requests).toBe(42);
    expect(sc.total_requests).toBe(100);

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("42/100");
    expect(text).toContain("42%");

    const arg = (mock.batch.jobs.get as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.jobId).toBe("batch_1");
  });
});

describe("batch_list", () => {
  it("forwards filters and normalizes dates", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "batch_list",
      arguments: {
        page: 0,
        page_size: 10,
        status: ["RUNNING", "SUCCESS"],
        created_after: "2026-01-01T00:00:00Z",
        created_by_me: true,
        order_by: "-created",
      },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      data: Array<{ id: string }>;
      total: number;
      count: number;
    };
    expect(sc.count).toBe(2);
    expect(sc.total).toBe(2);
    expect(sc.data[0]?.id).toBe("b1");

    const arg = (mock.batch.jobs.list as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.status).toEqual(["RUNNING", "SUCCESS"]);
    expect(arg?.orderBy).toBe("-created");
    expect(arg?.createdAfter).toBeInstanceOf(Date);
    expect(arg?.createdByMe).toBe(true);
  });

  it("rejects an invalid status enum", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "batch_list",
      arguments: { status: ["RUNNING", "NOT_A_STATUS"] },
    });
    expect(result.isError).toBe(true);
  });
});

describe("batch_cancel", () => {
  it("returns the job with CANCELLATION_REQUESTED", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "batch_cancel",
      arguments: { jobId: "batch_1" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { status: string };
    expect(sc.status).toBe("CANCELLATION_REQUESTED");
  });

  it("rejects missing jobId", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "batch_cancel",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});
