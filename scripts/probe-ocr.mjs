// One provider request, no retries: distinguish a zero quota from test concurrency.
import { writeFileSync } from "node:fs";

if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is required");
const response = await fetch("https://api.mistral.ai/v1/ocr", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "mistral-ocr-latest", document: {
    type: "document_url", document_url: "https://arxiv.org/pdf/2410.07073",
  }, pages: [0] }),
  signal: AbortSignal.timeout(65000),
});
const body = await response.json();
const report = {
  timestamp: new Date().toISOString(), status: response.status,
  request_id: response.headers.get("x-kong-request-id"),
  requests_per_minute: response.headers.get("x-ratelimit-limit-req-minute"),
  remaining_requests: response.headers.get("x-ratelimit-remaining-req-minute"),
  retry_after: response.headers.get("retry-after"),
  model: response.ok ? body.model : undefined,
  pages: response.ok ? body.pages?.length : undefined,
  error_code: response.ok ? undefined : body.code,
  zero_quota: response.status === 429 && response.headers.get("x-ratelimit-limit-req-minute") === "0",
};
writeFileSync("ocr-probe.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!response.ok || !body.pages?.length) process.exitCode = 1;
