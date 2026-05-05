/**
 * v0.8 tools — documents vertical.
 *
 * `process_document` is a macro-tool that chains OCR + kind-specific structured
 * extraction in one call. Replaces the typical mistral_ocr → mistral_chat →
 * zod-parse pattern an agent would otherwise glue together.
 *
 * Kinds: contract, invoice, id_document, generic (OCR text only). When `kind:"auto"`,
 * the pipeline runs a lightweight classification on the first page.
 *
 * Output is a discriminated union — clients can switch on `kind` to access typed fields.
 *
 * Cache: file-based, keyed on sha256(source) + kind + PIPELINE_VERSION. Set
 * `MISTRAL_MCP_CACHE_DIR` to override the default `~/.mistral-mcp/cache/` location.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";

import { DEFAULT_OCR_MODEL } from "./models.js";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- pipeline version (bump on breaking schema/prompt changes) ----------

const PIPELINE_VERSION = "v0.8.0";

// ---------- input schema ----------

const DocumentSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    url: z.string().url().describe("HTTPS URL to a PDF or image."),
  }),
  z.object({
    type: z.literal("image_base64"),
    data: z
      .string()
      .describe("Base64-encoded image bytes (no data: prefix). For PDFs, upload via the Files API and use type:file_id instead."),
    mime: z
      .string()
      .regex(/^image\/(png|jpeg|jpg|gif|webp)$/i)
      .describe("e.g. image/png, image/jpeg."),
  }),
  z.object({
    type: z.literal("file_id"),
    fileId: z.string().describe("ID of a file previously uploaded via files_upload."),
  }),
]);

const DocumentKindSchema = z.enum([
  "auto",
  "contract",
  "invoice",
  "id_document",
  "generic",
]);

export const ProcessDocumentInputShape = {
  source: DocumentSourceSchema,
  kind: DocumentKindSchema.default("auto"),
  options: z
    .object({
      languageHints: z.array(z.string().length(2)).optional(),
      maxPages: z.number().int().positive().max(200).optional().default(50),
      minOcrConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.3)
        .describe("Empirical floor; tune via real eval. Below this, the tool returns isError."),
      cache: z
        .enum(["read_write", "read_only", "bypass"])
        .optional()
        .describe(
          "Default depends on kind: 'bypass' for id_document (PII), 'read_write' otherwise. Override explicitly to opt in to caching for sensitive kinds."
        ),
    })
    .optional()
    .default({}),
};

type ProcessDocumentInput = {
  source: z.infer<typeof DocumentSourceSchema>;
  kind: z.infer<typeof DocumentKindSchema>;
  options: {
    languageHints?: string[];
    maxPages: number;
    minOcrConfidence: number;
    cache?: "read_write" | "read_only" | "bypass";
  };
};

// ---------- output schema (discriminated union) ----------

const CommonShape = {
  source_id: z.string(),
  kind: z.enum(["contract", "invoice", "id_document", "generic"]),
  ocr_text: z.string(),
  ocr_confidence: z.number().min(0).max(1),
  page_count: z.number().int().nonnegative(),
  total_duration_ms: z.number().int().nonnegative(),
  cache_hit: z.boolean(),
  pipeline_version: z.string(),
} as const;

const ContractPayloadSchema = z.object({
  ...CommonShape,
  kind: z.literal("contract"),
  parties: z.array(
    z.object({
      name: z.string(),
      role: z.string().nullable().optional(),
    })
  ),
  clauses: z.array(
    z.object({
      heading: z.string(),
      text: z.string(),
      risk: z.enum(["low", "medium", "high"]).nullable().optional(),
    })
  ),
  risk_score: z.number().min(0).max(1).nullable(),
  key_dates: z.array(
    z.object({
      label: z.string(),
      iso: z.string(),
    })
  ),
  summary: z.string().nullable(),
});

const InvoicePayloadSchema = z.object({
  ...CommonShape,
  kind: z.literal("invoice"),
  vendor: z.object({
    name: z.string(),
    tax_id: z.string().nullable().optional(),
  }),
  total: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  line_items: z.array(
    z.object({
      desc: z.string(),
      qty: z.number(),
      unit_price: z.number(),
      amount: z.number(),
    })
  ),
  due_date: z.string().nullable(),
  anomalies: z.array(z.string()),
});

const IdDocPayloadSchema = z.object({
  ...CommonShape,
  kind: z.literal("id_document"),
  document_type: z.enum(["passport", "id_card", "driver_license", "other"]),
  name: z.string(),
  dob: z.string().nullable(),
  expiry: z.string().nullable(),
  country: z.string().length(2).nullable(),
});

const GenericPayloadSchema = z.object({
  ...CommonShape,
  kind: z.literal("generic"),
  structured_text: z.string(),
});

export const ProcessDocumentOutputSchema = z.discriminatedUnion("kind", [
  ContractPayloadSchema,
  InvoicePayloadSchema,
  IdDocPayloadSchema,
  GenericPayloadSchema,
]);

export const ProcessDocumentOutputShape = {
  kind: z.enum(["contract", "invoice", "id_document", "generic"]),
  source_id: z.string(),
  ocr_text: z.string(),
  ocr_confidence: z.number(),
  page_count: z.number().int(),
  total_duration_ms: z.number().int(),
  cache_hit: z.boolean(),
  pipeline_version: z.string(),
  // Optional kind-specific fields (validated via union at runtime)
  parties: z.array(z.unknown()).optional(),
  clauses: z.array(z.unknown()).optional(),
  risk_score: z.number().nullable().optional(),
  key_dates: z.array(z.unknown()).optional(),
  summary: z.string().nullable().optional(),
  vendor: z.unknown().optional(),
  total: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  line_items: z.array(z.unknown()).optional(),
  due_date: z.string().nullable().optional(),
  anomalies: z.array(z.string()).optional(),
  document_type: z.string().optional(),
  name: z.string().optional(),
  dob: z.string().nullable().optional(),
  expiry: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  structured_text: z.string().optional(),
};

// ---------- built-in JSON schemas for response_format (one per typed kind) ----------

const CONTRACT_JSON_SCHEMA = {
  name: "contract_extraction",
  strict: true,
  schemaDefinition: {
    type: "object",
    additionalProperties: false,
    required: ["parties", "clauses", "risk_score", "key_dates", "summary"],
    properties: {
      parties: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string" },
            role: { type: "string" },
          },
        },
      },
      clauses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "text"],
          properties: {
            heading: { type: "string" },
            text: { type: "string" },
            risk: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
          },
        },
      },
      risk_score: { type: ["number", "null"], minimum: 0, maximum: 1 },
      key_dates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "iso"],
          properties: {
            label: { type: "string" },
            iso: { type: "string" },
          },
        },
      },
      summary: { type: ["string", "null"] },
    },
  },
};

const INVOICE_JSON_SCHEMA = {
  name: "invoice_extraction",
  strict: true,
  schemaDefinition: {
    type: "object",
    additionalProperties: false,
    required: ["vendor", "total", "currency", "line_items", "due_date", "anomalies"],
    properties: {
      vendor: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          tax_id: { type: ["string", "null"] },
        },
      },
      total: { type: ["number", "null"] },
      currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
      line_items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["desc", "qty", "unit_price", "amount"],
          properties: {
            desc: { type: "string" },
            qty: { type: "number" },
            unit_price: { type: "number" },
            amount: { type: "number" },
          },
        },
      },
      due_date: { type: ["string", "null"] },
      anomalies: { type: "array", items: { type: "string" } },
    },
  },
};

const ID_DOC_JSON_SCHEMA = {
  name: "id_document_extraction",
  strict: true,
  schemaDefinition: {
    type: "object",
    additionalProperties: false,
    required: ["document_type", "name", "dob", "expiry", "country"],
    properties: {
      document_type: {
        type: "string",
        enum: ["passport", "id_card", "driver_license", "other"],
      },
      name: { type: "string" },
      dob: { type: ["string", "null"] },
      expiry: { type: ["string", "null"] },
      country: { type: ["string", "null"], minLength: 2, maxLength: 2 },
    },
  },
};

const KIND_CLASSIFIER_SCHEMA = {
  name: "document_kind",
  strict: true,
  schemaDefinition: {
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: {
      kind: {
        type: "string",
        enum: ["contract", "invoice", "id_document", "generic"],
      },
    },
  },
};

// ---------- prompts (bilingual, per CLAUDE.md rule 2) ----------

const EXTRACTION_PROMPTS: Record<string, string> = {
  contract: [
    "You are a senior legal analyst. Read the OCR text of a contract and extract structured data.",
    "Vous êtes un analyste juridique senior. Lisez le texte OCR d'un contrat et extrayez les données structurées.",
    "",
    "Rules:",
    "- Identify all parties with their role (buyer, seller, lessor, etc.).",
    "- List clauses by heading (or your best label) with full clause text.",
    "- Assign a risk level (low|medium|high) to clauses with non-standard or onerous terms.",
    "- Compute a global risk_score in [0..1] reflecting overall exposure.",
    "- Extract key dates (start, end, renewal, payment) as ISO 8601.",
    "- Provide a concise plain-language summary in the contract's primary language.",
    "Return JSON matching the schema. Do not invent fields not present in the document.",
  ].join("\n"),

  invoice: [
    "You are an accounts-payable specialist. Read the OCR text of an invoice and extract structured fields.",
    "Vous êtes spécialiste comptes fournisseurs. Lisez le texte OCR d'une facture et extrayez les champs structurés.",
    "",
    "Rules:",
    "- Vendor name is mandatory; tax_id (SIREN/SIRET/VAT) when present.",
    "- Total is the gross amount due. Currency is ISO 4217 (EUR, USD, GBP, ...).",
    "- Line items: one row per billed line with quantity, unit price, and line amount.",
    "- due_date as ISO 8601 (yyyy-mm-dd) or null if absent.",
    "- anomalies: list textual issues (missing VAT, math errors, illegible fields, duplicate lines).",
    "Return JSON matching the schema. Do not invent missing fields — leave nullable ones null.",
  ].join("\n"),

  id_document: [
    "You are a KYC operator. Read the OCR text of an identity document and extract structured fields.",
    "Vous êtes opérateur KYC. Lisez le texte OCR d'un document d'identité et extrayez les champs.",
    "",
    "Rules:",
    "- document_type: passport | id_card | driver_license | other.",
    "- name: full legal name as printed.",
    "- dob: date of birth as ISO 8601 (yyyy-mm-dd) or null.",
    "- expiry: expiration date as ISO 8601 or null.",
    "- country: ISO 3166-1 alpha-2 (FR, US, ...) or null if not determinable.",
    "Return JSON matching the schema. Do not guess fields that are not visible.",
  ].join("\n"),
};

const CLASSIFIER_PROMPT = [
  "Classify the type of document from its OCR text.",
  "Possible kinds: contract | invoice | id_document | generic.",
  "- contract: legal agreement, terms, lease, NDA, service contract.",
  "- invoice: billing document with vendor, line items, total amount.",
  "- id_document: passport, ID card, driver license, residence permit.",
  "- generic: anything else (article, report, manual, letter, etc.).",
  "Return JSON: { kind: string }.",
].join("\n");

// ---------- cache helpers ----------

function cacheDir(): string {
  return process.env.MISTRAL_MCP_CACHE_DIR ?? join(homedir(), ".mistral-mcp", "cache");
}

function sourceHash(src: ProcessDocumentInput["source"]): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(src));
  return h.digest("hex");
}

function cacheKey(src: ProcessDocumentInput["source"], kind: string): string {
  const id = sourceHash(src);
  return `${id}.${kind}.${PIPELINE_VERSION}.json`;
}

function cachePath(key: string): string {
  const dir = cacheDir();
  const sub = join(dir, key.slice(0, 2));
  if (!existsSync(sub)) mkdirSync(sub, { recursive: true });
  return join(sub, key);
}

function readCache(key: string): unknown | undefined {
  const path = cachePath(key);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { _v: string; payload: unknown };
    if (parsed._v !== PIPELINE_VERSION) return undefined;
    return parsed.payload;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, payload: unknown): void {
  const path = cachePath(key);
  const tmp = `${path}.tmp.${process.pid}`;
  const body = JSON.stringify({ _v: PIPELINE_VERSION, stored_at: new Date().toISOString(), payload });
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

// ---------- pipeline helpers ----------

type OcrRes = {
  text: string;
  confidence: number;
  pages: number;
};

function toOcrDocument(src: ProcessDocumentInput["source"]) {
  switch (src.type) {
    case "url": {
      const isImage = /\.(png|jpe?g|gif|webp)(\?|$)/i.test(src.url);
      return isImage
        ? ({ type: "image_url", imageUrl: src.url } as const)
        : ({ type: "document_url", documentUrl: src.url } as const);
    }
    case "image_base64":
      return {
        type: "image_url" as const,
        imageUrl: `data:${src.mime};base64,${src.data}`,
      };
    case "file_id":
      return { type: "file" as const, fileId: src.fileId };
  }
}

function pickModelForExtraction(): string {
  return "mistral-medium-latest";
}

function pickModelForClassification(): string {
  return "ministral-3b-latest";
}

async function runOcr(
  mistral: Mistral,
  src: ProcessDocumentInput["source"],
  maxPages: number
): Promise<OcrRes> {
  const document = toOcrDocument(src);
  const res = await mistral.ocr.process({
    model: DEFAULT_OCR_MODEL,
    document,
    pages: Array.from({ length: maxPages }, (_, i) => i),
    confidenceScoresGranularity: "page",
  });
  const pages = res.pages ?? [];
  const text = pages.map((p) => p.markdown ?? "").join("\n\n").trim();
  const scores = pages
    .map((p) => p.confidenceScores?.averagePageConfidenceScore)
    .filter((v): v is number => typeof v === "number");
  const confidence = scores.length === 0 ? 1 : scores.reduce((a, b) => a + b, 0) / scores.length;
  return { text, confidence, pages: pages.length };
}

async function classifyKind(
  mistral: Mistral,
  ocrText: string
): Promise<"contract" | "invoice" | "id_document" | "generic"> {
  const sample = ocrText.slice(0, 2000);
  const res = await mistral.chat.complete({
    model: pickModelForClassification(),
    messages: [
      { role: "system", content: CLASSIFIER_PROMPT },
      { role: "user", content: sample || "(empty)" },
    ],
    responseFormat: {
      type: "json_schema",
      jsonSchema: KIND_CLASSIFIER_SCHEMA,
    } as never,
    temperature: 0,
  });
  const raw = res.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c) => ("text" in c ? c.text : "")).join("") : "";
  try {
    const parsed = JSON.parse(text) as { kind: string };
    if (parsed.kind === "contract" || parsed.kind === "invoice" || parsed.kind === "id_document") {
      return parsed.kind;
    }
  } catch {
    /* fall through */
  }
  return "generic";
}

async function extractTyped(
  mistral: Mistral,
  kind: "contract" | "invoice" | "id_document",
  ocrText: string
): Promise<Record<string, unknown>> {
  const schema =
    kind === "contract"
      ? CONTRACT_JSON_SCHEMA
      : kind === "invoice"
      ? INVOICE_JSON_SCHEMA
      : ID_DOC_JSON_SCHEMA;
  const res = await mistral.chat.complete({
    model: pickModelForExtraction(),
    messages: [
      { role: "system", content: EXTRACTION_PROMPTS[kind] },
      { role: "user", content: ocrText.slice(0, 60_000) },
    ],
    responseFormat: { type: "json_schema", jsonSchema: schema } as never,
    temperature: 0,
  });
  const raw = res.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c) => ("text" in c ? c.text : "")).join("") : "";
  return JSON.parse(text);
}

// ---------- registration ----------

export function registerDocsTools(server: McpServer, mistral: Mistral) {
  server.registerTool(
    "process_document",
    {
      title: "Process a business document end-to-end",
      description: [
        "Single-call pipeline: OCR → classify (if kind=auto) → typed extraction → validation.",
        "Replaces the manual chain of mistral_ocr + mistral_chat + JSON parsing.",
        "",
        "Kinds: contract | invoice | id_document | generic. Use kind=auto to let the server classify.",
        "Returns a discriminated union — switch on `kind` to access typed fields.",
        "",
        "Cache: results are cached on disk by sha256(source) + kind + pipeline_version.",
        "Override location with MISTRAL_MCP_CACHE_DIR. Override mode with options.cache.",
        "Default cache mode is 'read_write' EXCEPT for kind=id_document (auto-bypass to avoid",
        "persisting PII). Set options.cache='read_write' explicitly to opt in for id documents.",
        "",
        "OCR confidence floor is options.minOcrConfidence (default 0.3, empirical — tune via eval).",
        "Below the floor the tool returns isError rather than risking hallucinated extraction.",
      ].join("\n"),
      inputSchema: ProcessDocumentInputShape,
      outputSchema: ProcessDocumentOutputShape,
      annotations: {
        title: "Process document (OCR + typed extraction)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const start = Date.now();
      try {
        const { source, kind: requestedKind } = input as ProcessDocumentInput;
        const opts = (input as ProcessDocumentInput).options ?? {
          maxPages: 50,
          minOcrConfidence: 0.3,
          cache: undefined,
        };
        const maxPages = opts.maxPages;
        const minConfidence = opts.minOcrConfidence;

        // Cache mode resolution: explicit user choice wins; otherwise auto-bypass
        // for id_document (PII risk). All other kinds default to read_write.
        const cacheMode: "read_write" | "read_only" | "bypass" =
          opts.cache ?? (requestedKind === "id_document" ? "bypass" : "read_write");

        // 1. cache check (we cache final payload by source+kind)
        const sourceId = sourceHash(source);
        const cacheLookupKind = requestedKind === "auto" ? "auto" : requestedKind;
        const key = cacheKey(source, cacheLookupKind);
        if (cacheMode !== "bypass") {
          const cached = readCache(key) as Record<string, unknown> | undefined;
          if (cached) {
            return {
              content: [
                toTextBlock(
                  `[process_document] cache hit (kind=${cached.kind}, source_id=${sourceId.slice(0, 12)}…)`
                ),
              ],
              structuredContent: { ...cached, cache_hit: true, total_duration_ms: Date.now() - start },
            };
          }
        }

        // 2. OCR
        const ocr = await runOcr(mistral, source, maxPages);
        if (ocr.pages === 0 || ocr.confidence < minConfidence) {
          return errorResult(
            "process_document",
            `OCR quality too low (pages=${ocr.pages}, confidence=${ocr.confidence.toFixed(2)}, min=${minConfidence})`
          );
        }

        // 3. Resolve kind
        let kind: "contract" | "invoice" | "id_document" | "generic" = "generic";
        if (requestedKind === "auto") {
          kind = await classifyKind(mistral, ocr.text);
        } else {
          kind = requestedKind;
        }

        // 4. Typed extraction (skip for generic)
        let typed: Record<string, unknown> = {};
        if (kind !== "generic") {
          try {
            typed = await extractTyped(mistral, kind, ocr.text);
          } catch (err) {
            return errorResult(
              "process_document",
              `Typed extraction failed for kind=${kind}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        // 5. Compose payload
        const common = {
          source_id: sourceId,
          kind,
          ocr_text: ocr.text,
          ocr_confidence: ocr.confidence,
          page_count: ocr.pages,
          total_duration_ms: Date.now() - start,
          cache_hit: false,
          pipeline_version: PIPELINE_VERSION,
        };
        const payload =
          kind === "generic"
            ? { ...common, structured_text: ocr.text }
            : { ...common, ...typed };

        // 6. Validate via discriminated union
        const validated = ProcessDocumentOutputSchema.safeParse(payload);
        if (!validated.success) {
          return errorResult(
            "process_document",
            `Output validation failed (kind=${kind}): ${validated.error.message}`
          );
        }

        // 7. Cache write (under both the resolved-kind key and the auto key if applicable)
        if (cacheMode === "read_write") {
          writeCache(cacheKey(source, kind), validated.data);
          if (requestedKind === "auto") writeCache(key, validated.data);
        }

        return {
          content: [
            toTextBlock(
              `[process_document] kind=${kind}, ${ocr.pages} page(s), confidence=${ocr.confidence.toFixed(2)}, ${Date.now() - start}ms`
            ),
          ],
          structuredContent: validated.data as Record<string, unknown>,
        };
      } catch (err) {
        return errorResult("process_document", err);
      }
    }
  );
}
