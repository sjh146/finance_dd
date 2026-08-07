import { Module } from '@nestjs/common';
import { ClassificationModule } from '@aggelog/api/classification/classification.module';
import { PredictionModule } from '@aggelog/api/prediction/prediction.module';
import { ClosingModule } from '@aggelog/api/closing/closing.module';
import { OcrModule } from '@aggelog/api/ocr/ocr.module';
import { AdaptersModule } from '@aggelog/api/adapters/adapters.module';
import { LlmModule } from '@aggelog/api/llm/llm.module';
import { McpPrismaModule } from './mcp-prisma.module';
import { McpServerService } from './mcp-server.service';

/**
 * McpServerModule — MCP 서버 전용 NestJS 모듈.
 *
 * 기존 도메인 모듈(분류·예측·체크리스트·OCR·어댑터·LLM)을 import하고,
 * McpPrismaModule이 PrismaService를 DB 미가동에도 부팅되는 McpPrismaService로
 * 전역 제공한다. McpServerService가 도구를 등록하고 stdio transport를 연결한다.
 */
@Module({
  imports: [
    McpPrismaModule,
    ClassificationModule,
    PredictionModule,
    ClosingModule,
    OcrModule,
    AdaptersModule,
    LlmModule,
  ],
  providers: [McpServerService],
  exports: [McpServerService],
})
export class McpServerModule {}
