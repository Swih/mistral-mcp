/**
 * Unit tests for the Resources and Prompts primitives.
 */

import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerMistralResources } from "../src/resources.js";
import { registerMistralPrompts } from "../src/prompts.js";

async function boot() {
  const server = new McpServer({ name: "rp-test", version: "0.0.0" });
  registerMistralResources(server);
  registerMistralPrompts(server);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client };
}

describe("Resources primitive — mistral://models", () => {
  it("lists the mistral-models resource with correct metadata", async () => {
    const { client } = await boot();
    const { resources } = await client.listResources();
    const m = resources.find((r) => r.uri === "mistral://models");
    expect(m).toBeTruthy();
    expect(m?.mimeType).toBe("application/json");
    expect(m?.name).toBe("mistral-models");
  });

  it("read returns a JSON catalog with the 4 capability buckets", async () => {
    const { client } = await boot();
    const res = await client.readResource({ uri: "mistral://models" });
    expect(res.contents.length).toBeGreaterThan(0);
    const first = res.contents[0];
    expect(first?.mimeType).toBe("application/json");
    const parsed = JSON.parse(first?.text as string);

    expect(parsed.chat).toContain("mistral-medium-latest");
    expect(parsed.embed).toContain("mistral-embed");
    expect(parsed.fim).toContain("codestral-latest");
    expect(parsed.tool_capable).toContain("mistral-large-latest");
    expect(parsed.spec_version).toBe("2025-11-25");
  });
});

describe("Prompts primitive — curated templates", () => {
  it("lists the two curated prompts", async () => {
    const { client } = await boot();
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(["codestral_review", "french_invoice_reminder"]);
  });

  it("french_invoice_reminder hydrates args into the message", async () => {
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
    expect(result.messages.length).toBe(1);
    const first = result.messages[0];
    const text = (first?.content as { type: "text"; text: string }).text;
    expect(text).toContain("Acme SAS");
    expect(text).toContain("1200€");
    expect(text).toContain("45 jours");
    expect(text).toContain("firm");
    // quality checks on the prompt itself
    expect(text).toContain("120 mots maximum");
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
        arguments: { debtor_name: "Acme" }, // missing amount_eur / days_overdue / tone
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
          tone: "casual", // not in enum
        },
      })
    ).rejects.toThrow();
  });
});
