import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";

import {
  canonicalizeUnsignedEvent,
  hashCanonicalPayload,
  toUnsignedEvent
} from "./event.js";
import type { MeshEvent, NodeIdentity, UnsignedMeshEvent } from "./types.js";

export function deriveNodeIdFromPublicKey(publicKeyB64: string): string {
  const rawKey = Buffer.from(publicKeyB64, "base64");
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateNodeIdentity(now = new Date()): NodeIdentity {
  const keyPair = generateKeyPairSync("ed25519");

  const publicKeyBuffer = keyPair.publicKey.export({
    format: "der",
    type: "spki"
  }) as Buffer;

  const privateKeyBuffer = keyPair.privateKey.export({
    format: "der",
    type: "pkcs8"
  }) as Buffer;

  const publicKeyB64 = publicKeyBuffer.toString("base64");
  const privateKeyB64 = privateKeyBuffer.toString("base64");

  return {
    nodeId: deriveNodeIdFromPublicKey(publicKeyB64),
    publicKeyB64,
    privateKeyB64,
    createdAt: now.toISOString()
  };
}

export function signCanonicalPayload(payload: string, privateKeyB64: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8"
  });

  return sign(null, Buffer.from(payload), privateKey).toString("base64");
}

export function verifyCanonicalPayload(
  payload: string,
  signatureB64: string,
  publicKeyB64: string
): boolean {
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeyB64, "base64"),
    format: "der",
    type: "spki"
  });

  return verify(
    null,
    Buffer.from(payload),
    publicKey,
    Buffer.from(signatureB64, "base64")
  );
}

export function createSignedEvent(
  unsignedEvent: UnsignedMeshEvent,
  privateKeyB64: string
): MeshEvent {
  const canonicalPayload = canonicalizeUnsignedEvent(unsignedEvent);
  const signature = signCanonicalPayload(canonicalPayload, privateKeyB64);

  return {
    ...unsignedEvent,
    id: hashCanonicalPayload(canonicalPayload),
    signature
  };
}

export function verifySignedEvent(event: MeshEvent): {
  ok: boolean;
  reason?: string;
} {
  if (event.senderId !== deriveNodeIdFromPublicKey(event.senderPubKey)) {
    return {
      ok: false,
      reason: "senderId does not match senderPubKey"
    };
  }

  const canonicalPayload = canonicalizeUnsignedEvent(toUnsignedEvent(event));
  const expectedId = hashCanonicalPayload(canonicalPayload);

  if (expectedId !== event.id) {
    return {
      ok: false,
      reason: "event hash mismatch"
    };
  }

  const validSignature = verifyCanonicalPayload(
    canonicalPayload,
    event.signature,
    event.senderPubKey
  );

  if (!validSignature) {
    return {
      ok: false,
      reason: "signature verification failed"
    };
  }

  return { ok: true };
}
