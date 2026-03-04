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
