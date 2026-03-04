# Workflow

## 1. Node preflight

Run:

```bash
NODE_API_URL=http://127.0.0.1:7010 ./skills/lucy-mesh-operator/scripts/preflight-check.sh
```

Expected:
- `/healthz` responds
- `/v1/node` responds
- `/v1/network` responds (configured or not configured)

If this fails, stop and fix reachability first.

## 2. Network bootstrap and join

### Bootstrap first node

MCP sequence:
1. `init_network`
2. `create_join_token` (optional for additional nodes)

HTTP equivalent:

```bash
curl -s http://127.0.0.1:7010/v1/network/init \
  -H "content-type: application/json" \
  -d {} | jq
```

### Join another node

MCP sequence:
1. `join_network`
2. `add_peer`
3. `sync_from_peers`

HTTP equivalent:

```bash
curl -s http://127.0.0.1:7011/v1/network/join \
  -H "content-type: application/json" \
  -d {joinToken:<JOIN_TOKEN>} | jq
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
  -d query:test-agent sync | jq
```

HTTP equivalent intro:

```bash
curl -s http://127.0.0.1:7010/v1/discovery/intro-request \
  -H "content-type: application/json" \
  -d introducerPeerUrl:http://127.0.0.1:7011 | jq
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
  -d recipientNodeId:<TARGET_NODE_ID> | jq
```

## 5. Post-change refresh

Run after any network mutation:
1. `list_agents`
2. `list_contacts`
3. `sync_from_peers`

This keeps local state aligned and lowers mis-route risk.
