# Repository Guidelines

## Project Structure & Module Organization
- `apps/node-daemon`: decentralized node daemon (HTTP/WebSocket), with routing in `src/index.ts` and mesh logic in `src/mesh-node.ts`.
- `apps/mcp-server`: MCP stdio server exposing mesh operations to Codex/Claude Code (`@leapbound/lucy-agent-mcp-server`).
- `packages/core`: shared types, event models, and protocol primitives.
- `packages/storage-sqlite`: SQLite persistence, schema setup, and storage APIs.
- `packages/sdk`: TypeScript client for node-daemon APIs.
- `skills/lucy-mesh-operator`: skill docs/scripts for operator workflows.
- `.local/`: runtime data and local test state. Treat as generated output.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm dev`: start `@lucy/node-daemon` in dev mode.
- `pnpm dev:mcp`: start `@leapbound/lucy-agent-mcp-server` (stdio); set `NODE_API_URL` first.
- `pnpm build`: compile all workspace packages/apps.
- `pnpm typecheck`: run strict TypeScript checks across the monorepo.
- `npm run mcp:check`: validate MCP publish metadata consistency and packageability.

Examples:
- `NODE_PORT=7010 NODE_NAME=agent-alpha pnpm dev`
- `NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp`

## Coding Style & Naming Conventions
- TypeScript ESM only (`"type": "module"`, `moduleResolution: NodeNext`).
- Use 2-space indentation and keep imports grouped: Node built-ins, third-party, workspace modules, local files.
- Naming: files in `kebab-case` (for example `network-auth.ts`), types/interfaces in `PascalCase`, variables/functions in `camelCase`, env vars in `UPPER_SNAKE_CASE`.
- Keep transport/parsing concerns in route/http layers; keep mesh/business logic in `MeshNode` and package modules.

## Testing Guidelines
- Baseline gate for every change: `pnpm typecheck`.
- For behavior updates, run local multi-node smoke checks from `README.md` (network init/join, sync, discovery, identity bind/revoke).
- If adding automated tests, place them near the target package/app as `*.test.ts` and document execution in the PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commits used in history: `feat:`, `fix:`, `docs:`, `refactor:`.
- Keep commits focused and message subjects concise.
- PRs should include: change intent, affected paths, and validation commands/results.
- Keep PR descriptions self-contained, since this repository no longer uses a separate `AGENT.md` worklog file.

## Security & Configuration Notes
- Never commit secrets, wallet private keys, raw `networkKey`, or real production tokens.
- Prefer invite redemption flows instead of distributing plain keys.
- External networking (tunnel/VPN/overlay) is user-managed; this project provides application-layer mesh logic, not a central relay server.
