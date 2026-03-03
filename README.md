# lucy-agent-mesh

> 给每个 Agent 一个“本地大脑”，而不是把一切交给中心服务器。

`lucy-agent-mesh` 是一个 **去中心化、本地优先、TypeScript 原生** 的 Agent 通信骨架：
- 每个 Agent 都跑自己的本地节点（`node-daemon`）
- 每个节点都有自己的身份、存储、时钟、通讯录
- 节点之间直接同步，不依赖中心消息中枢
- 可以直接被 Codex / Claude Code 接入

如果你想做的是：**多 Agent 协作系统、AI 自动化网络、离线可恢复的 Agent 通信层**，这就是一个能跑、能改、能扩展的起点。

---

## 为什么开发者会喜欢它

- **去中心化而不复杂**：没有中心消息服务器，依然能做增量同步和有序回放
- **本地优先**：每个节点本地 SQLite，断网/重启后可恢复
- **工程可控**：TypeScript monorepo，边界清晰，便于重构和扩展
- **AI 友好**：内置 MCP（stdio）+ SDK，Codex/Claude 直接调用
- **防误发机制**：直发必须指定 `recipientNodeId`，并支持通讯录备注（alias/role/capabilities/notes）

---

## 关键能力（MVP）

- 本地身份：`nodeId + displayName`
- 消息签名：Ed25519
- 幂等保障：`(sender_id, client_msg_id)`
- 去中心化排序：Lamport + 确定性排序
- 增量同步：`frontier(sender_id -> lamport)`
- 实时通知：WebSocket
- 直发路由：按 `recipientNodeId` 定位
- 通讯录：本地维护 Agent 元信息，减少误发

> 不依赖 Docker。运行时使用 Node 内置 `node:sqlite`（Node.js 22+，建议 24+）。

---

## 快速开始（3 分钟起两个节点）

### 1) 安装

```bash
pnpm install
```

### 2) 启动两个去中心化节点

终端 A：

```bash
NODE_PORT=7010 NODE_NAME=agent-alpha PEER_URLS=http://127.0.0.1:7011 pnpm dev
```

终端 B：

```bash
NODE_PORT=7011 NODE_NAME=agent-beta PEER_URLS=http://127.0.0.1:7010 pnpm dev
```

默认数据目录：`.local/node-<port>/mesh.sqlite`

### 3) 发送与同步（无中心服务器）

在 7010 创建会话：

```bash
curl -s http://127.0.0.1:7010/v1/conversations \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq
```

在 7010 发消息：

```bash
curl -s http://127.0.0.1:7010/v1/messages \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room","content":"hello from 7010"}' | jq
```

在 7011 拉同步：

```bash
curl -s http://127.0.0.1:7011/v1/peers/sync \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq
```

在 7011 查看消息：

```bash
curl -s "http://127.0.0.1:7011/v1/conversations/demo-room/events?after=0&limit=50" | jq
```

### 4) 直发 + 通讯录（避免发错）

查看已知 agent，拿目标 `nodeId`：

```bash
curl -s http://127.0.0.1:7010/v1/agents | jq
```

给目标打通讯录标签：

```bash
curl -s http://127.0.0.1:7010/v1/contacts \
  -H "content-type: application/json" \
  -d '{"nodeId":"<target-node-id>","alias":"beta","role":"test-agent","capabilities":"sync,validation","notes":"负责测试与校验"}' | jq
```

按 `recipientNodeId` 发私信（自动派生 DM 会话 ID）：

```bash
curl -s http://127.0.0.1:7010/v1/messages/direct \
  -H "content-type: application/json" \
  -d '{"recipientNodeId":"<target-node-id>","content":"hi direct"}' | jq
```

> 若 `recipientNodeId` 未知，接口会返回 400，阻止盲发。

---

## Codex / Claude Code 集成

### MCP（stdio）

先确保本地节点已启动，再启动 MCP 进程：

```bash
NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp
```

当前 MCP 是 **stdio transport**（不是 HTTP server 形式）。

可用 MCP tools：
- `whoami`
- `set_display_name`
- `list_agents`
- `list_contacts`
- `upsert_contact`
- `create_conversation`
- `send_message`
- `send_direct_message`
- `send_ack`
- `list_events`
- `add_peer`
- `sync_from_peers`

### SDK

```ts
import { MeshNodeClient } from "@lucy/sdk";

const client = new MeshNodeClient({ baseUrl: "http://127.0.0.1:7010" });

await client.setDisplayName("agent-alpha");
await client.sendDirectMessage({
  recipientNodeId: "<target-node-id>",
  content: "hello"
});
```

---

## 架构一览

- `apps/node-daemon`：每个节点进程（HTTP + WS + P2P）
- `apps/mcp-server`：面向 AI 工具的 MCP 入口（stdio）
- `packages/core`：事件模型、签名、排序、校验
- `packages/storage-sqlite`：SQLite 持久化 + peer 目录 + 通讯录
- `packages/sdk`：调用节点 API 的 TypeScript 客户端

---

## API 概览

### 本地客户端 API

- `GET /healthz`
- `GET /v1/node`
- `POST /v1/node/profile`
- `GET /v1/agents`
- `GET /v1/contacts`
- `POST /v1/contacts`
- `POST /v1/conversations`
- `POST /v1/messages`
- `POST /v1/messages/direct`
- `POST /v1/messages/ack`
- `GET /v1/conversations/:id/events?after=0&limit=200`
- `GET /v1/conversations/:id/frontier`
- `GET /v1/peers`
- `POST /v1/peers/connect`
- `POST /v1/peers/sync`
- `WS /ws`

### 节点间 P2P API

- `GET /p2p/conversations`
- `GET /p2p/node-info`
- `POST /p2p/events`
- `POST /p2p/sync`

---

## 环境变量

`apps/node-daemon`:
- `NODE_HOST`（默认 `127.0.0.1`）
- `NODE_PORT`（默认 `7010`）
- `NODE_NAME`（可选，本地 agent 显示名）
- `DATA_DIR`（默认 `.local/node-<port>`）
- `PEER_URLS`（逗号分隔）
- `SYNC_INTERVAL_MS`（默认 `15000`）
- `MAX_BODY_BYTES`（默认 `524288`）

`apps/mcp-server`:
- `NODE_API_URL`（默认 `http://127.0.0.1:7010`）

---

## 设计取舍（当前阶段）

- 不用中心排序节点：用会话内 Lamport 时钟做可重放顺序
- 不用中心数据库：每节点本地存储，节点间增量同步
- 先保证可运行和可扩展：后续可加 NAT 穿透、发现服务、策略控制

---

## 想一起做大它？

欢迎提 PR / Issue，一起把它打磨成真正可用于生产的 Agent Mesh 基础设施：
- 更强的身份与信任模型
- 更丰富的路由策略
- 更好用的运维与可观测性
- 更完善的测试矩阵

如果你对“AI Agent 原生分布式通信”有兴趣，欢迎来一起造。
