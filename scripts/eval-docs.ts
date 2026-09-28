/**
 * Evaluation harness for `process_document`.
 *
 *   npm run eval:docs            # needs MISTRAL_API_KEY
 *   npm run eval:docs -- --json  # machine-readable, for CI archival
 *
 * Runs the whole corpus through the tool and reports, per document: whether
 * `kind: "auto"` classified it correctly, OCR text retention, typed extraction
 * where ground truth exists, the page count, and the OCR confidence.
 *
 * Why this exists: `minOcrConfidence` shipped with a default of 0.3 and a
 * comment calling it empirical. It was not empirical — nothing had measured
 * it. A threshold nobody can reproduce is folklore, and the first customer to
 * hit a false reject has no way to argue with it. `suggestThreshold` below
 * derives a defensible number from an actual run, and the report prints the
 * evidence next to it.
 *
 * The scoring and threshold logic are exported and unit-tested without a key
 * (`test/unit/eval-docs.test.ts`); only `main` needs the network.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { Mistral } from "@mistralai/mistralai";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import { registerDocsTools } from "../src/tools-docs.js";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../src/shared.js";

type FieldValue = string | number | boolean | null;

export interface CorpusDocument {
  file: string;
  bytes: number;
  expected_kind: string;
  page_count: number;
  text_extractable: boolean;
  must_contain: string[];
  /** Exact typed values at dot-separated structured-result paths (array indices allowed). */
  expected_fields?: Record<string, FieldValue>;
  low_signal?: boolean;
  blank_page_index?: number;
  asserts_cache_bypass?: boolean;
  notes: string;
}

export interface CorpusManifest {
  documents: CorpusDocument[];
}

// Preserve kind-specific fields, including malformed values, so scoring can
// report which extraction failed instead of discarding the evidence.
const DocumentResultSchema = z.object({
  file: z.string(),
  kind: z.string().optional(),
  ocr_text: z.string().optional(),
  ocr_confidence: z.number().min(0).max(1).nullable().optional(),
  page_count: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  cleanup_error: z.string().optional(),
}).passthrough();

export type DocumentResult = z.infer<typeof DocumentResultSchema>;

export interface ExtractionMismatch {
  path: string;
  expected: FieldValue;
  actual?: unknown;
  reason: "missing" | "type" | "value";
}

export interface DocumentScore {
  file: string;
  /** `kind: "auto"` returned the kind the ground truth expects. */
  kind_ok: boolean;
  /** Every `must_contain` string survived OCR; retained for compatibility, not extraction accuracy. */
  fields_ok: boolean;
  /** Omitted when no typed-field truth exists or a tool error prevented measurement. */
  extraction_ok?: boolean;
  mismatches?: ExtractionMismatch[];
  /** Reported page count matches the ground truth. */
  pages_ok: boolean;
  missing: string[];
  confidence?: number;
  low_signal: boolean;
  error?: string;
  cleanup_error?: string;
}

/** True when all available checks pass; absent extraction truth is not a measurement. */
export function isClean(score: DocumentScore): boolean {
  return !score.error && !score.cleanup_error && score.kind_ok && score.fields_ok &&
    score.pages_ok && score.extraction_ok !== false;
}

function fieldAt(result: unknown, path: string): unknown {
  let value = result;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, key)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function scoreExtraction(truth: CorpusDocument, result: DocumentResult):
  Pick<DocumentScore, "extraction_ok" | "mismatches"> {
  const fields = Object.entries(truth.expected_fields ?? {});
  if (!fields.length) return {};
  const mismatches: ExtractionMismatch[] = [];
  for (const [path, expected] of fields) {
    const actual = fieldAt(result, path);
    if (actual === expected) continue;
    mismatches.push({
      path,
      expected,
      ...(actual !== undefined ? { actual } : {}),
      reason: actual === undefined || actual === null ? "missing"
        : typeof actual !== typeof expected ? "type" : "value",
    });
  }
  return { extraction_ok: mismatches.length === 0, mismatches };
}

/**
 * Compare one run against its ground truth.
 *
 * OCR string matching is accent- and case-insensitive and collapses whitespace:
 * an OCR engine that returns "12 960,00" where the PDF has a narrow no-break
 * space has not made a mistake worth failing a build over. Typed extraction
 * compares exact values without coercion: a numeric string is not a number.
 */
export function scoreDocument(truth: CorpusDocument, result: DocumentResult): DocumentScore {
  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

  if (result.error) {
    return {
      file: truth.file,
      kind_ok: false,
      fields_ok: false,
      pages_ok: false,
      missing: truth.must_contain,
      low_signal: Boolean(truth.low_signal),
      error: result.error,
      ...(result.cleanup_error ? { cleanup_error: result.cleanup_error } : {}),
    };
  }

  const haystack = normalize(result.ocr_text ?? "");
  const missing = truth.must_contain.filter((needle) => !haystack.includes(normalize(needle)));

  return {
    file: truth.file,
    kind_ok: result.kind === truth.expected_kind,
    fields_ok: missing.length === 0,
    ...scoreExtraction(truth, result),
    pages_ok: result.page_count === truth.page_count,
    missing,
    ...(typeof result.ocr_confidence === "number"
      ? { confidence: result.ocr_confidence }
      : {}),
    low_signal: Boolean(truth.low_signal),
    ...(result.cleanup_error ? { cleanup_error: result.cleanup_error } : {}),
  };
}

export interface ThresholdSuggestion {
  /** The value to put in `minOcrConfidence`, or undefined when unjustifiable. */
  suggested?: number;
  /** Lowest confidence among documents that came back clean. */
  floor_clean?: number;
  /** Highest confidence among documents the corpus marks as low-signal. */
  ceiling_low_signal?: number;
  reason: string;
}

/**
 * Derive a threshold from a run.
 *
 * The only defensible threshold sits strictly between the worst document that
 * passed the available checks and the best document marked as low-signal. If
 * those two overlap, confidence does not separate the two populations on this
 * corpus and no threshold is honest — the function says so rather than
 * inventing a number, because a fabricated default is exactly what this
 * harness exists to replace.
 */
export function suggestThreshold(scores: DocumentScore[]): ThresholdSuggestion {
  const withConfidence = scores.filter((s) => typeof s.confidence === "number");
  if (withConfidence.length === 0) {
    return { reason: "No document reported an OCR confidence; nothing to calibrate." };
  }

  const clean = withConfidence.filter((s) => isClean(s) && !s.low_signal);
  const lowSignal = withConfidence.filter((s) => s.low_signal);

  if (clean.length === 0) {
    return { reason: "No document passed the available checks; fix extraction or OCR before calibrating." };
  }
  const cleanValues = clean.map((s) => s.confidence!);
  const floorClean = Math.min(...cleanValues);

  if (lowSignal.length === 0) {
    return {
      floor_clean: floorClean,
      reason:
        "No low-signal document in the run, so there is no negative case to " +
        "separate from. A threshold set from the clean floor alone would only " +
        "encode this corpus.",
    };
  }
  const ceilingLow = Math.max(...lowSignal.map((s) => s.confidence!));

  if (ceilingLow >= floorClean) {
    return {
      floor_clean: floorClean,
      ceiling_low_signal: ceilingLow,
      reason:
        `Confidence does not separate the populations (low-signal reaches ${ceilingLow.toFixed(3)}, ` +
        `clean floor is ${floorClean.toFixed(3)}). No threshold is defensible on this corpus; ` +
        "reject on failed OCR or measured extraction checks instead of on confidence.",
    };
  }

  // A gap narrower than the ordinary spread among clean documents is noise,
  // not separation. The first real run made the case: every document scored
  // between 0.950 and 0.985, the deliberately low-signal one included, so the
  // midpoint rule produced 0.95 — a value that would reject essentially every
  // real scan. The overlap check above missed it by 0.009. Comparing the gap
  // to the clean population's own spread needs no invented constant: it asks
  // whether confidence separates these documents better than it separates
  // documents of the same quality from each other.
  const cleanSpread = Math.max(...cleanValues) - floorClean;
  const gap = floorClean - ceilingLow;
  if (clean.length >= 2 && gap <= cleanSpread) {
    return {
      floor_clean: floorClean,
      ceiling_low_signal: ceilingLow,
      reason:
        `The gap between the populations (${gap.toFixed(3)}) is no wider than the ordinary ` +
        `spread among clean documents (${cleanSpread.toFixed(3)}). Confidence is not ` +
        "separating signal from noise on this corpus — the documents are too uniformly " +
        "readable. Add genuinely degraded documents (real scans, photographs, " +
        "photocopies) before trusting any threshold.",
    };
  }

  // Midpoint, rounded down to two decimals so the published default is a
  // number a human would write.
  const midpoint = (ceilingLow + floorClean) / 2;
  return {
    suggested: Math.floor(midpoint * 100) / 100,
    floor_clean: floorClean,
    ceiling_low_signal: ceilingLow,
    reason:
      `Midpoint between the best low-signal document (${ceilingLow.toFixed(3)}) and the ` +
      `worst clean one (${floorClean.toFixed(3)}).`,
  };
}

export function formatReport(scores: DocumentScore[], suggestion: ThresholdSuggestion): string {
  const out: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);
  out.push(
    pad("document", 30) + pad("kind", 6) + pad("OCR text", 10) +
      pad("extraction", 15) + pad("pages", 7) + "confidence"
  );
  out.push("-".repeat(78));
  for (const s of scores) {
    const mark = (ok: boolean) => (ok ? "ok" : "FAIL");
    out.push(
      pad(s.file, 30) +
        pad(s.error ? "ERR" : mark(s.kind_ok), 6) +
        pad(s.error ? "-" : mark(s.fields_ok), 10) +
        pad(s.error || s.extraction_ok === undefined ? "not measured" : mark(s.extraction_ok), 15) +
        pad(s.error ? "-" : mark(s.pages_ok), 7) +
        (typeof s.confidence === "number" ? s.confidence.toFixed(3) : "-") +
        (s.low_signal ? "  (low-signal by design)" : "")
    );
    if (s.error) out.push(`  error: ${s.error}`);
    else {
      if (s.missing.length) out.push(`  missing from OCR text: ${s.missing.join(", ")}`);
      if (s.extraction_ok === undefined) {
        out.push("  extraction not measured: no typed-field ground truth.");
      }
      for (const mismatch of s.mismatches ?? []) {
        out.push(
          `  extraction ${mismatch.path}: expected ${JSON.stringify(mismatch.expected)}, ` +
          `got ${mismatch.actual === undefined ? "missing" : JSON.stringify(mismatch.actual)} ` +
          `(${mismatch.reason})`
        );
      }
    }
    if (s.error) out.push("  extraction not measured: tool/run error.");
    if (s.cleanup_error) out.push(`  upload cleanup error: ${s.cleanup_error}`);
  }
  out.push("");
  const clean = scores.filter(isClean).length;
  out.push(`${clean}/${scores.length} documents clean on measured checks.`);
  const measured = scores.filter((s) => !s.error && s.extraction_ok !== undefined);
  const passed = measured.filter((s) => s.extraction_ok).length;
  out.push(
    `Typed-field extraction: ${passed}/${measured.length} measured documents passed; ` +
    `${scores.length - measured.length} not measured. Only declared field paths are checked.`
  );
  out.push("fields_ok/missing measure OCR text retention only.");
  out.push("");
  out.push("minOcrConfidence:");
  out.push(
    suggestion.suggested !== undefined
      ? `  suggested ${suggestion.suggested}  — ${suggestion.reason}`
      : `  no value suggested — ${suggestion.reason}`
  );
  return out.join("\n");
}

/* ------------------------------------------------------------------ live -- */

export async function runCorpus(
  manifest: CorpusManifest, dir: string, mistral: Mistral
): Promise<DocumentScore[]> {
  const server = new McpServer({ name: "eval-docs", version: "0.0.0" });
  registerDocsTools(server, mistral);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval", version: "0.0.0" });
  const scores: DocumentScore[] = [];
  try {
    await Promise.all([server.connect(st), client.connect(ct)]);
    for (const truth of manifest.documents) {
      process.stderr.write(`  ${truth.file} ... `);
      let result: DocumentResult = { file: truth.file };
      let uploadedId: string | undefined;
      try {
        const uploaded = await mistral.files.upload({
          file: { fileName: truth.file, content: readFileSync(resolve(dir, truth.file)) },
          purpose: "ocr",
        });
        uploadedId = uploaded.id;
        const called = await client.callTool({
          name: "process_document",
          arguments: {
            source: { type: "file_id", fileId: uploaded.id },
            kind: "auto",
            // Floor of 0 so the harness observes the confidence instead of being
            // rejected by the very default it is here to calibrate.
            options: { minOcrConfidence: 0, cache: "bypass" },
          },
        });
        if (called.isError) {
          result.error = called.content
            .filter((block) => block.type === "text")
            .map((block) => block.text).join("\n") || "tool error";
        } else {
          const structured = z.record(z.string(), z.unknown()).parse(called.structuredContent ?? {});
          result = DocumentResultSchema.parse({
            ...structured,
            file: truth.file,
          });
        }
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      } finally {
        if (uploadedId !== undefined) {
          try {
            const deleted = await mistral.files.delete({ fileId: uploadedId });
            if (!deleted.deleted) result.cleanup_error = "Uploaded file was not deleted.";
          } catch (err) {
            result.cleanup_error = err instanceof Error ? err.message : String(err);
          }
        }
      }
      const score = scoreDocument(truth, result);
      scores.push(score);
      process.stderr.write(score.error ? "error\n" : isClean(score) ? "clean\n" : "issues\n");
    }
    return scores;
  } finally {
    try {
      await client.close();
    } finally {
      await server.close();
    }
  }
}

async function main(): Promise<void> {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });
  if (!process.env.MISTRAL_API_KEY) {
    console.error(
      "eval:docs needs MISTRAL_API_KEY — it measures real OCR against the corpus.\n" +
        "Set it, or run `npm run test:unit` for the parts that do not need the network."
    );
    process.exit(1);
  }
  const fixtures = resolve(process.cwd(), "test/fixtures");
  const manifest = JSON.parse(
    readFileSync(resolve(fixtures, "corpus.json"), "utf8")
  ) as CorpusManifest;

  console.error(`Running ${manifest.documents.length} documents through process_document:`);
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY,
    retryConfig: MISTRAL_RETRY_CONFIG,
    timeoutMs: MISTRAL_TIMEOUT_MS,
  });
  const scores = await runCorpus(manifest, resolve(fixtures, "corpus"), mistral);
  const suggestion = suggestThreshold(scores);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ scores, suggestion }, null, 2) + "\n");
  } else {
    process.stdout.write("\n" + formatReport(scores, suggestion) + "\n");
  }
  // A document that failed to classify or lost a required field is a real
  // regression, so this is usable as a gate once someone wires a key into CI.
  process.exit(scores.every(isClean) ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
