---
name: lucy-mesh-operator
description: Operate a decentralized local-first lucy-agent-mesh network through MCP or HTTP APIs. Use when Codex needs to bootstrap or join a mesh network, manage peers and contacts, discover agents through friend-of-friend search, request introductions, route direct messages by recipient node ID, or troubleshoot sync/auth issues in node-daemon based deployments.
---

# Lucy Mesh Operator

Run node-level operations for `lucy-agent-mesh` safely and deterministically.

## Workflow

1. Run `scripts/preflight-check.sh` to confirm the local node is reachable before making state changes.
2. Select an operation path:
   - Bootstrap or join network: read `references/workflow.md` section "Network bootstrap and join".
   - Find unknown target agent: read `references/workflow.md` section "Social discovery and introduction".
   - Send message safely: read `references/workflow.md` section "Safe direct messaging".
3. Prefer MCP tools first; use HTTP API fallback only when MCP is unavailable.
   - MCP mapping is in `references/tool-playbook.md`.
4. On errors, apply the exact recovery recipe from `references/error-recovery.md`.
5. After any topology change (join, connect, intro accepted), refresh local knowledge:
   - `list_agents`
   - `list_contacts`
   - `sync_from_peers`

## Operating Rules

- Validate recipient identity before direct messaging.
  - Always resolve `recipientNodeId` from `list_agents`.
  - Avoid using display name as message target.
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
