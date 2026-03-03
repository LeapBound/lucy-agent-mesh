# lucy-agent-mesh

去中心化（无中心权威节点）的本地 TypeScript Agent Mesh。

每个 Agent 跑一个本地 `node-daemon`：
- 本地持久化：SQLite
- 消息签名：Ed25519
- 幂等：`(sender_id, client_msg_id)`
- 增量同步：`frontier(sender_id -> lamport)`
- 实时通知：WebSocket

> 这个仓库是本地优先，不依赖 Docker。
> 运行时依赖 Node 内置 `node:sqlite`（Node.js 22+）。

## 前置环境

- Node.js 22+（建议 24+）
- pnpm 10+

## 目录结构

- `apps/node-daemon`：每个节点进程（HTTP + WebSocket + P2P）
- `apps/mcp-server`：MCP 工具服务（可被 Codex / Claude Code 调用）
- `packages/core`：事件模型、签名、排序、校验
- `packages/storage-sqlite`：SQLite 持久化实现
- `packages/sdk`：调用 `node-daemon` 的 TypeScript SDK

## 1. 安装

```bash
pnpm install
```

## 2. 启动两个去中心化节点

终端 A：

```bash
NODE_PORT=7010 PEER_URLS=http://127.0.0.1:7011 pnpm dev
```

终端 B：

```bash
NODE_PORT=7011 PEER_URLS=http://127.0.0.1:7010 pnpm dev
```

默认数据目录：`.local/node-<port>/mesh.sqlite`

## 3. 最小联调（无中心服务器）

1) 在 7010 创建会话：

```bash
curl -s http://127.0.0.1:7010/v1/conversations \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq
```

2) 在 7010 发送消息：

```bash
curl -s http://127.0.0.1:7010/v1/messages \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room","content":"hello from 7010"}' | jq
```

3) 在 7011 主动拉取同步：

```bash
curl -s http://127.0.0.1:7011/v1/peers/sync \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq
```

4) 在 7011 查看消息：

```bash
curl -s "http://127.0.0.1:7011/v1/conversations/demo-room/events?after=0&limit=50" | jq
```

## 4. HTTP API（本地客户端）

- `GET /healthz`
- `GET /v1/node`
- `POST /v1/conversations`
- `POST /v1/messages`
- `POST /v1/messages/ack`
- `GET /v1/conversations/:id/events?after=0&limit=200`
- `GET /v1/conversations/:id/frontier`
- `GET /v1/peers`
- `POST /v1/peers/connect`
- `POST /v1/peers/sync`
- `WS /ws`

## 5. P2P API（节点之间）

- `GET /p2p/conversations`
- `POST /p2p/events`
- `POST /p2p/sync`

## 6. Codex / Claude Code 集成

### 6.1 通过 MCP

先确保本地节点已启动，然后启动 MCP 服务：

```bash
NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp
```

MCP tools:
- `whoami`
- `create_conversation`
- `send_message`
- `send_ack`
- `list_events`
- `add_peer`
- `sync_from_peers`

### 6.2 通过 SDK

```ts
import { MeshNodeClient } from "@lucy/sdk";

const client = new MeshNodeClient({ baseUrl: "http://127.0.0.1:7010" });
await client.sendMessage({
  conversationId: "demo-room",
  content: "hello"
});
```

## 7. 环境变量

`apps/node-daemon`:
- `NODE_HOST`（默认 `127.0.0.1`）
- `NODE_PORT`（默认 `7010`）
- `DATA_DIR`（默认 `.local/node-<port>`）
- `PEER_URLS`（逗号分隔）
- `SYNC_INTERVAL_MS`（默认 `15000`）
- `MAX_BODY_BYTES`（默认 `524288`）

`apps/mcp-server`:
- `NODE_API_URL`（默认 `http://127.0.0.1:7010`）

## 8. 设计取舍（MVP）

- 不使用中心排序节点，改为每个会话的 Lamport 时钟 + 确定性排序。
- 不使用中心数据库，每个节点本地持久化，节点之间做 frontier 增量同步。
- 先做点对点同步和签名校验，后续可加入 NAT 穿透/中继发现（不承载消息权威）。
