import { randomUUID } from "node:crypto";
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
  SQLiteMeshStore,
  type KnownPeer,
  type StoredMeshEvent
} from "@lucy/storage-sqlite";

import type { NodeConfig } from "./config.js";

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

const MAX_SYNC_BATCH = 1000;

export class MeshNode extends EventEmitter {
  private readonly store: SQLiteMeshStore;

  public readonly identity;

  public constructor(config: NodeConfig) {
    super();
    this.store = new SQLiteMeshStore(config.dbPath);
    this.identity = this.store.getOrCreateIdentity();

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
    peers: KnownPeer[];
  } {
    return {
      nodeId: this.identity.nodeId,
      publicKeyB64: this.identity.publicKeyB64,
      peers: this.store.listPeers()
    };
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

  public addPeer(rawUrl: string): string {
    const url = normalizePeerUrl(rawUrl);
    this.store.upsertPeer(url);
    return url;
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
        const remoteConversations = await this.fetchPeerConversations(peerUrl);
        for (const id of remoteConversations) {
          conversationIds.add(id);
        }
      }
    }

    let pulledEvents = 0;

    for (const peerUrl of peers) {
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

  private persistAndFanout(unsignedEvent: UnsignedMeshEvent): {
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
        this.emit("event", storedEvent);
      }

      void this.fanoutEvent(event);
    }

    return {
      inserted: outcome.inserted,
      event
    };
  }

  private async fanoutEvent(event: MeshEvent): Promise<void> {
    const peers = this.store.listPeers();

    await Promise.allSettled(
      peers.map((peer) =>
        this.postJson(`${peer.url}/p2p/events`, {
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

  private async postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
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

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json"
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
}

function normalizePeerUrl(rawUrl: string): string {
  const url = rawUrl.trim().replace(/\/+$/, "");

  if (!url) {
    throw new Error("peer url is required");
  }

  return url;
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
