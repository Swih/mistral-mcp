/**
 * v0.3 Resources primitive — expose the Mistral model catalog under mistral://models.
 *
 * MCP spec 2025-11-25: Resources provide context/data for the user or model.
 * Our resource is a single JSON document describing the chat, embed, fim and
 * tool-capable model aliases we accept — callable from any MCP client via
 * resources/read.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CHAT_MODELS,
  EMBED_MODELS,
  FIM_MODELS,
  TOOL_CAPABLE_MODELS,
} from "./models.js";

const CATALOG = {
  spec_version: "2025-11-25",
  updated: "2026-04",
  source: [
    "https://docs.mistral.ai/capabilities/function_calling/",
    "https://docs.mistral.ai/getting-started/models/models_overview/",
  ],
  policy: [
    "Only -latest aliases are accepted. Dated variants (e.g. codestral-2501) all have",
    "retirement dates and are rejected up-front.",
  ].join(" "),
  chat: CHAT_MODELS,
  embed: EMBED_MODELS,
  fim: FIM_MODELS,
  tool_capable: TOOL_CAPABLE_MODELS,
};

export function registerMistralResources(server: McpServer) {
  server.registerResource(
    "mistral-models",
    "mistral://models",
    {
      title: "Mistral model catalog",
      description:
        "Canonical list of Mistral model aliases this server accepts, grouped by capability " +
        "(chat, embed, fim, tool-calling). Read to discover supported models before invoking a tool.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(CATALOG, null, 2),
        },
      ],
    })
  );
}
