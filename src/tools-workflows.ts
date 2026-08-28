/**
 * v0.6 tools — Mistral Workflows (durable, event-driven execution engine).
 *
 * Sources:
 * - https://docs.mistral.ai/capabilities/workflows/
 * - SDK: mistral.workflows.executeWorkflow / executions.getWorkflowExecution /
 *   executions.signalWorkflowExecution / executions.queryWorkflowExecution
 *
 * Three tools:
 *   workflow_execute   — start a workflow execution (sync or async)
 *   workflow_status    — get execution state + result
 *   workflow_interact  — send a signal or run a query against a running execution
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- output schemas (exported for contract tests) ----------

export const WorkflowExecuteOutputShape = {
  workflow_name: z.string(),
  execution_id: z.string(),
  sync: z.boolean().describe("true when waitForResult=true (result is inline)."),
  status: z.string().nullable().optional(),
  result: z.unknown().nullable().optional(),
  root_execution_id: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().nullable().optional(),
  total_duration_ms: z.number().nullable().optional(),
};
export const WorkflowExecuteOutputSchema = z.object(WorkflowExecuteOutputShape);

export const WorkflowStatusOutputShape = {
  workflow_name: z.string(),
  execution_id: z.string(),
  root_execution_id: z.string(),
  status: z.string().nullable(),
  result: z.unknown().nullable(),
  start_time: z.string(),
  end_time: z.string().nullable(),
  total_duration_ms: z.number().nullable().optional(),
};
export const WorkflowStatusOutputSchema = z.object(WorkflowStatusOutputShape);

export const WorkflowInteractOutputShape = {
  action: z.enum(["signal", "query", "update"]),
  execution_id: z.string(),
  message: z.string().optional().describe("Confirmation message for signal actions."),
  query_name: z.string().optional(),
  update_name: z.string().optional(),
  result: z.unknown().optional().describe("Query or update result payload."),
};
export const WorkflowInteractOutputSchema = z.object(WorkflowInteractOutputShape);


export const WorkflowDeploymentsListOutputShape = {
  deployments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_active: z
        .boolean()
        .describe("At least one worker is currently live. Only an active deployment can run a workflow."),
      is_hardened: z.boolean().describe("The deployment has at least one authorized credential."),
      worker_count: z.number().int(),
      active_worker_count: z.number().int(),
      managed: z.boolean().describe("false for a self-hosted deployment."),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })
  ),
  count: z.number().int(),
  runnable_count: z
    .number()
    .int()
    .describe("Deployments with at least one live worker. Zero means no workflow can run right now."),
};
export const WorkflowDeploymentsListOutputSchema = z.object(WorkflowDeploymentsListOutputShape);

/** Terminal and in-flight execution states, per components.WorkflowExecutionStatus. */
export const WORKFLOW_EXECUTION_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "TERMINATED",
  "CONTINUED_AS_NEW",
  "TIMED_OUT",
  "RETRYING_AFTER_ERROR",
] as const;

export const WorkflowRunsListOutputShape = {
  executions: z.array(
    z.object({
      workflow_name: z.string(),
      execution_id: z.string(),
      root_execution_id: z.string().optional(),
      status: z.string().nullable().optional(),
      deployment_name: z.string().nullable().optional(),
      start_time: z.string().optional(),
      end_time: z.string().nullable().optional(),
    })
  ),
  count: z.number().int(),
  next_page_token: z.string().nullable().optional(),
};
export const WorkflowRunsListOutputSchema = z.object(WorkflowRunsListOutputShape);

export const WorkflowStopOutputShape = {
  execution_id: z.string(),
  mode: z.enum(["cancel", "terminate"]),
  requested: z.literal(true).describe("The API accepted the request; the execution winds down asynchronously."),
};
export const WorkflowStopOutputSchema = z.object(WorkflowStopOutputShape);

/** Dates arrive as `Date` from the SDK; ISO strings travel better over JSON-RPC. */
function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}
// ---------- registration ----------

export function registerWorkflowTools(server: McpServer, mistral: Mistral) {
  // ========== workflow_execute ==========
  server.registerTool(
    "workflow_execute",
    {
      title: "Execute a Mistral workflow",
      description: [
        "Start a Mistral Workflow execution.",
        "",
        "`workflowIdentifier` is the workflow name or ID (visible in mistral://workflows).",
        "`input` is a free-form JSON object matching the workflow's input schema.",
        "",
        "Modes:",
        "  - waitForResult=false (default): returns immediately with execution_id and RUNNING status.",
        "    Poll workflow_status to track completion.",
        "  - waitForResult=true: blocks until the workflow finishes and returns the result inline.",
        "    Use timeoutSeconds (default 30) to cap the wait.",
        "",
        "Use deploymentName to target a specific deployment slot when multiple are configured.",
      ].join("\n"),
      inputSchema: z.object({
              workflowIdentifier: z.string().min(1).describe("Workflow name or ID."),
              input: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Input payload matching the workflow input schema."),
              executionId: z
                .string()
                .optional()
                .describe("Optional custom execution ID. Auto-generated if omitted."),
              waitForResult: z
                .boolean()
                .optional()
                .describe("Block until completion and return result inline. Default: false."),
              timeoutSeconds: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Max wait time when waitForResult=true. Default: 30."),
              deploymentName: z
                .string()
                .optional()
                .describe("Target a specific deployment slot."),
            }),
      outputSchema: WorkflowExecuteOutputSchema,
      annotations: {
        title: "Execute Mistral workflow",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.workflows.executeWorkflow({
          workflowIdentifier: input.workflowIdentifier,
          workflowExecutionRequest: {
            input: input.input ?? null,
            executionId: input.executionId,
            waitForResult: input.waitForResult ?? false,
            timeoutSeconds: input.timeoutSeconds,
            deploymentName: input.deploymentName,
          },
        });

        const sync = input.waitForResult === true;
        let structured: z.infer<typeof WorkflowExecuteOutputSchema>;

        if (sync && "result" in res && !("status" in res)) {
          // WorkflowExecutionSyncResponse
          const syncRes = res as { workflowName: string; executionId: string; result: unknown };
          structured = {
            workflow_name: syncRes.workflowName,
            execution_id: syncRes.executionId,
            sync: true,
            result: syncRes.result,
          };
        } else {
          // WorkflowExecutionResponse
          const asyncRes = res as {
            workflowName: string;
            executionId: string;
            rootExecutionId: string;
            status: string | null;
            startTime: Date;
            endTime: Date | null;
            result: unknown;
            totalDurationMs?: number | null;
          };
          structured = {
            workflow_name: asyncRes.workflowName,
            execution_id: asyncRes.executionId,
            sync: false,
            status: asyncRes.status,
            result: asyncRes.result,
            root_execution_id: asyncRes.rootExecutionId,
            start_time: asyncRes.startTime instanceof Date
              ? asyncRes.startTime.toISOString()
              : String(asyncRes.startTime),
            end_time: asyncRes.endTime instanceof Date
              ? asyncRes.endTime.toISOString()
              : asyncRes.endTime
                ? String(asyncRes.endTime)
                : null,
            total_duration_ms: asyncRes.totalDurationMs ?? null,
          };
        }

        const summary = sync
          ? `Workflow ${structured.workflow_name} completed (${structured.execution_id}).`
          : `Workflow ${structured.workflow_name} started as ${structured.execution_id} — status: ${structured.status}.`;

        return {
          content: [toTextBlock(summary)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("workflow_execute", err);
      }
    }
  );

  // ========== workflow_status ==========
  server.registerTool(
    "workflow_status",
    {
      title: "Get workflow execution status",
      description: [
        "Get the current state and result of a workflow execution.",
        "",
        "Statuses: RUNNING | COMPLETED | FAILED | CANCELED | TERMINATED |",
        "          CONTINUED_AS_NEW | TIMED_OUT | RETRYING_AFTER_ERROR",
        "",
        "Poll until status is COMPLETED (or terminal) when waitForResult was false.",
        "`result` is populated once the workflow reaches a terminal state.",
      ].join("\n"),
      inputSchema: z.object({
              executionId: z.string().min(1).describe("Execution ID from workflow_execute."),
            }),
      outputSchema: WorkflowStatusOutputSchema,
      annotations: {
        title: "Workflow execution status",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.workflows.executions.getWorkflowExecution({
          executionId: input.executionId,
        });

        const structured = {
          workflow_name: res.workflowName,
          execution_id: res.executionId,
          root_execution_id: res.rootExecutionId,
          status: res.status,
          result: res.result,
          start_time: res.startTime instanceof Date
            ? res.startTime.toISOString()
            : String(res.startTime),
          end_time: res.endTime instanceof Date
            ? res.endTime.toISOString()
            : res.endTime
              ? String(res.endTime)
              : null,
          total_duration_ms: res.totalDurationMs ?? null,
        };

        return {
          content: [toTextBlock(`${res.workflowName} [${res.executionId}] — ${res.status ?? "UNKNOWN"}.`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("workflow_status", err);
      }
    }
  );

  // ========== workflow_interact ==========
  server.registerTool(
    "workflow_interact",
    {
      title: "Signal, query, or update a running workflow",
      description: [
        "Send a signal to or run a query against a running workflow execution.",
        "",
        "action=signal: fire-and-forget event; the workflow reacts asynchronously.",
        "  - `name`: signal name defined in the workflow.",
        "  - `input`: optional payload matching the signal's schema.",
        "",
        "action=query: synchronous read of internal workflow state.",
        "  - `name`: query handler name defined in the workflow.",
        "  - `input`: optional parameters for the query.",
        "  - Returns `query_name` + `result` inline.",
        "",
        "action=update: synchronous request to modify workflow state mid-execution.",
        "  - `name`: update handler name defined in the workflow.",
        "  - `input`: optional payload for the update.",
        "  - Returns `update_name` + `result` inline.",
      ].join("\n"),
      inputSchema: z.object({
              action: z.enum(["signal", "query", "update"]).describe("Interaction type."),
              executionId: z.string().min(1).describe("Target execution ID."),
              name: z
                .string()
                .min(1)
                .describe("Signal or query handler name."),
              input: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Optional payload for the signal or query."),
            }),
      outputSchema: WorkflowInteractOutputSchema,
      annotations: {
        title: "Interact with running workflow (signal/query/update)",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        if (input.action === "signal") {
          const res = await mistral.workflows.executions.signalWorkflowExecution({
            executionId: input.executionId,
            signalInvocationBody: {
              name: input.name,
              input: input.input ?? null,
            },
          });

          const structured = {
            action: "signal" as const,
            execution_id: input.executionId,
            message: res.message,
          };

          return {
            content: [toTextBlock(`Signal '${input.name}' sent to ${input.executionId}: ${res.message}`)],
            structuredContent: structured,
          };
        } else if (input.action === "query") {
          const res = await mistral.workflows.executions.queryWorkflowExecution({
            executionId: input.executionId,
            queryInvocationBody: {
              name: input.name,
              input: input.input ?? null,
            },
          });

          const structured = {
            action: "query" as const,
            execution_id: input.executionId,
            query_name: res.queryName,
            result: res.result,
          };

          return {
            content: [toTextBlock(`Query '${res.queryName}' on ${input.executionId}: ${JSON.stringify(res.result)}`)],
            structuredContent: structured,
          };
        } else {
          const res = await mistral.workflows.executions.updateWorkflowExecution({
            executionId: input.executionId,
            updateInvocationBody: {
              name: input.name,
              input: input.input ?? null,
            },
          });

          const structured = {
            action: "update" as const,
            execution_id: input.executionId,
            update_name: res.updateName,
            result: res.result,
          };

          return {
            content: [toTextBlock(`Update '${res.updateName}' on ${input.executionId}: ${JSON.stringify(res.result)}`)],
            structuredContent: structured,
          };
        }
      } catch (err) {
        return errorResult("workflow_interact", err);
      }
    }
  );

  // ========== workflow_deployments_list ==========
  server.registerTool(
    "workflow_deployments_list",
    {
      title: "List workflow deployments",
      description: [
        "List the workflow deployments in this workspace and whether each can run right now.",
        "",
        "Call this before workflow_execute. A workflow returned by mistral://workflows is a",
        "*definition*; running it requires a deployment with at least one live worker. A",
        "workflow whose deployment is missing or has no live worker answers 404",
        "(no active deployment found) — this tool is how to see that first.",
        "",
        "runnable_count is the number of deployments with a live worker. When it is 0,",
        "no workflow can be executed and the operator has to start a deployment.",
      ].join("\n"),
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum deployments to return."),
      }),
      outputSchema: WorkflowDeploymentsListOutputSchema,
      annotations: {
        title: "List workflow deployments",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.workflows.deployments.listDeployments(
          input.limit === undefined ? {} : { limit: input.limit }
        );
        const deployments = (res.deployments ?? []).map((d) => ({
          id: d.id,
          name: d.name,
          is_active: d.isActive,
          is_hardened: d.isHardened,
          worker_count: d.workerCount,
          active_worker_count: d.activeWorkerCount,
          managed: d.managed != null,
          ...(toIso(d.createdAt) ? { created_at: toIso(d.createdAt)! } : {}),
          ...(toIso(d.updatedAt) ? { updated_at: toIso(d.updatedAt)! } : {}),
        }));
        const runnable = deployments.filter((d) => d.is_active);
        const structured = {
          deployments,
          count: deployments.length,
          runnable_count: runnable.length,
        };
        const summary =
          deployments.length === 0
            ? "No workflow deployment in this workspace — nothing can be executed until one is created."
            : runnable.length === 0
              ? `${deployments.length} deployment(s), none with a live worker — workflow_execute will fail until one is started.`
              : `${runnable.length}/${deployments.length} deployment(s) runnable: ${runnable.map((d) => d.name).join(", ")}.`;
        return { content: [toTextBlock(summary)], structuredContent: structured };
      } catch (err) {
        return errorResult("workflow_deployments_list", err);
      }
    }
  );

  // ========== workflow_runs_list ==========
  server.registerTool(
    "workflow_runs_list",
    {
      title: "List workflow executions",
      description: [
        "List workflow executions, most recent first. Use it to find an execution_id to pass",
        "to workflow_status, workflow_interact or workflow_stop.",
        "",
        "All filters are optional; with none, returns the latest executions in the workspace.",
      ].join("\n"),
      inputSchema: z.object({
        workflowIdentifier: z
          .string()
          .optional()
          .describe("Restrict to one workflow, by name or ID."),
        status: z
          .enum(WORKFLOW_EXECUTION_STATUSES)
          .optional()
          .describe("Restrict to one execution status."),
        deploymentName: z.string().optional().describe("Restrict to one deployment."),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      outputSchema: WorkflowRunsListOutputSchema,
      annotations: {
        title: "List workflow executions",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const page = await mistral.workflows.runs.listRuns({
          ...(input.workflowIdentifier ? { workflowIdentifier: input.workflowIdentifier } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.deploymentName ? { deploymentName: input.deploymentName } : {}),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
        // listRuns hands back a page iterator; one tool call answers with the
        // first page, and an agent narrows its filters rather than paginating.
        const body = (page as { result?: { executions?: unknown[]; nextPageToken?: string | null } })
          .result;
        const raw = (body?.executions ?? []) as Array<Record<string, unknown>>;
        const executions = raw.map((e) => ({
          workflow_name: String(e.workflowName ?? ""),
          execution_id: String(e.executionId ?? ""),
          ...(e.rootExecutionId ? { root_execution_id: String(e.rootExecutionId) } : {}),
          status: (e.status ?? null) as string | null,
          deployment_name: (e.deploymentName ?? null) as string | null,
          ...(toIso(e.startTime) ? { start_time: toIso(e.startTime)! } : {}),
          end_time: toIso(e.endTime) ?? null,
        }));
        const structured = {
          executions,
          count: executions.length,
          next_page_token: body?.nextPageToken ?? null,
        };
        const summary =
          executions.length === 0
            ? "No workflow execution matched."
            : `${executions.length} execution(s): ${executions
                .slice(0, 5)
                .map((e) => `${e.workflow_name}/${e.execution_id} ${e.status ?? "?"}`)
                .join(", ")}${executions.length > 5 ? ", ..." : ""}.`;
        return { content: [toTextBlock(summary)], structuredContent: structured };
      } catch (err) {
        return errorResult("workflow_runs_list", err);
      }
    }
  );

  // ========== workflow_stop ==========
  server.registerTool(
    "workflow_stop",
    {
      title: "Stop a workflow execution",
      description: [
        "Stop a running workflow execution.",
        "",
        "  mode=cancel (default): asks the workflow to wind down, letting it run its cleanup",
        "    handlers. Prefer this — a cancelled workflow leaves consistent state.",
        "  mode=terminate: kills the execution immediately. Cleanup handlers do not run, so",
        "    any half-finished side effect stays half-finished. Use only when cancel is stuck.",
        "",
        "Both are accepted asynchronously: the call returning does not mean the execution has",
        "already stopped. Poll workflow_status to observe the final state.",
      ].join("\n"),
      inputSchema: z.object({
        executionId: z.string().min(1).describe("Execution to stop."),
        mode: z
          .enum(["cancel", "terminate"])
          .optional()
          .describe("cancel (graceful, default) or terminate (immediate, skips cleanup)."),
      }),
      outputSchema: WorkflowStopOutputSchema,
      annotations: {
        title: "Stop a workflow execution",
        readOnlyHint: false,
        // Terminate skips the workflow's cleanup handlers, so this can leave
        // externally-visible work half-done. The hint has to reflect the worst
        // mode the tool can be asked for.
        destructiveHint: true,
        // Stopping an already-stopped execution changes nothing further.
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const mode = input.mode ?? "cancel";
      try {
        if (mode === "terminate") {
          await mistral.workflows.executions.terminateWorkflowExecution({
            executionId: input.executionId,
          });
        } else {
          await mistral.workflows.executions.cancelWorkflowExecution({
            executionId: input.executionId,
          });
        }
        const structured = { execution_id: input.executionId, mode, requested: true as const };
        return {
          content: [
            toTextBlock(
              `${mode === "terminate" ? "Terminate" : "Cancel"} requested for ${input.executionId}. Poll workflow_status for the final state.`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("workflow_stop", err);
      }
    }
  );
}
