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
    let verifiedP2PSenderNodeId: string | undefined;
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

      verifiedP2PSenderNodeId = verification.senderNodeId;
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

    if (method === "GET" && requestUrl.pathname === "/v1/identity/binding") {
      const chain = requestUrl.searchParams.get("chain") ?? "solana";
      const binding = meshNode.getIdentityBinding(chain);
      sendJson(response, 200, { binding });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/identity/challenge") {
      const body = await readJsonBody<{
        walletAddress?: string;
        cluster?: string;
        expiresInSeconds?: number;
      }>(request, config.maxBodyBytes);

      if (!body.walletAddress) {
        sendError(response, 400, "walletAddress is required");
        return;
      }

      const challenge = meshNode.createSolanaIdentityChallenge({
        walletAddress: body.walletAddress,
        cluster: body.cluster,
        expiresInSeconds: body.expiresInSeconds
      });

      sendJson(response, 200, {
        challenge
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/identity/bind") {
      const body = await readJsonBody<{
        challengeId?: string;
        signatureBase64?: string;
        anchorTxSignature?: string | null;
      }>(request, config.maxBodyBytes);

      if (!body.challengeId || !body.signatureBase64) {
        sendError(response, 400, "challengeId and signatureBase64 are required");
        return;
      }

      const binding = await meshNode.bindSolanaIdentity({
        challengeId: body.challengeId,
        signatureBase64: body.signatureBase64,
        anchorTxSignature: body.anchorTxSignature
      });

      sendJson(response, 200, { binding });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/identity/revoke") {
      const body = await readJsonBody<{
        chain?: string;
      }>(request, config.maxBodyBytes);

      const chain = body.chain ?? "solana";
      const binding = meshNode.revokeIdentityBinding(chain);
      sendJson(response, 200, { binding });
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

    if (method === "GET" && requestUrl.pathname === "/v1/groups") {
      sendJson(response, 200, {
        groups: meshNode.listGroups()
      });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/groups") {
      const body = await readJsonBody<{
        groupId?: string;
        name?: string;
        memberNodeIds?: string[];
        clientMsgId?: string;
      }>(request, config.maxBodyBytes);

      if (!body.name) {
        sendError(response, 400, "name is required");
        return;
      }

      const result = meshNode.createGroup({
        groupId: body.groupId,
        name: body.name,
        memberNodeIds: Array.isArray(body.memberNodeIds)
          ? body.memberNodeIds.filter(
              (item): item is string => typeof item === "string"
            )
          : undefined,
        clientMsgId: body.clientMsgId
      });

      sendJson(response, 201, result);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/groups/inbox") {
      const after = Number(requestUrl.searchParams.get("after") ?? "0");
      const limit = Number(requestUrl.searchParams.get("limit") ?? "200");
      const groupId = requestUrl.searchParams.get("groupId") ?? undefined;
      const result = meshNode.listGroupInbox({
        after,
        limit,
        groupId
      });
      sendJson(response, 200, result);
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

    if (method === "POST" && requestUrl.pathname === "/v1/discovery/query") {
      const body = await readJsonBody<{
        query?: string;
        maxHops?: number;
        maxPeerFanout?: number;
        limit?: number;
        includeSelf?: boolean;
      }>(request, config.maxBodyBytes);

      if (!body.query) {
        sendError(response, 400, "query is required");
        return;
      }

      const result = await meshNode.discoverAgents({
        query: body.query,
        maxHops: body.maxHops,
        maxPeerFanout: body.maxPeerFanout,
        limit: body.limit,
        includeSelf: body.includeSelf
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/discovery/intro-request") {
      const body = await readJsonBody<{
        introducerPeerUrl?: string;
        targetNodeId?: string;
        message?: string;
      }>(request, config.maxBodyBytes);

      if (!body.introducerPeerUrl || !body.targetNodeId) {
        sendError(response, 400, "introducerPeerUrl and targetNodeId are required");
        return;
      }

      const result = await meshNode.requestIntroduction({
        introducerPeerUrl: body.introducerPeerUrl,
        targetNodeId: body.targetNodeId,
        message: body.message
      });

      sendJson(response, 200, result);
      return;
    }

    const groupMembersRouteMatch = requestUrl.pathname.match(
      /^\/v1\/groups\/([^/]+)\/members$/
    );

    if (groupMembersRouteMatch) {
      const groupId = decodeURIComponent(groupMembersRouteMatch[1]);

      if (method === "GET") {
        sendJson(response, 200, {
          groupId,
          members: meshNode.listGroupMembers(groupId)
        });
        return;
      }

      if (method === "POST") {
        const body = await readJsonBody<{ nodeId?: string; clientMsgId?: string }>(
          request,
          config.maxBodyBytes
        );

        if (!body.nodeId) {
          sendError(response, 400, "nodeId is required");
          return;
        }

        const result = meshNode.addGroupMember({
          groupId,
          nodeId: body.nodeId,
          clientMsgId: body.clientMsgId
        });
        sendJson(response, 200, result);
        return;
      }
    }

    const groupMemberRouteMatch = requestUrl.pathname.match(
      /^\/v1\/groups\/([^/]+)\/members\/([^/]+)$/
    );

    if (method === "DELETE" && groupMemberRouteMatch) {
      const groupId = decodeURIComponent(groupMemberRouteMatch[1]);
      const nodeId = decodeURIComponent(groupMemberRouteMatch[2]);
      const result = meshNode.removeGroupMember({
        groupId,
        nodeId
      });
      sendJson(response, 200, result);
      return;
    }

    const groupOwnerRouteMatch = requestUrl.pathname.match(
      /^\/v1\/groups\/([^/]+)\/owner$/
    );

    if (method === "POST" && groupOwnerRouteMatch) {
      const groupId = decodeURIComponent(groupOwnerRouteMatch[1]);
      const body = await readJsonBody<{
        nextOwnerNodeId?: string;
        clientMsgId?: string;
      }>(request, config.maxBodyBytes);

      if (!body.nextOwnerNodeId) {
        sendError(response, 400, "nextOwnerNodeId is required");
        return;
      }

      const result = meshNode.transferGroupOwner({
        groupId,
        nextOwnerNodeId: body.nextOwnerNodeId,
        clientMsgId: body.clientMsgId
      });
      sendJson(response, 200, result);
      return;
    }

    const groupMessagesRouteMatch = requestUrl.pathname.match(
      /^\/v1\/groups\/([^/]+)\/messages$/
    );

    if (method === "POST" && groupMessagesRouteMatch) {
      const groupId = decodeURIComponent(groupMessagesRouteMatch[1]);
      const body = await readJsonBody<{ content?: string; clientMsgId?: string }>(
        request,
        config.maxBodyBytes
      );

      if (!body.content) {
        sendError(response, 400, "content is required");
        return;
      }

      const result = meshNode.sendGroupMessage({
        groupId,
        content: body.content,
        clientMsgId: body.clientMsgId
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

    if (method === "POST" && requestUrl.pathname === "/p2p/discovery/query") {
      const body = parseRawJsonOrError<{
        queryId?: string;
        originNodeId?: string;
        query?: string;
        maxHops?: number;
        hops?: number;
        maxPeerFanout?: number;
        limit?: number;
        includeSelf?: boolean;
        excludeNodeIds?: string[];
      }>(response, p2pBodyText);

      if (!body) {
        return;
      }

      const queryId = typeof body.queryId === "string" ? body.queryId : "";
      const originNodeId =
        typeof body.originNodeId === "string" ? body.originNodeId : "";
      const query = typeof body.query === "string" ? body.query : "";

      if (!queryId || !originNodeId || !query) {
        sendError(response, 400, "queryId, originNodeId and query are required");
        return;
      }

      const result = await meshNode.handleP2PDiscoveryQuery(
        {
          queryId,
          originNodeId,
          query,
          maxHops: Number(body.maxHops ?? 0),
          hops: Number(body.hops ?? 0),
          maxPeerFanout: Number(body.maxPeerFanout ?? 3),
          limit: Number(body.limit ?? 20),
          includeSelf: Boolean(body.includeSelf),
          excludeNodeIds: Array.isArray(body.excludeNodeIds)
            ? body.excludeNodeIds.filter(
                (item): item is string => typeof item === "string"
              )
            : []
        },
        verifiedP2PSenderNodeId
      );

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/p2p/discovery/intro-request") {
      const body = parseRawJsonOrError<{
        requesterNodeId?: string;
        requesterPublicKeyB64?: string;
        requesterDisplayName?: string | null;
        targetNodeId?: string;
        message?: string;
      }>(response, p2pBodyText);

      if (!body) {
        return;
      }

      if (!body.requesterNodeId || !body.requesterPublicKeyB64 || !body.targetNodeId) {
        sendError(
          response,
          400,
          "requesterNodeId, requesterPublicKeyB64 and targetNodeId are required"
        );
        return;
      }

      const result = await meshNode.handleP2PIntroductionRequest({
        requesterNodeId: body.requesterNodeId,
        requesterPublicKeyB64: body.requesterPublicKeyB64,
        requesterDisplayName: body.requesterDisplayName ?? null,
        targetNodeId: body.targetNodeId,
        message: body.message
      });

      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/p2p/discovery/intro-offer") {
      const body = parseRawJsonOrError<{
        requesterNodeId?: string;
        requesterPublicKeyB64?: string;
        requesterDisplayName?: string | null;
        targetNodeId?: string;
        message?: string;
        introducerNodeId?: string;
      }>(response, p2pBodyText);

      if (!body) {
        return;
      }

      if (
        !body.requesterNodeId ||
        !body.requesterPublicKeyB64 ||
        !body.targetNodeId ||
        !body.introducerNodeId
      ) {
        sendError(
          response,
          400,
          "requesterNodeId, requesterPublicKeyB64, targetNodeId and introducerNodeId are required"
        );
        return;
      }

      const result = meshNode.handleP2PIntroductionOffer({
        requesterNodeId: body.requesterNodeId,
        requesterPublicKeyB64: body.requesterPublicKeyB64,
        requesterDisplayName: body.requesterDisplayName ?? null,
        targetNodeId: body.targetNodeId,
        message: body.message,
        introducerNodeId: body.introducerNodeId
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
    message.includes("identity challenge") ||
    message.includes("identity signature") ||
    message.includes("anchor transaction") ||
    message.includes("anchorTxSignature") ||
    message.includes("walletAddress") ||
    message.includes("signatureBase64") ||
    message.includes("chain") ||
    message.includes("base58") ||
    message.includes("required") ||
    message.includes("must ") ||
    message.includes("mismatch") ||
    message.includes("does not match") ||
    message.includes("Unknown recipientNodeId") ||
    message.includes("groupId") ||
    message.includes("group not found") ||
    message.includes("only group owner can manage members") ||
    message.includes("nextOwnerNodeId") ||
    message.includes("local node is not a member of this group") ||
    message.includes("cannot remove local node from group") ||
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
