# Lucy Agent Mesh - Session Start Notes

This file is a handoff note for future coding sessions.
If this file exists in the repo, continue from the decisions below.

## 1) Project Identity
- Repository name: `lucy-agent-mesh`
- Product type: headless (no UI) agent-to-agent chat system
- Language: TypeScript
- Deployment target: distributed, horizontally scalable services

## 2) Scope (MVP)
- Agent single chat (required)
- Group chat (optional in MVP, required in v1)
- Real-time delivery over WebSocket
- Offline sync by conversation sequence (`afterSeq`)
- Message idempotency by `clientMsgId`
- Delivery and read receipts (`delivered`, `read`)

## 3) Non-Goals
- No project management workflows
- No task assignment/orchestration engine
- No web/mobile UI in initial phase

## 4) Reference Architecture
- `gateway-service`: WebSocket connections, auth, heartbeat
- `message-core`: validate/persist messages, assign per-conversation sequence
- `sync-api`: pull missed messages after reconnect
- `receipt-api`: update delivered/read states
- Message bus: NATS JetStream
- Database: PostgreSQL
- Cache/presence: Redis

## 5) Reliability Rules
- Ordering guarantee: only within one conversation (`conversation_id + seq`)
- Delivery mode: at-least-once from transport perspective
- Dedup rule: unique key on (`sender_id`, `client_msg_id`)
- Sync source of truth: PostgreSQL, not in-memory state

## 6) Suggested Monorepo Layout
- `apps/gateway-service`
- `apps/message-core`
- `apps/sync-api`
- `apps/receipt-api`
- `packages/contracts`
- `packages/db`
- `deploy/docker-compose.yml`

## 7) Minimal Data Model
- `agents(id, name, token_hash, created_at)`
- `conversations(id, type, created_at)`
- `conversation_members(conversation_id, agent_id, joined_at)`
- `messages(id, conversation_id, sender_id, client_msg_id, seq, content, created_at)`
- `receipts(message_id, agent_id, delivered_at, read_at)`

Required constraints:
- `UNIQUE(sender_id, client_msg_id)`
- `UNIQUE(conversation_id, seq)`

## 8) API Contract (initial)
- `POST /auth/token`
- `POST /conversations`
- `POST /messages`
- `GET /messages/sync?conversationId=...&afterSeq=...`
- `POST /messages/ack`
- `GET /healthz`
- `WS /ws`

## 9) Dev Environment (planned)
- Node.js 22+
- pnpm 10+
- Docker + Docker Compose

Planned local startup commands after scaffold:
```bash
pnpm install
docker compose -f deploy/docker-compose.yml up -d
pnpm db:migrate
pnpm dev
```

## 10) Next Session Kickoff Prompt
Use this prompt in next chat:

"Continue `lucy-agent-mesh` from `LUCY_AGENT_MESH_START.md`.
Build a runnable MVP scaffold in TypeScript with:
1) gateway-service (WebSocket),
2) message persistence + per-conversation seq,
3) offline sync API,
4) Postgres schema + migrations,
5) docker-compose for Postgres/Redis/NATS,
6) a short README with run/test steps."

## 11) Definition of Done (MVP)
- Two agents connect via WebSocket and exchange messages
- Receiver can disconnect and recover missed messages via `sync`
- Duplicate send retries do not create duplicate stored messages
- Basic delivered/read ack is persisted
- Services run locally with one command path
