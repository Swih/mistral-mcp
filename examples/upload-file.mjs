// Explicit CLI upload keeps file bytes outside the model's conversation context.
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Mistral } from "@mistralai/mistralai";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../dist/shared.js";

const [filename, purpose = "ocr"] = process.argv.slice(2);
if (!filename || !["ocr", "batch"].includes(purpose)) {
  throw new Error("Usage: node --env-file=.env examples/upload-file.mjs <file> [ocr|batch]");
}
if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is required.");
const path = resolve(filename);
const info = await stat(path);
if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Choose a regular file of at most 20 MiB.");
const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY, retryConfig: MISTRAL_RETRY_CONFIG, timeoutMs: MISTRAL_TIMEOUT_MS });
const uploaded = await client.files.upload({ file: { fileName: basename(path), content: await readFile(path) }, purpose, visibility: "user" });
console.log(JSON.stringify({ file_id: uploaded.id, filename: uploaded.filename }));
