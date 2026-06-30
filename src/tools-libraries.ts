/**
 * Mistral Libraries tools — discover and use already-created Mistral
 * Libraries (managed RAG document stores) from the agent loop.
 *
 * Source: https://docs.mistral.ai/agents/libraries/ (beta)
 * SDK: mistral.beta.libraries.{list,get}, mistral.beta.libraries.documents.{list,upload,status}
 *
 * Scope (deliberately conservative, same philosophy as tools-connectors.ts):
 *   - Library lifecycle (create/update/delete) and sharing (`accesses`) are
 *     out of scope. Creating/owning/deleting a Library and managing who can
 *     access it are org-structural operations better done deliberately
 *     (dashboard or a dedicated admin flow), not invoked unattended by an LLM.
 *   - Document upload IS exposed: once a Library exists, adding source
 *     documents to it is the core "use it for RAG" action — the same
 *     reasoning that puts `files_upload` in the admin profile.
 *   - Document delete/update/reprocess/signed-url endpoints are out of scope
 *     for v1 to keep the surface lean; `libraries_documents_list` +
 *     `libraries_documents_status` cover the read loop a caller needs after
 *     uploading. Pair a Library's `id` with `documentLibraryIds` on
 *     `conversation_start` to actually search it.
 *
 * Five tools: libraries_list, libraries_get, libraries_documents_list,
 * libraries_documents_upload, libraries_documents_status.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- helpers ----------

function decodeBase64(data: string): Uint8Array {
  const stripped = data.startsWith("data:")
    ? data.slice(data.indexOf(",") + 1)
    : data;
  return Uint8Array.from(Buffer.from(stripped, "base64"));
}

function isoDate(d: unknown): string {
  return d instanceof Date ? d.toISOString() : String(d ?? "");
}

// ---------- shared schemas ----------

const LibrarySummaryShape = {
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  owner_id: z.string().nullable(),
  owner_type: z.string(),
  total_size: z.number(),
  nb_documents: z.number(),
};
const LibrarySummarySchema = z.object(LibrarySummaryShape);

function toLibrarySummary(raw: unknown): z.infer<typeof LibrarySummarySchema> {
  const l = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(l.id ?? ""),
    name: String(l.name ?? ""),
    description: typeof l.description === "string" ? l.description : undefined,
    created_at: isoDate(l.createdAt),
    updated_at: isoDate(l.updatedAt),
    owner_id: typeof l.ownerId === "string" ? l.ownerId : null,
    owner_type: String(l.ownerType ?? ""),
    total_size: typeof l.totalSize === "number" ? l.totalSize : 0,
    nb_documents: typeof l.nbDocuments === "number" ? l.nbDocuments : 0,
  };
}

const PaginationShape = {
  total_items: z.number(),
  total_pages: z.number(),
  current_page: z.number(),
  page_size: z.number(),
  has_more: z.boolean(),
};
const PaginationSchema = z.object(PaginationShape);

function toPagination(raw: unknown): z.infer<typeof PaginationSchema> {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    total_items: typeof p.totalItems === "number" ? p.totalItems : 0,
    total_pages: typeof p.totalPages === "number" ? p.totalPages : 0,
    current_page: typeof p.currentPage === "number" ? p.currentPage : 0,
    page_size: typeof p.pageSize === "number" ? p.pageSize : 0,
    has_more: Boolean(p.hasMore),
  };
}

const DocumentSummaryShape = {
  id: z.string(),
  library_id: z.string(),
  name: z.string(),
  mime_type: z.string().nullable(),
  extension: z.string().nullable(),
  size: z.number().nullable(),
  summary: z.string().optional(),
  created_at: z.string(),
  last_processed_at: z.string().optional(),
  number_of_pages: z.number().optional(),
  process_status: z.string(),
};
const DocumentSummarySchema = z.object(DocumentSummaryShape);

function toDocumentSummary(raw: unknown): z.infer<typeof DocumentSummarySchema> {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? ""),
    library_id: String(d.libraryId ?? ""),
    name: String(d.name ?? ""),
    mime_type: typeof d.mimeType === "string" ? d.mimeType : null,
    extension: typeof d.extension === "string" ? d.extension : null,
    size: typeof d.size === "number" ? d.size : null,
    summary: typeof d.summary === "string" ? d.summary : undefined,
    created_at: isoDate(d.createdAt),
    last_processed_at: d.lastProcessedAt ? isoDate(d.lastProcessedAt) : undefined,
    number_of_pages: typeof d.numberOfPages === "number" ? d.numberOfPages : undefined,
    process_status: String(d.processStatus ?? "unknown"),
  };
}

// ---------- output schemas (exported for contract tests) ----------

export const LibrariesListOutputShape = {
  libraries: z.array(LibrarySummarySchema),
  pagination: PaginationSchema,
};
export const LibrariesListOutputSchema = z.object(LibrariesListOutputShape);

export const LibrariesGetOutputShape = {
  library: LibrarySummarySchema,
};
export const LibrariesGetOutputSchema = z.object(LibrariesGetOutputShape);

export const LibrariesDocumentsListOutputShape = {
  documents: z.array(DocumentSummarySchema),
  pagination: PaginationSchema,
};
export const LibrariesDocumentsListOutputSchema = z.object(LibrariesDocumentsListOutputShape);

export const LibrariesDocumentsUploadOutputShape = {
  document: DocumentSummarySchema,
};
export const LibrariesDocumentsUploadOutputSchema = z.object(LibrariesDocumentsUploadOutputShape);

export const LibrariesDocumentsStatusOutputShape = {
  document_id: z.string(),
  process_status: z.string(),
};
export const LibrariesDocumentsStatusOutputSchema = z.object(LibrariesDocumentsStatusOutputShape);

// ---------- registration ----------

export function registerLibraryTools(server: McpServer, mistral: Mistral) {
  // ========== libraries_list ==========
  server.registerTool(
    "libraries_list",
    {
      title: "List Mistral Libraries",
      description:
        "List Libraries (managed RAG document stores) you own or have been shared with you. " +
        "Use a returned `id` as a `documentLibraryIds` entry on conversation_start to search it.",
      inputSchema: {
        page: z.number().int().nonnegative().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
        search: z.string().optional().describe("Case-insensitive search on the library name."),
      },
      outputSchema: LibrariesListOutputShape,
      annotations: {
        title: "List Mistral Libraries",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.libraries.list({
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
        });
        const structured = {
          libraries: res.data.map(toLibrarySummary),
          pagination: toPagination(res.pagination),
        };
        return {
          content: [toTextBlock(`Found ${structured.libraries.length} librar${structured.libraries.length === 1 ? "y" : "ies"}.`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("libraries_list", err);
      }
    }
  );

  // ========== libraries_get ==========
  server.registerTool(
    "libraries_get",
    {
      title: "Get a Mistral Library",
      description: "Fetch a Library's metadata (owner, size, document count).",
      inputSchema: {
        libraryId: z.string().min(1),
      },
      outputSchema: LibrariesGetOutputShape,
      annotations: {
        title: "Get Mistral Library",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.libraries.get({ libraryId: input.libraryId });
        const structured = { library: toLibrarySummary(res) };
        return {
          content: [toTextBlock(`Library ${structured.library.name} (${structured.library.nb_documents} docs).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("libraries_get", err);
      }
    }
  );

  // ========== libraries_documents_list ==========
  server.registerTool(
    "libraries_documents_list",
    {
      title: "List documents in a Mistral Library",
      description: "List the documents uploaded to a Library, with their processing status.",
      inputSchema: {
        libraryId: z.string().min(1),
        page: z.number().int().nonnegative().optional(),
        pageSize: z.number().int().positive().max(100).optional(),
        search: z.string().optional(),
      },
      outputSchema: LibrariesDocumentsListOutputShape,
      annotations: {
        title: "List Library documents",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.libraries.documents.list({
          libraryId: input.libraryId,
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
        });
        const structured = {
          documents: res.data.map(toDocumentSummary),
          pagination: toPagination(res.pagination),
        };
        return {
          content: [toTextBlock(`Found ${structured.documents.length} document(s).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("libraries_documents_list", err);
      }
    }
  );

  // ========== libraries_documents_upload ==========
  server.registerTool(
    "libraries_documents_upload",
    {
      title: "Upload a document to a Mistral Library",
      description: [
        "Upload a document (base64-encoded bytes) to a Library for RAG indexing.",
        "Processing happens server-side and asynchronously — the document is not",
        "searchable until `process_status` reaches 'done'. Poll with",
        "libraries_documents_status to track it.",
      ].join("\n"),
      inputSchema: {
        libraryId: z.string().min(1),
        filename: z.string().min(1),
        content_base64: z
          .string()
          .min(1)
          .describe("Base64-encoded file bytes. `data:...;base64,` prefix accepted."),
      },
      outputSchema: LibrariesDocumentsUploadOutputShape,
      annotations: {
        title: "Upload document to Library",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const bytes = decodeBase64(input.content_base64);
        const res = await mistral.beta.libraries.documents.upload({
          libraryId: input.libraryId,
          requestBody: {
            file: { fileName: input.filename, content: bytes },
          },
        });
        const structured = { document: toDocumentSummary(res) };
        return {
          content: [toTextBlock(`Uploaded ${structured.document.name} as ${structured.document.id} (status: ${structured.document.process_status}).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("libraries_documents_upload", err);
      }
    }
  );

  // ========== libraries_documents_status ==========
  server.registerTool(
    "libraries_documents_status",
    {
      title: "Get a Library document's processing status",
      description: "Check whether an uploaded document has finished processing and is searchable.",
      inputSchema: {
        libraryId: z.string().min(1),
        documentId: z.string().min(1),
      },
      outputSchema: LibrariesDocumentsStatusOutputShape,
      annotations: {
        title: "Get Library document status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.libraries.documents.status({
          libraryId: input.libraryId,
          documentId: input.documentId,
        });
        const structured = {
          document_id: res.documentId,
          process_status: String(res.processStatus),
        };
        return {
          content: [toTextBlock(`Document ${structured.document_id}: ${structured.process_status}.`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("libraries_documents_status", err);
      }
    }
  );
}
