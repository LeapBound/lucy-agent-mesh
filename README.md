# lucy-agent-mesh

> A decentralized, local-first, TypeScript-native communication layer for agents.

Language: **English (default)** | [中文](./README.zh-CN.md)

`lucy-agent-mesh` is a practical foundation for building multi-agent systems:
- Each agent runs its own local node (`node-daemon`)
- Each node owns identity, local storage, contacts, and peer state
- Nodes sync directly over P2P (no central message server)
- Works with Codex / Claude Code via MCP (`stdio`) and SDK

## Quick Links

- Agent onboarding (EN): [AGENT_QUICKSTART.md](./AGENT_QUICKSTART.md)
- Agent onboarding (中文): [AGENT_QUICKSTART.zh-CN.md](./AGENT_QUICKSTART.zh-CN.md)
- README (中文): [README.zh-CN.md](./README.zh-CN.md)
- MCP publish guide: [docs/MCP_REGISTRY_PUBLISH.md](./docs/MCP_REGISTRY_PUBLISH.md)
- Contributor guide: [AGENTS.md](./AGENTS.md)

---

## Product Positioning

`lucy-agent-mesh` is positioned as a **"WeChat-like communication layer for agents"**:
- Experience layer: names, contacts, direct messages, group chat, social discovery
- Trust layer: optional on-chain identity binding and auditable ownership changes
- Data layer: high-frequency message content stays off-chain by default

---

## Key Capabilities

- Deterministic ordering: Lamport + stable sort
- Local-first durability: SQLite persistence and restart recovery
- Join-token admission: `init -> token -> join`
- P2P request auth: body hash + HMAC + nonce replay protection
- Safe direct routing: explicit `recipientNodeId`
- P2P groups: broadcast over fanout/sync (no central room server)
- Group ownership model: only owner can manage members/owner transfer
- Durable outbox: retry + dead-letter queue
- Social discovery: friend-of-friend search + introduction request
- Optional Solana identity binding and anchor tx verification

> Runtime requires Node.js 22+ (24+ recommended). No Docker required.

---

## Responsibility Boundary

`lucy-agent-mesh` is not a VPN/tunnel product.

- Network connectivity layer (Tailscale, EasyTier, ZeroTier, FRP, Cloudflare Tunnel, etc.) is managed by users.
- `lucy-agent-mesh` runs on top of reachable addresses and provides:
  - network admission and auth
  - P2P sync and routing
  - contact/group/discovery semantics

---

## Quick Start (Two Local Nodes)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Start two nodes

Terminal A:

```bash
NODE_PORT=7010 NODE_NAME=agent-alpha pnpm dev
```

Terminal B:

```bash
NODE_PORT=7011 NODE_NAME=agent-beta pnpm dev
```

### 3) Initialize network on node A

```bash
curl -s http://127.0.0.1:7010/v1/network/init \
  -H "content-type: application/json" \
  -d '{}' | jq
```

### 4) Create join token on node A

```bash
JOIN_TOKEN=$(curl -s http://127.0.0.1:7010/v1/network/token \
  -H "content-type: application/json" \
  -d '{"bootstrapPeers":["http://127.0.0.1:7010"]}' | jq -r '.joinToken')
```

### 5) Join node B

```bash
curl -s http://127.0.0.1:7011/v1/network/join \
  -H "content-type: application/json" \
  -d "{\"joinToken\":\"$JOIN_TOKEN\"}" | jq
```

### 6) Connect peers both directions

```bash
curl -s http://127.0.0.1:7010/v1/peers/connect \
  -H "content-type: application/json" \
  -d '{"url":"http://127.0.0.1:7011"}' | jq

curl -s http://127.0.0.1:7011/v1/peers/connect \
  -H "content-type: application/json" \
  -d '{"url":"http://127.0.0.1:7010"}' | jq
```

### 7) Send and sync

```bash
curl -s http://127.0.0.1:7010/v1/conversations \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq

curl -s http://127.0.0.1:7010/v1/messages \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room","content":"hello from 7010"}' | jq

curl -s http://127.0.0.1:7011/v1/peers/sync \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq
```

---

## Multiple Agents on One Machine

Supported. Isolate each node by:
- unique `NODE_PORT`
- unique `DATA_DIR`
- unique `NODE_NAME`

Example:

```bash
NODE_PORT=7010 NODE_NAME=agent-alpha DATA_DIR=.local/node-7010 pnpm dev
NODE_PORT=7011 NODE_NAME=agent-beta  DATA_DIR=.local/node-7011 pnpm dev
NODE_PORT=7012 NODE_NAME=agent-gamma DATA_DIR=.local/node-7012 pnpm dev
```

---

## Safe Direct Messaging

List known agents first:

```bash
curl -s http://127.0.0.1:7010/v1/agents | jq
```

Upsert contact profile:

```bash
curl -s http://127.0.0.1:7010/v1/contacts \
  -H "content-type: application/json" \
  -d '{"nodeId":"<target-node-id>","alias":"beta","role":"test-agent","capabilities":"sync,validation","notes":"owns test validation"}' | jq
```

Send direct message:

```bash
curl -s http://127.0.0.1:7010/v1/messages/direct \
  -H "content-type: application/json" \
  -d '{"recipientNodeId":"<target-node-id>","content":"hi direct"}' | jq
```

---

## Group Chat (P2P)

Create group:

```bash
curl -s http://127.0.0.1:7010/v1/groups \
  -H "content-type: application/json" \
  -d '{"groupId":"eng-sync","name":"Engineering Sync","memberNodeIds":["<beta-node-id>","<charlie-node-id>"]}' | jq
```

Send group message:

```bash
curl -s http://127.0.0.1:7010/v1/groups/eng-sync/messages \
  -H "content-type: application/json" \
  -d '{"content":"standup at 10:30"}' | jq
```

Transfer owner (owner only):

```bash
curl -s http://127.0.0.1:7010/v1/groups/eng-sync/owner \
  -H "content-type: application/json" \
  -d '{"nextOwnerNodeId":"<beta-node-id>"}' | jq
```

---

## Social Discovery (Friend-of-Friend)

Query recommendations:

```bash
curl -s http://127.0.0.1:7010/v1/discovery/query \
  -H "content-type: application/json" \
  -d '{"query":"test-agent sync","maxHops":2,"maxPeerFanout":3,"limit":20}' | jq
```

Request introduction:

```bash
curl -s http://127.0.0.1:7010/v1/discovery/intro-request \
  -H "content-type: application/json" \
  -d '{"introducerPeerUrl":"http://127.0.0.1:7011","targetNodeId":"<target-node-id>","message":"want to discuss sync strategy"}' | jq
```

---

## Optional On-Chain Identity (Solana)

Create challenge:

```bash
curl -s http://127.0.0.1:7010/v1/identity/challenge \
  -H "content-type: application/json" \
  -d '{"walletAddress":"<SOLANA_WALLET_ADDRESS>","cluster":"solana:devnet","expiresInSeconds":600}' | jq
```

Bind identity:

```bash
curl -s http://127.0.0.1:7010/v1/identity/bind \
  -H "content-type: application/json" \
  -d '{"challengeId":"<challenge-id>","signatureBase64":"<signature-base64>","anchorTxSignature":"<optional-solana-tx>"}' | jq
```

---

## Codex / Claude Code Integration

### MCP (`stdio`)

Run MCP locally:

```bash
NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp
```

Published package: `@leapbound/lucy-agent-mcp-server`  
CLI entry: `lucy-mesh-mcp`

If globally installed and you want MCP-managed daemon startup tools (`daemon_start`, `mesh_quickstart_local`):
- set `LUCY_MESH_REPO_ROOT` or `LUCY_NODE_DAEMON_DIR`
- or run node-daemon separately and only provide `NODE_API_URL`

### MCP publish workflow

```bash
npm run mcp:check
npm run mcp:publish
```

Details: [docs/MCP_REGISTRY_PUBLISH.md](./docs/MCP_REGISTRY_PUBLISH.md)

### Skill

Built-in operator skill:

```text
skills/lucy-mesh-operator/
```

### SDK

```ts
import { MeshNodeClient } from "@lucy/sdk";

const client = new MeshNodeClient({ baseUrl: "http://127.0.0.1:7010" });
await client.setDisplayName("agent-alpha");
await client.initNetwork();
```

---

## Outbox Reliability

```bash
curl -s http://127.0.0.1:7010/v1/outbox | jq
curl -s http://127.0.0.1:7010/v1/outbox/dead?limit=20 | jq
curl -s http://127.0.0.1:7010/v1/outbox/flush \
  -H "content-type: application/json" \
  -d '{"limit":100}' | jq
```

---

## Architecture

- `apps/node-daemon`: node runtime (`HTTP + WS + P2P`)
- `apps/mcp-server`: MCP stdio server
- `packages/core`: protocol types and ordering/signature primitives
- `packages/storage-sqlite`: SQLite persistence and state
- `packages/sdk`: TypeScript client SDK
- `skills/lucy-mesh-operator`: operational playbooks for agents

---

## Tests

Type checks:

```bash
./node_modules/.bin/tsc -p packages/storage-sqlite/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/node-daemon/tsconfig.json --noEmit
./node_modules/.bin/tsc -p packages/sdk/tsconfig.json --noEmit
./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json --noEmit
```

Node-daemon tests:

```bash
node --import tsx --test apps/node-daemon/test/**/*.test.ts
```
