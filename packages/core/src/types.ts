export type EventKind = "message" | "receipt";

export type ReceiptState = "delivered" | "read";

export interface ReceiptPayload {
  targetEventId: string;
  state: ReceiptState;
}

export interface MessagePayload {
  content: string;
}

export type MeshPayload = MessagePayload | ReceiptPayload;

interface UnsignedMeshEventBase {
  conversationId: string;
  senderId: string;
  senderPubKey: string;
  clientMsgId: string;
  lamport: number;
  wallTime: string;
}

export interface UnsignedMessageEvent extends UnsignedMeshEventBase {
  kind: "message";
  payload: MessagePayload;
}

export interface UnsignedReceiptEvent extends UnsignedMeshEventBase {
  kind: "receipt";
  payload: ReceiptPayload;
}

export type UnsignedMeshEvent = UnsignedMessageEvent | UnsignedReceiptEvent;

interface MeshEventBase extends UnsignedMeshEventBase {
  id: string;
  signature: string;
}

export interface MessageEvent extends MeshEventBase {
  kind: "message";
  payload: MessagePayload;
}

export interface ReceiptEvent extends MeshEventBase {
  kind: "receipt";
  payload: ReceiptPayload;
}

export type MeshEvent = MessageEvent | ReceiptEvent;

export interface NodeIdentity {
  nodeId: string;
  publicKeyB64: string;
  privateKeyB64: string;
  createdAt: string;
}

export type Frontier = Record<string, number>;

export interface PeerSyncRequest {
  conversationId: string;
  frontier: Frontier;
  limit?: number;
}

export interface PeerSyncResponse {
  conversationId: string;
  events: MeshEvent[];
}
