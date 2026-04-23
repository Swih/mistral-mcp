/**
 * Unit tests for the Resources and Prompts primitives.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerMistralResources } from "../../src/resources.js";
import { registerMistralPrompts } from "../../src/prompts.js";

function makeMockMistral(overrides: Record<string, unknown> = {}): Mistral {
  return {
    models: {
      list: vi.fn(async () => ({
        data: [
          { id: "mistral-medium-latest" },
          { id: "mistral-small-latest" },
          { id: "codestral-latest" },
          { id: "mistral-embed" },
        ],
      })),
    },
    audio: {
      voices: {
        list: vi.fn(async () => ({
          items: [
            {
              id: "vx_amelie",
              name: "Amelie",
              slug: "amelie",
              languages: ["fr"],
              gender: "female",
              age: 28,
              tags: ["preset"],
              color: null,
              retentionNotice: 0,
              createdAt: new Date("2026-01-01T00:00:00Z"),
              userId: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        })),
      },
    },
    ...overrides,
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMockMistral()) {
  const server = new McpServer({ name: "rp-test", version: "0.0.0" });
  registerMistralResources(server, mock);
  registerMistralPrompts(server);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("Resources primitive - mistral://models", () => {
  it("lists the mistral-models resource with correct metadata", async () => {
    const { client } = await boot();
    const { resources } = await client.listResources();
    const m = resources.find((r) => r.uri === "mistral://models");
    expect(m).toBeTruthy();
    expect(m?.mimeType).toBe("application/json");
    expect(m?.name).toBe("mistral-models");
  });

  it("read returns a JSON catalog with accepted + live buckets", async () => {
    const { client } = await boot();
    const res = await client.readResource({ uri: "mistral://models" });
    expect(res.contents.length).toBeGreaterThan(0);
    const first = res.contents[0];
    expect(first?.mimeType).toBe("application/json");
    const parsed = JSON.parse(first?.text as string);

    expect(parsed.accepted.chat).toContain("mistral-medium-latest");
    expect(parsed.accepted.embed).toContain("mistral-embed");
    expect(parsed.accepted.fim).toContain("codestral-latest");
    expect(parsed.accepted.tool_capable).toContain("mistral-large-latest");
    expect(parsed.spec_version).toBe("2025-11-25");
    expect(parsed.fallback).toBe(false);
    expect(parsed.live).toBeTruthy();
    expect(parsed.live.ids).toContain("mistral-medium-latest");
    expect(parsed.live.count).toBe(parsed.live.ids.length);
    expect(typeof parsed.live.fetched_at).toBe("string");
  });

  it("falls back to the static catalog when models.list throws", async () => {
    const failingMock = makeMockMistral({
      models: {
        list: vi.fn(async () => {
          throw new Error("rate_limit_exceeded");
        }),
      },
    });
    const { client } = await boot(failingMock);
    const res = await client.readResource({ uri: "mistral://models" });
    const parsed = JSON.parse((res.contents[0]?.text as string) ?? "{}");
    expect(parsed.fallback).toBe(true);
    expect(parsed.fallback_reason).toContain("rate_limit_exceeded");
    expect(parsed.live).toBeNull();
    expect(parsed.accepted.chat).toContain("mistral-medium-latest");
  });
});

describe("Resources primitive - mistral://voices", () => {
  it("lists the mistral-voices resource with correct metadata", async () => {
    const { client } = await boot();
    const { resources } = await client.listResources();
    const v = resources.find((r) => r.uri === "mistral://voices");
    expect(v).toBeTruthy();
    expect(v?.mimeType).toBe("application/json");
    expect(v?.name).toBe("mistral-voices");
  });

  it("read returns voice items with normalized keys", async () => {
    const { client } = await boot();
    const res = await client.readResource({ uri: "mistral://voices" });
    const parsed = JSON.parse((res.contents[0]?.text as string) ?? "{}");
    expect(parsed.fallback).toBe(false);
    expect(parsed.count).toBe(1);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].id).toBe("vx_amelie");
    expect(parsed.items[0].slug).toBe("amelie");
    expect(parsed.items[0].languages).toEqual(["fr"]);
    expect(parsed.items[0].created_at).toContain("2026-01-01");
    expect(parsed.items[0].retention_notice).toBe(0);
  });

  it("falls back to empty when audio.voices.list throws", async () => {
    const failingMock = makeMockMistral({
      audio: {
        voices: {
          list: vi.fn(async () => {
            throw new Error("voices_unavailable");
          }),
        },
      },
    });
    const { client } = await boot(failingMock);
    const res = await client.readResource({ uri: "mistral://voices" });
    const parsed = JSON.parse((res.contents[0]?.text as string) ?? "{}");
    expect(parsed.fallback).toBe(true);
    expect(parsed.fallback_reason).toContain("voices_unavailable");
    expect(parsed.items).toEqual([]);
  });
});

describe("Prompts primitive - curated templates", () => {
  it("lists the two curated prompts", async () => {
    const { client } = await boot();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(["codestral_review", "french_invoice_reminder"]);
  });

  it("french_invoice_reminder hydrates args into an assistant + user pair", async () => {
    const { client } = await boot();
    const result = await client.getPrompt({
      name: "french_invoice_reminder",
      arguments: {
        debtor_name: "Acme SAS",
        amount_eur: "1200",
        days_overdue: "45",
        tone: "firm",
      },
    });

    expect(result.messages.length).toBe(2);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(result.messages[1]?.role).toBe("user");

    const assistantText = (
      result.messages[0]?.content as { type: "text"; text: string }
    ).text;
    const userText = (
      result.messages[1]?.content as { type: "text"; text: string }
    ).text;

    expect(assistantText).toContain("assistant de recouvrement");
    expect(userText).toContain("Acme SAS");
    expect(userText).toContain("1200");
    expect(userText).toContain("45 jours");
    expect(userText).toContain("firm");
    expect(userText).toContain("120 mots maximum");
  });

  it("codestral_review injects the diff and focus", async () => {
    const { client } = await boot();
    const result = await client.getPrompt({
      name: "codestral_review",
      arguments: {
        diff: "- foo()\n+ foo(true)",
        focus: "security",
      },
    });
    const text = (
      result.messages[0]?.content as { type: "text"; text: string }
    ).text;
    expect(text).toContain("security");
    expect(text).toContain("foo(true)");
    expect(text).toContain("ship / change-requested / block");
  });

  it("rejects a missing required arg", async () => {
    const { client } = await boot();
    await expect(
      client.getPrompt({
        name: "french_invoice_reminder",
        arguments: { debtor_name: "Acme" },
      })
    ).rejects.toThrow();
  });

  it("rejects an invalid enum value for tone", async () => {
    const { client } = await boot();
    await expect(
      client.getPrompt({
        name: "french_invoice_reminder",
        arguments: {
          debtor_name: "Acme",
          amount_eur: "1",
          days_overdue: "1",
          tone: "casual",
        },
      })
    ).rejects.toThrow();
  });
});
