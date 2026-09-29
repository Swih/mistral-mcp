import { describe, expect, it } from "vitest";
// @ts-expect-error TS7016: this runnable .mjs script has no declarations; allowJs is disabled.
import { classify } from "../../scripts/classify-ocr.mjs";

const CAPACITY_429 =
  'SDKError: API error occurred: Status 429\nBody: {"object":"error","message":"Rate limit exceeded","type":"rate_limited","param":null,"code":"1300","raw_status_code":429}';

function report(files: Array<{ status: string; message?: string; tests?: Array<{ status: string; messages?: string[] }> }>) {
  return {
    numTotalTests: files.reduce((n, f) => n + (f.tests?.length ?? 0), 0),
    testResults: files.map((f, i) => ({
      name: `test/live/file-${i}.test.ts`,
      status: f.status,
      message: f.message ?? "",
      assertionResults: (f.tests ?? []).map((t, j) => ({
        fullName: `test ${i}.${j}`,
        status: t.status,
        failureMessages: t.messages ?? [],
      })),
    })),
  };
}

describe("live OCR classification", () => {
  it("passes when every OCR test passes", () => {
    expect(classify(report([{ status: "passed", tests: [{ status: "passed" }] }])).outcome).toBe("passed");
  });

  it("reports the scheduled run of 2026-09-29 as provider capacity, not a failure", () => {
    const result = classify(report([
      { status: "failed", message: CAPACITY_429, tests: [{ status: "skipped" }] },
      { status: "failed", tests: [{ status: "failed", messages: [CAPACITY_429] }, { status: "failed", messages: [CAPACITY_429] }] },
    ]));
    expect(result.outcome).toBe("provider_unavailable");
    expect(result.failures).toHaveLength(3);
  });

  it.each([
    "[mistral-mcp:process_document] API quota limit is zero (HTTP 429). Check the account's configured limits.",
    "[mistral-mcp:process_document] Model not available on the Mistral free plan (HTTP 403 tier_not_allowed).",
  ])("treats classified capacity messages as provider refusals: %s", (text) => {
    expect(classify(report([{ status: "failed", tests: [{ status: "failed", messages: [text] }] }])).outcome)
      .toBe("provider_unavailable");
  });

  it("still fails when one failure is not a capacity refusal", () => {
    const result = classify(report([{ status: "failed", tests: [
      { status: "failed", messages: [CAPACITY_429] },
      { status: "failed", messages: ["AssertionError: expected 2 to be greater than 3"] },
    ] }]));
    expect(result.outcome).toBe("failed");
  });

  it("fails when every test was skipped", () => {
    expect(classify(report([{ status: "skipped", tests: [{ status: "skipped" }, { status: "skipped" }] }])).outcome)
      .toBe("failed");
  });

  it("fails on a suite error without a recognizable capacity refusal", () => {
    expect(classify(report([{ status: "failed", message: "TypeError: fetch failed" }])).outcome).toBe("failed");
  });
});
