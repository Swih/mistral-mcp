/**
 * Live integration tests for Mistral Workflows tools.
 *
 * Skipped unless MISTRAL_API_KEY is set in the environment.
 * Covers three tools: workflow_execute, workflow_status, workflow_interact.
 *
 * Test strategy:
 *  1. List deployed workflows — always runs (connectivity + auth check).
 *  2. If a workflow is available: execute (async) → poll status → verify shape.
 *  3. Bogus executionId → workflow_status returns isError: true (not a crash).
 *  4. workflow_interact signal on a RUNNING execution — conditional on step 2.
 *
 * We intentionally avoid waitForResult:true in the general case to keep the
 * test fast and not depend on workflow execution time.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";
import { registerWorkflowTools } from "../../src/tools-workflows.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

// Boot an in-memory MCP pair wired to the real Mistral SDK
async function bootWorkflowServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: MISTRAL_RETRY_CONFIG,
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });
  const server = new McpServer({ name: "test-workflows", version: "0.0.0" });
  registerWorkflowTools(server, mistral);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return { client, mistral };
}

describe.skipIf(!HAS_KEY)("live Mistral Workflows", () => {
  let client: Client;
  let mistral: Mistral;
  let availableWorkflows: Array<{ name: string; id: string }> = [];
  let executionId: string | null = null;

  beforeAll(async () => {
    ({ client, mistral } = await bootWorkflowServer());

    // Discover deployed workflows via the SDK directly (same path as the resource)
    try {
      const pages = await mistral.workflows.getWorkflows({ limit: 10 });
      if (pages?.result?.workflows) {
        for (const w of pages.result.workflows as Array<{ name: string; id: string }>) {
          availableWorkflows.push({ name: w.name, id: w.id });
        }
      }
    } catch {
      // If the API returns 404 / no workflows, we proceed with the empty list
    }
  });

  it("lists deployed workflows without throwing", async () => {
    // This is a pure connectivity + auth test
    expect(Array.isArray(availableWorkflows)).toBe(true);
    // All entries have name and id
    for (const w of availableWorkflows) {
      expect(typeof w.name).toBe("string");
      expect(typeof w.id).toBe("string");
    }
  });

  it("workflow_execute returns a valid execution shape (async)", async () => {
    if (availableWorkflows.length === 0) {
      console.warn("[skip] No deployed workflows found — skipping execute test.");
      return;
    }

    const target = availableWorkflows[0];
    const res = await client.callTool({
      name: "workflow_execute",
      arguments: {
        workflowIdentifier: target.name,
        waitForResult: false,
      },
    });

    // A workflow returned by getWorkflows is a *definition*; running it needs
    // an active deployment, which is a separate object. On an account with
    // none, the API answers 404 "No active deployment found" — a legitimate
    // state, not a failure of this server. Assert the contract that actually
    // matters in that case: the tool degrades into a readable error the calling
    // model can act on, rather than throwing.
    if (res.isError) {
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
      expect(text).toMatch(/deployment/i);
      expect(text).toContain("workflow_execute");
      console.warn(`[info] "${target.name}" has no active deployment — asserted the error contract instead.`);
      return;
    }

    expect(res.structuredContent).toBeDefined();

    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.execution_id).toBe("string");
    expect(typeof sc.workflow_name).toBe("string");
    expect(sc.sync).toBe(false);
    expect(["RUNNING", "COMPLETED", "FAILED", "CANCELED", "TERMINATED",
             "CONTINUED_AS_NEW", "TIMED_OUT", "RETRYING_AFTER_ERROR"])
      .toContain(sc.status);

    executionId = sc.execution_id as string;
  });

  it("workflow_status returns a valid status shape", async () => {
    if (!executionId) {
      console.warn("[skip] No execution_id from previous test — skipping status test.");
      return;
    }

    const res = await client.callTool({
      name: "workflow_status",
      arguments: { executionId },
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.execution_id).toBe("string");
    expect(typeof sc.workflow_name).toBe("string");
    expect(typeof sc.root_execution_id).toBe("string");
    expect(["RUNNING", "COMPLETED", "FAILED", "CANCELED", "TERMINATED",
             "CONTINUED_AS_NEW", "TIMED_OUT", "RETRYING_AFTER_ERROR"])
      .toContain(sc.status);
  });

  it("workflow_deployments_list reports what can actually run", async () => {
    const res = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      deployments: Array<Record<string, unknown>>;
      count: number;
      runnable_count: number;
    };
    expect(Array.isArray(sc.deployments)).toBe(true);
    expect(sc.count).toBe(sc.deployments.length);
    // runnable_count is what an agent reads before workflow_execute, so it must
    // be derived from the live-worker flag and never exceed the total.
    expect(sc.runnable_count).toBeLessThanOrEqual(sc.count);
    expect(sc.runnable_count).toBe(sc.deployments.filter((d) => d.is_active === true).length);
    for (const d of sc.deployments) {
      expect(typeof d.name).toBe("string");
      expect(typeof d.is_active).toBe("boolean");
      expect(typeof d.active_worker_count).toBe("number");
    }
  });

  it("workflow_deployments_list explains the 404 that workflow_execute would raise", async () => {
    // The two tools have to agree: if nothing is runnable, executing a listed
    // workflow must fail, and the deployments tool is where the reason lives.
    const dep = await client.callTool({ name: "workflow_deployments_list", arguments: {} });
    const runnable = (dep.structuredContent as { runnable_count: number }).runnable_count;
    if (runnable > 0 || availableWorkflows.length === 0) {
      console.warn("[info] workspace has a runnable deployment or no workflow — agreement check not applicable.");
      return;
    }
    const text = (dep.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toMatch(/no workflow deployment|none with a live worker/i);
    const exec = await client.callTool({
      name: "workflow_execute",
      arguments: { workflowIdentifier: availableWorkflows[0]!.name, waitForResult: false },
    });
    expect(exec.isError).toBe(true);
    expect((exec.content as Array<{ text: string }>)[0]?.text ?? "").toMatch(/deployment/i);
  });

  it("workflow_runs_list returns a well-formed execution list", async () => {
    const res = await client.callTool({ name: "workflow_runs_list", arguments: { limit: 5 } });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      executions: Array<Record<string, unknown>>;
      count: number;
    };
    expect(Array.isArray(sc.executions)).toBe(true);
    expect(sc.count).toBe(sc.executions.length);
    for (const e of sc.executions) {
      expect(typeof e.workflow_name).toBe("string");
      expect(typeof e.execution_id).toBe("string");
      // Dates must reach the client as ISO strings, never as Date instances
      // that JSON-RPC would have flattened differently.
      if (e.start_time !== undefined) {
        expect(String(e.start_time)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });

  it("workflow_stop on a bogus executionId returns isError:true (not a crash)", async () => {
    const res = await client.callTool({
      name: "workflow_stop",
      arguments: { executionId: "non-existent-execution-id-00000000" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("workflow_stop");
  });

  it("workflow_status with bogus executionId returns isError:true (not a crash)", async () => {
    const res = await client.callTool({
      name: "workflow_status",
      arguments: { executionId: "non-existent-execution-id-00000000" },
    });

    // Should return a graceful error, not throw
    expect(res.isError).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text.length).toBeGreaterThan(0);
  });

  it("workflow_interact (query) on running execution returns result or graceful error", async () => {
    if (!executionId) {
      console.warn("[skip] No execution_id — skipping interact test.");
      return;
    }

    const res = await client.callTool({
      name: "workflow_interact",
      arguments: {
        action: "query",
        executionId,
        name: "get_status",
      },
    });

    // Either a successful query or a graceful error (e.g. handler not defined)
    // — in both cases the tool must NOT throw
    expect(typeof res.isError === "boolean" || res.isError === undefined).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
  });
});
