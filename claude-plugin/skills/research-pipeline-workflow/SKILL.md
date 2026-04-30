---
description: Execute a multi-step research pipeline Mistral Workflow with hypothesis validation checkpoints. Query intermediate hypotheses via workflow_interact(action="query"), validate or amend them, and inject additional sources via workflow_interact(action="signal"). Use when the user wants to run an autonomous research pipeline with human oversight.
---

# Research pipeline workflow

Orchestrates a deployed Mistral Workflow for multi-step research (literature review, competitive analysis, technical deep-dive). Queries hypotheses at each checkpoint, lets the user validate or amend them, and injects additional sources when needed — all via `workflow_interact`.

**Profile note**: `workflow_execute`, `workflow_status`, and `workflow_interact` are available in the **core** profile (default). No additional profile is required for workflow-only orchestration.

**Temporal behavior**: the workflow status stays `RUNNING` even when the pipeline is blocked waiting for hypothesis validation (a `wait_for_input()` pause in the workflow). Detect this state by querying a status handler — do not wait for a `PAUSED` status, which does not exist in this API.

## Important: handler names are workflow-specific

Ask the user (or consult `mistral://workflows`) for:
- Query handler for progress: e.g. `"get_progress"`
- Query handler for hypotheses: e.g. `"get_hypotheses"`
- Signal handler for hypothesis decisions: e.g. `"hypothesis_decision"`

## Steps

### Step 1 — Define the research mission

Ask the user for:
1. `workflowIdentifier` — the deployed research workflow name or ID
2. `topic` — the research question (be specific)
3. `depth` — `"shallow"` (quick scan), `"medium"` (balanced), `"deep"` (comprehensive)
4. `output_format` — `"bullets"`, `"report"`, or `"json"`
5. Optional: initial source URLs or `file_id`s to seed the pipeline
6. Handler names (if non-default)

### Step 2 — Launch the pipeline

Call `workflow_execute`:

```json
{
  "workflowIdentifier": "<workflow name or ID>",
  "input": {
    "topic": "<research question>",
    "depth": "medium",
    "output_format": "report",
    "sources": ["<url_or_file_id>"]
  }
}
```

Note `structuredContent.execution_id`. Confirm: "Research pipeline started — execution ID: `<execution_id>`."

### Step 3 — Poll and query progress

Loop:
1. Call `workflow_status` with `{ "executionId": "<execution_id>" }`
2. Check `structuredContent.status`:
   - `COMPLETED` → go to Step 5
   - `FAILED` / `TIMED_OUT` / `CANCELED` → surface error and stop
   - `RUNNING` → continue

While `RUNNING`, query progress every ~20 seconds:

```json
{
  "executionId": "<execution_id>",
  "action": "query",
  "name": "get_progress"
}
```

Show the user what the pipeline is doing:
```
🔍  RESEARCH IN PROGRESS
─────────────────────────
Phase: [phase from result, e.g. "source discovery", "synthesis"]
Sources processed: [N from result]
Hypotheses formed: [N from result]
```

Also probe for hypothesis checkpoints:

```json
{
  "executionId": "<execution_id>",
  "action": "query",
  "name": "get_hypotheses"
}
```

If the result contains pending hypotheses awaiting validation, proceed to Step 4.

### Step 4 — Handle hypothesis checkpoints

When hypotheses are ready for review (detected from the `get_hypotheses` query result):

1. Present hypotheses to the user:
   ```
   ⏸  HYPOTHESIS CHECKPOINT
   ──────────────────────────
   H1: [hypothesis text]
      Supporting sources: [N]
      Confidence: [low/medium/high]

   H2: [hypothesis text]
      ...

   Options:
   (A) Validate — continue with these hypotheses
   (B) Amend — provide corrections or constraints
   (C) Inject sources — add documents/URLs to refine
   (D) Discard — restart this hypothesis phase
   ```

2. Based on user choice, signal the workflow:

   **Validate** (proceed as-is):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "hypothesis_decision",
     "input": { "decision": "validate" }
   }
   ```

   **Amend** (with corrections):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "hypothesis_decision",
     "input": {
       "decision": "amend",
       "amendments": "<user corrections or constraints in plain text>"
     }
   }
   ```

   **Inject sources**:
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "hypothesis_decision",
     "input": {
       "decision": "validate",
       "additional_sources": ["<url_or_file_id>", "..."]
     }
   }
   ```

   **Discard and restart** (hypothesis phase only):
   ```json
   {
     "executionId": "<execution_id>",
     "action": "signal",
     "name": "hypothesis_decision",
     "input": { "decision": "discard", "reason": "<user feedback>" }
   }
   ```

Return to Step 3. Deep pipelines may have multiple hypothesis gates.

### Step 5 — Deliver the research output

When `status === "COMPLETED"`, present `structuredContent.result` in the requested format:

```
✅  RESEARCH COMPLETE
──────────────────────
Topic:       [topic]
Depth:       [depth]
Execution:   <execution_id>
Sources used: [N from result]

[formatted output — bullets / report / JSON as requested]

KEY FINDINGS
────────────
[top 3–5 findings with source citations from result]

CONFIDENCE ASSESSMENT
──────────────────────
[per-finding confidence level + supporting source count]
```

Offer to pass the output to `mistral_chat` with `magistral-medium-latest` + `reasoning_effort: "high"` for a critical peer review of the findings.
