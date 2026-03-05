import path from "node:path";
import { URL } from "node:url";

export interface NodeConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  nodeName?: string;
  publicBaseUrl: string;
  networkId?: string;
  networkKey?: string;
  peers: string[];
  syncIntervalMs: number;
  p2pAuthSkewMs: number;
  autoAcceptIntroductions: boolean;
  identityRequireAnchorTx: boolean;
  solanaRpcUrl?: string;
  solanaRpcDevnetUrl: string;
  solanaRpcTestnetUrl: string;
  solanaRpcMainnetUrl: string;
  solanaRpcTimeoutMs: number;
  outboxFlushIntervalMs: number;
  outboxBatchSize: number;
  outboxMaxAttempts: number;
  outboxRetryBaseMs: number;
  outboxRetryMaxMs: number;
  maxBodyBytes: number;
}

function parseNumber(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePeers(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => value.replace(/\/+$/, ""));
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function loadNodeConfig(): NodeConfig {
  const host = process.env.NODE_HOST ?? "127.0.0.1";
  const port = parseNumber(process.env.NODE_PORT, 7010);
  const dataDir = path.resolve(
    process.env.DATA_DIR ?? path.join(".local", `node-${port}`)
  );

  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, "mesh.sqlite"),
    nodeName: process.env.NODE_NAME?.trim() || undefined,
    publicBaseUrl: normalizePublicBaseUrl(
      process.env.PUBLIC_BASE_URL,
      host,
      port
    ),
    networkId: process.env.NETWORK_ID?.trim() || undefined,
    networkKey: process.env.NETWORK_KEY?.trim() || undefined,
    peers: parsePeers(process.env.PEER_URLS),
    syncIntervalMs: parseNumber(process.env.SYNC_INTERVAL_MS, 15000),
    p2pAuthSkewMs: parseNumber(process.env.P2P_AUTH_SKEW_MS, 300000),
    autoAcceptIntroductions: parseBoolean(
      process.env.DISCOVERY_AUTO_ACCEPT_INTROS,
      true
    ),
    identityRequireAnchorTx: parseBoolean(
      process.env.IDENTITY_REQUIRE_ANCHOR_TX,
      false
    ),
    solanaRpcUrl: normalizeOptionalHttpUrl(process.env.SOLANA_RPC_URL),
    solanaRpcDevnetUrl: normalizeHttpUrlWithDefault(
      process.env.SOLANA_RPC_DEVNET_URL,
      "https://api.devnet.solana.com",
      "SOLANA_RPC_DEVNET_URL"
    ),
    solanaRpcTestnetUrl: normalizeHttpUrlWithDefault(
      process.env.SOLANA_RPC_TESTNET_URL,
      "https://api.testnet.solana.com",
      "SOLANA_RPC_TESTNET_URL"
    ),
    solanaRpcMainnetUrl: normalizeHttpUrlWithDefault(
      process.env.SOLANA_RPC_MAINNET_URL,
      "https://api.mainnet-beta.solana.com",
      "SOLANA_RPC_MAINNET_URL"
    ),
    solanaRpcTimeoutMs: parseNumber(process.env.SOLANA_RPC_TIMEOUT_MS, 5000),
    outboxFlushIntervalMs: parseNumber(process.env.OUTBOX_FLUSH_INTERVAL_MS, 3000),
    outboxBatchSize: parseNumber(process.env.OUTBOX_BATCH_SIZE, 100),
    outboxMaxAttempts: parseNumber(process.env.OUTBOX_MAX_ATTEMPTS, 8),
    outboxRetryBaseMs: parseNumber(process.env.OUTBOX_RETRY_BASE_MS, 1000),
    outboxRetryMaxMs: parseNumber(process.env.OUTBOX_RETRY_MAX_MS, 60000),
    maxBodyBytes: parseNumber(process.env.MAX_BODY_BYTES, 512 * 1024)
  };
}

function normalizePublicBaseUrl(
  value: string | undefined,
  host: string,
  port: number
): string {
  const raw = value?.trim() || `http://${host}:${port}`;

  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeHttpUrlWithDefault(
  value: string | undefined,
  fallback: string,
  envName: string
): string {
  return normalizeHttpUrl(value?.trim() || fallback, envName);
}

function normalizeOptionalHttpUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalizeHttpUrl(normalized, "SOLANA_RPC_URL");
}

function normalizeHttpUrl(value: string, envName: string): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${envName} must use http or https`);
  }

  return parsed.toString().replace(/\/+$/, "");
}
