import { createHash } from "node:crypto";

import type { MeshEvent, UnsignedMeshEvent } from "./types.js";

export function canonicalizeUnsignedEvent(event: UnsignedMeshEvent): string {
  return JSON.stringify({
    conversationId: event.conversationId,
    senderId: event.senderId,
    senderPubKey: event.senderPubKey,
    clientMsgId: event.clientMsgId,
    kind: event.kind,
    lamport: event.lamport,
    wallTime: event.wallTime,
    payload: event.payload
  });
}

export function hashCanonicalPayload(canonicalPayload: string): string {
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

export function toUnsignedEvent(event: MeshEvent): UnsignedMeshEvent {
  if (event.kind === "message") {
    return {
      conversationId: event.conversationId,
      senderId: event.senderId,
      senderPubKey: event.senderPubKey,
      clientMsgId: event.clientMsgId,
      kind: "message",
      lamport: event.lamport,
      wallTime: event.wallTime,
      payload: {
        content: event.payload.content
      }
    };
  }

  return {
    conversationId: event.conversationId,
    senderId: event.senderId,
    senderPubKey: event.senderPubKey,
    clientMsgId: event.clientMsgId,
    kind: "receipt",
    lamport: event.lamport,
    wallTime: event.wallTime,
    payload: {
      targetEventId: event.payload.targetEventId,
      state: event.payload.state
    }
  };
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

export function isMeshEvent(input: unknown): input is MeshEvent {
  if (!isRecord(input)) {
    return false;
  }

  return (
    typeof input.id === "string" &&
    typeof input.conversationId === "string" &&
    typeof input.senderId === "string" &&
    typeof input.senderPubKey === "string" &&
    typeof input.clientMsgId === "string" &&
    typeof input.kind === "string" &&
    typeof input.lamport === "number" &&
    typeof input.wallTime === "string" &&
    typeof input.signature === "string" &&
    isRecord(input.payload)
  );
}
