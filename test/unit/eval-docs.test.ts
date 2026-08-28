/**
 * Tests for the document eval harness's scoring and calibration.
 *
 * The threshold logic is the part that matters: it is what replaces a default
 * nobody could reproduce. It is tested here against synthetic runs so the
 * reasoning is checked without an API key — the live run only supplies numbers.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isClean,
  scoreDocument,
  suggestThreshold,
  formatReport,
  type CorpusDocument,
  type CorpusManifest,
  type DocumentScore,
} from "../../scripts/eval-docs.js";

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
});

describe("the committed corpus", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "test/fixtures/corpus.json"), "utf8")
  ) as CorpusManifest & { synthetic: boolean };

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
