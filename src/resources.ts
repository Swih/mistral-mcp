/**
 * Resources primitive — expose the Mistral model catalog under mistral://models.
 *
 * v0.4: the catalog is now LIVE. On each `resources/read`, we call
 * `GET /v1/models` (via `mistral.models.list()`) and expose:
 *   - `accepted` — our canonical allow-list (what this server will route)
 *   - `live` — the raw list returned by the API for this key (ids + metadata)
 *
 * If the API call fails (network, auth, rate-limit), we fall back to the static
 * allow-list and flag `fallback: true` so the caller knows freshness is stale.
 *
 * MCP spec 2025-11-25: Resources provide context/data for the user or model.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import {
  CHAT_MODELS,
  EMBED_MODELS,
  FIM_MODELS,
  TOOL_CAPABLE_MODELS,
} from "./models.js";

const STATIC_CATALOG = {
  chat: CHAT_MODELS,
  embed: EMBED_MODELS,
  fim: FIM_MODELS,
  tool_capable: TOOL_CAPABLE_MODELS,
};

export function registerMistralResources(
  server: McpServer,
  mistral: Mistral
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
}
