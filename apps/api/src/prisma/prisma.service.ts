import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PrismaService — injectable PrismaClient wired with the PrismaPg driver
 * adapter (Prisma 7 requirement). Reads DATABASE_URL from the environment.
 *
 * Extends PrismaClient so the full generated client API is available to any
 * consumer via DI. Lifecycle hooks connect on module init and disconnect on
 * shutdown.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required. Copy .env.example to .env and set DATABASE_URL.',
      );
    }
    const adapter = new PrismaPg(databaseUrl);
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
