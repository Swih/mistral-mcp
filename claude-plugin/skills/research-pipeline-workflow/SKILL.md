---
name: research-pipeline-workflow
description: Run an existing deployed Mistral research workflow, track its results, and handle documented hypothesis or source checkpoints. Use when the user asks to execute that pipeline.
---

# Research pipeline workflow

Requires workflow tools in `workflows`, `metier-docs`, or `admin`. They are not part of `core`. Check `mistral://capabilities`. This skill does not deploy a pipeline or add web search, source ingestion, or hypothesis validation to one.

## Verify the pipeline

Read `mistral://workflows` to identify the requested workflow. Call `workflow_deployments_list` with `{}` and verify that an active deployment serves it. A definition without live workers cannot run; explain the missing deployment if none is available.

Obtain the input schema, supported research tasks, source formats, output contract, and any query, signal, or update handlers from the deployment documentation or owner. The discovery resource does not expose those schemas. Do not invent `topic`, `depth`, source fields, handler names, or validation choices just because they sound useful.

Map the user's research question and constraints to the documented input fields. Confirm that the deployment accepts supplied URLs or file IDs before including them. Source discovery, source injection, and restarting a phase are available only if the workflow implements them.

## Execute and track

Call `workflow_execute` with the verified `workflowIdentifier`, its documented `input` object, optional verified `deploymentName`, and `waitForResult: false`. Check `isError`, then retain `structuredContent.execution_id`. If the user supplies an existing execution ID, inspect that run instead of starting another.

Poll `workflow_status` with `executionId`, using spaced, bounded checks. Return the ID and latest state if further tracking must resume later.

- `RUNNING` or `RETRYING_AFTER_ERROR`: pending. Use documented queries for progress or hypothesis checkpoints if available.
- `COMPLETED`: inspect `structuredContent.result` for the actual research output.
- `FAILED`, `CANCELED`, `TERMINATED`, or `TIMED_OUT`: report the state and available result, then stop.
- `CONTINUED_AS_NEW`: locate the continuation with `workflow_runs_list` filtered by `workflowIdentifier` and verify it against the returned run identifiers.
- Null or unknown status: preserve the uncertainty.

To query, call `workflow_interact` with `executionId`, `action: "query"`, the documented `name`, and any required `input` object. A checkpoint may retain `RUNNING` status; its meaning comes from the workflow's query contract.

If the returned state requires a decision, present the hypotheses, evidence, and supported choices actually returned. Apply the user's existing decision or obtain one if missing. Send only the documented `signal` or `update` name and payload. Do not equate adding sources with approval, or assume a restart action exists. A signal acknowledgement is not completion; inspect state before retrying an ambiguous mutation.

## Deliver the result

Provide the execution ID, actual state, findings, and source references returned by the workflow. Preserve partial coverage and unresolved questions. Separate hypotheses from established findings; do not invent citations, source counts, confidence ratings, or verification steps. A completed run does not itself prove that its sources or conclusions are correct.
