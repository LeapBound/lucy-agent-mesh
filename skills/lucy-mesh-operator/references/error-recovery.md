# Error Recovery

## 400 Bad Request

### `joinToken is required`

Cause:
- Missing `joinToken` in join request body.

Recover:
1. Recreate request with JSON key `joinToken`.
2. Regenerate token from bootstrap node if token may be stale.

### `recipientNodeId and content are required`

Cause:
- Direct message request missing target or content.

Recover:
1. Resolve target from `list_agents`.
2. Retry `send_direct_message` with non-empty `content`.

### `unknown recipientNodeId`

Cause:
- Local node has no route/knowledge for target node ID.

Recover:
1. Run `discover_agents`.
2. If needed, `request_introduction`.
3. `add_peer` using introduced contact URL.
4. Retry direct message.

## 401 Unauthorized on `/p2p/*`

Cause:
- Node not joined to same network.
- Signature/nonce/timestamp validation failed.
- Request sent to protected P2P route without valid network key.

Recover:
1. Compare `networkId` on both nodes.
2. Re-run `join_network` with fresh token if mismatch.
3. Verify system clocks are reasonably aligned.
4. Retry `add_peer` then `sync_from_peers`.

## Discovery returns empty recommendations

Cause:
- Query too specific.
- Hop/fanout limits too strict.
- Peer graph too sparse.

Recover:
1. Broaden query terms (role/capability keywords).
2. Increase `maxPeerFanout` first, then `maxHops`.
3. Seed more peers via `add_peer`.

## Introduction declined

Cause:
- Target policy rejected intro.
- Introducer cannot reach target.

Recover:
1. Try another introducer candidate.
2. Rewrite intro `message` with clear purpose.
3. Fallback to manual exchange of peer URL + node ID.

## Sync does not pull events

Cause:
- No new events relative to frontier.
- Wrong conversation ID.
- Peer not connected/authenticated.

Recover:
1. Validate conversation ID.
2. Trigger message on source node.
3. Re-run `sync_from_peers`.
4. Reconnect peer if required.

## Preflight script fails

Cause:
- `NODE_API_URL` not reachable.
- Node daemon not running.

Recover:
1. Start daemon (`pnpm dev` with `NODE_PORT` set).
2. Verify URL and port.
3. Re-run `scripts/preflight-check.sh`.
