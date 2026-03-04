# AGENT.md

## 工作约定

- 每次代码改动完成后，都要在本文件追加一条变更记录。
- 记录应包含：日期、改动范围、主要内容、验证结果（如有）。

## 变更记录

### 2026-03-03

- 改动范围：`packages/storage-sqlite`、`apps/node-daemon`
- 主要内容：
  - 新增 `network_config` 持久化（`networkId` / `networkKey`）。
  - 新增网络入网与鉴权模块 `apps/node-daemon/src/network-auth.ts`。
  - `mesh-node` 支持 `initNetwork/createJoinToken/joinNetwork/getNetworkState`。
  - 出站 `/p2p/*` 请求增加签名头；同步在未入网时会阻止执行。

### 2026-03-03（续）

- 改动范围：`apps/node-daemon`、`packages/sdk`、`apps/mcp-server`、`README.md`
- 主要内容：
  - `/p2p/*` 入站请求统一执行网络鉴权，未通过返回 `401`。
  - `/p2p/events`、`/p2p/sync` 改为基于原始 body 解析，避免请求体重复读取。
  - SDK 新增网络方法：`getNetwork/initNetwork/createJoinToken/joinNetwork`。
  - MCP 新增工具：`get_network/init_network/create_join_token/join_network`。
  - README 重写为网络密钥入网流程（含 bootstrap token）并更新 API/环境变量说明。
- 验证结果：已完成类型检查（见下方“验证”条目）。

### 2026-03-03（续）

- 改动范围：`README.md`
- 主要内容：修正 Quick Start 中 `curl -d` 示例 JSON 引号，确保命令可直接复制执行。
- 验证结果：已手动复查示例片段。

### 2026-03-03（验证）

- 改动范围：工作区类型检查
- 主要内容：执行全仓 TypeScript 类型检查。
- 验证结果：通过。
  - `./node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/storage-sqlite/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/sdk/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/node-daemon/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json --noEmit`

### 2026-03-03（续）

- 改动范围：`apps/node-daemon/src/http.ts`、`apps/node-daemon/src/index.ts`
- 主要内容：
  - `parseJsonBody` 统一把 JSON 解析失败转为 `Invalid JSON body`。
  - 扩展客户端错误识别：`Invalid joinToken`、`joinToken has expired`、`Network is not configured` 返回 4xx，而不是 5xx。
- 验证结果：已通过类型检查（见本文件“验证”条目）。

### 2026-03-03（续）

- 改动范围：`AGENT.md`
- 主要内容：将早先“待执行类型检查”状态修正为“已完成类型检查”，保持日志一致性。
- 验证结果：文档一致性检查通过。

### 2026-03-03（续）

- 改动范围：`apps/node-daemon/src/index.ts`
- 主要内容：周期性 `syncFromPeers` 增加 `.catch(...)`，避免未入网时的 Promise 拒绝变成未处理异常。
- 验证结果：已通过类型检查（见本文件“验证”条目）。

### 2026-03-04

- 改动范围：`apps/node-daemon/src/network-auth.ts`、`packages/storage-sqlite/src/index.ts`、`apps/node-daemon/src/mesh-node.ts`
- 主要内容：
  - join token 升级为 `version:2` 邀请码模型：token 不再携带明文 `networkKey`，改为 `inviteId + inviteSecret + issuerUrl + maxUses + expiresAt`。
  - 新增 `isJoinTokenV2` 与 `version:1` 兼容解析，旧 token 仍可通过 `/v1/network/join` 直接加入。
  - 存储层新增 `network_invites` 表与方法：`createNetworkInvite/getNetworkInvite/consumeNetworkInvite`，支持过期、限次、密钥摘要校验。
  - MeshNode 新增 `redeemJoinToken`，`joinNetwork` 改为“先兑换再落库网络密钥”，并保留 legacy token 直入网路径。

### 2026-03-04（续）

- 改动范围：`apps/node-daemon/src/index.ts`、`apps/node-daemon/src/config.ts`
- 主要内容：
  - 新增 `POST /p2p/network/redeem`，用于未入网节点兑换邀请凭证。
  - `/p2p/*` 鉴权改为排除兑换接口：`/p2p/network/redeem` 不要求网内签名头，其余 p2p 路由保持强鉴权。
  - `POST /v1/network/init` 与 `POST /v1/network/token` 支持 `maxUses/issuerUrl` 参数。
  - 新增 `PUBLIC_BASE_URL` 配置（默认 `http://NODE_HOST:NODE_PORT`），作为邀请码兑换地址来源。

### 2026-03-04（续）

- 改动范围：`packages/sdk/src/index.ts`、`apps/mcp-server/src/index.ts`、`README.md`
- 主要内容：
  - SDK 入网接口同步支持 `joinTokenMaxUses/joinTokenIssuerUrl` 与 `maxUses/issuerUrl`。
  - MCP 工具 `init_network/create_join_token` 增加对应参数。
  - README 增补“token 不含明文 networkKey”的说明，并补充兑换接口与 `PUBLIC_BASE_URL` 环境变量。
- 验证结果：
  - `./node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/storage-sqlite/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/sdk/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/node-daemon/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json --noEmit`

### 2026-03-04（续）

- 改动范围：`README.md`
- 主要内容：
  - 新增“系统怎么用（先看这里）”章节，给出 6 步使用路径。
  - 明确职责边界：隧道/组网层由用户提供，`lucy-agent-mesh` 负责应用层 mesh 能力。
  - 增加部署建议（本地开发/内网/跨公网）帮助用户快速选型。
- 验证结果：README 结构与命令流程已人工复查。

### 2026-03-04（社交发现）

- 改动范围：`apps/node-daemon/src/mesh-node.ts`、`apps/node-daemon/src/index.ts`、`apps/node-daemon/src/config.ts`
- 主要内容：
  - 新增社交式发现链路：`/v1/discovery/query` + `/p2p/discovery/query`，支持 `maxHops/maxPeerFanout/limit` 受控扩散。
  - 新增转介绍链路：`/v1/discovery/intro-request` + `/p2p/discovery/intro-request` + `/p2p/discovery/intro-offer`。
  - 节点内增加 query 去重缓存（防环路）与推荐去重排序逻辑（按 score/hops）。
  - 加入 `DISCOVERY_AUTO_ACCEPT_INTROS` 配置（默认 `true`）用于控制是否自动接受转介绍。

### 2026-03-04（社交发现配套）

- 改动范围：`packages/sdk/src/index.ts`、`apps/mcp-server/src/index.ts`、`README.md`
- 主要内容：
  - SDK 新增 `discoverAgents` 与 `requestIntroduction` 方法。
  - MCP 新增 `discover_agents` 与 `request_introduction` 工具。
  - README 增加“系统怎么用”与“社交式发现”章节，明确隧道层职责边界与调用示例。
- 验证结果：
  - `./node_modules/.bin/tsc -p packages/core/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/storage-sqlite/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p packages/sdk/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/node-daemon/tsconfig.json --noEmit`
  - `./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json --noEmit`

### 2026-03-04（Skill 目录优化）

- 改动范围：`skills/lucy-mesh-operator/*`、`README.md`
- 主要内容：
  - 新增 `skills/lucy-mesh-operator` 技能包，包含 `SKILL.md`、`agents/openai.yaml`、`references/`、`scripts/` 标准结构。
  - `SKILL.md` 定义 mesh 节点运营流程、执行规则与资源索引，覆盖入网、发现、转介绍、直发与故障处理入口。
  - 新增参考文档：
    - `references/workflow.md`（端到端操作流程）
    - `references/tool-playbook.md`（MCP/HTTP 映射）
    - `references/error-recovery.md`（常见错误恢复）
    - `references/directory-layout.md`（推荐目录设计）
  - 新增 `scripts/preflight-check.sh`，用于节点可达性与网络配置快速预检。
  - README 新增 Skill 目录与安装/触发示例，并在“架构一览”补充 skill 层职责说明。
- 验证结果：
  - `python3 /home/fredgu/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/lucy-mesh-operator`
  - `bash -n skills/lucy-mesh-operator/scripts/preflight-check.sh`
  - `NODE_API_URL=http://127.0.0.1:9 skills/lucy-mesh-operator/scripts/preflight-check.sh`（预期失败，验证异常路径）
