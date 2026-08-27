/**
 * End-to-end proof that MISTRAL_BASE_URL actually reroutes traffic.
 *
 * Spawns the built server against a throwaway OpenAI-compatible HTTP server on
 * localhost and asserts three things a unit test cannot:
 *   1. the request really lands on the custom endpoint, not api.mistral.ai;
 *   2. the inferred `self-hosted` profile hides the Mistral-only tools;
 *   3. `mistral://capabilities` tells an agent why they are missing.
 *
 * No API key and no network egress — the fake endpoint is the whole backend, so
 * this runs in CI on every push.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";

const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

interface CapturedRequest {
  method: string;
  url: string;
  authorization?: string;
  body: unknown;
}

/** Minimal OpenAI-compatible stand-in for vLLM. Records what it receives. */
function startFakeEndpoint(captured: CapturedRequest[]): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      captured.push({
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "cmpl-fake-1",
          object: "chat.completion",
          created: 1756252800,
          model: "my-org/mistral-small-3.2",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong from vllm" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 3,
            total_tokens: 14,
          },
        })
      );
    });
  });
  return new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res(server));
  });
}

describe.skipIf(!DIST_EXISTS)("self-hosted endpoint (MISTRAL_BASE_URL)", () => {
  let fake: Server;
  let captured: CapturedRequest[];
  let client: Client;
  let baseUrl: string;

  beforeAll(async () => {
    captured = [];
    fake = await startFakeEndpoint(captured);
    const { port } = fake.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      MISTRAL_BASE_URL: baseUrl,
    };
    // A stale key in the developer's shell must not change what is exercised.
    delete env.MISTRAL_MCP_PROFILE;

    const transport = new StdioClientTransport({
      command: "node",
      args: [DIST_PATH],
      env,
    });
    client = new Client({ name: "self-hosted-e2e", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await new Promise<void>((res) => fake?.close(() => res()));
  });

  it("infers the self-hosted profile and exposes only the compatible surface", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "mistral_chat",
      "mistral_chat_stream",
      "mistral_embed",
      "mistral_tool_call",
      "mistral_vision",
    ]);
  });

  it("reports the custom endpoint and explains the hidden families", async () => {
    const res = await client.readResource({ uri: "mistral://capabilities" });
    const first = res.contents[0] as { text: string };
    const cap = JSON.parse(first.text);

    expect(cap.endpoint).toBe(baseUrl);
    expect(cap.endpoint_kind).toBe("custom");
    expect(cap.profile).toBe("self-hosted");
    expect(cap.profile_inferred).toBe(true);
    expect(cap.tool_families.chat.available).toBe(true);
    expect(cap.tool_families.ocr.available).toBe(false);
    expect(cap.tool_families.ocr.unavailable_reason).toMatch(/MISTRAL_MCP_PROFILE=admin/);
  });

  it("does not register Mistral-only resources against a custom endpoint", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("mistral://capabilities");
    expect(uris).toContain("mistral://models");
    expect(uris).not.toContain("mistral://voices");
    expect(uris).not.toContain("mistral://workflows");
  });

  it("routes a real chat call to the custom endpoint", async () => {
    const before = captured.length;
    const result = await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: "ping" }],
        // An identifier no Mistral alias list contains — the point of dropping
        // the closed enum in 0.10.0.
        model: "my-org/mistral-small-3.2",
        temperature: 0,
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { text: string; model: string };
    expect(sc.text).toContain("pong from vllm");
    expect(sc.model).toBe("my-org/mistral-small-3.2");

    const hit = captured[before];
    expect(hit, "the fake endpoint received no request").toBeTruthy();
    expect(hit!.method).toBe("POST");
    expect(hit!.url).toContain("/chat/completions");
    expect((hit!.body as { model: string }).model).toBe("my-org/mistral-small-3.2");
  }, 30_000);
});
