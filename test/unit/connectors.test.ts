/**
 * Unit tests for v0.9 Mistral Connectors tools with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerConnectorTools } from "../../src/tools-connectors.js";

const SAMPLE_CONNECTOR = {
  id: "conn-1",
  name: "github",
  title: "GitHub",
  description: "Read and write GitHub issues/PRs.",
  protocol: "mcp",
  visibility: "shared_org",
  active: true,
  mistral: true,
  privateToolExecution: false,
  isAuthenticated: true,
  iconUrl: "https://example.com/github.png",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  modifiedAt: new Date("2026-02-01T00:00:00Z"),
};

function makeMock(overrides: Partial<Record<string, unknown>> = {}): Mistral {
  return {
    beta: {
      connectors: {
        list: vi.fn(async () => ({
          items: [SAMPLE_CONNECTOR],
          pagination: { nextCursor: "cursor-2", pageSize: 100 },
        })),
        get: vi.fn(async () => SAMPLE_CONNECTOR),
        listTools: vi.fn(async () => [
          {
            name: "list_issues",
            description: "List open issues in a repo.",
            inputSchema: {
              type: "object",
              properties: { repo: { type: "string" } },
              required: ["repo"],
            },
          },
        ]),
        callTool: vi.fn(async () => ({
          content: [{ type: "text", text: "3 open issues found." }],
          metadata: { mcpMeta: { isError: false } },
        })),
        ...((overrides.connectors as Record<string, unknown>) ?? {}),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock()) {
  const server = new McpServer({ name: "connectors-test", version: "0.0.0" });
  registerConnectorTools(server, mock);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (connectors)", () => {
  it("exposes all four connectors tools with annotations", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "connectors_call_tool",
      "connectors_get",
      "connectors_list",
      "connectors_list_tools",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });
});

describe("connectors_list", () => {
  it("forwards active/cursor/pageSize and maps connectors + pagination", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "connectors_list",
      arguments: { active: true, cursor: "abc", pageSize: 10 },
    });

    const beta = (mock as unknown as { beta: { connectors: { list: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.connectors.list.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ queryFilters: { active: true }, cursor: "abc", pageSize: 10 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      connectors: Array<{ id: string; name: string; visibility: string }>;
      next_cursor?: string;
    };
    expect(sc.connectors).toHaveLength(1);
    expect(sc.connectors[0]).toMatchObject({ id: "conn-1", name: "github", visibility: "shared_org" });
    expect(sc.next_cursor).toBe("cursor-2");
  });
});

describe("connectors_get", () => {
  it("never forwards fetchUserData/fetchCustomerData and maps the connector", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "connectors_get",
      arguments: { connectorIdOrName: "github" },
    });

    const beta = (mock as unknown as { beta: { connectors: { get: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.connectors.get.mock.calls[0]?.[0];
    expect(arg).toEqual({ connectorIdOrName: "github" });
    expect(arg.fetchUserData).toBeUndefined();
    expect(arg.fetchCustomerData).toBeUndefined();

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { connector: { id: string; is_authenticated?: boolean } };
    expect(sc.connector.id).toBe("conn-1");
    expect(sc.connector.is_authenticated).toBe(true);
  });
});

describe("connectors_list_tools", () => {
  it("requests pretty:true and maps name/description/input_schema", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "connectors_list_tools",
      arguments: { connectorIdOrName: "github", refresh: true },
    });

    const beta = (mock as unknown as { beta: { connectors: { listTools: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.connectors.listTools.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ connectorIdOrName: "github", refresh: true, pretty: true });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
    };
    expect(sc.tools).toHaveLength(1);
    expect(sc.tools[0]?.name).toBe("list_issues");
    expect(sc.tools[0]?.input_schema).toMatchObject({ type: "object" });
  });
});

describe("connectors_call_tool", () => {
  it("forwards arguments and maps text content + mcp_meta", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "connectors_call_tool",
      arguments: {
        connectorIdOrName: "github",
        toolName: "list_issues",
        arguments: { repo: "Swih/mistral-mcp" },
      },
    });

    const beta = (mock as unknown as { beta: { connectors: { callTool: ReturnType<typeof vi.fn> } } }).beta;
    const arg = beta.connectors.callTool.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      toolName: "list_issues",
      connectorIdOrName: "github",
      connectorCallToolRequest: { arguments: { repo: "Swih/mistral-mcp" } },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "3 open issues found." }]);
    const sc = result.structuredContent as {
      is_error: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    expect(sc.is_error).toBe(false);
    expect(sc.content[0]).toMatchObject({ type: "text", text: "3 open issues found." });
  });

  it("surfaces isError from mcp_meta on both content and structuredContent", async () => {
    const mock = makeMock({
      connectors: {
        list: vi.fn(),
        get: vi.fn(),
        listTools: vi.fn(),
        callTool: vi.fn(async () => ({
          content: [{ type: "text", text: "tool not found" }],
          metadata: { mcpMeta: { isError: true } },
        })),
      },
    });
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "connectors_call_tool",
      arguments: { connectorIdOrName: "github", toolName: "bogus" },
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { is_error: boolean };
    expect(sc.is_error).toBe(true);
  });
});
