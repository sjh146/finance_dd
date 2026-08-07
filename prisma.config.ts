// Prisma 7 configuration (replaces datasource `url` in schema.prisma).
// Loads DATABASE_URL from the root .env and wires the seed command.
import 'dotenv/config';
import { defineConfig } from '@prisma/config';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required. Copy .env.example to .env and set DATABASE_URL.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
