import { rm } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isMeshEvent, type Frontier, type MeshEvent } from "@lucy/core";

import type { NodeConfig } from "../src/config.ts";
import { MeshNode, type P2PDiscoveryQueryRequest } from "../src/mesh-node.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("three-node interaction flow supports discovery, introduction, and direct message delivery", async () => {
  const fixtureRoot = path.resolve(
    ".local",
    `e2e-interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const alphaUrl = "http://mesh-alpha.local";
  const bravoUrl = "http://mesh-bravo.local";
  const charlieUrl = "http://mesh-charlie.local";

  const alpha = createTestNode({
    nodeName: "alpha",
    publicBaseUrl: alphaUrl,
    dataDir: path.join(fixtureRoot, "alpha")
  });
  const bravo = createTestNode({
    nodeName: "bravo",
    publicBaseUrl: bravoUrl,
    dataDir: path.join(fixtureRoot, "bravo")
  });
  const charlie = createTestNode({
    nodeName: "charlie-sync",
    publicBaseUrl: charlieUrl,
    dataDir: path.join(fixtureRoot, "charlie")
  });

  const restoreFetch = installInMemoryP2PRouter([
    { baseUrl: alphaUrl, node: alpha },
    { baseUrl: bravoUrl, node: bravo },
    { baseUrl: charlieUrl, node: charlie }
  ]);

  try {
    const network = alpha.initNetwork({
      joinTokenIssuerUrl: alphaUrl,
      joinTokenMaxUses: 8
    });

    await bravo.joinNetwork(network.joinToken);
    await charlie.joinNetwork(network.joinToken);

    await alpha.addPeer(bravoUrl);
    await bravo.addPeer(alphaUrl);
    await bravo.addPeer(charlieUrl);
    await charlie.addPeer(bravoUrl);

    assert.throws(
      () =>
        alpha.sendDirectMessage({
          recipientNodeId: charlie.identity.nodeId,
          content: "hello before intro"
        }),
      /Unknown recipientNodeId/
    );

    const discovery = await alpha.discoverAgents({
      query: "charlie",
      maxHops: 2,
      maxPeerFanout: 2,
      limit: 10
    });

    const recommendation = discovery.recommendations.find(
      (item) => item.nodeId === charlie.identity.nodeId
    );

    assert.ok(recommendation, "expected to discover charlie through friend-of-friend");
    assert.equal(recommendation.viaNodeId, bravo.identity.nodeId);

    const intro = await alpha.requestIntroduction({
      introducerPeerUrl: bravoUrl,
      targetNodeId: charlie.identity.nodeId,
      message: "let's sync strategies"
    });

    assert.equal(intro.status, "accepted");
    assert.equal(intro.contact?.nodeId, charlie.identity.nodeId);
    assert.ok((intro.contact?.peerUrls.length ?? 0) > 0);

    const direct = alpha.sendDirectMessage({
      recipientNodeId: charlie.identity.nodeId,
      content: "hello from alpha"
    });

    assert.ok(direct.routedPeerUrls.length > 0);

    await waitUntil(async () => {
      await charlie.syncFromPeers({ conversationId: direct.conversationId });
      return hasMessage(
        charlie.listEvents(direct.conversationId, 0, 20).events,
        "hello from alpha"
      );
    }, 2000);

    assert.ok(
      hasMessage(
        charlie.listEvents(direct.conversationId, 0, 20).events,
        "hello from alpha"
      )
    );
  } finally {
    restoreFetch();
    alpha.close();
    bravo.close();
    charlie.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("three-node group flow supports p2p group broadcast", async () => {
  const fixtureRoot = path.resolve(
    ".local",
    `e2e-group-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const alphaUrl = "http://mesh-alpha.local";
  const bravoUrl = "http://mesh-bravo.local";
  const charlieUrl = "http://mesh-charlie.local";

  const alpha = createTestNode({
    nodeName: "alpha",
    publicBaseUrl: alphaUrl,
    dataDir: path.join(fixtureRoot, "alpha")
  });
  const bravo = createTestNode({
    nodeName: "bravo",
    publicBaseUrl: bravoUrl,
    dataDir: path.join(fixtureRoot, "bravo")
  });
  const charlie = createTestNode({
    nodeName: "charlie",
    publicBaseUrl: charlieUrl,
    dataDir: path.join(fixtureRoot, "charlie")
  });

  const restoreFetch = installInMemoryP2PRouter([
    { baseUrl: alphaUrl, node: alpha },
    { baseUrl: bravoUrl, node: bravo },
    { baseUrl: charlieUrl, node: charlie }
  ]);

  try {
    const network = alpha.initNetwork({
      joinTokenIssuerUrl: alphaUrl,
      joinTokenMaxUses: 8
    });

    await bravo.joinNetwork(network.joinToken);
    await charlie.joinNetwork(network.joinToken);

    await alpha.addPeer(bravoUrl);
    await bravo.addPeer(alphaUrl);
    await alpha.addPeer(charlieUrl);
    await charlie.addPeer(alphaUrl);
    await bravo.addPeer(charlieUrl);
    await charlie.addPeer(bravoUrl);

    const created = alpha.createGroup({
      groupId: "eng-sync",
      name: "Engineering Sync",
      memberNodeIds: [bravo.identity.nodeId, charlie.identity.nodeId]
    });

    assert.equal(created.group.groupId, "eng-sync");
    assert.equal(created.group.memberCount, 3);
    assert.equal(created.members.length, 3);
    assert.ok(created.routedPeerUrls.length > 0);

    const sent = alpha.sendGroupMessage({
      groupId: "eng-sync",
      content: "sync at 10:30"
    });

    await waitUntil(async () => {
      await bravo.syncFromPeers({ conversationId: sent.conversationId });
      return hasMessage(
        bravo.listEvents(sent.conversationId, 0, 50).events,
        "sync at 10:30"
      );
    }, 2000);

    await waitUntil(async () => {
      await charlie.syncFromPeers({ conversationId: sent.conversationId });
      return hasMessage(
        charlie.listEvents(sent.conversationId, 0, 50).events,
        "sync at 10:30"
      );
    }, 2000);

    assert.ok(
      hasMessage(bravo.listEvents(sent.conversationId, 0, 50).events, "sync at 10:30")
    );
    assert.ok(
      hasMessage(
        charlie.listEvents(sent.conversationId, 0, 50).events,
        "sync at 10:30"
      )
    );

    await charlie.syncFromPeers({ conversationId: created.group.conversationId });
    const charlieMembers = charlie.listGroupMembers("eng-sync");
    assert.equal(charlieMembers.length, 3);
  } finally {
    restoreFetch();
    alpha.close();
    bravo.close();
    charlie.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function createTestNode(input: {
  nodeName: string;
  publicBaseUrl: string;
  dataDir: string;
  peers?: string[];
}): MeshNode {
  const url = new URL(input.publicBaseUrl);
  const port =
    url.port.length > 0
      ? Number(url.port)
      : url.protocol === "https:"
        ? 443
        : 80;

  const config: NodeConfig = {
    host: url.hostname,
    port,
    dataDir: input.dataDir,
    dbPath: path.join(input.dataDir, "mesh.sqlite"),
    nodeName: input.nodeName,
    publicBaseUrl: input.publicBaseUrl,
    networkId: undefined,
    networkKey: undefined,
    peers: input.peers ?? [],
    syncIntervalMs: 15000,
    p2pAuthSkewMs: 300000,
    autoAcceptIntroductions: true,
    identityRequireAnchorTx: false,
    solanaRpcUrl: undefined,
    solanaRpcDevnetUrl: "https://api.devnet.solana.com",
    solanaRpcTestnetUrl: "https://api.testnet.solana.com",
    solanaRpcMainnetUrl: "https://api.mainnet-beta.solana.com",
    solanaRpcTimeoutMs: 5000,
    maxBodyBytes: 512 * 1024
  };

  return new MeshNode(config);
}

function installInMemoryP2PRouter(
  entries: Array<{ baseUrl: string; node: MeshNode }>
): () => void {
  const router = new Map(entries.map((entry) => [entry.baseUrl, entry.node] as const));
  const fetchBeforeInstall = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = toURL(input);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    const node = router.get(baseUrl);

    if (!node) {
      return jsonResponse(404, { error: `No test node for ${baseUrl}` });
    }

    const method = (init?.method ?? "GET").toUpperCase();
    const body = parseJsonBody(init?.body);

    try {
      const result = await dispatchP2PRequest({
        node,
        method,
        path: requestUrl.pathname,
        body
      });
      return jsonResponse(200, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected in-memory router error";
      return jsonResponse(400, { error: message });
    }
  }) as typeof fetch;

  return () => {
    globalThis.fetch = fetchBeforeInstall;
  };
}

async function dispatchP2PRequest(input: {
  node: MeshNode;
  method: string;
  path: string;
  body: unknown;
}): Promise<unknown> {
  if (input.method === "GET" && input.path === "/p2p/node-info") {
    return input.node.getPublicNodeInfo();
  }

  if (input.method === "GET" && input.path === "/p2p/conversations") {
    return {
      conversations: input.node.listConversations()
    };
  }

  if (input.method === "POST" && input.path === "/p2p/network/redeem") {
    const body = toRecord(input.body);
    const joinToken = readRequiredString(body, "joinToken");
    return input.node.redeemJoinToken(joinToken, {
      requesterNodeId: readOptionalString(body, "requesterNodeId"),
      requesterPublicKeyB64: readOptionalString(body, "requesterPublicKeyB64"),
      requesterDisplayName: readOptionalString(body, "requesterDisplayName")
    });
  }

  if (input.method === "POST" && input.path === "/p2p/discovery/query") {
    const body = toRecord(input.body);
    const request: P2PDiscoveryQueryRequest = {
      queryId: readRequiredString(body, "queryId"),
      originNodeId: readRequiredString(body, "originNodeId"),
      query: readRequiredString(body, "query"),
      maxHops: readOptionalNumber(body, "maxHops") ?? 2,
      hops: readOptionalNumber(body, "hops") ?? 1,
      maxPeerFanout: readOptionalNumber(body, "maxPeerFanout") ?? 3,
      limit: readOptionalNumber(body, "limit") ?? 20,
      includeSelf: readOptionalBoolean(body, "includeSelf") ?? false,
      excludeNodeIds: readStringArray(body, "excludeNodeIds")
    };
    return input.node.handleP2PDiscoveryQuery(request);
  }

  if (input.method === "POST" && input.path === "/p2p/discovery/intro-request") {
    const body = toRecord(input.body);
    return input.node.handleP2PIntroductionRequest({
      requesterNodeId: readRequiredString(body, "requesterNodeId"),
      requesterPublicKeyB64: readRequiredString(body, "requesterPublicKeyB64"),
      requesterDisplayName: readOptionalString(body, "requesterDisplayName") ?? null,
      targetNodeId: readRequiredString(body, "targetNodeId"),
      message: readOptionalString(body, "message")
    });
  }

  if (input.method === "POST" && input.path === "/p2p/discovery/intro-offer") {
    const body = toRecord(input.body);
    return input.node.handleP2PIntroductionOffer({
      requesterNodeId: readRequiredString(body, "requesterNodeId"),
      requesterPublicKeyB64: readRequiredString(body, "requesterPublicKeyB64"),
      requesterDisplayName: readOptionalString(body, "requesterDisplayName") ?? null,
      targetNodeId: readRequiredString(body, "targetNodeId"),
      message: readOptionalString(body, "message"),
      introducerNodeId: readRequiredString(body, "introducerNodeId")
    });
  }

  if (input.method === "POST" && input.path === "/p2p/events") {
    const body = toRecord(input.body);
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    const events = rawEvents.filter((item): item is MeshEvent => isMeshEvent(item));
    return input.node.ingestPeerEvents(events);
  }

  if (input.method === "POST" && input.path === "/p2p/sync") {
    const body = toRecord(input.body);
    const conversationId = readRequiredString(body, "conversationId");
    const frontierRaw = body.frontier;
    const frontier =
      frontierRaw && typeof frontierRaw === "object"
        ? (frontierRaw as Frontier)
        : ({} satisfies Frontier);
    const limit = readOptionalNumber(body, "limit") ?? 500;
    return {
      conversationId,
      events: input.node.listMissingEvents(conversationId, frontier, limit)
    };
  }

  throw new Error(`Unsupported in-memory p2p route: ${input.method} ${input.path}`);
}

function hasMessage(events: Array<{ kind: string; payload: unknown }>, content: string): boolean {
  return events.some((event) => {
    if (event.kind !== "message") {
      return false;
    }

    if (!event.payload || typeof event.payload !== "object") {
      return false;
    }

    return (
      "content" in event.payload &&
      typeof (event.payload as { content?: unknown }).content === "string" &&
      (event.payload as { content: string }).content === content
    );
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }

    await sleep(30);
  }

  throw new Error(`waitUntil timeout after ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toURL(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === "string") {
    return new URL(input);
  }

  return new URL(input.url);
}

function parseJsonBody(body: RequestInit["body"] | undefined): unknown {
  if (typeof body !== "string" || body.length === 0) {
    return {};
  }

  return JSON.parse(body) as unknown;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

function readRequiredString(
  body: Record<string, unknown>,
  key: string
): string {
  const value = body[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }

  return value;
}

function readOptionalString(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = body[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }

  return value;
}

function readOptionalNumber(
  body: Record<string, unknown>,
  key: string
): number | undefined {
  const value = body[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }

  return value;
}

function readOptionalBoolean(
  body: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = body[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }

  return value;
}

function readStringArray(
  body: Record<string, unknown>,
  key: string
): string[] {
  const value = body[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
