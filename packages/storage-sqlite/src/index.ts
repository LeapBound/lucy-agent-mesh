import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  deriveNodeIdFromPublicKey,
  generateNodeIdentity,
  type Frontier,
  type MeshEvent,
  type NodeIdentity,
  type ReceiptPayload
} from "@lucy/core";

export type StoredMeshEvent = MeshEvent & {
  localSeq: number;
  createdAt: string;
};

export interface KnownPeer {
  url: string;
  createdAt: string;
  lastSyncAt: string | null;
}

interface EventRow {
  local_seq: number;
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_pub_key: string;
  client_msg_id: string;
  kind: string;
  content: string | null;
  receipt_target_id: string | null;
  receipt_state: string | null;
  lamport: number;
  wall_time: string;
  signature: string;
  created_at: string;
}

export class SQLiteMeshStore {
  private readonly db: DatabaseSync;

  public constructor(dbFilePath: string) {
    const absolutePath = path.resolve(dbFilePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    this.db = new DatabaseSync(absolutePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.initialize();
  }

  public close(): void {
    this.db.close();
  }

  public getOrCreateIdentity(): NodeIdentity {
    const row = this.db
      .prepare(
        `
        SELECT node_id, public_key_b64, private_key_b64, created_at
        FROM node_identity
        WHERE id = 1
        `
      )
      .get() as
      | {
          node_id: string;
          public_key_b64: string;
          private_key_b64: string;
          created_at: string;
        }
      | undefined;

    if (row) {
      return {
        nodeId: row.node_id,
        publicKeyB64: row.public_key_b64,
        privateKeyB64: row.private_key_b64,
        createdAt: row.created_at
      };
    }

    const identity = generateNodeIdentity();

    this.db
      .prepare(
        `
        INSERT INTO node_identity (id, node_id, public_key_b64, private_key_b64, created_at)
        VALUES (1, ?, ?, ?, ?)
        `
      )
      .run(
        identity.nodeId,
        identity.publicKeyB64,
        identity.privateKeyB64,
        identity.createdAt
      );

    return identity;
  }

  public createConversation(conversationId: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO conversations (id, created_at)
        VALUES (?, ?)
        ON CONFLICT(id) DO NOTHING
        `
      )
      .run(conversationId, now);
  }

  public listConversationIds(): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT id
        FROM conversations
        ORDER BY created_at ASC
        `
      )
      .all() as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  public nextLamport(conversationId: string): number {
    this.createConversation(conversationId);

    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE;");

    try {
      const row = this.db
        .prepare(
          `
          SELECT lamport
          FROM conversation_clock
          WHERE conversation_id = ?
          `
        )
        .get(conversationId) as { lamport: number } | undefined;

      const nextValue = (row?.lamport ?? 0) + 1;

      this.db
        .prepare(
          `
          INSERT INTO conversation_clock (conversation_id, lamport, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(conversation_id) DO UPDATE SET
            lamport = excluded.lamport,
            updated_at = excluded.updated_at
          `
        )
        .run(conversationId, nextValue, now);

      this.db.exec("COMMIT;");
      return nextValue;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  public observeLamport(conversationId: string, lamport: number): void {
    this.createConversation(conversationId);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO conversation_clock (conversation_id, lamport, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          lamport = CASE
            WHEN excluded.lamport > conversation_clock.lamport THEN excluded.lamport
            ELSE conversation_clock.lamport
          END,
          updated_at = CASE
            WHEN excluded.lamport > conversation_clock.lamport THEN excluded.updated_at
            ELSE conversation_clock.updated_at
          END
        `
      )
      .run(conversationId, lamport, now);
  }

  public insertEvent(event: MeshEvent): {
    inserted: boolean;
    localSeq?: number;
    existing?: StoredMeshEvent;
  } {
    this.createConversation(event.conversationId);
    this.observeLamport(event.conversationId, event.lamport);

    const now = new Date().toISOString();
    let content: string | null = null;
    let receiptTargetId: string | null = null;
    let receiptState: string | null = null;

    if (event.kind === "message") {
      content = event.payload.content;
    } else {
      receiptTargetId = event.payload.targetEventId;
      receiptState = event.payload.state;
    }

    const result = this.db
      .prepare(
        `
        INSERT INTO events (
          id,
          conversation_id,
          sender_id,
          sender_pub_key,
          client_msg_id,
          kind,
          content,
          receipt_target_id,
          receipt_state,
          lamport,
          wall_time,
          signature,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sender_id, client_msg_id) DO NOTHING
        `
      )
      .run(
        event.id,
        event.conversationId,
        event.senderId,
        event.senderPubKey,
        event.clientMsgId,
        event.kind,
        content,
        receiptTargetId,
        receiptState,
        event.lamport,
        event.wallTime,
        event.signature,
        now
      );

    if (result.changes > 0) {
      return {
        inserted: true,
        localSeq: Number(result.lastInsertRowid)
      };
    }

    const existingRow = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE sender_id = ?
          AND client_msg_id = ?
        LIMIT 1
        `
      )
      .get(event.senderId, event.clientMsgId) as EventRow | undefined;

    if (!existingRow) {
      return { inserted: false };
    }

    return {
      inserted: false,
      existing: this.toStoredEvent(existingRow)
    };
  }

  public insertEvents(events: MeshEvent[]): {
    inserted: StoredMeshEvent[];
    duplicates: number;
  } {
    const inserted: StoredMeshEvent[] = [];
    let duplicates = 0;

    this.db.exec("BEGIN IMMEDIATE;");

    try {
      for (const event of events) {
        const outcome = this.insertEvent(event);

        if (!outcome.inserted) {
          duplicates += 1;
          continue;
        }

        if (outcome.localSeq === undefined) {
          continue;
        }

        const row = this.db
          .prepare(
            `
            SELECT *
            FROM events
            WHERE local_seq = ?
            LIMIT 1
            `
          )
          .get(outcome.localSeq) as EventRow | undefined;

        if (row) {
          inserted.push(this.toStoredEvent(row));
        }
      }

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }

    return {
      inserted,
      duplicates
    };
  }

  public getEventById(eventId: string): StoredMeshEvent | undefined {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(eventId) as EventRow | undefined;

    if (!row) {
      return undefined;
    }

    return this.toStoredEvent(row);
  }

  public listEvents(
    conversationId: string,
    afterLocalSeq: number,
    limit: number
  ): StoredMeshEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE conversation_id = ?
          AND local_seq > ?
        ORDER BY local_seq ASC
        LIMIT ?
        `
      )
      .all(conversationId, afterLocalSeq, limit) as unknown as EventRow[];

    return rows.map((row) => this.toStoredEvent(row));
  }

  public listEventsForFrontier(
    conversationId: string,
    frontier: Frontier,
    limit: number
  ): StoredMeshEvent[] {
    const missing: StoredMeshEvent[] = [];
    let cursor = 0;
    const chunkSize = Math.max(limit, 200);

    while (missing.length < limit) {
      const rows = this.db
        .prepare(
          `
          SELECT *
          FROM events
          WHERE conversation_id = ?
            AND local_seq > ?
          ORDER BY local_seq ASC
          LIMIT ?
          `
        )
        .all(conversationId, cursor, chunkSize) as unknown as EventRow[];

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        cursor = row.local_seq;
        const senderFrontier = frontier[row.sender_id] ?? 0;

        if (row.lamport > senderFrontier) {
          missing.push(this.toStoredEvent(row));
        }

        if (missing.length >= limit) {
          break;
        }
      }
    }

    return missing;
  }

  public getFrontier(conversationId: string): Frontier {
    const rows = this.db
      .prepare(
        `
        SELECT sender_id, MAX(lamport) AS max_lamport
        FROM events
        WHERE conversation_id = ?
        GROUP BY sender_id
        `
      )
      .all(conversationId) as Array<{ sender_id: string; max_lamport: number }>;

    const frontier: Frontier = {};

    for (const row of rows) {
      frontier[row.sender_id] = row.max_lamport;
    }

    return frontier;
  }

  public upsertPeer(url: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO peers (url, created_at)
        VALUES (?, ?)
        ON CONFLICT(url) DO NOTHING
        `
      )
      .run(url, now);
  }

  public markPeerSynced(url: string): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        UPDATE peers
        SET last_sync_at = ?
        WHERE url = ?
        `
      )
      .run(now, url);
  }

  public listPeers(): KnownPeer[] {
    const rows = this.db
      .prepare(
        `
        SELECT url, created_at, last_sync_at
        FROM peers
        ORDER BY created_at ASC
        `
      )
      .all() as Array<{ url: string; created_at: string; last_sync_at: string | null }>;

    return rows.map((row) => ({
      url: row.url,
      createdAt: row.created_at,
      lastSyncAt: row.last_sync_at
    }));
  }

  public isKnownSender(senderId: string, senderPubKey: string): boolean {
    return deriveNodeIdFromPublicKey(senderPubKey) === senderId;
  }

  private toStoredEvent(row: EventRow): StoredMeshEvent {
    if (row.kind === "message") {
      return {
        localSeq: row.local_seq,
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderPubKey: row.sender_pub_key,
        clientMsgId: row.client_msg_id,
        kind: "message",
        lamport: row.lamport,
        wallTime: row.wall_time,
        signature: row.signature,
        createdAt: row.created_at,
        payload: {
          content: row.content ?? ""
        }
      };
    }

    const payload: ReceiptPayload = {
      targetEventId: row.receipt_target_id ?? "",
      state: (row.receipt_state ?? "delivered") as ReceiptPayload["state"]
    };

    return {
      localSeq: row.local_seq,
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderPubKey: row.sender_pub_key,
      clientMsgId: row.client_msg_id,
      kind: "receipt",
      lamport: row.lamport,
      wallTime: row.wall_time,
      signature: row.signature,
      createdAt: row.created_at,
      payload
    };
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        node_id TEXT NOT NULL,
        public_key_b64 TEXT NOT NULL,
        private_key_b64 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_clock (
        conversation_id TEXT PRIMARY KEY,
        lamport INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_pub_key TEXT NOT NULL,
        client_msg_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT,
        receipt_target_id TEXT,
        receipt_state TEXT,
        lamport INTEGER NOT NULL,
        wall_time TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_sender_client
        ON events(sender_id, client_msg_id);

      CREATE INDEX IF NOT EXISTS idx_events_conversation_seq
        ON events(conversation_id, local_seq);

      CREATE INDEX IF NOT EXISTS idx_events_conversation_order
        ON events(conversation_id, lamport, sender_id, id);

      CREATE TABLE IF NOT EXISTS peers (
        url TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_sync_at TEXT
      );
    `);
  }
}
