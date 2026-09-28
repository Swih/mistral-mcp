---
name: contract-review-workflow
description: Run an existing deployed Mistral contract-review workflow and handle its documented review checkpoints. Use when the user explicitly wants that workflow, rather than direct contract extraction.
---

# Contract review workflow

Requires `workflow_execute`, `workflow_status`, and related workflow tools in `workflows`, `metier-docs`, or `admin`. They are absent from `core`. Check `mistral://capabilities` first. This skill does not create a workflow or supply a contract approval system.

## Establish the deployment contract

Read `mistral://workflows` to identify the requested definition, and call `workflow_deployments_list` with `{}` to check deployments and live workers. A catalog entry alone does not prove that the workflow is runnable. If `runnable_count` is zero, report that a deployment must be started. Confirm which active deployment serves the selected workflow before execution.

Obtain its documented input schema, output meaning, checkpoint query names, decision handlers, and payload shapes from the workflow documentation or owner. The discovery resource lists metadata, not these contracts. Do not invent document fields, review modes, approval handlers, or a standard checkpoint object.

Use only document representations that this deployment accepts. A local document can be converted to text with an available converter; `files_upload` requires `admin` and takes file bytes in `content_base64`, with `filename` and `purpose: "ocr"` for a PDF. Its ID is `structuredContent.id`. A file ID is useful only if the workflow accepts it.

If no suitable deployment exists, explain the requirement. For direct extraction, use the `contract-analyzer` skill when `process_document` is exposed; extraction does not provide an approval workflow.

## Execute and follow the run

Call `workflow_execute` with:

- `workflowIdentifier`: the verified workflow name or ID.
- `input`: a JSON object matching that workflow's input contract; omit only if no input is required.
- `deploymentName`: the verified target deployment when needed.
- `waitForResult: false` for workflows with human checkpoints.

Check `isError` and save `structuredContent.execution_id`. Poll `workflow_status` with `{ "executionId": "<returned execution ID>" }`. Use spaced, bounded checks and retain the ID so the user can resume tracking.

- `RUNNING` or `RETRYING_AFTER_ERROR`: execution is not complete. Query a checkpoint only through a documented handler.
- `COMPLETED`: inspect `structuredContent.result`; workflow completion alone does not mean the contract was approved.
- `FAILED`, `CANCELED`, `TERMINATED`, or `TIMED_OUT`: report the returned state and result, then stop.
- `CONTINUED_AS_NEW`: use `workflow_runs_list` with the verified `workflowIdentifier` and returned run identifiers to locate the continuation. Do not invent its ID or re-execute the review.
- Null or unfamiliar status: report uncertainty instead of assuming success.

A checkpoint may still have `RUNNING` status. Query it with `workflow_interact` using `executionId`, `action: "query"`, the documented `name`, and any required `input` object. Present the returned findings and supported choices. Use the user's decision or existing authorization; obtain a decision if it is missing. Send only the documented `signal` or `update` payload. A signal acknowledgement does not confirm completion, and an ambiguous error is not a reason to repeat a mutating call blindly.

Deliver the execution ID, actual status, review findings, and unresolved decisions present in the result. Keep contract facts separate from model assessments. Do not imply that the workflow performed legal database searches, approvals, or external actions unless the deployment and result establish them.
