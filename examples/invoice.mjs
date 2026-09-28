import { open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { config as loadEnv } from "dotenv";
import { Mistral } from "@mistralai/mistralai";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const CLOUD = "https://api.mistral.ai";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const USAGE = "Usage: node examples/invoice.mjs <local PDF/image/text/Markdown> [--output result.json]";
const MIME_TYPES = new Map([
  [".pdf", "application/pdf"], [".png", "image/png"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".txt", "text/plain"], [".md", "text/markdown"],
]);

class InvoiceExampleError extends Error {}

function parseArgs(args) {
  if ((args.length !== 1 && args.length !== 3) || !args[0] || args[0].startsWith("-") ||
      (args.length === 3 && (args[1] !== "--output" || !args[2] || args[2].startsWith("-")))) {
    throw new InvoiceExampleError(USAGE);
  }
  return { input: resolve(args[0]), output: args[2] ? resolve(args[2]) : undefined };
}

function matchesSignature(bytes, mime) {
  switch (mime) {
    case "application/pdf": return /^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString("ascii"));
    case "image/png": return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg": return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    case "image/webp": return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
    default: return false;
  }
}

async function readInput(path) {
  const mime = MIME_TYPES.get(extname(path).toLowerCase());
  if (!mime) throw new InvoiceExampleError("Choose a local .pdf, .png, .jpg, .jpeg, .webp, .txt or .md file.");
  const isText = mime.startsWith("text/");
  // Zod counts UTF-16 code units: each needs at most three UTF-8 bytes, plus a BOM.
  const maxBytes = isText ? MAX_TEXT_CHARS * 3 + 3 : MAX_BYTES;
  const sizeAdvice = isText
    ? `Choose nonempty UTF-8 text of at most ${MAX_TEXT_CHARS} characters.`
    : "Choose a nonempty regular file of at most 20 MiB.";
  const check = (info) => {
    if (!info.isFile()) throw new InvoiceExampleError("Choose a regular file.");
    if (info.size === 0 || info.size > maxBytes) throw new InvoiceExampleError(sizeAdvice);
  };
  check(await stat(path));
  const handle = await open(path, "r");
  try {
    check(await handle.stat());
    const chunks = [];
    let size = 0;
    // Bound reads too: the file can grow after stat().
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maxBytes) throw new InvoiceExampleError(sizeAdvice);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (isText) {
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new InvoiceExampleError("Text and Markdown files must use valid UTF-8. Export as UTF-8 and try again.");
      }
      if (!text.trim() || text.length > MAX_TEXT_CHARS) throw new InvoiceExampleError(sizeAdvice);
      return { text };
    }
    if (!matchesSignature(bytes, mime)) {
      throw new InvoiceExampleError("The file signature does not match its extension. Export a valid PDF, PNG, JPEG or WebP and try again.");
    }
    return { bytes, mime };
  } finally {
    await handle.close();
  }
}

function toolDiagnostic(response) {
  if (response?.isError !== true || !Array.isArray(response.content)) return undefined;
  const prefix = "[mistral-mcp:process_document] ";
  const messages = response.content.filter((block) => block?.type === "text" &&
    typeof block.text === "string" && block.text.startsWith(prefix)).map((block) => block.text.slice(prefix.length));
  const known = [
    ["OCR file not ready", "The uploaded file is not ready for OCR. Try again later."],
    ["Authentication failed (HTTP 401).", "Check MISTRAL_API_KEY and the configured account."],
    ["Access denied (HTTP 403).", "Check the API key's permissions and model access."],
    ["API quota limit is zero (HTTP 429).", "The API quota limit is zero. Check account limits and model access; waiting alone may not help."],
    ["Rate limit exceeded (HTTP 429).", "Rate limit reached. Wait and check account quota before retrying."],
  ];
  for (const [marker, advice] of known) {
    if (messages.some((message) => message === marker || message.startsWith(`${marker} `) || message.startsWith(`${marker}.`))) {
      return { marker, advice };
    }
  }
  return undefined;
}

async function extractInvoice(client, source, pause, log) {
  // Only the server's sanitized, classified OCR 422 permits a retry. No raw
  // provider bodies are parsed here, and a successful call needs no OCR probe.
  for (let attempt = 0; ; attempt++) {
    // OCR and extraction each have their own SDK timeout and retry budget.
    const response = await client.callTool({ name: "process_document", arguments: {
      source, kind: "invoice", options: { cache: "bypass" },
    } }, { timeout: 240_000 });
    if (!response.isError) return response;
    const diagnostic = toolDiagnostic(response);
    if (source.type !== "file_id" || attempt === 3 || diagnostic?.marker !== "OCR file not ready") {
      const advice = source.type === "text" && (!diagnostic || diagnostic.marker === "OCR file not ready")
        ? "Check the supplied text and account/model access."
        : diagnostic?.advice ?? "Check document readability, OCR confidence and account/model access.";
      throw new InvoiceExampleError(`process_document failed. ${advice} No extraction was saved; provider details are withheld to protect document data.`);
    }
    log(`OCR file not ready; retry ${attempt + 1}/3.\n`);
    await pause(1000 * 2 ** attempt);
  }
}

function safeFailure(stage, error) {
  if (error instanceof InvoiceExampleError) return error;
  const status = error?.statusCode;
  const advice = status === 401 || status === 403
    ? "Check MISTRAL_API_KEY and your account's Files/OCR/model access."
    : status === 429
      ? "Rate or quota limit reached; check your account allowance before trying again."
      : status === 422
        ? "The provider rejected the document; check its format and try again later if it was just uploaded."
        : "Check the local build, file permissions, network and your Mistral account's Files/OCR/model access.";
  // SDK/MCP errors can embed document text, credentials and response bodies.
  return new InvoiceExampleError(`${stage} failed. ${advice}`, { cause: error });
}

async function loadBuild() {
  try {
    const [shared, docs] = await Promise.all([
      import("../dist/shared.js"), import("../dist/tools-docs.js"),
    ]);
    await stat(new URL("../dist/index.js", import.meta.url));
    return { MISTRAL_RETRY_CONFIG: shared.MISTRAL_RETRY_CONFIG,
      MISTRAL_TIMEOUT_MS: shared.MISTRAL_TIMEOUT_MS,
      ProcessDocumentOutputSchema: docs.ProcessDocumentOutputSchema };
  } catch {
    throw new InvoiceExampleError("The local build is unavailable. Run npm ci and npm run build from the repository root.");
  }
}

/** Run with injectable SDK/MCP factories and streams for offline unit tests. */
export async function main(args = process.argv.slice(2), dependencies = {}) {
  const env = { ...(dependencies.env ?? process.env) };
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const pause = dependencies.pause ?? delay;
  const createMistral = dependencies.createMistral ?? ((options) => new Mistral(options));
  const createClient = dependencies.createClient ?? (() => new Client({ name: "invoice-example", version: "1" }));
  const createTransport = dependencies.createTransport ?? ((options) => new StdioClientTransport(options));
  let stage = "Local validation";
  let outputHandle;
  let sdk;
  let client;
  let transport;
  let fileId;
  let failure;
  let result;
  let output;
  try {
    (dependencies.loadEnv ?? loadEnv)({ quiet: true, processEnv: env });
    const paths = parseArgs(args);
    output = paths.output;
    if (env.MISTRAL_BASE_URL?.trim() && env.MISTRAL_BASE_URL.trim().replace(/\/+$/, "") !== CLOUD) {
      throw new InvoiceExampleError("This example is Mistral Cloud only. MISTRAL_BASE_URL points elsewhere; no upload was made. Use a workflow configured for your endpoint, or explicitly choose Cloud before running this example.");
    }
    const apiKey = env.MISTRAL_API_KEY?.trim();
    if (!apiKey) throw new InvoiceExampleError("Set MISTRAL_API_KEY in your environment or .env. This example makes real Cloud API calls; check your account allowance first.");
    const input = await readInput(paths.input);
    if (output) {
      try {
        // Reserve before provider calls; an existing path (including a symlink)
        // must fail atomically, and only this handle will receive the result.
        outputHandle = await open(output, "wx", 0o600);
      } catch {
        throw new InvoiceExampleError("Cannot create --output exclusively. Choose a new filename in an existing writable directory; existing files are never overwritten.");
      }
    }
    const { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS, ProcessDocumentOutputSchema } = await loadBuild();
    client = createClient();
    // Pass only the provider settings needed here. Inherited HTTP, debug and
    // profile overrides must not change this local core/stdio workflow.
    transport = createTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
      env: { MISTRAL_API_KEY: apiKey, MISTRAL_BASE_URL: CLOUD, MISTRAL_MCP_PROFILE: "core",
        ...(env.MISTRAL_DEFAULT_MODEL ? { MISTRAL_DEFAULT_MODEL: env.MISTRAL_DEFAULT_MODEL } : {}) },
      stderr: "ignore",
    });
    stage = "MCP connection";
    await client.connect(transport);
    let source;
    if (input.text !== undefined) {
      stderr("Sending the supplied invoice text to Mistral Cloud for typed extraction; API usage may be billed under your existing account.\n");
      source = { type: "text", text: input.text };
    } else {
      stderr("Uploading the supplied invoice to Mistral Cloud; API usage may be billed under your existing account.\n");
      stage = "Upload";
      sdk = createMistral({
        apiKey, serverURL: CLOUD, retryConfig: MISTRAL_RETRY_CONFIG, timeoutMs: MISTRAL_TIMEOUT_MS,
        debugLogger: { group() {}, groupEnd() {}, log() {} },
      });
      const uploaded = await sdk.files.upload({
        file: { fileName: basename(paths.input), content: new Blob([input.bytes], { type: input.mime }) },
        purpose: "ocr", visibility: "user",
      });
      if (typeof uploaded?.id !== "string" || !uploaded.id.trim()) {
        throw new InvoiceExampleError("Upload returned no file ID. Check recent files in your Mistral account and delete the upload if present.");
      }
      fileId = uploaded.id;
      source = { type: "file_id", fileId };
    }
    stderr("Extracting invoice fields through process_document (core profile, cache bypass).\n");
    stage = "Invoice extraction";
    const response = await extractInvoice(client, source, pause, stderr);
    const parsed = ProcessDocumentOutputSchema.safeParse(response.structuredContent);
    if (!parsed.success || parsed.data.kind !== "invoice") {
      throw new InvoiceExampleError("process_document returned an invalid invoice result. Rebuild the server with npm run build and check its version; no result was saved.");
    }
    result = parsed.data;
  } catch (error) {
    failure = safeFailure(stage, error);
  } finally {
    if (fileId) {
      try {
        const deleted = await sdk.files.delete({ fileId });
        if (deleted?.deleted !== true) throw new Error("Deletion was not confirmed.");
      } catch (error) {
        stderr("Uploaded-file cleanup failed. Delete the recent OCR upload from your Mistral account.\n");
        failure ??= safeFailure("Uploaded-file cleanup", error);
      }
    }
    for (const connection of [client, transport]) {
      if (!connection) continue;
      try {
        await connection.close();
      } catch (error) {
        stderr("MCP shutdown failed; check for a remaining local server process.\n");
        failure ??= safeFailure("MCP shutdown", error);
      }
    }
  }
  try {
    if (failure && !result) throw failure;
    const json = JSON.stringify(result, null, 2) + "\n";
    if (outputHandle) {
      await outputHandle.writeFile(json, "utf8");
      await outputHandle.close();
      outputHandle = undefined;
      stdout(`${output}\n`);
    } else {
      stdout(json);
    }
    // A cleanup failure still produces a nonzero exit, but must not discard a
    // validated invoice that has already consumed provider work.
    if (failure) throw failure;
  } catch (error) {
    if (outputHandle) stderr("No complete extraction was saved. The reserved output may be empty or incomplete. Remove it or choose a new --output filename before retrying.\n");
    throw safeFailure("Writing the result", error);
  } finally {
    if (outputHandle) await outputHandle.close().catch(() => {});
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${safeFailure("Invoice example", error).message}\n`);
    process.exitCode = 1;
  });
}
