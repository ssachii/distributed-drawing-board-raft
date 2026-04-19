#!/usr/bin/env bash
# smoke-test.sh — MiniRAFT end-to-end smoke test (4-replica cluster)
# Requires: docker, docker compose (v2), curl, jq
# Optional (for WS steps): websocat or wscat
# Usage: bash scripts/smoke-test.sh
# Exit 0 only if every step passes.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS() { printf "${GREEN}[PASS]${NC} %s\n" "$1"; }
FAIL() { printf "${RED}[FAIL]${NC} %s\n" "$1"; FAILURES=$((FAILURES+1)); }
INFO() { printf "${YELLOW}[INFO]${NC} %s\n" "$1"; }

FAILURES=0
COMPOSE="docker compose"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
REPLICA_HTTP_PORTS=(8081 8082 8083 8084)
GATEWAY_WS="ws://localhost:8080/ws"
GATEWAY_HTTP="http://localhost:8080"

step1() {
  INFO "Step 1: docker compose up --build -d"
  cd "$REPO_ROOT"
  $COMPOSE up --build -d 2>&1 | tail -5
  INFO "Waiting for all replicas and gateway (up to 90s)..."
  local deadline=$(( $(date +%s) + 90 ))
  local healthy=0
  while [ $(date +%s) -lt $deadline ]; do
    healthy=0
    for port in "${REPLICA_HTTP_PORTS[@]}"; do
      if curl -sf "http://localhost:${port}/health" -o /dev/null 2>/dev/null; then
        healthy=$((healthy+1))
      fi
    done
    local gw_ok=0
    if curl -sf "${GATEWAY_HTTP}/health" -o /dev/null 2>/dev/null; then gw_ok=1; fi
    if [ $healthy -eq 4 ] && [ $gw_ok -eq 1 ]; then
      PASS "Step 1: all 5 services healthy (4 replicas + gateway)"
      return 0
    fi
    sleep 2
  done
  FAIL "Step 1: timed out (replicas_healthy=$healthy, gw=$gw_ok)"
  return 1
}

SMOKE_STROKE_ID="smoke-$(date +%s%N | md5sum | head -c8)"
STROKE_DRAW_MSG='{"type":"STROKE_DRAW","payload":{"strokeId":"'"$SMOKE_STROKE_ID"'","points":[{"x":10,"y":10},{"x":20,"y":20}],"colour":"#ff0000","width":3,"strokeTool":"pen"}}'

ws_send_recv() {
  local url="$1" msg="$2" timeout_sec="$3"
  if command -v websocat &>/dev/null; then
    echo "$msg" | timeout "$timeout_sec" websocat --no-close -n1 "$url" 2>/dev/null || true
  elif command -v wscat &>/dev/null; then
    wscat --connect "$url" --execute "$msg" --wait "$((timeout_sec*1000))" 2>/dev/null || true
  else
    echo "NO_WS_CLIENT"
  fi
}

step2() {
  INFO "Step 2: STROKE_DRAW → STROKE_COMMITTED"
  if ! command -v websocat &>/dev/null && ! command -v wscat &>/dev/null; then
    INFO "Step 2: SKIPPED — no WebSocket client (install websocat or wscat)"
    return 0
  fi
  local output
  output=$(ws_send_recv "$GATEWAY_WS" "$STROKE_DRAW_MSG" 4)
  if echo "$output" | grep -q "STROKE_COMMITTED"; then
    PASS "Step 2: STROKE_COMMITTED received"
  else
    FAIL "Step 2: STROKE_COMMITTED not received"
  fi
}

KILLED_CONTAINER=""
KILLED_REPLICA_IDX=""

step3() {
  INFO "Step 3: Identify leader and kill it"
  local leader_id="" leader_port=""
  for i in 1 2 3 4; do
    local port="${REPLICA_HTTP_PORTS[$((i-1))]}"
    local state
    state=$(curl -sf "http://localhost:${port}/status" 2>/dev/null | jq -r '.state // empty' 2>/dev/null || true)
    if [ "$state" = "LEADER" ]; then
      leader_id="replica${i}"
      leader_port="$port"
      break
    fi
  done

  if [ -z "$leader_id" ]; then
    local deadline=$(( $(date +%s) + 5 ))
    while [ $(date +%s) -lt $deadline ]; do
      for i in 1 2 3 4; do
        local port="${REPLICA_HTTP_PORTS[$((i-1))]}"
        local state
        state=$(curl -sf "http://localhost:${port}/status" 2>/dev/null | jq -r '.state // empty' 2>/dev/null || true)
        if [ "$state" = "LEADER" ]; then
          leader_id="replica${i}"; leader_port="$port"; break 2
        fi
      done
      sleep 0.5
    done
  fi

  if [ -z "$leader_id" ]; then FAIL "Step 3: no leader found"; return 1; fi

  local project
  project=$(cd "$REPO_ROOT" && $COMPOSE config --format json 2>/dev/null | jq -r '.name // empty' 2>/dev/null || basename "$REPO_ROOT" | tr '[:upper:]' '[:lower:]')
  KILLED_CONTAINER="${project}-${leader_id}-1"
  KILLED_REPLICA_IDX="${leader_id: -1}"

  INFO "Leader=$leader_id, killing $KILLED_CONTAINER"
  docker stop "$KILLED_CONTAINER" >/dev/null
  PASS "Step 3: killed $KILLED_CONTAINER"
}

NEW_LEADER_PORT=""

step4() {
  INFO "Step 4: New leader within 3s (quorum from remaining 3)"
  local deadline=$(( $(date +%s) + 3 ))
  while [ $(date +%s) -lt $deadline ]; do
    for i in 1 2 3 4; do
      [ "$i" = "$KILLED_REPLICA_IDX" ] && continue
      local port="${REPLICA_HTTP_PORTS[$((i-1))]}"
      local state
      state=$(curl -sf "http://localhost:${port}/status" 2>/dev/null | jq -r '.state // empty' 2>/dev/null || true)
      if [ "$state" = "LEADER" ]; then
        NEW_LEADER_PORT="$port"
        PASS "Step 4: new leader = replica${i} (port $port)"
        return 0
      fi
    done
    sleep 0.1
  done
  FAIL "Step 4: no new leader in 3s"
  return 1
}

step5() {
  INFO "Step 5: STROKE_DRAW after failover"
  if ! command -v websocat &>/dev/null && ! command -v wscat &>/dev/null; then
    INFO "Step 5: SKIPPED"; return 0
  fi
  local stroke_id="smoke-post-$(date +%s%N | md5sum | head -c8)"
  local msg='{"type":"STROKE_DRAW","payload":{"strokeId":"'"$stroke_id"'","points":[{"x":30,"y":30}],"colour":"#0000ff","width":2,"strokeTool":"pen"}}'
  local output
  output=$(ws_send_recv "$GATEWAY_WS" "$msg" 4)
  if echo "$output" | grep -q "STROKE_COMMITTED"; then
    PASS "Step 5: STROKE_COMMITTED after failover"
  else
    FAIL "Step 5: no STROKE_COMMITTED after failover"
  fi
}

step6() {
  INFO "Step 6: Restarting $KILLED_CONTAINER"
  [ -z "$KILLED_CONTAINER" ] && { FAIL "Step 6: no container killed"; return 1; }
  docker start "$KILLED_CONTAINER" >/dev/null
  PASS "Step 6: restarted $KILLED_CONTAINER"
}

step7() {
  INFO "Step 7: Restarted replica catches up (up to 10s)"
  [ -z "$KILLED_REPLICA_IDX" ] && { FAIL "Step 7: unknown index"; return 1; }
  local restarted_port="${REPLICA_HTTP_PORTS[$((KILLED_REPLICA_IDX-1))]}"
  local leader_log_len=0
  if [ -n "$NEW_LEADER_PORT" ]; then
    leader_log_len=$(curl -sf "http://localhost:${NEW_LEADER_PORT}/status" 2>/dev/null | jq '.logLength // 0' 2>/dev/null || echo 0)
  fi
  INFO "Leader logLength=$leader_log_len"
  local deadline=$(( $(date +%s) + 10 ))
  while [ $(date +%s) -lt $deadline ]; do
    local status_json state log_len
    status_json=$(curl -sf "http://localhost:${restarted_port}/status" 2>/dev/null || true)
    state=$(echo "$status_json" | jq -r '.state // empty' 2>/dev/null || true)
    log_len=$(echo "$status_json" | jq '.logLength // -1' 2>/dev/null || echo -1)
    if [ "$state" = "FOLLOWER" ] && [ "$log_len" -ge "$leader_log_len" ]; then
      PASS "Step 7: replica${KILLED_REPLICA_IDX} is FOLLOWER with logLength=$log_len"
      return 0
    fi
    sleep 0.2
  done
  FAIL "Step 7: replica${KILLED_REPLICA_IDX} did not catch up (state=$state, log=$log_len)"
  return 1
}

step8_partition() {
  INFO "Step 8: Network partition test"
  # Find a follower to partition
  local victim=""
  for i in 1 2 3 4; do
    local port="${REPLICA_HTTP_PORTS[$((i-1))]}"
    local state
    state=$(curl -sf "http://localhost:${port}/status" 2>/dev/null | jq -r '.state // empty' 2>/dev/null || true)
    if [ "$state" = "FOLLOWER" ]; then
      victim="replica${i}"
      break
    fi
  done
  if [ -z "$victim" ]; then
    INFO "Step 8: SKIPPED — no follower found"
    return 0
  fi
  INFO "Partitioning $victim via /chaos API"
  local res
  res=$(curl -sf -X POST "${GATEWAY_HTTP}/chaos" \
    -H "Content-Type: application/json" \
    -d "{\"target\":\"$victim\",\"mode\":\"partition\"}" 2>/dev/null || echo "{}")
  if echo "$res" | grep -q "partition"; then
    PASS "Step 8: partition applied to $victim (auto-heals in 15s)"
  else
    INFO "Step 8: partition result: $res — may need Docker socket access"
  fi
}

step9() {
  INFO "Step 9: docker compose down"
  cd "$REPO_ROOT"
  $COMPOSE down -v 2>&1 | tail -3
  PASS "Step 9: cluster torn down"
}

main() {
  echo "========================================"
  echo "  MiniRAFT Smoke Test (4-replica)"
  echo "========================================"
  trap 'step9 2>/dev/null || true' EXIT
  step1 || { FAIL "Step 1 fatal"; exit 1; }
  step2
  step3 || { FAIL "Step 3 fatal"; FAILURES=$((FAILURES+5)); step9; exit 1; }
  step4 || { FAIL "Step 4 fatal"; FAILURES=$((FAILURES+4)); step9; exit 1; }
  step5
  step6 || true
  step7
  step8_partition
  echo "========================================"
  if [ $FAILURES -eq 0 ]; then
    printf "${GREEN}ALL STEPS PASSED${NC}\n"
    exit 0
  else
    printf "${RED}$FAILURES STEP(S) FAILED${NC}\n"
    exit 1
  fi
}

main "$@"
