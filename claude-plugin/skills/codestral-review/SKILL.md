---
name: codestral-review
description: Review a code diff with the codestral_review MCP prompt and mistral_chat, focusing on correctness, performance, security, or API design. Use for diff or PR review requests.
---

# Codestral code review

Use `mistral_chat` in `core`, `metier-docs`, `admin`, or a compatible `self-hosted` endpoint. Check `mistral://capabilities` for availability.

1. Use the supplied diff or requested Git range. Otherwise inspect `git diff --staged`, then `git diff` if nothing is staged. If both are empty, request a range rather than silently reviewing an unrelated commit.
2. Honor the requested focus, or select `correctness`, `performance`, `security`, or `api_design` from the actual change. Default to `correctness` when no narrower lens applies.
3. Retrieve the MCP prompt `codestral_review` with `diff` and `focus`. Prompts return messages; they do not run the review.
4. Convert each text message from `{role, content: {type: "text", text: "..."}}` to `{role, content: "..."}` and call `mistral_chat` with that `messages` array. Optional sampling fields are `temperature` and `max_tokens`.

Omit `model` to honor the configured chat default. For an explicit Codestral request, check `mistral://models` for an available identifier and confirm the endpoint supports chat with it. Report unavailable model selection instead of inventing an alias. `codestral_fim` requires `prompt` and `suffix` and is intended for code insertion.

Read `structuredContent.text` only after checking `isError`. Verify findings against the diff and relevant surrounding code. Report concrete defects with accurate file and line references, impact, and any uncertainty. End with `ship`, `change-requested`, or `block`, scoped to the code actually reviewed. Do not imply that tests ran unless they did.
