/**
 * Retention tests for the `process_document` cache.
 *
 * The audit finding these exist for: `stored_at` was written on every entry
 * and never read back, so the only invalidation was a PIPELINE_VERSION bump.
 * Extracted content — a contract's parties and clauses, an invoice's line
 * items — sat on disk in plaintext indefinitely. These assert that it stops
 * existing, not merely that it stops being served.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import type { Mistral } from "@mistralai/mistralai";
import { registerDocsTools } from "../../src/tools-docs.js";

let dir: string;
const OLD_ENV = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mmcp-cache-"));
  process.env.MISTRAL_MCP_CACHE_DIR = dir;
  delete process.env.MISTRAL_MCP_CACHE_TTL_HOURS;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...OLD_ENV };
});

/** Mistral mock whose OCR and extraction are counted, so a cache hit is visible. */
function mistralMock(counter: { ocr: number }) {
  return {
    ocr: {
      process: vi.fn(async () => {
        counter.ocr += 1;
        return {
          pages: [{ index: 0, markdown: "FACTURE 2026-0001 Total 100,00 EUR ACME", confidenceScores: { averagePageConfidenceScore: 0.8 } }],
          usageInfo: { pagesProcessed: 1 },
        };
      }),
    },
    chat: {
      complete: vi.fn(async () => ({
        choices: [{ message: { content: JSON.stringify({ kind: "generic" }) } }],
      })),
    },
  } as unknown as Mistral;
}

async function boot(counter: { ocr: number }) {
  const server = new McpServer({ name: "t", version: "0.0.0" });
  registerDocsTools(server, mistralMock(counter));
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

const SOURCE = { type: "url" as const, url: "https://example.test/a.pdf" };

/**
 * A different document whose cache key lands in the same shard as `like`.
 *
 * The shard is the first two hex characters of sha256(source), so this repeats
 * the production key derivation on purpose: it is the only way to write into a
 * chosen shard without touching the stale key, which is what separates the
 * sweep from the read path. Expected search length is 256 candidates.
 */
function sameShardSource(like: typeof SOURCE): typeof SOURCE {
  const shardOf = (v: unknown) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 2);
  const target = shardOf(like);
  for (let i = 0; i < 200_000; i += 1) {
    const candidate = { type: "url" as const, url: `https://example.test/n${i}.pdf` };
    if (shardOf(candidate) === target) return candidate;
  }
  throw new Error("no same-shard source found");
}

function cacheFiles(): string[] {
  const out: string[] = [];
  for (const shard of readdirSync(dir)) {
    const sub = join(dir, shard);
    try {
      for (const f of readdirSync(sub)) if (f.endsWith(".json")) out.push(join(sub, f));
    } catch {
      /* not a directory */
    }
  }
  return out;
}

describe("cache retention", () => {
  it("does not reuse a shorter extraction when the page limit changes", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    for (const maxPages of [1, 50]) {
      const result = await client.callTool({ name: "process_document", arguments: {
        source: SOURCE, kind: "generic", options: { maxPages },
      } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ cache_hit: false });
    }
    expect(counter.ocr).toBe(2);
  });

  it("checks a stricter quality floor on cache hits", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    await client.callTool({ name: "process_document", arguments: { source: SOURCE, kind: "generic" } });
    const result = await client.callTool({ name: "process_document", arguments: {
      source: SOURCE, kind: "generic", options: { minOcrConfidence: 0.9 },
    } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("below the requested minimum");
    expect(counter.ocr).toBe(1);
  });

  it("does not reuse results after the extraction model changes", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" };
    await client.callTool({ name: "process_document", arguments: args });
    process.env.MISTRAL_DEFAULT_MODEL = "another-model";
    const result = await client.callTool({ name: "process_document", arguments: args });
    expect(result.structuredContent).toMatchObject({ cache_hit: false });
    expect(counter.ocr).toBe(2);
  });

  it("rejects malformed cached output and recomputes it", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" };
    await client.callTool({ name: "process_document", arguments: args });
    const [file] = cacheFiles();
    const body = JSON.parse(readFileSync(file!, "utf8"));
    body.payload = { kind: "generic", ocr_confidence: 1 };
    writeFileSync(file!, JSON.stringify(body));
    const result = await client.callTool({ name: "process_document", arguments: args });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ cache_hit: false });
    expect(counter.ocr).toBe(2);
  });
  it("serves a second identical call from cache", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" as const };
    const first = await client.callTool({ name: "process_document", arguments: args });
    const second = await client.callTool({ name: "process_document", arguments: args });
    expect(first.isError).toBeFalsy();
    expect((first.structuredContent as { cache_hit: boolean }).cache_hit).toBe(false);
    expect((second.structuredContent as { cache_hit: boolean }).cache_hit).toBe(true);
    expect(counter.ocr).toBe(1);
  });

  it("does not serve an entry older than the TTL, and deletes it", async () => {
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" as const };
    await client.callTool({ name: "process_document", arguments: args });
    const [file] = cacheFiles();
    expect(file).toBeDefined();

    // Backdate the entry past the default seven-day window.
    const body = JSON.parse(readFileSync(file!, "utf8")) as Record<string, unknown>;
    body.stored_at = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString();
    writeFileSync(file!, JSON.stringify(body), "utf8");

    const again = await client.callTool({ name: "process_document", arguments: args });
    expect((again.structuredContent as { cache_hit: boolean }).cache_hit).toBe(false);
    expect(counter.ocr).toBe(2);
    // The stale bytes must be gone. The path exists again because the miss
    // recomputed and re-stored, so assert on the timestamp, not the file.
    const after = JSON.parse(readFileSync(file!, "utf8")) as { stored_at: string };
    expect(Date.now() - Date.parse(after.stored_at)).toBeLessThan(60_000);
  });

  it("sweeps an expired entry nobody ever asks about again", async () => {
    // Read-time expiry only reaches what somebody re-requests; a document
    // processed once and never revisited is exactly the case that kept content
    // on disk forever. The shard is derived from the source hash alone, so
    // writing a different document that hashes into the same shard exercises
    // the sweep without ever touching the stale key — the only way to observe
    // the sweep rather than the read path.
    const counter = { ocr: 0 };
    const client = await boot(counter);
    await client.callTool({
      name: "process_document",
      arguments: { source: SOURCE, kind: "generic" },
    });
    const [file] = cacheFiles();
    const body = JSON.parse(readFileSync(file!, "utf8")) as Record<string, unknown>;
    body.stored_at = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    writeFileSync(file!, JSON.stringify(body), "utf8");
    expect(existsSync(file!)).toBe(true);

    await client.callTool({
      name: "process_document",
      arguments: { source: sameShardSource(SOURCE), kind: "generic" },
    });
    expect(existsSync(file!)).toBe(false);
  });

  it("writes nothing at all when the TTL is zero", async () => {
    process.env.MISTRAL_MCP_CACHE_TTL_HOURS = "0";
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" as const };
    await client.callTool({ name: "process_document", arguments: args });
    await client.callTool({ name: "process_document", arguments: args });
    expect(cacheFiles()).toHaveLength(0);
    expect(counter.ocr).toBe(2);
  });

  it("falls back to the default when the TTL is not a usable number", async () => {
    process.env.MISTRAL_MCP_CACHE_TTL_HOURS = "not-a-number";
    const counter = { ocr: 0 };
    const client = await boot(counter);
    const args = { source: SOURCE, kind: "generic" as const };
    await client.callTool({ name: "process_document", arguments: args });
    const second = await client.callTool({ name: "process_document", arguments: args });
    // Unparseable must not silently mean "never cache" nor "cache forever".
    expect((second.structuredContent as { cache_hit: boolean }).cache_hit).toBe(true);
  });
});
