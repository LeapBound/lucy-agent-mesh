import http, {
  type IncomingHttpHeaders,
  type ServerResponse
} from "node:http";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

import { isMeshEvent, type Frontier, type MeshEvent } from "@lucy/core";

import { loadNodeConfig } from "./config.js";
import { parseJsonBody, readJsonBody, readRawBody, sendError, sendJson } from "./http.js";
import { MeshNode } from "./mesh-node.js";

interface PeerEventsBody {
  from?: string;
  events?: unknown[];
}

const config = loadNodeConfig();
const meshNode = new MeshNode(config);

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host ?? `${config.host}:${config.port}`;
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    const method = request.method ?? "GET";
    const isP2PRoute = requestUrl.pathname.startsWith("/p2p/");
    const requiresP2PAuth =
      isP2PRoute && requestUrl.pathname !== "/p2p/network/redeem";
    let p2pBodyText = "";

    if (requiresP2PAuth) {
      p2pBodyText = await readRawBody(request, config.maxBodyBytes);

      const verification = meshNode.verifyIncomingP2PRequest({
        method,
        path: requestUrl.pathname,
        bodyText: p2pBodyText,
        headers: toSingleValueHeaders(request.headers)
      });

      if (!verification.ok) {
        sendError(
          response,
          401,
          `Unauthorized p2p request: ${verification.reason ?? "invalid auth"}`
        );
        return;
      }
    }

    if (method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/node") {
      sendJson(response, 200, meshNode.getNodeInfo());
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/network") {
      sendJson(response, 200, { network: meshNode.getNetworkState() });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/network/init") {
      const body = await readJsonBody<{
        networkId?: string;
        networkKey?: string;
        bootstrapPeers?: string[];
        joinTokenExpiresInSeconds?: number;
        joinTokenMaxUses?: number;
        joinTokenIssuerUrl?: string;
      }>(request, config.maxBodyBytes);

      const result = meshNode.initNetwork({
        networkId: body.networkId,
        networkKey: body.networkKey,
        bootstrapPeers: body.bootstrapPeers,
        joinTokenExpiresInSeconds: body.joinTokenExpiresInSeconds,
        joinTokenMaxUses: body.joinTokenMaxUses,
        joinTokenIssuerUrl: body.joinTokenIssuerUrl
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/network/token") {
      const body = await readJsonBody<{
        expiresInSeconds?: number;
        maxUses?: number;
        issuerUrl?: string;
        bootstrapPeers?: string[];
      }>(request, config.maxBodyBytes);

      const result = meshNode.createJoinToken({
        expiresInSeconds: body.expiresInSeconds,
        maxUses: body.maxUses,
        issuerUrl: body.issuerUrl,
        bootstrapPeers: body.bootstrapPeers
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/network/join") {
      const body = await readJsonBody<{ joinToken?: string }>(
        request,
        config.maxBodyBytes
      );

      if (!body.joinToken) {
        sendError(response, 400, "joinToken is required");
        return;
      }

      const result = await meshNode.joinNetwork(body.joinToken);
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/node/profile") {
      const body = await readJsonBody<{ displayName?: string }>(
        request,
        config.maxBodyBytes
      );

      if (!body.displayName) {
        sendError(response, 400, "displayName is required");
        return;
      }

      const displayName = meshNode.setDisplayName(body.displayName);
      sendJson(response, 200, { displayName });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/agents") {
      sendJson(response, 200, { agents: meshNode.listAgents() });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/contacts") {
      sendJson(response, 200, { contacts: meshNode.listContacts() });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/contacts") {
      const body = await readJsonBody<{
        nodeId?: string;
        alias?: string | null;
        role?: string | null;
        capabilities?: string | null;
        notes?: string | null;
      }>(request, config.maxBodyBytes);

      if (!body.nodeId) {
        sendError(response, 400, "nodeId is required");
        return;
      }

      const profile = meshNode.upsertContact({
        nodeId: body.nodeId,
        alias: body.alias,
        role: body.role,
        capabilities: body.capabilities,
        notes: body.notes
      });

      sendJson(response, 200, {
        nodeId: body.nodeId,
        profile
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/conversations") {
      const body = await readJsonBody<{ conversationId?: string }>(
        request,
        config.maxBodyBytes
      );

      const conversationId = meshNode.createConversation(body.conversationId);
      sendJson(response, 201, { conversationId });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/peers") {
      sendJson(response, 200, { peers: meshNode.listPeers() });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/peers/connect") {
      const body = await readJsonBody<{ url?: string }>(request, config.maxBodyBytes);

      if (!body.url) {
        sendError(response, 400, "url is required");
        return;
      }

      const result = await meshNode.addPeer(body.url);
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/peers/sync") {
      const body = await readJsonBody<{ conversationId?: string; peerUrl?: string }>(
        request,
        config.maxBodyBytes
      );

      const result = await meshNode.syncFromPeers({
        conversationId: body.conversationId,
        peerUrl: body.peerUrl
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/messages") {
      const body = await readJsonBody<{
        conversationId?: string;
        content?: string;
        clientMsgId?: string;
      }>(request, config.maxBodyBytes);

      if (!body.conversationId || !body.content) {
        sendError(response, 400, "conversationId and content are required");
        return;
      }

      const result = meshNode.sendMessage({
        conversationId: body.conversationId,
        content: body.content,
        clientMsgId: body.clientMsgId
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/messages/direct") {
      const body = await readJsonBody<{
        recipientNodeId?: string;
        content?: string;
        clientMsgId?: string;
      }>(request, config.maxBodyBytes);

      if (!body.recipientNodeId || !body.content) {
        sendError(response, 400, "recipientNodeId and content are required");
        return;
      }

      const result = meshNode.sendDirectMessage({
        recipientNodeId: body.recipientNodeId,
        content: body.content,
        clientMsgId: body.clientMsgId
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/messages/ack") {
      const body = await readJsonBody<{
        conversationId?: string;
        messageId?: string;
        state?: "delivered" | "read";
        clientMsgId?: string;
      }>(request, config.maxBodyBytes);

      if (!body.conversationId || !body.messageId || !body.state) {
        sendError(response, 400, "conversationId, messageId and state are required");
        return;
      }

      const result = meshNode.sendAck({
        conversationId: body.conversationId,
        messageId: body.messageId,
        state: body.state,
        clientMsgId: body.clientMsgId
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/p2p/conversations") {
      sendJson(response, 200, {
        conversations: meshNode.listConversations()
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/p2p/node-info") {
      sendJson(response, 200, meshNode.getPublicNodeInfo());
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/p2p/network/redeem") {
      const body = await readJsonBody<{
        joinToken?: string;
        requesterNodeId?: string;
        requesterPublicKeyB64?: string;
        requesterDisplayName?: string | null;
      }>(request, config.maxBodyBytes);

      if (!body.joinToken) {
        sendError(response, 400, "joinToken is required");
        return;
      }

      const result = meshNode.redeemJoinToken(body.joinToken, {
        requesterNodeId: body.requesterNodeId,
        requesterPublicKeyB64: body.requesterPublicKeyB64,
        requesterDisplayName: body.requesterDisplayName
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/p2p/events") {
      const body = parseRawJsonOrError<PeerEventsBody>(response, p2pBodyText);

      if (!body) {
        return;
      }

      const events = (body.events ?? []).filter((event): event is MeshEvent =>
        isMeshEvent(event)
      );

      if (events.length === 0) {
        sendJson(response, 200, {
          accepted: 0,
          duplicates: 0,
          rejected: [{ eventId: "unknown", reason: "no valid events" }]
        });
        return;
      }

      const ingest = meshNode.ingestPeerEvents(events);
      sendJson(response, 200, ingest);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/p2p/sync") {
      const body = parseRawJsonOrError<{
        conversationId?: string;
        frontier?: Frontier;
        limit?: number;
      }>(response, p2pBodyText);

      if (!body) {
        return;
      }

      if (!body.conversationId) {
        sendError(response, 400, "conversationId is required");
        return;
      }

      const frontier = body.frontier ?? {};
      const limit = body.limit ?? 500;
      const events = meshNode.listMissingEvents(body.conversationId, frontier, limit);

      sendJson(response, 200, {
        conversationId: body.conversationId,
        events
      });
      return;
    }

    const eventRouteMatch = requestUrl.pathname.match(
      /^\/v1\/conversations\/([^/]+)\/events$/
    );

    if (method === "GET" && eventRouteMatch) {
      const conversationId = decodeURIComponent(eventRouteMatch[1]);
      const after = Number(requestUrl.searchParams.get("after") ?? "0");
      const limit = Number(requestUrl.searchParams.get("limit") ?? "200");

      sendJson(response, 200, meshNode.listEvents(conversationId, after, limit));
      return;
    }

    const frontierRouteMatch = requestUrl.pathname.match(
      /^\/v1\/conversations\/([^/]+)\/frontier$/
    );

    if (method === "GET" && frontierRouteMatch) {
      const conversationId = decodeURIComponent(frontierRouteMatch[1]);

      sendJson(response, 200, {
        conversationId,
        frontier: meshNode.getFrontier(conversationId)
      });
      return;
    }

    sendError(response, 404, "Not found");
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected server error";

    if (isClientInputError(errorMessage)) {
      sendError(response, 400, errorMessage);
      return;
    }

    sendError(response, 500, errorMessage);
  }
});

const websocketServer = new WebSocketServer({
  server,
  path: "/ws"
});

websocketServer.on("connection", (socket: WebSocket) => {
  const nodeInfo = meshNode.getNodeInfo();

  socket.send(
    JSON.stringify({
      type: "hello",
      nodeId: nodeInfo.nodeId,
      displayName: nodeInfo.displayName,
      now: new Date().toISOString()
    })
  );
});

meshNode.on("event", (event) => {
  const payload = JSON.stringify({
    type: "event",
    event
  });

  for (const client of websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
});

const syncTimer = setInterval(() => {
  void meshNode.syncFromPeers({}).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unexpected peer sync failure";

    if (!message.includes("Network is not configured")) {
      console.error("[node-daemon] peer sync failed", { error: message });
    }
  });
}, config.syncIntervalMs);

server.listen(config.port, config.host, () => {
  const baseUrl = `http://${config.host}:${config.port}`;

  console.log("[node-daemon] started", {
    nodeId: meshNode.identity.nodeId,
    displayName: meshNode.getNodeInfo().displayName,
    baseUrl,
    dataDir: config.dataDir,
    peers: meshNode.listPeers().map((peer) => peer.url)
  });
});

function shutdown(): void {
  clearInterval(syncTimer);
  websocketServer.close();
  server.close(() => {
    meshNode.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function isClientInputError(message: string): boolean {
  return (
    message.includes("Invalid JSON body") ||
    message.includes("Invalid joinToken") ||
    message.includes("joinToken has expired") ||
    message.includes("joinToken invite") ||
    message.includes("joinToken issuer") ||
    message.includes("joinToken redemption") ||
    message.includes("Legacy joinToken") ||
    message.includes("Network is not configured") ||
    message.includes("required") ||
    message.includes("must ") ||
    message.includes("mismatch") ||
    message.includes("does not match") ||
    message.includes("Unknown recipientNodeId") ||
    message.includes("exceeds max length")
  );
}

function parseRawJsonOrError<T>(
  response: ServerResponse,
  bodyText: string
): T | undefined {
  if (!bodyText) {
    return {} as T;
  }

  try {
    return parseJsonBody<T>(bodyText);
  } catch {
    sendError(response, 400, "Invalid JSON body");
    return undefined;
  }
}

function toSingleValueHeaders(
  headers: IncomingHttpHeaders
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
      continue;
    }

    if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = value[0];
    }
  }

  return normalized;
}
