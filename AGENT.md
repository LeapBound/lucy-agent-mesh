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
