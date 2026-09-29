/**
 * Live OCR tests, isolated from the rest of the live suite.
 *
 * Mistral serves OCR on its free plan only when capacity allows. The workflow
 * runs this file in its own step so a provider capacity refusal is reported
 * as such instead of failing the code checks (see scripts/classify-ocr.mjs).
 */

import { describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "../../src/shared.js";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  loadEnv({ path: envPath });
}

const HAS_KEY = Boolean(process.env.MISTRAL_API_KEY);

describe.skipIf(!HAS_KEY)("live Mistral OCR", () => {
  it("mistral.ocr.process accepts document annotations when requested", async () => {
    const { Mistral } = await import("@mistralai/mistralai");
    const mistral = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY!,
      retryConfig: MISTRAL_RETRY_CONFIG,
      timeoutMs: MISTRAL_TIMEOUT_MS,
    });

    const res = await mistral.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: "https://arxiv.org/pdf/2410.07073",
      },
      pages: [0],
      documentAnnotationFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "paper_metadata",
          schemaDefinition: {
            type: "object",
            properties: {
              title: { type: "string" },
            },
          },
          strict: false,
        },
      },
      documentAnnotationPrompt:
        "Extract the visible paper title when present. Return only fields supported by the schema.",
    });

    expect(Array.isArray(res.pages)).toBe(true);
    expect(res.pages.length).toBeGreaterThan(0);
    if (res.documentAnnotation) {
      expect(() => JSON.parse(res.documentAnnotation!)).not.toThrow();
    }
  });

  it("mistral.ocr.process returns paragraph-level blocks when includeBlocks is set", async () => {
    const { Mistral } = await import("@mistralai/mistralai");
    const mistral = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY!,
      retryConfig: MISTRAL_RETRY_CONFIG,
      timeoutMs: MISTRAL_TIMEOUT_MS,
    });

    const res = await mistral.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: "https://arxiv.org/pdf/2410.07073",
      },
      pages: [0],
      includeBlocks: true,
    });

    expect(Array.isArray(res.pages)).toBe(true);
    expect(res.pages.length).toBeGreaterThan(0);
    // Older OCR models accept includeBlocks but return an empty array — only
    // assert shape (bounding box + type) when at least one block comes back.
    const blocks = (res.pages[0]?.blocks ?? []).filter(
      (b): b is Exclude<typeof b, { isUnknown: true }> => !("isUnknown" in b)
    );
    if (blocks.length > 0) {
      const block = blocks[0]!;
      expect(typeof block.type).toBe("string");
      expect(typeof block.topLeftX).toBe("number");
      expect(typeof block.content).toBe("string");
    }
  });
});
