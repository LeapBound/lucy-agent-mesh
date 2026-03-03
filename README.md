# lucy-agent-mesh

> 让每个 Agent 都有自己的“本地神经系统”，而不是依赖一个中心大脑。

`lucy-agent-mesh` 是一个 **去中心化、本地优先、TypeScript 原生** 的 Agent 通信骨架：
- 每个 Agent 跑自己的本地节点（`node-daemon`）
- 每个节点拥有独立身份、时钟、存储、通讯录
- 节点之间直接同步，不依赖中心消息服务器
- 通过网络密钥加入同一个 Mesh，像 EasyTier 一样先“入网”再通信
- 可被 Codex / Claude Code 直接接入（MCP + SDK）

如果你正在做：**多 Agent 协作系统、自动化工作流网络、可离线恢复的 Agent 通信层**，它是一个能快速启动、也能持续演进的工程底座。

---

## 为什么开发者会喜欢它

- **去中心化但可控**：没有中心消息中枢，仍可做确定性排序与增量同步
- **本地优先**：每个节点本地 SQLite，断网、重启后状态仍可恢复
- **安全入网**：共享 `networkKey` + `/p2p/*` 请求签名，未入网节点无法混入
- **AI 友好**：内置 MCP（stdio）+ TypeScript SDK，Codex/Claude 可直接调用
- **降低误发**：直发必须指定 `recipientNodeId`，并支持本地通讯录标签

---

## 关键能力（当前版本）

- 本地身份：`nodeId + displayName`
- 消息签名：Ed25519
- 幂等保障：`(sender_id, client_msg_id)`
- 去中心化排序：Lamport + 确定性排序
- 增量同步：`frontier(sender_id -> lamport)`
- 实时通知：WebSocket
- 直发路由：按 `recipientNodeId` 定位
- 本地通讯录：`alias/role/capabilities/notes`
- 密钥入网：`init -> join token -> join`
- P2P 鉴权：`/p2p/*` 请求体哈希 + HMAC 签名 + nonce 防重放

> 不依赖 Docker。运行时使用 Node 内置 `node:sqlite`（Node.js 22+，建议 24+）。

---

## 快速开始（3 分钟起两个节点）

### 1) 安装依赖

```bash
pnpm install
```

### 2) 启动两个本地节点

终端 A：

```bash
NODE_PORT=7010 NODE_NAME=agent-alpha pnpm dev
```

终端 B：

```bash
NODE_PORT=7011 NODE_NAME=agent-beta pnpm dev
```

默认数据目录：`.local/node-<port>/mesh.sqlite`

### 3) 在 A 初始化网络（生成网络密钥与入网 token）

```bash
curl -s http://127.0.0.1:7010/v1/network/init \
  -H "content-type: application/json" \
  -d '{}' | jq
```

你会得到：
- `network.networkId`
- `network.keyFingerprint`
- `joinToken`

### 4) 在 A 生成包含 bootstrap 地址的 join token

```bash
JOIN_TOKEN=$(curl -s http://127.0.0.1:7010/v1/network/token \
  -H "content-type: application/json" \
  -d '{"bootstrapPeers":["http://127.0.0.1:7010"]}' | jq -r '.joinToken')
```

### 5) 在 B 使用 token 入网

```bash
curl -s http://127.0.0.1:7011/v1/network/join \
  -H "content-type: application/json" \
  -d "{\"joinToken\":\"$JOIN_TOKEN\"}" | jq
```

### 6) 互加对方为 peer（建议双向）

```bash
curl -s http://127.0.0.1:7010/v1/peers/connect \
  -H "content-type: application/json" \
  -d '{"url":"http://127.0.0.1:7011"}' | jq

curl -s http://127.0.0.1:7011/v1/peers/connect \
  -H "content-type: application/json" \
  -d '{"url":"http://127.0.0.1:7010"}' | jq
```

### 7) 发送与同步（无中心服务器）

在 7010 创建会话并发消息：

```bash
curl -s http://127.0.0.1:7010/v1/conversations \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq

curl -s http://127.0.0.1:7010/v1/messages \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room","content":"hello from 7010"}' | jq
```

在 7011 拉同步并查看：

```bash
curl -s http://127.0.0.1:7011/v1/peers/sync \
  -H "content-type: application/json" \
  -d '{"conversationId":"demo-room"}' | jq

curl -s "http://127.0.0.1:7011/v1/conversations/demo-room/events?after=0&limit=50" | jq
```

---

## 防误发：名字 + 通讯录 + nodeId

查看已知 agent，先确认目标 `nodeId`：

```bash
curl -s http://127.0.0.1:7010/v1/agents | jq
```

给目标补充通讯录信息：

```bash
curl -s http://127.0.0.1:7010/v1/contacts \
  -H "content-type: application/json" \
  -d '{"nodeId":"<target-node-id>","alias":"beta","role":"test-agent","capabilities":"sync,validation","notes":"负责测试与校验"}' | jq
```

按 `recipientNodeId` 直发（自动派生 DM 会话 ID）：

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
- `get_network`
- `init_network`
- `create_join_token`
- `join_network`
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
await client.initNetwork();

const { joinToken } = await client.createJoinToken({
  bootstrapPeers: ["http://127.0.0.1:7010"]
});

// 在另一个节点
// await clientOnNodeB.joinNetwork(joinToken);
```

---

## 架构一览

- `apps/node-daemon`：每个节点进程（HTTP + WS + P2P）
- `apps/mcp-server`：面向 AI 工具的 MCP 入口（stdio）
- `packages/core`：事件模型、签名、排序、校验
- `packages/storage-sqlite`：SQLite 持久化 + peer 目录 + 通讯录 + network config
- `packages/sdk`：调用节点 API 的 TypeScript 客户端

---

## API 概览

### 本地客户端 API

- `GET /healthz`
- `GET /v1/node`
- `POST /v1/node/profile`
- `GET /v1/network`
- `POST /v1/network/init`
- `POST /v1/network/token`
- `POST /v1/network/join`
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

> 所有 `/p2p/*` 请求都要求带网络鉴权头（networkId + 签名 + nonce + 时间戳）。

---

## 环境变量

`apps/node-daemon`:
- `NODE_HOST`（默认 `127.0.0.1`）
- `NODE_PORT`（默认 `7010`）
- `NODE_NAME`（可选，本地 agent 显示名）
- `DATA_DIR`（默认 `.local/node-<port>`）
- `PEER_URLS`（逗号分隔）
- `NETWORK_ID`（可选：直接注入网络 ID）
- `NETWORK_KEY`（可选：直接注入网络密钥）
- `P2P_AUTH_SKEW_MS`（默认 `300000`）
- `SYNC_INTERVAL_MS`（默认 `15000`）
- `MAX_BODY_BYTES`（默认 `524288`）

`apps/mcp-server`:
- `NODE_API_URL`（默认 `http://127.0.0.1:7010`）

---

## 设计取舍（当前阶段）

- 不用中心排序节点：用会话内 Lamport 时钟做可重放顺序
- 不用中心数据库：每节点本地存储，节点间增量同步
- 入网门槛先做“共享密钥模型”：先保证实用，再逐步引入更强身份信任
- 优先本地开发体验：先把 AI 集成链路打通，再做更复杂的自治治理

---

## 想一起做大它？

欢迎提 PR / Issue，一起把它打磨成真正可用于生产的 Agent Mesh 基础设施：
- 更强的身份与信任模型（分层密钥、可撤销凭证）
- 更丰富的路由策略（广播域、能力路由、策略路由）
- 更好用的可观测性（拓扑视图、延迟与丢包指标）
- 更完善的测试矩阵（多节点混沌场景、重放与恢复）

如果你也相信“AI Agent 应该像互联网节点一样彼此连接”，欢迎一起造。
