---
description: Run a compliance audit Mistral Workflow, query mid-run findings via workflow_interact(action="query"), and signal approval or escalation decisions at checkpoints via workflow_interact(action="signal"). Use when the user wants to run a compliance audit (GDPR, SOC2, PCI-DSS, etc.) against a deployed Mistral Workflow.
---

# Compliance audit workflow

Orchestrates a deployed Mistral Workflow for compliance auditing. Uses `workflow_interact(action: "query")` to inspect live findings mid-run, and `workflow_interact(action: "signal")` to approve, escalate, or skip at each decision checkpoint.

**Profile note**: `workflow_execute`, `workflow_status`, and `workflow_interact` are available in the **core** profile (default). `files_upload` (for uploading target documents) requires `MISTRAL_MCP_PROFILE=full`.

**Temporal behavior**: while the workflow is processing or waiting for a signal, its status remains `RUNNING`. Detect "waiting for human input" by querying a status handler, not by checking for a `PAUSED` status (which doesn't exist in this API).

## Important: handler names are workflow-specific

Ask the user (or consult `mistral://workflows`) for:
- The query handler that exposes current findings (e.g. `"get_findings"`)
- The query handler that exposes checkpoint state (e.g. `"get_checkpoint"`)
- The signal handler that receives audit decisions (e.g. `"audit_decision"`)

## Steps

### Step 1 — Collect inputs

Ask the user for:
1. `workflowIdentifier` — the deployed audit workflow name or ID
2. `scope` — compliance framework: `"GDPR"`, `"SOC2"`, `"PCI-DSS"`, `"ISO27001"`, etc.
3. Target documents: `file_id`s (upload via `files_upload` — requires `full` profile) or public URLs passed as workflow input
4. Optional: `audit_depth` — `"quick"` / `"standard"` / `"full"`
5. Handler names (if non-default)

### Step 2 — Launch the audit

Call `workflow_execute`:

```json
{
  "workflowIdentifier": "<workflow name or ID>",
  "input": {
    "scope": "<GDPR|SOC2|PCI-DSS|ISO27001>",
    "document_ids": ["<file_id_1>", "<file_id_2>"],
    "audit_depth": "standard"
  }
}
```

Note `structuredContent.execution_id`. Confirm: "Audit workflow started — execution ID: `<execution_id>`."

### Step 3 — Poll and query mid-run findings

Loop:
1. Call `workflow_status` with `{ "executionId": "<execution_id>" }`
2. Check `structuredContent.status`:
   - `COMPLETED` → go to Step 5
   - `FAILED` / `CANCELED` / `TIMED_OUT` → surface error and stop
   - `RUNNING` → continue

While `RUNNING`, proactively query partial findings every ~15 seconds:

```json
{
  "executionId": "<execution_id>",
  "action": "query",
  "name": "get_findings"
}
```

Surface partial findings to the user as they accumulate:
```
📊  AUDIT IN PROGRESS (RUNNING)
───────────────────────────────
Controls checked: [N from result]
Findings so far:
  ✅ [control name] — PASS
  ❌ [control name] — FAIL: [reason]
  ⚠️  [control name] — WARNING
```

Also probe for decision checkpoints:

```json
{
  "executionId": "<execution_id>",
  "action": "query",
  "name": "get_checkpoint"
}
```

If the result indicates a decision is required, proceed to Step 4.

### Step 4 — Handle decision checkpoints

When a checkpoint is detected from the query result:

1. Display the checkpoint context:
   ```
   ⏸  CHECKPOINT — Decision required
   ──────────────────────────────────
   Control: [control name from result]
   Finding: [description]
   Risk:    [level]
   ```

2. Ask the user: "Accept / Escalate / Skip this finding?"

3. Signal the decision:

   **Accept** (finding acknowledged, workflow continues):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "audit_decision",
     "input": { "decision": "accept", "note": "<optional note>" }
   }
   ```

   **Escalate** (flag for external review):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "audit_decision",
     "input": { "decision": "escalate", "note": "<reason for escalation>" }
   }
   ```

   **Skip** (exclude this control from scope):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "audit_decision",
     "input": { "decision": "skip", "note": "<justification>" }
   }
   ```

Return to Step 3. A full audit may have multiple checkpoints.

### Step 5 — Deliver the audit report

When `status === "COMPLETED"`, format `structuredContent.result`:

```
✅  COMPLIANCE AUDIT COMPLETE
──────────────────────────────
Framework: [scope]   Execution: <execution_id>

SUMMARY
  ✅ PASS:       [N] controls
  ❌ FAIL:       [N] controls
  ⚠️  WARNING:   [N] controls
  ↗️  ESCALATED: [N] controls
  ⏭  SKIPPED:   [N] controls

FAILED CONTROLS
───────────────
[control] — [finding] — Remediation: [suggestion]

ESCALATED ITEMS
───────────────
[control] — [reason]

RECOMMENDED REMEDIATIONS
─────────────────────────
[prioritized list from result]
```

Offer to export as JSON for GRC tooling or pass escalated items to `mistral_chat` with `mistral-large-latest` for remediation plan drafting.
