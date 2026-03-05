import type { Frontier, MeshEvent, PeerSyncResponse, ReceiptState } from "@lucy/core";

export interface MeshNodeClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SendMessageRequest {
  conversationId: string;
  content: string;
  clientMsgId?: string;
}

export interface SendAckRequest {
  conversationId: string;
  messageId: string;
  state: ReceiptState;
  clientMsgId?: string;
}

export interface ListEventsResponse {
  conversationId: string;
  after: number;
  nextAfter: number;
  events: Array<MeshEvent & { localSeq: number }>;
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

export interface GroupSummary {
  groupId: string;
  conversationId: string;
  name: string;
  createdByNodeId: string;
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

export interface GroupInboxItem {
  localSeq: number;
  groupId: string;
  groupName: string;
  conversationId: string;
  event: MeshEvent;
}

export interface NetworkState {
  configured: boolean;
  networkId: string | null;
  hasNetworkKey: boolean;
  keyFingerprint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LegacyJoinTokenPayloadV1 {
  version: 1;
  networkId: string;
  networkKey: string;
  bootstrapPeers: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface JoinTokenPayloadV2 {
  version: 2;
  networkId: string;
  issuerNodeId: string;
  issuerUrl: string;
  inviteId: string;
  inviteSecret: string;
  bootstrapPeers: string[];
  maxUses: number;
  issuedAt: string;
  expiresAt: string;
}

export type JoinTokenPayload = LegacyJoinTokenPayloadV1 | JoinTokenPayloadV2;

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

export interface IdentityBinding {
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

export class MeshNodeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: MeshNodeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:7010").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async healthz(): Promise<{ ok: true }> {
    return this.request("GET", "/healthz");
  }

  public async whoAmI(): Promise<{
    nodeId: string;
    publicKeyB64: string;
    displayName: string | null;
    peers: Array<{ url: string; createdAt: string; lastSyncAt: string | null }>;
    network: NetworkState;
  }> {
    return this.request("GET", "/v1/node");
  }

  public async getNetwork(): Promise<{
    network: NetworkState;
  }> {
    return this.request("GET", "/v1/network");
  }

  public async initNetwork(input?: {
    networkId?: string;
    networkKey?: string;
    bootstrapPeers?: string[];
    joinTokenExpiresInSeconds?: number;
    joinTokenMaxUses?: number;
    joinTokenIssuerUrl?: string;
  }): Promise<{
    network: NetworkState;
    joinToken: string;
    joinTokenPayload: JoinTokenPayload;
  }> {
    return this.request("POST", "/v1/network/init", input ?? {});
  }

  public async createJoinToken(input?: {
    expiresInSeconds?: number;
    maxUses?: number;
    issuerUrl?: string;
    bootstrapPeers?: string[];
  }): Promise<{
    joinToken: string;
    joinTokenPayload: JoinTokenPayload;
  }> {
    return this.request("POST", "/v1/network/token", input ?? {});
  }

  public async joinNetwork(joinToken: string): Promise<{
    network: NetworkState;
    bootstrapPeers: string[];
  }> {
    return this.request("POST", "/v1/network/join", { joinToken });
  }

  public async getIdentityBinding(chain = "solana"): Promise<{
    binding: IdentityBinding | null;
  }> {
    const params = new URLSearchParams({
      chain
    });

    return this.request("GET", `/v1/identity/binding?${params.toString()}`);
  }

  public async createIdentityChallenge(input: {
    walletAddress: string;
    cluster?: string;
    expiresInSeconds?: number;
  }): Promise<{
    challenge: SolanaIdentityChallenge;
  }> {
    return this.request("POST", "/v1/identity/challenge", input);
  }

  public async bindIdentity(input: {
    challengeId: string;
    signatureBase64: string;
    anchorTxSignature?: string | null;
  }): Promise<{
    binding: IdentityBinding;
  }> {
    return this.request("POST", "/v1/identity/bind", input);
  }

  public async revokeIdentityBinding(chain = "solana"): Promise<{
    binding: IdentityBinding | null;
  }> {
    return this.request("POST", "/v1/identity/revoke", { chain });
  }

  public async discoverAgents(input: {
    query: string;
    maxHops?: number;
    maxPeerFanout?: number;
    limit?: number;
    includeSelf?: boolean;
  }): Promise<DiscoverySearchResult> {
    return this.request("POST", "/v1/discovery/query", input);
  }

  public async requestIntroduction(input: {
    introducerPeerUrl: string;
    targetNodeId: string;
    message?: string;
  }): Promise<IntroductionResult> {
    return this.request("POST", "/v1/discovery/intro-request", input);
  }

  public async setDisplayName(displayName: string): Promise<{
    displayName: string;
  }> {
    return this.request("POST", "/v1/node/profile", { displayName });
  }

  public async listAgents(): Promise<{ agents: KnownAgent[] }> {
    return this.request("GET", "/v1/agents");
  }

  public async listContacts(): Promise<{
    contacts: Array<{ nodeId: string; profile: AgentContactProfile }>;
  }> {
    return this.request("GET", "/v1/contacts");
  }

  public async upsertContact(input: {
    nodeId: string;
    alias?: string | null;
    role?: string | null;
    capabilities?: string | null;
    notes?: string | null;
  }): Promise<{ nodeId: string; profile: AgentContactProfile }> {
    return this.request("POST", "/v1/contacts", input);
  }

  public async listGroups(): Promise<{ groups: GroupSummary[] }> {
    return this.request("GET", "/v1/groups");
  }

  public async createGroup(input: {
    groupId?: string;
    name: string;
    memberNodeIds?: string[];
    clientMsgId?: string;
  }): Promise<{
    group: GroupSummary;
    members: GroupMember[];
    inserted: boolean;
    event: MeshEvent;
    routedPeerUrls: string[];
  }> {
    return this.request("POST", "/v1/groups", input);
  }

  public async listGroupMembers(groupId: string): Promise<{
    groupId: string;
    members: GroupMember[];
  }> {
    return this.request("GET", `/v1/groups/${encodeURIComponent(groupId)}/members`);
  }

  public async addGroupMember(input: {
    groupId: string;
    nodeId: string;
    clientMsgId?: string;
  }): Promise<{
    changed: boolean;
    group: GroupSummary;
    members: GroupMember[];
    routedPeerUrls: string[];
    event?: MeshEvent;
  }> {
    return this.request(
      "POST",
      `/v1/groups/${encodeURIComponent(input.groupId)}/members`,
      {
        nodeId: input.nodeId,
        clientMsgId: input.clientMsgId
      }
    );
  }

  public async removeGroupMember(input: {
    groupId: string;
    nodeId: string;
  }): Promise<{
    changed: boolean;
    group: GroupSummary;
    members: GroupMember[];
    routedPeerUrls: string[];
    event?: MeshEvent;
  }> {
    return this.request(
      "DELETE",
      `/v1/groups/${encodeURIComponent(input.groupId)}/members/${encodeURIComponent(input.nodeId)}`
    );
  }

  public async sendGroupMessage(input: {
    groupId: string;
    content: string;
    clientMsgId?: string;
  }): Promise<{
    inserted: boolean;
    event: MeshEvent;
    groupId: string;
    conversationId: string;
    routedPeerUrls: string[];
  }> {
    return this.request(
      "POST",
      `/v1/groups/${encodeURIComponent(input.groupId)}/messages`,
      {
        content: input.content,
        clientMsgId: input.clientMsgId
      }
    );
  }

  public async listGroupInbox(input?: {
    after?: number;
    limit?: number;
    groupId?: string;
  }): Promise<{
    after: number;
    nextAfter: number;
    items: GroupInboxItem[];
  }> {
    const params = new URLSearchParams();

    if (input?.after !== undefined) {
      params.set("after", String(input.after));
    }

    if (input?.limit !== undefined) {
      params.set("limit", String(input.limit));
    }

    if (input?.groupId) {
      params.set("groupId", input.groupId);
    }

    const suffix = params.toString();
    const path = suffix.length > 0 ? `/v1/groups/inbox?${suffix}` : "/v1/groups/inbox";
    return this.request("GET", path);
  }

  public async createConversation(conversationId?: string): Promise<{
    conversationId: string;
  }> {
    return this.request("POST", "/v1/conversations", {
      conversationId
    });
  }

  public async sendMessage(request: SendMessageRequest): Promise<{
    inserted: boolean;
    event: MeshEvent;
  }> {
    return this.request("POST", "/v1/messages", request);
  }

  public async sendDirectMessage(request: {
    recipientNodeId: string;
    content: string;
    clientMsgId?: string;
  }): Promise<{
    inserted: boolean;
    event: MeshEvent;
    conversationId: string;
    routedPeerUrls: string[];
  }> {
    return this.request("POST", "/v1/messages/direct", request);
  }

  public async sendAck(request: SendAckRequest): Promise<{
    inserted: boolean;
    event: MeshEvent;
  }> {
    return this.request("POST", "/v1/messages/ack", request);
  }

  public async listEvents(
    conversationId: string,
    after = 0,
    limit = 200
  ): Promise<ListEventsResponse> {
    const params = new URLSearchParams({
      after: String(after),
      limit: String(limit)
    });

    return this.request(
      "GET",
      `/v1/conversations/${encodeURIComponent(conversationId)}/events?${params.toString()}`
    );
  }

  public async listPeers(): Promise<{
    peers: Array<{ url: string; createdAt: string; lastSyncAt: string | null }>;
  }> {
    return this.request("GET", "/v1/peers");
  }

  public async addPeer(url: string): Promise<{
    url: string;
    discovered?: {
      nodeId: string;
      publicKeyB64: string;
      displayName: string | null;
    };
  }> {
    return this.request("POST", "/v1/peers/connect", { url });
  }

  public async syncFromPeers(conversationId?: string): Promise<{
    pulledEvents: number;
    conversations: string[];
  }> {
    return this.request("POST", "/v1/peers/sync", { conversationId });
  }

  public async getFrontier(conversationId: string): Promise<{
    conversationId: string;
    frontier: Frontier;
  }> {
    return this.request(
      "GET",
      `/v1/conversations/${encodeURIComponent(conversationId)}/frontier`
    );
  }

  public async peerSync(
    conversationId: string,
    frontier: Frontier,
    limit = 500
  ): Promise<PeerSyncResponse> {
    return this.request("POST", "/p2p/sync", {
      conversationId,
      frontier,
      limit
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const responseBody = (await response.json()) as unknown;

    if (!response.ok) {
      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof responseBody.error === "string"
          ? responseBody.error
          : `HTTP ${response.status}`;

      throw new Error(message);
    }

    return responseBody as T;
  }
}
