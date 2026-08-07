/**
 * smoke-api-key.ts — helper for the smoke test.
 *
 * Queries the seeded DB (via Prisma) for the seed member's api_key, and prints
 * it on stdout. This lets the smoke test authenticate without depending on a
 * committed SEED_API_KEY in .env.example (the seed now generates a random key
 * when SEED_API_KEY is empty).
 *
 * Reads DATABASE_URL from the environment (the smoke test injects it from
 * .env.example). No real .env is read.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/smoke-api-key.ts
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
  const member = await prisma.member.findUnique({
    where: { oidcSub: 'seed-oidc-sub-0001' },
    select: { apiKey: true },
  });
  if (!member || !member.apiKey) {
    throw new Error('Seeded member not found (oidcSub=seed-oidc-sub-0001). Run seed first.');
  }
  console.log(member.apiKey);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
