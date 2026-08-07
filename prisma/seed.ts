// 아끼로그 (AggeLog) — seed script for smoke testing.
// Creates: 1 Member, 1 Business, 1 Consent (mydata), 1 Ledger, a few
// Transactions, a Voucher with VoucherLines, a Classification (L1),
// a TaxPrediction (VAT), a Filing, and a Notification.
//
// Fully idempotent: re-running `npx prisma db seed` succeeds without
// duplicates. Entities with natural unique keys use `upsert`; the rest use
// a findFirst-then-create (skip-if-exists) pattern keyed on stable fields.
//
// Run: npx prisma db seed   (wired via prisma.config.ts migrations.seed)
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
}

const adapter = new PrismaPg(databaseUrl);
const prisma = new PrismaClient({ adapter });

// 시드 회원 apiKey 결정 로직:
//   - 환경변수 SEED_API_KEY 가 있으면 그 값을 사용 (개발용 고정값 원할 때).
//   - 없으면 crypto.randomBytes 로 랜덤 생성 (운영 기본값).
// 생성된 키는 콘솔에 출력해 사용자/테스트가 확인할 수 있게 한다.
function resolveSeedApiKey(): string {
  const fromEnv = process.env['SEED_API_KEY'];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return randomBytes(32).toString('hex');
}

async function main() {
  // --- Member (unique: oidcSub) ---
  // apiKey: MVP API 키 인증용. 시드 회원은 SEED_API_KEY(설정 시) 또는 랜덤 키를
  // 부여해 스모크 테스트가 X-API-Key 헤더로 인증할 수 있게 한다.
  // upsert: 이미 존재하는 멤버면 기존 apiKey 를 유지하고, 신규면 랜덤 키를 부여한다.
  const seedApiKey = resolveSeedApiKey();
  const existingMember = await prisma.member.findUnique({
    where: { oidcSub: 'seed-oidc-sub-0001' },
    select: { apiKey: true },
  });
  const memberApiKey = existingMember ? existingMember.apiKey : seedApiKey;

  const member = await prisma.member.upsert({
    where: { oidcSub: 'seed-oidc-sub-0001' },
    update: {},
    create: {
      oidcSub: 'seed-oidc-sub-0001',
      name: '김아끼',
      contact: 'kim@example.com',
      apiKey: memberApiKey,
    },
  });

  // --- Business (unique: bizNo) ---
  const business = await prisma.business.upsert({
    where: { bizNo: '123-45-67890' },
    update: {},
    create: {
      memberId: member.id,
      bizNo: '123-45-67890',
      name: '아끼로그 스튜디오',
      industry: '소프트웨어 개발',
      type: '개인',
      scale: '소기업',
    },
  });

  // --- Consent (unique: [memberId, type, scope]) — mydata channel emphasized ---
  const consent = await prisma.consent.upsert({
    where: {
      memberId_type_scope: {
        memberId: member.id,
        type: 'mydata',
        scope: 'banking:read card:read',
      },
    },
    update: {},
    create: {
      memberId: member.id,
      type: 'mydata',
      scope: 'banking:read card:read',
      status: 'ACTIVE',
      grantedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2030-12-31T00:00:00Z'), // <= 5Y
      source: 'mydata-aggregator',
    },
  });

  // --- Ledger (unique: [businessId, period, type]) ---
  const ledger = await prisma.ledger.upsert({
    where: {
      businessId_period_type: {
        businessId: business.id,
        period: '2026-Q1',
        type: 'QUARTERLY',
      },
    },
    update: {},
    create: {
      businessId: business.id,
      period: '2026-Q1',
      type: 'QUARTERLY',
      status: 'OPEN',
      closedYn: false,
    },
  });

  // --- Transactions (finNo is a stable identifier, not unique → findFirst-then-create) ---
  let txn1 = await prisma.transaction.findFirst({ where: { finNo: 'FIN-0001' } });
  if (!txn1) {
    txn1 = await prisma.transaction.create({
      data: {
        ledgerId: ledger.id,
        bankAcct: '110-123-456789',
        finNo: 'FIN-0001',
        amount: 5500000,
        occurredAt: new Date('2026-01-15T09:00:00Z'),
        summary: '고객사 개발 용역 대금',
        provider: 'MYDATA',
        sensitivity: 'FINANCIAL_SENSITIVE',
      },
    });
  }

  let txn2 = await prisma.transaction.findFirst({ where: { finNo: 'FIN-0002' } });
  if (!txn2) {
    txn2 = await prisma.transaction.create({
      data: {
        ledgerId: ledger.id,
        cardAcct: '카드-****-1234',
        finNo: 'FIN-0002',
        amount: -320000,
        occurredAt: new Date('2026-01-20T12:00:00Z'),
        summary: 'AWS 클라우드 인프라 비용',
        provider: 'CARD',
        sensitivity: 'FINANCIAL_SENSITIVE',
      },
    });
  }

  // --- Voucher (no natural unique key → findFirst-then-create) ---
  let voucher = await prisma.voucher.findFirst({
    where: { ledgerId: ledger.id, date: new Date('2026-01-31T00:00:00Z'), source: 'OPENBANK' },
  });
  if (!voucher) {
    voucher = await prisma.voucher.create({
      data: {
        ledgerId: ledger.id,
        date: new Date('2026-01-31T00:00:00Z'),
        status: 'PROVISIONAL',
        source: 'OPENBANK',
        transactions: { connect: [{ id: txn1.id }, { id: txn2.id }] },
      },
    });
  }

  // --- VoucherLines (findFirst-then-create keyed on [voucherId, account, side]) ---
  let line1 = await prisma.voucherLine.findFirst({
    where: { voucherId: voucher.id, account: '매출', side: 'DEBIT' },
  });
  if (!line1) {
    line1 = await prisma.voucherLine.create({
      data: {
        voucherId: voucher.id,
        account: '매출',
        debit: 5500000,
        credit: 0,
        amount: 5500000,
        side: 'DEBIT',
        sensitivity: 'FINANCIAL_SENSITIVE',
      },
    });
  }

  let line2 = await prisma.voucherLine.findFirst({
    where: { voucherId: voucher.id, account: '지급수수료', side: 'CREDIT' },
  });
  if (!line2) {
    line2 = await prisma.voucherLine.create({
      data: {
        voucherId: voucher.id,
        account: '지급수수료',
        debit: 0,
        credit: 320000,
        amount: 320000,
        side: 'CREDIT',
        sensitivity: 'FINANCIAL_SENSITIVE',
      },
    });
  }

  // --- Classification (L1 rule) — findFirst-then-create keyed on [voucherId, lineId, level] ---
  const existingClassification = await prisma.classification.findFirst({
    where: { voucherId: voucher.id, lineId: line1.id, level: 'L1' },
  });
  if (!existingClassification) {
    await prisma.classification.create({
      data: {
        voucherId: voucher.id,
        lineId: line1.id,
        level: 'L1',
        model: 'rule:industry-dictionary',
        confidence: 0.97,
        justification: '적요 "개발 용역 대금"이 업종 사전(소프트웨어 개발)과 매핑되어 매출로 분류',
      },
    });
  }

  // --- TaxPrediction (VAT, 2026-Q1, due 2026-04-25) — findFirst-then-create keyed on [businessId, taxType, period] ---
  const existingPrediction = await prisma.taxPrediction.findFirst({
    where: { businessId: business.id, taxType: 'VAT', period: '2026-Q1' },
  });
  if (!existingPrediction) {
    await prisma.taxPrediction.create({
      data: {
        businessId: business.id,
        taxType: 'VAT',
        period: '2026-Q1',
        lo: 480000,
        hi: 560000,
        base: 5500000,
        model: 'template:vat-10pct-v1',
        dueDate: new Date('2026-04-25T00:00:00Z'), // 부가세 1분기 신고기한 4/25
      },
    });
  }

  // --- Filing (VAT draft) — findFirst-then-create keyed on [businessId, taxType, period] ---
  const existingFiling = await prisma.filing.findFirst({
    where: { businessId: business.id, taxType: 'VAT', period: '2026-Q1' },
  });
  if (!existingFiling) {
    await prisma.filing.create({
      data: {
        businessId: business.id,
        taxType: 'VAT',
        period: '2026-Q1',
        draftJson: { supplyValue: 5500000, vat: 550000 },
        status: 'DRAFT',
      },
    });
  }

  // --- Notification (납부 알림) — findFirst-then-create keyed on [memberId, kind, title] ---
  const existingNotification = await prisma.notification.findFirst({
    where: {
      memberId: member.id,
      kind: 'PAYMENT',
      title: '부가가치세 1분기 신고기한 임박',
    },
  });
  if (!existingNotification) {
    await prisma.notification.create({
      data: {
        memberId: member.id,
        kind: 'PAYMENT',
        channel: 'IN_APP',
        title: '부가가치세 1분기 신고기한 임박',
        body: '2026-Q1 부가세 신고기한은 2026-04-25입니다.',
        sentAt: new Date('2026-04-20T09:00:00Z'),
      },
    });
  }

  console.log('Seed complete.');
  console.log({ member: member.id, business: business.id, consent: consent.id, ledger: ledger.id, voucher: voucher.id });
  console.log(`Seed member apiKey: ${member.apiKey}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
