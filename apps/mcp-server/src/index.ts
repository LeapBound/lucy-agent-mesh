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
        name: "set_display_name",
        description: "Set display name for this local mesh node.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["displayName"],
          properties: {
            displayName: { type: "string" }
          }
        }
      },
      {
        name: "get_network",
        description: "Read local network configuration state.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "init_network",
        description:
          "Initialize this node as a network bootstrap node and return a join token.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            networkId: { type: "string" },
            networkKey: { type: "string" },
            bootstrapPeers: {
              type: "array",
              items: { type: "string" }
            },
            joinTokenExpiresInSeconds: { type: "number" },
            joinTokenMaxUses: { type: "number" },
            joinTokenIssuerUrl: { type: "string" }
          }
        }
      },
      {
        name: "create_join_token",
        description:
          "Create a new join token from current network config, optionally with bootstrap peers.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            expiresInSeconds: { type: "number" },
            maxUses: { type: "number" },
            issuerUrl: { type: "string" },
            bootstrapPeers: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      },
      {
        name: "join_network",
        description: "Join an existing mesh network with a join token.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["joinToken"],
          properties: {
            joinToken: { type: "string" }
          }
        }
      },
      {
        name: "list_agents",
        description: "List known agents (self + discovered peers) for recipient selection.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "list_contacts",
        description: "List local agent contact notes (alias/role/capabilities).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "upsert_contact",
        description:
          "Create or update local contact metadata for an agent node id to reduce mis-sends.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["nodeId"],
          properties: {
            nodeId: { type: "string" },
            alias: { type: "string" },
            role: { type: "string" },
            capabilities: { type: "string" },
            notes: { type: "string" }
          }
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
        name: "send_direct_message",
        description:
          "Send a direct message to one recipient node id (conversation id is derived automatically).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["recipientNodeId", "content"],
          properties: {
            recipientNodeId: { type: "string" },
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
      case "set_display_name": {
        const displayName = readRequiredString(args, "displayName");
        const result = await client.setDisplayName(displayName);
        return asTextResult(result);
      }
      case "get_network": {
        const result = await client.getNetwork();
        return asTextResult(result);
      }
      case "init_network": {
        const networkId = readOptionalString(args, "networkId");
        const networkKey = readOptionalString(args, "networkKey");
        const bootstrapPeers = readOptionalStringArray(args, "bootstrapPeers");
        const joinTokenExpiresInSeconds = readOptionalNumber(
          args,
          "joinTokenExpiresInSeconds"
        );
        const joinTokenMaxUses = readOptionalNumber(args, "joinTokenMaxUses");
        const joinTokenIssuerUrl = readOptionalString(args, "joinTokenIssuerUrl");

        const result = await client.initNetwork({
          networkId,
          networkKey,
          bootstrapPeers,
          joinTokenExpiresInSeconds,
          joinTokenMaxUses,
          joinTokenIssuerUrl
        });

        return asTextResult(result);
      }
      case "create_join_token": {
        const expiresInSeconds = readOptionalNumber(args, "expiresInSeconds");
        const maxUses = readOptionalNumber(args, "maxUses");
        const issuerUrl = readOptionalString(args, "issuerUrl");
        const bootstrapPeers = readOptionalStringArray(args, "bootstrapPeers");
        const result = await client.createJoinToken({
          expiresInSeconds,
          maxUses,
          issuerUrl,
          bootstrapPeers
        });
        return asTextResult(result);
      }
      case "join_network": {
        const joinToken = readRequiredString(args, "joinToken");
        const result = await client.joinNetwork(joinToken);
        return asTextResult(result);
      }
      case "list_agents": {
        const result = await client.listAgents();
        return asTextResult(result);
      }
      case "list_contacts": {
        const result = await client.listContacts();
        return asTextResult(result);
      }
      case "upsert_contact": {
        const nodeId = readRequiredString(args, "nodeId");
        const alias = readOptionalString(args, "alias");
        const role = readOptionalString(args, "role");
        const capabilities = readOptionalString(args, "capabilities");
        const notes = readOptionalString(args, "notes");

        const result = await client.upsertContact({
          nodeId,
          alias,
          role,
          capabilities,
          notes
        });

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
      case "send_direct_message": {
        const recipientNodeId = readRequiredString(args, "recipientNodeId");
        const content = readRequiredString(args, "content");
        const clientMsgId = readOptionalString(args, "clientMsgId");

        const result = await client.sendDirectMessage({
          recipientNodeId,
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

function readOptionalStringArray(
  record: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${key}[${index}] must be a string`);
    }

    return item.trim();
  });
}
