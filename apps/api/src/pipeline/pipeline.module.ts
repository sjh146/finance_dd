import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdaptersModule } from '../adapters/adapters.module';
import { OcrModule } from '../ocr/ocr.module';
import { ClassificationModule } from '../classification/classification.module';
import { PredictionModule } from '../prediction/prediction.module';
import { ClosingModule } from '../closing/closing.module';
import {
  QUEUE_CLASSIFY,
  QUEUE_INGEST,
  QUEUE_NOTIFY,
  QUEUE_OCR,
  QUEUE_PREDICT,
  redisConnection,
} from './pipeline.constants';
import { IngestProcessor } from './ingest.processor';
import { OcrProcessor } from './ocr.processor';
import { ClassifyProcessor } from './classify.processor';
import { PredictProcessor } from './predict.processor';
import { NotifyProcessor } from './notify.processor';
import { PipelineOrchestratorService } from './pipeline-orchestrator.service';
import { PipelineController } from './pipeline.controller';

/**
 * PipelineModule — BullMQ worker pipeline (TECH §3).
 *
 * Registers the 5 queues (ingest -> ocr -> classify -> predict -> notify) with
 * a shared Redis connection (REDIS_URL, default localhost:6379) and wires the
 * worker processors + the orchestrator + the REST controller.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: redisConnection(),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_INGEST },
      { name: QUEUE_OCR },
      { name: QUEUE_CLASSIFY },
      { name: QUEUE_PREDICT },
      { name: QUEUE_NOTIFY },
    ),
    AdaptersModule,
    OcrModule,
    ClassificationModule,
    PredictionModule,
    ClosingModule,
  ],
  controllers: [PipelineController],
  providers: [
    IngestProcessor,
    OcrProcessor,
    ClassifyProcessor,
    PredictProcessor,
    NotifyProcessor,
    PipelineOrchestratorService,
  ],
  exports: [PipelineOrchestratorService],
})
export class PipelineModule {}
