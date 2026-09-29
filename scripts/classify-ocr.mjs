/**
 * Classifies the isolated live OCR run from a vitest JSON report.
 *
 * Mistral support states that the free plan serves OCR only when capacity
 * allows: a 429 there means "no capacity now", not a fault in this server.
 * Such refusals become a visible warning and job-summary entry; any other
 * failure, or a missing report, still fails the job.
 *
 *   node scripts/classify-ocr.mjs ocr-results.json
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const PROVIDER_CAPACITY = [
  /Status 429[\s\S]*"type"\s*:\s*"rate_limited"/,
  /"code"\s*:\s*"1300"/,
  /tier_not_allowed/,
  /API quota limit is zero \(HTTP 429\)/,
  /Rate limit exceeded \(HTTP 429\)/,
];

export function isProviderCapacity(message) {
  return PROVIDER_CAPACITY.some((pattern) => pattern.test(message));
}

/** Returns { outcome: "passed" | "provider_unavailable" | "failed", failures, total } — total counts passed tests. */
export function classify(report) {
  const failures = [];
  for (const file of report.testResults ?? []) {
    const failedTests = (file.assertionResults ?? []).filter((t) => t.status === "failed");
    for (const test of failedTests) {
      failures.push({ name: test.fullName ?? test.title ?? file.name, message: (test.failureMessages ?? []).join("\n") });
    }
    // Suite-level errors (e.g. a failing beforeAll) carry no failed assertion.
    if (file.status === "failed" && failedTests.length === 0) {
      failures.push({ name: file.name, message: file.message ?? "" });
    }
  }
  const total = (report.testResults ?? [])
    .flatMap((file) => file.assertionResults ?? [])
    .filter((t) => t.status === "passed").length;
  // All-skipped is not a pass: nothing reached Mistral.
  if (failures.length === 0 && total === 0) {
    return { outcome: "failed", failures: [{ name: "live OCR", message: "No OCR test ran; all were skipped." }], total };
  }
  if (failures.length === 0) return { outcome: "passed", failures, total };
  const outcome = failures.every((f) => isProviderCapacity(f.message)) ? "provider_unavailable" : "failed";
  return { outcome, failures, total };
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = process.argv[2] ?? "ocr-results.json";
  if (!existsSync(path)) {
    console.error(`::error title=Live OCR::No report at ${path}; the OCR tests did not run.`);
    process.exit(1);
  }
  const { outcome, failures, total } = classify(JSON.parse(readFileSync(path, "utf8")));
  if (outcome === "passed") {
    summary(`### Live OCR\n\nAll ${total} OCR tests ran against Mistral and passed.`);
    console.log(`Live OCR: ${total} tests passed.`);
  } else if (outcome === "provider_unavailable") {
    const note = `Mistral refused OCR for lack of free-plan capacity (${failures.length} failure(s), all HTTP 429/403 capacity responses). OCR is NOT validated by this run; the server code is not at fault.`;
    console.log(`::warning title=Live OCR not validated::${note}`);
    summary(`### Live OCR — not validated\n\n${note}\n\n${failures.map((f) => `- ${f.name}`).join("\n")}`);
  } else {
    for (const f of failures.filter((x) => !isProviderCapacity(x.message))) {
      console.error(`::error title=Live OCR failure::${f.name}`);
      console.error(f.message);
    }
    summary("### Live OCR — failed\n\nAt least one OCR failure is not a provider capacity refusal.");
    process.exit(1);
  }
}
