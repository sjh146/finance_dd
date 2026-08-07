/**
 * pipeline-smoke-ids.ts — helper for the smoke test.
 *
 * Queries the seeded DB (via Prisma) for the business/ledger/consent ids used
 * by the pipeline smoke stage, and prints them as JSON on stdout.
 *
 * Reads DATABASE_URL from the environment (the smoke test injects it from
 * .env.example). No real .env is read.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/pipeline-smoke-ids.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const adapter = new PrismaPg(databaseUrl);
const prisma = new PrismaClient({ adapter });

async function main() {
  const business = await prisma.business.findUnique({
    where: { bizNo: '123-45-67890' },
  });
  if (!business) {
    throw new Error('Seeded business not found (bizNo=123-45-67890). Run seed first.');
  }

  const ledger = await prisma.ledger.findFirst({
    where: { businessId: business.id, period: '2026-Q1' },
  });
  if (!ledger) {
    throw new Error('Seeded ledger not found (2026-Q1). Run seed first.');
  }

  const consent = await prisma.consent.findFirst({
    where: { memberId: business.memberId, type: 'mydata' },
  });
  if (!consent) {
    throw new Error('Seeded mydata consent not found. Run seed first.');
  }

  console.log(
    JSON.stringify({
      businessId: business.id,
      ledgerId: ledger.id,
      memberId: business.memberId,
      consent: {
        id: consent.id,
        type: consent.type,
        scope: consent.scope,
        status: consent.status,
      },
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
