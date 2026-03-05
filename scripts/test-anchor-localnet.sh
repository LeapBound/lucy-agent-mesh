#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.local/anchor-localnet-$(date +%s)-${RANDOM}"
LEDGER_DIR="$RUN_DIR/ledger"
VALIDATOR_STDOUT="$RUN_DIR/validator.stdout.log"
VALIDATOR_LOG="$LEDGER_DIR/validator.log"
WALLET_PATH="$RUN_DIR/wallet.json"
RECIPIENT_PATH="$RUN_DIR/recipient.json"
CHECK_SCRIPT="$RUN_DIR/anchor-bind-check.ts"

BIND_ADDRESS="${BIND_ADDRESS:-127.0.0.1}"
RPC_PORT="${RPC_PORT:-18899}"
FAUCET_PORT="${FAUCET_PORT:-19900}"
RPC_URL="${RPC_URL:-http://${BIND_ADDRESS}:${RPC_PORT}}"
KEEP_ARTIFACTS="${KEEP_ARTIFACTS:-0}"

SOLANA_DEFAULT_BIN_DIR="$HOME/.local/share/solana/install/active_release/bin"
if [[ -d "$SOLANA_DEFAULT_BIN_DIR" ]]; then
  export PATH="$SOLANA_DEFAULT_BIN_DIR:$PATH"
fi

for cmd in solana solana-keygen solana-test-validator node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] missing required command: $cmd" >&2
    exit 1
  fi
done

mkdir -p "$RUN_DIR"

VALIDATOR_PID=""
cleanup() {
  if [[ -n "$VALIDATOR_PID" ]] && kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    kill "$VALIDATOR_PID" >/dev/null 2>&1 || true
    wait "$VALIDATOR_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$KEEP_ARTIFACTS" == "1" ]]; then
    echo "[info] kept artifacts at: $RUN_DIR"
    return
  fi

  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost}"
export no_proxy="${no_proxy:-127.0.0.1,localhost}"

echo "[step] starting local solana-test-validator at $RPC_URL"
solana-test-validator \
  --ledger "$LEDGER_DIR" \
  --reset \
  --bind-address "$BIND_ADDRESS" \
  --rpc-port "$RPC_PORT" \
  --faucet-port "$FAUCET_PORT" \
  --quiet >"$VALIDATOR_STDOUT" 2>&1 &
VALIDATOR_PID="$!"

for _ in $(seq 1 60); do
  if solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$VALIDATOR_PID" >/dev/null 2>&1; then
    echo "[error] solana-test-validator exited early" >&2
    if [[ -f "$VALIDATOR_STDOUT" ]]; then
      tail -n 80 "$VALIDATOR_STDOUT" >&2 || true
    fi
    exit 1
  fi

  sleep 1
done

if ! solana cluster-version --url "$RPC_URL" >/dev/null 2>&1; then
  echo "[error] validator did not become ready in time" >&2
  if [[ -f "$VALIDATOR_STDOUT" ]]; then
    tail -n 80 "$VALIDATOR_STDOUT" >&2 || true
  fi
  if [[ -f "$VALIDATOR_LOG" ]]; then
    tail -n 80 "$VALIDATOR_LOG" >&2 || true
  fi
  exit 1
fi

echo "[step] generating temporary wallet and recipient"
solana-keygen new --no-bip39-passphrase --force --outfile "$WALLET_PATH" >/dev/null
solana-keygen new --no-bip39-passphrase --force --outfile "$RECIPIENT_PATH" >/dev/null
WALLET_ADDRESS="$(solana address -k "$WALLET_PATH")"
RECIPIENT_ADDRESS="$(solana address -k "$RECIPIENT_PATH")"

echo "[step] funding wallet on localnet"
solana airdrop 3 "$WALLET_ADDRESS" --url "$RPC_URL" --output json-compact >/dev/null

echo "[step] creating real anchor transaction"
TRANSFER_JSON="$(solana transfer "$RECIPIENT_ADDRESS" 0.1 \
  --allow-unfunded-recipient \
  --url "$RPC_URL" \
  --keypair "$WALLET_PATH" \
  --output json-compact)"
ANCHOR_TX_SIGNATURE="$(node -e "const data=JSON.parse(process.argv[1]); process.stdout.write(data.signature);" "$TRANSFER_JSON")"

cat >"$CHECK_SCRIPT" <<'TS'
import { createPrivateKey, sign } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

async function main(): Promise<void> {
  const repoRoot = process.env.REPO_ROOT;
  const walletPath = process.env.WALLET_PATH;
  const walletAddress = process.env.WALLET_ADDRESS;
  const anchorTxSignature = process.env.ANCHOR_TX_SIGNATURE;
  const rpcUrl = process.env.RPC_URL;

  if (!repoRoot || !walletPath || !walletAddress || !anchorTxSignature || !rpcUrl) {
    throw new Error("missing required environment variables");
  }

  const meshNodeModule = await import(`${repoRoot}/apps/node-daemon/src/mesh-node.ts`);
  const MeshNode = meshNodeModule.MeshNode as new (config: Record<string, unknown>) => {
    createSolanaIdentityChallenge: (input: {
      walletAddress: string;
      cluster: string;
      expiresInSeconds: number;
    }) => { challengeId: string; statement: string };
    bindSolanaIdentity: (input: {
      challengeId: string;
      signatureBase64: string;
      anchorTxSignature: string;
    }) => Promise<{
      nodeId: string;
      walletAddress: string;
      cluster: string;
      anchorTxSignature: string | null;
    }>;
    close: () => void;
  };

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const dataDir = path.resolve(repoRoot, ".local", `anchor-bind-verify-${runId}`);
  const config = {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    dbPath: path.join(dataDir, "mesh.sqlite"),
    nodeName: "anchor-bind-verify",
    publicBaseUrl: "http://anchor-bind-verify.local",
    networkId: undefined,
    networkKey: undefined,
    peers: [],
    syncIntervalMs: 15000,
    p2pAuthSkewMs: 300000,
    autoAcceptIntroductions: true,
    identityRequireAnchorTx: true,
    solanaRpcUrl: rpcUrl,
    solanaRpcDevnetUrl: "https://api.devnet.solana.com",
    solanaRpcTestnetUrl: "https://api.testnet.solana.com",
    solanaRpcMainnetUrl: "https://api.mainnet-beta.solana.com",
    solanaRpcTimeoutMs: 5000,
    maxBodyBytes: 512 * 1024
  };

  const node = new MeshNode(config as Record<string, unknown>);

  try {
    const challenge = node.createSolanaIdentityChallenge({
      walletAddress,
      cluster: "solana:localnet",
      expiresInSeconds: 600
    });
    const signatureBase64 = await signWithWallet(challenge.statement, walletPath);

    const binding = await node.bindSolanaIdentity({
      challengeId: challenge.challengeId,
      signatureBase64,
      anchorTxSignature
    });

    console.log(
      JSON.stringify({
        ok: true,
        nodeId: binding.nodeId,
        walletAddress: binding.walletAddress,
        cluster: binding.cluster,
        anchorTxSignature: binding.anchorTxSignature
      })
    );
  } finally {
    node.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function signWithWallet(statement: string, walletPath: string): Promise<string> {
  const keypairRaw = await fs.readFile(walletPath, "utf8");
  const keypair = JSON.parse(keypairRaw) as number[];

  if (!Array.isArray(keypair) || keypair.length < 32) {
    throw new Error("wallet keypair format is invalid");
  }

  const seed = Buffer.from(keypair.slice(0, 32));
  const privateKeyDer = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8"
  });

  return sign(null, Buffer.from(statement, "utf8"), privateKey).toString("base64");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
TS

echo "[step] verifying anchor binding path with identityRequireAnchorTx=true"
CHECK_OUTPUT="$(
  REPO_ROOT="$ROOT_DIR" \
  WALLET_PATH="$WALLET_PATH" \
  WALLET_ADDRESS="$WALLET_ADDRESS" \
  ANCHOR_TX_SIGNATURE="$ANCHOR_TX_SIGNATURE" \
  RPC_URL="$RPC_URL" \
  node --import tsx "$CHECK_SCRIPT"
)"

if ! echo "$CHECK_OUTPUT" | grep -q '"ok":true'; then
  echo "[error] anchor verification script did not return success payload" >&2
  echo "$CHECK_OUTPUT" >&2
  exit 1
fi

echo "[ok] localnet anchor bind verification passed"
echo "[info] walletAddress=$WALLET_ADDRESS"
echo "[info] anchorTxSignature=$ANCHOR_TX_SIGNATURE"
echo "[info] bindResult=$CHECK_OUTPUT"
