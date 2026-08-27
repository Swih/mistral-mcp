/**
 * v0.10 tools — search-index deployment discovery.
 *
 * Source: SDK `mistral.beta.rag.searchIndexes` → `GET /v1/rag/deployments`.
 *
 * Context: since Agentic Search (2026-08-20) Mistral's retrieval story is
 * split in two. Ingestion and querying run in the **Mistral Search Toolkit**, a
 * Python framework the operator hosts themselves (Mistral OCR → chunking →
 * embeddings → a self-hosted Vespa → RRF hybrid reranking), and that toolkit
 * already exposes its own `search / open / navigate / read / grep` tools over
 * MCP. The control plane — which index deployments exist and are reachable —
 * lives in the Mistral API.
 *
 * So this server deliberately does **not** reimplement retrieval: duplicating
 * a first-party MCP surface would mean two catalogues drifting apart. What is
 * missing, and what this adds, is the one question an agent needs answered
 * before it can use any of it: *which indexes can I search from here?*
 *
 * Read-only on purpose, same scoping rule as `connectors_*` and `libraries_*`:
 * `registerDeployment` / `unregisterDeployment` / `updateIndexMetrics` mutate
 * shared infrastructure and belong to a deploy pipeline, not to a tool an LLM
 * drives unattended.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

const VespaIndexSchema = z.object({
  id: z.string(),
  name: z.string(),
  document_count: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe("null when the backend has not reported a count yet."),
});

const DeploymentSchema = z.object({
  id: z.string(),
  name: z.string(),
  creator_id: z.string().optional(),
  document_count: z.number().int().optional(),
  status: z
    .string()
    .optional()
    .describe("Deployment state as reported by the API. Kept as a free string — new states must not break the tool."),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  backend: z
    .string()
    .optional()
    .describe('Index backend, e.g. "vespa".'),
  indexes: z
    .array(VespaIndexSchema)
    .optional()
    .describe("Individual indexes inside this deployment."),
});

export const RagIndexesListOutputShape = {
  deployments: z.array(DeploymentSchema),
  count: z.number().int(),
};
export const RagIndexesListOutputSchema = z.object(RagIndexesListOutputShape);

/** Dates come back as `Date` from the SDK; ISO strings travel better over JSON-RPC. */
function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

export function registerRagTools(server: McpServer, mistral: Mistral) {
  server.registerTool(
    "rag_indexes_list",
    {
      title: "List registered search-index deployments",
      description: [
        "List the search-index deployments registered with Mistral and visible to this",
        "API key — the corpora an agent can retrieve from.",
        "",
        "When to use:",
        "- Before any retrieval, to discover which indexes exist and whether they are ready.",
        "- To map a human-readable corpus name onto the index id a retrieval tool needs.",
        "",
        "This tool does not search. Retrieval itself runs in the Mistral Search Toolkit",
        "(self-hosted, exposes its own MCP tools) or in Mistral Libraries — pair a",
        "library id with `conversation_start`'s `documentLibraryIds` for the managed path.",
        "",
        "Registering or removing a deployment is a deploy-pipeline operation and is",
        "deliberately not exposed here.",
        "",
        "Returns one entry per deployment with its id, name, status, document count, and",
        "nested indexes. An account with no registered deployment returns an empty list,",
        "which is a valid answer and not an error.",
      ].join("\n"),
      inputSchema: {},
      outputSchema: RagIndexesListOutputShape,
      annotations: {
        title: "List search-index deployments",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const res = await mistral.beta.rag.searchIndexes.getDeploymentSummaries();
        const deployments = (res.deployments ?? []).map((d) => {
          const inner = d.deployment as
            | { type?: string; indexes?: Array<{ id: string; name: string; documentCount: number | null }> }
            | undefined;
          return {
            id: d.id,
            name: d.name,
            creator_id: d.creatorId,
            document_count: d.documentCount,
            status: typeof d.status === "string" ? d.status : undefined,
            created_at: toIso(d.createdAt),
            modified_at: toIso(d.modifiedAt),
            backend: inner?.type,
            indexes: inner?.indexes?.map((i) => ({
              id: i.id,
              name: i.name,
              document_count: i.documentCount,
            })),
          };
        });

        const structured = { deployments, count: deployments.length };
        const summary =
          deployments.length === 0
            ? "No search-index deployment is registered for this API key."
            : deployments
                .map(
                  (d) =>
                    `${d.name} (${d.id})${d.status ? ` — ${d.status}` : ""}${
                      d.document_count !== undefined ? `, ${d.document_count} docs` : ""
                    }`
                )
                .join("\n");

        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("rag_indexes_list", err);
      }
    }
  );
}
