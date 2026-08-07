import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AdaptersModule } from './adapters/adapters.module';
import { OcrModule } from './ocr/ocr.module';
import { ClassificationModule } from './classification/classification.module';
import { PredictionModule } from './prediction/prediction.module';
import { ClosingModule } from './closing/closing.module';
import { LlmModule } from './llm/llm.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { DomainHealthController } from './domain-health.controller';
import { AuthModule } from './auth/auth.module';
import { ApiKeyGuard } from './auth/api-key.guard';

@Module({
  imports: [
    PrismaModule,
    AdaptersModule,
    OcrModule,
    ClassificationModule,
    PredictionModule,
    ClosingModule,
    LlmModule,
    PipelineModule,
    AuthModule,
  ],
  controllers: [AppController, DomainHealthController],
  providers: [
    AppService,
    // 전역 API 키 인증 가드 (공개 엔드포인트 /health, /api/domain/health 제외).
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
