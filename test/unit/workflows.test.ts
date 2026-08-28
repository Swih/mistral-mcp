/**
 * Unit tests for the workflow operations tools.
 *
 * The case these exist for: a workflow returned by `getWorkflows` is a
 * definition, and running it needs a deployment with a live worker. Against a
 * real account the two are routinely out of step — a listed workflow answered
 * 404 "No active deployment found" — and nothing in the tool surface said so
 * until `workflow_deployments_list` existed. So the assertions below are about
 * the field an agent has to read before it calls `workflow_execute`.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import type { Mistral } from "@mistralai/mistralai";
import { registerWorkflowTools } from "../../src/tools-workflows.js";

function deployment(over: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    name: "prod",
    isActive: true,
    isHardened: true,
    workerCount: 2,
    activeWorkerCount: 2,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    managed: { state: "running" },
    ...over,
  };
}

function mistralMock(over: Record<string, unknown> = {}) {
  return {
    workflows: {
      deployments: {
        listDeployments: vi.fn(async () => ({
          deployments: [deployment()],
          nextCursor: null,
          workspaceId: "ws",
        })),
      },
      runs: {
        listRuns: vi.fn(async () => ({
          result: { executions: [], nextPageToken: null },
        })),
      },
      executions: {
        cancelWorkflowExecution: vi.fn(async () => undefined),
        terminateWorkflowExecution: vi.fn(async () => undefined),
      },
      ...over,
    },
  } as unknown as Mistral;
}

async function boot(mistral: Mistral) {
  const server = new McpServer({ name: "t", version: "0.0.0" });
  registerWorkflowTools(server, mistral);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

describe("workflow_deployments_list", () => {
  it("counts only deployments with a live worker as runnable", async () => {
    const m = mistralMock({
      deployments: {
        listDeployments: vi.fn(async () => ({
          deployments: [
            deployment({ id: "a", name: "prod" }),
            deployment({ id: "b", name: "staging", isActive: false, activeWorkerCount: 0 }),
          ],
          nextCursor: null,
          workspaceId: "ws",
        })),
      },
    });
    const client = await boot(m);
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    const sc = res.structuredContent as { count: number; runnable_count: number };
    expect(sc.count).toBe(2);
    expect(sc.runnable_count).toBe(1);
  });

  it("says plainly that nothing can run when the workspace has no deployment", async () => {
    // This is the state that produced the 404 on a real account, so the text
    // has to name the cause rather than report an empty list.
    const m = mistralMock({
      deployments: {
        listDeployments: vi.fn(async () => ({
          deployments: [],
          nextCursor: null,
          workspaceId: "ws",
        })),
      },
    });
    const client = await boot(m);
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/no workflow deployment/i);
    expect((res.structuredContent as { runnable_count: number }).runnable_count).toBe(0);
  });

  it("warns when deployments exist but none has a live worker", async () => {
    const m = mistralMock({
      deployments: {
        listDeployments: vi.fn(async () => ({
          deployments: [deployment({ isActive: false, activeWorkerCount: 0 })],
          nextCursor: null,
          workspaceId: "ws",
        })),
      },
    });
    const client = await boot(m);
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    const text = (res.content as Array<{ text: string }>)[0]!.text;
    expect(text).toMatch(/none with a live worker/i);
    expect(text).toContain("workflow_execute");
  });

  it("reports a self-hosted deployment as not managed", async () => {
    const m = mistralMock({
      deployments: {
        listDeployments: vi.fn(async () => ({
          deployments: [deployment({ managed: null })],
          nextCursor: null,
          workspaceId: "ws",
        })),
      },
    });
    const client = await boot(m);
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    const sc = res.structuredContent as { deployments: Array<{ managed: boolean }> };
    expect(sc.deployments[0]!.managed).toBe(false);
  });

  it("surfaces an API failure as isError instead of throwing", async () => {
    const m = mistralMock({
      deployments: {
        listDeployments: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    });
    const client = await boot(m);
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain(
      "workflow_deployments_list"
    );
  });
});

describe("workflow_runs_list", () => {
  it("normalises Date fields to ISO strings", async () => {
    const listRuns = vi.fn(async () => ({
      result: {
        executions: [
          {
            workflowName: "w",
            executionId: "e1",
            rootExecutionId: "e1",
            status: "RUNNING",
            deploymentName: "prod",
            startTime: new Date("2026-01-01T00:00:00Z"),
            endTime: null,
          },
        ],
        nextPageToken: "tok",
      },
    }));
    const client = await boot(mistralMock({ runs: { listRuns } }));
    const res = await client.callTool({ name: "workflow_runs_list", arguments: {} });
    const sc = res.structuredContent as {
      executions: Array<{ start_time: string; end_time: string | null }>;
      next_page_token: string | null;
    };
    expect(sc.executions[0]!.start_time).toBe("2026-01-01T00:00:00.000Z");
    expect(sc.executions[0]!.end_time).toBeNull();
    expect(sc.next_page_token).toBe("tok");
  });

  it("passes only the filters the caller supplied", async () => {
    const listRuns = vi.fn(async () => ({
      result: { executions: [], nextPageToken: null },
    }));
    const client = await boot(mistralMock({ runs: { listRuns } }));
    await client.callTool({
      name: "workflow_runs_list",
      arguments: { workflowIdentifier: "w", status: "RUNNING" },
    });
    expect(listRuns).toHaveBeenCalledWith({ workflowIdentifier: "w", status: "RUNNING" });
  });

  it("rejects a status outside the documented set", async () => {
    const client = await boot(mistralMock());
    const res = await client.callTool({
      name: "workflow_runs_list",
      arguments: { status: "NOT_A_STATUS" },
    });
    expect(res.isError).toBe(true);
  });
});

describe("workflow_stop", () => {
  it("defaults to the graceful cancel path", async () => {
    const cancel = vi.fn(async () => undefined);
    const terminate = vi.fn(async () => undefined);
    const client = await boot(
      mistralMock({
        executions: { cancelWorkflowExecution: cancel, terminateWorkflowExecution: terminate },
      })
    );
    const res = await client.callTool({
      name: "workflow_stop",
      arguments: { executionId: "e1" },
    });
    expect(cancel).toHaveBeenCalledWith({ executionId: "e1" });
    expect(terminate).not.toHaveBeenCalled();
    expect((res.structuredContent as { mode: string }).mode).toBe("cancel");
  });

  it("uses terminate only when explicitly asked", async () => {
    const cancel = vi.fn(async () => undefined);
    const terminate = vi.fn(async () => undefined);
    const client = await boot(
      mistralMock({
        executions: { cancelWorkflowExecution: cancel, terminateWorkflowExecution: terminate },
      })
    );
    await client.callTool({
      name: "workflow_stop",
      arguments: { executionId: "e1", mode: "terminate" },
    });
    expect(terminate).toHaveBeenCalledWith({ executionId: "e1" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("is annotated destructive, because terminate skips cleanup handlers", async () => {
    const client = await boot(mistralMock());
    const tool = (await client.listTools()).tools.find((t) => t.name === "workflow_stop")!;
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.idempotentHint).toBe(true);
  });

  it("surfaces an API failure as isError instead of throwing", async () => {
    const client = await boot(
      mistralMock({
        executions: {
          cancelWorkflowExecution: vi.fn(async () => {
            throw new Error("Execution not found");
          }),
          terminateWorkflowExecution: vi.fn(async () => undefined),
        },
      })
    );
    const res = await client.callTool({
      name: "workflow_stop",
      arguments: { executionId: "nope" },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toContain("workflow_stop");
  });
});
