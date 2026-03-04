import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(
  [...BASE58_ALPHABET].map((char, index) => [char, index] as const)
);

const SOLANA_SPKI_PREFIX_DER = Buffer.from("302a300506032b6570032100", "hex");

export function normalizeSolanaWalletAddress(raw: string): string {
  const value = raw.trim();

  if (!value) {
    throw new Error("walletAddress is required");
  }

  const decoded = decodeBase58(value);

  if (decoded.length !== 32) {
    throw new Error("walletAddress must decode to a 32-byte Solana public key");
  }

  return value;
}

export function normalizeSolanaCluster(raw?: string): string {
  const value = raw?.trim();

  if (!value) {
    return "solana:devnet";
  }

  if (value.length > 64) {
    throw new Error("cluster exceeds max length 64");
  }

  return value;
}

export function normalizeIdentityChallengeTtl(raw?: number): number {
  if (raw === undefined) {
    return 10 * 60;
  }

  if (!Number.isFinite(raw)) {
    throw new Error("expiresInSeconds must be a finite number");
  }

  const value = Math.floor(raw);

  if (value < 60 || value > 3600) {
    throw new Error("expiresInSeconds must be between 60 and 3600");
  }

  return value;
}

export function normalizeAnchorTxSignature(raw?: string): string | null {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  const value = raw.trim();

  if (value.length < 32 || value.length > 128) {
    throw new Error("anchorTxSignature must be between 32 and 128 chars");
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    throw new Error("anchorTxSignature must be base58");
  }

  return value;
}

export function createSolanaIdentityStatement(input: {
  nodeId: string;
  walletAddress: string;
  cluster: string;
  challengeId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    "lucy-agent-mesh identity binding",
    "chain: solana",
    `nodeId: ${input.nodeId}`,
    `walletAddress: ${input.walletAddress}`,
    `cluster: ${input.cluster}`,
    `challengeId: ${input.challengeId}`,
    `nonce: ${input.nonce}`,
    `issuedAt: ${input.issuedAt}`,
    `expiresAt: ${input.expiresAt}`
  ].join("\n");
}

export function verifySolanaIdentitySignature(input: {
  walletAddress: string;
  statement: string;
  signatureBase64: string;
}): boolean {
  const signature = decodeBase64Signature(input.signatureBase64);
  const walletBytes = decodeBase58(input.walletAddress);

  if (walletBytes.length !== 32) {
    return false;
  }

  const publicKeyDer = Buffer.concat([SOLANA_SPKI_PREFIX_DER, walletBytes]);
  const keyObject = createPublicKey({
    key: publicKeyDer,
    format: "der",
    type: "spki"
  });

  return verifySignature(null, Buffer.from(input.statement, "utf8"), keyObject, signature);
}

export function computeIdentityCommitment(input: {
  nodeId: string;
  chain: string;
  walletAddress: string;
  cluster: string;
  challengeId: string;
  signatureBase64: string;
  boundAt: string;
}): string {
  const payload = [
    "lucy-agent-mesh:identity:v1",
    input.nodeId,
    input.chain,
    input.walletAddress,
    input.cluster,
    input.challengeId,
    input.signatureBase64,
    input.boundAt
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function decodeBase64Signature(raw: string): Buffer {
  const value = raw.trim();

  if (!value) {
    throw new Error("signatureBase64 is required");
  }

  const bytes = Buffer.from(value, "base64");

  if (bytes.length !== 64) {
    throw new Error("signatureBase64 must decode to 64 bytes");
  }

  return bytes;
}

function decodeBase58(input: string): Buffer {
  let value = 0n;

  for (const char of input) {
    const digit = BASE58_INDEX.get(char);

    if (digit === undefined) {
      throw new Error("base58 value contains invalid characters");
    }

    value = value * 58n + BigInt(digit);
  }

  const bytes: number[] = [];

  while (value > 0n) {
    bytes.push(Number(value % 256n));
    value /= 256n;
  }

  bytes.reverse();

  let leadingZeroes = 0;
  for (const char of input) {
    if (char === "1") {
      leadingZeroes += 1;
      continue;
    }

    break;
  }

  const result = Buffer.alloc(leadingZeroes + bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    result[leadingZeroes + index] = bytes[index];
  }

  return result;
}
