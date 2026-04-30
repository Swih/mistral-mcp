/**
 * Profile system — controls which tools are registered at startup.
 *
 * core (default): 8 tools for the most common Mistral workflows.
 *   Keeps the LLM tool context small; correct default for new installs.
 * full: all v0.5 tools + workflow tools (legacy surface, opt-in).
 * workflows: workflow tools only (mistral_chat excluded).
 *
 * Set MISTRAL_MCP_PROFILE=core|full|workflows before launching the server.
 */

export type MistralProfile = "core" | "full" | "workflows";

export function resolveProfile(): MistralProfile {
  const raw = process.env.MISTRAL_MCP_PROFILE?.toLowerCase().trim();
  if (raw === "full" || raw === "workflows") return raw;
  return "core";
}
