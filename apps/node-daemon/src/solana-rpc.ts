export interface SolanaRpcConfig {
  defaultRpcUrl?: string;
  devnetRpcUrl: string;
  testnetRpcUrl: string;
  mainnetRpcUrl: string;
  timeoutMs: number;
}

export interface VerifySolanaAnchorTransactionInput {
  cluster: string;
  walletAddress: string;
  anchorTxSignature: string;
  rpc: SolanaRpcConfig;
}

interface JsonRpcErrorPayload {
  code?: unknown;
  message?: unknown;
}

interface JsonRpcGetTransactionResponse {
  result?: unknown;
  error?: JsonRpcErrorPayload;
}

interface SolanaTransactionResult {
  meta?: {
    err?: unknown;
  } | null;
  transaction?: {
    signatures?: unknown;
    message?: {
      accountKeys?: unknown;
      header?: {
        numRequiredSignatures?: unknown;
      };
    } | null;
  } | null;
}

interface ParsedAccountKey {
  pubkey?: unknown;
  signer?: unknown;
}

export async function verifySolanaAnchorTransaction(
  input: VerifySolanaAnchorTransactionInput
): Promise<void> {
  const rpcUrl = resolveSolanaRpcUrl(input.cluster, input.rpc);
  const transaction = await fetchTransactionBySignature({
    rpcUrl,
    signature: input.anchorTxSignature,
    timeoutMs: input.rpc.timeoutMs
  });

  if (!transaction) {
    throw new Error(`anchor transaction not found on cluster ${input.cluster}`);
  }

  if (transaction.meta?.err) {
    throw new Error("anchor transaction is not successful on chain");
  }

  const signatures = readTransactionSignatures(transaction);

  if (signatures.length > 0 && !signatures.includes(input.anchorTxSignature)) {
    throw new Error("anchor transaction signature mismatch");
  }

  const signerPubkeys = extractSignerPubkeys(transaction);

  if (signerPubkeys.length === 0) {
    throw new Error("anchor transaction does not expose signer accounts");
  }

  if (!signerPubkeys.includes(input.walletAddress)) {
    throw new Error("anchor transaction signer does not match walletAddress");
  }
}

function resolveSolanaRpcUrl(cluster: string, config: SolanaRpcConfig): string {
  if (cluster === "solana:devnet") {
    return config.devnetRpcUrl;
  }

  if (cluster === "solana:testnet") {
    return config.testnetRpcUrl;
  }

  if (cluster === "solana:mainnet" || cluster === "solana:mainnet-beta") {
    return config.mainnetRpcUrl;
  }

  if (config.defaultRpcUrl) {
    return config.defaultRpcUrl;
  }

  throw new Error(
    `solana rpc endpoint is not configured for cluster ${cluster}; set SOLANA_RPC_URL`
  );
}

async function fetchTransactionBySignature(input: {
  rpcUrl: string;
  signature: string;
  timeoutMs: number;
}): Promise<SolanaTransactionResult | null> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [
      input.signature,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      }
    ]
  };

  const controller = new AbortController();
  const timeoutMs = normalizeRpcTimeoutMs(input.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(input.rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`solana rpc request timeout after ${timeoutMs}ms`);
      }

      const message =
        error instanceof Error ? error.message : "unknown fetch failure";
      throw new Error(`solana rpc request failed: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`solana rpc http status ${response.status}`);
    }

    let payload: unknown;

    try {
      payload = (await response.json()) as unknown;
    } catch {
      throw new Error("solana rpc returned non-json response");
    }

    const parsed = toJsonRpcResponse(payload);

    if (parsed.error) {
      const code = typeof parsed.error.code === "number" ? parsed.error.code : "unknown";
      const message =
        typeof parsed.error.message === "string"
          ? parsed.error.message
          : "unknown error";
      throw new Error(`solana rpc error (${code}): ${message}`);
    }

    if (parsed.result === undefined || parsed.result === null) {
      return null;
    }

    return toSolanaTransactionResult(parsed.result);
  } finally {
    clearTimeout(timeout);
  }
}

function toJsonRpcResponse(value: unknown): JsonRpcGetTransactionResponse {
  if (!value || typeof value !== "object") {
    throw new Error("solana rpc invalid response payload");
  }

  return value as JsonRpcGetTransactionResponse;
}

function toSolanaTransactionResult(value: unknown): SolanaTransactionResult {
  if (!value || typeof value !== "object") {
    throw new Error("solana rpc transaction payload is invalid");
  }

  return value as SolanaTransactionResult;
}

function readTransactionSignatures(transaction: SolanaTransactionResult): string[] {
  const signaturesRaw = transaction.transaction?.signatures;

  if (!Array.isArray(signaturesRaw)) {
    return [];
  }

  return signaturesRaw.filter((value): value is string => typeof value === "string");
}

function extractSignerPubkeys(transaction: SolanaTransactionResult): string[] {
  const accountKeysRaw = transaction.transaction?.message?.accountKeys;

  if (!Array.isArray(accountKeysRaw)) {
    return [];
  }

  if (accountKeysRaw.length === 0) {
    return [];
  }

  const first = accountKeysRaw[0];

  if (typeof first === "object" && first !== null) {
    return accountKeysRaw
      .map((value) => value as ParsedAccountKey)
      .filter((value) => value.signer === true && typeof value.pubkey === "string")
      .map((value) => value.pubkey as string);
  }

  const header = transaction.transaction?.message?.header;
  const requiredRaw = header?.numRequiredSignatures;
  const requiredSignatures =
    typeof requiredRaw === "number" && Number.isInteger(requiredRaw) && requiredRaw >= 1
      ? requiredRaw
      : 0;

  if (requiredSignatures <= 0) {
    return [];
  }

  return accountKeysRaw
    .slice(0, requiredSignatures)
    .filter((value): value is string => typeof value === "string");
}

function normalizeRpcTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 5000;
  }

  const normalized = Math.floor(value);

  if (normalized < 1000) {
    return 1000;
  }

  if (normalized > 30000) {
    return 30000;
  }

  return normalized;
}
