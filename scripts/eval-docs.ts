/**
 * Evaluation harness for `process_document`.
 *
 *   npm run eval:docs            # needs MISTRAL_API_KEY
 *   npm run eval:docs -- --json  # machine-readable, for CI archival
 *
 * Runs the whole corpus through the tool and reports, per document: whether
 * `kind: "auto"` classified it correctly, whether the fields the ground truth
 * says must survive OCR actually did, the page count, and the OCR confidence.
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
import { registerDocsTools } from "../src/tools-docs.js";

// The live tests load .env the same way; without this the harness reports a
// missing key on a machine where every other live target works.
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) loadEnv({ path: envPath });

export interface CorpusDocument {
  file: string;
  bytes: number;
  expected_kind: string;
  page_count: number;
  text_extractable: boolean;
  must_contain: string[];
  low_signal?: boolean;
  blank_page_index?: number;
  asserts_cache_bypass?: boolean;
  notes: string;
}

export interface CorpusManifest {
  documents: CorpusDocument[];
}

/** What one document's run produced. */
export interface DocumentResult {
  file: string;
  kind?: string;
  ocr_text?: string;
  ocr_confidence?: number;
  page_count?: number;
  error?: string;
}

export interface DocumentScore {
  file: string;
  /** `kind: "auto"` returned the kind the ground truth expects. */
  kind_ok: boolean;
  /** Every `must_contain` string survived OCR. */
  fields_ok: boolean;
  /** Reported page count matches the ground truth. */
  pages_ok: boolean;
  missing: string[];
  confidence?: number;
  low_signal: boolean;
  error?: string;
}

/** True when a document came back completely and correctly. */
export function isClean(score: DocumentScore): boolean {
  return !score.error && score.kind_ok && score.fields_ok && score.pages_ok;
}

/**
 * Compare one run against its ground truth.
 *
 * String matching is accent- and case-insensitive and collapses whitespace:
 * an OCR engine that returns "12 960,00" where the PDF has a narrow no-break
 * space has not made a mistake worth failing a build over.
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
    };
  }

  const haystack = normalize(result.ocr_text ?? "");
  const missing = truth.must_contain.filter((needle) => !haystack.includes(normalize(needle)));

  return {
    file: truth.file,
    kind_ok: result.kind === truth.expected_kind,
    fields_ok: missing.length === 0,
    pages_ok: result.page_count === truth.page_count,
    missing,
    ...(typeof result.ocr_confidence === "number"
      ? { confidence: result.ocr_confidence }
      : {}),
    low_signal: Boolean(truth.low_signal),
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
 * extracted correctly and the best document the corpus marks as low-signal. If
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
    return { reason: "No document extracted cleanly; fix extraction before calibrating." };
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
        "reject on missing fields instead of on confidence.",
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
    pad("document", 30) + pad("kind", 6) + pad("fields", 8) + pad("pages", 7) + "confidence"
  );
  out.push("-".repeat(63));
  for (const s of scores) {
    const mark = (ok: boolean) => (ok ? "ok" : "FAIL");
    out.push(
      pad(s.file, 30) +
        pad(s.error ? "ERR" : mark(s.kind_ok), 6) +
        pad(s.error ? "-" : mark(s.fields_ok), 8) +
        pad(s.error ? "-" : mark(s.pages_ok), 7) +
        (typeof s.confidence === "number" ? s.confidence.toFixed(3) : "-") +
        (s.low_signal ? "  (low-signal by design)" : "")
    );
    if (s.error) out.push(`  error: ${s.error}`);
    else if (s.missing.length) out.push(`  missing from OCR text: ${s.missing.join(", ")}`);
  }
  out.push("");
  const clean = scores.filter(isClean).length;
  out.push(`${clean}/${scores.length} documents clean.`);
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

async function runCorpus(manifest: CorpusManifest, dir: string): Promise<DocumentScore[]> {
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
    retryConfig: { strategy: "backoff", retryConnectionErrors: true },
    timeoutMs: 120_000,
  });
  const server = new McpServer({ name: "eval-docs", version: "0.0.0" });
  registerDocsTools(server, mistral);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);

  const scores: DocumentScore[] = [];
  for (const truth of manifest.documents) {
    process.stderr.write(`  ${truth.file} ... `);
    let result: DocumentResult = { file: truth.file };
    try {
      const uploaded = await mistral.files.upload({
        file: { fileName: truth.file, content: readFileSync(resolve(dir, truth.file)) },
        purpose: "ocr",
      });
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
        result.error = (called.content as Array<{ text: string }>)[0]?.text ?? "tool error";
      } else {
        const sc = called.structuredContent as {
          kind: string;
          ocr_text: string;
          ocr_confidence: number;
          page_count: number;
        };
        result = {
          file: truth.file,
          kind: sc.kind,
          ocr_text: sc.ocr_text,
          ocr_confidence: sc.ocr_confidence,
          page_count: sc.page_count,
        };
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    const score = scoreDocument(truth, result);
    scores.push(score);
    process.stderr.write(score.error ? "error\n" : isClean(score) ? "clean\n" : "issues\n");
  }
  await client.close();
  return scores;
}

async function main(): Promise<void> {
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
  const scores = await runCorpus(manifest, resolve(fixtures, "corpus"));
  const suggestion = suggestThreshold(scores);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ scores, suggestion }, null, 2));
  } else {
    console.log("\n" + formatReport(scores, suggestion));
  }
  // A document that failed to classify or lost a required field is a real
  // regression, so this is usable as a gate once someone wires a key into CI.
  process.exit(scores.every(isClean) ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
