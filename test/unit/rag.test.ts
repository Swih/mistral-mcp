/**
 * Unit tests for v0.10 search-index deployment discovery with a mocked client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerRagTools } from "../../src/tools-rag.js";

const SAMPLE_DEPLOYMENT = {
  id: "dep-1",
  name: "Ops corpus",
  creatorId: "user-1",
  documentCount: 128,
  status: "ready",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  modifiedAt: new Date("2026-08-20T00:00:00Z"),
  deployment: {
    type: "vespa",
    indexes: [
      { id: "idx-1", name: "primary", documentCount: 128 },
      { id: "idx-2", name: "archive", documentCount: null },
    ],
  },
};

function makeMock(
  getDeploymentSummaries: unknown = vi.fn(async () => ({
    deployments: [SAMPLE_DEPLOYMENT],
  }))
): Mistral {
  return {
    beta: { rag: { searchIndexes: { getDeploymentSummaries } } },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "rag-test", version: "0.0.0" });
  registerRagTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("rag_indexes_list", () => {
  it("registers with read-only annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "rag_indexes_list");
    expect(tool).toBeTruthy();
    expect(tool?.outputSchema).toBeTruthy();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.annotations?.destructiveHint).toBe(false);
    expect(tool?.annotations?.idempotentHint).toBe(true);
  });

  it("maps deployments, nested indexes, and ISO dates", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "rag_indexes_list",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      count: number;
      deployments: Array<{
        id: string;
        name: string;
        status?: string;
        created_at?: string;
        backend?: string;
        indexes?: Array<{ id: string; document_count?: number | null }>;
      }>;
    };
    expect(sc.count).toBe(1);
    const d = sc.deployments[0]!;
    expect(d).toMatchObject({
      id: "dep-1",
      name: "Ops corpus",
      status: "ready",
      backend: "vespa",
      document_count: 128,
    });
    // Dates arrive as Date from the SDK and must not leak as {} through JSON-RPC.
    expect(d.created_at).toBe("2026-08-01T00:00:00.000Z");
    expect(d.indexes).toHaveLength(2);
    // A backend that has not reported a count yet stays null, not 0.
    expect(d.indexes?.[1]?.document_count).toBeNull();
  });

  it("treats an account with no deployment as a valid empty answer", async () => {
    const { client } = await boot(makeMock(vi.fn(async () => ({ deployments: [] }))));
    const result = await client.callTool({
      name: "rag_indexes_list",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { count: number };
    expect(sc.count).toBe(0);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/No search-index deployment/i);
  });

  it("returns isError instead of throwing when the API fails", async () => {
    const { client } = await boot(
      makeMock(
        vi.fn(async () => {
          throw new Error("403 forbidden");
        })
      )
    );
    const result = await client.callTool({
      name: "rag_indexes_list",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("tolerates a deployment with no nested backend block", async () => {
    const { client } = await boot(
      makeMock(
        vi.fn(async () => ({
          deployments: [{ ...SAMPLE_DEPLOYMENT, deployment: undefined }],
        }))
      )
    );
    const result = await client.callTool({
      name: "rag_indexes_list",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      deployments: Array<{ backend?: string; indexes?: unknown[] }>;
    };
    expect(sc.deployments[0]?.backend).toBeUndefined();
    expect(sc.deployments[0]?.indexes).toBeUndefined();
  });
});
