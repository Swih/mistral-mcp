/**
 * v0.4 tools — Batch API.
 *
 * Source: https://docs.mistral.ai/capabilities/batch/
 *   Batch inference lets you submit a JSONL of requests in one go and
 *   collect the results asynchronously at a ~50 % discount vs. live calls.
 *
 * Tools exposed:
 *   - batch_create   (POST  /v1/batch/jobs)
 *   - batch_get      (GET   /v1/batch/jobs/{job_id})
 *   - batch_list     (GET   /v1/batch/jobs)
 *   - batch_cancel   (POST  /v1/batch/jobs/{job_id}/cancel)
 *
 * Workflow: upload a JSONL via `files_upload` with purpose=batch, feed the
 * returned `fileId` into `batch_create`, then poll `batch_get` until status
 * is SUCCESS / FAILED / CANCELLED. Download results via `files_signed_url`
 * on the `output_file` id.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- enums ----------

const BATCH_ENDPOINTS = [
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/fim/completions",
  "/v1/moderations",
  "/v1/chat/moderations",
  "/v1/ocr",
  "/v1/classifications",
  "/v1/chat/classifications",
  "/v1/conversations",
  "/v1/audio/transcriptions",
] as const;

const BATCH_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "TIMEOUT_EXCEEDED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
] as const;

const BatchEndpointSchema = z.enum(BATCH_ENDPOINTS);
const BatchStatusSchema = z.enum(BATCH_STATUSES);

// ---------- shared batch job schema ----------

const BatchJobShape = {
  id: z.string(),
  object: z.literal("batch"),
  input_files: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
  endpoint: z.string(),
  model: z.string().optional(),
  agent_id: z.string().optional(),
  output_file: z.string().optional(),
  error_file: z.string().optional(),
  errors: z.array(z.unknown()),
  status: z.string(),
  created_at: z.number(),
  started_at: z.number().optional(),
  completed_at: z.number().optional(),
  total_requests: z.number(),
  completed_requests: z.number(),
  succeeded_requests: z.number(),
  failed_requests: z.number(),
};
const BatchJobSchema = z.object(BatchJobShape);

function normalizeBatchJob(raw: {
  id: string;
  object: "batch";
  inputFiles: string[];
  metadata?: Record<string, unknown> | null;
  endpoint: string;
  model?: string | null;
  agentId?: string | null;
  outputFile?: string | null;
  errorFile?: string | null;
  errors: unknown[];
  status: string;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  totalRequests: number;
  completedRequests: number;
  succeededRequests: number;
  failedRequests: number;
}): z.infer<typeof BatchJobSchema> {
  return {
    id: raw.id,
    object: raw.object,
    input_files: raw.inputFiles,
    metadata: raw.metadata ?? undefined,
    endpoint: raw.endpoint,
    model: raw.model ?? undefined,
    agent_id: raw.agentId ?? undefined,
    output_file: raw.outputFile ?? undefined,
    error_file: raw.errorFile ?? undefined,
    errors: raw.errors,
    status: raw.status,
    created_at: raw.createdAt,
    started_at: raw.startedAt ?? undefined,
    completed_at: raw.completedAt ?? undefined,
    total_requests: raw.totalRequests,
    completed_requests: raw.completedRequests,
    succeeded_requests: raw.succeededRequests,
    failed_requests: raw.failedRequests,
  };
}

// ---------- output schemas (exported for contract tests) ----------

export const BatchJobOutputShape = { ...BatchJobShape };
export const BatchJobOutputSchema = BatchJobSchema;

export const BatchListOutputShape = {
  data: z.array(BatchJobSchema),
  object: z.literal("list"),
  total: z.number(),
  count: z.number(),
};
export const BatchListOutputSchema = z.object(BatchListOutputShape);

// ---------- registration ----------

export function registerBatchTools(server: McpServer, mistral: Mistral) {
  // ========== batch_create ==========
  server.registerTool(
    "batch_create",
    {
      title: "Create a Mistral batch job",
      description: [
        "Create an asynchronous batch inference job from one or more .jsonl input files.",
        "",
        "Prerequisites: upload your JSONL via `files_upload` with `purpose: 'batch'`.",
        "Each JSONL line is `{ custom_id, body: { ... same shape as the endpoint } }`.",
        "",
        "Batch processing is ~50% cheaper than live inference, at the cost of latency",
        "(minutes to 24h, depending on queue and `timeout_hours`).",
        "",
        "Poll with `batch_get`; once `status` is SUCCESS, download the result file",
        "via `files_signed_url({ fileId: output_file })`.",
      ].join("\n"),
      inputSchema: {
        input_files: z
          .array(z.string().min(1))
          .min(1)
          .describe("Array of `fileId`s (uploaded with `purpose: 'batch'`)."),
        endpoint: BatchEndpointSchema.describe(
          "Target API endpoint; all rows in input_files must match this endpoint."
        ),
        model: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        timeout_hours: z.number().int().min(1).max(168).optional(),
      },
      outputSchema: BatchJobOutputShape,
      annotations: {
        title: "Create batch job",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.batch.jobs.create({
          inputFiles: input.input_files,
          endpoint: input.endpoint,
          model: input.model,
          metadata: input.metadata,
          timeoutHours: input.timeout_hours,
        });
        const structured = normalizeBatchJob(res);
        return {
          content: [
            toTextBlock(
              `Created batch job ${res.id} (status: ${res.status}, ${res.totalRequests} requests).`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("batch_create", err);
      }
    }
  );

  // ========== batch_get ==========
  server.registerTool(
    "batch_get",
    {
      title: "Get a batch job",
      description:
        "Fetch a batch job's current status and counters. " +
        "When `status: 'SUCCESS'`, the `output_file` is ready for download.",
      inputSchema: {
        jobId: z.string().min(1),
      },
      outputSchema: BatchJobOutputShape,
      annotations: {
        title: "Get batch job",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.batch.jobs.get({ jobId: input.jobId });
        const structured = normalizeBatchJob(res);
        const pct =
          res.totalRequests > 0
            ? Math.round((res.completedRequests / res.totalRequests) * 100)
            : 0;
        return {
          content: [
            toTextBlock(
              `Batch ${res.id}: ${res.status} — ${res.completedRequests}/${res.totalRequests} done (${pct}%).`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("batch_get", err);
      }
    }
  );

  // ========== batch_list ==========
  server.registerTool(
    "batch_list",
    {
      title: "List batch jobs",
      description: "List batch jobs with optional filters.",
      inputSchema: {
        page: z.number().int().nonnegative().optional(),
        page_size: z.number().int().positive().optional(),
        model: z.string().optional(),
        status: z.array(BatchStatusSchema).optional(),
        created_after: z
          .string()
          .optional()
          .describe("ISO-8601 timestamp; only jobs created after are returned."),
        created_by_me: z.boolean().optional(),
        order_by: z.enum(["created", "-created"]).optional(),
      },
      outputSchema: BatchListOutputShape,
      annotations: {
        title: "List batch jobs",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.batch.jobs.list({
          page: input.page,
          pageSize: input.page_size,
          model: input.model,
          status: input.status,
          createdAfter: input.created_after
            ? new Date(input.created_after)
            : undefined,
          createdByMe: input.created_by_me,
          orderBy: input.order_by,
        });
        const data = (res.data ?? []).map(normalizeBatchJob);
        const structured = {
          data,
          object: res.object,
          total: res.total,
          count: data.length,
        };
        return {
          content: [
            toTextBlock(`Listed ${data.length} batch job(s) (total: ${res.total}).`),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("batch_list", err);
      }
    }
  );

  // ========== batch_cancel ==========
  server.registerTool(
    "batch_cancel",
    {
      title: "Cancel a batch job",
      description:
        "Request cancellation of a running batch job. Completed requests still count for billing.",
      inputSchema: {
        jobId: z.string().min(1),
      },
      outputSchema: BatchJobOutputShape,
      annotations: {
        title: "Cancel batch job",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.batch.jobs.cancel({ jobId: input.jobId });
        const structured = normalizeBatchJob(res);
        return {
          content: [toTextBlock(`Cancellation requested for ${res.id} (now ${res.status}).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("batch_cancel", err);
      }
    }
  );
}
