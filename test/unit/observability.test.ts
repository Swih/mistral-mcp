/**
 * Unit tests for trace propagation and the audit trail.
 *
 * The property that matters most here is negative: an audit line must never
 * carry user payloads. That is asserted directly, because "we don't log
 * prompts" is the kind of claim an on-prem reviewer checks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  auditLog,
  configureAudit,
  currentTrace,
  instrumentTools,
  isAuditEnabled,
  parseTraceparent,
  traceContextFrom,
  tracingHttpClient,
  withTrace,
} from "../../src/observability.js";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("parseTraceparent", () => {
  it("parses a sampled traceparent", () => {
    const t = parseTraceparent(VALID);
    expect(t).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
  });

  it("reads the sampled flag off the low bit", () => {
    expect(parseTraceparent(VALID.replace(/-01$/, "-00"))?.sampled).toBe(false);
    expect(parseTraceparent(VALID.replace(/-01$/, "-03"))?.sampled).toBe(true);
  });

  it("rejects the all-zero ids the spec forbids", () => {
    expect(parseTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`)).toBeUndefined();
    expect(parseTraceparent(`00-4bf92f3577b34da6a3ce929d0e0e4736-${"0".repeat(16)}-01`)).toBeUndefined();
  });

  it("rejects version ff, malformed input, and non-strings", () => {
    expect(parseTraceparent(VALID.replace(/^00/, "ff"))).toBeUndefined();
    expect(parseTraceparent("not-a-traceparent")).toBeUndefined();
    expect(parseTraceparent("00-tooshort-00f067aa0ba902b7-01")).toBeUndefined();
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent(42)).toBeUndefined();
  });

  it("accepts a future version, keeping the first four fields", () => {
    expect(parseTraceparent(VALID.replace(/^00/, "01"))?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    );
  });
});

describe("traceContextFrom", () => {
  it("reads the 2026 envelope", () => {
    const t = traceContextFrom({
      mcpReq: { envelope: { traceparent: VALID, tracestate: "vendor=1" } },
    });
    expect(t?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(t?.tracestate).toBe("vendor=1");
  });

  it("falls back to plain _meta", () => {
    const t = traceContextFrom({ mcpReq: { _meta: { traceparent: VALID, baggage: "k=v" } } });
    expect(t?.spanId).toBe("00f067aa0ba902b7");
    expect(t?.baggage).toBe("k=v");
  });

  it("returns undefined on a 2025-era request that carries nothing", () => {
    expect(traceContextFrom({ mcpReq: {} })).toBeUndefined();
    expect(traceContextFrom(undefined)).toBeUndefined();
    expect(traceContextFrom({ mcpReq: { _meta: { traceparent: "garbage" } } })).toBeUndefined();
  });
});

describe("tracingHttpClient", () => {
  /** Drive a real request through the client and report what the wire saw. */
  async function sent(
    trace: Parameters<typeof withTrace>[0],
    init?: RequestInit
  ): Promise<Headers> {
    let seen: Headers | undefined;
    const client = tracingHttpClient({
      fetcher: async (input, opts) => {
        seen = new Request(input as RequestInfo, opts).headers;
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await withTrace(trace, () =>
      client.request(new Request("https://api.mistral.ai/v1/models", init))
    );
    return seen!;
  }

  it("stamps the active trace onto an outgoing request", async () => {
    const headers = await sent({
      traceparent: VALID,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
      baggage: "k=v",
      tracestate: "vendor=1",
    });
    expect(headers.get("traceparent")).toBe(VALID);
    expect(headers.get("baggage")).toBe("k=v");
    expect(headers.get("tracestate")).toBe("vendor=1");
  });

  it("leaves a request untouched when nothing is traced", async () => {
    const headers = await sent(undefined);
    expect(headers.get("traceparent")).toBeNull();
    expect(headers.get("baggage")).toBeNull();
  });

  it("never overwrites a header the SDK already set", async () => {
    const preset = "00-11111111111111111111111111111111-2222222222222222-01";
    const headers = await sent(
      {
        traceparent: VALID,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        sampled: true,
      },
      { headers: { traceparent: preset } }
    );
    expect(headers.get("traceparent")).toBe(preset);
  });
});

describe("audit trail", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    configureAudit({});
  });

  afterEach(() => {
    stderr.mockRestore();
    configureAudit({});
  });

  it("emits one JSON line per event", () => {
    auditLog({ tool: "mistral_chat", outcome: "ok", duration_ms: 12 });
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = JSON.parse(stderr.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ kind: "tool_call", tool: "mistral_chat", outcome: "ok" });
    expect(typeof line.ts).toBe("string");
  });

  it("attaches the trace ids when a trace is active", () => {
    withTrace({ traceparent: VALID, traceId: "abc", spanId: "def", sampled: true }, () =>
      auditLog({ tool: "mistral_ocr", outcome: "ok", duration_ms: 3 })
    );
    const line = JSON.parse(stderr.mock.calls[0]![0] as string);
    expect(line.trace_id).toBe("abc");
    expect(line.span_id).toBe("def");
  });

  it("is silenced by MISTRAL_MCP_AUDIT=off", () => {
    configureAudit({ MISTRAL_MCP_AUDIT: "off" });
    expect(isAuditEnabled()).toBe(false);
    auditLog({ tool: "mistral_chat", outcome: "ok", duration_ms: 1 });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("is on by default", () => {
    configureAudit({});
    expect(isAuditEnabled()).toBe(true);
  });
});

describe("instrumentTools", () => {
  async function boot() {
    const server = new McpServer({ name: "obs-test", version: "0.0.0" });
    instrumentTools(server);
    server.registerTool(
      "echo",
      {
        title: "Echo",
        description: "Echo the secret back.",
        inputSchema: z.object({ secret: z.string() }),
        outputSchema: z.object({ echoed: z.string() }),
        annotations: {
          title: "Echo",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ secret }) => ({
        content: [{ type: "text" as const, text: secret }],
        structuredContent: { echoed: secret },
      })
    );
    server.registerTool(
      "boom",
      {
        title: "Boom",
        description: "Always fails.",
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        annotations: {
          title: "Boom",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => ({
        content: [{ type: "text" as const, text: "nope" }],
        structuredContent: { ok: false },
        isError: true,
      })
    );
    const client = new Client({ name: "c", version: "0.0.0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    return client;
  }

  it("audits a call without leaking the arguments or the result", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    configureAudit({});
    try {
      const client = await boot();
      const secret = "patient-record-42-confidential";
      const result = await client.callTool({ name: "echo", arguments: { secret } });

      // The tool still works, untouched.
      expect(result.structuredContent).toEqual({ echoed: secret });

      const lines = stderr.mock.calls.map((c) => String(c[0]));
      const audit = lines.filter((l) => l.includes('"kind":"tool_call"'));
      expect(audit).toHaveLength(1);
      const line = JSON.parse(audit[0]!);
      expect(line).toMatchObject({ tool: "echo", outcome: "ok" });
      expect(typeof line.duration_ms).toBe("number");

      // The whole point: no payload, anywhere in the trail.
      expect(lines.join("\n")).not.toContain(secret);
    } finally {
      stderr.mockRestore();
    }
  });

  it("records an isError result as an error outcome", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    configureAudit({});
    try {
      const client = await boot();
      await client.callTool({ name: "boom", arguments: {} });
      const line = JSON.parse(
        stderr.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"tool_call"'))!
      );
      expect(line).toMatchObject({ tool: "boom", outcome: "error" });
    } finally {
      stderr.mockRestore();
    }
  });

  it("binds the caller's trace context for the handler's own work", async () => {
    let seen: string | undefined;
    const server = new McpServer({ name: "obs-trace", version: "0.0.0" });
    instrumentTools(server);
    server.registerTool(
      "peek",
      {
        title: "Peek",
        description: "Reports the ambient trace id.",
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        annotations: {
          title: "Peek",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        seen = currentTrace()?.traceId;
        return {
          content: [{ type: "text" as const, text: "ok" }],
          structuredContent: { ok: true },
        };
      }
    );
    const client = new Client({ name: "c", version: "0.0.0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.callTool({
        name: "peek",
        arguments: {},
        _meta: { traceparent: VALID },
      });
    } finally {
      stderr.mockRestore();
    }
    expect(seen).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});
