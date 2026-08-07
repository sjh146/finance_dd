#!/usr/bin/env bash
#
# smoke-test.sh — 아끼로그 (AggeLog) MVP 스모크 테스트
#
# 검증 항목:
#   1. 루트 빌드 (apps/api + packages/contracts + apps/mcp)
#   2. API 유닛 테스트 (jest)
#   3. API 서버 기동 → GET /health, GET /api/domain/health 응답 확인
#      + 파이프라인 smoke (POST /api/pipeline/run + GET /api/pipeline/status)
#   4. MCP 서버 부팅 확인 (stdio initialize 핸드셰이크)
#
# 사용법: bash scripts/smoke-test.sh   (또는 npm run smoke)
#
# DB/Redis가 없어도 도메인 유닛 테스트(분류·예측·체크리스트·LLM 라우팅)는
# DB 의존 없이 통과한다. API 서버 기동은 DATABASE_URL이 필요하므로
# .env.example에서 값을 주입한다 (실제 .env는 읽지 않음).

set -uo pipefail

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"

# 스모크 테스트 전용 포트 (기본 3001과 충돌 방지)
SMOKE_PORT="${SMOKE_PORT:-3199}"

# .env.example에서 DATABASE_URL 추출 (실제 .env는 읽지 않음). 환경변수가 이미 있으면 우선 사용.
DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env.example" | head -1 | cut -d= -f2-)}"
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: .env.example에서 DATABASE_URL을 찾을 수 없습니다."
  exit 1
fi

# 인증 키 획득:
#   1. 환경변수 SEED_API_KEY 가 설정된 경우(로컬 개발) 그 값을 우선 사용.
#   2. 그 외에는 시드된 DB의 members 테이블에서 api_key 를 직접 조회해 사용
#      (DATABASE_URL 은 .env.example 에서 주입). .env.example 의 SEED_API_KEY 는
#      참조하지 않는다 — 커밋된 고정 키에 의존하지 않기 위함.
API_KEY="${API_KEY:-${SEED_API_KEY:-}}"
if [ -z "$API_KEY" ]; then
  API_KEY="$(cd "$ROOT_DIR" && env DATABASE_URL="$DATABASE_URL" npx tsx scripts/smoke-api-key.ts 2>/dev/null)"
fi
if [ -z "$API_KEY" ]; then
  echo "ERROR: 시드 회원 인증 키를 조회할 수 없습니다. SEED_API_KEY 환경변수를 설정하거나 시드된 DB(members.api_key)가 필요합니다."
  exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------
log()  { printf '\n\033[1;36m[SMOKE]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32mPASS\033[0m %s\n' "$*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf '  \033[1;31mFAIL\033[0m %s\n' "$*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# 명령 실행 + 실패 시 기록
run_check() {
  local desc="$1"; shift
  if "$@" >/tmp/smoke_$$.log 2>&1; then
    ok "$desc"
  else
    fail "$desc"
    echo "      └─ 로그: /tmp/smoke_$$.log (마지막 15줄)"
    tail -15 /tmp/smoke_$$.log | sed 's/^/         /'
  fi
}

# ---------------------------------------------------------------------------
# 1. 루트 빌드
# ---------------------------------------------------------------------------
log "1/4 루트 빌드 (api + contracts + mcp)"
run_check "루트 빌드 (npm run build)" bash -c "cd '$ROOT_DIR' && npm run build"

# ---------------------------------------------------------------------------
# 2. API 유닛 테스트
# ---------------------------------------------------------------------------
log "2/4 API 유닛 테스트"
run_check "API 유닛 테스트 (jest)" bash -c "cd '$ROOT_DIR' && npm test --workspace apps/api"

# ---------------------------------------------------------------------------
# 3. API 서버 기동 + 엔드포인트 확인
# ---------------------------------------------------------------------------
log "3/4 API 서버 기동 + 엔드포인트 확인"

API_PID=""
cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null
    wait "$API_PID" 2>/dev/null
  fi
  rm -f /tmp/smoke_$$.log
}
trap cleanup EXIT

# API 서버를 스모크 전용 포트로 기동 (DATABASE_URL은 .env.example에서 주입)
# node를 직접 백그라운드로 띄워 $API_PID가 실제 node 프로세스를 가리키게 한다.
(
  cd "$API_DIR"
  exec env PORT="$SMOKE_PORT" DATABASE_URL="$DATABASE_URL" node dist/main.js
) >/tmp/smoke_api_$$.log 2>&1 &
API_PID=$!

# 서버 기동 대기 (최대 30초, 0.5초 간격 재시도)
log "  API 서버 기동 대기 (포트 $SMOKE_PORT)..."
READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$SMOKE_PORT/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  fail "API 서버 기동 (포트 $SMOKE_PORT)"
  echo "      └─ 서버 로그 (마지막 20줄):"
  tail -20 /tmp/smoke_api_$$.log | sed 's/^/         /'
else
  ok "API 서버 기동 (포트 $SMOKE_PORT)"

  # GET /health
  HEALTH_BODY="$(curl -sf "http://localhost:$SMOKE_PORT/health" 2>/dev/null)"
  if [ "$HEALTH_BODY" = '{"status":"ok"}' ]; then
    ok "GET /health → $HEALTH_BODY"
  else
    fail "GET /health → '$HEALTH_BODY' (기대: {\"status\":\"ok\"})"
  fi

  # GET /api/domain/health — 분류·VAT·체크리스트·LLM 라우팅 전체 파이프라인
  DOMAIN_BODY="$(curl -sf "http://localhost:$SMOKE_PORT/api/domain/health" 2>/dev/null)"
  if [ -n "$DOMAIN_BODY" ]; then
    ok "GET /api/domain/health → 응답 수신"
    # 핵심 필드 검증
    if echo "$DOMAIN_BODY" | grep -q '"status":"ok"'; then
      ok "  domain-health status=ok"
    else
      fail "  domain-health status != ok"
    fi
    if echo "$DOMAIN_BODY" | grep -q '"classification"'; then
      ok "  classification 파이프라인 동작"
    else
      fail "  classification 누락"
    fi
    if echo "$DOMAIN_BODY" | grep -q '"vat"'; then
      ok "  VAT 예측 동작"
    else
      fail "  VAT 예측 누락"
    fi
    if echo "$DOMAIN_BODY" | grep -q '"checklist"'; then
      ok "  마감 체크리스트 동작"
    else
      fail "  마감 체크리스트 누락"
    fi
    if echo "$DOMAIN_BODY" | grep -q '"routing":"domestic"'; then
      ok "  LLM 지역 라우팅 → domestic (금융 민감 국내 강제)"
    else
      fail "  LLM 지역 라우팅 != domestic"
    fi
  else
    fail "GET /api/domain/health → 응답 없음"
  fi

  # -------------------------------------------------------------------------
  # 파이프라인 smoke — BullMQ 워커 파이프라인 run + 상태 확인
  # (ingest -> classify -> predict -> notify)
  # -------------------------------------------------------------------------
  log "  파이프라인 smoke (POST /api/pipeline/run + GET /api/pipeline/status)"

  # 시드된 business/ledger/consent id를 DB에서 조회 (DATABASE_URL은 .env.example에서 주입)
  PIPELINE_IDS="$(cd "$ROOT_DIR" && env DATABASE_URL="$DATABASE_URL" npx tsx scripts/pipeline-smoke-ids.ts 2>/dev/null)"
  if [ -z "$PIPELINE_IDS" ]; then
    fail "파이프라인 smoke — 시드 데이터 조회 실패 (seed 필요)"
  else
    BIZ_ID="$(echo "$PIPELINE_IDS" | sed -n 's/.*"businessId":"\([^"]*\)".*/\1/p')"
    LEDGER_ID="$(echo "$PIPELINE_IDS" | sed -n 's/.*"ledgerId":"\([^"]*\)".*/\1/p')"
    CONSENT_TYPE="$(echo "$PIPELINE_IDS" | sed -n 's/.*"type":"\([^"]*\)".*/\1/p')"
    CONSENT_SCOPE="$(echo "$PIPELINE_IDS" | sed -n 's/.*"scope":"\([^"]*\)".*/\1/p')"
    CONSENT_STATUS="$(echo "$PIPELINE_IDS" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"

    if [ -n "$BIZ_ID" ] && [ -n "$LEDGER_ID" ]; then
      # POST /api/pipeline/run — 전체 파이프라인 트리거 (API 키 인증 헤더 포함)
      RUN_BODY="$(curl -sf -X POST "http://localhost:$SMOKE_PORT/api/pipeline/run" \
        -H 'Content-Type: application/json' \
        -H "X-API-Key: $API_KEY" \
        -d "{\"businessId\":\"$BIZ_ID\",\"ledgerId\":\"$LEDGER_ID\",\"period\":\"2026-Q1\",\"consent\":{\"id\":\"seed-consent\",\"type\":\"$CONSENT_TYPE\",\"scope\":\"$CONSENT_SCOPE\",\"status\":\"$CONSENT_STATUS\"}}" 2>/dev/null)"
      if [ -n "$RUN_BODY" ] && echo "$RUN_BODY" | grep -q '"ingestJobId"'; then
        ok "POST /api/pipeline/run → ingest job 등록"
      else
        fail "POST /api/pipeline/run → 응답 없음/오류: '$RUN_BODY'"
      fi

      # GET /api/pipeline/status — 큐 상태 확인 (워커가 처리할 시간을 준다)
      sleep 2
      STATUS_BODY="$(curl -sf "http://localhost:$SMOKE_PORT/api/pipeline/status" \
        -H "X-API-Key: $API_KEY" 2>/dev/null)"
      if [ -n "$STATUS_BODY" ] && echo "$STATUS_BODY" | grep -q '"status":"ok"'; then
        ok "GET /api/pipeline/status → 응답 수신"
        for Q in ingest-queue ocr-queue classify-queue predict-queue notify-queue; do
          if echo "$STATUS_BODY" | grep -q "\"$Q\""; then
            ok "  $Q 큐 등록"
          else
            fail "  $Q 큐 누락"
          fi
        done
      else
        fail "GET /api/pipeline/status → 응답 없음/오류"
      fi
    else
      fail "파이프라인 smoke — 시드 id 파싱 실패"
    fi
  fi
fi

# API 서버 종료
cleanup
API_PID=""

# ---------------------------------------------------------------------------
# 4. MCP 서버 부팅 확인 (stdio initialize 핸드셰이크)
# ---------------------------------------------------------------------------
log "4/4 MCP 서버 부팅 확인 (stdio initialize)"

MCP_DIR="$ROOT_DIR/apps/mcp"
MCP_PID=""
MCP_FIFO="/tmp/smoke_mcp_in_$$"
MCP_LOG="/tmp/smoke_mcp_$$.log"
mcp_cleanup() {
  if [ -n "$MCP_PID" ] && kill -0 "$MCP_PID" 2>/dev/null; then
    kill "$MCP_PID" 2>/dev/null
    wait "$MCP_PID" 2>/dev/null
  fi
  rm -f "$MCP_FIFO" "$MCP_LOG"
}
trap 'mcp_cleanup' EXIT

# stdio 서버이므로 FIFO를 stdin으로 연결해 initialize JSON-RPC를 보낸다.
mkfifo "$MCP_FIFO"
(
  cd "$MCP_DIR"
  exec env DATABASE_URL="$DATABASE_URL" MCP_API_KEY="$API_KEY" node dist/main.js <"$MCP_FIFO"
) >"$MCP_LOG" 2>&1 &
MCP_PID=$!

# FIFO를 쓰기용으로 열어 서버가 stdin을 읽을 수 있게 한다.
exec 3>"$MCP_FIFO"

# initialize 요청 (MCP 프로토콜 핸드셰이크)
INIT_MSG='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}'
printf '%s\n' "$INIT_MSG" >&3

# 서버 부팅 대기 (최대 20초, 0.5초 간격 재시도) — 응답이 로그에 기록되면 준비 완료.
MCP_READY=0
for _ in $(seq 1 40); do
  if ! kill -0 "$MCP_PID" 2>/dev/null; then
    break
  fi
  if grep -q '"serverInfo"' "$MCP_LOG" 2>/dev/null; then
    MCP_READY=1
    break
  fi
  sleep 0.5
done

if [ "$MCP_READY" -eq 1 ]; then
  ok "MCP 서버 부팅 + initialize 핸드셰이크 (stdio)"
else
  fail "MCP 서버 부팅 (stdio initialize)"
  echo "      └─ MCP 서버 로그 (마지막 20줄):"
  tail -20 "$MCP_LOG" | sed 's/^/         /'
fi

# MCP 서버 종료
exec 3>&-
mcp_cleanup
MCP_PID=""

# ---------------------------------------------------------------------------
# 요약
# ---------------------------------------------------------------------------
printf '\n'
printf '============================================\n'
printf '  SMOKE TEST SUMMARY\n'
printf '  PASS: %d   FAIL: %d\n' "$PASS_COUNT" "$FAIL_COUNT"
printf '============================================\n'

if [ "$FAIL_COUNT" -eq 0 ]; then
  printf '\n\033[1;32mALL SMOKE TESTS PASSED\033[0m\n'
  exit 0
else
  printf '\n\033[1;31mSMOKE TESTS FAILED (%d failure(s))\033[0m\n' "$FAIL_COUNT"
  exit 1
fi
