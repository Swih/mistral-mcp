/**
 * Tests for the document eval harness's scoring and calibration.
 *
 * The threshold logic is the part that matters: it is what replaces a default
 * nobody could reproduce. It is tested here against synthetic runs so the
 * reasoning is checked without an API key — the live run only supplies numbers.
 */

import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Mistral } from "@mistralai/mistralai";
import {
  isClean,
  scoreDocument,
  suggestThreshold,
  formatReport,
  runCorpus,
  type CorpusDocument,
  type CorpusManifest,
  type DocumentScore,
  type DocumentResult,
} from "../../scripts/eval-docs.js";

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/corpus.json"), "utf8")
) as CorpusManifest & { synthetic: boolean };
const INVOICE = manifest.documents.find((d) => d.file === "invoice-fr-table.pdf")!;
const INVOICE_RESULT: DocumentResult = {
  file: INVOICE.file,
  kind: "invoice",
  ocr_text: INVOICE.must_contain.join(" "),
  ocr_confidence: 0.94,
  page_count: 1,
  vendor: { name: "ACME SAS" },
  total: 12960,
  currency: "EUR",
  due_date: "2026-09-11",
  line_items: [
    { desc: "Intégration module facturation", qty: 12, unit_price: 650, amount: 7800 },
    { desc: "Maintenance applicative (août)", qty: 1, unit_price: 1200, amount: 1200 },
    { desc: "Formation utilisateurs (2 jours)", qty: 2, unit_price: 900, amount: 1800 },
  ],
  anomalies: [],
};

const TRUTH: CorpusDocument = {
  file: "invoice-fr-table.pdf",
  bytes: 3004,
  expected_kind: "invoice",
  page_count: 1,
  text_extractable: true,
  must_contain: ["2026-0842", "12 960,00", "BetaCorp"],
  notes: "",
};

function score(over: Partial<DocumentScore> = {}): DocumentScore {
  return {
    file: "x.pdf",
    kind_ok: true,
    fields_ok: true,
    pages_ok: true,
    missing: [],
    low_signal: false,
    ...over,
  };
}

describe("scoreDocument", () => {
  it("passes a run that matches the ground truth", () => {
    const s = scoreDocument(TRUTH, {
      file: TRUTH.file,
      kind: "invoice",
      ocr_text: "FACTURE n° 2026-0842 ... Total TTC 12 960,00 € ... Client BetaCorp SARL",
      ocr_confidence: 0.94,
      page_count: 1,
    });
    expect(isClean(s)).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.confidence).toBe(0.94);
    expect(s).not.toHaveProperty("extraction_ok");
    expect(s).not.toHaveProperty("mismatches");
  });

  it("ignores accents, case and whitespace runs when matching", () => {
    const s = scoreDocument(
      { ...TRUTH, must_contain: ["Échéance", "TOTAL TTC"] },
      {
        file: TRUTH.file,
        kind: "invoice",
        ocr_text: "echeance   11/09/2026\n\ntotal    ttc",
        page_count: 1,
      }
    );
    expect(s.fields_ok).toBe(true);
  });

  it("reports each field OCR lost", () => {
    const s = scoreDocument(TRUTH, {
      file: TRUTH.file,
      kind: "invoice",
      ocr_text: "FACTURE 2026-0842 only",
      page_count: 1,
    });
    expect(s.fields_ok).toBe(false);
    expect(s.missing).toEqual(["12 960,00", "BetaCorp"]);
  });

  it("flags a misclassification and a page-count mismatch separately", () => {
    const s = scoreDocument(TRUTH, {
      file: TRUTH.file,
      kind: "generic",
      ocr_text: "2026-0842 12 960,00 BetaCorp",
      page_count: 2,
    });
    expect(s.kind_ok).toBe(false);
    expect(s.pages_ok).toBe(false);
    expect(s.fields_ok).toBe(true);
    expect(isClean(s)).toBe(false);
  });

  it("turns a tool error into a failed score rather than throwing", () => {
    const s = scoreDocument(TRUTH, { file: TRUTH.file, error: "413 payload too large" });
    expect(s.error).toBe("413 payload too large");
    expect(isClean(s)).toBe(false);
    expect(s.missing).toEqual(TRUTH.must_contain);
  });

  it("checks typed invoice values independently of OCR substrings", () => {
    const s = scoreDocument(INVOICE, INVOICE_RESULT);
    expect(isClean(s)).toBe(true);
    expect(s.extraction_ok).toBe(true);
    expect(s.mismatches).toEqual([]);

    const lostText = scoreDocument(INVOICE, { ...INVOICE_RESULT, ocr_text: "" });
    expect(lostText.fields_ok).toBe(false);
    expect(lostText.extraction_ok).toBe(true);
    expect(isClean(lostText)).toBe(false);
  });

  it.each([
    { fields: { total: 10800 }, path: "total", expected: 12960, actual: 10800, reason: "value" },
    { fields: { total: "12960" }, path: "total", expected: 12960, actual: "12960", reason: "type" },
    { fields: { currency: "GBP" }, path: "currency", expected: "EUR", actual: "GBP", reason: "value" },
    { fields: { vendor: { name: "BetaCorp SARL" } }, path: "vendor.name", expected: "ACME SAS", actual: "BetaCorp SARL", reason: "value" },
  ])("fails correct OCR with wrong $path ($reason)", ({ fields, ...mismatch }) => {
    const s = scoreDocument(INVOICE, { ...INVOICE_RESULT, ...fields });
    expect(s.fields_ok).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.extraction_ok).toBe(false);
    expect(s.mismatches).toEqual([mismatch]);
    expect(isClean(s)).toBe(false);
  });

  it("reports missing nested fields and array entries as missing evidence", () => {
    const s = scoreDocument(INVOICE, {
      ...INVOICE_RESULT, total: null, vendor: {}, line_items: [],
    });
    expect(s.error).toBeUndefined();
    expect(s.extraction_ok).toBe(false);
    expect(s.mismatches).toEqual(expect.arrayContaining([
      { path: "total", expected: 12960, actual: null, reason: "missing" },
      { path: "vendor.name", expected: "ACME SAS", reason: "missing" },
      { path: "line_items.length", expected: 3, actual: 0, reason: "value" },
      { path: "line_items.0.qty", expected: 12, reason: "missing" },
    ]));
    expect(isClean(s)).toBe(false);
  });

  it("distinguishes missing extraction evidence, absent truth and tool errors", () => {
    const missing = scoreDocument(INVOICE, {
      file: INVOICE.file, kind: "invoice", page_count: 1, ocr_text: INVOICE_RESULT.ocr_text,
    });
    expect(missing.fields_ok).toBe(true);
    expect(missing.extraction_ok).toBe(false);
    expect(missing.mismatches?.every((m) => m.reason === "missing")).toBe(true);
    expect(missing.error).toBeUndefined();

    const unmeasured = scoreDocument({ ...INVOICE, expected_fields: {} }, INVOICE_RESULT);
    expect(unmeasured).not.toHaveProperty("extraction_ok");
    expect(unmeasured).not.toHaveProperty("mismatches");

    const error = scoreDocument(INVOICE, { file: INVOICE.file, error: "OCR unavailable" });
    expect(error.error).toBe("OCR unavailable");
    expect(error).not.toHaveProperty("extraction_ok");
    expect(error).not.toHaveProperty("mismatches");
    expect(isClean(error)).toBe(false);
  });
});

describe("suggestThreshold", () => {
  it("puts the threshold between the low-signal ceiling and the clean floor", () => {
    const out = suggestThreshold([
      score({ confidence: 0.95 }),
      score({ confidence: 0.8 }),
      score({ confidence: 0.4, low_signal: true }),
    ]);
    expect(out.floor_clean).toBe(0.8);
    expect(out.ceiling_low_signal).toBe(0.4);
    // Midpoint 0.6, floored to two decimals.
    expect(out.suggested).toBe(0.6);
  });

  it("refuses when the gap is narrower than the clean population's own spread", () => {
    // The shape of the first real run: everything lands in a narrow high band,
    // including the document that is meant to be hard. The populations do not
    // overlap, so the overlap check passes, but 0.009 of separation against
    // 0.025 of ordinary spread is noise and the midpoint would be unusable.
    const out = suggestThreshold([
      score({ confidence: 0.985 }),
      score({ confidence: 0.959 }),
      score({ confidence: 0.95, low_signal: true }),
    ]);
    expect(out.suggested).toBeUndefined();
    expect(out.reason).toMatch(/not separating signal from noise/i);
    expect(out.reason).toMatch(/degraded documents/i);
  });

  it("still suggests when the gap is genuinely wider than the spread", () => {
    const out = suggestThreshold([
      score({ confidence: 0.95 }),
      score({ confidence: 0.9 }),
      score({ confidence: 0.4, low_signal: true }),
    ]);
    // Spread among clean is 0.05, gap is 0.5 — real separation.
    expect(out.suggested).toBe(0.65);
  });

  it("refuses to suggest when the populations overlap", () => {
    const out = suggestThreshold([
      score({ confidence: 0.55 }),
      score({ confidence: 0.7, low_signal: true }),
    ]);
    expect(out.suggested).toBeUndefined();
    expect(out.reason).toMatch(/does not separate/i);
  });

  it("refuses to suggest from clean documents alone", () => {
    const out = suggestThreshold([score({ confidence: 0.9 }), score({ confidence: 0.85 })]);
    expect(out.suggested).toBeUndefined();
    expect(out.floor_clean).toBe(0.85);
    expect(out.reason).toMatch(/no negative case/i);
  });

  it("refuses to suggest when nothing extracted cleanly", () => {
    const out = suggestThreshold([score({ confidence: 0.9, kind_ok: false })]);
    expect(out.suggested).toBeUndefined();
    expect(out.reason).toMatch(/fix extraction/i);
  });

  it("says so when no confidence was reported at all", () => {
    const out = suggestThreshold([score(), score()]);
    expect(out.suggested).toBeUndefined();
    expect(out.reason).toMatch(/nothing to calibrate/i);
  });

  it("excludes a low-signal document from the clean floor", () => {
    // Without the exclusion the low-signal document would drag the floor down
    // to its own confidence and the threshold would collapse toward zero.
    const out = suggestThreshold([
      score({ confidence: 0.9 }),
      score({ confidence: 0.2, low_signal: true }),
    ]);
    expect(out.floor_clean).toBe(0.9);
  });

  it("excludes incorrect typed extraction from the clean population", () => {
    const wrong = scoreDocument(INVOICE, { ...INVOICE_RESULT, total: 10800 });
    const out = suggestThreshold([wrong, score({ confidence: 0.4, low_signal: true })]);
    expect(out.suggested).toBeUndefined();
    expect(out.floor_clean).toBeUndefined();
    expect(out.reason).toMatch(/fix extraction/i);
  });
});

describe("formatReport", () => {
  it("shows the failing fields and the suggestion", () => {
    const scores = [
      score({ file: "a.pdf", confidence: 0.9 }),
      score({ file: "b.pdf", fields_ok: false, missing: ["SIRET"], confidence: 0.7 }),
      score({ file: "c.pdf", low_signal: true, confidence: 0.3 }),
    ];
    const text = formatReport(scores, suggestThreshold(scores));
    expect(text).toContain("missing from OCR text: SIRET");
    expect(text).toContain("(low-signal by design)");
    expect(text).toMatch(/2\/3 documents clean/);
    // b.pdf lost a field, so the clean floor is a.pdf at 0.9; the low-signal
    // ceiling is 0.3; the midpoint is 0.6.
    expect(text).toMatch(/suggested 0\.6/);
  });

  it("labels unmeasured extraction and reports typed mismatches separately", () => {
    const scores = [
      score({ file: "no-truth.pdf" }),
      scoreDocument(INVOICE, { ...INVOICE_RESULT, total: "12960" }),
      scoreDocument(INVOICE, { file: INVOICE.file, error: "OCR unavailable" }),
    ];
    const text = formatReport(scores, suggestThreshold(scores));
    expect(text).toContain("OCR text");
    expect(text).toContain("extraction not measured: no typed-field ground truth");
    expect(text).toContain("extraction total: expected 12960, got \"12960\" (type)");
    expect(text).toContain("extraction not measured: tool/run error");
    expect(text).toContain("0/1 measured documents passed; 2 not measured");
    expect(text).toContain("1/3 documents clean on measured checks");
  });
});

describe("the committed corpus", () => {
  it("is declared synthetic and covers every document kind", () => {
    expect(manifest.synthetic).toBe(true);
    const kinds = new Set(manifest.documents.map((d) => d.expected_kind));
    expect(kinds).toEqual(new Set(["contract", "invoice", "id_document", "generic"]));
  });

  it("carries exactly one low-signal document to calibrate against", () => {
    const low = manifest.documents.filter((d) => d.low_signal);
    expect(low).toHaveLength(1);
    expect(low[0]!.file).toBe("scan-sparse.pdf");
  });

  it("states ground truth for every document", () => {
    for (const d of manifest.documents) {
      expect(d.must_contain.length, `${d.file} has no must_contain`).toBeGreaterThan(0);
      expect(d.page_count, `${d.file} has no page_count`).toBeGreaterThan(0);
      expect(d.notes, `${d.file} has no notes`).toBeTruthy();
    }
  });

  it("carries typed truth for both synthetic invoices", () => {
    const invoices = manifest.documents.filter((d) => d.expected_kind === "invoice");
    expect(invoices).toHaveLength(2);
    expect(invoices.map((d) => d.expected_fields)).toEqual([
      expect.objectContaining({ "vendor.name": "ACME SAS", total: 12960, currency: "EUR", due_date: "2026-09-11" }),
      expect.objectContaining({ "vendor.name": "Northwind Logistics Ltd", total: 2897, currency: "GBP", due_date: "2026-09-02" }),
    ]);
  });

  it("reproduces the committed truth from the generator without writing PDFs", () => {
    const generated = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { buildCorpus } from './test/fixtures/generate-corpus.mjs';
      process.stdout.write(JSON.stringify(buildCorpus().map(doc => ({
        file: doc.file, bytes: doc.bytes.length, ...doc.truth,
      }))));
    `], { cwd: process.cwd(), encoding: "utf8" });
    expect(JSON.parse(generated)).toEqual(manifest.documents);
  });

  it("keeps the bytes on disk consistent with the declared ground truth", () => {
    // Content streams are uncompressed on purpose, so the text the manifest
    // promises is greppable in the file. A manifest that has drifted from the
    // PDFs would make every eval result a lie.
    for (const d of manifest.documents) {
      const raw = readFileSync(
        resolve(process.cwd(), "test/fixtures/corpus", d.file),
        "latin1"
      );
      expect(raw.startsWith("%PDF-1.4"), `${d.file} is not a PDF`).toBe(true);
      const pages = (raw.match(/\/Type \/Page[^s]/g) ?? []).length;
      expect(pages, `${d.file} page count drifted`).toBe(d.page_count);
      for (const needle of d.must_contain) {
        expect(raw.includes(needle), `${d.file} does not contain ${needle}`).toBe(true);
      }
    }
  });
});

describe("runCorpus (mocked SDK, no API)", () => {
  function mockMistral() {
    const files = {
      upload: vi.fn(async () => ({ id: "eval-upload" })),
      delete: vi.fn(async () => ({ deleted: true })),
    };
    const ocr = { process: vi.fn(async () => ({ pages: [{
      index: 0,
      markdown: INVOICE_RESULT.ocr_text,
      confidenceScores: { averagePageConfidenceScore: 0.94 },
    }] })) };
    const chat = { complete: vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"kind":"invoice"}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({
        ...INVOICE_RESULT, total: 10800,
      }) } }] }) };
    return { files, ocr, client: { files, ocr, chat } as unknown as Mistral };
  }

  it.each([false, true])("cleans uploads even when the tool fails: %s", async (toolFails) => {
    const mock = mockMistral();
    if (toolFails) mock.ocr.process.mockRejectedValueOnce(new Error("OCR unavailable"));
    const [s] = await runCorpus({ documents: [INVOICE] },
      resolve(process.cwd(), "test/fixtures/corpus"), mock.client);
    expect(mock.files.delete).toHaveBeenCalledTimes(1);
    expect(mock.files.delete).toHaveBeenCalledWith({ fileId: "eval-upload" });
    expect(isClean(s!)).toBe(false);
    if (toolFails) {
      expect(s?.error).toContain("OCR unavailable");
      expect(s?.extraction_ok).toBeUndefined();
    } else {
      expect(s?.error).toBeUndefined();
      expect(s?.fields_ok).toBe(true);
      expect(s?.mismatches).toEqual([
        { path: "total", expected: 12960, actual: 10800, reason: "value" },
      ]);
    }
  });

  it.each([false, true])("reports cleanup failure without losing earlier evidence: %s", async (toolFails) => {
    const mock = mockMistral();
    if (toolFails) mock.ocr.process.mockRejectedValueOnce(new Error("OCR unavailable"));
    mock.files.delete.mockRejectedValueOnce(new Error("delete unavailable"));
    const scores = await runCorpus({ documents: [INVOICE] },
      resolve(process.cwd(), "test/fixtures/corpus"), mock.client);
    expect(scores[0]?.cleanup_error).toBe("delete unavailable");
    expect(isClean(scores[0]!)).toBe(false);
    if (toolFails) expect(scores[0]?.error).toContain("OCR unavailable");
    else expect(scores[0]?.mismatches?.[0]?.path).toBe("total");
    expect(formatReport(scores, suggestThreshold(scores))).toContain("upload cleanup error: delete unavailable");
  });
});
