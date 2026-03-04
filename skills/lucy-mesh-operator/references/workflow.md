# Workflow

## 1. MCP-first quickstart

Use this as the default path in local development.

MCP sequence:
1. `mesh_quickstart_local`
2. `get_active_node`
3. `whoami`

Expected outcome:
- MCP manages 2+ local daemons
- network is initialized
- peers are connected in star topology
- active node is set to bootstrap (unless explicitly disabled)

## 2. Manual node lifecycle (when custom topology is needed)

MCP sequence:
1. `daemon_start` (repeat per node)
2. `daemon_status`
3. `set_active_node` to bootstrap node
4. `init_network`
5. `create_join_token` (`maxUses >= joining nodes`)
6. `set_active_node` to target node and `join_network`
7. `add_peer` and `sync_from_peers`

HTTP fallback preflight:

```bash
NODE_API_URL=http://127.0.0.1:7010 ./skills/lucy-mesh-operator/scripts/preflight-check.sh --require-network
```

## 3. Social discovery and introduction

Use when target node ID is unknown.

MCP sequence:
1. `discover_agents` with bounded search (`maxHops=1`, `maxPeerFanout=2`)
2. Select recommendation with best score and trusted `viaNodeId`
3. `request_introduction` to introducer peer URL
4. If accepted, `add_peer` with returned contact URL(s)

HTTP equivalent discovery:

```bash
curl -s http://127.0.0.1:7010/v1/discovery/query \
  -H "content-type: application/json" \
  -d '{"query":"test-agent sync","maxHops":1,"maxPeerFanout":2,"limit":10}' | jq
```

HTTP equivalent intro:

```bash
curl -s http://127.0.0.1:7010/v1/discovery/intro-request \
  -H "content-type: application/json" \
  -d '{"introducerPeerUrl":"http://127.0.0.1:7011","targetNodeId":"<TARGET_NODE_ID>","message":"想沟通同步策略"}' | jq
```

## 4. Safe direct messaging

Use when recipient identity is known.

MCP sequence:
1. `list_agents`
2. `upsert_contact` (optional but recommended)
3. `send_direct_message`
4. `sync_from_peers`

HTTP equivalent:

```bash
curl -s http://127.0.0.1:7010/v1/messages/direct \
  -H "content-type: application/json" \
  -d '{"recipientNodeId":"<TARGET_NODE_ID>","content":"hello"}' | jq
```

## 5. Teardown and cleanup

MCP sequence:
1. `daemon_status`
2. `daemon_stop` per managed daemon (`daemonId` or `port`)
3. optional: restart with `daemon_start clearDataDir=true` for fresh state

## 6. Post-change refresh

Run after any network mutation:
1. `list_agents`
2. `list_contacts`
3. `sync_from_peers`

This keeps local state aligned and lowers mis-route risk.
