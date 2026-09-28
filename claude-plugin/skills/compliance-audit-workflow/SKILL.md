---
name: compliance-audit-workflow
description: Run an existing deployed Mistral audit workflow, inspect its documented findings, and handle supported decision checkpoints. Use when the user requests a specific compliance workflow.
---

# Compliance audit workflow

Workflow tools require `workflows`, `metier-docs`, or `admin`; they are not in `core`. Read `mistral://capabilities` before choosing a tool. This skill orchestrates a deployment; it does not implement compliance controls or certify an organization.

## Verify the audit contract

Read `mistral://workflows` and call `workflow_deployments_list` with `{}`. Select the intended workflow and verify an active deployment serves it. If no live workers are available, report the deployment requirement instead of launching an invented audit.

Obtain the workflow's input schema and supported audit scope from its documentation or owner. Confirm the evidence formats, actual checks, output interpretation, query handlers, and decision payloads. The catalog exposes metadata, not these schemas. Do not assume support for a framework, audit depth, escalation, or skipping a control.

Supply evidence only in formats the workflow accepts. `files_upload` is available in `admin` and takes `filename`, `content_base64`, and `purpose: "ocr"` for document uploads; read its ID from `structuredContent.id`. Neither a file ID nor a URL is a universal audit input.

## Run and inspect

Call `workflow_execute` with the verified `workflowIdentifier`, an `input` object matching its contract, optional verified `deploymentName`, and `waitForResult: false`. Check `isError`, then retain `structuredContent.execution_id`.

Poll `workflow_status` using `executionId`. Space checks, bound the polling session, and return the execution ID if the run remains active. Interpret states as follows:

- `RUNNING` and `RETRYING_AFTER_ERROR`: pending; query findings or checkpoints only if documented handlers exist.
- `COMPLETED`: read `structuredContent.result`. Completion is not a compliance pass.
- `FAILED`, `CANCELED`, `TERMINATED`, `TIMED_OUT`: report the state and available result, then stop.
- `CONTINUED_AS_NEW`: locate the continuation with `workflow_runs_list` filtered by `workflowIdentifier`, verifying its relationship to the returned run identifiers.
- Null or unknown status: report it without assuming a completed audit.

For a supported query, call `workflow_interact` with `executionId`, `action: "query"`, the documented handler `name`, and `input` only as required. A running workflow may be waiting for input; there is no generic checkpoint handler or result shape.

At an actual decision checkpoint, show the returned control, evidence, finding, and supported choices. Use an existing user decision or ask for the missing decision. Send `action: "signal"` or `"update"` only with the deployment's documented name and payload. Never infer that a signal acknowledgement means the audit finished. Check state before retrying a mutating call after an ambiguous failure.

## Report

Present the execution ID, terminal or pending status, scope actually checked, findings, evidence references, and any reported remediation or unresolved items. Include counts only if they can be derived from the result. Distinguish workflow findings from independently verified compliance. If no appropriate workflow is deployed, report that limitation; do not present a chat summary as an executed audit.
