---
description: Trigger a deployed Mistral Workflow for contract review, poll execution status, detect human-in-the-loop checkpoints via workflow_interact(query), collect approval or changes, and resume the workflow via workflow_interact(signal). Use when the user wants to run a contract through a Mistral Workflow with oversight checkpoints.
---

# Contract review workflow

Orchestrates a deployed Mistral Workflow for contract review. Detects `wait_for_input()` human-in-the-loop checkpoints by querying a status handler, presents findings to the user, and resumes the workflow with their decision via `workflow_interact(action: "signal")`.

**Profile note**: `workflow_execute`, `workflow_status`, and `workflow_interact` are available in the **core** profile (default). `files_upload` (for local PDF upload) requires `MISTRAL_MCP_PROFILE=full`.

**Why workflows vs direct API**: the workflow runs durably on Mistral's infrastructure — it persists across restarts, handles retries, and can run multi-step analysis (OCR → clause extraction → legal DB lookup → risk scoring) without keeping a connection open.

## Important: handler names are workflow-specific

The `name` field in `workflow_interact` calls (signal handler, query handler) is defined by the deployed workflow. Ask the user for:
- The query handler name that exposes checkpoint state (e.g. `"get_checkpoint"`)
- The signal handler name that receives approval decisions (e.g. `"human_approval"`)

Defaults used in the examples below — replace with the actual names from the workflow.

## Steps

### Step 1 — Collect inputs

Ask the user for:
1. `workflowIdentifier` — the deployed workflow name or ID (visible in `mistral://workflows`)
2. The contract document: a `file_id` (from `files_upload`, requires `full` profile) or a public URL
3. Optional: `review_type` (e.g. `"vendor"`, `"employment"`, `"partnership"`) and `language` (`"fr"` or `"en"`)
4. The query handler name and signal handler name (if not the defaults)

### Step 2 — Start the workflow

Call `workflow_execute`:

```json
{
  "workflowIdentifier": "<workflow name or ID>",
  "input": {
    "document_id": "<file_id, or omit if using document_url>",
    "document_url": "<URL, or omit if using file_id>",
    "review_type": "<vendor|employment|partnership|other>",
    "language": "fr"
  }
}
```

Note the `structuredContent.execution_id`. Confirm to the user: "Workflow started — execution ID: `<execution_id>`."

### Step 3 — Poll and probe for checkpoints

Loop:
1. Call `workflow_status` with `{ "executionId": "<execution_id>" }`
2. Check `structuredContent.status`:
   - `COMPLETED` → go to Step 5
   - `FAILED` / `CANCELED` / `TIMED_OUT` → surface `structuredContent.result` and stop
   - `RUNNING` → probe for checkpoint (see below), then wait ~10 seconds

While `RUNNING`, query the checkpoint handler to detect if the workflow is waiting for human input:

```json
{
  "executionId": "<execution_id>",
  "action": "query",
  "name": "get_checkpoint"
}
```

If `structuredContent.result` is non-null and contains checkpoint data (e.g. `{ "waiting": true, "data": {...} }`), proceed to Step 4.

If no checkpoint or `result` is null, show a progress update and continue polling.

### Step 4 — Handle approval checkpoints

When a checkpoint is detected:

1. Display the checkpoint findings from the query result:
   ```
   ⏸  CHECKPOINT — Human review required
   ──────────────────────────────────────
   [findings from query result.data — risk summary, flagged clauses, etc.]
   ```

2. Ask the user: "Approve and continue / Request changes?"

3. If **approved**, signal the workflow:
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "human_approval",
     "input": { "approved": true }
   }
   ```

4. If **changes requested**, capture the user's comment and signal:
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "human_approval",
     "input": { "approved": false, "comment": "<user comment>" }
   }
   ```

Return to Step 3 after signaling. A workflow may have multiple checkpoints.

### Step 5 — Deliver final report

When `status === "COMPLETED"`, format `structuredContent.result` as a structured contract review:

```
✅  CONTRACT REVIEW COMPLETE
─────────────────────────────
Execution: <execution_id>
Overall risk: [level from result]

KEY FINDINGS
[structured list from result]

RECOMMENDED ACTIONS
[list from result]
```

Offer to pass the output to `/mistral-mcp:contract-analyzer` for a complementary stateless view, or to `french_legal_summary` for a plain-language summary.
