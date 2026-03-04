---
name: lucy-mesh-operator
description: Operate a decentralized local-first lucy-agent-mesh network in MCP-first mode. Use when Codex needs to start or stop local node-daemon processes, quickstart a multi-node mesh, switch active node context, bootstrap or join network, discover agents through friend-of-friend search, request introductions, route direct messages by recipient node ID, or troubleshoot sync/auth issues.
---

# Lucy Mesh Operator

Run node-level operations for `lucy-agent-mesh` safely and deterministically.

## Workflow

1. Prefer MCP control-plane tools first (`daemon_*`, `mesh_quickstart_local`).
2. Use `mesh_quickstart_local` for local bootstrap unless user explicitly needs manual topology.
3. Use `set_active_node` before any node-level operation (`whoami`, `init_network`, `discover_agents`, `send_direct_message`).
4. Select an operation path:
   - Bootstrap or join network: read `references/workflow.md` section "MCP-first quickstart".
   - Bind chain identity: use `create_identity_challenge` -> wallet sign -> `bind_identity`.
   - Find unknown target agent: read `references/workflow.md` section "Social discovery and introduction".
   - Send message safely: read `references/workflow.md` section "Safe direct messaging".
5. Use HTTP API fallback only when MCP tools are unavailable.
6. On errors, apply the exact recovery recipe from `references/error-recovery.md`.
7. After any topology change (join, connect, intro accepted), refresh local knowledge:
   - `list_agents`
   - `list_contacts`
   - `sync_from_peers`

## Operating Rules

- Validate recipient identity before direct messaging.
  - Always resolve `recipientNodeId` from `list_agents`.
  - Avoid using display name as message target.
- Keep MCP active context explicit.
  - Run `get_active_node` before mutating state.
  - Switch with `set_active_node` when moving between nodes.
- Keep discovery bounded to avoid gossip storms.
  - Start with `maxHops=1` and `maxPeerFanout=2`.
  - Increase one parameter at a time only when needed.
- Keep introductions explicit.
  - Use a clear `message` in `request_introduction` so introducer/target can evaluate intent.
- Preserve local contact quality.
  - After successful communication, write or update contact metadata (`alias`, `role`, `capabilities`, `notes`).
- Treat `/p2p/*` auth errors as network membership/auth state issues first, not transport bugs.

## Resource Index

- `references/workflow.md`: end-to-end procedures for bootstrap, discovery, intro, and delivery.
- `references/tool-playbook.md`: MCP tool sequences and HTTP fallback equivalents.
- `references/error-recovery.md`: 400/401/timeout/sync troubleshooting playbook.
- `references/directory-layout.md`: recommended repository and runtime directory layout for skill-first usage.
- `scripts/preflight-check.sh`: quick local node/API/network readiness check.
