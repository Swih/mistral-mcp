import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerLeanTools } from "../../src/tools-lean.js";
import type { MistralProfile } from "../../src/profile.js";

function makeMock(): Mistral {
  return {
    chat: {
      complete: vi.fn(async () => ({
        choices: [
          {
            message: { content: "```lean\nby omega\n```\nUses linear arithmetic." },
            finishReason: "stop",
          },
        ],
        usage: { promptTokens: 40, completionTokens: 12, totalTokens: 52 },
      })),
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock(), profile: MistralProfile = "core") {
  const server = new McpServer({ name: "lean-test", version: "0.0.0" });
  registerLeanTools(server, mock, profile);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("Leanstral tool registration", () => {
  it("exposes both tools with complete MCP metadata in the core profile", async () => {
    const { client } = await boot();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "prove_with_leanstral",
      "review_lean_proof",
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeTruthy();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    }
  });

  it("does not expose Lean tools in the workflows profile", async () => {
    const { client } = await boot(makeMock(), "workflows");
    const result = await client.listTools().catch(() => ({ tools: [] as unknown[] }));
    expect(result.tools).toHaveLength(0);
  });
});

describe("prove_with_leanstral", () => {
  it("calls Leanstral deterministically with all repair context", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "prove_with_leanstral",
      arguments: {
        theorem: "theorem add_zero (n : Nat) : n + 0 = n := by",
        context: "import Mathlib",
        requirements: "Prefer simp.",
        previous_attempt: "by rfl",
        compiler_errors: "unsolved goals",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      text: "```lean\nby omega\n```\nUses linear arithmetic.",
      model: "labs-leanstral-1-5",
      finish_reason: "stop",
      usage: { totalTokens: 52 },
    });
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: "labs-leanstral-1-5",
      temperature: 0,
      topP: 1,
    });
    expect(call?.messages[0]?.content).toContain("Never claim code compiles");
    expect(call?.messages[1]?.content).toContain("theorem add_zero");
    expect(call?.messages[1]?.content).toContain("unsolved goals");
  });

  it("rejects an empty theorem before calling the API", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "prove_with_leanstral",
      arguments: { theorem: "" },
    });
    expect(result.isError).toBe(true);
    expect(mock.chat.complete).not.toHaveBeenCalled();
  });
});

describe("review_lean_proof", () => {
  it("forwards the source, objective, and diagnostics", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "review_lean_proof",
      arguments: {
        source: "theorem t : True := by trivial",
        objective: "Simplify the proof.",
        compiler_errors: "declaration uses sorry",
      },
    });

    expect(result.isError).toBeFalsy();
    const call = (mock.chat.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.messages[1]?.content).toContain("Simplify the proof.");
    expect(call?.messages[1]?.content).toContain("theorem t : True");
    expect(call?.messages[1]?.content).toContain("declaration uses sorry");
  });

  it("surfaces empty and failed API responses as MCP errors", async () => {
    const emptyMock = makeMock();
    (emptyMock.chat.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      choices: [],
    });
    const { client } = await boot(emptyMock);
    const empty = await client.callTool({
      name: "review_lean_proof",
      arguments: { source: "theorem t : True := by trivial" },
    });
    expect(empty.isError).toBe(true);
    expect((empty.content as Array<{ text: string }>)[0]?.text).toContain(
      "Leanstral returned no proof text"
    );
  });
});
