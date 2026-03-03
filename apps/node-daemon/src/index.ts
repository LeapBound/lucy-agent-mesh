import http from "node:http";
import { URL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

import { isMeshEvent, type Frontier, type MeshEvent } from "@lucy/core";

import { loadNodeConfig } from "./config.js";
import { readJsonBody, sendError, sendJson } from "./http.js";
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

    if (method === "GET" && requestUrl.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/node") {
      sendJson(response, 200, meshNode.getNodeInfo());
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

      const url = meshNode.addPeer(body.url);
      sendJson(response, 200, { url });
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

    if (method === "POST" && requestUrl.pathname === "/p2p/events") {
      const body = await readJsonBody<PeerEventsBody>(request, config.maxBodyBytes);
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
      const body = await readJsonBody<{
        conversationId?: string;
        frontier?: Frontier;
        limit?: number;
      }>(request, config.maxBodyBytes);

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

    sendError(response, 500, errorMessage);
  }
});

const websocketServer = new WebSocketServer({
  server,
  path: "/ws"
});

websocketServer.on("connection", (socket: WebSocket) => {
  socket.send(
    JSON.stringify({
      type: "hello",
      nodeId: meshNode.identity.nodeId,
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
  void meshNode.syncFromPeers({});
}, config.syncIntervalMs);

server.listen(config.port, config.host, () => {
  const baseUrl = `http://${config.host}:${config.port}`;

  console.log("[node-daemon] started", {
    nodeId: meshNode.identity.nodeId,
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
