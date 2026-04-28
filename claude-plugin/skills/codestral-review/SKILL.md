---
description: Reviews a code diff through Codestral with an auto-detected focus (correctness, performance, security, or api_design). Auto-fetches the diff via git diff if no argument is provided. Use when the user asks for code review, PR review, security audit of a diff, or critique of recent changes.
---

# Codestral code review

You drive a focused code review of a diff using the Mistral `codestral-latest` model.

## Workflow

### Step 1 — Fetch the diff

If `$ARGUMENTS` contains a unified diff, use it. Otherwise:

1. Check `git diff --staged` first (most likely intent)
2. If empty, fall back to `git diff HEAD~1..HEAD` (last commit)
3. If still empty, ask the user which range to review

### Step 2 — Auto-detect the review focus

Inspect file paths and diff content to pick the most relevant lens:

| Signal | Focus |
|---|---|
| Files touching `auth/`, `crypto/`, `secrets`, `.env`, JWT/OAuth code, SQL queries with string concat, `eval`, file uploads | `security` |
| Hot loops, big-O changes, async/parallelism, caching layer, DB queries, benchmark files | `performance` |
| Public API surface: exported symbols, route handlers, schemas/contracts, breaking signature changes | `api_design` |
| Anything else (refactor, bug fix, feature work) | `correctness` |

If multiple apply, ask the user which to prioritize, or run two passes with different focus values.

### Step 3 — Run the review

Call the MCP prompt `codestral_review` from the `mistral` server with:
- `diff` : the diff from step 1
- `focus` : the lens from step 2

Pass the resulting messages to `mistral_chat`:
- `model` : `codestral-latest`
- `temperature` : `0.2` (deterministic critique)
- `max_tokens` : `1500`

## Output format

The review must end with a verdict: **`ship`**, **`change-requested`**, or **`block`**.

Findings should be:
- **Concrete**: cite exact lines or token ranges from the diff
- **High-signal**: prefer 3 strong findings over 10 shallow ones
- **No invented issues**: only flag real risks visible in the diff

## Examples

- `/mistral-mcp:codestral-review` — auto-detect from `git diff --staged`
- `/mistral-mcp:codestral-review security` — force the security lens
- `/mistral-mcp:codestral-review <diff text>` — review a pasted diff
