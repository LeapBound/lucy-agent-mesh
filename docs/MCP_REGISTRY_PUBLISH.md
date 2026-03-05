# MCP Registry 发布流程（维护者）

> 适用仓库：`lucy-agent-mesh`  
> 更新时间：2026-03-05

本流程目标：把 `apps/mcp-server` 发布为可被 MCP 客户端检索和安装的 Registry Server 记录。

## 0. 当前仓库状态（先确认）

- `apps/mcp-server` 已配置为可发布 npm 包：`@leapbound/lucy-agent-mcp-server`。
- 版本号建议与 MCP server 内部版本保持一致（当前示例为 `0.2.0`）。
- Registry 元数据建议使用固定 `mcpName`：`io.github.leapbound.lucy-agent-mesh`。

## 1. 一次性准备

1. 申请 MCP Registry 预览权限（当前仍是 preview）：  
   <https://modelcontextprotocol.io/registry/about>
2. 获取 Registry Token（本地发布用）：设置环境变量 `MCPP_AUTH_TOKEN`。
3. 准备 npm 发布权限（`NPM_TOKEN`），确保目标包名可用且可公开发布。
4. 校验或更新仓库内元数据文件：`apps/mcp-server/server.json`（模板见 `apps/mcp-server/server.json.example`）。

## 2. 维护 `server.json`

最小必要字段：
- `name`：稳定且唯一（推荐 `io.github.leapbound.lucy-agent-mesh`）
- `version_detail.version`：对外发布版本
- `packages[0].identifier`：npm 包名
- `packages[0].version`：npm 版本（需和已发布版本一致）
- `packages[0].transport.type`：本项目是 `stdio`

每次发布都要同步更新：
1. `apps/mcp-server/package.json` 中的 `version`
2. `apps/mcp-server/server.json` 中 `version_detail.version`
3. `apps/mcp-server/server.json` 中 `packages[].version`

## 3. 手动发布（本地）

1. 发布 npm 包（示例）：

```bash
./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json
cd apps/mcp-server
npm publish --access public
```

2. 发布 MCP Registry 元数据：

```bash
npx -y @modelcontextprotocol/mcp-publisher publish \
  --server-file apps/mcp-server/server.json
```

等价的一键命令（在仓库根目录）：

```bash
npm run mcp:publish
```

> `mcp-publisher` 会优先读取 `MCPP_AUTH_TOKEN`。  
> 若未设置 token，可先执行 `mcp-publisher login`。

发布前建议先执行：

```bash
npm run mcp:check
```

它会校验：
- `apps/mcp-server/package.json` 与 `apps/mcp-server/server.json` 版本一致
- npm package identifier 与 server metadata 一致
- `dist/index.js` 存在
- `npm pack --dry-run` 可通过

## 4. CI 自动发布（推荐）

建议在 GitHub Actions 使用 OIDC 登录，避免长期保存 Registry 密钥：
- `mcp-publisher login github-oidc`
- 然后执行 `publish --server-file ...`
- 仓库已提供手动触发 workflow：`.github/workflows/publish-mcp-registry.yml`

可参考官方 GitHub Actions 发布说明：  
<https://modelcontextprotocol.io/registry/quickstart>  
<https://github.com/modelcontextprotocol/registry/blob/main/docs/concepts/publishing/automated.md>

## 5. 发布后校验

1. 在 Registry 中检索 `io.github.leapbound.lucy-agent-mesh`，确认描述、版本、安装信息正确。
2. 用真实客户端做一次安装/连接验证（stdio 启动 + 工具列表可见）。
3. 若元数据错误，修正后重新发布新版本（不要复用错误版本号）。

## 6. 运行时路径说明（重要）

发布包默认能直接连接已运行的 node-daemon（`NODE_API_URL`）。

如果要启用 `daemon_start` / `mesh_quickstart_local`（由 MCP 代管 node-daemon 进程），需保证 MCP 能找到 node-daemon 代码目录：
- `LUCY_MESH_REPO_ROOT=/path/to/lucy-agent-mesh`
- 或 `LUCY_NODE_DAEMON_DIR=/path/to/lucy-agent-mesh/apps/node-daemon`

可选运行时目录：
- `LUCY_MCP_RUNTIME_DIR=/custom/runtime/dir`（默认 `<repoRoot>/.local`）。
