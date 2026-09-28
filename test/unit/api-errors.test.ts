import { describe, expect, it } from "vitest";
import { SDKError } from "@mistralai/mistralai/models/errors/sdkerror.js";
import { errorResult } from "../../src/shared.js";

const SECRET = "synthetic-api-key-do-not-echo";
const PRIVATE_INPUT = "synthetic private document content";
const BODY = JSON.stringify({ api_key: SECRET, prompt: PRIVATE_INPUT });

function apiError(status: number, headers: Record<string, string> = {}, body: string = BODY) {
  return new SDKError("API request failed", {
    request: new Request("https://api.invalid/v1/chat/completions", {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
    response: new Response(body, {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
    body,
  });
}

function message(error: unknown): string {
  const result = errorResult("mistral_chat", error);
  expect(result).toEqual({
    content: [{ type: "text", text: expect.stringMatching(/^\[mistral-mcp:mistral_chat\] /) }],
    isError: true,
  });
  return result.content[0].text;
}

describe("actionable API errors", () => {
  it("directs authentication failures to the key and endpoint", () => {
    const text = message(apiError(401));
    expect(text).toContain("HTTP 401");
    expect(text).toContain("MISTRAL_API_KEY");
    expect(text).toContain("endpoint");
  });

  it("directs forbidden requests to permissions and model access", () => {
    const text = message(apiError(403));
    expect(text).toContain("HTTP 403");
    expect(text).toContain("permissions");
    expect(text).toContain("requested model");
  });

  it("uses a numeric Retry-After for ordinary throttling", () => {
    const text = message(apiError(429, { "retry-after": "30" }));
    expect(text).toContain("Rate limit exceeded (HTTP 429)");
    expect(text).toContain("Retry after 30 seconds");
    expect(text).toContain("Reduce request frequency or size");
  });

  it("accepts and normalizes an HTTP-date Retry-After", () => {
    expect(message(apiError(429, { "retry-after": "Mon, 28 Sep 2026 12:00:00 GMT" })))
      .toContain("Retry after Mon, 28 Sep 2026 12:00:00 GMT");
  });

  it.each(["0", "000"])('accepts a zero-second Retry-After of "%s"', (value) => {
    expect(message(apiError(429, { "retry-after": value }))).toContain("Retry after 0 seconds");
  });

  it.each([
    "x-ratelimit-limit-tokens-minute",
    "x-ratelimit-limit-requests-day",
    "X-RateLimit-Limit",
    "ratelimit-limit",
  ])("recognizes a zero allowance from %s", (header) => {
    const text = message(apiError(429, { [header]: "0", "retry-after": "30" }));
    expect(text).toContain("API quota limit is zero (HTTP 429)");
    expect(text).toContain("configured limits");
    expect(text).not.toContain("Retry after 30 seconds");
  });

  it("does not confuse exhausted remaining capacity with a zero allowance", () => {
    const text = message(apiError(429, {
      "x-ratelimit-limit-tokens-minute": "1000",
      "x-ratelimit-remaining-tokens-minute": "0",
    }));
    expect(text).toContain("Rate limit exceeded");
    expect(text).not.toContain("quota limit is zero");
  });

  it("does not infer zero quota from malformed or unrelated headers or a raw body", () => {
    const error = Object.assign(new Error('Body: {"message":"quota is zero"}'), {
      statusCode: 429,
      rawResponse: new Response(null, {
        status: 429,
        headers: { "x-ratelimit-limit": "", "x-unrelated-limit": "0" },
      }),
    });
    expect(message(error)).toContain("Rate limit exceeded");
    expect(message(error)).not.toContain("quota limit is zero");
  });

  it.each([500, 502, 503, 504, 599])("offers retry guidance for HTTP %s", (status) => {
    const text = message(apiError(status, { "retry-after": "15" }));
    expect(text).toContain(`API server error (HTTP ${status})`);
    expect(text).toContain("Retry after 15 seconds");
    expect(text).toContain("service status");
  });

  it("uses rawResponse status when statusCode is missing", () => {
    const error = Object.assign(new Error(BODY), { rawResponse: new Response(BODY, { status: 403 }) });
    expect(message(error)).toContain("Access denied (HTTP 403)");
  });

  it("supports statusCode and Headers without a rawResponse", () => {
    expect(message({ statusCode: 429, headers: new Headers({ "retry-after": "12" }) }))
      .toContain("Retry after 12 seconds");
  });

  it.each([400, 404, 422])("offers request guidance for other HTTP failures (%s)", (status) => {
    const text = message(apiError(status));
    expect(text).toContain(`HTTP ${status}`);
    expect(text).toContain("request parameters");
  });
});

describe("OCR file readiness errors", () => {
  it.each([
    { type: "invalid_file", code: "1901", message: "Could not get file." },
    { code: "1901", message: "Could not get file." },
    { type: "invalid_file", message: "Could not get file" },
  ])("provides a stable marker only for a known 422 file-fetch failure", (body) => {
    const text = message(apiError(422, {}, JSON.stringify({ ...body, private_input: PRIVATE_INPUT, api_key: SECRET })));
    expect(text).toContain("OCR file not ready");
    expect(text).toContain("HTTP 422");
    expect(text).toContain("same file ID");
    expect(text).toContain("bounded number of attempts");
    expect(text).not.toContain(PRIVATE_INPUT);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Could not get file");
  });

  it.each([
    JSON.stringify({ code: "1901", message: "Invalid document" }),
    JSON.stringify({ type: "invalid_file", message: "Unsupported file format" }),
    JSON.stringify({ type: "other_error", code: "1902", message: "Could not get file." }),
    JSON.stringify({ message: "Could not get file." }),
    JSON.stringify({ type: "invalid_file", message: `Could not get file. ${PRIVATE_INPUT}` }),
    JSON.stringify({ code: "1901" }),
    "Could not get file.",
    "null",
    "{",
  ])("keeps unrelated or malformed 422 responses generic", (body) => {
    const text = message(apiError(422, {}, body));
    expect(text).toContain("API request or response failed (HTTP 422)");
    expect(text).not.toContain("OCR file not ready");
    expect(text).not.toContain(PRIVATE_INPUT);
  });

  it.each([400, 401, 403, 429, 500])("does not mark HTTP %s as a file-readiness failure", (status) => {
    const body = JSON.stringify({ type: "invalid_file", code: "1901", message: "Could not get file." });
    expect(message(apiError(status, {}, body))).not.toContain("OCR file not ready");
  });

  it("does not classify a local message as an OCR readiness error", () => {
    expect(message(new Error("Could not get file.")))
      .toBe("[mistral-mcp:mistral_chat] Could not get file.");
  });
});

describe("API error privacy", () => {
  it.each([200, 400, 401, 403, 404, 422, 429, 500, 503])(
    "does not forward the SDK message, raw body, or sensitive headers for HTTP %s",
    (status) => {
      const error = apiError(status, {
        "retry-after": SECRET,
        "x-request-id": SECRET,
        "x-ratelimit-limit": SECRET,
        "set-cookie": `session=${SECRET}`,
      });
      expect(error.message).toContain(BODY);
      const text = message(error);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(PRIVATE_INPUT);
      expect(text).not.toContain("Body:");
      expect(error.rawResponse.bodyUsed).toBe(false);
    }
  );

  it.each(["-1", "1.5", "Infinity", "9007199254740992", "Mon, 99 Sep 2026 12:00:00 GMT"])(
    "does not reflect invalid Retry-After values (%s)",
    (value) => {
      const text = message(apiError(429, { "retry-after": value }));
      expect(text).toContain("Wait before retrying");
      expect(text).not.toContain(value);
    }
  );

  it("does not echo an HTTP body even when status metadata is malformed", () => {
    expect(message(Object.assign(new Error(BODY), { statusCode: SECRET, body: BODY })))
      .toBe("[mistral-mcp:mistral_chat] API request or response failed. Check the request parameters, model availability, and endpoint compatibility.");
  });

  it.each([
    new Error("OCR confidence is unavailable; use mistral_ocr for raw OCR."),
    "Cached OCR confidence is below the requested minimum. Use cache=bypass.",
    new Error("rate_limit_exceeded"),
  ])("preserves local diagnostics without HTTP metadata", (error) => {
    const diagnostic = error instanceof Error ? error.message : error;
    expect(message(error)).toBe(`[mistral-mcp:mistral_chat] ${diagnostic}`);
  });
});
