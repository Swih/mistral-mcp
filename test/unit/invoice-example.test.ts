import { mkdtemp, readFile, rm, truncate, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { config } from "dotenv";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";
// @ts-expect-error TS7016: this runnable .mjs example has no declarations; allowJs is disabled.
import { main } from "../../examples/invoice.mjs";

const PDF = Buffer.from("%PDF-1.7\nSynthetic invoice bytes for offline tests.\n%%EOF\n");
const INVOICE = {
  kind: "invoice", source_id: "synthetic-source", ocr_text: "Synthetic invoice",
  ocr_confidence: 0.95, page_count: 1, total_duration_ms: 20,
  cache_hit: false, pipeline_version: "unit-test",
  vendor: { name: "Invented vendor" }, total: 12, currency: "EUR",
  line_items: [{ desc: "Invented item", qty: 1, unit_price: 12, amount: 12 }],
  due_date: null, anomalies: [],
};
const RESULT = { content: [{ type: "text", text: "Synthetic result" }], structuredContent: INVOICE };
const NOT_READY = { type: "invalid_file", code: "1901", message: "Could not get file." };
function toolError(text: string) {
  return { isError: true, content: [{ type: "text", text }] };
}
const NOT_READY_RESULT = toolError("[mistral-mcp:process_document] OCR file not ready (HTTP 422). Retry the uploaded file.");

function apiError(statusCode: number, body: unknown = NOT_READY) {
  return Object.assign(new Error("SECRET_KEY and PRIVATE_DOCUMENT must not appear in logs"), {
    statusCode, body: JSON.stringify(body),
  });
}

function harness(env: NodeJS.ProcessEnv = { MISTRAL_API_KEY: "unit-key" }) {
  const sdk = {
    files: {
      upload: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({ id: "unit-file" }),
      delete: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({ deleted: true }),
    },
  };
  const client = {
    connect: vi.fn<(transport: unknown) => Promise<void>>().mockResolvedValue(undefined),
    callTool: vi.fn<(request: unknown, options: unknown) => Promise<unknown>>().mockResolvedValue(RESULT),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const transport = { close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
  const dependencies = {
    env,
    loadEnv: vi.fn<(options: Parameters<typeof config>[0]) => void>(),
    createMistral: vi.fn<(options: Record<string, unknown>) => typeof sdk>().mockReturnValue(sdk),
    createClient: vi.fn().mockReturnValue(client),
    createTransport: vi.fn<(options: Record<string, unknown>) => typeof transport>().mockReturnValue(transport),
    pause: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  };
  return { sdk, client, transport, dependencies,
    run: (args: string[]): Promise<void> => main(args, dependencies),
    output: () => dependencies.stdout.mock.calls.map(([text]) => text).join(""),
    logs: () => dependencies.stderr.mock.calls.map(([text]) => text).join(""),
  };
}

describe("invoice CLI example (offline)", () => {
  let dir: string;
  let input: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mistral-invoice-example-"));
    input = join(dir, "user invoice.pdf");
    await writeFile(input, PDF);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network is forbidden in this suite"));
  });
  afterEach(async () => {
    const networkCalls = vi.mocked(globalThis.fetch).mock.calls.length;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
    expect(networkCalls).toBe(0);
  });

  it("uploads typed bytes with the shared policy, uses core MCP by ID, validates JSON and cleans up", async () => {
    const h = harness({ MISTRAL_API_KEY: "unit-key", MISTRAL_MCP_PROFILE: "admin",
      MCP_TRANSPORT: "http", MISTRAL_DEBUG: "true", MISTRAL_DEFAULT_MODEL: "configured-model" });
    await h.run([input]);
    expect(h.dependencies.loadEnv).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
    expect(h.dependencies.createMistral).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "unit-key", serverURL: "https://api.mistral.ai",
      retryConfig: MISTRAL_RETRY_CONFIG, timeoutMs: MISTRAL_TIMEOUT_MS,
      debugLogger: expect.objectContaining({ log: expect.any(Function) }),
    }));
    const upload = h.sdk.files.upload.mock.calls[0][0] as {
      file: { fileName: string; content: Blob }; purpose: string; visibility: string;
    };
    expect(upload).toMatchObject({ file: { fileName: "user invoice.pdf" }, purpose: "ocr", visibility: "user" });
    expect(upload.file.content.type).toBe("application/pdf");
    expect(Buffer.from(await upload.file.content.arrayBuffer())).toEqual(PDF);
    const transportOptions = h.dependencies.createTransport.mock.calls[0][0];
    expect(transportOptions).toMatchObject({ command: process.execPath, stderr: "ignore",
      env: { MISTRAL_MCP_PROFILE: "core", MISTRAL_BASE_URL: "https://api.mistral.ai",
        MISTRAL_API_KEY: "unit-key", MISTRAL_DEFAULT_MODEL: "configured-model" } });
    expect(transportOptions.env).not.toHaveProperty("MISTRAL_DEBUG");
    expect(transportOptions.env).not.toHaveProperty("MCP_TRANSPORT");
    expect(h.client.callTool).toHaveBeenCalledOnce();
    expect(h.dependencies.pause).not.toHaveBeenCalled();
    expect(h.client.callTool).toHaveBeenCalledWith({ name: "process_document", arguments: {
      source: { type: "file_id", fileId: "unit-file" }, kind: "invoice", options: { cache: "bypass" },
    } }, { timeout: 240_000 });
    expect(JSON.parse(h.output())).toEqual(INVOICE);
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
    expect(h.sdk.files.delete).toHaveBeenCalledWith({ fileId: "unit-file" });
    expect(h.client.close).toHaveBeenCalledOnce();
    expect(h.transport.close).toHaveBeenCalledOnce();
    expect(h.logs()).not.toContain(PDF.toString());
  });

  it("quietly loads a provided .env without mutating the caller's environment", async () => {
    const h = harness({});
    const envPath = join(dir, ".env");
    await writeFile(envPath, "MISTRAL_API_KEY=from-dotenv\n");
    h.dependencies.loadEnv.mockImplementation((options) => { config({ ...options, path: envPath }); });
    await h.run([input]);
    expect(h.dependencies.env).toEqual({});
    expect(h.dependencies.createMistral).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "from-dotenv" }));
    expect(JSON.parse(h.output())).toEqual(INVOICE);
  });

  it.each([
    [".PNG", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [".jpg", Buffer.from([255, 216, 255, 224]), "image/jpeg"],
    [".jpeg", Buffer.from([255, 216, 255, 224]), "image/jpeg"],
    [".webp", Buffer.from("RIFFxxxxWEBPVP8 "), "image/webp"],
  ])("accepts matching %s image signatures", async (extension, bytes, mime) => {
    const path = join(dir, `image${extension}`);
    await writeFile(path, bytes);
    const h = harness();
    await h.run([path]);
    expect(h.sdk.files.upload).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ content: expect.objectContaining({ type: mime }) }),
    }));
  });

  it.each([[], ["--help"], ["one.pdf", "extra"], ["one.pdf", "--output"],
    ["one.pdf", "--unknown", "result.json"], ["one.pdf", "--output", "-x"],
    ["one.pdf", "--output", "result.json", "extra"]])("rejects invalid arguments %j before any provider work", async (...args) => {
    const h = harness();
    await expect(h.run(args)).rejects.toThrow("Usage:");
    expect(h.dependencies.createMistral).not.toHaveBeenCalled();
  });

  it.each(["missing", "directory", "empty", "large", "unsupported", "mismatched", "url"])(
    "rejects %s input without upload or output creation", async (kind) => {
      let path = input;
      if (kind === "missing") path = join(dir, "missing.pdf");
      if (kind === "directory") { path = join(dir, "folder.pdf"); await mkdir(path); }
      if (kind === "empty") await writeFile(path, "");
      if (kind === "large") await truncate(path, 20 * 1024 * 1024 + 1);
      if (kind === "unsupported") { path = join(dir, "invoice.txt"); await writeFile(path, PDF); }
      if (kind === "mismatched") await writeFile(path, "not a PDF");
      if (kind === "url") path = "https://example.invalid/invoice.pdf";
      const output = join(dir, "result.json");
      const h = harness();
      await expect(h.run([path, "--output", output])).rejects.toThrow();
      expect(h.dependencies.createMistral).not.toHaveBeenCalled();
      expect(h.sdk.files.upload).not.toHaveBeenCalled();
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    });

  it("accepts the inclusive 20 MiB limit", async () => {
    await truncate(input, 20 * 1024 * 1024);
    const h = harness();
    await h.run([input]);
    expect(h.sdk.files.upload).toHaveBeenCalledOnce();
  });

  it.each([{}, { MISTRAL_API_KEY: "unit-key", MISTRAL_BASE_URL: "http://local.invalid:8000" },
    { MISTRAL_API_KEY: "unit-key", MISTRAL_BASE_URL: "https://api.mistral.ai.evil.invalid" }])(
    "rejects missing credentials or custom endpoints without provider work", async (env) => {
      const h = harness(env);
      await expect(h.run([input])).rejects.toThrow();
      expect(h.dependencies.createMistral).not.toHaveBeenCalled();
    });

  it("honours the explicit Cloud URL in both clients", async () => {
    const h = harness({ MISTRAL_API_KEY: "unit-key", MISTRAL_BASE_URL: " https://api.mistral.ai/ " });
    await h.run([input]);
    expect(h.dependencies.createMistral).toHaveBeenCalledWith(expect.objectContaining({ serverURL: "https://api.mistral.ai" }));
  });

  it("reserves a new output before upload and emits only its save destination", async () => {
    const h = harness();
    const output = join(dir, "result.json");
    h.sdk.files.upload.mockImplementation(async () => {
      expect(await readFile(output, "utf8")).toBe("");
      return { id: "unit-file" };
    });
    await h.run([input, "--output", output]);
    expect(isAbsolute(h.output().trim())).toBe(true);
    expect(h.output()).toBe(`${output}\n`);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(INVOICE);
  });

  it.each(["existing", "input", "missing-parent", "directory"])("never overwrites a %s destination", async (kind) => {
    let output = join(dir, "result.json");
    if (kind === "existing") await writeFile(output, "keep this");
    if (kind === "input") output = input;
    if (kind === "missing-parent") output = join(dir, "missing", "result.json");
    if (kind === "directory") output = dir;
    const h = harness();
    await expect(h.run([input, "--output", output])).rejects.toThrow("exclusively");
    expect(h.sdk.files.upload).not.toHaveBeenCalled();
    expect(await readFile(input)).toEqual(PDF);
    if (kind === "existing") expect(await readFile(output, "utf8")).toBe("keep this");
  });

  it("retries only the safe OCR file-not-ready response and stops at four attempts", async () => {
    const h = harness();
    h.client.callTool.mockResolvedValue(NOT_READY_RESULT);
    await expect(h.run([input])).rejects.toThrow("The uploaded file is not ready for OCR");
    expect(h.client.callTool).toHaveBeenCalledTimes(4);
    expect(h.dependencies.pause.mock.calls).toEqual([[1000], [2000], [4000]]);
    expect(h.sdk.files.upload).toHaveBeenCalledOnce();
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
  });

  it("continues after an eventually ready file without repeating the upload", async () => {
    const h = harness();
    h.client.callTool.mockResolvedValueOnce(NOT_READY_RESULT).mockResolvedValueOnce(NOT_READY_RESULT);
    await h.run([input]);
    expect(h.sdk.files.upload).toHaveBeenCalledOnce();
    expect(h.client.callTool).toHaveBeenCalledTimes(3);
    expect(h.client.callTool.mock.calls.every(([request]) => JSON.stringify(request) === JSON.stringify(h.client.callTool.mock.calls[0][0]))).toBe(true);
    expect(JSON.parse(h.output())).toEqual(INVOICE);
  });

  it.each([
    apiError(429), apiError(401), apiError(503), apiError(422), apiError(422, { ...NOT_READY, code: "other" }),
    apiError(422, { ...NOT_READY, code: 1901 }), apiError(422, { ...NOT_READY, message: "Other error" }),
    apiError(422, { ...NOT_READY, type: "other" }),
    Object.assign(new Error("unparseable"), { statusCode: 422, body: "not JSON" }),
    new Error("Could not get file."),
  ])("does not retry thrown errors, even raw readiness bodies ($statusCode)", async (error) => {
    const h = harness();
    h.client.callTool.mockRejectedValue(error);
    await expect(h.run([input])).rejects.toHaveProperty("cause", error);
    expect(h.client.callTool).toHaveBeenCalledOnce();
    expect(h.dependencies.pause).not.toHaveBeenCalled();
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
    expect(h.logs()).not.toMatch(/SECRET_KEY|PRIVATE_DOCUMENT/);
    expect(h.output()).toBe("");
  });

  it.each([
    "[mistral-mcp:process_document] API request or response failed (HTTP 422).",
    "[mistral-mcp:process_document] Rate limit exceeded (HTTP 429). OCR file not ready",
    "[mistral-mcp:process_document] Could not get file.",
    "[mistral-mcp:process_document] OCR file not readyish",
    "[mistral-mcp:process_document] PRIVATE_DOCUMENT contains OCR file not ready",
    "[mistral-mcp:other_tool] OCR file not ready",
    JSON.stringify(NOT_READY),
  ])("does not retry unclassified tool text: %s", async (text) => {
    const h = harness();
    h.client.callTool.mockResolvedValue(toolError(text));
    await expect(h.run([input])).rejects.toThrow("process_document failed");
    expect(h.client.callTool).toHaveBeenCalledOnce();
    expect(h.dependencies.pause).not.toHaveBeenCalled();
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
  });

  it.each([
    ["Authentication failed (HTTP 401).", "Check MISTRAL_API_KEY"],
    ["Access denied (HTTP 403).", "permissions and model access"],
    ["API quota limit is zero (HTTP 429).", "quota limit is zero"],
    ["Rate limit exceeded (HTTP 429).", "Rate limit reached"],
  ])("reports the whitelisted %s diagnostic without echoing provider details", async (marker, advice) => {
    const h = harness();
    h.client.callTool.mockResolvedValue(toolError(`[mistral-mcp:process_document] ${marker} SECRET_KEY PRIVATE_DOCUMENT`));
    const failure = await h.run([input]).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining(advice) });
    expect(failure).toMatchObject({ message: expect.not.stringMatching(/SECRET_KEY|PRIVATE_DOCUMENT/) });
    expect(h.dependencies.pause).not.toHaveBeenCalled();
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
  });

  it("stops retrying if a readiness failure is followed by a rate limit", async () => {
    const h = harness();
    h.client.callTool.mockResolvedValueOnce(NOT_READY_RESULT)
      .mockResolvedValueOnce(toolError("[mistral-mcp:process_document] Rate limit exceeded (HTTP 429)."));
    await expect(h.run([input])).rejects.toThrow("Rate limit reached");
    expect(h.client.callTool).toHaveBeenCalledTimes(2);
    expect(h.dependencies.pause.mock.calls).toEqual([[1000]]);
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
  });

  it.each([
    { isError: true, content: [{ type: "text", text: "SECRET_KEY PRIVATE_DOCUMENT" }] },
    { content: [{ type: "text", text: JSON.stringify(INVOICE) }] },
    { structuredContent: { ...INVOICE, total: "twelve" } },
    { structuredContent: { ...INVOICE, line_items: [{ qty: "one" }] } },
    { structuredContent: { ...INVOICE, ocr_confidence: 2 } },
    { structuredContent: { ...INVOICE, kind: "generic", structured_text: "Synthetic" } },
  ])("rejects tool errors and invalid invoice results, then deletes the upload", async (response) => {
    const h = harness();
    const output = join(dir, "result.json");
    h.client.callTool.mockResolvedValue(response);
    await expect(h.run([input, "--output", output])).rejects.toThrow(/process_document/);
    expect(h.sdk.files.delete).toHaveBeenCalledOnce();
    expect(h.client.close).toHaveBeenCalledOnce();
    expect(h.output()).toBe("");
    expect(await readFile(output, "utf8")).toBe("");
    expect(h.logs()).toContain("reserved output");
    expect(h.logs()).not.toMatch(/SECRET_KEY|PRIVATE_DOCUMENT/);
  });

  it("closes failed MCP connections without uploading", async () => {
    const h = harness();
    h.client.connect.mockRejectedValue(new Error("SECRET_KEY"));
    await expect(h.run([input])).rejects.toThrow("MCP connection failed");
    expect(h.sdk.files.upload).not.toHaveBeenCalled();
    expect(h.client.close).toHaveBeenCalledOnce();
    expect(h.transport.close).toHaveBeenCalledOnce();
  });

  it("handles upload failure without attempting deletion of an unknown file", async () => {
    const h = harness();
    h.sdk.files.upload.mockRejectedValue(apiError(429));
    await expect(h.run([input])).rejects.toThrow("check your account allowance");
    expect(h.sdk.files.delete).not.toHaveBeenCalled();
    expect(h.dependencies.pause).not.toHaveBeenCalled();
    expect(h.client.close).toHaveBeenCalledOnce();
  });

  it("preserves the extraction failure when deletion and shutdown also fail", async () => {
    const h = harness();
    const original = apiError(401);
    h.client.callTool.mockRejectedValue(original);
    h.sdk.files.delete.mockRejectedValue(apiError(503));
    h.client.close.mockRejectedValue(new Error("SECRET_KEY"));
    const failure = await h.run([input]).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringContaining("Invoice extraction failed"), cause: original });
    expect(h.logs()).toContain("Delete the recent OCR upload");
    expect(h.logs()).toContain("MCP shutdown failed");
    expect(h.logs()).not.toMatch(/SECRET_KEY|PRIVATE_DOCUMENT/);
    expect(h.transport.close).toHaveBeenCalledOnce();
  });

  it.each(["throw", "unconfirmed"])("retains valid stdout JSON and fails actionably if deletion is %s", async (mode) => {
    const h = harness();
    if (mode === "throw") h.sdk.files.delete.mockRejectedValue(apiError(503));
    else h.sdk.files.delete.mockResolvedValue({ deleted: false });
    await expect(h.run([input])).rejects.toThrow("Uploaded-file cleanup failed");
    expect(JSON.parse(h.output())).toEqual(INVOICE);
    expect(h.logs()).toContain("Delete the recent OCR upload");
    expect(h.client.close).toHaveBeenCalledOnce();
  });

  it("saves the valid extraction even when remote cleanup fails", async () => {
    const h = harness();
    const output = join(dir, "result.json");
    h.sdk.files.delete.mockRejectedValue(apiError(503));
    await expect(h.run([input, "--output", output])).rejects.toThrow("Uploaded-file cleanup failed");
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(INVOICE);
    expect(h.output()).toBe(`${output}\n`);
    expect(h.logs()).toContain("Delete the recent OCR upload");
    expect(h.logs()).not.toContain("No complete extraction was saved");
  });
});
