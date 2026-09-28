/**
 * Document pipeline shared by the default and advanced profiles.
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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";

import { DEFAULT_OCR_MODEL, defaultChatModel } from "./models.js";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- pipeline version (bump on breaking schema/prompt changes) ----------

const PIPELINE_VERSION = "v1.0.0";

// ---------- input schema ----------

const DocumentSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url").describe("Fetch a document from a provider-accessible URL."),
    url: z.string().url().describe("HTTPS URL to a PDF or image."),
  }),
  z.object({
    type: z.literal("image_base64").describe("Send inline image bytes; PDFs must use file_id or url."),
    data: z
      .string()
      .describe("Base64-encoded image bytes (no data: prefix). For PDFs, upload via the Files API and use type:file_id instead."),
    mime: z
      .string()
      .regex(/^image\/(png|jpeg|jpg|gif|webp)$/i)
      .describe("e.g. image/png, image/jpeg."),
  }),
  z.object({
    type: z.literal("file_id").describe("Use an existing Mistral Files API upload."),
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
  source: DocumentSourceSchema.describe("Document location: remote URL, uploaded file ID, or inline image."),
  kind: DocumentKindSchema.default("auto").describe("Extraction task. auto classifies the document; generic returns OCR text without typed extraction."),
  options: z
    .object({
      languageHints: z.array(z.string().regex(/^[a-z]{2}$/i)).optional().describe("Optional two-letter language hints for typed extraction; they do not select an OCR model."),
      maxPages: z.number().int().positive().max(200).optional().default(50).describe("Maximum number of pages to send to OCR, from the start of the document. The result covers only this selection."),
      minOcrConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .default(0.3)
        .describe(
          "Conservative floor: below it the tool returns isError rather than risk " +
            "extracting from text OCR is not confident about. 0.3 is a starting " +
            "point, not a measured value — run `npm run eval:docs` against your " +
            "own documents and set the number that run justifies."
        ),
      cache: z
        .enum(["read_write", "read_only", "bypass"])
        .optional()
        .describe(
          "Default depends on kind: 'bypass' for id_document (PII), 'read_write' otherwise. Override explicitly to opt in to caching for sensitive kinds."
        ),
    })
    .optional()
    // prefault, not default: zod 4 applies default() to the *output* type, so
    // `{}` would no longer flow through the inner field defaults.
    .prefault({})
    .describe("Page selection, OCR confidence floor and local cache policy."),
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
  ...CommonShape,
  // Keep an object root for legacy clients while exposing the actual nested
  // types. The union additionally enforces which fields each kind requires.
  parties: ContractPayloadSchema.shape.parties.optional(),
  clauses: ContractPayloadSchema.shape.clauses.optional(),
  risk_score: ContractPayloadSchema.shape.risk_score.optional(),
  key_dates: ContractPayloadSchema.shape.key_dates.optional(),
  summary: ContractPayloadSchema.shape.summary.optional(),
  vendor: InvoicePayloadSchema.shape.vendor.optional(),
  total: InvoicePayloadSchema.shape.total.optional(),
  currency: InvoicePayloadSchema.shape.currency.optional(),
  line_items: InvoicePayloadSchema.shape.line_items.optional(),
  due_date: InvoicePayloadSchema.shape.due_date.optional(),
  anomalies: InvoicePayloadSchema.shape.anomalies.optional(),
  document_type: IdDocPayloadSchema.shape.document_type.optional(),
  name: IdDocPayloadSchema.shape.name.optional(),
  dob: IdDocPayloadSchema.shape.dob.optional(),
  expiry: IdDocPayloadSchema.shape.expiry.optional(),
  country: IdDocPayloadSchema.shape.country.optional(),
  structured_text: GenericPayloadSchema.shape.structured_text.optional(),
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
  "",
  "Decide on what the document is, not on how it is laid out. Numbered",
  "articles, annexes and formal headings are as common in technical",
  "documentation as in agreements, and are not evidence on their own.",
  "",
  "- contract: two or more named parties entering mutual obligations. Look for",
  "  the parties, what each owes the other, and terms of duration, termination",
  "  or signature. With no identified parties, it is not a contract.",
  "- invoice: a demand for payment - issuer, recipient, line items, total due.",
  "- id_document: an identity credential issued to a person by an authority",
  "  (passport, ID card, driver license, residence permit).",
  "- generic: everything else, including technical dossiers, specifications,",
  "  procedures, reports, manuals, meeting notes and correspondence.",
  "",
  "Hesitating between contract and generic: choose generic unless both the",
  "parties and their mutual obligations are present.",
  "Return JSON: { kind: string }.",
].join("\n");

// ---------- cache helpers ----------

function cacheDir(): string {
  return process.env.MISTRAL_MCP_CACHE_DIR ?? join(homedir(), ".mistral-mcp", "cache");
}

const DEFAULT_CACHE_TTL_HOURS = 168;

/**
 * How long a cached extraction may be reused.
 *
 * This is a retention policy, not a measured threshold, and it is stated as
 * one: the cached payload holds extracted document content — a contract's
 * parties and clauses, an invoice's line items — which is personal data, and
 * personal data must not sit on disk indefinitely because a cache was
 * convenient. Seven days covers the span over which the same document is
 * realistically reprocessed (a batch, then its corrections); past that,
 * re-running OCR costs less than holding the data.
 *
 * `MISTRAL_MCP_CACHE_TTL_HOURS=0` disables reuse entirely, for a deployment
 * whose retention rules do not allow any.
 */
function cacheTtlMs(): number {
  const raw = process.env.MISTRAL_MCP_CACHE_TTL_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CACHE_TTL_HOURS * 3_600_000;
  const hours = Number.parseFloat(raw);
  if (!Number.isFinite(hours) || hours < 0) return DEFAULT_CACHE_TTL_HOURS * 3_600_000;
  return hours * 3_600_000;
}

/** True when an entry stored at `storedAt` may still be served. */
function isFresh(storedAt: unknown, ttlMs: number, now: number): boolean {
  if (ttlMs === 0) return false;
  if (typeof storedAt !== "string") return false;
  const at = Date.parse(storedAt);
  if (!Number.isFinite(at)) return false;
  return now - at < ttlMs;
}

function sourceHash(src: ProcessDocumentInput["source"]): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(src));
  return h.digest("hex");
}

function cacheKey(src: ProcessDocumentInput["source"], kind: string, maxPages: number, languageHints?: string[]): string {
  const id = sourceHash(src);
  const config = createHash("sha256").update(JSON.stringify({
    maxPages, languageHints, ocr: DEFAULT_OCR_MODEL, extraction: defaultChatModel(),
    classification: pickModelForClassification(), endpoint: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai",
  })).digest("hex");
  return `${id}.${kind}.${config}.${PIPELINE_VERSION}.json`;
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
    const parsed = JSON.parse(raw) as {
      _v: string;
      stored_at?: unknown;
      payload: unknown;
    };
    if (parsed._v !== PIPELINE_VERSION) return undefined;
    if (!isFresh(parsed.stored_at, cacheTtlMs(), Date.now())) {
      // Expired entries are deleted on the way past rather than left to rot:
      // the point of the TTL is that the content stops existing, not merely
      // that it stops being served.
      try {
        unlinkSync(path);
      } catch {
        /* a concurrent reader may have removed it already */
      }
      return undefined;
    }
    return parsed.payload;
  } catch {
    return undefined;
  }
}

/**
 * Drop expired entries from one shard.
 *
 * Read-time expiry only reaches entries somebody asks for again; a document
 * processed once and never revisited would otherwise stay on disk forever.
 * Keys are sharded on their first two hex characters, so sweeping the shard a
 * write lands in touches about 1/256 of the cache and keeps the whole store
 * bounded by the TTL without ever walking it end to end.
 */
function sweepShard(dir: string, ttlMs: number, now: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf8")) as { stored_at?: unknown };
      if (!isFresh(parsed.stored_at, ttlMs, now)) unlinkSync(full);
    } catch {
      /* unreadable or already gone — nothing useful to do about it here */
    }
  }
}

let sweepCursor = 0;

/**
 * Expire what a write can reach, and one more shard besides.
 *
 * Sweeping only the shard just written leaves a cold entry alive for as long
 * as nothing else hashes into its shard — with 256 shards and a slow corpus,
 * that is effectively forever, which is the defect this whole TTL exists to
 * close. Advancing a cursor by one shard per write covers the entire keyspace
 * in 256 writes while keeping each write's cost to two small directories.
 */
function sweepOnWrite(writtenShard: string, ttlMs: number, now: number): void {
  const root = cacheDir();
  sweepShard(join(root, writtenShard), ttlMs, now);
  const cursorShard = sweepCursor.toString(16).padStart(2, "0");
  sweepCursor = (sweepCursor + 1) % 256;
  if (cursorShard !== writtenShard) sweepShard(join(root, cursorShard), ttlMs, now);
}

function writeCache(key: string, payload: unknown): void {
  const ttlMs = cacheTtlMs();
  if (ttlMs === 0) return;
  const path = cachePath(key);
  const tmp = `${path}.tmp.${process.pid}`;
  const body = JSON.stringify({ _v: PIPELINE_VERSION, stored_at: new Date().toISOString(), payload });
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  sweepOnWrite(key.slice(0, 2), ttlMs, Date.now());
}

// ---------- pipeline helpers ----------

type OcrRes = {
  text: string;
  confidence: number | undefined;
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
  return defaultChatModel();
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
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
  const confidence = pages.length > 0 && scores.length === pages.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
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
  ocrText: string,
  languageHints?: string[]
): Promise<Record<string, unknown>> {
  // A partial invoice can still produce valid JSON with incorrect totals.
  // Reject beyond the supported extraction size instead of silently slicing it.
  if (ocrText.length > 60_000) {
    throw new Error("Document exceeds the 60000-character extraction limit. Split it into smaller documents or use kind=generic for OCR text.");
  }
  const schema =
    kind === "contract"
      ? CONTRACT_JSON_SCHEMA
      : kind === "invoice"
      ? INVOICE_JSON_SCHEMA
      : ID_DOC_JSON_SCHEMA;
  const res = await mistral.chat.complete({
    model: pickModelForExtraction(),
    messages: [
      { role: "system", content: EXTRACTION_PROMPTS[kind] + (languageHints?.length ? `\nDocument language hints: ${languageHints.join(", ")}.` : "") },
      { role: "user", content: ocrText },
    ],
    responseFormat: { type: "json_schema", jsonSchema: schema } as never,
    temperature: 0,
  });
  const raw = res.choices?.[0]?.message?.content;
  const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((c) => ("text" in c ? c.text : "")).join("") : "";
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Extraction returned invalid JSON. No document content is included in this error."); }
  const object = z.record(z.string(), z.unknown()).safeParse(parsed);
  if (!object.success) throw new Error("Extraction must return a JSON object.");
  return object.data;
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
        "Validation checks schema and OCR confidence, not factual or accounting accuracy.",
        "Typed extraction rejects text longer than 60000 characters rather than truncating it.",
        "",
        "Cache keys include source, kind, page limit, endpoint, models and pipeline version.",
        "Override location with MISTRAL_MCP_CACHE_DIR. Override mode with options.cache.",
        "Default cache mode is 'read_write' EXCEPT for kind=id_document (auto-bypass to avoid",
        "persisting PII). Set options.cache='read_write' explicitly to opt in for id documents.",
        "",
        "OCR confidence floor is options.minOcrConfidence (default 0.3). Below the floor the",
        "tool returns isError. Missing or partial confidence scores also return isError;",
        "use mistral_ocr directly if you need raw OCR without a confidence guarantee.",
        "0.3 is a conservative starting point, not a measured one: calibrate it for your",
        "corpus with `npm run eval:docs`.",
      ].join("\n"),
      inputSchema: ProcessDocumentInputShape,
      outputSchema: z.object(ProcessDocumentOutputShape),
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

        // Tentative cache mode (may be overridden after classification if the
        // resolved kind is id_document and the user did not explicitly opt in).
        const cacheModeInitial: "read_write" | "read_only" | "bypass" =
          opts.cache ?? (requestedKind === "id_document" ? "bypass" : "read_write");

        // 1. cache check (we cache final payload by source+kind)
        const sourceId = sourceHash(source);
        const cacheLookupKind = requestedKind === "auto" ? "auto" : requestedKind;
        const key = cacheKey(source, cacheLookupKind, maxPages, opts.languageHints);
        if (cacheModeInitial !== "bypass") {
          const parsedCache = ProcessDocumentOutputSchema.safeParse(readCache(key));
          const cached = parsedCache.success ? parsedCache.data : undefined;
          if (cached) {
            // PII safety: never serve cached id_document payloads unless the
            // caller explicitly set cache='read_write'. Catches the case where
            // a previous kind='auto' call cached an id_document under the auto key.
            const isCachedId = cached.kind === "id_document";
            if (!isCachedId || opts.cache === "read_write") {
              if (cached.ocr_confidence < minConfidence) {
                return errorResult("process_document", `Cached OCR confidence ${cached.ocr_confidence} is below the requested minimum ${minConfidence}. Use cache=bypass to process again.`);
              }
              const payload = { ...cached, cache_hit: true, total_duration_ms: Date.now() - start };
              return {
                content: [toTextBlock(payload)],
                structuredContent: payload,
              };
            }
          }
        }

        // 2. OCR
        const ocr = await runOcr(mistral, source, maxPages);
        if (ocr.confidence === undefined) {
          return errorResult("process_document", "OCR confidence is unavailable or incomplete; cannot verify the requested quality floor. Use mistral_ocr for raw OCR.");
        }
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
          typed = await extractTyped(mistral, kind, ocr.text, opts.languageHints);
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
            : { ...typed, ...common };

        // 6. Validate via discriminated union
        const validated = ProcessDocumentOutputSchema.safeParse(payload);
        if (!validated.success) {
          return errorResult(
            "process_document",
            `Output validation failed (kind=${kind}): ${validated.error.message}`
          );
        }

        // 7. Cache write — final mode resolution:
        //    if resolved kind is id_document and the caller did NOT explicitly opt in
        //    via cache='read_write', force bypass regardless of requestedKind.
        const cacheMode: "read_write" | "read_only" | "bypass" =
          kind === "id_document" && opts.cache !== "read_write"
            ? "bypass"
            : cacheModeInitial;

        if (cacheMode === "read_write") {
          writeCache(cacheKey(source, kind, maxPages, opts.languageHints), validated.data);
          if (requestedKind === "auto") writeCache(key, validated.data);
        }

        return {
          content: [toTextBlock(validated.data)],
          structuredContent: validated.data as Record<string, unknown>,
        };
      } catch (err) {
        return errorResult("process_document", err);
      }
    }
  );
}
