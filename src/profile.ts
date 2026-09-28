/**
 * Runtime configuration: which endpoint we talk to, and which tools we expose.
 *
 * Profiles
 * --------
 * core (default)  documents, chat, vision, OCR, FIM, transcription.
 *                 Keeps the everyday surface independent of deployed workflows.
 * admin           full API surface. Opt-in for debug, CI, advanced scripting.
 *                 ("full" is still accepted as a deprecated alias.)
 * workflows       pipeline orchestration only.
 * metier-docs     compatibility surface: core plus workflows, connectors, RAG discovery.
 * self-hosted     the subset that an OpenAI-compatible endpoint actually
 *                 serves. Selected automatically when MISTRAL_BASE_URL is set.
 *
 * Why the family table exists
 * ---------------------------
 * Membership lives in one table rather than scattered negative conditions.
 * Registrars ask `isEnabled()`, and
 * `mistral://capabilities` is a projection of the same data, which means the
 * catalogue an agent reads can never drift from the tools actually registered.
 */

export type MistralProfile =
  | "core"
  | "admin"
  | "workflows"
  | "metier-docs"
  | "self-hosted";

export const PROFILES: readonly MistralProfile[] = [
  "core",
  "admin",
  "workflows",
  "metier-docs",
  "self-hosted",
];

/** A group of tools sharing one Mistral API surface. */
export interface ToolFamily {
  /** Tools registered when this family is enabled. */
  tools: readonly string[];
  /** Profiles that expose it. */
  profiles: readonly MistralProfile[];
  /**
   * True when the underlying endpoint is part of the de-facto OpenAI-compatible
   * surface (`/v1/chat/completions`, `/v1/embeddings`), so it has a real chance
   * of working against vLLM, a token factory, or a gateway. False for
   * Mistral-proprietary endpoints — OCR, Voxtral, Workflows, Connectors,
   * Conversations, Libraries, Agents.
   */
  openaiCompatible: boolean;
  /** One line, shown in `mistral://capabilities`. */
  summary: string;
}

export const TOOL_FAMILIES: Readonly<Record<string, ToolFamily>> = {
  chat: {
    tools: ["mistral_chat"],
    profiles: ["core", "admin", "metier-docs", "self-hosted"],
    openaiCompatible: true,
    summary: "Chat completion.",
  },
  chat_stream: {
    tools: ["mistral_chat_stream"],
    profiles: ["admin", "self-hosted"],
    openaiCompatible: true,
    summary: "Streaming chat completion, aggregated before returning.",
  },
  embed: {
    tools: ["mistral_embed"],
    profiles: ["admin", "self-hosted"],
    openaiCompatible: true,
    summary: "Text embeddings.",
  },
  tool_call: {
    tools: ["mistral_tool_call"],
    profiles: ["admin", "self-hosted"],
    openaiCompatible: true,
    summary: "Chat completion with function calling.",
  },
  vision: {
    tools: ["mistral_vision"],
    profiles: ["core", "admin", "metier-docs", "self-hosted"],
    openaiCompatible: true,
    summary: "Multimodal chat with images.",
  },
  fim: {
    tools: ["codestral_fim"],
    profiles: ["core", "admin", "metier-docs"],
    openaiCompatible: false,
    summary: "Fill-in-the-middle code completion (Mistral-only /v1/fim/completions).",
  },
  ocr: {
    tools: ["mistral_ocr"],
    profiles: ["core", "admin", "metier-docs"],
    openaiCompatible: false,
    summary: "Document AI — text, blocks, bounding boxes, annotations.",
  },
  transcribe: {
    tools: ["voxtral_transcribe"],
    profiles: ["core", "admin", "metier-docs"],
    openaiCompatible: false,
    summary: "Voxtral speech-to-text with optional diarization.",
  },
  tts: {
    tools: ["voxtral_speak"],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Voxtral text-to-speech.",
  },
  agents: {
    tools: ["mistral_agent", "mistral_moderate", "mistral_classify"],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Mistral Agents, moderation, and classification.",
  },
  agent_catalog: {
    tools: ["agents_list", "agents_get"],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Discover modern agents to use with conversation_start.",
  },
  files: {
    tools: [
      "files_upload",
      "files_list",
      "files_get",
      "files_delete",
      "files_signed_url",
    ],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Files API.",
  },
  batch: {
    tools: ["batch_create", "batch_get", "batch_list", "batch_cancel"],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Batch inference jobs.",
  },
  conversations: {
    tools: [
      "conversation_start",
      "conversation_append",
      "conversation_get",
      "conversation_list",
      "conversation_history",
      "conversation_delete",
    ],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Stateful multi-turn agent loops with Mistral's built-in tools.",
  },
  libraries: {
    tools: [
      "libraries_list",
      "libraries_get",
      "libraries_documents_list",
      "libraries_documents_upload",
      "libraries_documents_status",
    ],
    profiles: ["admin"],
    openaiCompatible: false,
    summary: "Mistral Libraries (managed RAG corpora).",
  },
  rag: {
    tools: ["rag_indexes_list"],
    profiles: ["admin", "metier-docs", "workflows"],
    openaiCompatible: false,
    summary:
      "Discovery of registered search-index deployments (GET /v1/rag/deployments).",
  },
  workflows: {
    tools: [
      "workflow_execute",
      "workflow_status",
      "workflow_interact",
      "workflow_deployments_list",
      "workflow_runs_list",
      "workflow_stop",
    ],
    profiles: ["admin", "workflows", "metier-docs"],
    openaiCompatible: false,
    summary:
      "Durable workflow execution: what is runnable, what is running, signals, and stopping.",
  },
  connectors: {
    tools: [
      "connectors_list",
      "connectors_get",
      "connectors_list_tools",
      "connectors_call_tool",
    ],
    profiles: ["admin", "workflows", "metier-docs"],
    openaiCompatible: false,
    summary: "Discover and invoke already-activated Mistral Connectors.",
  },
  documents: {
    tools: ["process_document"],
    profiles: ["core", "admin", "metier-docs"],
    openaiCompatible: false,
    summary: "OCR + typed extraction macro-tool.",
  },
} as const;

export type ToolFamilyName = keyof typeof TOOL_FAMILIES;

/** Whether `family` is exposed under `profile`. */
export function isEnabled(family: ToolFamilyName, profile: MistralProfile): boolean {
  return TOOL_FAMILIES[family].profiles.includes(profile);
}

/** Tool names a profile registers, sorted. Used by the capabilities resource. */
export function toolsForProfile(profile: MistralProfile): string[] {
  return Object.values(TOOL_FAMILIES)
    .filter((f) => f.profiles.includes(profile))
    .flatMap((f) => [...f.tools])
    .sort();
}

export interface RuntimeConfig {
  profile: MistralProfile;
  /** Custom endpoint, or undefined for Mistral Cloud. */
  baseUrl?: string;
  /** True when MISTRAL_BASE_URL pointed us somewhere other than Mistral Cloud. */
  customEndpoint: boolean;
  /** True when the profile was inferred rather than requested explicitly. */
  profileInferred: boolean;
}

const MISTRAL_CLOUD = "https://api.mistral.ai";

function parseBaseUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `[mistral-mcp] invalid MISTRAL_BASE_URL=${trimmed} (expected an absolute http(s) URL, e.g. http://vllm.internal:8000)`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `[mistral-mcp] invalid MISTRAL_BASE_URL=${trimmed} (protocol must be http or https)`
    );
  }
  // The SDK appends its own paths, so a trailing slash would double up.
  return trimmed.replace(/\/+$/, "");
}

/**
 * Resolves endpoint and profile together, because they are coupled: pointing
 * the server at a non-Mistral endpoint changes which tools can possibly work.
 *
 * An explicit MISTRAL_MCP_PROFILE always wins — an operator fronting Mistral
 * Cloud through a corporate gateway sets a base URL but still wants the full
 * surface, and only they know that.
 */
export function resolveRuntime(
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const baseUrl = parseBaseUrl(env.MISTRAL_BASE_URL);
  const customEndpoint = baseUrl !== undefined && baseUrl !== MISTRAL_CLOUD;

  const raw = env.MISTRAL_MCP_PROFILE?.toLowerCase().trim();
  if (raw) {
    if (raw === "full") {
      console.error(
        '[mistral-mcp] profile "full" is deprecated, use "admin" (same behaviour).'
      );
      return { profile: "admin", baseUrl, customEndpoint, profileInferred: false };
    }
    if ((PROFILES as readonly string[]).includes(raw)) {
      return {
        profile: raw as MistralProfile,
        baseUrl,
        customEndpoint,
        profileInferred: false,
      };
    }
    console.error(
      `[mistral-mcp] unknown MISTRAL_MCP_PROFILE="${raw}", falling back to "core". Valid: ${PROFILES.join(", ")}.`
    );
  }

  return {
    profile: customEndpoint ? "self-hosted" : "core",
    baseUrl,
    customEndpoint,
    profileInferred: true,
  };
}

/** Back-compat shim for callers that only need the profile. */
export function resolveProfile(env: NodeJS.ProcessEnv = process.env): MistralProfile {
  return resolveRuntime(env).profile;
}
