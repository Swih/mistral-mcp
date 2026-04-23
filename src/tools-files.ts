/**
 * v0.4 tools — Files API.
 *
 * Source: https://docs.mistral.ai/api/ — Files endpoints, and
 * https://docs.mistral.ai/capabilities/finetuning/ / OCR / batch docs
 * (files uploaded here can be referenced by `fileId` in `mistral_ocr`,
 * `voxtral_transcribe`, batch jobs, and fine-tuning).
 *
 * Tools exposed:
 *   - files_upload       (POST /v1/files) — base64 body → stored file
 *   - files_list         (GET  /v1/files)
 *   - files_get          (GET  /v1/files/{file_id})
 *   - files_delete       (DELETE /v1/files/{file_id})
 *   - files_signed_url   (GET  /v1/files/{file_id}/url)
 *
 * MCP is JSON-only, so `files_upload` takes content as a base64 string — we
 * decode to Uint8Array and hand it to the SDK's multipart upload. The
 * `download` endpoint returns a stream, which doesn't map cleanly to MCP —
 * callers should use `files_signed_url` to get a short-lived download URL.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- shared schemas ----------

const FilePurposeSchema = z.enum(["fine-tune", "batch", "ocr"]);
const FileVisibilitySchema = z.enum(["workspace", "user"]);

const FileEntryShape = {
  id: z.string(),
  object: z.string(),
  size_bytes: z.number(),
  created_at: z.number(),
  filename: z.string(),
  purpose: z.string(),
  sample_type: z.string(),
  num_lines: z.number().optional(),
  mimetype: z.string().optional(),
  source: z.string(),
  signature: z.string().optional(),
  expires_at: z.number().optional(),
  visibility: z.string().optional(),
};
const FileEntrySchema = z.object(FileEntryShape);

function normalizeFile(
  raw: {
    id: string;
    object: string;
    sizeBytes: number;
    createdAt: number;
    filename: string;
    purpose: string;
    sampleType: string;
    numLines?: number | null;
    mimetype?: string | null;
    source: string;
    signature?: string | null;
    expiresAt?: number | null;
    visibility?: string | null;
  }
): z.infer<typeof FileEntrySchema> {
  return {
    id: raw.id,
    object: raw.object,
    size_bytes: raw.sizeBytes,
    created_at: raw.createdAt,
    filename: raw.filename,
    purpose: raw.purpose,
    sample_type: raw.sampleType,
    num_lines: raw.numLines ?? undefined,
    mimetype: raw.mimetype ?? undefined,
    source: raw.source,
    signature: raw.signature ?? undefined,
    expires_at: raw.expiresAt ?? undefined,
    visibility: raw.visibility ?? undefined,
  };
}

// ---------- output schemas (exported for contract tests) ----------

export const FileUploadOutputShape = { ...FileEntryShape };
export const FileUploadOutputSchema = z.object(FileUploadOutputShape);

export const FileGetOutputShape = {
  ...FileEntryShape,
  deleted: z.boolean(),
};
export const FileGetOutputSchema = z.object(FileGetOutputShape);

export const FileListOutputShape = {
  data: z.array(FileEntrySchema),
  object: z.string(),
  total: z.number().optional(),
  count: z.number(),
};
export const FileListOutputSchema = z.object(FileListOutputShape);

export const FileDeleteOutputShape = {
  id: z.string(),
  object: z.string(),
  deleted: z.boolean(),
};
export const FileDeleteOutputSchema = z.object(FileDeleteOutputShape);

export const FileSignedUrlOutputShape = {
  url: z.string(),
  file_id: z.string(),
  expiry_hours: z.number(),
};
export const FileSignedUrlOutputSchema = z.object(FileSignedUrlOutputShape);

// ---------- helpers ----------

function decodeBase64(data: string): Uint8Array {
  // Strip optional data URI prefix: `data:mime;base64,...`
  const stripped = data.startsWith("data:")
    ? data.slice(data.indexOf(",") + 1)
    : data;
  return Uint8Array.from(Buffer.from(stripped, "base64"));
}

// ---------- registration ----------

export function registerFileTools(server: McpServer, mistral: Mistral) {
  // ========== files_upload ==========
  server.registerTool(
    "files_upload",
    {
      title: "Upload a file to Mistral",
      description: [
        "Upload a file (up to 512 MB) and get a `fileId` that can be referenced by",
        "`mistral_ocr`, `voxtral_transcribe`, batch jobs, or fine-tuning.",
        "",
        "Inputs:",
        "  - `filename`: user-visible name (e.g. 'contract.pdf').",
        "  - `content_base64`: file bytes, base64-encoded. `data:` URI prefix accepted.",
        "  - `purpose`: 'fine-tune' (.jsonl only), 'batch' (.jsonl), or 'ocr' (pdf/image).",
        "  - `visibility`: 'user' (default) or 'workspace' (shared with your team).",
        "  - `expiry_days`: optional auto-delete after N days.",
      ].join("\n"),
      inputSchema: {
        filename: z.string().min(1),
        content_base64: z
          .string()
          .min(1)
          .describe("Base64-encoded file bytes. `data:...;base64,` prefix accepted."),
        purpose: FilePurposeSchema.optional().describe(
          "File purpose. Fine-tuning requires .jsonl. Default: unset (server picks)."
        ),
        visibility: FileVisibilitySchema.optional(),
        expiry_days: z.number().int().positive().optional(),
      },
      outputSchema: FileUploadOutputShape,
      annotations: {
        title: "Upload file",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const bytes = decodeBase64(input.content_base64);
        const res = await mistral.files.upload({
          file: { fileName: input.filename, content: bytes },
          purpose: input.purpose,
          visibility: input.visibility,
          expiry: input.expiry_days,
        });

        const structured = normalizeFile(res);
        return {
          content: [
            toTextBlock(
              `Uploaded ${res.filename} (${res.sizeBytes} bytes) as ${res.id}.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("files_upload", err);
      }
    }
  );

  // ========== files_list ==========
  server.registerTool(
    "files_list",
    {
      title: "List Mistral files",
      description:
        "List files owned by this API key, with optional filters. " +
        "Use `include_total: true` to get the total count across pages.",
      inputSchema: {
        page: z.number().int().nonnegative().optional(),
        page_size: z.number().int().positive().optional(),
        purpose: FilePurposeSchema.optional(),
        search: z.string().optional(),
        mimetypes: z.array(z.string()).optional(),
        include_total: z.boolean().optional(),
      },
      outputSchema: FileListOutputShape,
      annotations: {
        title: "List files",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.files.list({
          page: input.page,
          pageSize: input.page_size,
          purpose: input.purpose,
          search: input.search,
          mimetypes: input.mimetypes,
          includeTotal: input.include_total,
        });

        const data = (res.data ?? []).map(normalizeFile);
        const structured = {
          data,
          object: res.object,
          total: res.total ?? undefined,
          count: data.length,
        };

        return {
          content: [
            toTextBlock(
              `Listed ${data.length} file(s)${res.total != null ? ` (total: ${res.total})` : ""}.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("files_list", err);
      }
    }
  );

  // ========== files_get ==========
  server.registerTool(
    "files_get",
    {
      title: "Get Mistral file metadata",
      description: "Retrieve a single file's metadata by id.",
      inputSchema: {
        fileId: z.string().min(1),
      },
      outputSchema: FileGetOutputShape,
      annotations: {
        title: "Get file",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.files.retrieve({ fileId: input.fileId });
        const base = normalizeFile(res);
        const structured = { ...base, deleted: res.deleted };
        return {
          content: [
            toTextBlock(
              `File ${res.id}: ${res.filename} (${res.sizeBytes} bytes, purpose=${res.purpose}).`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("files_get", err);
      }
    }
  );

  // ========== files_delete ==========
  server.registerTool(
    "files_delete",
    {
      title: "Delete a Mistral file",
      description: "Delete a file by id. This is irreversible.",
      inputSchema: {
        fileId: z.string().min(1),
      },
      outputSchema: FileDeleteOutputShape,
      annotations: {
        title: "Delete file",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.files.delete({ fileId: input.fileId });
        const structured = {
          id: res.id,
          object: res.object,
          deleted: res.deleted,
        };
        return {
          content: [
            toTextBlock(
              res.deleted
                ? `Deleted file ${res.id}.`
                : `Delete request for ${res.id} did not succeed.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("files_delete", err);
      }
    }
  );

  // ========== files_signed_url ==========
  server.registerTool(
    "files_signed_url",
    {
      title: "Get a signed download URL",
      description:
        "Generate a short-lived, signed URL to download a file. " +
        "Expiry is in hours (1–168). Defaults to 24h server-side.",
      inputSchema: {
        fileId: z.string().min(1),
        expiry_hours: z.number().int().min(1).max(168).optional(),
      },
      outputSchema: FileSignedUrlOutputShape,
      annotations: {
        title: "Signed URL",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const expiry = input.expiry_hours ?? 24;
        const res = await mistral.files.getSignedUrl({
          fileId: input.fileId,
          expiry,
        });
        const structured = {
          url: res.url,
          file_id: input.fileId,
          expiry_hours: expiry,
        };
        return {
          content: [toTextBlock(`Signed URL (valid ${expiry}h): ${res.url}`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("files_signed_url", err);
      }
    }
  );
}
