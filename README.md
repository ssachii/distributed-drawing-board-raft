# MiniRAFT — Distributed Real-Time Drawing Board

A fault-tolerant, real-time collaborative whiteboard backed by a 4-node Mini-RAFT consensus cluster. Built with Go (replicas + gateway) and React (frontend), containerised with Docker Compose.

---

## Architecture

```
Browser(s)
   │  WebSocket
   ▼
┌─────────┐          ┌──────────┐
│ Gateway │──HTTP──▶ │ replica1 │ ─┐
│ :8080   │          │ :8081    │  │
│         │          └──────────┘  │  gRPC
│ Leader  │──HTTP──▶ ┌──────────┐  │ (RAFT)
│ Tracker │          │ replica2 │◄─┤
│         │          │ :8082    │  │
│ SSE hub │──HTTP──▶ ┌──────────┐  │
│         │          │ replica3 │◄─┤
└─────────┘          │ :8083    │  │
                     └──────────┘  │
                     ┌──────────┐  │
                     │ replica4 │◄─┘
                     │ :8084    │
                     └──────────┘
```

- **Gateway** — accepts WebSocket clients, polls replica `/status` every 500 ms, forwards strokes to the current leader, broadcasts committed strokes to all clients via `/internal/committed`.
- **Replicas (4)** — each runs a Mini-RAFT state machine (Follower / Candidate / Leader), a gRPC RPC server, and an HTTP server. All inter-replica communication uses gRPC.
- **Frontend** — React canvas, real-time cluster dashboard (SSE), chaos controls.

---

## Mini-RAFT Protocol

| Parameter | Value |
|---|---|
| Election timeout | Random 500–800 ms |
| Heartbeat interval | 150 ms |
| Quorum (4 nodes) | 3 votes |
| Transport | gRPC |
| Persistence | WAL (append-only JSON log) |

**RPCs implemented:**
- `RequestVote` — candidate requests votes, includes log-completeness check (§5.4.1)
- `AppendEntries` — leader replicates entries; includes prevLogIndex/Term consistency check
- `Heartbeat` — empty keep-alive with commit-index piggyback
- `SyncLog` — catch-up sync for restarted nodes (called at startup before joining election)

**Safety guarantees:**
- Committed entries are never overwritten (enforced at `RaftLog.TruncateFrom`)
- Higher term always wins; nodes step down immediately
- WAL fsynced on every write; state restored on restart

---

## Bonus Features Implemented

| Feature | Details |
|---|---|
| **4th replica** | Full quorum with 4 nodes (majority = 3); tolerates 1 simultaneous failure |
| **Network partitions** | `/chaos` endpoint with `mode=partition` disconnects a replica from the Docker network; auto-heals after 15 s |
| **Undo / Redo** | `UNDO_COMPENSATION` log entries replicated through RAFT; Redo issues a new strokeId |
| **Live dashboard** | SSE-driven cluster panel showing state, term, log length, commit index per node |
| **Prometheus metrics** | `/metrics` on every replica and gateway |
| **Smoke test** | `scripts/smoke-test.sh` — full end-to-end: up → draw → kill leader → failover → draw → restart → catch-up → partition |

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Docker | 24.x |
| Docker Compose | v2 (plugin) |
| `make` | any |
| `curl` + `jq` | for smoke-test |

---

## Running the Project

### Production mode (recommended for demo)

```bash
# 1. Clean any previous state
make clean

# 2. Build and start all 5 services (4 replicas + gateway + frontend)
make up
# or: docker compose up --build

# 3. Open the app
open http://localhost:3000
```

### Development mode (hot-reload with Air)

```bash
make dev
# or: docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Editing any `.go` file in `replica/` or `gateway/` triggers Air to rebuild and restart that container. The RAFT cluster re-elects a leader automatically.

---

## Service Ports

| Service | Port | Purpose |
|---|---|---|
| Frontend | 3000 | React app (nginx) |
| Gateway | 8080 | WebSocket `/ws`, SSE `/events/cluster-status`, chaos `/chaos` |
| replica1 HTTP | 8081 | `/health`, `/status`, `/stroke`, `/entries`, `/metrics` |
| replica2 HTTP | 8082 | same |
| replica3 HTTP | 8083 | same |
| replica4 HTTP | 8084 | same |

Inspect any replica's status:

```bash
curl http://localhost:8081/status | jq .
curl http://localhost:8082/status | jq .
```

---

## Project Structure

```
MiniRAFT/
├── docker-compose.yml         # Production — 4 replicas + gateway + frontend
├── docker-compose.dev.yml     # Dev overrides — Air hot-reload, debug logging
├── Makefile
├── scripts/
│   └── smoke-test.sh          # End-to-end automated test
├── replica/                   # Shared Go module (used by all 4 replicas)
│   ├── main.go                # Entry point, HTTP server, WAL bootstrap
│   ├── raft/
│   │   ├── node.go            # RaftNode state machine, Replicate(), commit logic
│   │   ├── election.go        # startElection(), randomTimeout()
│   │   ├── heartbeat.go       # sendHeartbeats(), catchUpPeer()
│   │   └── rpc_server.go      # gRPC handlers: RequestVote, AppendEntries, Heartbeat, SyncLog
│   ├── log/
│   │   ├── log.go             # RaftLog (in-memory + WAL-backed)
│   │   ├── wal.go             # Write-Ahead Log (fsync on every write)
│   │   ├── entry.go           # LogEntry, StrokeData, EntryType
│   │   └── replication.go     # AppendEntriesHandler helper
│   ├── proto/
│   │   ├── raft.proto         # gRPC service definition
│   │   └── raft.pb.go / raft_grpc.pb.go
│   ├── metrics/metrics.go     # Prometheus gauges/counters
│   ├── status/status.go       # /health and /status HTTP handlers
│   └── Dockerfile / Dockerfile.dev / .air.toml
├── gateway/
│   ├── main.go                # HTTP mux, leader tracker wiring
│   ├── leader/tracker.go      # Polls /status, detects leader changes
│   ├── ws/handler.go          # WebSocket hub, stroke forwarding, buffering, dedup
│   ├── sse/sse.go             # Server-Sent Events hub (cluster status)
│   ├── chaos/chaos.go         # Container kill + network partition via Docker API
│   └── metrics/metrics.go
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── canvas/Canvas.jsx  # Drawing canvas, pending/committed stroke rendering
│   │   ├── canvas/drawing.js  # Canvas state, render loop
│   │   ├── ws/useDrawingWS.js # WebSocket hook with reconnect
│   │   ├── toolbar/Toolbar.jsx
│   │   ├── dashboard/         # ClusterPanel, NodeCard, useClusterSSE
│   │   └── chaos/ChaosButton.jsx
│   └── Dockerfile / Dockerfile.dev
└── logs/
    ├── replica1/ (wal.log, app.log)
    ├── replica2/
    ├── replica3/
    └── replica4/
```

---

## Troubleshooting

**No leader after startup:**
```bash
docker compose logs replica1 replica2 replica3 replica4 | grep -i election
```

**Stroke not appearing on other tab:**
- Check gateway logs: `docker compose logs gateway`
- The leader's `/internal/committed` callback notifies the gateway on every committed entry.

**Partition not working:**
- Ensure the gateway container has access to the Docker socket (`/var/run/docker.sock`).
- Check: `docker compose logs gateway | grep chaos`

**Rebuild from scratch:**
```bash
make clean && make up
```
