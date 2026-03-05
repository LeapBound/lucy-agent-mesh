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

export interface PeerDirectoryEntry {
  nodeId: string;
  sourceUrl: string;
  publicKeyB64: string;
  displayName: string | null;
  updatedAt: string;
}

export interface AgentContactRecord {
  nodeId: string;
  alias: string | null;
  role: string | null;
  capabilities: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface GroupRecord {
  groupId: string;
  conversationId: string;
  name: string;
  createdByNodeId: string;
  ownerNodeId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberRecord {
  groupId: string;
  nodeId: string;
  addedByNodeId: string;
  addedAt: string;
  updatedAt: string;
}

export interface GroupWithMemberCount extends GroupRecord {
  memberCount: number;
}

export interface NetworkConfigRecord {
  networkId: string;
  networkKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface NetworkInviteRecord {
  inviteId: string;
  inviteSecretHash: string;
  networkId: string;
  networkKeySnapshot: string;
  issuerNodeId: string;
  issuerUrl: string;
  bootstrapPeers: string[];
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumeNetworkInviteResult {
  ok: boolean;
  reason?: string;
  invite?: NetworkInviteRecord;
}

export interface IdentityChallengeRecord {
  challengeId: string;
  chain: string;
  nodeId: string;
  walletAddress: string;
  cluster: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumeIdentityChallengeResult {
  ok: boolean;
  reason?: string;
  challenge?: IdentityChallengeRecord;
}

export interface IdentityBindingRecord {
  chain: string;
  nodeId: string;
  walletAddress: string;
  cluster: string;
  challengeId: string;
  proofSignatureB64: string;
  anchorTxSignature: string | null;
  identityCommitment: string;
  boundAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

interface NetworkInviteRow {
  invite_id: string;
  invite_secret_hash: string;
  network_id: string;
  network_key_snapshot: string;
  issuer_node_id: string;
  issuer_url: string;
  bootstrap_peers_json: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  revoked: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface IdentityChallengeRow {
  challenge_id: string;
  chain: string;
  node_id: string;
  wallet_address: string;
  cluster: string;
  statement: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface IdentityBindingRow {
  chain: string;
  node_id: string;
  wallet_address: string;
  cluster: string;
  challenge_id: string;
  proof_signature_b64: string;
  anchor_tx_signature: string | null;
  identity_commitment: string;
  bound_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GroupRow {
  group_id: string;
  conversation_id: string;
  name: string;
  created_by_node_id: string;
  owner_node_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GroupMemberRow {
  group_id: string;
  node_id: string;
  added_by_node_id: string;
  added_at: string;
  updated_at: string;
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

  public getLocalDisplayName(): string | null {
    const row = this.db
      .prepare(
        `
        SELECT display_name
        FROM node_identity
        WHERE id = 1
        `
      )
      .get() as { display_name: string | null } | undefined;

    return row?.display_name ?? null;
  }

  public setLocalDisplayName(displayName: string | null): void {
    this.db
      .prepare(
        `
        UPDATE node_identity
        SET display_name = ?
        WHERE id = 1
        `
      )
      .run(displayName);
  }

  public getNetworkConfig(): NetworkConfigRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT network_id, network_key, created_at, updated_at
        FROM network_config
        WHERE id = 1
        LIMIT 1
        `
      )
      .get() as
      | {
          network_id: string;
          network_key: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      networkId: row.network_id,
      networkKey: row.network_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public setNetworkConfig(input: {
    networkId: string;
    networkKey: string;
  }): NetworkConfigRecord {
    const now = new Date().toISOString();
    const existing = this.getNetworkConfig();
    const createdAt = existing?.createdAt ?? now;

    this.db
      .prepare(
        `
        INSERT INTO network_config (id, network_id, network_key, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          network_id = excluded.network_id,
          network_key = excluded.network_key,
          updated_at = excluded.updated_at
        `
      )
      .run(input.networkId, input.networkKey, createdAt, now);

    return {
      networkId: input.networkId,
      networkKey: input.networkKey,
      createdAt,
      updatedAt: now
    };
  }

  public createNetworkInvite(input: {
    inviteId: string;
    inviteSecretHash: string;
    networkId: string;
    networkKeySnapshot: string;
    issuerNodeId: string;
    issuerUrl: string;
    bootstrapPeers: string[];
    expiresAt: string;
    maxUses: number;
  }): NetworkInviteRecord {
    const now = new Date().toISOString();
    const bootstrapPeersJson = JSON.stringify(input.bootstrapPeers);

    this.db
      .prepare(
        `
        INSERT INTO network_invites (
          invite_id,
          invite_secret_hash,
          network_id,
          network_key_snapshot,
          issuer_node_id,
          issuer_url,
          bootstrap_peers_json,
          expires_at,
          max_uses,
          used_count,
          revoked,
          last_used_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)
        `
      )
      .run(
        input.inviteId,
        input.inviteSecretHash,
        input.networkId,
        input.networkKeySnapshot,
        input.issuerNodeId,
        input.issuerUrl,
        bootstrapPeersJson,
        input.expiresAt,
        input.maxUses,
        now,
        now
      );

    const created = this.getNetworkInvite(input.inviteId);

    if (!created) {
      throw new Error("failed to persist network invite");
    }

    return created;
  }

  public getNetworkInvite(inviteId: string): NetworkInviteRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          invite_id,
          invite_secret_hash,
          network_id,
          network_key_snapshot,
          issuer_node_id,
          issuer_url,
          bootstrap_peers_json,
          expires_at,
          max_uses,
          used_count,
          revoked,
          last_used_at,
          created_at,
          updated_at
        FROM network_invites
        WHERE invite_id = ?
        LIMIT 1
        `
      )
      .get(inviteId) as NetworkInviteRow | undefined;

    if (!row) {
      return null;
    }

    return this.toNetworkInviteRecord(row);
  }

  public consumeNetworkInvite(input: {
    inviteId: string;
    inviteSecretHash: string;
    now?: Date;
  }): ConsumeNetworkInviteResult {
    const nowIso = (input.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE;");

    try {
      const row = this.db
        .prepare(
          `
          SELECT
            invite_id,
            invite_secret_hash,
            network_id,
            network_key_snapshot,
            issuer_node_id,
            issuer_url,
            bootstrap_peers_json,
            expires_at,
            max_uses,
            used_count,
            revoked,
            last_used_at,
            created_at,
            updated_at
          FROM network_invites
          WHERE invite_id = ?
          LIMIT 1
          `
        )
        .get(input.inviteId) as NetworkInviteRow | undefined;

      if (!row) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "joinToken invite not found"
        };
      }

      if (row.invite_secret_hash !== input.inviteSecretHash) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "joinToken invite secret mismatch"
        };
      }

      if (row.revoked === 1) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "joinToken invite revoked"
        };
      }

      const nowMs = Date.parse(nowIso);
      const expiresMs = Date.parse(row.expires_at);

      if (Number.isNaN(expiresMs) || nowMs > expiresMs) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "joinToken has expired"
        };
      }

      if (row.used_count >= row.max_uses) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "joinToken invite has reached max uses"
        };
      }

      this.db
        .prepare(
          `
          UPDATE network_invites
          SET
            used_count = used_count + 1,
            last_used_at = ?,
            updated_at = ?
          WHERE invite_id = ?
          `
        )
        .run(nowIso, nowIso, input.inviteId);

      const updatedRow = this.db
        .prepare(
          `
          SELECT
            invite_id,
            invite_secret_hash,
            network_id,
            network_key_snapshot,
            issuer_node_id,
            issuer_url,
            bootstrap_peers_json,
            expires_at,
            max_uses,
            used_count,
            revoked,
            last_used_at,
            created_at,
            updated_at
          FROM network_invites
          WHERE invite_id = ?
          LIMIT 1
          `
        )
        .get(input.inviteId) as NetworkInviteRow | undefined;

      this.db.exec("COMMIT;");

      if (!updatedRow) {
        return {
          ok: false,
          reason: "joinToken invite update failed"
        };
      }

      return {
        ok: true,
        invite: this.toNetworkInviteRecord(updatedRow)
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  public createIdentityChallenge(input: {
    challengeId: string;
    chain: string;
    nodeId: string;
    walletAddress: string;
    cluster: string;
    statement: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
  }): IdentityChallengeRecord {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO identity_challenges (
          challenge_id,
          chain,
          node_id,
          wallet_address,
          cluster,
          statement,
          nonce,
          issued_at,
          expires_at,
          used_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `
      )
      .run(
        input.challengeId,
        input.chain,
        input.nodeId,
        input.walletAddress,
        input.cluster,
        input.statement,
        input.nonce,
        input.issuedAt,
        input.expiresAt,
        now,
        now
      );

    const created = this.getIdentityChallenge(input.challengeId);

    if (!created) {
      throw new Error("failed to persist identity challenge");
    }

    return created;
  }

  public getIdentityChallenge(challengeId: string): IdentityChallengeRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          challenge_id,
          chain,
          node_id,
          wallet_address,
          cluster,
          statement,
          nonce,
          issued_at,
          expires_at,
          used_at,
          created_at,
          updated_at
        FROM identity_challenges
        WHERE challenge_id = ?
        LIMIT 1
        `
      )
      .get(challengeId) as IdentityChallengeRow | undefined;

    if (!row) {
      return null;
    }

    return this.toIdentityChallengeRecord(row);
  }

  public consumeIdentityChallenge(input: {
    challengeId: string;
    chain: string;
    walletAddress: string;
    now?: Date;
  }): ConsumeIdentityChallengeResult {
    const nowIso = (input.now ?? new Date()).toISOString();
    this.db.exec("BEGIN IMMEDIATE;");

    try {
      const row = this.db
        .prepare(
          `
          SELECT
            challenge_id,
            chain,
            node_id,
            wallet_address,
            cluster,
            statement,
            nonce,
            issued_at,
            expires_at,
            used_at,
            created_at,
            updated_at
          FROM identity_challenges
          WHERE challenge_id = ?
          LIMIT 1
          `
        )
        .get(input.challengeId) as IdentityChallengeRow | undefined;

      if (!row) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "identity challenge not found"
        };
      }

      if (row.chain !== input.chain) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "identity challenge chain mismatch"
        };
      }

      if (row.wallet_address !== input.walletAddress) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "identity challenge wallet mismatch"
        };
      }

      if (row.used_at) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "identity challenge already used"
        };
      }

      const nowMs = Date.parse(nowIso);
      const expiresMs = Date.parse(row.expires_at);

      if (Number.isNaN(expiresMs) || nowMs > expiresMs) {
        this.db.exec("COMMIT;");
        return {
          ok: false,
          reason: "identity challenge has expired"
        };
      }

      this.db
        .prepare(
          `
          UPDATE identity_challenges
          SET used_at = ?, updated_at = ?
          WHERE challenge_id = ?
          `
        )
        .run(nowIso, nowIso, input.challengeId);

      const updatedRow = this.db
        .prepare(
          `
          SELECT
            challenge_id,
            chain,
            node_id,
            wallet_address,
            cluster,
            statement,
            nonce,
            issued_at,
            expires_at,
            used_at,
            created_at,
            updated_at
          FROM identity_challenges
          WHERE challenge_id = ?
          LIMIT 1
          `
        )
        .get(input.challengeId) as IdentityChallengeRow | undefined;

      this.db.exec("COMMIT;");

      if (!updatedRow) {
        return {
          ok: false,
          reason: "identity challenge update failed"
        };
      }

      return {
        ok: true,
        challenge: this.toIdentityChallengeRecord(updatedRow)
      };
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  public upsertIdentityBinding(input: {
    chain: string;
    nodeId: string;
    walletAddress: string;
    cluster: string;
    challengeId: string;
    proofSignatureB64: string;
    anchorTxSignature: string | null;
    identityCommitment: string;
    boundAt?: string;
  }): IdentityBindingRecord {
    const now = new Date().toISOString();
    const boundAt = input.boundAt ?? now;
    const existing = this.getIdentityBinding(input.chain);
    const createdAt = existing?.createdAt ?? now;

    this.db
      .prepare(
        `
        INSERT INTO identity_bindings (
          chain,
          node_id,
          wallet_address,
          cluster,
          challenge_id,
          proof_signature_b64,
          anchor_tx_signature,
          identity_commitment,
          bound_at,
          revoked_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(chain) DO UPDATE SET
          node_id = excluded.node_id,
          wallet_address = excluded.wallet_address,
          cluster = excluded.cluster,
          challenge_id = excluded.challenge_id,
          proof_signature_b64 = excluded.proof_signature_b64,
          anchor_tx_signature = excluded.anchor_tx_signature,
          identity_commitment = excluded.identity_commitment,
          bound_at = excluded.bound_at,
          revoked_at = NULL,
          updated_at = excluded.updated_at
        `
      )
      .run(
        input.chain,
        input.nodeId,
        input.walletAddress,
        input.cluster,
        input.challengeId,
        input.proofSignatureB64,
        input.anchorTxSignature,
        input.identityCommitment,
        boundAt,
        createdAt,
        now
      );

    const updated = this.getIdentityBinding(input.chain);

    if (!updated) {
      throw new Error("failed to persist identity binding");
    }

    return updated;
  }

  public getIdentityBinding(chain: string): IdentityBindingRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          chain,
          node_id,
          wallet_address,
          cluster,
          challenge_id,
          proof_signature_b64,
          anchor_tx_signature,
          identity_commitment,
          bound_at,
          revoked_at,
          created_at,
          updated_at
        FROM identity_bindings
        WHERE chain = ?
        LIMIT 1
        `
      )
      .get(chain) as IdentityBindingRow | undefined;

    if (!row) {
      return null;
    }

    return this.toIdentityBindingRecord(row);
  }

  public revokeIdentityBinding(chain: string): IdentityBindingRecord | null {
    const existing = this.getIdentityBinding(chain);

    if (!existing || existing.revokedAt) {
      return existing;
    }

    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        UPDATE identity_bindings
        SET revoked_at = ?, updated_at = ?
        WHERE chain = ?
        `
      )
      .run(now, now, chain);

    return this.getIdentityBinding(chain);
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

  public upsertPeerDirectoryEntry(input: {
    nodeId: string;
    sourceUrl: string;
    publicKeyB64: string;
    displayName: string | null;
  }): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO peer_directory (
          node_id,
          source_url,
          public_key_b64,
          display_name,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id, source_url) DO UPDATE SET
          public_key_b64 = excluded.public_key_b64,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
        `
      )
      .run(
        input.nodeId,
        input.sourceUrl,
        input.publicKeyB64,
        input.displayName,
        now
      );
  }

  public listPeerDirectoryEntries(): PeerDirectoryEntry[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          node_id,
          source_url,
          public_key_b64,
          display_name,
          updated_at
        FROM peer_directory
        ORDER BY updated_at DESC
        `
      )
      .all() as Array<{
      node_id: string;
      source_url: string;
      public_key_b64: string;
      display_name: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      nodeId: row.node_id,
      sourceUrl: row.source_url,
      publicKeyB64: row.public_key_b64,
      displayName: row.display_name,
      updatedAt: row.updated_at
    }));
  }

  public findPeerUrlsByNodeId(nodeId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT source_url
        FROM peer_directory
        WHERE node_id = ?
        ORDER BY updated_at DESC
        `
      )
      .all(nodeId) as Array<{ source_url: string }>;

    const unique = new Set<string>();

    for (const row of rows) {
      unique.add(row.source_url);
    }

    return [...unique];
  }

  public upsertAgentContact(input: {
    nodeId: string;
    alias: string | null;
    role: string | null;
    capabilities: string | null;
    notes: string | null;
  }): void {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO agent_contacts (
          node_id,
          alias,
          role,
          capabilities,
          notes,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          alias = excluded.alias,
          role = excluded.role,
          capabilities = excluded.capabilities,
          notes = excluded.notes,
          updated_at = excluded.updated_at
        `
      )
      .run(
        input.nodeId,
        input.alias,
        input.role,
        input.capabilities,
        input.notes,
        now
      );
  }

  public listAgentContacts(): AgentContactRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          node_id,
          alias,
          role,
          capabilities,
          notes,
          updated_at
        FROM agent_contacts
        ORDER BY updated_at DESC
        `
      )
      .all() as Array<{
      node_id: string;
      alias: string | null;
      role: string | null;
      capabilities: string | null;
      notes: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      nodeId: row.node_id,
      alias: row.alias,
      role: row.role,
      capabilities: row.capabilities,
      notes: row.notes,
      updatedAt: row.updated_at
    }));
  }

  public getAgentContact(nodeId: string): AgentContactRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT
          node_id,
          alias,
          role,
          capabilities,
          notes,
          updated_at
        FROM agent_contacts
        WHERE node_id = ?
        LIMIT 1
        `
      )
      .get(nodeId) as
      | {
          node_id: string;
          alias: string | null;
          role: string | null;
          capabilities: string | null;
          notes: string | null;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      nodeId: row.node_id,
      alias: row.alias,
      role: row.role,
      capabilities: row.capabilities,
      notes: row.notes,
      updatedAt: row.updated_at
    };
  }

  public upsertGroup(input: {
    groupId: string;
    conversationId: string;
    name: string;
    createdByNodeId: string;
    ownerNodeId?: string;
    createdAt?: string;
    updatedAt?: string;
  }): GroupRecord {
    const now = input.updatedAt ?? new Date().toISOString();
    const existing = this.getGroup(input.groupId);
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;
    const ownerNodeId =
      input.ownerNodeId ?? existing?.ownerNodeId ?? input.createdByNodeId;

    this.db
      .prepare(
        `
        INSERT INTO groups (
          group_id,
          conversation_id,
          name,
          created_by_node_id,
          owner_node_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(group_id) DO UPDATE SET
          conversation_id = excluded.conversation_id,
          name = excluded.name,
          created_by_node_id = excluded.created_by_node_id,
          owner_node_id = excluded.owner_node_id,
          updated_at = excluded.updated_at
        `
      )
      .run(
        input.groupId,
        input.conversationId,
        input.name,
        input.createdByNodeId,
        ownerNodeId,
        createdAt,
        now
      );

    const updated = this.getGroup(input.groupId);

    if (!updated) {
      throw new Error("failed to persist group");
    }

    return updated;
  }

  public getGroup(groupId: string): GroupRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          group_id,
          conversation_id,
          name,
          created_by_node_id,
          owner_node_id,
          created_at,
          updated_at
        FROM groups
        WHERE group_id = ?
        LIMIT 1
        `
      )
      .get(groupId) as GroupRow | undefined;

    if (!row) {
      return null;
    }

    return this.toGroupRecord(row);
  }

  public listGroupsWithMemberCount(): GroupWithMemberCount[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          g.group_id,
          g.conversation_id,
          g.name,
          g.created_by_node_id,
          g.owner_node_id,
          g.created_at,
          g.updated_at,
          COUNT(gm.node_id) AS member_count
        FROM groups g
        LEFT JOIN group_members gm ON gm.group_id = g.group_id
        GROUP BY
          g.group_id,
          g.conversation_id,
          g.name,
          g.created_by_node_id,
          g.owner_node_id,
          g.created_at,
          g.updated_at
        ORDER BY g.created_at ASC
        `
      )
      .all() as unknown as Array<GroupRow & { member_count: number }>;

    return rows.map((row) => ({
      ...this.toGroupRecord(row),
      memberCount: row.member_count
    }));
  }

  public updateGroupOwner(input: {
    groupId: string;
    ownerNodeId: string;
    updatedAt?: string;
  }): GroupRecord {
    const now = input.updatedAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `
        UPDATE groups
        SET owner_node_id = ?, updated_at = ?
        WHERE group_id = ?
        `
      )
      .run(input.ownerNodeId, now, input.groupId);

    if (result.changes === 0) {
      throw new Error("group not found");
    }

    const updated = this.getGroup(input.groupId);

    if (!updated) {
      throw new Error("failed to persist group owner");
    }

    return updated;
  }

  public upsertGroupMember(input: {
    groupId: string;
    nodeId: string;
    addedByNodeId: string;
    addedAt?: string;
    updatedAt?: string;
  }): GroupMemberRecord {
    const now = input.updatedAt ?? new Date().toISOString();
    const addedAt = input.addedAt ?? now;

    this.db
      .prepare(
        `
        INSERT INTO group_members (
          group_id,
          node_id,
          added_by_node_id,
          added_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(group_id, node_id) DO UPDATE SET
          added_by_node_id = excluded.added_by_node_id,
          added_at = excluded.added_at,
          updated_at = excluded.updated_at
        `
      )
      .run(input.groupId, input.nodeId, input.addedByNodeId, addedAt, now);

    const updated = this.getGroupMember(input.groupId, input.nodeId);

    if (!updated) {
      throw new Error("failed to persist group member");
    }

    return updated;
  }

  public getGroupMember(
    groupId: string,
    nodeId: string
  ): GroupMemberRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          group_id,
          node_id,
          added_by_node_id,
          added_at,
          updated_at
        FROM group_members
        WHERE group_id = ?
          AND node_id = ?
        LIMIT 1
        `
      )
      .get(groupId, nodeId) as GroupMemberRow | undefined;

    if (!row) {
      return null;
    }

    return this.toGroupMemberRecord(row);
  }

  public removeGroupMember(groupId: string, nodeId: string): boolean {
    const result = this.db
      .prepare(
        `
        DELETE FROM group_members
        WHERE group_id = ?
          AND node_id = ?
        `
      )
      .run(groupId, nodeId);

    return result.changes > 0;
  }

  public listGroupMembers(groupId: string): GroupMemberRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          group_id,
          node_id,
          added_by_node_id,
          added_at,
          updated_at
        FROM group_members
        WHERE group_id = ?
        ORDER BY added_at ASC, node_id ASC
        `
      )
      .all(groupId) as unknown as GroupMemberRow[];

    return rows.map((row) => this.toGroupMemberRecord(row));
  }

  public listGroupIdsForMember(nodeId: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT group_id
        FROM group_members
        WHERE node_id = ?
        ORDER BY group_id ASC
        `
      )
      .all(nodeId) as Array<{ group_id: string }>;

    return rows.map((row) => row.group_id);
  }

  public listEventsByConversations(
    conversationIds: string[],
    afterLocalSeq: number,
    limit: number
  ): StoredMeshEvent[] {
    if (conversationIds.length === 0) {
      return [];
    }

    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM events
        WHERE conversation_id IN (${placeholders})
          AND local_seq > ?
        ORDER BY local_seq ASC
        LIMIT ?
        `
      )
      .all(...conversationIds, afterLocalSeq, limit) as unknown as EventRow[];

    return rows.map((row) => this.toStoredEvent(row));
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

  private toGroupRecord(row: GroupRow): GroupRecord {
    const ownerNodeId = row.owner_node_id ?? row.created_by_node_id;

    return {
      groupId: row.group_id,
      conversationId: row.conversation_id,
      name: row.name,
      createdByNodeId: row.created_by_node_id,
      ownerNodeId,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toGroupMemberRecord(row: GroupMemberRow): GroupMemberRecord {
    return {
      groupId: row.group_id,
      nodeId: row.node_id,
      addedByNodeId: row.added_by_node_id,
      addedAt: row.added_at,
      updatedAt: row.updated_at
    };
  }

  private toNetworkInviteRecord(row: NetworkInviteRow): NetworkInviteRecord {
    let bootstrapPeers: string[] = [];

    try {
      const parsed = JSON.parse(row.bootstrap_peers_json) as unknown;
      if (Array.isArray(parsed)) {
        bootstrapPeers = parsed.filter(
          (item): item is string => typeof item === "string"
        );
      }
    } catch {
      bootstrapPeers = [];
    }

    return {
      inviteId: row.invite_id,
      inviteSecretHash: row.invite_secret_hash,
      networkId: row.network_id,
      networkKeySnapshot: row.network_key_snapshot,
      issuerNodeId: row.issuer_node_id,
      issuerUrl: row.issuer_url,
      bootstrapPeers,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      usedCount: row.used_count,
      revoked: row.revoked === 1,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toIdentityChallengeRecord(row: IdentityChallengeRow): IdentityChallengeRecord {
    return {
      challengeId: row.challenge_id,
      chain: row.chain,
      nodeId: row.node_id,
      walletAddress: row.wallet_address,
      cluster: row.cluster,
      statement: row.statement,
      nonce: row.nonce,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toIdentityBindingRecord(row: IdentityBindingRow): IdentityBindingRecord {
    return {
      chain: row.chain,
      nodeId: row.node_id,
      walletAddress: row.wallet_address,
      cluster: row.cluster,
      challengeId: row.challenge_id,
      proofSignatureB64: row.proof_signature_b64,
      anchorTxSignature: row.anchor_tx_signature,
      identityCommitment: row.identity_commitment,
      boundAt: row.bound_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS node_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        node_id TEXT NOT NULL,
        public_key_b64 TEXT NOT NULL,
        private_key_b64 TEXT NOT NULL,
        display_name TEXT,
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

      CREATE TABLE IF NOT EXISTS peer_directory (
        node_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        public_key_b64 TEXT NOT NULL,
        display_name TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(node_id, source_url)
      );

      CREATE INDEX IF NOT EXISTS idx_peer_directory_node
        ON peer_directory(node_id);

      CREATE TABLE IF NOT EXISTS agent_contacts (
        node_id TEXT PRIMARY KEY,
        alias TEXT,
        role TEXT,
        capabilities TEXT,
        notes TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS groups (
        group_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_by_node_id TEXT NOT NULL,
        owner_node_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_groups_conversation
        ON groups(conversation_id);

      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        added_by_node_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(group_id, node_id),
        FOREIGN KEY(group_id) REFERENCES groups(group_id)
      );

      CREATE INDEX IF NOT EXISTS idx_group_members_node
        ON group_members(node_id);

      CREATE TABLE IF NOT EXISTS network_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        network_id TEXT NOT NULL,
        network_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS network_invites (
        invite_id TEXT PRIMARY KEY,
        invite_secret_hash TEXT NOT NULL,
        network_id TEXT NOT NULL,
        network_key_snapshot TEXT NOT NULL,
        issuer_node_id TEXT NOT NULL,
        issuer_url TEXT NOT NULL,
        bootstrap_peers_json TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        max_uses INTEGER NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_network_invites_network
        ON network_invites(network_id);

      CREATE INDEX IF NOT EXISTS idx_network_invites_expires
        ON network_invites(expires_at);

      CREATE TABLE IF NOT EXISTS identity_challenges (
        challenge_id TEXT PRIMARY KEY,
        chain TEXT NOT NULL,
        node_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        cluster TEXT NOT NULL,
        statement TEXT NOT NULL,
        nonce TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_identity_challenges_chain_wallet
        ON identity_challenges(chain, wallet_address);

      CREATE INDEX IF NOT EXISTS idx_identity_challenges_expires
        ON identity_challenges(expires_at);

      CREATE TABLE IF NOT EXISTS identity_bindings (
        chain TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        cluster TEXT NOT NULL,
        challenge_id TEXT NOT NULL,
        proof_signature_b64 TEXT NOT NULL,
        anchor_tx_signature TEXT,
        identity_commitment TEXT NOT NULL,
        bound_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.ensureOptionalColumns();
  }

  private ensureOptionalColumns(): void {
    try {
      this.db.exec("ALTER TABLE node_identity ADD COLUMN display_name TEXT;");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("duplicate column name")
      ) {
        throw error;
      }
    }

    try {
      this.db.exec("ALTER TABLE groups ADD COLUMN owner_node_id TEXT;");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("duplicate column name")
      ) {
        throw error;
      }
    }

    this.db.exec(`
      UPDATE groups
      SET owner_node_id = created_by_node_id
      WHERE owner_node_id IS NULL OR owner_node_id = '';
    `);
  }
}
