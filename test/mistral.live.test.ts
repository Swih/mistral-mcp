/**
 * Live integration test — hits the real Mistral API.
 *
 * Skipped unless MISTRAL_API_KEY is set in the environment.
 * Uses mistral-small-latest to minimise token cost on CI.
 */

import { describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// load .env if it exists (local dev)
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

describe.skipIf(!HAS_KEY)("live Mistral API", () => {
  it("mistral.chat.complete reaches the API and returns content", async () => {
    const { Mistral } = await import("@mistralai/mistralai");
    const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });

    const res = await mistral.chat.complete({
      model: "mistral-small-latest",
      messages: [
        {
          role: "user",
          content:
            'Reply with exactly: "ok" — no punctuation, no other words.',
        },
      ],
      temperature: 0,
      maxTokens: 8,
    });

    const content = res.choices?.[0]?.message?.content ?? "";
    const text = typeof content === "string" ? content : JSON.stringify(content);
    expect(text.toLowerCase()).toContain("ok");
    expect(res.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("mistral.embeddings.create returns 1024-dim vectors for mistral-embed", async () => {
    const { Mistral } = await import("@mistralai/mistralai");
    const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });

    const res = await mistral.embeddings.create({
      model: "mistral-embed",
      inputs: ["hello world"],
    });

    const v = res.data?.[0]?.embedding;
    expect(Array.isArray(v)).toBe(true);
    expect(v!.length).toBe(1024);
    expect(typeof v![0]).toBe("number");
  });
});
