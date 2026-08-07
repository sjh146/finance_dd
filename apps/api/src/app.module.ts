import { Module } from '@nestjs/common';
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
  ],
  controllers: [AppController, DomainHealthController],
  providers: [AppService],
})
export class AppModule {}
