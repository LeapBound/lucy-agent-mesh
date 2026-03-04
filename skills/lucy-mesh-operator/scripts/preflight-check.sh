#!/usr/bin/env bash
set -euo pipefail

NODE_API_URL="${NODE_API_URL:-http://127.0.0.1:7010}"
REQUIRE_NETWORK=0

for arg in "$@"; do
  case "$arg" in
    --require-network)
      REQUIRE_NETWORK=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--require-network]" >&2
      exit 2
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

echo "[preflight] node api: $NODE_API_URL"

if ! curl -fsS "$NODE_API_URL/healthz" >/dev/null; then
  echo "[preflight] failed: /healthz is unreachable" >&2
  exit 1
fi

echo "[preflight] healthz: ok"

NODE_JSON="$(curl -fsS "$NODE_API_URL/v1/node")"
NETWORK_JSON="$(curl -fsS "$NODE_API_URL/v1/network")"

if command -v jq >/dev/null 2>&1; then
  NODE_ID="$(printf '%s' "$NODE_JSON" | jq -r '.nodeId // "unknown"')"
  NODE_NAME="$(printf '%s' "$NODE_JSON" | jq -r '.displayName // "(unset)"')"
  PEER_COUNT="$(printf '%s' "$NODE_JSON" | jq -r '(.peers // []) | length')"
  NETWORK_CONFIGURED="$(printf '%s' "$NETWORK_JSON" | jq -r '.network.configured // false')"
  NETWORK_ID="$(printf '%s' "$NETWORK_JSON" | jq -r '.network.networkId // "(none)"')"
else
  NODE_ID="unknown"
  NODE_NAME="(jq missing)"
  PEER_COUNT="unknown"
  NETWORK_CONFIGURED="unknown"
  NETWORK_ID="unknown"
fi

echo "[preflight] nodeId: $NODE_ID"
echo "[preflight] displayName: $NODE_NAME"
echo "[preflight] peers: $PEER_COUNT"
echo "[preflight] network configured: $NETWORK_CONFIGURED"
echo "[preflight] networkId: $NETWORK_ID"

if [[ "$REQUIRE_NETWORK" -eq 1 ]]; then
  if [[ "$NETWORK_CONFIGURED" != "true" ]]; then
    echo "[preflight] failed: network is not configured (use /v1/network/init or /v1/network/join)" >&2
    exit 1
  fi
fi

echo "[preflight] done"
