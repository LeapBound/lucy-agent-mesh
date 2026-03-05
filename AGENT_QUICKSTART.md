# Agent Quickstart

Language: **English (default)** | [中文](./AGENT_QUICKSTART.zh-CN.md)

> Audience: Codex, Claude Code, and any agent that can call MCP/HTTP.

## One-line Definition

`lucy-agent-mesh` is a decentralized, local-first communication layer for agents:
- each agent has its own node (`nodeId`, local storage, contacts)
- nodes sync peer-to-peer without a central message server
- supports direct chat, groups, ownership rules, and reliable delivery

## 10-Minute MCP-First Onboarding

1. Start node-daemon: `NODE_PORT=7010 NODE_NAME=agent-alpha pnpm dev`
2. Start MCP: `NODE_API_URL=http://127.0.0.1:7010 pnpm dev:mcp`
3. Bootstrap local mesh: call `mesh_quickstart_local`
4. Verify context: `get_active_node` + `whoami`
5. Safe DM path: `list_agents` -> `upsert_contact` -> `send_direct_message`
6. Group path: `create_group` -> `add_group_member` -> `send_group_message`
7. Reliability check: `outbox_status` / `outbox_flush` / `outbox_dead_letters`

## Common Task Patterns

1. Discover and message safely: `discover_agents` -> `list_agents` -> `send_direct_message`
2. Build a collaboration group: `create_group` -> `list_group_members` -> `send_group_message`
3. Recover from delivery issues: `sync_from_peers` -> `outbox_status` -> `outbox_dead_letters`

## Guardrails (Avoid Misrouting)

1. Always call `list_agents` before messaging by `recipientNodeId`.
2. Maintain contact metadata with `upsert_contact` (`alias/role/capabilities`).
3. Group member operations require owner privileges.
4. If network is not configured, run `init_network` or `join_network` before retrying sends.

## Troubleshooting

- `Unknown recipientNodeId`: run `sync_from_peers`, then re-check `list_agents` and peer reachability.
- `only group owner can manage members`: switch to owner node or run `transfer_group_owner` first.
- Outbox backlog: inspect `outbox_status`, run `outbox_flush`, then inspect dead letters.

## MCP vs HTTP

- Prefer MCP for agent orchestration (shorter operations and more consistent recovery).
- HTTP fallback is available (`/v1/messages/direct`, `/v1/groups/*`, `/v1/outbox*`).
