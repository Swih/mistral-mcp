/**
 * Resources primitive — expose Mistral catalogs as MCP resources.
 *
 * - mistral://models  : LIVE call to GET /v1/models on every read, plus the
 *   canonical allow-list this server will route.
 * - mistral://voices  : LIVE call to GET /v1/audio/voices on every read.
 *
 * Both endpoints degrade gracefully: if the API call fails (network, auth,
 * rate-limit), we flag `fallback: true` and include a short `fallback_reason`.
 *
 * MCP spec 2025-11-25: Resources provide context/data for the user or model.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import {
  CHAT_MODELS,
  EMBED_MODELS,
  FIM_MODELS,
  OCR_MODELS,
  STT_MODELS,
  TOOL_CAPABLE_MODELS,
  VISION_MODELS,
} from "./models.js";
import type { MistralProfile } from "./profile.js";

const STATIC_CATALOG = {
  chat: CHAT_MODELS,
  embed: EMBED_MODELS,
  fim: FIM_MODELS,
  tool_capable: TOOL_CAPABLE_MODELS,
  vision: VISION_MODELS,
  ocr: OCR_MODELS,
  stt: STT_MODELS,
};

export function registerMistralResources(
  server: McpServer,
  mistral: Mistral,
  profile: MistralProfile = "core"
) {
  server.registerResource(
    "mistral-models",
    "mistral://models",
    {
      title: "Mistral model catalog",
      description:
        "Live Mistral model catalog for this API key. Returns the canonical allow-list " +
        "this server accepts plus the raw list from GET /v1/models. Falls back to the " +
        "static allow-list if the API call fails.",
      mimeType: "application/json",
    },
    async (uri) => {
      const now = new Date().toISOString();
      let live:
        | { ids: string[]; fetched_at: string; count: number }
        | null = null;
      let fallback = false;
      let fallback_reason: string | undefined;

      try {
        const res = await mistral.models.list();
        const data = (res?.data ?? []) as Array<{ id?: string }>;
        const ids = data
          .map((m) => m.id)
          .filter((id): id is string => typeof id === "string")
          .sort();
        live = { ids, fetched_at: now, count: ids.length };
      } catch (err) {
        fallback = true;
        fallback_reason = err instanceof Error ? err.message : String(err);
      }

      const payload = {
        spec_version: "2025-11-25",
        source_api: "GET /v1/models (live)",
        policy:
          "Only -latest aliases are accepted. Dated variants (e.g. codestral-2501) all " +
          "have retirement dates and are rejected up-front by input validation.",
        accepted: STATIC_CATALOG,
        live,
        fallback,
        ...(fallback_reason ? { fallback_reason } : {}),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "mistral-voices",
    "mistral://voices",
    {
      title: "Mistral voice catalog",
      description:
        "Live list of voices available to this API key (presets + custom). " +
        "Use a returned `id` or `slug` as `voiceId` on `voxtral_speak`. " +
        "Falls back to an empty list if the API call fails.",
      mimeType: "application/json",
    },
    async (uri) => {
      const now = new Date().toISOString();
      let items: unknown[] = [];
      let total = 0;
      let fallback = false;
      let fallback_reason: string | undefined;

      try {
        const res = await mistral.audio.voices.list();
        items = (res.items ?? []).map((v) => ({
          id: v.id,
          name: v.name,
          slug: v.slug ?? undefined,
          languages: v.languages ?? undefined,
          gender: v.gender ?? undefined,
          age: v.age ?? undefined,
          tags: v.tags ?? undefined,
          color: v.color ?? undefined,
          retention_notice: v.retentionNotice,
          created_at:
            v.createdAt instanceof Date
              ? v.createdAt.toISOString()
              : String(v.createdAt ?? ""),
          user_id: v.userId ?? null,
        }));
        total = typeof res.total === "number" ? res.total : items.length;
      } catch (err) {
        fallback = true;
        fallback_reason = err instanceof Error ? err.message : String(err);
      }

      const payload = {
        source_api: "GET /v1/audio/voices (live)",
        fetched_at: now,
        count: items.length,
        total,
        items,
        fallback,
        ...(fallback_reason ? { fallback_reason } : {}),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "mistral-workflows",
    "mistral://workflows",
    {
      title: "Mistral workflow catalog",
      description:
        "Live list of Mistral Workflows deployed to this API key. " +
        "Use the `name` field as `workflowIdentifier` in workflow_execute. " +
        "Falls back to an empty list if the API call fails.",
      mimeType: "application/json",
    },
    async (uri) => {
      const now = new Date().toISOString();
      let workflows: unknown[] = [];
      let fallback = false;
      let fallback_reason: string | undefined;

      try {
        const pages = await mistral.workflows.getWorkflows({ limit: 100 });
        for await (const page of pages) {
          for (const w of page.result.workflows) {
            workflows.push({
              id: w.id,
              name: w.name,
              display_name: w.displayName,
              description: w.description ?? undefined,
              archived: w.archived,
            });
          }
          if (!page.result.nextCursor) break;
        }
      } catch (err) {
        fallback = true;
        fallback_reason = err instanceof Error ? err.message : String(err);
      }

      const payload = {
        source_api: "GET /v1/workflows (live)",
        fetched_at: now,
        count: workflows.length,
        workflows,
        fallback,
        ...(fallback_reason ? { fallback_reason } : {}),
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );
}
