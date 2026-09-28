/** Built-server protocol checks. Real provider calls live in test/live/stdio-live.test.ts. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DIST_PATH = resolve(process.cwd(), "dist/index.js");
const DIST_EXISTS = existsSync(DIST_PATH);

function firstTextContent(result: {
  contents: Array<{ text?: string } | { blob?: string }>;
}): string {
  const first = result.contents[0];
  if (!first || !("text" in first) || typeof first.text !== "string") {
    throw new Error("Expected first resource content to be text.");
  }
  return first.text;
}

/**
 * Spawns the built server over stdio and returns a connected client plus its
 * teardown. Shared by both suites so the connection setup lives in one place.
 */
async function connectToBuiltServer(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MISTRAL_MCP_PROFILE: "admin",
  };
  // Only forward the key when there is one — an undefined value would be
  // stringified into the child env as "undefined" and look like a real key.
  if (process.env.MISTRAL_API_KEY) {
    env.MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
  }
  const transport = new StdioClientTransport({
    command: "node",
    args: [DIST_PATH],
    env,
  });
  const client = new Client({ name: "e2e-client", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: async () => await client.close() };
}

describe.skipIf(!DIST_EXISTS)("stdio e2e (built server) — protocol surface", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ client, close } = await connectToBuiltServer());
  });

  afterAll(async () => {
    await close?.();
  });

  it("handshakes and lists the expected tools, resources, prompts", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "agents_get",
      "agents_list",
      "batch_cancel",
      "batch_create",
      "batch_get",
      "batch_list",
      "codestral_fim",
      "connectors_call_tool",
      "connectors_get",
      "connectors_list",
      "connectors_list_tools",
      "conversation_append",
      "conversation_delete",
      "conversation_get",
      "conversation_history",
      "conversation_list",
      "conversation_start",
      "files_delete",
      "files_get",
      "files_list",
      "files_signed_url",
      "files_upload",
      "libraries_documents_list",
      "libraries_documents_status",
      "libraries_documents_upload",
      "libraries_get",
      "libraries_list",
      "mistral_agent",
      "mistral_chat",
      "mistral_chat_stream",
      "mistral_classify",
      "mistral_embed",
      "mistral_moderate",
      "mistral_ocr",
      "mistral_tool_call",
      "mistral_vision",
      "process_document",
      "rag_indexes_list",
      "voxtral_speak",
      "voxtral_transcribe",
      "workflow_deployments_list",
      "workflow_execute",
      "workflow_interact",
      "workflow_runs_list",
      "workflow_status",
      "workflow_stop",
    ]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint).toBe("boolean");
      expect(typeof t.annotations?.idempotentHint).toBe("boolean");
    }
    const writeTools = [
      "files_upload",
      "files_delete",
      "batch_create",
      "batch_cancel",
    ];
    for (const name of writeTools) {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} is registered`).toBeTruthy();
      expect(t?.annotations?.readOnlyHint, `${name}.readOnlyHint`).toBe(false);
    }
    const destructiveTools = ["files_delete", "batch_cancel"];
    for (const name of destructiveTools) {
      const t = tools.find((x) => x.name === name);
      expect(t?.annotations?.destructiveHint, `${name}.destructiveHint`).toBe(
        true
      );
    }

    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === "mistral://models")).toBe(true);
    expect(resources.some((r) => r.uri === "mistral://voices")).toBe(true);
    expect(resources.some((r) => r.uri === "mistral://workflows")).toBe(true);

    const { prompts } = await client.listPrompts();
    const promptNames = prompts.map((p) => p.name).sort();
    expect(promptNames).toEqual([
      "codestral_review",
      "french_commit_message",
      "french_email_reply",
      "french_invoice_reminder",
      "french_legal_summary",
      "french_meeting_minutes",
    ]);
  });

  it("resolves prompt bodies and enum completion through the built server", async () => {
    const prompt = await client.getPrompt({
      name: "french_commit_message",
      arguments: {
        diff: "- throw new Error()\n+ return errorResult()",
        scope: "fix",
      },
    });

    expect(prompt.messages.length).toBe(1);
    const text = (
      prompt.messages[0]?.content as { type: "text"; text: string }
    ).text;
    expect(text).toContain("Conventional Commits");
    expect(text).toContain("fix");
    expect(text).toContain("errorResult()");

    const completion = await client.complete({
      ref: { type: "ref/prompt", name: "codestral_review" },
      argument: { name: "focus", value: "sec" },
    });
    expect(completion.completion.values).toContain("security");
  });
});
