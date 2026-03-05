#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_FILE="${MCP_SERVER_FILE:-$REPO_ROOT/apps/mcp-server/server.json}"

echo "[1/3] Running MCP release preflight check..."
node "$REPO_ROOT/scripts/check-mcp-release.mjs"

if [[ ! -f "$SERVER_FILE" ]]; then
  echo "server file not found: $SERVER_FILE" >&2
  exit 1
fi

if [[ -z "${MCPP_AUTH_TOKEN:-}" ]]; then
  echo "[2/3] MCPP_AUTH_TOKEN not set; mcp-publisher may prompt login."
else
  echo "[2/3] MCPP_AUTH_TOKEN detected."
fi

echo "[3/3] Publishing MCP metadata from $SERVER_FILE ..."
npx -y @modelcontextprotocol/mcp-publisher publish --server-file "$SERVER_FILE"
echo "Publish request sent."
