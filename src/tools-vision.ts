/**
 * v0.4 tools — vision (multimodal chat) and OCR.
 *
 * Sources:
 * - Vision: https://docs.mistral.ai/capabilities/vision/
 *   Messages accept content[] with text + image_url parts on vision-capable models.
 * - OCR: https://docs.mistral.ai/capabilities/document/
 *   POST /v1/ocr (SDK: mistral.ocr.process({ model, document, ... }))
 *   Document input = one of:
 *     - { type: "document_url", documentUrl, documentName? }  (PDF by URL)
 *     - { type: "file", fileId }                               (Files API)
 *     - { type: "image_url", imageUrl }                        (direct image)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import {
  DEFAULT_OCR_MODEL,
  DEFAULT_VISION_MODEL,
  OcrModelSchema,
  VISION_MODELS,
  VisionModelSchema,
} from "./models.js";
import {
  ChatSamplingParams,
  MultimodalMessageSchema,
  UsageSchema,
  errorResult,
  mapUsage,
  toTextBlock,
} from "./shared.js";

// ---------- output schemas (exported for contract tests) ----------

export const VisionOutputShape = {
  text: z.string(),
  model: z.string(),
  usage: UsageSchema.optional(),
  finish_reason: z.string().optional(),
};
export const VisionOutputSchema = z.object(VisionOutputShape);

const OcrPageSchema = z.object({
  index: z.number().int(),
  markdown: z.string(),
  images: z
    .array(
      z.object({
        id: z.string().optional(),
        top_left_x: z.number().optional(),
        top_left_y: z.number().optional(),
        bottom_right_x: z.number().optional(),
        bottom_right_y: z.number().optional(),
        image_base64: z.string().optional(),
      })
    )
    .optional(),
  tables: z.array(z.unknown()).optional(),
  hyperlinks: z.array(z.string()).optional(),
  header: z.string().nullable().optional(),
  footer: z.string().nullable().optional(),
  dimensions: z
    .object({
      dpi: z.number().optional(),
      height: z.number().optional(),
      width: z.number().optional(),
    })
    .nullable()
    .optional(),
});

export const OcrOutputShape = {
  pages: z.array(OcrPageSchema),
  model: z.string(),
  pages_count: z.number().int(),
  document_annotation: z.string().optional(),
  usage: z
    .object({
      pages_processed: z.number().optional(),
      doc_size_bytes: z.number().optional(),
    })
    .optional(),
};
export const OcrOutputSchema = z.object(OcrOutputShape);

// ---------- OCR document input schema ----------

const OcrDocumentSchema = z.union([
  z.object({
    type: z.literal("document_url"),
    documentUrl: z.string().describe("HTTPS URL to a PDF or image."),
    documentName: z.string().optional(),
  }),
  z.object({
    type: z.literal("image_url"),
    imageUrl: z
      .string()
      .describe("HTTPS URL or data:image/...;base64,... payload."),
  }),
  z.object({
    type: z.literal("file"),
    fileId: z
      .string()
      .describe("ID of a file previously uploaded via the Files API."),
  }),
]);

// ---------- registration ----------

export function registerVisionTools(server: McpServer, mistral: Mistral) {
  // ========== mistral_vision ==========
  server.registerTool(
    "mistral_vision",
    {
      title: "Mistral multimodal chat (vision)",
      description: [
        "Chat completion with multimodal input: text + image_url parts.",
        "",
        "Requires a vision-capable model. Accepted:",
        VISION_MODELS.map((m) => `  - ${m}`).join("\n"),
        "",
        "Each message's `content` is either a plain string (pure text) or an array of",
        "parts `{ type: 'text', text }` / `{ type: 'image_url', imageUrl }`. The image URL",
        "can be an https URL or a data: URI base64 payload.",
        "",
        "Returns the assistant text + token usage. For non-visual requests, prefer `mistral_chat`.",
      ].join("\n"),
      inputSchema: {
        messages: z
          .array(MultimodalMessageSchema)
          .min(1)
          .describe(
            "Chat messages. Pure-text requests are accepted, but this tool is intended primarily for multimodal prompts containing image parts."
          ),
        model: VisionModelSchema.optional().describe(
          `Vision-capable Mistral model. Default: ${DEFAULT_VISION_MODEL}.`
        ),
        ...ChatSamplingParams,
      },
      outputSchema: VisionOutputShape,
      annotations: {
        title: "Mistral multimodal chat (vision)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_VISION_MODEL;
        const res = await mistral.chat.complete({
          model,
          messages: input.messages as never,
          temperature: input.temperature,
          maxTokens: input.max_tokens,
          topP: input.top_p,
        });

        const choice = res.choices?.[0];
        const content = choice?.message?.content ?? "";
        const text =
          typeof content === "string" ? content : JSON.stringify(content);

        const structured = {
          text,
          model,
          usage: mapUsage(res.usage),
          finish_reason: choice?.finishReason ?? undefined,
        };

        return {
          content: [toTextBlock(text)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_vision", err);
      }
    }
  );

  // ========== mistral_ocr ==========
  server.registerTool(
    "mistral_ocr",
    {
      title: "Mistral OCR (document to markdown)",
      description: [
        "Run Mistral OCR on a PDF or image, returning structured markdown per page.",
        "",
        "Input `document` is one of:",
        '  - { type: "document_url", documentUrl: "https://...pdf" }',
        '  - { type: "image_url", imageUrl: "https://..." | "data:image/..." }',
        '  - { type: "file", fileId: "<id-from-files-api>" }',
        "",
        "Options:",
        '  - `pages`: array of 0-indexed page numbers or string like "0-5,7".',
        "  - `tableFormat`: 'markdown' (default) or 'html'.",
        "  - `extractHeader` / `extractFooter`: include page header/footer when present.",
        "  - `includeImageBase64`: embed extracted image bytes as base64 in the response.",
        "",
        "Returns `pages[].markdown` plus optional `pages[].hyperlinks`, `header`, `footer`,",
        "`images` bounding boxes, and `dimensions`.",
      ].join("\n"),
      inputSchema: {
        document: OcrDocumentSchema,
        model: OcrModelSchema.optional().describe(
          `OCR model. Default: ${DEFAULT_OCR_MODEL}.`
        ),
        pages: z
          .union([z.string(), z.array(z.number().int().nonnegative())])
          .optional(),
        tableFormat: z.enum(["markdown", "html"]).optional(),
        extractHeader: z.boolean().optional(),
        extractFooter: z.boolean().optional(),
        includeImageBase64: z.boolean().optional(),
        imageLimit: z.number().int().positive().optional(),
        imageMinSize: z.number().int().positive().optional(),
      },
      outputSchema: OcrOutputShape,
      annotations: {
        title: "Mistral OCR",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const model = input.model ?? DEFAULT_OCR_MODEL;
        const res = await mistral.ocr.process({
          model,
          document: input.document,
          pages: input.pages,
          tableFormat: input.tableFormat,
          extractHeader: input.extractHeader,
          extractFooter: input.extractFooter,
          includeImageBase64: input.includeImageBase64,
          imageLimit: input.imageLimit,
          imageMinSize: input.imageMinSize,
        });

        const pages = (res.pages ?? []).map((p) => ({
          index: p.index,
          markdown: p.markdown,
          images: (p.images ?? []).map((im) => ({
            id: im.id,
            top_left_x: im.topLeftX ?? undefined,
            top_left_y: im.topLeftY ?? undefined,
            bottom_right_x: im.bottomRightX ?? undefined,
            bottom_right_y: im.bottomRightY ?? undefined,
            image_base64: im.imageBase64 ?? undefined,
          })),
          tables: p.tables,
          hyperlinks: p.hyperlinks,
          header: p.header ?? undefined,
          footer: p.footer ?? undefined,
          dimensions: p.dimensions
            ? {
                dpi: p.dimensions.dpi,
                height: p.dimensions.height,
                width: p.dimensions.width,
              }
            : undefined,
        }));

        const usageInfo = (res as { usageInfo?: unknown }).usageInfo as
          | { pagesProcessed?: number; docSizeBytes?: number }
          | undefined;

        const structured = {
          pages,
          model: res.model,
          pages_count: pages.length,
          document_annotation:
            (res as { documentAnnotation?: string }).documentAnnotation ??
            undefined,
          usage: usageInfo
            ? {
                pages_processed: usageInfo.pagesProcessed,
                doc_size_bytes: usageInfo.docSizeBytes,
              }
            : undefined,
        };

        const summary = `OCR ${structured.pages_count} page(s) via ${res.model}.`;
        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("mistral_ocr", err);
      }
    }
  );
}
