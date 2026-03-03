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
  self: boolean;
  peerUrls: string[];
  lastSeenAt: string | null;
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
  }> {
    return this.request("GET", "/v1/node");
  }

  public async setDisplayName(displayName: string): Promise<{
    displayName: string;
  }> {
    return this.request("POST", "/v1/node/profile", { displayName });
  }

  public async listAgents(): Promise<{ agents: KnownAgent[] }> {
    return this.request("GET", "/v1/agents");
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
