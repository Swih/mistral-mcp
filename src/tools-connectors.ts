/**
 * v0.9 tools — Mistral Connectors (use already-activated MCP-protocol connectors).
 *
 * Sources:
 * - https://docs.mistral.ai/capabilities/connectors/
 * - SDK: mistral.beta.connectors.list / get / listTools / callTool
 *
 * Scope: read + invoke only. Connector admin (create/update/delete, activation
 * at org/workspace/user scope, credentials management) is deliberately out of
 * this surface — those endpoints mutate org-wide state and/or return or accept
 * connection secrets, which doesn't fit a stdio tool an LLM drives unattended.
 *
 * `connector.get` accepts `fetchUserData`/`fetchCustomerData` flags that pull
 * back connection credentials / customer secrets — never forwarded here.
 *
 * Four tools:
 *   connectors_list       — discover connectors visible to the caller
 *   connectors_get        — fetch one connector's public metadata
 *   connectors_list_tools — list the MCP tools a connector exposes
 *   connectors_call_tool  — invoke one of those tools (real MCP CallToolResult passthrough)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mistral } from "@mistralai/mistralai";
import { z } from "zod";
import { errorResult, toTextBlock } from "./shared.js";

// ---------- shared shapes ----------

const ConnectorSummaryShape = {
  id: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string(),
  protocol: z.string().optional().describe("mcp | http | turbine (forward-compatible)."),
  visibility: z.string(),
  active: z.boolean().nullable().optional(),
  mistral: z.boolean().describe("true for Mistral-built connectors."),
  private_tool_execution: z.boolean(),
  is_authenticated: z.boolean().nullable().optional(),
  icon_url: z.string().nullable().optional(),
  created_at: z.string(),
  modified_at: z.string(),
};
const ConnectorSummarySchema = z.object(ConnectorSummaryShape);

function toConnectorSummary(c: {
  id: string;
  name: string;
  title?: string | null;
  description: string;
  protocol?: string;
  visibility: unknown;
  active?: boolean | null;
  mistral: boolean;
  privateToolExecution: boolean;
  isAuthenticated?: boolean | null;
  iconUrl?: string | null;
  createdAt: Date;
  modifiedAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    title: c.title ?? undefined,
    description: c.description,
    protocol: typeof c.protocol === "string" ? c.protocol : undefined,
    visibility: String(c.visibility),
    active: c.active ?? undefined,
    mistral: c.mistral,
    private_tool_execution: c.privateToolExecution,
    is_authenticated: c.isAuthenticated ?? undefined,
    icon_url: c.iconUrl ?? undefined,
    created_at: c.createdAt.toISOString(),
    modified_at: c.modifiedAt.toISOString(),
  };
}

// ---------- output schemas (exported for contract tests) ----------

export const ConnectorsListOutputShape = {
  connectors: z.array(ConnectorSummarySchema),
  next_cursor: z.string().nullable().optional(),
};
export const ConnectorsListOutputSchema = z.object(ConnectorsListOutputShape);

export const ConnectorsGetOutputShape = {
  connector: ConnectorSummarySchema,
};
export const ConnectorsGetOutputSchema = z.object(ConnectorsGetOutputShape);

const ConnectorToolSummaryShape = {
  name: z.string(),
  description: z.string().nullable().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
};
const ConnectorToolSummarySchema = z.object(ConnectorToolSummaryShape);

export const ConnectorsListToolsOutputShape = {
  connector_id_or_name: z.string(),
  tools: z.array(ConnectorToolSummarySchema),
};
export const ConnectorsListToolsOutputSchema = z.object(ConnectorsListToolsOutputShape);

const CallToolContentSummaryShape = {
  type: z.string(),
  text: z.string().optional(),
  mime_type: z.string().optional(),
  uri: z.string().optional(),
};
const CallToolContentSummarySchema = z.object(CallToolContentSummaryShape);

export const ConnectorsCallToolOutputShape = {
  tool_name: z.string(),
  connector_id_or_name: z.string(),
  is_error: z.boolean(),
  content: z.array(CallToolContentSummarySchema),
  mcp_meta: z.record(z.string(), z.unknown()).nullable().optional(),
};
export const ConnectorsCallToolOutputSchema = z.object(ConnectorsCallToolOutputShape);

// ---------- registration ----------

export function registerConnectorTools(server: McpServer, mistral: Mistral) {
  // ========== connectors_list ==========
  server.registerTool(
    "connectors_list",
    {
      title: "List Mistral connectors",
      description: [
        "List connectors (MCP/HTTP integrations) visible to the caller.",
        "",
        "Use `active=true` to only see connectors currently activated for this",
        "org/workspace/user. Paginate with `cursor` (from a previous response's",
        "`next_cursor`) and `pageSize`.",
        "",
        "This is discovery only — activating a new connector or managing its",
        "credentials is not exposed here; use the Mistral console for that.",
      ].join("\n"),
      inputSchema: {
        active: z
          .boolean()
          .optional()
          .describe("Filter to connectors currently active for the caller."),
        cursor: z.string().optional().describe("Pagination cursor from a previous response."),
        pageSize: z.number().int().positive().max(100).optional().describe("Default: 100."),
      },
      outputSchema: ConnectorsListOutputShape,
      annotations: {
        title: "List connectors",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.connectors.list({
          queryFilters: input.active !== undefined ? { active: input.active } : undefined,
          cursor: input.cursor,
          pageSize: input.pageSize,
        });

        const structured = {
          connectors: res.items.map(toConnectorSummary),
          next_cursor: res.pagination.nextCursor ?? undefined,
        };

        return {
          content: [toTextBlock(`Found ${structured.connectors.length} connector(s).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("connectors_list", err);
      }
    }
  );

  // ========== connectors_get ==========
  server.registerTool(
    "connectors_get",
    {
      title: "Get a Mistral connector",
      description: [
        "Fetch public metadata for one connector by ID or name.",
        "",
        "Never returns connection credentials or customer secrets — only the",
        "connector's public profile (name, description, protocol, visibility,",
        "activation/authentication status).",
      ].join("\n"),
      inputSchema: {
        connectorIdOrName: z.string().min(1).describe("Connector ID or unique name."),
      },
      outputSchema: ConnectorsGetOutputShape,
      annotations: {
        title: "Get connector",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.connectors.get({
          connectorIdOrName: input.connectorIdOrName,
        });

        const structured = { connector: toConnectorSummary(res) };

        return {
          content: [toTextBlock(`Connector "${res.name}" (${res.id}).`)],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("connectors_get", err);
      }
    }
  );

  // ========== connectors_list_tools ==========
  server.registerTool(
    "connectors_list_tools",
    {
      title: "List a connector's MCP tools",
      description: [
        "List the MCP tools exposed by one connector, with their JSON Schema",
        "input shape. Use this before connectors_call_tool to discover valid",
        "tool names and arguments.",
        "",
        "Set `refresh=true` to bypass any server-side cache of the tool catalog.",
      ].join("\n"),
      inputSchema: {
        connectorIdOrName: z.string().min(1).describe("Connector ID or unique name."),
        page: z.number().int().positive().optional().describe("1-indexed page. Default: 1."),
        pageSize: z.number().int().positive().max(100).optional().describe("Default: 100."),
        refresh: z.boolean().optional().describe("Bypass cached tool catalog. Default: false."),
        credentialsName: z
          .string()
          .optional()
          .describe("Named credential set to use, when the connector has more than one."),
      },
      outputSchema: ConnectorsListToolsOutputShape,
      annotations: {
        title: "List connector tools",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.connectors.listTools({
          connectorIdOrName: input.connectorIdOrName,
          page: input.page,
          pageSize: input.pageSize,
          refresh: input.refresh,
          pretty: true,
          credentialsName: input.credentialsName,
        });

        const raw = res as Array<Record<string, unknown>>;
        const tools = raw.map((t) => ({
          name: String(t.name ?? ""),
          description: typeof t.description === "string" ? t.description : undefined,
          input_schema:
            (t.inputSchema as Record<string, unknown> | undefined) ??
            (t.jsonschema as Record<string, unknown> | undefined) ??
            undefined,
        }));

        const structured = {
          connector_id_or_name: input.connectorIdOrName,
          tools,
        };

        return {
          content: [
            toTextBlock(
              `Connector "${input.connectorIdOrName}" exposes ${tools.length} tool(s).`
            ),
          ],
          structuredContent: structured,
        };
      } catch (err) {
        return errorResult("connectors_list_tools", err);
      }
    }
  );

  // ========== connectors_call_tool ==========
  server.registerTool(
    "connectors_call_tool",
    {
      title: "Call a connector's MCP tool",
      description: [
        "Invoke one MCP tool exposed by a connector, with JSON arguments.",
        "",
        "Use connectors_list_tools first to find `toolName` and its expected",
        "argument shape. The result's `content[]` carries the connector's raw",
        "MCP content blocks (text/image/audio/resource); `structuredContent`",
        "carries a flattened snake_case summary plus `is_error`.",
      ].join("\n"),
      inputSchema: {
        connectorIdOrName: z.string().min(1).describe("Connector ID or unique name."),
        toolName: z.string().min(1).describe("Tool name, from connectors_list_tools."),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Tool arguments matching its input schema."),
        credentialsName: z
          .string()
          .optional()
          .describe("Named credential set to use, when the connector has more than one."),
      },
      outputSchema: ConnectorsCallToolOutputShape,
      annotations: {
        title: "Call connector tool",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const res = await mistral.beta.connectors.callTool({
          toolName: input.toolName,
          connectorIdOrName: input.connectorIdOrName,
          credentialsName: input.credentialsName,
          connectorCallToolRequest: { arguments: input.arguments },
        });

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
          | { type: "audio"; data: string; mimeType: string }
        > = [];
        const summary: Array<z.infer<typeof CallToolContentSummarySchema>> = [];

        for (const block of res.content) {
          if ("isUnknown" in block) {
            content.push(toTextBlock(block));
            summary.push({ type: "unknown" });
            continue;
          }
          if (block.type === "text") {
            content.push({ type: "text", text: block.text });
            summary.push({ type: "text", text: block.text });
          } else if (block.type === "image") {
            content.push({ type: "image", data: block.data, mimeType: block.mimeType });
            summary.push({ type: "image", mime_type: block.mimeType });
          } else if (block.type === "audio") {
            content.push({ type: "audio", data: block.data, mimeType: block.mimeType });
            summary.push({ type: "audio", mime_type: block.mimeType });
          } else if (block.type === "resource_link") {
            content.push(toTextBlock(block));
            summary.push({ type: "resource_link", uri: block.uri, mime_type: block.mimeType ?? undefined });
          } else if (block.type === "resource") {
            content.push(toTextBlock(block));
            const resource = block.resource as { uri?: string; mimeType?: string };
            summary.push({ type: "resource", uri: resource.uri, mime_type: resource.mimeType });
          }
        }

        const isError =
          (res as { isError?: boolean }).isError === true ||
          Boolean((res.metadata as { mcpMeta?: { isError?: boolean } } | undefined)?.mcpMeta?.isError);

        const structured = {
          tool_name: input.toolName,
          connector_id_or_name: input.connectorIdOrName,
          is_error: isError,
          content: summary,
          mcp_meta: (res.metadata?.mcpMeta as Record<string, unknown> | undefined) ?? undefined,
        };

        return {
          content:
            content.length > 0
              ? content
              : [toTextBlock(`Tool "${input.toolName}" returned no content blocks.`)],
          structuredContent: structured,
          isError,
        };
      } catch (err) {
        return errorResult("connectors_call_tool", err);
      }
    }
  );
}
