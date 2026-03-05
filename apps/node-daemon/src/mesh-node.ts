import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  createSignedEvent,
  sortEvents,
  verifySignedEvent,
  type Frontier,
  type MeshEvent,
  type PeerSyncResponse,
  type ReceiptState,
  type UnsignedMeshEvent
} from "@lucy/core";
import {
  type AgentContactRecord,
  type GroupMemberRecord,
  type GroupWithMemberCount,
  type IdentityBindingRecord,
  type NetworkConfigRecord,
  SQLiteMeshStore,
  type PeerDirectoryEntry,
  type KnownPeer,
  type StoredMeshEvent
} from "@lucy/storage-sqlite";

import type { NodeConfig } from "./config.js";
import {
  assertJoinTokenNotExpired,
  createJoinToken,
  dedupePeers,
  generateInviteId,
  generateInviteSecret,
  generateNetworkId,
  generateNetworkKey,
  isJoinTokenV2,
  normalizeIssuerUrl,
  normalizeJoinTokenMaxUses,
  normalizeNetworkId,
  normalizeNetworkKey,
  parseJoinToken,
  sha256Hex,
  signP2PRequest,
  verifyP2PRequest,
  type JoinTokenPayload
} from "./network-auth.js";
import {
  computeIdentityCommitment,
  createSolanaIdentityStatement,
  normalizeAnchorTxSignature,
  normalizeIdentityChallengeTtl,
  normalizeSolanaCluster,
  normalizeSolanaWalletAddress,
  verifySolanaIdentitySignature
} from "./solana-identity.js";
import {
  verifySolanaAnchorTransaction,
  type SolanaRpcConfig
} from "./solana-rpc.js";

export interface MessageInput {
  conversationId: string;
  content: string;
  clientMsgId?: string;
}

export interface AckInput {
  conversationId: string;
  messageId: string;
  state: ReceiptState;
  clientMsgId?: string;
}

export interface IngestSummary {
  accepted: number;
  duplicates: number;
  rejected: Array<{ eventId: string; reason: string }>;
  insertedEvents: StoredMeshEvent[];
}

export interface SyncSummary {
  pulledEvents: number;
  conversations: string[];
}

export interface KnownAgent {
  nodeId: string;
  publicKeyB64: string | null;
  displayName: string | null;
  contact: AgentContactProfile | null;
  self: boolean;
  peerUrls: string[];
  lastSeenAt: string | null;
}

export interface AgentContactProfile {
  alias: string | null;
  role: string | null;
  capabilities: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface DirectMessageInput {
  recipientNodeId: string;
  content: string;
  clientMsgId?: string;
}

export interface DirectMessageResult {
  inserted: boolean;
  event: MeshEvent;
  conversationId: string;
  routedPeerUrls: string[];
}

export interface UpsertAgentContactInput {
  nodeId: string;
  alias?: string | null;
  role?: string | null;
  capabilities?: string | null;
  notes?: string | null;
}

export interface CreateGroupInput {
  groupId?: string;
  name: string;
  memberNodeIds?: string[];
  clientMsgId?: string;
}

export interface GroupSummary {
  groupId: string;
  conversationId: string;
  name: string;
  createdByNodeId: string;
  ownerNodeId: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}

export interface GroupMember {
  groupId: string;
  nodeId: string;
  addedByNodeId: string;
  addedAt: string;
  updatedAt: string;
}

export interface GroupMessageInput {
  groupId: string;
  content: string;
  clientMsgId?: string;
}

export interface GroupMessageResult {
  inserted: boolean;
  event: MeshEvent;
  groupId: string;
  conversationId: string;
  routedPeerUrls: string[];
}

export interface GroupInboxItem {
  localSeq: number;
  groupId: string;
  groupName: string;
  conversationId: string;
  event: MeshEvent;
}

export interface GroupMemberUpdateResult {
  changed: boolean;
  group: GroupSummary;
  members: GroupMember[];
  routedPeerUrls: string[];
  event?: MeshEvent;
}

export interface GroupOwnerTransferResult {
  changed: boolean;
  group: GroupSummary;
  routedPeerUrls: string[];
  event?: MeshEvent;
}

export interface NetworkState {
  configured: boolean;
  networkId: string | null;
  hasNetworkKey: boolean;
  keyFingerprint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SolanaIdentityChallenge {
  chain: "solana";
  challengeId: string;
  nodeId: string;
  walletAddress: string;
  cluster: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface IdentityBindingView {
  chain: string;
  nodeId: string;
  walletAddress: string;
  cluster: string;
  challengeId: string;
  anchorTxSignature: string | null;
  identityCommitment: string;
  boundAt: string;
  revokedAt: string | null;
  updatedAt: string;
}

export interface InitNetworkInput {
  networkId?: string;
  networkKey?: string;
  bootstrapPeers?: string[];
  joinTokenExpiresInSeconds?: number;
  joinTokenMaxUses?: number;
  joinTokenIssuerUrl?: string;
}

export interface JoinNetworkResult {
  network: NetworkState;
  bootstrapPeers: string[];
}

export interface RedeemJoinTokenInput {
  requesterNodeId?: string;
  requesterPublicKeyB64?: string;
  requesterDisplayName?: string | null;
}

export interface DiscoveryQueryInput {
  query: string;
  maxHops?: number;
  maxPeerFanout?: number;
  limit?: number;
  includeSelf?: boolean;
}

export interface DiscoveryRecommendation {
  nodeId: string;
  displayName: string | null;
  publicKeyB64: string | null;
  peerUrls: string[];
  viaNodeId: string;
  viaPeerUrl: string | null;
  confidence: "direct" | "transitive";
  hops: number;
  score: number;
  matchedOn: string[];
  contact: AgentContactProfile | null;
  lastSeenAt: string | null;
}

export interface DiscoverySearchResult {
  queryId: string;
  query: string;
  recommendations: DiscoveryRecommendation[];
  visitedNodeIds: string[];
  maxHops: number;
}

export interface P2PDiscoveryQueryRequest {
  queryId: string;
  originNodeId: string;
  query: string;
  maxHops: number;
  hops: number;
  maxPeerFanout: number;
  limit: number;
  includeSelf: boolean;
  excludeNodeIds: string[];
}

export interface P2PDiscoveryQueryResponse {
  queryId: string;
  responderNodeId: string;
  visitedNodeIds: string[];
  recommendations: DiscoveryRecommendation[];
}

export interface IntroductionRequestInput {
  introducerPeerUrl: string;
  targetNodeId: string;
  message?: string;
}

export interface IntroductionResult {
  status: "accepted" | "declined";
  targetNodeId: string;
  introducerNodeId: string;
  reason?: string;
  contact?: {
    nodeId: string;
    displayName: string | null;
    publicKeyB64: string;
    peerUrls: string[];
    introducedByNodeId: string;
  };
}

export interface P2PIntroductionRequest {
  requesterNodeId: string;
  requesterPublicKeyB64: string;
  requesterDisplayName: string | null;
  targetNodeId: string;
  message?: string;
}

export interface P2PIntroductionOffer {
  requesterNodeId: string;
  requesterPublicKeyB64: string;
  requesterDisplayName: string | null;
  targetNodeId: string;
  message?: string;
  introducerNodeId: string;
}

interface PeerNodeInfo {
  nodeId: string;
  publicKeyB64: string;
  displayName: string | null;
}

type GroupControlEvent =
  | {
      type: "group.created";
      groupId: string;
      name: string;
      memberNodeIds: string[];
      actorNodeId: string;
      issuedAt: string;
    }
  | {
      type: "group.member_added";
      groupId: string;
      nodeId: string;
      actorNodeId: string;
      issuedAt: string;
    }
  | {
      type: "group.member_removed";
      groupId: string;
      nodeId: string;
      actorNodeId: string;
      issuedAt: string;
    }
  | {
      type: "group.owner_transferred";
      groupId: string;
      nextOwnerNodeId: string;
      actorNodeId: string;
      issuedAt: string;
    };

const MAX_SYNC_BATCH = 1000;
const GROUP_CONVERSATION_PREFIX = "grp:";
const GROUP_CONTROL_PREFIX = "__groupctl:v1:";

export class MeshNode extends EventEmitter {
  private readonly store: SQLiteMeshStore;
  private readonly p2pAuthSkewMs: number;
  private readonly publicBaseUrl: string;
  private readonly autoAcceptIntroductions: boolean;
  private readonly identityRequireAnchorTx: boolean;
  private readonly solanaRpcConfig: SolanaRpcConfig;
  private readonly seenDiscoveryQueries = new Map<string, number>();

  public readonly identity;
  private localDisplayName: string | null;
  private networkConfig: NetworkConfigRecord | null;
  private readonly replayNonces = new Map<string, number>();

  public constructor(config: NodeConfig) {
    super();
    this.store = new SQLiteMeshStore(config.dbPath);
    this.p2pAuthSkewMs = Math.max(config.p2pAuthSkewMs, 30000);
    this.publicBaseUrl = normalizeIssuerUrl(config.publicBaseUrl);
    this.autoAcceptIntroductions = config.autoAcceptIntroductions;
    this.identityRequireAnchorTx = config.identityRequireAnchorTx;
    this.solanaRpcConfig = {
      defaultRpcUrl: config.solanaRpcUrl,
      devnetRpcUrl: config.solanaRpcDevnetUrl,
      testnetRpcUrl: config.solanaRpcTestnetUrl,
      mainnetRpcUrl: config.solanaRpcMainnetUrl,
      timeoutMs: config.solanaRpcTimeoutMs
    };
    this.identity = this.store.getOrCreateIdentity();
    this.localDisplayName = this.store.getLocalDisplayName();
    this.networkConfig = this.store.getNetworkConfig();

    if (config.nodeName) {
      this.localDisplayName = this.setDisplayName(config.nodeName);
    }

    if (config.networkId && config.networkKey) {
      this.networkConfig = this.store.setNetworkConfig({
        networkId: normalizeNetworkId(config.networkId),
        networkKey: normalizeNetworkKey(config.networkKey)
      });
    }

    for (const peer of config.peers) {
      this.store.upsertPeer(peer);
    }
  }

  public close(): void {
    this.store.close();
  }

  public getNodeInfo(): {
    nodeId: string;
    publicKeyB64: string;
    displayName: string | null;
    peers: KnownPeer[];
    network: NetworkState;
  } {
    return {
      nodeId: this.identity.nodeId,
      publicKeyB64: this.identity.publicKeyB64,
      displayName: this.localDisplayName,
      peers: this.store.listPeers(),
      network: this.getNetworkState()
    };
  }

  public getNetworkState(): NetworkState {
    return toNetworkState(this.networkConfig);
  }

  public initNetwork(input: InitNetworkInput): {
    network: NetworkState;
    joinToken: string;
    joinTokenPayload: JoinTokenPayload;
  } {
    const networkId = normalizeNetworkId(input.networkId ?? generateNetworkId());
    const networkKey = normalizeNetworkKey(input.networkKey ?? generateNetworkKey());

    this.networkConfig = this.store.setNetworkConfig({
      networkId,
      networkKey
    });

    const bootstrapPeers = dedupePeers([
      ...this.store.listPeers().map((peer) => peer.url),
      ...(input.bootstrapPeers ?? [])
    ]);

    for (const peer of bootstrapPeers) {
      this.store.upsertPeer(peer);
    }

    const token = this.createJoinToken({
      expiresInSeconds: input.joinTokenExpiresInSeconds,
      maxUses: input.joinTokenMaxUses,
      issuerUrl: input.joinTokenIssuerUrl,
      bootstrapPeers
    });

    return {
      network: this.getNetworkState(),
      joinToken: token.joinToken,
      joinTokenPayload: token.joinTokenPayload
    };
  }

  public createJoinToken(input?: {
    expiresInSeconds?: number;
    maxUses?: number;
    issuerUrl?: string;
    bootstrapPeers?: string[];
  }): {
    joinToken: string;
    joinTokenPayload: JoinTokenPayload;
  } {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    const issuerUrl = normalizeIssuerUrl(input?.issuerUrl ?? this.publicBaseUrl);
    const bootstrapPeers = dedupePeers([
      issuerUrl,
      ...this.store.listPeers().map((peer) => peer.url),
      ...(input?.bootstrapPeers ?? [])
    ]);

    for (const peer of bootstrapPeers) {
      this.store.upsertPeer(peer);
    }

    const expiresInSeconds = normalizeJoinTokenExpiresInSeconds(input?.expiresInSeconds);
    const maxUses = normalizeJoinTokenMaxUsesInput(input?.maxUses);
    const inviteId = generateInviteId();
    const inviteSecret = generateInviteSecret();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    this.store.createNetworkInvite({
      inviteId,
      inviteSecretHash: sha256Hex(inviteSecret),
      networkId: this.networkConfig.networkId,
      networkKeySnapshot: this.networkConfig.networkKey,
      issuerNodeId: this.identity.nodeId,
      issuerUrl,
      bootstrapPeers,
      expiresAt,
      maxUses
    });

    const token = createJoinToken({
      networkId: this.networkConfig.networkId,
      issuerNodeId: this.identity.nodeId,
      issuerUrl,
      inviteId,
      inviteSecret,
      bootstrapPeers,
      expiresInSeconds,
      maxUses
    });

    return {
      joinToken: token.token,
      joinTokenPayload: token.payload
    };
  }

  public async joinNetwork(joinToken: string): Promise<JoinNetworkResult> {
    const payload = parseJoinToken(joinToken);
    assertJoinTokenNotExpired(payload);

    if (!isJoinTokenV2(payload)) {
      this.networkConfig = this.store.setNetworkConfig({
        networkId: payload.networkId,
        networkKey: payload.networkKey
      });

      const legacyBootstrapPeers = dedupePeers(payload.bootstrapPeers);

      for (const peer of legacyBootstrapPeers) {
        this.store.upsertPeer(peer);
      }

      return {
        network: this.getNetworkState(),
        bootstrapPeers: legacyBootstrapPeers
      };
    }

    const redemption = await this.postJson<{
      networkId: string;
      networkKey: string;
      bootstrapPeers: string[];
      inviteId: string;
      issuerNodeId: string;
    }>(`${payload.issuerUrl}/p2p/network/redeem`, {
      joinToken,
      requesterNodeId: this.identity.nodeId,
      requesterPublicKeyB64: this.identity.publicKeyB64,
      requesterDisplayName: this.localDisplayName
    });

    const redeemedNetworkId = normalizeNetworkId(redemption.networkId);

    if (redeemedNetworkId !== payload.networkId) {
      throw new Error("joinToken redemption returned mismatched networkId");
    }

    this.networkConfig = this.store.setNetworkConfig({
      networkId: redeemedNetworkId,
      networkKey: normalizeNetworkKey(redemption.networkKey)
    });

    const redeemedPeers = Array.isArray(redemption.bootstrapPeers)
      ? redemption.bootstrapPeers
      : [];
    const bootstrapPeers = dedupePeers([
      payload.issuerUrl,
      ...payload.bootstrapPeers,
      ...redeemedPeers
    ]);

    for (const peer of bootstrapPeers) {
      this.store.upsertPeer(peer);
    }

    return {
      network: this.getNetworkState(),
      bootstrapPeers
    };
  }

  public redeemJoinToken(
    joinToken: string,
    input?: RedeemJoinTokenInput
  ): {
    networkId: string;
    networkKey: string;
    bootstrapPeers: string[];
    inviteId: string;
    issuerNodeId: string;
  } {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured on issuer. Call /v1/network/init or /v1/network/join first."
      );
    }

    if (input?.requesterNodeId && input.requesterNodeId.length > 256) {
      throw new Error("requesterNodeId exceeds max length 256");
    }

    if (input?.requesterPublicKeyB64 && input.requesterPublicKeyB64.length > 2048) {
      throw new Error("requesterPublicKeyB64 exceeds max length 2048");
    }

    if (input?.requesterDisplayName && input.requesterDisplayName.length > 120) {
      throw new Error("requesterDisplayName exceeds max length 120");
    }

    const payload = parseJoinToken(joinToken);
    assertJoinTokenNotExpired(payload);

    if (!isJoinTokenV2(payload)) {
      throw new Error(
        "Legacy joinToken cannot be redeemed. Use /v1/network/join on the target node."
      );
    }

    if (payload.issuerNodeId !== this.identity.nodeId) {
      throw new Error("joinToken issuer node mismatch");
    }

    if (payload.networkId !== this.networkConfig.networkId) {
      throw new Error("joinToken networkId does not match issuer network");
    }

    const consumeResult = this.store.consumeNetworkInvite({
      inviteId: payload.inviteId,
      inviteSecretHash: sha256Hex(payload.inviteSecret)
    });

    if (!consumeResult.ok || !consumeResult.invite) {
      throw new Error(consumeResult.reason ?? "joinToken redemption failed");
    }

    const bootstrapPeers = dedupePeers([
      consumeResult.invite.issuerUrl,
      ...consumeResult.invite.bootstrapPeers,
      ...this.store.listPeers().map((peer) => peer.url)
    ]);

    return {
      networkId: this.networkConfig.networkId,
      networkKey: this.networkConfig.networkKey,
      bootstrapPeers,
      inviteId: consumeResult.invite.inviteId,
      issuerNodeId: this.identity.nodeId
    };
  }

  public async discoverAgents(
    input: DiscoveryQueryInput
  ): Promise<DiscoverySearchResult> {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    const query = normalizeDiscoveryQueryText(input.query);
    const maxHops = normalizeDiscoveryMaxHops(input.maxHops);
    const maxPeerFanout = normalizeDiscoveryPeerFanout(input.maxPeerFanout);
    const limit = normalizeDiscoveryLimit(input.limit);
    const includeSelf = input.includeSelf ?? false;
    const queryId = randomUUID();

    this.registerDiscoveryQuery(queryId, 5 * 60 * 1000);

    const localRecommendations = this.buildLocalDiscoveryRecommendations({
      query,
      includeSelf,
      hops: 0,
      confidence: "direct",
      viaNodeId: this.identity.nodeId,
      viaPeerUrl: null,
      limit
    });

    const visitedNodeIds = new Set<string>([this.identity.nodeId]);
    const remoteRecommendations: DiscoveryRecommendation[] = [];

    if (maxHops > 0) {
      const peers = this.store
        .listPeers()
        .map((peer) => peer.url)
        .slice(0, maxPeerFanout);

      const responses = await Promise.allSettled(
        peers.map((peerUrl) =>
          this.postJson<P2PDiscoveryQueryResponse>(`${peerUrl}/p2p/discovery/query`, {
            queryId,
            originNodeId: this.identity.nodeId,
            query,
            maxHops,
            hops: 1,
            maxPeerFanout,
            limit,
            includeSelf: false,
            excludeNodeIds: [this.identity.nodeId]
          } satisfies P2PDiscoveryQueryRequest)
        )
      );

      for (const outcome of responses) {
        if (outcome.status !== "fulfilled") {
          continue;
        }

        for (const nodeId of outcome.value.visitedNodeIds) {
          visitedNodeIds.add(nodeId);
        }

        remoteRecommendations.push(...outcome.value.recommendations);
      }
    }

    return {
      queryId,
      query,
      recommendations: mergeDiscoveryRecommendations(
        [...localRecommendations, ...remoteRecommendations],
        limit
      ),
      visitedNodeIds: [...visitedNodeIds].sort((left, right) =>
        left.localeCompare(right)
      ),
      maxHops
    };
  }

  public async handleP2PDiscoveryQuery(
    request: P2PDiscoveryQueryRequest,
    sourceSenderNodeId?: string
  ): Promise<P2PDiscoveryQueryResponse> {
    const queryId = request.queryId.trim();
    const query = normalizeDiscoveryQueryText(request.query);
    const maxHops = normalizeDiscoveryMaxHops(request.maxHops);
    const hops = normalizeDiscoveryHop(request.hops, maxHops);
    const maxPeerFanout = normalizeDiscoveryPeerFanout(request.maxPeerFanout);
    const limit = normalizeDiscoveryLimit(request.limit);
    const includeSelf = Boolean(request.includeSelf);
    const originNodeId = request.originNodeId.trim();
    const excludeNodeIds = Array.isArray(request.excludeNodeIds)
      ? request.excludeNodeIds
      : [];

    if (!queryId) {
      throw new Error("queryId is required");
    }

    if (!originNodeId) {
      throw new Error("originNodeId is required");
    }

    if (!this.registerDiscoveryQuery(queryId, 5 * 60 * 1000)) {
      return {
        queryId,
        responderNodeId: this.identity.nodeId,
        visitedNodeIds: [this.identity.nodeId],
        recommendations: []
      };
    }

    const localRecommendations = this.buildLocalDiscoveryRecommendations({
      query,
      includeSelf,
      hops,
      confidence: hops === 0 ? "direct" : "transitive",
      viaNodeId: this.identity.nodeId,
      viaPeerUrl: null,
      limit
    });

    const visitedNodeIds = new Set<string>([this.identity.nodeId]);
    const remoteRecommendations: DiscoveryRecommendation[] = [];

    if (hops < maxHops) {
      const excludedNodeIds = new Set<string>([
        ...excludeNodeIds,
        originNodeId,
        this.identity.nodeId
      ]);
      const excludedPeerUrls = new Set<string>();

      if (sourceSenderNodeId) {
        for (const sourceUrl of this.store.findPeerUrlsByNodeId(sourceSenderNodeId)) {
          excludedPeerUrls.add(sourceUrl);
        }
      }

      for (const nodeId of excludedNodeIds) {
        for (const url of this.store.findPeerUrlsByNodeId(nodeId)) {
          excludedPeerUrls.add(url);
        }
      }

      const peers = this.store
        .listPeers()
        .map((peer) => peer.url)
        .filter((peerUrl) => !excludedPeerUrls.has(peerUrl))
        .slice(0, maxPeerFanout);

      const nextExcludeNodeIds = [...excludedNodeIds];

      const responses = await Promise.allSettled(
        peers.map((peerUrl) =>
          this.postJson<P2PDiscoveryQueryResponse>(`${peerUrl}/p2p/discovery/query`, {
            queryId,
            originNodeId,
            query,
            maxHops,
            hops: hops + 1,
            maxPeerFanout,
            limit,
            includeSelf,
            excludeNodeIds: nextExcludeNodeIds
          } satisfies P2PDiscoveryQueryRequest)
        )
      );

      for (const outcome of responses) {
        if (outcome.status !== "fulfilled") {
          continue;
        }

        for (const nodeId of outcome.value.visitedNodeIds) {
          visitedNodeIds.add(nodeId);
        }

        remoteRecommendations.push(...outcome.value.recommendations);
      }
    }

    return {
      queryId,
      responderNodeId: this.identity.nodeId,
      visitedNodeIds: [...visitedNodeIds].sort((left, right) =>
        left.localeCompare(right)
      ),
      recommendations: mergeDiscoveryRecommendations(
        [...localRecommendations, ...remoteRecommendations],
        limit
      )
    };
  }

  public async requestIntroduction(
    input: IntroductionRequestInput
  ): Promise<IntroductionResult> {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    const introducerPeerUrl = normalizePeerUrl(input.introducerPeerUrl);
    const targetNodeId = input.targetNodeId.trim();
    const message = normalizeOptionalText(input.message, 500);

    if (!targetNodeId) {
      throw new Error("targetNodeId is required");
    }

    if (targetNodeId === this.identity.nodeId) {
      throw new Error("targetNodeId must not equal local node id");
    }

    const result = await this.postJson<IntroductionResult>(
      `${introducerPeerUrl}/p2p/discovery/intro-request`,
      {
        requesterNodeId: this.identity.nodeId,
        requesterPublicKeyB64: this.identity.publicKeyB64,
        requesterDisplayName: this.localDisplayName,
        targetNodeId,
        message: message ?? undefined
      } satisfies P2PIntroductionRequest
    );

    if (result.status === "accepted" && result.contact) {
      for (const peerUrl of result.contact.peerUrls) {
        this.store.upsertPeer(peerUrl);
        this.store.upsertPeerDirectoryEntry({
          nodeId: result.contact.nodeId,
          sourceUrl: peerUrl,
          publicKeyB64: result.contact.publicKeyB64,
          displayName: result.contact.displayName
        });
      }
    }

    return result;
  }

  public async handleP2PIntroductionRequest(
    request: P2PIntroductionRequest
  ): Promise<IntroductionResult> {
    const targetNodeId = request.targetNodeId.trim();
    const requesterNodeId = request.requesterNodeId.trim();

    if (!targetNodeId) {
      throw new Error("targetNodeId is required");
    }

    if (!requesterNodeId) {
      throw new Error("requesterNodeId is required");
    }

    if (!request.requesterPublicKeyB64 || request.requesterPublicKeyB64.trim().length === 0) {
      throw new Error("requesterPublicKeyB64 is required");
    }

    const message = normalizeOptionalText(request.message, 500);

    if (targetNodeId === this.identity.nodeId) {
      return this.handleP2PIntroductionOffer({
        requesterNodeId,
        requesterPublicKeyB64: request.requesterPublicKeyB64.trim(),
        requesterDisplayName:
          normalizeOptionalText(request.requesterDisplayName ?? null, 120),
        targetNodeId,
        message: message ?? undefined,
        introducerNodeId: this.identity.nodeId
      });
    }

    const targetPeerUrls = this.store.findPeerUrlsByNodeId(targetNodeId);

    if (targetPeerUrls.length === 0) {
      return {
        status: "declined",
        targetNodeId,
        introducerNodeId: this.identity.nodeId,
        reason: "Introducer does not know how to reach target node"
      };
    }

    for (const targetPeerUrl of targetPeerUrls) {
      try {
        const response = await this.postJson<IntroductionResult>(
          `${targetPeerUrl}/p2p/discovery/intro-offer`,
          {
            requesterNodeId,
            requesterPublicKeyB64: request.requesterPublicKeyB64.trim(),
            requesterDisplayName:
              normalizeOptionalText(request.requesterDisplayName ?? null, 120),
            targetNodeId,
            message: message ?? undefined,
            introducerNodeId: this.identity.nodeId
          } satisfies P2PIntroductionOffer
        );

        if (response.status === "accepted") {
          return response;
        }
      } catch {
        continue;
      }
    }

    return {
      status: "declined",
      targetNodeId,
      introducerNodeId: this.identity.nodeId,
      reason: "Target declined or could not be reached through introducer"
    };
  }

  public handleP2PIntroductionOffer(
    request: P2PIntroductionOffer
  ): IntroductionResult {
    const targetNodeId = request.targetNodeId.trim();

    if (!targetNodeId) {
      throw new Error("targetNodeId is required");
    }

    if (targetNodeId !== this.identity.nodeId) {
      return {
        status: "declined",
        targetNodeId,
        introducerNodeId: request.introducerNodeId.trim() || "unknown",
        reason: "Target node mismatch"
      };
    }

    if (!this.autoAcceptIntroductions) {
      return {
        status: "declined",
        targetNodeId: this.identity.nodeId,
        introducerNodeId: request.introducerNodeId.trim() || "unknown",
        reason: "Target policy declined introduction"
      };
    }

    const peerUrls = dedupePeers([
      this.publicBaseUrl,
      ...this.store.listPeers().map((peer) => peer.url)
    ]).slice(0, 8);

    return {
      status: "accepted",
      targetNodeId: this.identity.nodeId,
      introducerNodeId: request.introducerNodeId.trim() || "unknown",
      contact: {
        nodeId: this.identity.nodeId,
        displayName: this.localDisplayName,
        publicKeyB64: this.identity.publicKeyB64,
        peerUrls,
        introducedByNodeId: request.introducerNodeId.trim() || "unknown"
      }
    };
  }

  public getPublicNodeInfo(): PeerNodeInfo {
    return {
      nodeId: this.identity.nodeId,
      publicKeyB64: this.identity.publicKeyB64,
      displayName: this.localDisplayName
    };
  }

  public setDisplayName(rawDisplayName: string): string {
    const displayName = normalizeDisplayName(rawDisplayName);
    this.store.setLocalDisplayName(displayName);
    this.localDisplayName = displayName;
    return displayName;
  }

  public listAgents(): KnownAgent[] {
    const directory = this.store.listPeerDirectoryEntries();
    const contacts = toContactMap(this.store.listAgentContacts());
    const aggregated = aggregateDirectory(directory);

    const remoteByNodeId = new Map(
      aggregated.map((entry) => [entry.nodeId, entry] as const)
    );

    for (const [nodeId] of contacts) {
      if (nodeId === this.identity.nodeId || remoteByNodeId.has(nodeId)) {
        continue;
      }

      remoteByNodeId.set(nodeId, {
        nodeId,
        publicKeyB64: "",
        displayName: null,
        peerUrls: this.store.findPeerUrlsByNodeId(nodeId),
        lastSeenAt: ""
      });
    }

    return [
      {
        nodeId: this.identity.nodeId,
        publicKeyB64: this.identity.publicKeyB64,
        displayName: this.localDisplayName,
        contact: contacts.get(this.identity.nodeId) ?? null,
        self: true,
        peerUrls: [],
        lastSeenAt: null
      },
      ...[...remoteByNodeId.values()]
        .filter((entry) => entry.nodeId !== this.identity.nodeId)
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
        .map((entry) => ({
          nodeId: entry.nodeId,
          publicKeyB64: entry.publicKeyB64 || null,
          displayName: entry.displayName,
          contact: contacts.get(entry.nodeId) ?? null,
          self: false,
          peerUrls: entry.peerUrls,
          lastSeenAt: entry.lastSeenAt || null
        }))
    ];
  }

  public listContacts(): Array<{ nodeId: string; profile: AgentContactProfile }> {
    return this.store.listAgentContacts().map((contact) => ({
      nodeId: contact.nodeId,
      profile: toContactProfile(contact)
    }));
  }

  public upsertContact(input: UpsertAgentContactInput): AgentContactProfile {
    const nodeId = input.nodeId.trim();

    if (!nodeId) {
      throw new Error("nodeId is required");
    }

    const alias = normalizeOptionalText(input.alias, 80);
    const role = normalizeOptionalText(input.role, 120);
    const capabilities = normalizeOptionalText(input.capabilities, 300);
    const notes = normalizeOptionalText(input.notes, 1000);

    this.store.upsertAgentContact({
      nodeId,
      alias,
      role,
      capabilities,
      notes
    });

    const updated = this.store.getAgentContact(nodeId);

    if (!updated) {
      throw new Error("failed to persist contact");
    }

    return toContactProfile(updated);
  }

  public listGroups(): GroupSummary[] {
    return this.store
      .listGroupsWithMemberCount()
      .map((group) => toGroupSummary(group));
  }

  public listGroupMembers(groupIdInput: string): GroupMember[] {
    const groupId = normalizeGroupId(groupIdInput);
    return this.store.listGroupMembers(groupId).map((member) => toGroupMember(member));
  }

  public createGroup(input: CreateGroupInput): {
    group: GroupSummary;
    members: GroupMember[];
    inserted: boolean;
    event: MeshEvent;
    routedPeerUrls: string[];
  } {
    const groupId = normalizeGroupId(input.groupId ?? randomUUID());
    const groupName = normalizeGroupName(input.name);
    const existing = this.store.getGroup(groupId);

    if (existing) {
      throw new Error("groupId already exists");
    }

    const memberNodeIds = dedupeNodeIds([
      this.identity.nodeId,
      ...(input.memberNodeIds ?? []).map((nodeId) =>
        normalizeGroupMemberNodeId(nodeId)
      )
    ]);
    const conversationId = groupConversationId(groupId);
    const now = new Date().toISOString();

    this.store.createConversation(conversationId);
    this.store.upsertGroup({
      groupId,
      conversationId,
      name: groupName,
      createdByNodeId: this.identity.nodeId,
      ownerNodeId: this.identity.nodeId,
      createdAt: now,
      updatedAt: now
    });

    for (const nodeId of memberNodeIds) {
      this.store.upsertGroupMember({
        groupId,
        nodeId,
        addedByNodeId: this.identity.nodeId,
        addedAt: now,
        updatedAt: now
      });
    }

    const controlEvent: GroupControlEvent = {
      type: "group.created",
      groupId,
      name: groupName,
      memberNodeIds,
      actorNodeId: this.identity.nodeId,
      issuedAt: now
    };
    const routedPeerUrls = this.resolvePeerUrlsForNodeIds(
      memberNodeIds.filter((nodeId) => nodeId !== this.identity.nodeId)
    );
    const persisted = this.persistAndFanout(
      this.toGroupControlUnsignedEvent(controlEvent, conversationId, input.clientMsgId),
      routedPeerUrls
    );

    return {
      group: this.getRequiredGroupSummary(groupId),
      members: this.listGroupMembers(groupId),
      inserted: persisted.inserted,
      event: persisted.event,
      routedPeerUrls
    };
  }

  public addGroupMember(input: {
    groupId: string;
    nodeId: string;
    clientMsgId?: string;
  }): GroupMemberUpdateResult {
    const group = this.getRequiredGroup(input.groupId);
    this.assertLocalGroupOwner(group);
    const nodeId = normalizeGroupMemberNodeId(input.nodeId);

    if (this.store.getGroupMember(group.groupId, nodeId)) {
      return {
        changed: false,
        group: this.getRequiredGroupSummary(group.groupId),
        members: this.listGroupMembers(group.groupId),
        routedPeerUrls: []
      };
    }

    const now = new Date().toISOString();
    this.store.upsertGroupMember({
      groupId: group.groupId,
      nodeId,
      addedByNodeId: this.identity.nodeId,
      addedAt: now,
      updatedAt: now
    });

    const controlEvent: GroupControlEvent = {
      type: "group.member_added",
      groupId: group.groupId,
      nodeId,
      actorNodeId: this.identity.nodeId,
      issuedAt: now
    };
    const routedPeerUrls = this.resolvePeerUrlsForNodeIds(
      dedupeNodeIds([
        ...this.store.listGroupMembers(group.groupId).map((member) => member.nodeId),
        nodeId
      ]).filter((memberNodeId) => memberNodeId !== this.identity.nodeId)
    );
    const persisted = this.persistAndFanout(
      this.toGroupControlUnsignedEvent(
        controlEvent,
        group.conversationId,
        input.clientMsgId
      ),
      routedPeerUrls
    );

    return {
      changed: true,
      group: this.getRequiredGroupSummary(group.groupId),
      members: this.listGroupMembers(group.groupId),
      routedPeerUrls,
      event: persisted.event
    };
  }

  public removeGroupMember(input: {
    groupId: string;
    nodeId: string;
    clientMsgId?: string;
  }): GroupMemberUpdateResult {
    const group = this.getRequiredGroup(input.groupId);
    this.assertLocalGroupOwner(group);
    const nodeId = normalizeGroupMemberNodeId(input.nodeId);

    if (nodeId === this.identity.nodeId) {
      throw new Error("cannot remove local node from group via this route");
    }

    const removed = this.store.removeGroupMember(group.groupId, nodeId);

    if (!removed) {
      return {
        changed: false,
        group: this.getRequiredGroupSummary(group.groupId),
        members: this.listGroupMembers(group.groupId),
        routedPeerUrls: []
      };
    }

    const now = new Date().toISOString();
    const controlEvent: GroupControlEvent = {
      type: "group.member_removed",
      groupId: group.groupId,
      nodeId,
      actorNodeId: this.identity.nodeId,
      issuedAt: now
    };
    const routedPeerUrls = this.resolvePeerUrlsForNodeIds(
      dedupeNodeIds([
        ...this.store.listGroupMembers(group.groupId).map((member) => member.nodeId),
        nodeId
      ]).filter((memberNodeId) => memberNodeId !== this.identity.nodeId)
    );
    const persisted = this.persistAndFanout(
      this.toGroupControlUnsignedEvent(
        controlEvent,
        group.conversationId,
        input.clientMsgId
      ),
      routedPeerUrls
    );

    return {
      changed: true,
      group: this.getRequiredGroupSummary(group.groupId),
      members: this.listGroupMembers(group.groupId),
      routedPeerUrls,
      event: persisted.event
    };
  }

  public transferGroupOwner(input: {
    groupId: string;
    nextOwnerNodeId: string;
    clientMsgId?: string;
  }): GroupOwnerTransferResult {
    const group = this.getRequiredGroup(input.groupId);
    this.assertLocalGroupOwner(group);
    const nextOwnerNodeId = normalizeGroupMemberNodeId(input.nextOwnerNodeId);

    if (nextOwnerNodeId === group.ownerNodeId) {
      return {
        changed: false,
        group: this.getRequiredGroupSummary(group.groupId),
        routedPeerUrls: []
      };
    }

    const isMember = this.store
      .listGroupMembers(group.groupId)
      .some((member) => member.nodeId === nextOwnerNodeId);

    if (!isMember) {
      throw new Error("nextOwnerNodeId must be an existing group member");
    }

    const now = new Date().toISOString();
    this.store.updateGroupOwner({
      groupId: group.groupId,
      ownerNodeId: nextOwnerNodeId,
      updatedAt: now
    });

    const controlEvent: GroupControlEvent = {
      type: "group.owner_transferred",
      groupId: group.groupId,
      nextOwnerNodeId,
      actorNodeId: this.identity.nodeId,
      issuedAt: now
    };
    const routedPeerUrls = this.resolvePeerUrlsForNodeIds(
      this.store
        .listGroupMembers(group.groupId)
        .map((member) => member.nodeId)
        .filter((nodeId) => nodeId !== this.identity.nodeId)
    );
    const persisted = this.persistAndFanout(
      this.toGroupControlUnsignedEvent(
        controlEvent,
        group.conversationId,
        input.clientMsgId
      ),
      routedPeerUrls
    );

    return {
      changed: true,
      group: this.getRequiredGroupSummary(group.groupId),
      routedPeerUrls,
      event: persisted.event
    };
  }

  public sendGroupMessage(input: GroupMessageInput): GroupMessageResult {
    const group = this.getRequiredGroup(input.groupId);
    const content = input.content.trim();

    if (!content) {
      throw new Error("content is required");
    }

    const members = this.store.listGroupMembers(group.groupId);
    const isMember = members.some((member) => member.nodeId === this.identity.nodeId);

    if (!isMember) {
      throw new Error("local node is not a member of this group");
    }

    const routedPeerUrls = this.resolvePeerUrlsForNodeIds(
      members
        .map((member) => member.nodeId)
        .filter((nodeId) => nodeId !== this.identity.nodeId)
    );
    const unsignedEvent: UnsignedMeshEvent = {
      conversationId: group.conversationId,
      senderId: this.identity.nodeId,
      senderPubKey: this.identity.publicKeyB64,
      clientMsgId: input.clientMsgId?.trim() || randomUUID(),
      kind: "message",
      lamport: this.store.nextLamport(group.conversationId),
      wallTime: new Date().toISOString(),
      payload: {
        content
      }
    };
    const result = this.persistAndFanout(
      unsignedEvent,
      routedPeerUrls.length > 0 ? routedPeerUrls : undefined
    );

    return {
      ...result,
      groupId: group.groupId,
      conversationId: group.conversationId,
      routedPeerUrls
    };
  }

  public listGroupInbox(input?: {
    after?: number;
    limit?: number;
    groupId?: string;
  }): {
    after: number;
    nextAfter: number;
    items: GroupInboxItem[];
  } {
    const after = input?.after ?? 0;
    const limit = input?.limit ?? 200;
    const normalizedAfter = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
    const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
    const groups = input?.groupId
      ? [this.getRequiredGroup(input.groupId)]
      : this.store
          .listGroupsWithMemberCount()
          .filter((group) =>
            this.store
              .listGroupMembers(group.groupId)
              .some((member) => member.nodeId === this.identity.nodeId)
          );
    const groupByConversationId = new Map(
      groups.map((group) => [group.conversationId, group] as const)
    );
    const conversationIds = [...groupByConversationId.keys()];
    const events = this.store.listEventsByConversations(
      conversationIds,
      normalizedAfter,
      normalizedLimit
    );
    const items = events
      .filter((event) => event.kind === "message")
      .filter((event) => !parseGroupControlEvent(event.payload.content))
      .map((event) => {
        const group = groupByConversationId.get(event.conversationId);

        if (!group) {
          return null;
        }

        return {
          localSeq: event.localSeq,
          groupId: group.groupId,
          groupName: group.name,
          conversationId: event.conversationId,
          event: toMeshEvent(event)
        } satisfies GroupInboxItem;
      })
      .filter((item): item is GroupInboxItem => item !== null);

    return {
      after: normalizedAfter,
      nextAfter: items.length > 0 ? items[items.length - 1].localSeq : normalizedAfter,
      items
    };
  }

  public getIdentityBinding(chain = "solana"): IdentityBindingView | null {
    const normalizedChain = normalizeIdentityChain(chain);
    const binding = this.store.getIdentityBinding(normalizedChain);

    if (!binding) {
      return null;
    }

    return toIdentityBindingView(binding);
  }

  public createSolanaIdentityChallenge(input: {
    walletAddress: string;
    cluster?: string;
    expiresInSeconds?: number;
  }): SolanaIdentityChallenge {
    const walletAddress = normalizeSolanaWalletAddress(input.walletAddress);
    const cluster = normalizeSolanaCluster(input.cluster);
    const expiresInSeconds = normalizeIdentityChallengeTtl(input.expiresInSeconds);
    const challengeId = randomUUID();
    const nonce = randomUUID().replace(/-/g, "");
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const statement = createSolanaIdentityStatement({
      nodeId: this.identity.nodeId,
      walletAddress,
      cluster,
      challengeId,
      nonce,
      issuedAt,
      expiresAt
    });

    const challenge = this.store.createIdentityChallenge({
      challengeId,
      chain: "solana",
      nodeId: this.identity.nodeId,
      walletAddress,
      cluster,
      statement,
      nonce,
      issuedAt,
      expiresAt
    });

    return toSolanaIdentityChallenge(challenge);
  }

  public async bindSolanaIdentity(input: {
    challengeId: string;
    signatureBase64: string;
    anchorTxSignature?: string | null;
  }): Promise<IdentityBindingView> {
    const challengeId = input.challengeId.trim();

    if (!challengeId) {
      throw new Error("challengeId is required");
    }

    const signatureBase64 = normalizeBase64Signature(input.signatureBase64);
    const challenge = this.store.getIdentityChallenge(challengeId);

    if (!challenge) {
      throw new Error("identity challenge not found");
    }

    if (challenge.chain !== "solana") {
      throw new Error("identity challenge chain mismatch");
    }

    if (challenge.nodeId !== this.identity.nodeId) {
      throw new Error("identity challenge node mismatch");
    }

    const anchorTxSignature = normalizeAnchorTxSignature(
      input.anchorTxSignature ?? undefined
    );

    if (!anchorTxSignature && this.identityRequireAnchorTx) {
      throw new Error(
        "anchorTxSignature is required when IDENTITY_REQUIRE_ANCHOR_TX=true"
      );
    }

    const verified = verifySolanaIdentitySignature({
      walletAddress: challenge.walletAddress,
      statement: challenge.statement,
      signatureBase64
    });

    if (!verified) {
      throw new Error("identity signature verification failed");
    }

    if (anchorTxSignature) {
      await verifySolanaAnchorTransaction({
        cluster: challenge.cluster,
        walletAddress: challenge.walletAddress,
        anchorTxSignature,
        rpc: this.solanaRpcConfig
      });
    }

    const consumed = this.store.consumeIdentityChallenge({
      challengeId,
      chain: challenge.chain,
      walletAddress: challenge.walletAddress
    });

    if (!consumed.ok || !consumed.challenge) {
      throw new Error(consumed.reason ?? "identity challenge consumption failed");
    }

    const boundAt = new Date().toISOString();
    const binding = this.store.upsertIdentityBinding({
      chain: "solana",
      nodeId: this.identity.nodeId,
      walletAddress: challenge.walletAddress,
      cluster: challenge.cluster,
      challengeId: challenge.challengeId,
      proofSignatureB64: signatureBase64,
      anchorTxSignature,
      identityCommitment: computeIdentityCommitment({
        nodeId: this.identity.nodeId,
        chain: "solana",
        walletAddress: challenge.walletAddress,
        cluster: challenge.cluster,
        challengeId: challenge.challengeId,
        signatureBase64,
        boundAt
      }),
      boundAt
    });

    return toIdentityBindingView(binding);
  }

  public revokeIdentityBinding(chain = "solana"): IdentityBindingView | null {
    const normalizedChain = normalizeIdentityChain(chain);
    const revoked = this.store.revokeIdentityBinding(normalizedChain);

    if (!revoked) {
      return null;
    }

    return toIdentityBindingView(revoked);
  }

  public buildP2PAuthHeaders(input: {
    method: string;
    path: string;
    bodyText: string;
  }): Record<string, string> {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    return signP2PRequest({
      method: input.method,
      path: input.path,
      bodyText: input.bodyText,
      networkId: this.networkConfig.networkId,
      senderNodeId: this.identity.nodeId,
      networkKey: this.networkConfig.networkKey
    });
  }

  public verifyIncomingP2PRequest(input: {
    method: string;
    path: string;
    bodyText: string;
    headers: Record<string, string | undefined>;
  }): {
    ok: boolean;
    reason?: string;
    senderNodeId?: string;
  } {
    if (!this.networkConfig) {
      return {
        ok: false,
        reason:
          "Network is not configured on receiver. Call /v1/network/init or /v1/network/join."
      };
    }

    return verifyP2PRequest({
      method: input.method,
      path: input.path,
      bodyText: input.bodyText,
      networkId: this.networkConfig.networkId,
      networkKey: this.networkConfig.networkKey,
      headers: input.headers,
      maxSkewMs: this.p2pAuthSkewMs,
      replayChecker: (key, ttlMs) => this.registerReplayNonce(key, ttlMs)
    });
  }

  public createConversation(conversationId?: string): string {
    const id = conversationId && conversationId.length > 0 ? conversationId : randomUUID();
    this.store.createConversation(id);
    return id;
  }

  public listConversations(): string[] {
    return this.store.listConversationIds();
  }

  public listPeers(): KnownPeer[] {
    return this.store.listPeers();
  }

  public async addPeer(rawUrl: string): Promise<{
    url: string;
    discovered?: PeerNodeInfo;
  }> {
    const url = normalizePeerUrl(rawUrl);
    this.store.upsertPeer(url);
    const discovered = await this.refreshPeerDirectory(url);

    return {
      url,
      discovered: discovered ?? undefined
    };
  }

  public listEvents(conversationId: string, after: number, limit: number): {
    conversationId: string;
    after: number;
    nextAfter: number;
    events: StoredMeshEvent[];
  } {
    const normalizedAfter = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
    const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
    const events = this.store.listEvents(conversationId, normalizedAfter, normalizedLimit);

    return {
      conversationId,
      after: normalizedAfter,
      nextAfter: events.length > 0 ? events[events.length - 1].localSeq : normalizedAfter,
      events
    };
  }

  public getFrontier(conversationId: string): Frontier {
    return this.store.getFrontier(conversationId);
  }

  public listMissingEvents(
    conversationId: string,
    frontier: Frontier,
    limit: number
  ): StoredMeshEvent[] {
    const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 1000);
    return this.store.listEventsForFrontier(
      conversationId,
      frontier,
      normalizedLimit
    );
  }

  public sendMessage(input: MessageInput): { inserted: boolean; event: MeshEvent } {
    const conversationId = input.conversationId.trim();
    const content = input.content.trim();

    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    if (!content) {
      throw new Error("content is required");
    }

    const unsignedEvent: UnsignedMeshEvent = {
      conversationId,
      senderId: this.identity.nodeId,
      senderPubKey: this.identity.publicKeyB64,
      clientMsgId: input.clientMsgId?.trim() || randomUUID(),
      kind: "message",
      lamport: this.store.nextLamport(conversationId),
      wallTime: new Date().toISOString(),
      payload: {
        content
      }
    };

    return this.persistAndFanout(unsignedEvent);
  }

  public sendDirectMessage(input: DirectMessageInput): DirectMessageResult {
    const recipientNodeId = input.recipientNodeId.trim();

    if (!recipientNodeId) {
      throw new Error("recipientNodeId is required");
    }

    if (recipientNodeId === this.identity.nodeId) {
      throw new Error("recipientNodeId must not equal local node id");
    }

    const routedPeerUrls = this.store.findPeerUrlsByNodeId(recipientNodeId);

    if (routedPeerUrls.length === 0) {
      throw new Error(
        "Unknown recipientNodeId. Run peer sync, check /v1/agents, or add peer contact first."
      );
    }

    const conversationId = directConversationId(
      this.identity.nodeId,
      recipientNodeId
    );
    const content = input.content.trim();

    if (!content) {
      throw new Error("content is required");
    }

    const unsignedEvent: UnsignedMeshEvent = {
      conversationId,
      senderId: this.identity.nodeId,
      senderPubKey: this.identity.publicKeyB64,
      clientMsgId: input.clientMsgId?.trim() || randomUUID(),
      kind: "message",
      lamport: this.store.nextLamport(conversationId),
      wallTime: new Date().toISOString(),
      payload: {
        content
      }
    };

    const persistResult = this.persistAndFanout(
      unsignedEvent,
      routedPeerUrls
    );

    return {
      ...persistResult,
      conversationId,
      routedPeerUrls
    };
  }

  public sendAck(input: AckInput): { inserted: boolean; event: MeshEvent } {
    const conversationId = input.conversationId.trim();
    const messageId = input.messageId.trim();

    if (!conversationId) {
      throw new Error("conversationId is required");
    }

    if (!messageId) {
      throw new Error("messageId is required");
    }

    if (input.state !== "delivered" && input.state !== "read") {
      throw new Error("state must be one of: delivered, read");
    }

    const unsignedEvent: UnsignedMeshEvent = {
      conversationId,
      senderId: this.identity.nodeId,
      senderPubKey: this.identity.publicKeyB64,
      clientMsgId: input.clientMsgId?.trim() || randomUUID(),
      kind: "receipt",
      lamport: this.store.nextLamport(conversationId),
      wallTime: new Date().toISOString(),
      payload: {
        targetEventId: messageId,
        state: input.state
      }
    };

    return this.persistAndFanout(unsignedEvent);
  }

  public ingestPeerEvents(events: MeshEvent[]): IngestSummary {
    const verifiedEvents: MeshEvent[] = [];
    const rejected: Array<{ eventId: string; reason: string }> = [];

    for (const event of events) {
      const outcome = verifySignedEvent(event);

      if (!outcome.ok) {
        rejected.push({
          eventId: event.id,
          reason: outcome.reason ?? "invalid event"
        });
        continue;
      }

      verifiedEvents.push(event);
    }

    const orderedEvents = sortEvents(verifiedEvents);
    const insertResult = this.store.insertEvents(orderedEvents);

    for (const event of insertResult.inserted) {
      this.applyDerivedStateFromStoredEvent(event);
      this.emit("event", event);
    }

    return {
      accepted: insertResult.inserted.length,
      duplicates: insertResult.duplicates,
      rejected,
      insertedEvents: insertResult.inserted
    };
  }

  public async syncFromPeers(options: {
    conversationId?: string;
    peerUrl?: string;
  }): Promise<SyncSummary> {
    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    const peers = options.peerUrl
      ? [normalizePeerUrl(options.peerUrl)]
      : this.store.listPeers().map((peer) => peer.url);

    if (peers.length === 0) {
      return {
        pulledEvents: 0,
        conversations: []
      };
    }

    const conversationIds = new Set<string>();

    if (options.conversationId) {
      conversationIds.add(options.conversationId);
    } else {
      for (const localConversationId of this.store.listConversationIds()) {
        conversationIds.add(localConversationId);
      }

      for (const peerUrl of peers) {
        await this.refreshPeerDirectory(peerUrl);
        const remoteConversations = await this.fetchPeerConversations(peerUrl);
        for (const id of remoteConversations) {
          conversationIds.add(id);
        }
      }
    }

    let pulledEvents = 0;

    for (const peerUrl of peers) {
      await this.refreshPeerDirectory(peerUrl);
      for (const conversationId of conversationIds) {
        pulledEvents += await this.pullConversationFromPeer(peerUrl, conversationId);
      }

      this.store.markPeerSynced(peerUrl);
    }

    return {
      pulledEvents,
      conversations: [...conversationIds]
    };
  }

  private getRequiredGroup(groupIdInput: string): GroupWithMemberCount {
    const groupId = normalizeGroupId(groupIdInput);
    const group = this.store
      .listGroupsWithMemberCount()
      .find((item) => item.groupId === groupId);

    if (!group) {
      throw new Error("group not found");
    }

    return group;
  }

  private getRequiredGroupSummary(groupIdInput: string): GroupSummary {
    return toGroupSummary(this.getRequiredGroup(groupIdInput));
  }

  private assertLocalGroupOwner(group: GroupWithMemberCount): void {
    if (group.ownerNodeId !== this.identity.nodeId) {
      throw new Error("only group owner can manage members");
    }
  }

  private resolvePeerUrlsForNodeIds(nodeIds: string[]): string[] {
    const urls: string[] = [];

    for (const nodeId of nodeIds) {
      for (const peerUrl of this.store.findPeerUrlsByNodeId(nodeId)) {
        urls.push(peerUrl);
      }
    }

    return dedupeUrls(urls);
  }

  private toGroupControlUnsignedEvent(
    controlEvent: GroupControlEvent,
    conversationId: string,
    clientMsgId?: string
  ): UnsignedMeshEvent {
    return {
      conversationId,
      senderId: this.identity.nodeId,
      senderPubKey: this.identity.publicKeyB64,
      clientMsgId: clientMsgId?.trim() || randomUUID(),
      kind: "message",
      lamport: this.store.nextLamport(conversationId),
      wallTime: controlEvent.issuedAt,
      payload: {
        content: encodeGroupControlEvent(controlEvent)
      }
    };
  }

  private applyDerivedStateFromStoredEvent(event: StoredMeshEvent): void {
    if (event.kind !== "message") {
      return;
    }

    const controlEvent = parseGroupControlEvent(event.payload.content);

    if (!controlEvent) {
      return;
    }

    this.applyGroupControlEvent(controlEvent, event.senderId, event.wallTime);
  }

  private applyGroupControlEvent(
    controlEvent: GroupControlEvent,
    senderNodeId: string,
    wallTime: string
  ): void {
    if (normalizeGroupMemberNodeId(controlEvent.actorNodeId) !== senderNodeId) {
      return;
    }

    const groupId = normalizeGroupId(controlEvent.groupId);
    const conversationId = groupConversationId(groupId);

    if (controlEvent.type === "group.created") {
      const actorNodeId = normalizeGroupMemberNodeId(controlEvent.actorNodeId);
      const existingGroup = this.store.getGroup(groupId);

      if (existingGroup && existingGroup.ownerNodeId !== senderNodeId) {
        return;
      }

      this.store.createConversation(conversationId);
      this.store.upsertGroup({
        groupId,
        conversationId,
        name: normalizeGroupName(controlEvent.name),
        createdByNodeId: existingGroup?.createdByNodeId ?? actorNodeId,
        ownerNodeId: existingGroup?.ownerNodeId ?? actorNodeId,
        createdAt:
          (existingGroup?.createdAt ?? controlEvent.issuedAt) || wallTime,
        updatedAt: wallTime
      });

      for (const memberNodeId of dedupeNodeIds([
        actorNodeId,
        ...controlEvent.memberNodeIds
      ])) {
        this.store.upsertGroupMember({
          groupId,
          nodeId: normalizeGroupMemberNodeId(memberNodeId),
          addedByNodeId: actorNodeId,
          addedAt: controlEvent.issuedAt || wallTime,
          updatedAt: wallTime
        });
      }

      return;
    }

    let group = this.store.getGroup(groupId);

    if (!group) {
      const actorNodeId = normalizeGroupMemberNodeId(controlEvent.actorNodeId);
      this.store.createConversation(conversationId);
      this.store.upsertGroup({
        groupId,
        conversationId,
        name: `group-${groupId.slice(0, 8)}`,
        createdByNodeId: actorNodeId,
        ownerNodeId: actorNodeId,
        createdAt: controlEvent.issuedAt || wallTime,
        updatedAt: wallTime
      });
      group = this.store.getGroup(groupId);
    }

    if (!group) {
      return;
    }

    if (group.ownerNodeId !== senderNodeId) {
      return;
    }

    if (controlEvent.type === "group.member_added") {
      this.store.upsertGroupMember({
        groupId,
        nodeId: normalizeGroupMemberNodeId(controlEvent.nodeId),
        addedByNodeId: normalizeGroupMemberNodeId(controlEvent.actorNodeId),
        addedAt: controlEvent.issuedAt || wallTime,
        updatedAt: wallTime
      });
      return;
    }

    if (controlEvent.type === "group.member_removed") {
      const targetNodeId = normalizeGroupMemberNodeId(controlEvent.nodeId);

      if (targetNodeId === group.ownerNodeId) {
        return;
      }

      this.store.removeGroupMember(
        groupId,
        targetNodeId
      );
      return;
    }

    if (controlEvent.type === "group.owner_transferred") {
      const nextOwnerNodeId = normalizeGroupMemberNodeId(
        controlEvent.nextOwnerNodeId
      );
      const isMember = this.store
        .listGroupMembers(groupId)
        .some((member) => member.nodeId === nextOwnerNodeId);

      if (!isMember) {
        return;
      }

      this.store.updateGroupOwner({
        groupId,
        ownerNodeId: nextOwnerNodeId,
        updatedAt: wallTime
      });
    }
  }

  private persistAndFanout(
    unsignedEvent: UnsignedMeshEvent,
    targetPeerUrls?: string[]
  ): {
    inserted: boolean;
    event: MeshEvent;
  } {
    const event = createSignedEvent(unsignedEvent, this.identity.privateKeyB64);
    const outcome = this.store.insertEvent(event);

    if (!outcome.inserted && outcome.existing) {
      return {
        inserted: false,
        event: toMeshEvent(outcome.existing)
      };
    }

    if (outcome.inserted) {
      const storedEvent = this.store.getEventById(event.id);

      if (storedEvent) {
        this.applyDerivedStateFromStoredEvent(storedEvent);
        this.emit("event", storedEvent);
      }

      void this.fanoutEvent(event, targetPeerUrls);
    }

    return {
      inserted: outcome.inserted,
      event
    };
  }

  private async fanoutEvent(
    event: MeshEvent,
    targetPeerUrls?: string[]
  ): Promise<void> {
    const peerUrls =
      targetPeerUrls && targetPeerUrls.length > 0
        ? dedupeUrls(targetPeerUrls)
        : this.store.listPeers().map((peer) => peer.url);

    await Promise.allSettled(
      peerUrls.map((peerUrl) =>
        this.postJson(`${peerUrl}/p2p/events`, {
          from: this.identity.nodeId,
          events: [event]
        })
      )
    );
  }

  private async pullConversationFromPeer(
    peerUrl: string,
    conversationId: string
  ): Promise<number> {
    const frontier = this.store.getFrontier(conversationId);
    const response = await this.postJson<PeerSyncResponse>(`${peerUrl}/p2p/sync`, {
      conversationId,
      frontier,
      limit: MAX_SYNC_BATCH
    });

    if (!response || !Array.isArray(response.events)) {
      return 0;
    }

    const ingest = this.ingestPeerEvents(response.events);
    return ingest.accepted;
  }

  private async refreshPeerDirectory(
    peerUrl: string
  ): Promise<PeerNodeInfo | null> {
    try {
      const response = await this.fetchJson<PeerNodeInfo>(`${peerUrl}/p2p/node-info`);

      if (
        typeof response?.nodeId !== "string" ||
        response.nodeId.length === 0 ||
        typeof response.publicKeyB64 !== "string" ||
        response.publicKeyB64.length === 0
      ) {
        return null;
      }

      if (response.nodeId === this.identity.nodeId) {
        return response;
      }

      this.store.upsertPeerDirectoryEntry({
        nodeId: response.nodeId,
        sourceUrl: peerUrl,
        publicKeyB64: response.publicKeyB64,
        displayName:
          typeof response.displayName === "string"
            ? response.displayName
            : null
      });

      return response;
    } catch {
      return null;
    }
  }

  private async fetchPeerConversations(peerUrl: string): Promise<string[]> {
    try {
      const response = await this.fetchJson<{ conversations: string[] }>(
        `${peerUrl}/p2p/conversations`
      );

      if (!response || !Array.isArray(response.conversations)) {
        return [];
      }

      return response.conversations;
    } catch {
      return [];
    }
  }

  private buildLocalDiscoveryRecommendations(input: {
    query: string;
    includeSelf: boolean;
    hops: number;
    confidence: "direct" | "transitive";
    viaNodeId: string;
    viaPeerUrl: string | null;
    limit: number;
  }): DiscoveryRecommendation[] {
    const queryTokens = toDiscoveryQueryTokens(input.query);
    const agents = this.listAgents();
    const recommendations: DiscoveryRecommendation[] = [];

    for (const agent of agents) {
      if (!input.includeSelf && agent.self) {
        continue;
      }

      const score = scoreAgentDiscovery(agent, queryTokens, input.query);

      if (score.score <= 0) {
        continue;
      }

      recommendations.push({
        nodeId: agent.nodeId,
        displayName: agent.displayName,
        publicKeyB64: agent.publicKeyB64,
        peerUrls: [...agent.peerUrls],
        viaNodeId: input.viaNodeId,
        viaPeerUrl: input.viaPeerUrl,
        confidence: input.confidence,
        hops: input.hops,
        score: score.score,
        matchedOn: score.matchedOn,
        contact: agent.contact,
        lastSeenAt: agent.lastSeenAt
      });
    }

    return mergeDiscoveryRecommendations(recommendations, input.limit);
  }

  private async postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const bodyText = JSON.stringify(body);
    const requestUrl = new URL(url);
    const authHeaders = this.maybeBuildP2PHeaders(
      "POST",
      requestUrl.pathname,
      bodyText
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders
        },
        body: bodyText,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Peer request failed: ${response.status}`);
      }

      return (await response.json()) as TResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJson<TResponse>(url: string): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const requestUrl = new URL(url);
    const authHeaders = this.maybeBuildP2PHeaders("GET", requestUrl.pathname, "");

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json",
          ...authHeaders
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Peer request failed: ${response.status}`);
      }

      return (await response.json()) as TResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private maybeBuildP2PHeaders(
    method: string,
    path: string,
    bodyText: string
  ): Record<string, string> {
    if (!path.startsWith("/p2p/")) {
      return {};
    }

    if (path === "/p2p/network/redeem") {
      return {};
    }

    if (!this.networkConfig) {
      throw new Error(
        "Network is not configured. Call /v1/network/init or /v1/network/join first."
      );
    }

    return this.buildP2PAuthHeaders({
      method,
      path,
      bodyText
    });
  }

  private registerDiscoveryQuery(queryId: string, ttlMs: number): boolean {
    const now = Date.now();

    this.cleanupDiscoveryQueryMap(now);

    if (this.seenDiscoveryQueries.has(queryId)) {
      return false;
    }

    this.seenDiscoveryQueries.set(queryId, now + Math.max(ttlMs, 5_000));
    return true;
  }

  private cleanupDiscoveryQueryMap(nowMs: number): void {
    for (const [queryId, expiresAt] of this.seenDiscoveryQueries.entries()) {
      if (expiresAt <= nowMs) {
        this.seenDiscoveryQueries.delete(queryId);
      }
    }
  }

  private registerReplayNonce(key: string, ttlMs: number): boolean {
    const now = Date.now();

    this.cleanupReplayNonceMap(now);

    if (this.replayNonces.has(key)) {
      return false;
    }

    this.replayNonces.set(key, now + Math.max(ttlMs, 1000));
    return true;
  }

  private cleanupReplayNonceMap(nowMs: number): void {
    for (const [key, expiresAt] of this.replayNonces.entries()) {
      if (expiresAt <= nowMs) {
        this.replayNonces.delete(key);
      }
    }
  }
}

function normalizePeerUrl(rawUrl: string): string {
  const url = rawUrl.trim().replace(/\/+$/, "");

  if (!url) {
    throw new Error("peer url is required");
  }

  return url;
}

function normalizeDisplayName(rawDisplayName: string): string {
  const displayName = rawDisplayName.trim();

  if (!displayName) {
    throw new Error("displayName is required");
  }

  if (displayName.length > 80) {
    throw new Error("displayName must be at most 80 characters");
  }

  return displayName;
}

function directConversationId(nodeA: string, nodeB: string): string {
  const pair = [nodeA, nodeB].sort((left, right) => left.localeCompare(right));
  return `dm:${pair[0]}:${pair[1]}`;
}

function groupConversationId(groupId: string): string {
  return `${GROUP_CONVERSATION_PREFIX}${groupId}`;
}

function normalizeGroupId(rawGroupId: string): string {
  const groupId = rawGroupId.trim();

  if (!groupId) {
    throw new Error("groupId is required");
  }

  if (groupId.length > 120) {
    throw new Error("groupId exceeds max length 120");
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(groupId)) {
    throw new Error("groupId contains unsupported characters");
  }

  return groupId;
}

function normalizeGroupName(rawGroupName: string): string {
  const groupName = rawGroupName.trim();

  if (!groupName) {
    throw new Error("name is required");
  }

  if (groupName.length > 120) {
    throw new Error("name exceeds max length 120");
  }

  return groupName;
}

function normalizeGroupMemberNodeId(rawNodeId: string): string {
  const nodeId = rawNodeId.trim();

  if (!nodeId) {
    throw new Error("nodeId is required");
  }

  if (nodeId.length > 256) {
    throw new Error("nodeId exceeds max length 256");
  }

  return nodeId;
}

function dedupeNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds)];
}

function encodeGroupControlEvent(controlEvent: GroupControlEvent): string {
  return `${GROUP_CONTROL_PREFIX}${JSON.stringify(controlEvent)}`;
}

function parseGroupControlEvent(content: string): GroupControlEvent | null {
  if (!content.startsWith(GROUP_CONTROL_PREFIX)) {
    return null;
  }

  const rawJson = content.slice(GROUP_CONTROL_PREFIX.length);

  try {
    const parsed = JSON.parse(rawJson) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const type = record.type;
    const groupId = record.groupId;
    const actorNodeId = record.actorNodeId;
    const issuedAt = record.issuedAt;

    if (
      typeof type !== "string" ||
      typeof groupId !== "string" ||
      typeof actorNodeId !== "string" ||
      typeof issuedAt !== "string"
    ) {
      return null;
    }

    if (type === "group.created") {
      if (typeof record.name !== "string" || !Array.isArray(record.memberNodeIds)) {
        return null;
      }

      const memberNodeIds = record.memberNodeIds.filter(
        (item): item is string => typeof item === "string"
      );

      return {
        type,
        groupId,
        name: record.name,
        memberNodeIds,
        actorNodeId,
        issuedAt
      };
    }

    if (type === "group.member_added" || type === "group.member_removed") {
      if (typeof record.nodeId !== "string") {
        return null;
      }

      return {
        type,
        groupId,
        nodeId: record.nodeId,
        actorNodeId,
        issuedAt
      };
    }

    if (type === "group.owner_transferred") {
      if (typeof record.nextOwnerNodeId !== "string") {
        return null;
      }

      return {
        type,
        groupId,
        nextOwnerNodeId: record.nextOwnerNodeId,
        actorNodeId,
        issuedAt
      };
    }
  } catch {
    return null;
  }

  return null;
}

function dedupeUrls(urls: string[]): string[] {
  return [...new Set(urls)];
}

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new Error(`field exceeds max length ${maxLength}`);
  }

  return normalized;
}

function normalizeBase64Signature(raw: string): string {
  const value = raw.trim();

  if (!value) {
    throw new Error("signatureBase64 is required");
  }

  if (value.length > 2048) {
    throw new Error("signatureBase64 exceeds max length 2048");
  }

  return value;
}

function normalizeIdentityChain(raw: string): string {
  const value = raw.trim().toLowerCase();

  if (!value) {
    throw new Error("chain is required");
  }

  if (value !== "solana") {
    throw new Error("only solana identity binding is supported in current phase");
  }

  return value;
}

function toContactProfile(contact: AgentContactRecord): AgentContactProfile {
  return {
    alias: contact.alias,
    role: contact.role,
    capabilities: contact.capabilities,
    notes: contact.notes,
    updatedAt: contact.updatedAt
  };
}

function toGroupSummary(group: GroupWithMemberCount): GroupSummary {
  return {
    groupId: group.groupId,
    conversationId: group.conversationId,
    name: group.name,
    createdByNodeId: group.createdByNodeId,
    ownerNodeId: group.ownerNodeId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    memberCount: group.memberCount
  };
}

function toGroupMember(member: GroupMemberRecord): GroupMember {
  return {
    groupId: member.groupId,
    nodeId: member.nodeId,
    addedByNodeId: member.addedByNodeId,
    addedAt: member.addedAt,
    updatedAt: member.updatedAt
  };
}

function toSolanaIdentityChallenge(input: {
  challengeId: string;
  nodeId: string;
  walletAddress: string;
  cluster: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): SolanaIdentityChallenge {
  return {
    chain: "solana",
    challengeId: input.challengeId,
    nodeId: input.nodeId,
    walletAddress: input.walletAddress,
    cluster: input.cluster,
    statement: input.statement,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  };
}

function toIdentityBindingView(binding: IdentityBindingRecord): IdentityBindingView {
  return {
    chain: binding.chain,
    nodeId: binding.nodeId,
    walletAddress: binding.walletAddress,
    cluster: binding.cluster,
    challengeId: binding.challengeId,
    anchorTxSignature: binding.anchorTxSignature,
    identityCommitment: binding.identityCommitment,
    boundAt: binding.boundAt,
    revokedAt: binding.revokedAt,
    updatedAt: binding.updatedAt
  };
}

function toContactMap(
  contacts: AgentContactRecord[]
): Map<string, AgentContactProfile> {
  return new Map(
    contacts.map((contact) => [contact.nodeId, toContactProfile(contact)])
  );
}

function toNetworkState(networkConfig: NetworkConfigRecord | null): NetworkState {
  if (!networkConfig) {
    return {
      configured: false,
      networkId: null,
      hasNetworkKey: false,
      keyFingerprint: null,
      createdAt: null,
      updatedAt: null
    };
  }

  return {
    configured: true,
    networkId: networkConfig.networkId,
    hasNetworkKey: networkConfig.networkKey.length > 0,
    keyFingerprint: hashFingerprint(networkConfig.networkKey),
    createdAt: networkConfig.createdAt,
    updatedAt: networkConfig.updatedAt
  };
}

function hashFingerprint(networkKey: string): string {
  return createHash("sha256").update(networkKey).digest("hex").slice(0, 12);
}

function normalizeJoinTokenExpiresInSeconds(input?: number): number {
  if (input === undefined) {
    return 7 * 24 * 60 * 60;
  }

  if (!Number.isFinite(input)) {
    throw new Error("joinTokenExpiresInSeconds must be finite");
  }

  const rounded = Math.floor(input);

  if (rounded < 60) {
    throw new Error("joinTokenExpiresInSeconds must be at least 60 seconds");
  }

  if (rounded > 30 * 24 * 60 * 60) {
    throw new Error("joinTokenExpiresInSeconds must be at most 30 days");
  }

  return rounded;
}

function normalizeJoinTokenMaxUsesInput(input?: number): number {
  if (input === undefined) {
    return 1;
  }

  return normalizeJoinTokenMaxUses(input);
}

function normalizeDiscoveryQueryText(rawQuery: string): string {
  const query = rawQuery.trim();

  if (!query) {
    throw new Error("query is required");
  }

  if (query.length > 200) {
    throw new Error("query exceeds max length 200");
  }

  return query;
}

function normalizeDiscoveryMaxHops(input?: number): number {
  if (input === undefined) {
    return 2;
  }

  if (!Number.isFinite(input)) {
    throw new Error("maxHops must be finite");
  }

  const rounded = Math.floor(input);

  if (rounded < 0) {
    throw new Error("maxHops must be at least 0");
  }

  if (rounded > 4) {
    throw new Error("maxHops must be at most 4");
  }

  return rounded;
}

function normalizeDiscoveryHop(hops: number, maxHops: number): number {
  if (!Number.isFinite(hops)) {
    throw new Error("hops must be finite");
  }

  const rounded = Math.floor(hops);

  if (rounded < 0) {
    throw new Error("hops must be at least 0");
  }

  if (rounded > maxHops) {
    throw new Error("hops must be less than or equal to maxHops");
  }

  return rounded;
}

function normalizeDiscoveryPeerFanout(input?: number): number {
  if (input === undefined) {
    return 3;
  }

  if (!Number.isFinite(input)) {
    throw new Error("maxPeerFanout must be finite");
  }

  const rounded = Math.floor(input);

  if (rounded < 1) {
    throw new Error("maxPeerFanout must be at least 1");
  }

  if (rounded > 20) {
    throw new Error("maxPeerFanout must be at most 20");
  }

  return rounded;
}

function normalizeDiscoveryLimit(input?: number): number {
  if (input === undefined) {
    return 20;
  }

  if (!Number.isFinite(input)) {
    throw new Error("limit must be finite");
  }

  const rounded = Math.floor(input);

  if (rounded < 1) {
    throw new Error("limit must be at least 1");
  }

  if (rounded > 100) {
    throw new Error("limit must be at most 100");
  }

  return rounded;
}

function toDiscoveryQueryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[\s,;|/]+/).filter(Boolean))];
}

function scoreAgentDiscovery(
  agent: KnownAgent,
  queryTokens: string[],
  rawQuery: string
): {
  score: number;
  matchedOn: string[];
} {
  const queryLower = rawQuery.toLowerCase();
  const fields: Array<{ key: string; value: string; weight: number }> = [
    { key: "nodeId", value: agent.nodeId, weight: 5 },
    { key: "displayName", value: agent.displayName ?? "", weight: 4 },
    { key: "alias", value: agent.contact?.alias ?? "", weight: 4 },
    { key: "role", value: agent.contact?.role ?? "", weight: 3 },
    { key: "capabilities", value: agent.contact?.capabilities ?? "", weight: 3 },
    { key: "notes", value: agent.contact?.notes ?? "", weight: 1 }
  ];

  let score = 0;
  const matchedOn = new Set<string>();

  for (const field of fields) {
    const valueLower = field.value.toLowerCase();

    if (!valueLower) {
      continue;
    }

    if (valueLower === queryLower) {
      score += field.weight + 2;
      matchedOn.add(field.key);
      continue;
    }

    if (valueLower.includes(queryLower)) {
      score += field.weight;
      matchedOn.add(field.key);
    }
  }

  if (queryTokens.length > 0) {
    let tokenHits = 0;

    for (const token of queryTokens) {
      if (
        fields.some((field) => field.value.toLowerCase().includes(token))
      ) {
        tokenHits += 1;
      }
    }

    if (tokenHits === 0) {
      return { score: 0, matchedOn: [] };
    }

    score += tokenHits;
  }

  return {
    score,
    matchedOn: [...matchedOn].sort((left, right) => left.localeCompare(right))
  };
}

function mergeDiscoveryRecommendations(
  recommendations: DiscoveryRecommendation[],
  limit: number
): DiscoveryRecommendation[] {
  const bestByNodeId = new Map<string, DiscoveryRecommendation>();

  for (const recommendation of recommendations) {
    const existing = bestByNodeId.get(recommendation.nodeId);

    if (!existing) {
      bestByNodeId.set(recommendation.nodeId, recommendation);
      continue;
    }

    if (recommendation.score > existing.score) {
      bestByNodeId.set(recommendation.nodeId, recommendation);
      continue;
    }

    if (
      recommendation.score === existing.score &&
      recommendation.hops < existing.hops
    ) {
      bestByNodeId.set(recommendation.nodeId, recommendation);
    }
  }

  return [...bestByNodeId.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.hops !== right.hops) {
        return left.hops - right.hops;
      }

      return left.nodeId.localeCompare(right.nodeId);
    })
    .slice(0, limit);
}

function aggregateDirectory(entries: PeerDirectoryEntry[]): Array<{
  nodeId: string;
  publicKeyB64: string;
  displayName: string | null;
  peerUrls: string[];
  lastSeenAt: string;
}> {
  const grouped = new Map<
    string,
    {
      nodeId: string;
      publicKeyB64: string;
      displayName: string | null;
      peerUrls: string[];
      lastSeenAt: string;
    }
  >();

  for (const entry of entries) {
    const existing = grouped.get(entry.nodeId);

    if (!existing) {
      grouped.set(entry.nodeId, {
        nodeId: entry.nodeId,
        publicKeyB64: entry.publicKeyB64,
        displayName: entry.displayName,
        peerUrls: [entry.sourceUrl],
        lastSeenAt: entry.updatedAt
      });
      continue;
    }

    if (!existing.peerUrls.includes(entry.sourceUrl)) {
      existing.peerUrls.push(entry.sourceUrl);
    }

    if (entry.updatedAt > existing.lastSeenAt) {
      existing.lastSeenAt = entry.updatedAt;
      existing.publicKeyB64 = entry.publicKeyB64;
      existing.displayName = entry.displayName;
    } else if (!existing.displayName && entry.displayName) {
      existing.displayName = entry.displayName;
    }
  }

  return [...grouped.values()].sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId)
  );
}

function toMeshEvent(storedEvent: StoredMeshEvent): MeshEvent {
  if (storedEvent.kind === "message") {
    return {
      id: storedEvent.id,
      conversationId: storedEvent.conversationId,
      senderId: storedEvent.senderId,
      senderPubKey: storedEvent.senderPubKey,
      clientMsgId: storedEvent.clientMsgId,
      kind: "message",
      lamport: storedEvent.lamport,
      wallTime: storedEvent.wallTime,
      signature: storedEvent.signature,
      payload: {
        content: storedEvent.payload.content
      }
    };
  }

  return {
    id: storedEvent.id,
    conversationId: storedEvent.conversationId,
    senderId: storedEvent.senderId,
    senderPubKey: storedEvent.senderPubKey,
    clientMsgId: storedEvent.clientMsgId,
    kind: "receipt",
    lamport: storedEvent.lamport,
    wallTime: storedEvent.wallTime,
    signature: storedEvent.signature,
    payload: {
      targetEventId: storedEvent.payload.targetEventId,
      state: storedEvent.payload.state
    }
  };
}
