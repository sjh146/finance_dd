# 기술 아키텍처 및 AI 설계 분석

> 이 문서는 [PLAN.md](./PLAN.md), [MARKET_ANALYSIS.md](./MARKET_ANALYSIS.md) 의 기술·데이터·AI·인프라 상세입니다.

**버전: v2** (2026-08-07)

### Changelog (v1 → v2)
- [P0-2] 금융데이터 처리 및 LLM 게이트웨이 지역 라우팅 섹션 신설, §1.1 OCR/ML·§4.1 L3 LLM·§6.1 OCR 이중화의 GPT-4o/Claude 언급을 국내 처리 원칙 준수로 다듬음.
- [P0-1] 외부 어댑터를 마이데이터 어댑터 + 은행계열 API 제휴 어댑터로 확장, 직접 오픈뱅킹 등록 심사 기간 반영, Consent에 'mydata' 채널 강조.
- [P2-1] 분석 DB(ClickHouse/Snowflake)를 후순위로, MVP는 PostgreSQL 단일 DB, 사용자 1만+ 시점 도입으로 수정.
- [P2-2] §5.2 비용 표에 사용자당 LLM/OCR 단위경제 로우 추가(1만 명 기준 월 ~1,000원 추정).
- [P2-3] TaxPrediction/Filing 엔터티에 신고기한 디테일 반영 주석 추가.
- [P2-4] 4대보험(지역가입자 소득+재산/프리랜서 사업소득) 기준 명시.
- [P2-5] 보존 절에 사용자 삭제권 ↔ 5년 보존 충돌 해법 추가.
- [P2-6] PGExtractor를 '카드사/PG 정산 대조'로 명확화.

---

## 1. 기술 스택 상세 (Tech Stack)

### 1.1 표준 확정
| 계층 | 선택 | 비고 |
|---|---|---|
| **Frontend** | Next.js 15(App Router, TypeScript) + PWA → React Native(후) | Tailwind + shadcn/Radix, Zod + react-hook-form, React Query + Zustand |
| **Backend** | NestJS(TypeScript, MVP) 또는 Go | REST + OpenAPI, BullMQ(Redis) 워커, OAuth2/OIDC + JWT |
| **DB** | PostgreSQL 16(핵심) | + Redis(캐시/큐), Snowflake/ClickHouse(분석) — Prisma/Drizzle |
| **OCR** | 하이브리드 Tesseract/PaddleOCR + VLM(국내 LLM 우선, 해외 LLM은 비식별화 후) | 텍스트 추출 후 VLM으로 상위 인식·보정. 금융 민감 정보는 국내 처리 강제(§3.1 참조) |
| **ML** | 3단계 분류(규칙→임베딩→LLM) · 세금 예측(규칙 템플릿 + LightGBM/Prophet) · 이상(IsolationForest+LLM) | Python 서버/AWS SageMaker 병행. LLM 사용은 §3.1 지역 라우팅 원칙 준수 |
| **Infra** | AWS ap-northeast-2(서울) | EKS/Fargate, Lambda, RDS Aurora, S3(SSE-KMS), ElastiCache, Terraform, GitHub Actions, CloudWatch/Sentry |
| **보안** | WAF/GuardDuty/Secrets Manager, IAM 최소 권한, ISMS-P 대응 | 방화벽·감사 로그 |

### 1.2 설계 노트
- MVP 속도: **NestJS + 단일 API**로 시작. 홈택스 제출 등 대규모 기능 확장 시 **Go/Microservice**로 전이 가능.
- 데이터 민감도에 따라 Python 배치(ML) 서비스는 백엔드와 분리된 경량 서비스로 운영.

---

## 2. 데이터 모델 및 엔터티

### 2.1 핵심 엔터티 (안, 일부 필드만)
```
Member          id, oidc_sub(외부 인증 ID), name, contact, consent_list
Business        id, member_id, biz_no(사업자등록번호), name, industry, type(개인/법인), scale
Consent         id, member_id, type(openbanking/mydata/hometax), scope, status, granted_at, expires_at(<=5Y), source
Ledger          id, business_id, period(년월/분기), type, closed_yn
Transaction     id, ledger_id, bank/card_acct, fin_no?, amount(+/-), occurred_at, summary(거래·적요), provider
Voucher         id, ledger_id, txn_ids[], date, status(잠정/확정/수정), source(openbank/ocr/manual)
VoucherLine     id, voucher_id, account(계정과목), debit/credit, amount, side
Classification   id, voucher_id, line_id, level(L1/L2/L3), model, confidence, justification
TaxPrediction   id, business_id, tax_type(부가/종소/법인/원천/4대), period, lo/hi(구간), base, model, created_at
Filing          id, business_id, tax_type, period, draft_json/pdf, status, submitted_at
Notification    id, member_id, kind(마감/신고/납부/이상), channel, sent_at, read_at
```
> **신고기한 디테일 (P2-3)**: `TaxPrediction`·`Filing` 엔터티에 신고기한을 반영한다 — 법인세(12월 결산 → 3/31), 종합소득세 예정신고(11/30), 성실신고확인 대상자(6/30), 중간예납, 부가세(분기 1/25·4/25·7/25·10/25).
> **4대보험 기준 (P2-4)**: 4대보험 예측은 개인사업자 **지역가입자(소득+재산)** / **프리랜서(사업소득)** 기준으로 산출한다.

### 2.2 저장·보안·보존
- **보존**: 장부·거래·전표는 확정신고기한 후 최소 **5년간 보존**(소득세법 §160조의2 준거). 삭제 요구는 금융동의 만료(5년) 정책과 별개로 사용자 의사를 반영해 조정.
- **보존 vs 삭제권 충돌 해법 (P2-5)**: 사용자 삭제 요청 시 **비식별화 후 법정 보존기간까지 별도 보관**(또는 물리 삭제 시 법률 검토) 방안을 적용한다.
- **암호화**: 금융 거래·적요 등 필드는 **필드 단위 암호화(AES-256-GCM)**, 파일은 **S3 SSE-KMS 암호화**. API 키·비밀은 Secrets Manager로 관리.
- **분류 근거 기록**: `Classification.level/confidence/justification` 을 저장하여 사용자가 "AI가 왜 이렇게 분류했는지" 확인하고, 수정 시 피드백을 기록 → 학습 파이프라인에 사용.
- **DB 전략 (P2-1)**: MVP는 **PostgreSQL 단일 DB**로 운영하고, 분석 DB(ClickHouse/Snowflake)는 **사용자 1만+ 시점**에 도입한다. PostgreSQL은 메타(회원·사업체·장부·동의)를, 이후 ClickHouse/Snowflake는 거래·분석 집계 및 대용량 예측 처리를 담당하도록 분리.

---

## 3. 시스템 아키텍처 (3-tier + 외부 어댑터 + 비동기 워커)

```
[AI Agent (Hermes 등)]  ← MCP 클라이언트
        | MCP (stdio)
[MCP Server (@aggelog/mcp)]  ← 도구: 거래·분류·예측·체크리스트·OCR·동기화
        | NestJS 도메인 서비스 직접 호출 (in-process) 또는 REST
[API Gateway/BFF (NestJS)]
   |- 계정·사업 (회원, 사업체, 동의서)
   |- Transaction 커넥터 (오픈뱅킹·마이데이터·카드)
   |- OCR 파이프라인
   |- Classification · ML (추론 서비스, SageMaker)
   |- Tax Forecasting / Filing(초안)
   `- Notification (웹훅·이벤트)
         | 외부 어댑터: 마이데이터(본인신용정보관리업자), 은행계열 API 제휴(카카오뱅크 등), 금융결제원(오픈뱅킹, 별도 트랙), 홈택스(조회용), PG(카드사/PG 정산 대조)
         `- Worker(BullMQ(Redis)) 파이프라인
            * ingest(연동 수집) -> ocr(영수증) -> classify -> predict -> notify
```

- **사용자 모델 (v2.1)**: 사람용 웹 대시보드를 제거하고, **AI 에이전트(Hermes 등)가 MCP 서버를 통해 직접 소비**하는 headless 서비스로 전환. `[Web Frontend]` 계층은 삭제되고 **MCP Server** 계층이 프레젠테이션 역할을 대체한다.
- **MCP Server**: MCP TypeScript SDK 기반 stdio 서버. NestJS 도메인 서비스(분류·예측·체크리스트·OCR·어댑터)를 직접 호출하며, 아래 도구를 노출한다: `list_transactions`·`classify_transaction`·`predict_tax`·`get_closing_checklist`·`process_receipt`·`sync_accounts`·`get_ledger`·`list_businesses`. (도구 목록은 구현 시 확정)
- **3-tier**: Application(BFF·API·워커·MCP) / Data(DB·Object storage). Presentation 계층은 MCP 도구로 대체.
- **외부 어댑터**는 별도 인터페이스(`MyDataAdapter`, `BankApiAdapter`, `OpenBankingAdapter`, `HometaxAdapter`, `PGExtractor`)로 추출하여 **실패·속도 차이를 격리**. 각 어댑터는 배치·호출 제한·캐시를 고려.
- **연동 전략 (P0-1)**: 직접 금융결제원 오픈뱅킹 이용기관 등록은 심사·자본금·보안 요건으로 **수개월~1년 소요**되므로, MVP는 **마이데이터 어댑터 + 은행계열 API 제휴 어댑터**를 1차 경로로 하고, 직접 오픈뱅킹 등록은 별도 트랙으로 편성한다. `Consent` 엔터티의 `type`에 **'mydata' 채널을 강조**한다.
- **PGExtractor (P2-6)**: '거래 무결성 검증'이 아닌 **'카드사/PG 정산 대조'** 기능으로 명확화한다. MVP에서는 정산 대조를 후순위로 두고, MVP 제외로 표시한다.
- **비동기 워커**: 거래 연동, OCR, 분류, 예측, 알림 발송을 **BullMQ(Redis)** 워커로 대기열 처리 → 동기 대시보드 요청에 집중.

### 3.1 금융데이터 처리 및 LLM 게이트웨이 지역 라우팅
- **금융거래·적요·영수증 이미지 등 금융 민감 정보는 국내 LLM 또는 국내 리전 VPC 내 자체 호스팅 모델로 처리**한다.
- **해외 LLM(GPT-4o/Claude)은 비식별화·가명처리 후에만 통과**시킨다.
- **LLM Gateway에 데이터 등급 기반 지역 라우팅 규칙을 구성**한다: 금융 민감 → 국내 강제. 데이터 등급(금융민감/개인/일반)에 따라 국내/해외 모델 라우팅을 결정한다.
- §1.1 OCR/ML 행, §4.1 L3 LLM, §6.1 OCR 이중화의 GPT-4o/Claude 언급도 이 원칙을 준수하도록 다듬는다.

---

## 4. AI 모델 설계

### 4.1 자동 분류 모델 (3단계 계단식)
- **L1 규칙**: 출처 정보(거래처·적요)를 장부 데이터(업종·거래처 사전)에 매핑 → 즉시 분류. 확신도가 낮으면 L2로 하강.
- **L2 로컬 임베딩 모델**: 사전 분류 이력(최근 분기)을 벡터화(embedding)하고 코사인 유사도로 후보 카테고리를 제시. 오프라인 추론.
- **L3 LLM**: `Transaction + 과거 문맥`을 프롬프트로 제공, LLM이 최종 판단 + **근거(justification)** 텍스트를 반환. 사용자에게 "왜 그 카테고리인지" 안내. (금융 민감 정보는 국내 LLM/자체 호스팅으로 처리, 해외 LLM은 비식별화 후 — §3.1 참조)
- **정확도 목표**: **자동 확정 ≥85%, 수동 수정 <15%**. 사용자가 수정하면 `Classification` 이력과 차이를 피드백 루프로 저장하고 재학습(L2) + LLM 프롬프트 갱신.

### 4.2 세금 예측 모델 (규칙 템플릿 × 시계열 하이브리드)
- **규칙 템플릿**: 세법 계산식(부가세 10%, 사업소득 표준소득률, 납세 구간 세율)을 **버전 관리 템플릿(TaxTemplate)** 으로 저장. 세법 변경 시 템플릿만 교체 → 일관된 기준과 높은 안정성.
- **시계열 보정**: LightGBM/Prophet이 과거 매출·비용 추이를 학습해 베이스 예측을 ±범위로 보정.
- **출력 = 신뢰 구간**: `lo(하한)~hi(상한)` + `confidence` — 사용자는 "최악/기대/최선"을 인지. 예측 정확성 검증을 위해 2025·2026 데이터 기준 샘플 평가를 지속 실시.

### 4.3 이상 거래 탐지 (Anomaly Detection)
- **IsolationForest**: 금액, 빈도, 시각, 패턴 등을 입력으로 정상 패턴 이탈 점수 산출.
- **LLM sanity check**: 이상으로 마킹된 거래에 대해 LLM이 "실제 이상/설명 가능한 거래(예: 연말 대금 결제, 내부 자금이체)"인지 검증 → false positive 억제.
- 확인된 이상 거래는 `Notification`으로 사용자에게 경고하고, 장부 확정 대상에서 잠정(hold) 처리하여 잘못된 반영을 방지.

---

## 5. 인프라 및 비용 추정 (Infra & Cost)

### 5.1 인프라 구성
- AWS ap-northeast-2(서울): EKS(또는 Fargate) 컨테이너(Front/Backend), RDS Aurora(PostgreSQL), ElastiCache(Redis), S3(미디어·OCR 원본, SSE-KMS), Lambda(크론/알림), WAF/GuardDuty/Secrets Manager, CloudWatch + Sentry.
- **분석 DB (P2-1)**: ClickHouse/Snowflake는 **후순위** — MVP는 **PostgreSQL 단일 DB**로 운영하고, 분석 DB는 **사용자 1만+ 시점**에 도입한다.

### 5.2 비용 항목(추정)
| 항목 | 산정 | 예상(월) |
|---|---|---|
| 오픈뱅킹 API | 금융결제원 요금: 가입/연결·API 호출별(일부 무료/과금 체계) | 연동량에 따라 변동, 수백만 원 수준까지 관리 필요 |
| LLM(하이브리드 분류/OCR) | GPT-4o/Claude VLM 호출 단위 | 초기 월 수십~수백만 원 |
| **LLM/OCR 단위경제 (P2-2)** | 1만 명 기준: 분류 건당 LLM 호출 ~0.3회, 사용자당 월 LLM 500~800원 + OCR 200~400원 | **사용자당 월 약 1,000원 추정** — 가격 티어(3~8만 원) 대비 마진 여유 확인 |
| CPU/GPU 학습 | SageMaker 훈련·추론 GPU | 학습 주기별 부담 |
| 클라우드/AWS | EKS/RDS/S3/ElastiCache/로그 | MVP 50~200만, 확장 후 수백만 원 |
| 홈택스 연동(수수료) | 국세청 엔티스 오픈API 이용수수료(수익자 부담) | 프리미엄 티어에 포함 → 사용자 부과 |
| 보안/모니터링 | WAF/GuardDuty/Sentry/개인정보보호 | 수십만 원 수준 |

- **MVP 기준**: 오픈뱅킹·OCR·분류·예측(개인) 기반까지 **월 200만~500만 원**으로 예상(근사치).
- **스케일업**: 사용자 1만~10만 명에 따라 API·LLM·계산 비용이 비례 상승 → 단계별 비율 조정(L1/L2 임베딩 방식으로 LLM 호출 감소) 및 캐시 강화로 비용을 관리.

---

## 6. 기술 리스크 대응 (Technical Risk Mitigation)

### 6.1 OCR 정확도
- 저화질/불규칙 영수증 실패 시 후보 모델(국내 LLM VLM 우선, 해외 VLM은 비식별화 후) 이중화로 복구. (금융 민감 정보는 국내 처리 강제 — §3.1 참조)
- 사용자 수정 피드백을 훈련 데이터로 재학습 → 정확도 지속 향상. 그래도 부족한 경우 사용자 수동 입력 UI를 강화.

### 6.2 세법 변경 버전 관리 (Tax Template)
- 세법 변경(예: 부가세율·VAT 전환, 소득세 구간) 시 TaxTemplate 버전 갱신으로 예측·신고서 계산을 **일원화**. 버전 갱신 절차: 세무사 감수 검토 → 승인 → 적용. 국세청 고시·공지 소스를 자동 반영하되 담당자가 검사.
- 2025.12 세무사법 개정 공포에 따른 신고대리 관련 사항도 템플릿에 반영하는 워크플로 구축.

### 6.3 정보보호(ISMS-P)
- 금융거래정보·개인정보 취약: **ISMS-P 인증 대응**(암호화, 접근통제, 로그·감사, 취약점 관리, 2차 인증).
- API 키(홈택스/오픈뱅킹)는 **Secrets Manager**에서 관리하고 주기적으로 교체.
- 마이데이터(개인신용정보)의 **제3자 제공·마케팅 금지**를 코드 레벨로 차단하여 컴플라이언스 준수. 보관기한·동의 최대 5년·재동의 체크 워크플로 자동화.

---

## 7. 요약
1. 표준 스택(Next/Nest/PostgreSQL 16/Redis) + 외부 어댑터(오픈뱅킹·홈택스·PG) + 비동기 워커로 **안정·확장 가능한 구조**.
2. AI 3단계 분류 + 규칙×시계열 하이브리드 예측(신뢰구간) + IsolationForest/LLM 이상 탐지로 **고정확도·검증 가능**, 자동 확정 ≥85%.
3. 데이터는 5년 보존·암호화·ISMS-P 대응, 세법 템플릿 버전 관리.
4. 비용은 API/LLM/OCR/AWS 항목별로 관리하고 단계별 스케일링 우선.

*본 문서는 아키텍처 설계 문서로, 실제 구현 전 정책·법률 검토와 상세 견적을 확정해야 합니다.*