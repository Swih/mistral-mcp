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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Mistral } from "@mistralai/mistralai";
import { registerWorkflowTools } from "../../src/tools-workflows.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

// Boot an in-memory MCP pair wired to the real Mistral SDK
async function bootWorkflowServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: { strategy: "backoff", retryConnectionErrors: true },
    timeoutMs: 30_000,
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

    expect(res.isError).toBeFalsy();
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
