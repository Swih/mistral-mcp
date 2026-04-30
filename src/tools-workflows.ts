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

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
      inputSchema: {
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
      },
      outputSchema: WorkflowExecuteOutputShape,
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
      inputSchema: {
        executionId: z.string().min(1).describe("Execution ID from workflow_execute."),
      },
      outputSchema: WorkflowStatusOutputShape,
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
      inputSchema: {
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
      },
      outputSchema: WorkflowInteractOutputShape,
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
}
