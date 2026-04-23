#!/usr/bin/env node
/**
 * mistral-mcp — MCP server exposing Mistral AI models as tools.
 *
 * Transports (MCP spec 2025-11-25):
 *   - stdio (default)                  — run directly by an MCP client
 *   - Streamable HTTP (--http flag or  — remote deployments; bind 127.0.0.1
 *     MCP_TRANSPORT=http env)            by default, optional bearer auth.
 *
 * SDK: @modelcontextprotocol/sdk 1.29.0 (high-level McpServer API).
 * Mistral: @mistralai/mistralai 2.2.0 (speakeasy-generated, built-in retry).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Mistral } from "@mistralai/mistralai";
import { registerMistralTools } from "./tools.js";
import { registerFunctionTools } from "./tools-fn.js";
import { registerVisionTools } from "./tools-vision.js";
import { registerAudioTools } from "./tools-audio.js";
import { registerAgentTools } from "./tools-agents.js";
import { registerFileTools } from "./tools-files.js";
import { registerBatchTools } from "./tools-batch.js";
import { registerSamplingTools } from "./tools-sampling.js";
import { registerMistralResources } from "./resources.js";
import { registerMistralPrompts } from "./prompts.js";
import { connectTransport, resolveTransportOptions } from "./transport.js";

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error(
    "[mistral-mcp] MISTRAL_API_KEY is not set. Export it or provide it via MCP client config."
  );
  process.exit(1);
}

const mistral = new Mistral({
  apiKey: API_KEY,
  retryConfig: {
    strategy: "backoff",
    backoff: {
      initialInterval: 500,
      maxInterval: 5000,
      exponent: 2,
      maxElapsedTime: 30000,
    },
    retryConnectionErrors: true,
  },
  timeoutMs: 60_000,
});

const server = new McpServer({
  name: "mistral-mcp",
  version: "0.4.0-dev",
});

registerMistralTools(server, mistral);
registerFunctionTools(server, mistral);
registerVisionTools(server, mistral);
registerAudioTools(server, mistral);
registerAgentTools(server, mistral);
registerFileTools(server, mistral);
registerBatchTools(server, mistral);
registerSamplingTools(server);
registerMistralResources(server, mistral);
registerMistralPrompts(server);

const transportOpts = resolveTransportOptions();
const connected = await connectTransport(server, transportOpts);
console.error(
  `[mistral-mcp] v0.4.0-dev connected via ${connected.mode}${
    connected.address
      ? ` (${connected.address.host}:${connected.address.port})`
      : ""
  }`
);

const shutdown = async (signal: NodeJS.Signals) => {
  console.error(`[mistral-mcp] received ${signal}, shutting down`);
  await connected.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
