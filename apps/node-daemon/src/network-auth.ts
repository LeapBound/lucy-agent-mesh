import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";

export const P2P_HEADERS = {
  networkId: "x-lucy-network-id",
  senderNodeId: "x-lucy-sender-node-id",
  timestampMs: "x-lucy-ts-ms",
  nonce: "x-lucy-nonce",
  bodyHash: "x-lucy-body-sha256",
  signature: "x-lucy-signature"
} as const;

const SIGNATURE_ALGO_VERSION = "v1";
const JOIN_TOKEN_VERSION = 2;

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

export interface SignP2PRequestInput {
  method: string;
  path: string;
  bodyText: string;
  networkId: string;
  senderNodeId: string;
  networkKey: string;
  timestampMs?: number;
  nonce?: string;
}

export interface VerifyP2PRequestInput {
  method: string;
  path: string;
  bodyText: string;
  networkId: string;
  networkKey: string;
  headers: Record<string, string | undefined>;
  maxSkewMs: number;
  replayChecker: (key: string, ttlMs: number) => boolean;
}

export function generateNetworkId(): string {
  return `mesh-${randomBytes(6).toString("hex")}`;
}

export function generateNetworkKey(): string {
  return randomBytes(32).toString("base64url");
}

export function generateInviteId(): string {
  return randomBytes(12).toString("base64url");
}

export function generateInviteSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createJoinToken(input: {
  networkId: string;
  issuerNodeId: string;
  issuerUrl: string;
  inviteId: string;
  inviteSecret: string;
  bootstrapPeers: string[];
  expiresInSeconds: number;
  maxUses: number;
  now?: Date;
}): {
  token: string;
  payload: JoinTokenPayloadV2;
} {
  const now = input.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + input.expiresInSeconds * 1000
  ).toISOString();

  const payload: JoinTokenPayloadV2 = {
    version: JOIN_TOKEN_VERSION,
    networkId: normalizeNetworkId(input.networkId),
    issuerNodeId: normalizeSenderNodeId(input.issuerNodeId),
    issuerUrl: normalizeIssuerUrl(input.issuerUrl),
    inviteId: normalizeInviteId(input.inviteId),
    inviteSecret: normalizeInviteSecret(input.inviteSecret),
    bootstrapPeers: dedupePeers(input.bootstrapPeers),
    maxUses: normalizeJoinTokenMaxUses(input.maxUses),
    issuedAt,
    expiresAt
  };

  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return {
    token,
    payload
  };
}

export function parseJoinToken(token: string): JoinTokenPayload {
  const trimmed = token.trim();

  if (!trimmed) {
    throw new Error("joinToken is required");
  }

  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid joinToken format");
  }

  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid joinToken payload");
  }

  const record = payload as Record<string, unknown>;
  const version = Number(record.version);

  if (version === 1) {
    return parseLegacyJoinToken(record);
  }

  if (version === JOIN_TOKEN_VERSION) {
    return parseJoinTokenV2(record);
  }

  throw new Error("Unsupported joinToken version");
}

export function isJoinTokenV2(payload: JoinTokenPayload): payload is JoinTokenPayloadV2 {
  return payload.version === JOIN_TOKEN_VERSION;
}

export function assertJoinTokenNotExpired(
  payload: JoinTokenPayload,
  now = Date.now()
): void {
  const expiresMs = Date.parse(payload.expiresAt);

  if (now > expiresMs) {
    throw new Error("joinToken has expired");
  }
}

export function signP2PRequest(input: SignP2PRequestInput): Record<string, string> {
  const networkId = normalizeNetworkId(input.networkId);
  const networkKey = normalizeNetworkKey(input.networkKey);
  const senderNodeId = normalizeSenderNodeId(input.senderNodeId);
  const timestampMs = input.timestampMs ?? Date.now();
  const nonce = input.nonce ?? randomBytes(12).toString("base64url");
  const bodyHash = sha256Hex(input.bodyText);

  const payload = canonicalSignaturePayload({
    method: input.method,
    path: input.path,
    networkId,
    senderNodeId,
    timestampMs,
    nonce,
    bodyHash
  });

  const signature = createHmac(
    "sha256",
    deriveNetworkAuthKey(networkKey)
  )
    .update(payload)
    .digest("base64url");

  return {
    [P2P_HEADERS.networkId]: networkId,
    [P2P_HEADERS.senderNodeId]: senderNodeId,
    [P2P_HEADERS.timestampMs]: String(timestampMs),
    [P2P_HEADERS.nonce]: nonce,
    [P2P_HEADERS.bodyHash]: bodyHash,
    [P2P_HEADERS.signature]: `${SIGNATURE_ALGO_VERSION}.${signature}`
  };
}

export function verifyP2PRequest(input: VerifyP2PRequestInput): {
  ok: boolean;
  reason?: string;
  senderNodeId?: string;
} {
  const networkIdHeader = input.headers[P2P_HEADERS.networkId];

  if (!networkIdHeader) {
    return { ok: false, reason: "missing network header" };
  }

  if (networkIdHeader !== input.networkId) {
    return { ok: false, reason: "network id mismatch" };
  }

  const senderNodeId = input.headers[P2P_HEADERS.senderNodeId];
  const timestampText = input.headers[P2P_HEADERS.timestampMs];
  const nonce = input.headers[P2P_HEADERS.nonce];
  const bodyHashHeader = input.headers[P2P_HEADERS.bodyHash];
  const signatureHeader = input.headers[P2P_HEADERS.signature];

  if (!senderNodeId || !timestampText || !nonce || !bodyHashHeader || !signatureHeader) {
    return { ok: false, reason: "missing auth headers" };
  }

  if (!/^v1\.[A-Za-z0-9_-]+$/.test(signatureHeader)) {
    return { ok: false, reason: "invalid signature format" };
  }

  const timestampMs = Number(timestampText);

  if (!Number.isFinite(timestampMs)) {
    return { ok: false, reason: "invalid timestamp" };
  }

  const skewMs = Math.abs(Date.now() - timestampMs);

  if (skewMs > input.maxSkewMs) {
    return { ok: false, reason: "request timestamp outside allowed skew" };
  }

  const computedBodyHash = sha256Hex(input.bodyText);

  if (computedBodyHash !== bodyHashHeader) {
    return { ok: false, reason: "body hash mismatch" };
  }

  const replayKey = `${senderNodeId}:${nonce}`;

  if (!input.replayChecker(replayKey, input.maxSkewMs * 2)) {
    return { ok: false, reason: "replayed nonce" };
  }

  const payload = canonicalSignaturePayload({
    method: input.method,
    path: input.path,
    networkId: input.networkId,
    senderNodeId,
    timestampMs,
    nonce,
    bodyHash: bodyHashHeader
  });

  const expectedSignature = createHmac(
    "sha256",
    deriveNetworkAuthKey(input.networkKey)
  )
    .update(payload)
    .digest("base64url");

  const incomingSignature = signatureHeader.slice("v1.".length);

  if (!timingSafeCompareBase64Url(incomingSignature, expectedSignature)) {
    return { ok: false, reason: "signature mismatch" };
  }

  return {
    ok: true,
    senderNodeId
  };
}

export function normalizeNetworkId(networkId: string): string {
  const normalized = networkId.trim();

  if (!normalized) {
    throw new Error("networkId is required");
  }

  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(normalized)) {
    throw new Error(
      "networkId must be 3-80 chars and only contain letters, numbers, dot, underscore, or dash"
    );
  }

  return normalized;
}

export function normalizeNetworkKey(networkKey: string): string {
  const normalized = networkKey.trim();

  if (!normalized) {
    throw new Error("networkKey is required");
  }

  if (normalized.length < 16 || normalized.length > 256) {
    throw new Error("networkKey must be between 16 and 256 characters");
  }

  return normalized;
}

export function normalizeIssuerUrl(issuerUrl: string): string {
  const normalized = issuerUrl.trim();

  if (!normalized) {
    throw new Error("issuerUrl is required");
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("issuerUrl must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("issuerUrl must use http or https");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeJoinTokenMaxUses(maxUses: number): number {
  if (!Number.isFinite(maxUses)) {
    throw new Error("maxUses must be finite");
  }

  const rounded = Math.floor(maxUses);

  if (rounded < 1) {
    throw new Error("maxUses must be at least 1");
  }

  if (rounded > 1000) {
    throw new Error("maxUses must be at most 1000");
  }

  return rounded;
}

export function dedupePeers(peers: string[]): string[] {
  const normalized = peers
    .map((peer) => peer.trim().replace(/\/+$/, ""))
    .filter((peer) => peer.length > 0);

  return [...new Set(normalized)];
}

function parseLegacyJoinToken(record: Record<string, unknown>): LegacyJoinTokenPayloadV1 {
  if (typeof record.issuedAt !== "string" || Number.isNaN(Date.parse(record.issuedAt))) {
    throw new Error("joinToken missing valid issuedAt");
  }

  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) {
    throw new Error("joinToken missing valid expiresAt");
  }

  const bootstrapPeers = Array.isArray(record.bootstrapPeers)
    ? record.bootstrapPeers.filter((value): value is string => typeof value === "string")
    : [];

  return {
    version: 1,
    networkId: normalizeNetworkId(String(record.networkId ?? "")),
    networkKey: normalizeNetworkKey(String(record.networkKey ?? "")),
    bootstrapPeers: dedupePeers(bootstrapPeers),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt
  };
}

function parseJoinTokenV2(record: Record<string, unknown>): JoinTokenPayloadV2 {
  if (typeof record.issuedAt !== "string" || Number.isNaN(Date.parse(record.issuedAt))) {
    throw new Error("joinToken missing valid issuedAt");
  }

  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) {
    throw new Error("joinToken missing valid expiresAt");
  }

  const bootstrapPeers = Array.isArray(record.bootstrapPeers)
    ? record.bootstrapPeers.filter((value): value is string => typeof value === "string")
    : [];

  const maxUsesRaw = Number(record.maxUses ?? 1);

  return {
    version: JOIN_TOKEN_VERSION,
    networkId: normalizeNetworkId(String(record.networkId ?? "")),
    issuerNodeId: normalizeSenderNodeId(String(record.issuerNodeId ?? "")),
    issuerUrl: normalizeIssuerUrl(String(record.issuerUrl ?? "")),
    inviteId: normalizeInviteId(String(record.inviteId ?? "")),
    inviteSecret: normalizeInviteSecret(String(record.inviteSecret ?? "")),
    bootstrapPeers: dedupePeers(bootstrapPeers),
    maxUses: normalizeJoinTokenMaxUses(maxUsesRaw),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt
  };
}

function normalizeInviteId(inviteId: string): string {
  const normalized = inviteId.trim();

  if (!normalized) {
    throw new Error("inviteId is required");
  }

  if (!/^[A-Za-z0-9_-]{8,120}$/.test(normalized)) {
    throw new Error("inviteId must be 8-120 chars and use [A-Za-z0-9_-]");
  }

  return normalized;
}

function normalizeInviteSecret(inviteSecret: string): string {
  const normalized = inviteSecret.trim();

  if (!normalized) {
    throw new Error("inviteSecret is required");
  }

  if (normalized.length < 16 || normalized.length > 256) {
    throw new Error("inviteSecret must be between 16 and 256 characters");
  }

  return normalized;
}

function normalizeSenderNodeId(senderNodeId: string): string {
  const normalized = senderNodeId.trim();

  if (!normalized) {
    throw new Error("senderNodeId is required");
  }

  return normalized;
}

function deriveNetworkAuthKey(networkKey: string): Buffer {
  return createHash("sha256")
    .update(`lucy-network-auth:${networkKey}`)
    .digest();
}

function canonicalSignaturePayload(input: {
  method: string;
  path: string;
  networkId: string;
  senderNodeId: string;
  timestampMs: number;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    SIGNATURE_ALGO_VERSION,
    input.method.toUpperCase(),
    input.path,
    input.networkId,
    input.senderNodeId,
    String(input.timestampMs),
    input.nonce,
    input.bodyHash
  ].join("\n");
}

function timingSafeCompareBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
