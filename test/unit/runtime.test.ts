/**
 * Unit tests for runtime resolution (endpoint + profile) and the surface it
 * produces: which tools get registered, and what mistral://capabilities says.
 *
 * These guard the property that made the family table worth introducing —
 * a profile can never expose a tool the table does not grant it, and the
 * catalogue an agent reads can never disagree with what is registered.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";

import {
  isEnabled,
  PROFILES,
  resolveRuntime,
  TOOL_FAMILIES,
  toolsForProfile,
  type MistralProfile,
} from "../../src/profile.js";
import { registerMistralTools } from "../../src/tools.js";
import { registerFunctionTools } from "../../src/tools-fn.js";
import { registerVisionTools } from "../../src/tools-vision.js";
import { registerAudioTools } from "../../src/tools-audio.js";
import { registerMistralResources } from "../../src/resources.js";
import { registerWorkflowTools } from "../../src/tools-workflows.js";

function makeMock(): Mistral {
  return {
    chat: { complete: vi.fn(), stream: vi.fn() },
    embeddings: { create: vi.fn() },
    fim: { complete: vi.fn() },
    ocr: { process: vi.fn() },
    audio: {
      transcriptions: { complete: vi.fn() },
      voices: { list: vi.fn(async () => ({ items: [] })) },
    },
    models: { list: vi.fn(async () => ({ data: [] })) },
    beta: { workflows: { list: vi.fn(async () => ({ data: [] })) } },
  } as unknown as Mistral;
}

describe("resolveRuntime — endpoint", () => {
  it("defaults to Mistral Cloud with no base URL set", () => {
    const rt = resolveRuntime({});
    expect(rt.baseUrl).toBeUndefined();
    expect(rt.customEndpoint).toBe(false);
    expect(rt.profile).toBe("core");
  });

  it("accepts an absolute http(s) base URL and strips trailing slashes", () => {
    const rt = resolveRuntime({ MISTRAL_BASE_URL: "http://vllm.internal:8000//" });
    expect(rt.baseUrl).toBe("http://vllm.internal:8000");
    expect(rt.customEndpoint).toBe(true);
  });

  it("treats an explicit api.mistral.ai as Mistral Cloud, not a custom endpoint", () => {
    // Someone pinning the default URL should not silently lose OCR and Voxtral.
    const rt = resolveRuntime({ MISTRAL_BASE_URL: "https://api.mistral.ai" });
    expect(rt.customEndpoint).toBe(false);
    expect(rt.profile).toBe("core");
  });

  it("rejects a non-absolute URL with an actionable message", () => {
    expect(() => resolveRuntime({ MISTRAL_BASE_URL: "vllm.internal:8000" })).toThrow(
      /invalid MISTRAL_BASE_URL/
    );
  });

  it("rejects a non-http protocol", () => {
    expect(() =>
      resolveRuntime({ MISTRAL_BASE_URL: "ftp://files.internal" })
    ).toThrow(/protocol must be http or https/);
  });

  it("ignores a blank base URL rather than treating it as custom", () => {
    const rt = resolveRuntime({ MISTRAL_BASE_URL: "   " });
    expect(rt.baseUrl).toBeUndefined();
    expect(rt.customEndpoint).toBe(false);
  });
});

describe("resolveRuntime — profile", () => {
  it("infers self-hosted from a custom endpoint", () => {
    const rt = resolveRuntime({ MISTRAL_BASE_URL: "http://vllm.internal:8000" });
    expect(rt.profile).toBe("self-hosted");
    expect(rt.profileInferred).toBe(true);
  });

  it("lets an explicit profile win over inference", () => {
    // A corporate gateway fronting Mistral Cloud: custom URL, full surface.
    const rt = resolveRuntime({
      MISTRAL_BASE_URL: "https://gateway.corp.internal/mistral",
      MISTRAL_MCP_PROFILE: "admin",
    });
    expect(rt.profile).toBe("admin");
    expect(rt.profileInferred).toBe(false);
    expect(rt.customEndpoint).toBe(true);
  });

  it('keeps accepting the deprecated "full" alias', () => {
    expect(resolveRuntime({ MISTRAL_MCP_PROFILE: "full" }).profile).toBe("admin");
  });

  it("falls back to core on an unknown profile instead of throwing", () => {
    const rt = resolveRuntime({ MISTRAL_MCP_PROFILE: "nonsense" });
    expect(rt.profile).toBe("core");
  });

  it("resolves every documented profile name", () => {
    for (const p of PROFILES) {
      expect(resolveRuntime({ MISTRAL_MCP_PROFILE: p }).profile).toBe(p);
    }
  });
});

describe("tool family table", () => {
  it("grants self-hosted only OpenAI-compatible families", () => {
    for (const [name, family] of Object.entries(TOOL_FAMILIES)) {
      if (family.profiles.includes("self-hosted")) {
        expect(family.openaiCompatible, `${name} must be OpenAI-compatible`).toBe(
          true
        );
      }
    }
  });

  it("never lists the same tool in two families", () => {
    const seen = new Set<string>();
    for (const family of Object.values(TOOL_FAMILIES)) {
      for (const tool of family.tools) {
        expect(seen.has(tool), `${tool} declared twice`).toBe(false);
        seen.add(tool);
      }
    }
  });

  it("gives admin a superset of every other profile", () => {
    const admin = new Set(toolsForProfile("admin"));
    for (const p of PROFILES) {
      if (p === "admin" || p === "self-hosted") continue;
      for (const tool of toolsForProfile(p)) {
        expect(admin.has(tool), `admin is missing ${tool} (from ${p})`).toBe(true);
      }
    }
  });
});

async function bootSurface(profile: MistralProfile) {
  const mock = makeMock();
  const server = new McpServer({ name: "rt-test", version: "0.0.0" });
  registerMistralTools(server, mock, profile);
  registerFunctionTools(server, mock, profile);
  registerVisionTools(server, mock, profile);
  registerAudioTools(server, mock, profile);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  return tools.map((t) => t.name).sort();
}

describe("registered surface matches the table", () => {
  it("self-hosted exposes chat, streaming, embeddings, function calling, vision", async () => {
    expect(await bootSurface("self-hosted")).toEqual([
      "mistral_chat",
      "mistral_chat_stream",
      "mistral_embed",
      "mistral_tool_call",
      "mistral_vision",
    ]);
  });

  it("self-hosted hides the Mistral-only endpoints", async () => {
    const names = await bootSurface("self-hosted");
    for (const hidden of ["mistral_ocr", "codestral_fim", "voxtral_transcribe"]) {
      expect(names).not.toContain(hidden);
    }
  });

  it("workflows exposes none of the generation tools", async () => {
    // The 0.8.0 leak: codestral_fim and voxtral_transcribe used to slip in here.
    // Workflow tools are registered alongside so the server advertises a tools
    // capability at all — with an empty catalogue there is no tools/list to call.
    const mock = makeMock();
    const server = new McpServer({ name: "wf-test", version: "0.0.0" });
    registerMistralTools(server, mock, "workflows");
    registerFunctionTools(server, mock, "workflows");
    registerVisionTools(server, mock, "workflows");
    registerAudioTools(server, mock, "workflows");
    registerWorkflowTools(server, mock);
    const client = new Client({ name: "c", version: "0.0.0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "workflow_execute",
      "workflow_interact",
      "workflow_status",
    ]);
  });

  it("core keeps its lean generation surface", async () => {
    expect(await bootSurface("core")).toEqual([
      "codestral_fim",
      "mistral_chat",
      "mistral_ocr",
      "mistral_vision",
      "voxtral_transcribe",
    ]);
  });
});

describe("mistral://capabilities", () => {
  async function readCapabilities(
    profile: MistralProfile,
    customEndpoint = false,
    baseUrl?: string
  ) {
    const server = new McpServer({ name: "cap-test", version: "0.0.0" });
    registerMistralResources(server, makeMock(), {
      profile,
      baseUrl,
      customEndpoint,
      profileInferred: true,
    });
    const client = new Client({ name: "c", version: "0.0.0" });
    const [st, ct] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const res = await client.readResource({ uri: "mistral://capabilities" });
    const first = res.contents[0] as { text: string };
    return JSON.parse(first.text);
  }

  it("reports Mistral Cloud by default", async () => {
    const cap = await readCapabilities("core");
    expect(cap.endpoint).toBe("https://api.mistral.ai");
    expect(cap.endpoint_kind).toBe("mistral-cloud");
    expect(cap.tool_families.ocr.available).toBe(true);
  });

  it("explains why a family is hidden behind a custom endpoint", async () => {
    const cap = await readCapabilities(
      "self-hosted",
      true,
      "http://vllm.internal:8000"
    );
    expect(cap.endpoint).toBe("http://vllm.internal:8000");
    expect(cap.endpoint_kind).toBe("custom");
    expect(cap.tool_families.ocr.available).toBe(false);
    expect(cap.tool_families.ocr.unavailable_reason).toMatch(
      /OpenAI-compatible surface/
    );
    expect(cap.tool_families.chat.available).toBe(true);
  });

  it("lists exactly the tools the profile registers", async () => {
    const cap = await readCapabilities("core");
    expect(cap.registered_tools).toEqual(toolsForProfile("core"));
    for (const [name, family] of Object.entries(TOOL_FAMILIES)) {
      expect(cap.tool_families[name].available).toBe(
        isEnabled(name as keyof typeof TOOL_FAMILIES, "core")
      );
      void family;
    }
  });
});
