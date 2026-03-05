import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { MeshNodeClient } from "@lucy/sdk";

type DaemonState = "starting" | "running" | "stopped" | "failed";

interface ManagedDaemonRecord {
  daemonId: string;
  nodeName: string;
  host: string;
  port: number;
  nodeApiUrl: string;
  dataDir: string;
  logPath: string;
  state: DaemonState;
  pid: number | null;
  startedAt: string;
  updatedAt: string;
  lastError: string | null;
}

interface RuntimeState {
  activeNodeApiUrl: string;
  daemons: ManagedDaemonRecord[];
  updatedAt: string;
}

interface ManagedProcess {
  child: ChildProcess;
  logStream: WriteStream;
}

const thisFile = fileURLToPath(import.meta.url);
const thisDir = dirname(thisFile);
const mcpAppDir = resolve(thisDir, "..");
const repoRoot = resolve(mcpAppDir, "../..");
const runtimeDir = resolve(repoRoot, ".local");
const runtimeStatePath = resolve(runtimeDir, "mcp-runtime.json");
const nodeDaemonDir = resolve(repoRoot, "apps/node-daemon");

const managedDaemons = new Map<string, ManagedDaemonRecord>();
const managedProcesses = new Map<string, ManagedProcess>();

let activeNodeApiUrl = normalizeNodeApiUrl(
  process.env.NODE_API_URL ?? "http://127.0.0.1:7010"
);

await loadRuntimeState();

const server = new Server(
  {
    name: "lucy-mesh-mcp",
    version: "0.2.0"
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
        name: "get_active_node",
        description:
          "Return current active node API URL and MCP-managed daemon registry status.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "set_active_node",
        description:
          "Switch active node API URL used by node-level MCP tools (whoami/send/discovery/etc).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["nodeApiUrl"],
          properties: {
            nodeApiUrl: { type: "string" }
          }
        }
      },
      {
        name: "daemon_start",
        description:
          "Start one local node-daemon process and register it under MCP management.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["port"],
          properties: {
            daemonId: { type: "string" },
            nodeName: { type: "string" },
            host: { type: "string" },
            port: { type: "number" },
            dataDir: { type: "string" },
            publicBaseUrl: { type: "string" },
            peerUrls: {
              type: "array",
              items: { type: "string" }
            },
            discoveryAutoAcceptIntros: { type: "boolean" },
            syncIntervalMs: { type: "number" },
            networkId: { type: "string" },
            networkKey: { type: "string" },
            startupTimeoutMs: { type: "number" },
            clearDataDir: { type: "boolean" },
            reuseIfRunning: { type: "boolean" }
          }
        }
      },
      {
        name: "daemon_stop",
        description: "Stop one MCP-managed node-daemon process.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            daemonId: { type: "string" },
            port: { type: "number" },
            signal: {
              type: "string",
              enum: ["SIGTERM", "SIGINT", "SIGKILL"]
            },
            timeoutMs: { type: "number" }
          }
        }
      },
      {
        name: "daemon_status",
        description:
          "Inspect MCP-managed daemons with optional health probing and filtering.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            daemonId: { type: "string" },
            port: { type: "number" },
            includeHealth: { type: "boolean" }
          }
        }
      },
      {
        name: "mesh_quickstart_local",
        description:
          "One-call local mesh bootstrap via MCP: start N daemons, init network, join peers, connect topology, and sync.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            startPort: { type: "number" },
            nodeCount: { type: "number" },
            nodeNamePrefix: { type: "string" },
            joinTokenMaxUses: { type: "number" },
            startupTimeoutMs: { type: "number" },
            clearExisting: { type: "boolean" },
            setActiveToBootstrap: { type: "boolean" }
          }
        }
      },
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
        name: "get_identity_binding",
        description:
          "Read the local node's chain identity binding state (current phase supports chain=solana).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            chain: { type: "string" }
          }
        }
      },
      {
        name: "create_identity_challenge",
        description:
          "Create a signable Solana identity challenge for binding wallet address to this nodeId.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["walletAddress"],
          properties: {
            walletAddress: { type: "string" },
            cluster: { type: "string" },
            expiresInSeconds: { type: "number" }
          }
        }
      },
      {
        name: "bind_identity",
        description:
          "Verify a Solana signature over challenge statement, optionally verify anchorTxSignature on Solana RPC, and persist identity binding.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["challengeId", "signatureBase64"],
          properties: {
            challengeId: { type: "string" },
            signatureBase64: { type: "string" },
            anchorTxSignature: { type: "string" }
          }
        }
      },
      {
        name: "revoke_identity_binding",
        description:
          "Revoke local chain identity binding for a given chain (default solana).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            chain: { type: "string" }
          }
        }
      },
      {
        name: "discover_agents",
        description:
          "Search for agents through known peers (friend-of-friend discovery with hop limits).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string" },
            maxHops: { type: "number" },
            maxPeerFanout: { type: "number" },
            limit: { type: "number" },
            includeSelf: { type: "boolean" }
          }
        }
      },
      {
        name: "request_introduction",
        description:
          "Ask an introducer peer to connect you with a target node id (social introduction flow).",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["introducerPeerUrl", "targetNodeId"],
          properties: {
            introducerPeerUrl: { type: "string" },
            targetNodeId: { type: "string" },
            message: { type: "string" }
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
        name: "list_groups",
        description: "List local groups and member counts.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {}
        }
      },
      {
        name: "create_group",
        description:
          "Create a P2P group and optionally add initial members by node id.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            groupId: { type: "string" },
            name: { type: "string" },
            memberNodeIds: {
              type: "array",
              items: { type: "string" }
            },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "list_group_members",
        description: "List members of one group by group id.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["groupId"],
          properties: {
            groupId: { type: "string" }
          }
        }
      },
      {
        name: "add_group_member",
        description: "Add one member node id into an existing group.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["groupId", "nodeId"],
          properties: {
            groupId: { type: "string" },
            nodeId: { type: "string" },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "remove_group_member",
        description: "Remove one member node id from an existing group.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["groupId", "nodeId"],
          properties: {
            groupId: { type: "string" },
            nodeId: { type: "string" }
          }
        }
      },
      {
        name: "transfer_group_owner",
        description: "Transfer one group owner role to another existing group member.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["groupId", "nextOwnerNodeId"],
          properties: {
            groupId: { type: "string" },
            nextOwnerNodeId: { type: "string" },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "send_group_message",
        description: "Send one message into a group conversation and fanout to members.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["groupId", "content"],
          properties: {
            groupId: { type: "string" },
            content: { type: "string" },
            clientMsgId: { type: "string" }
          }
        }
      },
      {
        name: "group_inbox",
        description:
          "Read grouped inbox view (DM-like list) for groups the local node has joined.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            after: { type: "number" },
            limit: { type: "number" },
            groupId: { type: "string" }
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
      case "get_active_node": {
        const result = await getActiveNodeStatus();
        return asTextResult(result);
      }
      case "set_active_node": {
        const nodeApiUrl = normalizeNodeApiUrl(readRequiredString(args, "nodeApiUrl"));
        const health = await checkNodeHealth(nodeApiUrl);
        activeNodeApiUrl = nodeApiUrl;
        await saveRuntimeState();

        return asTextResult({
          activeNodeApiUrl,
          reachable: health,
          message: health
            ? "Active node switched"
            : "Active node switched, but /healthz is currently unreachable"
        });
      }
      case "daemon_start": {
        const result = await startManagedDaemon({
          daemonId: readOptionalString(args, "daemonId"),
          nodeName: readOptionalString(args, "nodeName"),
          host: readOptionalString(args, "host"),
          port: readRequiredPort(args, "port"),
          dataDir: readOptionalString(args, "dataDir"),
          publicBaseUrl: readOptionalString(args, "publicBaseUrl"),
          peerUrls: readOptionalStringArray(args, "peerUrls"),
          discoveryAutoAcceptIntros: readOptionalBoolean(
            args,
            "discoveryAutoAcceptIntros"
          ),
          syncIntervalMs: readOptionalInteger(args, "syncIntervalMs"),
          networkId: readOptionalString(args, "networkId"),
          networkKey: readOptionalString(args, "networkKey"),
          startupTimeoutMs: readOptionalInteger(args, "startupTimeoutMs"),
          clearDataDir: readOptionalBoolean(args, "clearDataDir"),
          reuseIfRunning: readOptionalBoolean(args, "reuseIfRunning")
        });

        return asTextResult(result);
      }
      case "daemon_stop": {
        const result = await stopManagedDaemon({
          daemonId: readOptionalString(args, "daemonId"),
          port: readOptionalPort(args, "port"),
          signal: readOptionalString(args, "signal") as NodeJS.Signals | undefined,
          timeoutMs: readOptionalInteger(args, "timeoutMs")
        });

        return asTextResult(result);
      }
      case "daemon_status": {
        const daemonId = readOptionalString(args, "daemonId");
        const port = readOptionalPort(args, "port");
        const includeHealth = readOptionalBoolean(args, "includeHealth") ?? true;
        const result = await listManagedDaemons({ daemonId, port, includeHealth });

        return asTextResult(result);
      }
      case "mesh_quickstart_local": {
        const result = await quickstartLocalMesh({
          startPort: readOptionalPort(args, "startPort"),
          nodeCount: readOptionalInteger(args, "nodeCount"),
          nodeNamePrefix: readOptionalString(args, "nodeNamePrefix"),
          joinTokenMaxUses: readOptionalInteger(args, "joinTokenMaxUses"),
          startupTimeoutMs: readOptionalInteger(args, "startupTimeoutMs"),
          clearExisting: readOptionalBoolean(args, "clearExisting"),
          setActiveToBootstrap: readOptionalBoolean(args, "setActiveToBootstrap")
        });

        return asTextResult(result);
      }
      case "whoami": {
        const result = await getActiveClient().whoAmI();
        return asTextResult(result);
      }
      case "set_display_name": {
        const displayName = readRequiredString(args, "displayName");
        const result = await getActiveClient().setDisplayName(displayName);
        return asTextResult(result);
      }
      case "get_network": {
        const result = await getActiveClient().getNetwork();
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

        const result = await getActiveClient().initNetwork({
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
        const result = await getActiveClient().createJoinToken({
          expiresInSeconds,
          maxUses,
          issuerUrl,
          bootstrapPeers
        });
        return asTextResult(result);
      }
      case "join_network": {
        const joinToken = readRequiredString(args, "joinToken");
        const result = await getActiveClient().joinNetwork(joinToken);
        return asTextResult(result);
      }
      case "get_identity_binding": {
        const chain = readOptionalString(args, "chain") ?? "solana";
        const result = await getActiveClient().getIdentityBinding(chain);
        return asTextResult(result);
      }
      case "create_identity_challenge": {
        const walletAddress = readRequiredString(args, "walletAddress");
        const cluster = readOptionalString(args, "cluster");
        const expiresInSeconds = readOptionalNumber(args, "expiresInSeconds");
        const result = await getActiveClient().createIdentityChallenge({
          walletAddress,
          cluster,
          expiresInSeconds
        });
        return asTextResult(result);
      }
      case "bind_identity": {
        const challengeId = readRequiredString(args, "challengeId");
        const signatureBase64 = readRequiredString(args, "signatureBase64");
        const anchorTxSignature = readOptionalString(args, "anchorTxSignature");
        const result = await getActiveClient().bindIdentity({
          challengeId,
          signatureBase64,
          anchorTxSignature
        });
        return asTextResult(result);
      }
      case "revoke_identity_binding": {
        const chain = readOptionalString(args, "chain") ?? "solana";
        const result = await getActiveClient().revokeIdentityBinding(chain);
        return asTextResult(result);
      }
      case "discover_agents": {
        const query = readRequiredString(args, "query");
        const maxHops = readOptionalNumber(args, "maxHops");
        const maxPeerFanout = readOptionalNumber(args, "maxPeerFanout");
        const limit = readOptionalNumber(args, "limit");
        const includeSelf = readOptionalBoolean(args, "includeSelf");

        const result = await getActiveClient().discoverAgents({
          query,
          maxHops,
          maxPeerFanout,
          limit,
          includeSelf
        });

        return asTextResult(result);
      }
      case "request_introduction": {
        const introducerPeerUrl = readRequiredString(args, "introducerPeerUrl");
        const targetNodeId = readRequiredString(args, "targetNodeId");
        const message = readOptionalString(args, "message");

        const result = await getActiveClient().requestIntroduction({
          introducerPeerUrl,
          targetNodeId,
          message
        });

        return asTextResult(result);
      }
      case "list_agents": {
        const result = await getActiveClient().listAgents();
        return asTextResult(result);
      }
      case "list_contacts": {
        const result = await getActiveClient().listContacts();
        return asTextResult(result);
      }
      case "upsert_contact": {
        const nodeId = readRequiredString(args, "nodeId");
        const alias = readOptionalString(args, "alias");
        const role = readOptionalString(args, "role");
        const capabilities = readOptionalString(args, "capabilities");
        const notes = readOptionalString(args, "notes");

        const result = await getActiveClient().upsertContact({
          nodeId,
          alias,
          role,
          capabilities,
          notes
        });

        return asTextResult(result);
      }
      case "list_groups": {
        const result = await getActiveClient().listGroups();
        return asTextResult(result);
      }
      case "create_group": {
        const groupId = readOptionalString(args, "groupId");
        const name = readRequiredString(args, "name");
        const memberNodeIds = readOptionalStringArray(args, "memberNodeIds");
        const clientMsgId = readOptionalString(args, "clientMsgId");

        const result = await getActiveClient().createGroup({
          groupId,
          name,
          memberNodeIds,
          clientMsgId
        });
        return asTextResult(result);
      }
      case "list_group_members": {
        const groupId = readRequiredString(args, "groupId");
        const result = await getActiveClient().listGroupMembers(groupId);
        return asTextResult(result);
      }
      case "add_group_member": {
        const groupId = readRequiredString(args, "groupId");
        const nodeId = readRequiredString(args, "nodeId");
        const clientMsgId = readOptionalString(args, "clientMsgId");
        const result = await getActiveClient().addGroupMember({
          groupId,
          nodeId,
          clientMsgId
        });
        return asTextResult(result);
      }
      case "remove_group_member": {
        const groupId = readRequiredString(args, "groupId");
        const nodeId = readRequiredString(args, "nodeId");
        const result = await getActiveClient().removeGroupMember({
          groupId,
          nodeId
        });
        return asTextResult(result);
      }
      case "transfer_group_owner": {
        const groupId = readRequiredString(args, "groupId");
        const nextOwnerNodeId = readRequiredString(args, "nextOwnerNodeId");
        const clientMsgId = readOptionalString(args, "clientMsgId");
        const result = await getActiveClient().transferGroupOwner({
          groupId,
          nextOwnerNodeId,
          clientMsgId
        });
        return asTextResult(result);
      }
      case "send_group_message": {
        const groupId = readRequiredString(args, "groupId");
        const content = readRequiredString(args, "content");
        const clientMsgId = readOptionalString(args, "clientMsgId");
        const result = await getActiveClient().sendGroupMessage({
          groupId,
          content,
          clientMsgId
        });
        return asTextResult(result);
      }
      case "group_inbox": {
        const after = readOptionalNumber(args, "after");
        const limit = readOptionalNumber(args, "limit");
        const groupId = readOptionalString(args, "groupId");
        const result = await getActiveClient().listGroupInbox({
          after,
          limit,
          groupId
        });
        return asTextResult(result);
      }
      case "create_conversation": {
        const conversationId = readOptionalString(args, "conversationId");
        const result = await getActiveClient().createConversation(conversationId);
        return asTextResult(result);
      }
      case "send_message": {
        const conversationId = readRequiredString(args, "conversationId");
        const content = readRequiredString(args, "content");
        const clientMsgId = readOptionalString(args, "clientMsgId");

        const result = await getActiveClient().sendMessage({
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

        const result = await getActiveClient().sendDirectMessage({
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

        const result = await getActiveClient().sendAck({
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

        const result = await getActiveClient().listEvents(conversationId, after, limit);
        return asTextResult(result);
      }
      case "add_peer": {
        const url = readRequiredString(args, "url");
        const result = await getActiveClient().addPeer(url);
        return asTextResult(result);
      }
      case "sync_from_peers": {
        const conversationId = readOptionalString(args, "conversationId");
        const result = await getActiveClient().syncFromPeers(conversationId);
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

function getActiveClient(): MeshNodeClient {
  return new MeshNodeClient({ baseUrl: activeNodeApiUrl });
}

async function getActiveNodeStatus(): Promise<{
  activeNodeApiUrl: string;
  reachable: boolean;
  managedDaemons: ManagedDaemonRecord[];
}> {
  return {
    activeNodeApiUrl,
    reachable: await checkNodeHealth(activeNodeApiUrl),
    managedDaemons: [...managedDaemons.values()].sort((left, right) =>
      left.port - right.port
    )
  };
}

async function startManagedDaemon(input: {
  daemonId?: string;
  nodeName?: string;
  host?: string;
  port: number;
  dataDir?: string;
  publicBaseUrl?: string;
  peerUrls?: string[];
  discoveryAutoAcceptIntros?: boolean;
  syncIntervalMs?: number;
  networkId?: string;
  networkKey?: string;
  startupTimeoutMs?: number;
  clearDataDir?: boolean;
  reuseIfRunning?: boolean;
}): Promise<{ daemon: ManagedDaemonRecord; reused: boolean }> {
  const host = (input.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const port = normalizePort(input.port);
  const daemonId = (input.daemonId?.trim() || `node-${port}`).toLowerCase();
  const nodeName = input.nodeName?.trim() || daemonId;
  const dataDir =
    input.dataDir?.trim() || resolve(runtimeDir, `managed-node-${port}`);
  const logPath = resolve(runtimeDir, `${daemonId}.log`);
  const nodeApiUrl = normalizeNodeApiUrl(`http://${host}:${port}`);
  const startupTimeoutMs = input.startupTimeoutMs ?? 15_000;
  const clearDataDir = input.clearDataDir ?? false;
  const reuseIfRunning = input.reuseIfRunning ?? true;

  const runningOnPort = findRunningDaemonByPort(port, daemonId);

  if (runningOnPort) {
    throw new Error(
      `Port ${port} is already used by managed daemon '${runningOnPort.daemonId}'`
    );
  }

  const existing = managedDaemons.get(daemonId);
  const existingProcess = managedProcesses.get(daemonId);

  if (existing && existingProcess && isProcessRunning(existingProcess.child)) {
    if (!reuseIfRunning) {
      throw new Error(
        `Managed daemon '${daemonId}' is already running (pid ${existingProcess.child.pid ?? "unknown"})`
      );
    }

    return {
      daemon: existing,
      reused: true
    };
  }

  if (clearDataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }

  await mkdir(runtimeDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: nodeDaemonDir,
    env: {
      ...process.env,
      NODE_HOST: host,
      NODE_PORT: String(port),
      NODE_NAME: nodeName,
      DATA_DIR: dataDir,
      ...(input.publicBaseUrl ? { PUBLIC_BASE_URL: input.publicBaseUrl } : {}),
      ...(input.peerUrls && input.peerUrls.length > 0
        ? { PEER_URLS: input.peerUrls.join(",") }
        : {}),
      ...(input.discoveryAutoAcceptIntros !== undefined
        ? {
            DISCOVERY_AUTO_ACCEPT_INTROS: String(
              input.discoveryAutoAcceptIntros
            )
          }
        : {}),
      ...(input.syncIntervalMs !== undefined
        ? { SYNC_INTERVAL_MS: String(input.syncIntervalMs) }
        : {}),
      ...(input.networkId ? { NETWORK_ID: input.networkId } : {}),
      ...(input.networkKey ? { NETWORK_KEY: input.networkKey } : {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.pipe(logStream, { end: false });
  child.stderr?.pipe(logStream, { end: false });

  const now = nowIso();
  const record: ManagedDaemonRecord = {
    daemonId,
    nodeName,
    host,
    port,
    nodeApiUrl,
    dataDir,
    logPath,
    state: "starting",
    pid: child.pid ?? null,
    startedAt: now,
    updatedAt: now,
    lastError: null
  };

  managedDaemons.set(daemonId, record);
  managedProcesses.set(daemonId, {
    child,
    logStream
  });

  child.once("exit", (code, signal) => {
    const managed = managedDaemons.get(daemonId);

    if (managed) {
      managed.pid = null;
      managed.updatedAt = nowIso();

      if (signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGKILL") {
        managed.state = "stopped";
        managed.lastError = null;
      } else if (code === 0) {
        managed.state = "stopped";
        managed.lastError = null;
      } else {
        managed.state = "failed";
        managed.lastError = `node-daemon exited with code ${code ?? "unknown"}`;
      }
    }

    const proc = managedProcesses.get(daemonId);
    if (proc) {
      proc.logStream.end();
      managedProcesses.delete(daemonId);
    }

    void saveRuntimeState();
  });

  child.once("error", (error) => {
    const managed = managedDaemons.get(daemonId);
    if (managed) {
      managed.state = "failed";
      managed.lastError = error.message;
      managed.pid = null;
      managed.updatedAt = nowIso();
    }

    void saveRuntimeState();
  });

  const healthy = await waitForNodeHealthy(nodeApiUrl, startupTimeoutMs);

  if (!healthy) {
    if (isProcessRunning(child)) {
      child.kill("SIGTERM");
      await waitForProcessExit(child, 2_000);
    }

    record.state = "failed";
    record.lastError = `Node did not become healthy within ${startupTimeoutMs}ms`;
    record.pid = null;
    record.updatedAt = nowIso();
    await saveRuntimeState();

    throw new Error(record.lastError);
  }

  record.state = "running";
  record.updatedAt = nowIso();
  record.lastError = null;
  await saveRuntimeState();

  return {
    daemon: record,
    reused: false
  };
}

async function stopManagedDaemon(input: {
  daemonId?: string;
  port?: number;
  signal?: NodeJS.Signals;
  timeoutMs?: number;
}): Promise<{
  daemon: ManagedDaemonRecord;
  stopped: boolean;
  message: string;
}> {
  const signal = normalizeStopSignal(input.signal ?? "SIGTERM");
  const timeoutMs = input.timeoutMs ?? 5_000;
  const daemon = resolveDaemon(input.daemonId, input.port);

  if (!daemon) {
    throw new Error("Managed daemon not found. Provide daemonId or port.");
  }

  const managedProcess = managedProcesses.get(daemon.daemonId);

  if (!managedProcess || !isProcessRunning(managedProcess.child)) {
    daemon.state = "stopped";
    daemon.pid = null;
    daemon.updatedAt = nowIso();
    daemon.lastError = null;
    await saveRuntimeState();

    return {
      daemon,
      stopped: true,
      message: "Daemon was not running"
    };
  }

  managedProcess.child.kill(signal);
  let exited = await waitForProcessExit(managedProcess.child, timeoutMs);

  if (!exited) {
    managedProcess.child.kill("SIGKILL");
    exited = await waitForProcessExit(managedProcess.child, 2_000);
  }

  if (!exited) {
    daemon.state = "failed";
    daemon.updatedAt = nowIso();
    daemon.lastError = "Failed to stop daemon process";
    await saveRuntimeState();

    throw new Error(daemon.lastError);
  }

  daemon.state = "stopped";
  daemon.pid = null;
  daemon.updatedAt = nowIso();
  daemon.lastError = null;
  await saveRuntimeState();

  return {
    daemon,
    stopped: true,
    message: "Daemon stopped"
  };
}

async function listManagedDaemons(input?: {
  daemonId?: string;
  port?: number;
  includeHealth?: boolean;
}): Promise<{
  activeNodeApiUrl: string;
  count: number;
  daemons: Array<ManagedDaemonRecord & { healthy?: boolean }>;
}> {
  const includeHealth = input?.includeHealth ?? true;
  const daemons = [...managedDaemons.values()]
    .filter((daemon) => {
      if (input?.daemonId && daemon.daemonId !== input.daemonId) {
        return false;
      }

      if (input?.port !== undefined && daemon.port !== input.port) {
        return false;
      }

      return true;
    })
    .sort((left, right) => left.port - right.port);

  const enriched = await Promise.all(
    daemons.map(async (daemon) => {
      if (!includeHealth) {
        return daemon;
      }

      return {
        ...daemon,
        healthy: await checkNodeHealth(daemon.nodeApiUrl)
      };
    })
  );

  return {
    activeNodeApiUrl,
    count: enriched.length,
    daemons: enriched
  };
}

async function quickstartLocalMesh(input: {
  startPort?: number;
  nodeCount?: number;
  nodeNamePrefix?: string;
  joinTokenMaxUses?: number;
  startupTimeoutMs?: number;
  clearExisting?: boolean;
  setActiveToBootstrap?: boolean;
}): Promise<{
  networkId: string;
  joinTokenPayload: unknown;
  activeNodeApiUrl: string;
  nodes: Array<{
    daemonId: string;
    nodeApiUrl: string;
    nodeId: string;
    displayName: string | null;
    peers: Array<{ url: string; createdAt: string; lastSyncAt: string | null }>;
  }>;
}> {
  const startPort = normalizePort(input.startPort ?? 7210);
  const nodeCount = normalizeNodeCount(input.nodeCount ?? 3);
  const nodeNamePrefix = input.nodeNamePrefix?.trim() || "agent";
  const joinTokenMaxUses = Math.max(
    input.joinTokenMaxUses ?? nodeCount + 2,
    nodeCount
  );
  const startupTimeoutMs = input.startupTimeoutMs ?? 15_000;
  const clearExisting = input.clearExisting ?? true;
  const setActiveToBootstrap = input.setActiveToBootstrap ?? true;

  const startedDaemons: ManagedDaemonRecord[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const port = startPort + index;
    const daemonId = `quickstart-${port}`;

    if (clearExisting) {
      const existing = managedDaemons.get(daemonId);
      if (existing) {
        await stopManagedDaemon({ daemonId, signal: "SIGTERM", timeoutMs: 3_000 }).catch(
          () => undefined
        );
      }
    }

    const started = await startManagedDaemon({
      daemonId,
      nodeName: `${nodeNamePrefix}-${index + 1}`,
      port,
      startupTimeoutMs,
      clearDataDir: clearExisting,
      reuseIfRunning: !clearExisting
    });

    startedDaemons.push(started.daemon);
  }

  const bootstrap = startedDaemons[0];
  const bootstrapClient = new MeshNodeClient({ baseUrl: bootstrap.nodeApiUrl });

  const initResult = await bootstrapClient.initNetwork({
    bootstrapPeers: [bootstrap.nodeApiUrl],
    joinTokenMaxUses
  });

  for (const daemon of startedDaemons.slice(1)) {
    const client = new MeshNodeClient({ baseUrl: daemon.nodeApiUrl });
    await client.joinNetwork(initResult.joinToken);
  }

  for (const daemon of startedDaemons.slice(1)) {
    const client = new MeshNodeClient({ baseUrl: daemon.nodeApiUrl });
    await bootstrapClient.addPeer(daemon.nodeApiUrl);
    await client.addPeer(bootstrap.nodeApiUrl);
  }

  for (const daemon of startedDaemons) {
    const client = new MeshNodeClient({ baseUrl: daemon.nodeApiUrl });
    await client.syncFromPeers();
  }

  const nodeSummaries = await Promise.all(
    startedDaemons.map(async (daemon) => {
      const client = new MeshNodeClient({ baseUrl: daemon.nodeApiUrl });
      const who = await client.whoAmI();

      return {
        daemonId: daemon.daemonId,
        nodeApiUrl: daemon.nodeApiUrl,
        nodeId: who.nodeId,
        displayName: who.displayName,
        peers: who.peers
      };
    })
  );

  if (setActiveToBootstrap) {
    activeNodeApiUrl = bootstrap.nodeApiUrl;
  }

  await saveRuntimeState();

  return {
    networkId: initResult.network.networkId ?? "unknown",
    joinTokenPayload: initResult.joinTokenPayload,
    activeNodeApiUrl,
    nodes: nodeSummaries
  };
}

function resolveDaemon(
  daemonId?: string,
  port?: number
): ManagedDaemonRecord | undefined {
  if (daemonId && daemonId.trim()) {
    return managedDaemons.get(daemonId.trim().toLowerCase());
  }

  if (port !== undefined) {
    return [...managedDaemons.values()].find((daemon) => daemon.port === port);
  }

  return undefined;
}

function findRunningDaemonByPort(
  port: number,
  excludeDaemonId?: string
): ManagedDaemonRecord | undefined {
  for (const daemon of managedDaemons.values()) {
    if (daemon.port !== port) {
      continue;
    }

    if (excludeDaemonId && daemon.daemonId === excludeDaemonId) {
      continue;
    }

    const processRef = managedProcesses.get(daemon.daemonId);
    if (processRef && isProcessRunning(processRef.child)) {
      return daemon;
    }
  }

  return undefined;
}

function isProcessRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.killed === false;
}

async function waitForProcessExit(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null) {
    return true;
  }

  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveWait(false);
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timer);
      resolveWait(true);
    };

    child.once("exit", onExit);
  });
}

async function waitForNodeHealthy(
  nodeApiUrl: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkNodeHealth(nodeApiUrl)) {
      return true;
    }

    await sleep(250);
  }

  return false;
}

async function checkNodeHealth(nodeApiUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(`${nodeApiUrl}/healthz`, {
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function loadRuntimeState(): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });

  let parsed: RuntimeState | null = null;

  try {
    const raw = await readFile(runtimeStatePath, "utf8");
    parsed = JSON.parse(raw) as RuntimeState;
  } catch {
    parsed = null;
  }

  if (parsed?.activeNodeApiUrl && !process.env.NODE_API_URL) {
    activeNodeApiUrl = normalizeNodeApiUrl(parsed.activeNodeApiUrl);
  }

  for (const daemon of parsed?.daemons ?? []) {
    managedDaemons.set(daemon.daemonId, {
      ...daemon,
      state: "stopped",
      pid: null,
      updatedAt: nowIso(),
      lastError:
        daemon.lastError ??
        "MCP process restarted; previous daemon ownership is not attached"
    });
  }

  await saveRuntimeState();
}

async function saveRuntimeState(): Promise<void> {
  const snapshot: RuntimeState = {
    activeNodeApiUrl,
    daemons: [...managedDaemons.values()].sort((left, right) =>
      left.port - right.port
    ),
    updatedAt: nowIso()
  };

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(runtimeStatePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function normalizeNodeApiUrl(input: string): string {
  return input.trim().replace(/\/$/, "");
}

function normalizePort(input: number): number {
  if (!Number.isFinite(input)) {
    throw new Error("port must be a finite number");
  }

  const port = Math.floor(input);

  if (port < 1 || port > 65535) {
    throw new Error("port must be between 1 and 65535");
  }

  return port;
}

function normalizeNodeCount(input: number): number {
  if (!Number.isFinite(input)) {
    throw new Error("nodeCount must be a finite number");
  }

  const nodeCount = Math.floor(input);

  if (nodeCount < 2 || nodeCount > 9) {
    throw new Error("nodeCount must be between 2 and 9");
  }

  return nodeCount;
}

function normalizeStopSignal(input: NodeJS.Signals): NodeJS.Signals {
  if (input === "SIGTERM" || input === "SIGINT" || input === "SIGKILL") {
    return input;
  }

  throw new Error("signal must be one of: SIGTERM, SIGINT, SIGKILL");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

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

function readOptionalInteger(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = readOptionalNumber(record, key);

  if (value === undefined) {
    return undefined;
  }

  return Math.floor(value);
}

function readRequiredPort(record: Record<string, unknown>, key: string): number {
  const value = readOptionalNumber(record, key);

  if (value === undefined) {
    throw new Error(`${key} is required`);
  }

  return normalizePort(value);
}

function readOptionalPort(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = readOptionalNumber(record, key);

  if (value === undefined) {
    return undefined;
  }

  return normalizePort(value);
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
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
