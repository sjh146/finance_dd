import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeyGuard } from './api-key.guard';

/**
 * AuthModule — API 키 인증 가드를 제공한다.
 * PrismaModule을 import해 가드가 Member 테이블에서 apiKey를 조회한다.
 */
@Module({
  imports: [PrismaModule],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class AuthModule {}
