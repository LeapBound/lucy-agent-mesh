import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { MeshNodeClient } from "@lucy/sdk";

const baseUrl = (process.env.NODE_API_URL ?? "http://127.0.0.1:7010").replace(
  /\/$/, ""
);

const client = new MeshNodeClient({ baseUrl });

const server = new Server(
  {
    name: "lucy-mesh-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "whoami",
        description: "Return current local mesh node identity and known peers.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "create_conversation",
        description: "Create or register a conversation on this local mesh node.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            conversationId: {
              type: "string",
              description: "Optional custom conversation id"
            }
          }
        }
      },
      {
        name: "send_message",
        description: "Append a signed message event to a conversation.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId", "content"],
          properties: {
            conversationId: { type: "string" },
            content: { type: "string" },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "send_ack",
        description: "Emit a delivered/read receipt event for a message.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId", "messageId", "state"],
          properties: {
            conversationId: { type: "string" },
            messageId: { type: "string" },
            state: {
              type: "string",
              enum: ["delivered", "read"]
            },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "list_events",
        description: "List local events for a conversation from local cursor `after`.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string" },
            after: { type: "number" },
            limit: { type: "number" }
          }
        }
      },
      {
        name: "add_peer",
        description: "Add a peer daemon endpoint, for example http://127.0.0.1:7011.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: {
            url: { type: "string" }
          }
        }
      },
      {
        name: "sync_from_peers",
        description: "Pull missing events from known peers using vector-frontier sync.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            conversationId: { type: "string" }
          }
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = asRecord(request.params.arguments);

  try {
    switch (request.params.name) {
      case "whoami": {
        const result = await client.whoAmI();
        return asTextResult(result);
      }
      case "create_conversation": {
        const conversationId = readOptionalString(args, "conversationId");
        const result = await client.createConversation(conversationId);
        return asTextResult(result);
      }
      case "send_message": {
        const conversationId = readRequiredString(args, "conversationId");
        const content = readRequiredString(args, "content");
        const clientMsgId = readOptionalString(args, "clientMsgId");

        const result = await client.sendMessage({
          conversationId,
          content,
          clientMsgId
        });

        return asTextResult(result);
      }
      case "send_ack": {
        const conversationId = readRequiredString(args, "conversationId");
        const messageId = readRequiredString(args, "messageId");
        const state = readRequiredString(args, "state");

        if (state !== "delivered" && state !== "read") {
          throw new Error("state must be one of: delivered, read");
        }

        const clientMsgId = readOptionalString(args, "clientMsgId");

        const result = await client.sendAck({
          conversationId,
          messageId,
          state,
          clientMsgId
        });

        return asTextResult(result);
      }
      case "list_events": {
        const conversationId = readRequiredString(args, "conversationId");
        const after = readOptionalNumber(args, "after") ?? 0;
        const limit = readOptionalNumber(args, "limit") ?? 200;

        const result = await client.listEvents(conversationId, after, limit);
        return asTextResult(result);
      }
      case "add_peer": {
        const url = readRequiredString(args, "url");
        const result = await client.addPeer(url);
        return asTextResult(result);
      }
      case "sync_from_peers": {
        const conversationId = readOptionalString(args, "conversationId");
        const result = await client.syncFromPeers(conversationId);
        return asTextResult(result);
      }
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";

    return {
      content: [
        {
          type: "text",
          text: message
        }
      ],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

function asTextResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return {};
  }

  return input as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return value.trim();
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }

  return value;
}
