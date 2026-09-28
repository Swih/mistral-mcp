/**
 * Live integration tests for Mistral Connectors tools.
 *
 * Skipped unless MISTRAL_API_KEY is set in the environment.
 * Covers four tools: connectors_list, connectors_get, connectors_list_tools,
 * connectors_call_tool.
 *
 * Test strategy:
 *  1. List connectors — always runs (connectivity + auth check).
 *  2. If at least one connector is visible: get it, list its tools.
 *  3. If that connector exposes at least one tool: call it with no/empty
 *     arguments and accept either a result or a graceful tool-level error
 *     (we don't control which connectors are activated on the test account).
 *  4. Bogus connectorIdOrName → connectors_get returns isError: true, not a crash.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";
import { registerConnectorTools } from "../../src/tools-connectors.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

async function bootConnectorServer() {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: MISTRAL_RETRY_CONFIG,
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });
  const server = new McpServer({ name: "test-connectors", version: "0.0.0" });
  registerConnectorTools(server, mistral);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return { client };
}

describe.skipIf(!HAS_KEY)("live Mistral Connectors", () => {
  let client: Client;
  let firstConnectorId: string | null = null;
  let firstToolName: string | null = null;

  beforeAll(async () => {
    ({ client } = await bootConnectorServer());
  });

  it("connectors_list returns a valid (possibly empty) connector summary list", async (ctx) => {
    const res = await client.callTool({ name: "connectors_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { connectors: Array<{ id: string; name: string }> };
    expect(Array.isArray(sc.connectors)).toBe(true);
    for (const c of sc.connectors) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.name).toBe("string");
    }
    if (sc.connectors.length > 0) {
      firstConnectorId = sc.connectors[0]!.id;
    }
  });

  it("connectors_get fetches public metadata without leaking credentials", async (ctx) => {
    if (!firstConnectorId) {
      console.warn("[skip] No connector visible on this account — skipping get test.");
      ctx.skip();
      return;
    }
    const res = await client.callTool({
      name: "connectors_get",
      arguments: { connectorIdOrName: firstConnectorId },
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.connector).toBeDefined();
    const connector = sc.connector as Record<string, unknown>;
    expect(connector).not.toHaveProperty("connectionCredentials");
    expect(connector).not.toHaveProperty("connection_credentials");
  });

  it("connectors_get with a bogus id returns isError:true (not a crash)", async (ctx) => {
    const res = await client.callTool({
      name: "connectors_get",
      arguments: { connectorIdOrName: "non-existent-connector-00000000" },
    });
    expect(res.isError).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text.length).toBeGreaterThan(0);
  });

  it("connectors_list_tools returns the connector's tool catalog", async (ctx) => {
    if (!firstConnectorId) {
      console.warn("[skip] No connector visible on this account — skipping list_tools test.");
      ctx.skip();
      return;
    }
    const res = await client.callTool({
      name: "connectors_list_tools",
      arguments: { connectorIdOrName: firstConnectorId },
    });
    // Connectors are listed workspace-wide, including shared_global ones the
    // workspace has never authenticated against. Listing their tools then
    // answers 401 "No credentials found ... Please authenticate" — expected,
    // and the message is the actionable part, so assert it reaches the caller.
    if (res.isError) {
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
      expect(text).toMatch(/credential|authenticate/i);
      expect(text).toContain("connectors_list_tools");
      console.warn("[info] connector not authenticated on this account — asserted the error contract instead.");
      return;
    }
    const sc = res.structuredContent as { tools: Array<{ name: string }> };
    expect(Array.isArray(sc.tools)).toBe(true);
    for (const t of sc.tools) {
      expect(typeof t.name).toBe("string");
    }
    if (sc.tools.length > 0) {
      firstToolName = sc.tools[0]!.name;
    }
  });

  it("connectors_call_tool either returns a result or a graceful error", async (ctx) => {
    if (!firstConnectorId || !firstToolName) {
      console.warn("[skip] No callable connector tool found — skipping call_tool test.");
      ctx.skip();
      return;
    }
    const res = await client.callTool({
      name: "connectors_call_tool",
      arguments: { connectorIdOrName: firstConnectorId, toolName: firstToolName },
    });

    // Either a successful call or a graceful error (e.g. missing required
    // args) — in both cases the tool must NOT throw.
    expect(typeof res.isError === "boolean" || res.isError === undefined).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
  });
});
