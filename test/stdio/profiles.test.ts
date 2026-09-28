import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";
import { toolsForProfile, type MistralProfile } from "../../src/profile.js";

const core = ["codestral_fim", "mistral_chat", "mistral_ocr", "mistral_vision", "process_document", "voxtral_transcribe"];
const orchestration = ["connectors_call_tool", "connectors_get", "connectors_list", "connectors_list_tools", "rag_indexes_list",
  "workflow_deployments_list", "workflow_execute", "workflow_interact", "workflow_runs_list", "workflow_status", "workflow_stop"];

describe("built server profile and migration contracts", () => {
  it.each(["core", "metier-docs", "workflows", "admin", "self-hosted"] as const)("%s advertises exactly its usable surface", async profile => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(MISTRAL_|MCP_)/.test(key))) as Record<string, string>;
    // The core case deliberately omits the variable to cover the default seen by new users.
    if (profile !== "core") env.MISTRAL_MCP_PROFILE = profile;
    const client = new Client({ name: "profile-contract", version: "1" });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("dist/index.js")], env, stderr: "pipe" }));
      const tools = (await client.listTools()).tools;
      const names = tools.map(t => t.name).sort();
      expect(names).toEqual(toolsForProfile(profile));
      const counts: Record<MistralProfile, number> = { core: 6, "metier-docs": 17, workflows: 11, admin: 46, "self-hosted": 5 };
      expect(names).toHaveLength(counts[profile]);
      if (profile === "core") expect(names).toEqual(core);
      if (profile === "metier-docs") expect(names).toEqual([...core, ...orchestration].sort());
      if (profile === "workflows") expect(names).toEqual(orchestration);
      const contents = (await client.readResource({ uri: "mistral://capabilities" })).contents;
      const first = contents[0];
      if (!("text" in first)) throw new Error("Expected capability text");
      expect(JSON.parse(first.text).registered_tools).toEqual(names);
      const resources = (await client.listResources()).resources.map(r => r.uri);
      expect(resources.includes("mistral://workflows")).toBe(["admin", "workflows", "metier-docs"].includes(profile));
      if (profile === "core") {
        for (const tool of tools) {
          const props = tool.inputSchema.properties as Record<string, { description?: string }>;
          for (const [key, schema] of Object.entries(props)) {
            expect(schema.description?.trim(), `${tool.name}.${key} needs input guidance`).toBeTruthy();
          }
        }
      }
    } finally { await client.close(); }
  });
});
