/**
 * Trace propagation and audit logging.
 *
 * Two things an on-prem operator needs and cannot add from outside:
 *
 *   1. **Continuity.** MCP 2026-07-28 carries W3C trace context in a request's
 *      `_meta` (`traceparent` / `tracestate` / `baggage`). If the server drops
 *      it, the customer's collector sees an MCP span and an unrelated Mistral
 *      span with no edge between them. We read it off the request, hold it in
 *      an `AsyncLocalStorage` for the duration of the handler, and a
 *      `beforeRequest` hook on the Mistral HTTP client stamps it onto every
 *      outgoing call — so no tool handler has to know this exists.
 *
 *   2. **An audit trail.** One JSON line per tool call on stderr: what ran,
 *      how long it took, whether it failed, and which trace it belongs to.
 *      MCP's own `logging` capability is deprecated in 2026-07-28, which names
 *      stderr and OpenTelemetry as the replacements.
 *
 * What never appears in a line: prompts, documents, transcripts, tool
 * arguments, model output. The audit trail answers "what did the agent do",
 * never "what was in it" — those are the customer's records, and this process
 * has no business copying them into a log it does not own.
 *
 * Zero dependencies: `node:async_hooks` is core, and the trace format is 55
 * characters of hex this file parses itself.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { HTTPClient } from "@mistralai/mistralai";

/** W3C Trace Context, as carried by MCP `_meta`. */
export interface TraceContext {
  traceparent: string;
  traceId: string;
  spanId: string;
  sampled: boolean;
  tracestate?: string;
  baggage?: string;
}

/**
 * `version-traceId-parentId-flags`, all lowercase hex.
 * https://www.w3.org/TR/trace-context/#traceparent-header-field-values
 */
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Parse a traceparent, rejecting the two all-zero ids the spec calls invalid.
 * Returns undefined rather than throwing: a malformed header from a peer is
 * not a reason to fail the tool call the peer actually asked for.
 */
export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== "string") return undefined;
  const m = TRACEPARENT.exec(value.trim());
  if (!m) return undefined;
  const [, version, traceId, spanId, flags] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  // 'ff' is forbidden; future versions stay forward-compatible by keeping the
  // first four fields, so anything else is accepted as-is.
  if (version === "ff") return undefined;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return {
    traceparent: `${version}-${traceId}-${spanId}-${flags}`,
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 0x01) === 1,
  };
}

/** Anything shaped like an MCP handler context, without depending on the SDK type. */
interface MetaCarrier {
  mcpReq?: {
    _meta?: Record<string, unknown> | undefined;
    envelope?: Record<string, unknown> | undefined;
  };
}

/**
 * Pull the trace context off an MCP request. The reserved envelope keys are
 * lifted out of `_meta` by the SDK on the 2026 era, so both places are read;
 * on a 2025-era request there is simply nothing to find.
 */
export function traceContextFrom(ctx: unknown): TraceContext | undefined {
  const meta = ctx as MetaCarrier | undefined;
  const bags = [meta?.mcpReq?.envelope, meta?.mcpReq?._meta];
  for (const bag of bags) {
    if (!bag) continue;
    const parsed = parseTraceparent(bag["traceparent"]);
    if (!parsed) continue;
    const tracestate = bag["tracestate"];
    const baggage = bag["baggage"];
    return {
      ...parsed,
      ...(typeof tracestate === "string" && tracestate ? { tracestate } : {}),
      ...(typeof baggage === "string" && baggage ? { baggage } : {}),
    };
  }
  return undefined;
}

const traceStore = new AsyncLocalStorage<TraceContext>();

/** Run `fn` with `trace` visible to every Mistral call it makes, however deep. */
export function withTrace<T>(trace: TraceContext | undefined, fn: () => T): T {
  return trace ? traceStore.run(trace, fn) : fn();
}

/** The trace context of the handler currently running, if any. */
export function currentTrace(): TraceContext | undefined {
  return traceStore.getStore();
}

/**
 * A Mistral HTTP client that stamps the active trace context onto every
 * request. Headers the SDK already set are never overwritten.
 *
 * `options` is passed straight through, so an operator can supply their own
 * `fetcher` (a proxy agent, an mTLS pool) and keep the tracing.
 */
export function tracingHttpClient(
  options?: ConstructorParameters<typeof HTTPClient>[0]
): HTTPClient {
  const client = new HTTPClient(options);
  client.addHook("beforeRequest", (req) => {
    const trace = currentTrace();
    if (!trace) return req;
    const next = new Request(req);
    if (!next.headers.has("traceparent")) {
      next.headers.set("traceparent", trace.traceparent);
    }
    if (trace.tracestate && !next.headers.has("tracestate")) {
      next.headers.set("tracestate", trace.tracestate);
    }
    if (trace.baggage && !next.headers.has("baggage")) {
      next.headers.set("baggage", trace.baggage);
    }
    return next;
  });
  return client;
}

// ---------------------------------------------------------------- audit ----

export type AuditOutcome = "ok" | "error";

export interface AuditEvent {
  /** Tool name, e.g. `mistral_ocr`. */
  tool: string;
  outcome: AuditOutcome;
  duration_ms: number;
  /** Model actually used, when the tool knows it. Not user data. */
  model?: string;
  /** Error class or HTTP status — never the message body, which can quote input. */
  error_kind?: string;
}

let auditEnabled = true;

/**
 * `MISTRAL_MCP_AUDIT=off` silences the trail. On by default: an audit line an
 * operator has to discover and enable is one they will not have when they need
 * it, and stderr cannot corrupt the JSON-RPC stream on stdout.
 */
export function configureAudit(env: NodeJS.ProcessEnv = process.env): void {
  auditEnabled = (env.MISTRAL_MCP_AUDIT ?? "").trim().toLowerCase() !== "off";
}

/** For tests: report the current setting without reaching into the module. */
export function isAuditEnabled(): boolean {
  return auditEnabled;
}

/** One JSON line on stderr. Never called with user payloads — see the header. */
export function auditLog(event: AuditEvent): void {
  if (!auditEnabled) return;
  const trace = currentTrace();
  const line = {
    ts: new Date().toISOString(),
    kind: "tool_call",
    ...event,
    ...(trace ? { trace_id: trace.traceId, span_id: trace.spanId } : {}),
  };
  console.error(JSON.stringify(line));
}

/**
 * Wrap a server's `registerTool` so every tool registered afterwards is timed,
 * audited and trace-bound.
 *
 * Instrumenting the registration seam rather than the 41 call sites is
 * deliberate: this repo has already shipped the same bug twice — a rule applied
 * at each site, and one site that was missed (`codestral_fim` leaking into the
 * `workflows` profile in 0.8.0, `resources.ts` ignoring its `profile` argument
 * until 0.10.0). A tool cannot be forgotten here, because forgetting would mean
 * not registering it at all.
 */
export function instrumentTools<T extends { registerTool: (...a: never[]) => unknown }>(
  server: T
): T {
  const original = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    cb: (...args: unknown[]) => unknown
  ) => unknown;

  (server as { registerTool: unknown }).registerTool = (
    name: string,
    config: unknown,
    cb: (...args: unknown[]) => unknown
  ) =>
    original(name, config, (...args: unknown[]) =>
      // The handler context is always the last argument, whether or not the
      // tool declared an input schema.
      observeTool(name, args[args.length - 1], async () => {
        const out = await cb(...args);
        return (out ?? {}) as { isError?: boolean };
      })
    );

  return server;
}

/**
 * Time a tool handler, emit its audit line, and keep the trace context bound
 * for every Mistral call it makes. Returns whatever the handler returned — it
 * never converts a result into an error or vice versa.
 */
export async function observeTool<T extends { isError?: boolean }>(
  tool: string,
  ctx: unknown,
  run: () => Promise<T>
): Promise<T> {
  const trace = traceContextFrom(ctx);
  const started = Date.now();
  return withTrace(trace, async () => {
    try {
      const result = await run();
      auditLog({
        tool,
        outcome: result?.isError ? "error" : "ok",
        duration_ms: Date.now() - started,
      });
      return result;
    } catch (err) {
      // Handlers are supposed to return isError instead of throwing; if one
      // does throw, the trail records that fact and the throw continues.
      auditLog({
        tool,
        outcome: "error",
        duration_ms: Date.now() - started,
        error_kind: err instanceof Error ? err.constructor.name : typeof err,
      });
      throw err;
    }
  });
}
