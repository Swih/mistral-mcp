import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ quiet: true });
const [scenario, source, question] = process.argv.slice(2);
if (!["invoice", "meeting", "sources"].includes(scenario) || !source) {
  throw new Error("Usage: node examples/workflows.mjs invoice|meeting|sources FILE_ID|HTTPS_AUDIO_URL|LIBRARY_ID [question]");
}
if (!process.env.MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY required. These examples make real API calls; check your account allowance first.");
const client = new Client({ name: "workflow-example", version: "1" });
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  assert(result.structuredContent, "Missing structured result");
  return result.structuredContent;
}
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [resolve("dist/index.js")], env: { ...process.env, MISTRAL_MCP_PROFILE: "admin" } }));
  let result;
  if (scenario === "invoice") {
    result = await call("process_document", { source: { type: "file_id", fileId: source }, kind: "invoice", options: { maxPages: 2, cache: "bypass" } });
    assert.equal(result.kind, "invoice");
  } else if (scenario === "meeting") {
    assert.equal(new URL(source).protocol, "https:");
    result = await call("voxtral_transcribe", { audio: { type: "file_url", fileUrl: source }, diarize: true, timestampGranularities: ["segment"] });
    assert.equal(typeof result.text, "string");
  } else {
    result = await call("conversation_start", { input: question ?? "Summarize the documents and cite your sources.", documentLibraryIds: [source], max_tokens: 400, store: false });
    assert(Array.isArray(result.outputs));
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.close();
}
