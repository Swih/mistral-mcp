#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Mistral } from "@mistralai/mistralai";
import { z } from "zod";

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error(
    "[mistral-mcp] MISTRAL_API_KEY is not set. Export it before running the server."
  );
  process.exit(1);
}

const mistral = new Mistral({ apiKey: API_KEY });

const DEFAULT_CHAT_MODEL =
  process.env.MISTRAL_DEFAULT_MODEL ?? "mistral-medium-latest";
const DEFAULT_EMBED_MODEL = "mistral-embed";

const ChatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
});

const EmbedInput = z.object({
  inputs: z.array(z.string()).min(1),
  model: z.string().optional(),
});

const server = new Server(
  { name: "mistral-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mistral_chat",
      description:
        "Generate a chat completion using a Mistral model (mistral-medium-latest, mistral-small-latest, codestral-latest, ...). Returns the assistant message text.",
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: {
                  type: "string",
                  enum: ["system", "user", "assistant"],
                },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
            minItems: 1,
          },
          model: {
            type: "string",
            description: "Mistral model id. Default: mistral-medium-latest.",
          },
          temperature: { type: "number", minimum: 0, maximum: 2 },
          max_tokens: { type: "number", minimum: 1 },
          top_p: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["messages"],
      },
    },
    {
      name: "mistral_embed",
      description:
        "Generate embeddings for one or more strings via mistral-embed. Returns vectors and token usage as JSON.",
      inputSchema: {
        type: "object",
        properties: {
          inputs: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          model: {
            type: "string",
            description: "Embedding model id. Default: mistral-embed.",
          },
        },
        required: ["inputs"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "mistral_chat") {
      const input = ChatInput.parse(args);
      const res = await mistral.chat.complete({
        model: input.model ?? DEFAULT_CHAT_MODEL,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.max_tokens,
        topP: input.top_p,
      });

      const choice = res.choices?.[0];
      const content = choice?.message?.content ?? "";
      const text =
        typeof content === "string" ? content : JSON.stringify(content);

      return {
        content: [{ type: "text", text }],
      };
    }

    if (name === "mistral_embed") {
      const input = EmbedInput.parse(args);
      const res = await mistral.embeddings.create({
        model: input.model ?? DEFAULT_EMBED_MODEL,
        inputs: input.inputs,
      });

      const vectors = res.data.map((d) => d.embedding);
      const payload = { vectors, usage: res.usage };

      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `[mistral-mcp] ${name} failed: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mistral-mcp] v0.1.0 connected on stdio");
