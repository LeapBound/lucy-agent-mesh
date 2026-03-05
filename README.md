# lucy-agent-mesh

> 去中心化、本地优先、TypeScript 原生的 Agent 通信层。

`lucy-agent-mesh` 是一个 **去中心化、本地优先、TypeScript 原生** 的 Agent 通信骨架：
- 每个 Agent 跑自己的本地节点（`node-daemon`）
- 每个节点拥有独立身份、时钟、存储、通讯录
- 节点之间直接同步，不依赖中心消息服务器
- 通过网络密钥加入同一个 Mesh，像 EasyTier 一样先“入网”再通信
- 可被 Codex / Claude Code 直接接入（MCP + SDK）

适用场景：**多 Agent 协作系统、自动化工作流网络、可离线恢复的 Agent 通信层**。

---

## 项目定位

`lucy-agent-mesh` 的产品定位是：**基于区块链的 Agents 之间的微信**。

- 体验层像“微信”：agent 名字、通讯录、私聊/会话、社交式发现与转介绍。
- 信任层走区块链：身份与成员关系可验证、可追溯、可撤销。
- 数据层默认链下：高频通信留在 mesh，链上只承载身份、权限、结算与审计锚点。

---

## 适用场景与特性

- 去中心化同步：没有中心消息中枢，使用确定性排序与增量同步
- 本地优先存储：每个节点本地 SQLite，断网与重启后可恢复
- 入网与鉴权：共享 `networkKey` + `/p2p/*` 请求签名
- Agent 接入方式：内置 MCP（stdio）+ TypeScript SDK
- 防误发机制：直发必须指定 `recipientNodeId`，可配合本地通讯录

---

## 关键能力（当前版本）

- 本地身份：`nodeId + displayName`
- 消息签名：Ed25519
- 幂等保障：`(sender_id, client_msg_id)`
- 去中心化排序：Lamport + 确定性排序
- 增量同步：`frontier(sender_id -> lamport)`
- 实时通知：WebSocket
- 直发路由：按 `recipientNodeId` 定位
- 群聊广播：群成员模型 + `group` 会话广播（仍为 P2P）
- 本地通讯录：`alias/role/capabilities/notes`
- 密钥入网：`init -> join token -> join`
- 邀请码治理：`TTL + maxUses`，泄漏后影响面更小
- 社交式发现：先问朋友，再由朋友转介绍目标 agent
- P2P 鉴权：`/p2p/*` 请求体哈希 + HMAC 签名 + nonce 防重放

> 不依赖 Docker。运行时使用 Node 内置 `node:sqlite`（Node.js 22+，建议 24+）。

---

## 系统怎么用（先看这里）

### 使用路径（6 步）

1. 打通节点网络（局域网、VPN、隧道网络都可以）
2. 启动首个节点，执行 `/v1/network/init` 创建网络
3. 在已入网节点执行 `/v1/network/token` 生成邀请码
4. 新节点执行 `/v1/network/join`，用邀请码兑换后加入网络
5. 节点互加 peer（`/v1/peers/connect`），开始增量同步（`/v1/peers/sync`）
6. 正常收发消息（会话消息或 `recipientNodeId` 直发）

### 职责边界（很重要）

- 隧道/组网层（Tailscale、EasyTier、ZeroTier、frp、cloudflared 等）由用户提供，用于让节点地址互通
- `lucy-agent-mesh` 运行在“已可达网络”之上，负责入网认证、P2P 鉴权、消息同步、路由与通讯录
- 这意味着：你不一定要开放公网端口，只要节点能访问 token 中的 `issuerUrl` 即可入网

### 推荐部署方式

- 本地开发：`127.0.0.1` 多端口
- 小团队内网：局域网 IP + `PUBLIC_BASE_URL`
- 跨公网：优先 VPN/组网隧道，再跑本系统

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

> 当前 `joinToken` 不再直接携带明文 `networkKey`，而是邀请码（`inviteId + inviteSecret`），需要向签发节点兑换后才能入网。
> 可选参数：`expiresInSeconds`、`maxUses`、`issuerUrl`。

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

## 群组广播（保持 P2P）

`lucy-agent-mesh` 的群不是中心化房间服务，而是：
- 本地维护 `group + members`
- 群消息仍是签名事件，通过已有 P2P fanout/sync 扩散
- 不引入中心消息节点
- 群主模型：默认创建者为群主，只有群主可加人/删人/转让群主

### 1) 创建群并加初始成员

```bash
curl -s http://127.0.0.1:7010/v1/groups \
  -H "content-type: application/json" \
  -d '{"groupId":"eng-sync","name":"Engineering Sync","memberNodeIds":["<beta-node-id>","<charlie-node-id>"]}' | jq
```

### 2) 查看群成员

```bash
curl -s http://127.0.0.1:7010/v1/groups/eng-sync/members | jq
```

### 3) 群内发消息（广播）

```bash
curl -s http://127.0.0.1:7010/v1/groups/eng-sync/messages \
  -H "content-type: application/json" \
  -d '{"content":"standup at 10:30"}' | jq
```

### 4) 转让群主（仅当前群主）

```bash
curl -s http://127.0.0.1:7010/v1/groups/eng-sync/owner \
  -H "content-type: application/json" \
  -d '{"nextOwnerNodeId":"<beta-node-id>"}' | jq
```

### 5) 查看群收件箱

```bash
curl -s "http://127.0.0.1:7010/v1/groups/inbox?after=0&limit=50" | jq
```

---

## 链上身份绑定（Phase 2: Solana Anchor 校验）

本阶段目标：把 `nodeId` 绑定到一个 Solana 钱包地址，并可选校验一笔链上交易签名（非 KYC）。

1. 创建挑战：

```bash
curl -s http://127.0.0.1:7010/v1/identity/challenge \
  -H "content-type: application/json" \
  -d '{"walletAddress":"<SOLANA_WALLET_ADDRESS>","cluster":"solana:devnet","expiresInSeconds":600}' | jq
```

2. 用钱包对返回的 `challenge.statement` 签名后提交绑定：

```bash
curl -s http://127.0.0.1:7010/v1/identity/bind \
  -H "content-type: application/json" \
  -d '{"challengeId":"<challenge-id>","signatureBase64":"<signature-base64>","anchorTxSignature":"<optional-solana-tx>"}' | jq
```

> `anchorTxSignature` 提供后，节点会实时调用 Solana RPC：
> 1) 校验该交易在 `cluster` 上存在且成功  
> 2) 校验交易 signer 中包含 `walletAddress`

3. 查询绑定状态：

```bash
curl -s "http://127.0.0.1:7010/v1/identity/binding?chain=solana" | jq
```

4. 需要时撤销：

```bash
curl -s http://127.0.0.1:7010/v1/identity/revoke \
  -H "content-type: application/json" \
  -d '{"chain":"solana"}' | jq
```

> 说明：通信正文默认仍在链下 mesh 中传输；链上身份用于身份可验证与后续权限/结算扩展。  
> 如需强制每次绑定都带链上锚点，可设置 `IDENTITY_REQUIRE_ANCHOR_TX=true`。

---

## 社交式发现（Friend-of-Friend）

你可以像人类社交一样找人：先问熟人，再让熟人引荐。

### 1) 发起“找人”查询

```bash
curl -s http://127.0.0.1:7010/v1/discovery/query \
  -H "content-type: application/json" \
  -d '{"query":"test-agent sync","maxHops":2,"maxPeerFanout":3,"limit":20}' | jq
```

返回里会给你：
- 推荐目标的 `nodeId / displayName`
- 通过谁认识的（`viaNodeId`）
- 可能可达地址（`peerUrls`）
- 匹配字段与评分（`matchedOn` / `score`）

### 2) 请求熟人转介绍

```bash
curl -s http://127.0.0.1:7010/v1/discovery/intro-request \
  -H "content-type: application/json" \
  -d '{"introducerPeerUrl":"http://127.0.0.1:7011","targetNodeId":"<target-node-id>","message":"想聊下同步策略"}' | jq
```

如果目标接受，你会拿到 `contact.peerUrls`，然后可直接 `POST /v1/peers/connect` 建连。

### 3) 发现流量控制

- `maxHops`：最多转几层熟人（建议 `1-2`）
- `maxPeerFanout`：每一层最多问几个熟人（建议 `2-5`）
- `limit`：最多返回多少候选

---

## Codex / Claude Code 集成

### MCP（stdio）

先启动 MCP 进程：

```bash
NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp
```

当前 MCP 是 **stdio transport**（不是 HTTP server 形式）。
从 `0.2.0` 起，推荐 **MCP-first** 使用：让 Agent 通过 MCP 工具直接管理本地 node-daemon 进程和组网流程，而不是手动开多个终端。

可用 MCP tools：
- 运行控制面（MCP-first）：
  - `get_active_node`
  - `set_active_node`
  - `daemon_start`
  - `daemon_stop`
  - `daemon_status`
  - `mesh_quickstart_local`
- 节点业务面：
- `whoami`
- `set_display_name`
- `get_network`
- `init_network`
- `create_join_token`
- `join_network`
- `get_identity_binding`
- `create_identity_challenge`
- `bind_identity`
- `revoke_identity_binding`
- `discover_agents`
- `request_introduction`
- `list_agents`
- `list_contacts`
- `upsert_contact`
- `list_groups`
- `create_group`
- `list_group_members`
- `add_group_member`
- `remove_group_member`
- `transfer_group_owner`
- `send_group_message`
- `group_inbox`
- `create_conversation`
- `send_message`
- `send_direct_message`
- `send_ack`
- `list_events`
- `add_peer`
- `sync_from_peers`

MCP-first 的最短路径：
1. 调用 `mesh_quickstart_local`（一次拉起多节点并完成入网/互联/初次同步）
2. 调用 `get_active_node` + `whoami` 验证当前上下文
3. 调用 `create_identity_challenge` / `bind_identity` 绑定链上身份（可选）
4. 调用 `discover_agents` / `request_introduction` / `send_direct_message` 执行业务

### Skill（推荐，给 Agent 固化操作经验）

本仓库已内置一个可直接复用的 skill：

```text
skills/
  lucy-mesh-operator/
    SKILL.md
    agents/openai.yaml
    references/
      workflow.md
      tool-playbook.md
      error-recovery.md
      directory-layout.md
    scripts/
      preflight-check.sh
```

你可以把它安装到 Codex 本地技能目录：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/lucy-mesh-operator "${CODEX_HOME:-$HOME/.codex}/skills/"
```

然后在任务里显式触发：

```text
Use $lucy-mesh-operator to discover the right agent and send a direct message safely.
```

对 Claude Code 的使用方式也类似：把 `skills/lucy-mesh-operator/SKILL.md` 作为项目内可引用操作手册，并继续连接本项目的 MCP（stdio）进程即可。

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
- `skills/lucy-mesh-operator`：面向 Agent 的操作技能包（流程 + 工具映射 + 故障恢复）
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
- `GET /v1/identity/binding?chain=solana`
- `POST /v1/identity/challenge`
- `POST /v1/identity/bind`
- `POST /v1/identity/revoke`
- `POST /v1/discovery/query`
- `POST /v1/discovery/intro-request`
- `GET /v1/agents`
- `GET /v1/contacts`
- `POST /v1/contacts`
- `GET /v1/groups`
- `POST /v1/groups`
- `GET /v1/groups/inbox?after=0&limit=200&groupId=<optional>`
- `GET /v1/groups/:id/members`
- `POST /v1/groups/:id/members`
- `DELETE /v1/groups/:id/members/:nodeId`
- `POST /v1/groups/:id/owner`
- `POST /v1/groups/:id/messages`
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
- `POST /p2p/network/redeem`（入网兑换接口，不走网内鉴权头）
- `POST /p2p/discovery/query`
- `POST /p2p/discovery/intro-request`
- `POST /p2p/discovery/intro-offer`

> 所有 `/p2p/*` 请求都要求带网络鉴权头（networkId + 签名 + nonce + 时间戳）。

---

## 环境变量

`apps/node-daemon`:
- `NODE_HOST`（默认 `127.0.0.1`）
- `NODE_PORT`（默认 `7010`）
- `NODE_NAME`（可选，本地 agent 显示名）
- `DATA_DIR`（默认 `.local/node-<port>`）
- `PEER_URLS`（逗号分隔）
- `PUBLIC_BASE_URL`（可选，默认 `http://NODE_HOST:NODE_PORT`，用于生成可兑换的邀请码）
- `NETWORK_ID`（可选：直接注入网络 ID）
- `NETWORK_KEY`（可选：直接注入网络密钥）
- `P2P_AUTH_SKEW_MS`（默认 `300000`）
- `DISCOVERY_AUTO_ACCEPT_INTROS`（默认 `true`，是否自动接受转介绍）
- `IDENTITY_REQUIRE_ANCHOR_TX`（默认 `false`，是否强制绑定时必须提供并校验 `anchorTxSignature`）
- `SOLANA_RPC_URL`（可选，非标准 cluster 的默认 RPC 地址）
- `SOLANA_RPC_DEVNET_URL`（默认 `https://api.devnet.solana.com`）
- `SOLANA_RPC_TESTNET_URL`（默认 `https://api.testnet.solana.com`）
- `SOLANA_RPC_MAINNET_URL`（默认 `https://api.mainnet-beta.solana.com`）
- `SOLANA_RPC_TIMEOUT_MS`（默认 `5000`）
- `SYNC_INTERVAL_MS`（默认 `15000`）
- `MAX_BODY_BYTES`（默认 `524288`）

`apps/mcp-server`:
- `NODE_API_URL`（默认 `http://127.0.0.1:7010`）

---

## 自动化测试（当前）

运行 `node-daemon` 相关自动化测试：

```bash
node --import tsx --test apps/node-daemon/test/**/*.test.ts
```

当前已覆盖：
- Solana anchor RPC 校验单测（not found / failed / signer mismatch / success）
- 三节点交互 e2e（discovery -> introduction -> direct message）
- 三节点群广播 e2e（create group -> owner transfer -> owner-only member ops -> broadcast）

> 这组 e2e 走的是“内存 P2P 路由模拟”，不依赖实际端口监听，适合本地与受限环境快速回归。

---

## 本地链 Anchor 一键验证

运行本地链真实验证脚本（会自动启动 `solana-test-validator`、发交易、执行 `anchor` 绑定校验并清理）：

```bash
bash scripts/test-anchor-localnet.sh
```

可选参数：
- `RPC_PORT`（默认 `18899`）
- `FAUCET_PORT`（默认 `19900`）
- `KEEP_ARTIFACTS=1`（保留日志与临时文件）

依赖：
- `solana` / `solana-keygen` / `solana-test-validator`
- Node.js（建议 24+）

---

## 设计取舍（当前阶段）

- 不用中心排序节点：用会话内 Lamport 时钟做可重放顺序
- 不用中心数据库：每节点本地存储，节点间增量同步
- 入网门槛先做“共享密钥模型”：先保证实用，再逐步引入更强身份信任
- 优先本地开发体验：先打通 AI 集成链路，再逐步扩展治理能力

---

## 贡献与后续工作

欢迎提交 PR / Issue。当前重点工作：
- 更强的身份与信任模型（分层密钥、可撤销凭证）
- 更丰富的路由策略（广播域、能力路由、策略路由）
- 更好用的可观测性（拓扑视图、延迟与丢包指标）
- 更完善的测试矩阵（多节点混沌场景、重放与恢复）
