/**
 * Profile system — controls which tools are registered at startup.
 *
 * core (default): lean agentic surface — chat, vision, OCR, FIM, transcribe,
 *   sampling. Keeps the LLM tool context small.
 * admin: full API surface (formerly "full") — adds embeddings, streaming,
 *   classify/moderate, batch, files, agents. Opt-in for debug, CI, advanced
 *   scripting. "full" remains accepted as a deprecated alias.
 * workflows: workflow tools only — pipeline orchestration use cases.
 * metier-docs: documents vertical — adds the process_document macro-tool
 *   on top of the core surface.
 *
 * Set MISTRAL_MCP_PROFILE=core|admin|workflows|metier-docs at launch.
 */

export type MistralProfile = "core" | "admin" | "workflows" | "metier-docs";

export function resolveProfile(): MistralProfile {
  const raw = process.env.MISTRAL_MCP_PROFILE?.toLowerCase().trim();
  if (raw === "admin" || raw === "workflows" || raw === "metier-docs") return raw;
  if (raw === "full") {
    console.error(
      '[mistral-mcp] profile "full" is deprecated, use "admin" (same behaviour).'
    );
    return "admin";
  }
  return "core";
}
