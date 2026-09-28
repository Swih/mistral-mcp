#!/usr/bin/env node
/**
 * mistral-mcp — MCP server exposing Mistral AI models as tools.
 *
 * Protocol: MCP 2026-07-28, and the 2025-era handshake on the same entry, so
 * clients that have not migrated (which today is most of them) keep working
 * unchanged. The SDK owns that decision — see src/transport.ts.
 *
 * Transports:
 *   - stdio (default)                  — run directly by an MCP client
 *   - Streamable HTTP (--http flag or  — remote deployments; bind 127.0.0.1
 *     MCP_TRANSPORT=http env)            by default, optional bearer auth.
 *
 * Endpoint: Mistral Cloud by default, or any OpenAI-compatible endpoint via
 * MISTRAL_BASE_URL (vLLM serving open weights, a token factory, a gateway).
 * See src/profile.ts for what that implies about the exposed tool surface.
 *
 * SDK: @modelcontextprotocol/server 2.0.0 (high-level McpServer API).
 * Mistral: @mistralai/mistralai 2.6.4 (speakeasy-generated, built-in retry).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { Mistral } from "@mistralai/mistralai";
import { registerMistralTools } from "./tools.js";
import { registerFunctionTools } from "./tools-fn.js";
import { registerVisionTools } from "./tools-vision.js";
import { registerAudioTools } from "./tools-audio.js";
import { registerAgentTools } from "./tools-agents.js";
import { registerAgentCatalogTools } from "./tools-agent-catalog.js";
import { registerFileTools } from "./tools-files.js";
import { registerBatchTools } from "./tools-batch.js";
import { registerWorkflowTools } from "./tools-workflows.js";
import { registerConnectorTools } from "./tools-connectors.js";
import { registerConversationTools } from "./tools-conversations.js";
import { registerLibraryTools } from "./tools-libraries.js";
import { registerDocsTools } from "./tools-docs.js";
import { registerRagTools } from "./tools-rag.js";
import { registerMistralResources } from "./resources.js";
import { registerMistralPrompts } from "./prompts.js";
import { connectTransport, resolveTransportOptions } from "./transport.js";
import { isEnabled, resolveRuntime, type RuntimeConfig } from "./profile.js";
import { MISTRAL_RETRY_CONFIG, MISTRAL_TIMEOUT_MS } from "./shared.js";
import { configurationReport } from "./diagnostics.js";
import {
  configureAudit,
  instrumentTools,
  tracingHttpClient,
} from "./observability.js";

/**
 * Keep in sync with package.json on release. Declared once so the advertised
 * server identity and the boot log can never disagree — they already drifted
 * twice (see "fix(release): align runtime log version to 0.7.0").
 */
const SERVER_VERSION = "0.11.0";

let runtime: RuntimeConfig;
try {
  runtime = resolveRuntime();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const API_KEY = process.env.MISTRAL_API_KEY;
if (process.argv.includes("--doctor")) {
  // This explicit CLI command does not start a JSON-RPC transport.
  process.stdout.write(JSON.stringify(configurationReport(runtime, Boolean(API_KEY)), null, 2) + "\n");
  process.exit(0);
}
if (!API_KEY) {
  if (runtime.customEndpoint) {
    // A local vLLM usually has no auth at all, so this is routine, not a fault.
    console.error(
      `[mistral-mcp] no MISTRAL_API_KEY set; sending an empty bearer to ${runtime.baseUrl}.\n` +
        "  Set MISTRAL_API_KEY if your endpoint expects a token."
    );
  } else {
    console.error(
      "[mistral-mcp] MISTRAL_API_KEY is not set.\n" +
        "  → Get an API key (usage and limits depend on your Mistral organization):\n" +
        "    https://console.mistral.ai/api-keys\n" +
        "  → Then export it: MISTRAL_API_KEY=sk-... npx mistral-mcp\n" +
        "  → Or point the server at your own endpoint: MISTRAL_BASE_URL=http://...\n" +
        "  Server will start without auth so tools/list works for sandboxed\n" +
        "  introspection (Glama, Smithery, etc.). Tool calls will fail with\n" +
        "  a 401 from Mistral until a valid key is provided."
    );
  }
}

configureAudit();

// One client for the process: it is stateless, holds the retry policy, and
// pooling its connections across per-request server instances is the point.
const mistral = new Mistral({
  apiKey: API_KEY ?? "missing",
  // Stamps the caller's W3C trace context onto every outgoing request, so the
  // customer's collector can join an MCP span to the Mistral span it caused.
  httpClient: tracingHttpClient(),
  ...(runtime.baseUrl ? { serverURL: runtime.baseUrl } : {}),
  retryConfig: MISTRAL_RETRY_CONFIG,
  timeoutMs: MISTRAL_TIMEOUT_MS,
});

const { profile } = runtime;

/**
 * A fresh, fully-registered server for one serving unit — one stdio connection,
 * or one HTTP request. Both protocol eras are built from this same function, so
 * a tool can never exist on one era and not the other.
 */
function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "mistral-mcp",
      version: SERVER_VERSION,
    },
    {
      // The catalogue is decided at boot by the profile and never changes for
      // the life of the process, so it is the same answer for every client of
      // this endpoint — `public` is accurate, not merely convenient. Read
      // results carry their own per-resource hints (see resources.ts); the
      // fallback here stays conservative because a tool result is not one of
      // these, and an unhinted read is more likely to be account-specific.
      cacheHints: {
        "tools/list": { ttlMs: 300_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/list": { ttlMs: 300_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 300_000, cacheScope: "public" },
        "server/discover": { ttlMs: 300_000, cacheScope: "public" },
        "resources/read": { ttlMs: 0, cacheScope: "private" },
      },
    }
  );

  // Every tool registered below is timed, audited and trace-bound. Wrapping
  // the seam rather than each handler is what makes that unconditional.
  instrumentTools(server);

  // Registration is driven by the family table in profile.ts — never by an
  // ad-hoc profile comparison here. Adding a tool means adding it there.
  registerMistralTools(server, mistral, profile);
  registerFunctionTools(server, mistral, profile);
  registerVisionTools(server, mistral, profile);
  registerAudioTools(server, mistral, profile);

  if (isEnabled("agents", profile)) registerAgentTools(server, mistral);
  if (isEnabled("agent_catalog", profile)) registerAgentCatalogTools(server, mistral);
  if (isEnabled("files", profile)) registerFileTools(server, mistral);
  if (isEnabled("batch", profile)) registerBatchTools(server, mistral);
  if (isEnabled("conversations", profile)) registerConversationTools(server, mistral);
  if (isEnabled("libraries", profile)) registerLibraryTools(server, mistral);
  if (isEnabled("workflows", profile)) registerWorkflowTools(server, mistral);
  if (isEnabled("connectors", profile)) registerConnectorTools(server, mistral);
  if (isEnabled("documents", profile)) registerDocsTools(server, mistral);
  if (isEnabled("rag", profile)) registerRagTools(server, mistral);

  registerMistralResources(server, mistral, runtime);
  registerMistralPrompts(server);

  return server;
}

const transportOpts = resolveTransportOptions();
const connected = await connectTransport(createServer, transportOpts);

const endpoint = runtime.baseUrl ?? "https://api.mistral.ai (default)";
const address = connected.address
  ? ` (${connected.address.host}:${connected.address.port})`
  : "";
console.error(
  `[mistral-mcp] v${SERVER_VERSION} profile=${profile}${
    runtime.profileInferred ? " (inferred)" : ""
  } endpoint=${endpoint} transport=${connected.mode}${address}`
);
if (runtime.customEndpoint && runtime.profileInferred) {
  console.error(
    "[mistral-mcp] MISTRAL_BASE_URL is set, so only the OpenAI-compatible tool\n" +
      "  surface is exposed (chat, streaming, embeddings, function calling, vision).\n" +
      "  OCR, Voxtral, Workflows, Connectors, Conversations and Libraries are Mistral\n" +
      "  Cloud endpoints and are hidden. Read mistral://capabilities for the details,\n" +
      "  or set MISTRAL_MCP_PROFILE=admin if your endpoint serves the full API."
  );
}

const shutdown = async (signal: NodeJS.Signals) => {
  console.error(`[mistral-mcp] received ${signal}, shutting down`);
  await connected.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
