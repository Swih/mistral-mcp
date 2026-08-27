/**
 * The observability chain, end to end, on the built binary.
 *
 * A unit test can show that the pieces work; only this can show they are
 * actually wired into the shipped server. It sends a trace context in an MCP
 * request's `_meta` and asserts three things:
 *
 *   1. the outgoing call to the inference endpoint carries `traceparent` and
 *      `baggage` — that is what lets a customer's collector join an MCP span
 *      to the Mistral span it caused;
 *   2. an audit line lands on stderr, carrying the trace and span ids;
 *   3. the line contains no part of the request or the response.
 *
 * Runs against a throwaway OpenAI-compatible endpoint, so no key and no egress.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";

const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const BAGGAGE = "tenant=defence-ops";
/** Must never reach a log line. */
const SECRET_PROMPT = "classified-operation-name-alpha";

describe.skipIf(!DIST_EXISTS)("observability on the built server", () => {
  let fake: Server;
  let client: Client;
  let stderrChunks: string[];
  let upstreamHeaders: Record<string, string | undefined>;

  beforeAll(async () => {
    stderrChunks = [];
    upstreamHeaders = {};

    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        upstreamHeaders = {
          traceparent: req.headers["traceparent"] as string | undefined,
          baggage: req.headers["baggage"] as string | undefined,
        };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "cmpl-1",
            object: "chat.completion",
            created: 1756252800,
            model: "local/model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "acknowledged" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
          })
        );
      });
    });
    await new Promise<void>((res, rej) => {
      fake.once("error", rej);
      fake.listen(0, "127.0.0.1", () => res());
    });
    const { port } = fake.address() as AddressInfo;

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      MISTRAL_BASE_URL: `http://127.0.0.1:${port}`,
    };
    delete env.MISTRAL_MCP_PROFILE;
    delete env.MISTRAL_MCP_AUDIT;

    const transport = new StdioClientTransport({
      command: "node",
      args: [DIST_PATH],
      env,
      stderr: "pipe",
    });
    client = new Client(
      { name: "observability-e2e", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(transport);
    transport.stderr?.on("data", (b: Buffer) => stderrChunks.push(String(b)));

    await client.callTool({
      name: "mistral_chat",
      arguments: {
        messages: [{ role: "user", content: SECRET_PROMPT }],
        model: "local/model",
      },
      _meta: { traceparent: TRACEPARENT, baggage: BAGGAGE },
    });
    // stderr is a pipe; give the write a tick to arrive.
    await new Promise((r) => setTimeout(r, 300));
  }, 40_000);

  afterAll(async () => {
    await client?.close();
    await new Promise<void>((res) => fake?.close(() => res()));
  });

  it("propagates the caller's trace context to the inference endpoint", () => {
    expect(upstreamHeaders.traceparent).toBe(TRACEPARENT);
    expect(upstreamHeaders.baggage).toBe(BAGGAGE);
  });

  it("writes an audit line carrying the trace and span ids", () => {
    const lines = stderrChunks
      .join("")
      .split("\n")
      .filter((l) => l.includes('"kind":"tool_call"'));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!);
    expect(line).toMatchObject({
      kind: "tool_call",
      tool: "mistral_chat",
      outcome: "ok",
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      span_id: "00f067aa0ba902b7",
    });
    expect(typeof line.duration_ms).toBe("number");
  });

  it("never writes the request or the response to the log", () => {
    const all = stderrChunks.join("");
    expect(all).not.toContain(SECRET_PROMPT);
    expect(all).not.toContain("acknowledged");
  });
});
