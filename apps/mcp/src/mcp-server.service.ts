import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClassificationPipelineService } from '@aggelog/api/classification/classification-pipeline.service';
import { ClosingChecklistService } from '@aggelog/api/closing/closing-checklist.service';
import { OcrService } from '@aggelog/api/ocr/ocr.service';
import { TaxPredictionService } from '@aggelog/api/prediction/tax-prediction.service';
import { TransactionAdapterFactory } from '@aggelog/api/adapters/transaction-adapter.factory';
import { RegionalRoutingPolicy } from '@aggelog/api/llm/regional-routing.policy';
import { PrismaService } from '@aggelog/api/prisma/prisma.service';
import { registerTools } from './tools/tools';
import { TOOL_NAMES } from './tools/schemas';
import { McpAuthContext, resolveAuthContext } from './auth-context';

/**
 * McpServerService — MCP 서버를 구성하고 stdio transport로 연결한다.
 *
 * - NestJS 도메인 서비스(분류·예측·체크리스트·OCR·어댑터·LLM)를 주입받아
 *   도구 핸들러에서 직접 호출한다 (TECH_ARCHITECTURE.md §3 v2.1).
 * - `build()`는 테스트에서 transport 없이 도구 등록만 검증할 수 있게
 *   McpServer 인스턴스를 반환한다.
 * - `run()`은 실제 stdio transport를 연결해 Hermes 등 MCP 클라이언트와
 *   통신한다.
 */
@Injectable()
export class McpServerService implements OnModuleDestroy {
  private server: McpServer | null = null;
  private authContext: McpAuthContext = { memberId: null, authenticated: false };

  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ClassificationPipelineService,
    private readonly closing: ClosingChecklistService,
    private readonly ocr: OcrService,
    private readonly prediction: TaxPredictionService,
    private readonly adapters: TransactionAdapterFactory,
    private readonly routing: RegionalRoutingPolicy,
  ) {}

  /**
   * McpServer 인스턴스를 생성하고 모든 도구를 등록한다.
   * transport 연결은 하지 않는다 (테스트에서 도구 스키마 검증에 사용).
   */
  async build(): Promise<McpServer> {
    // 서버 시작 시 1회 인증 (MCP_API_KEY로 호출자 식별).
    this.authContext = await resolveAuthContext(this.prisma);

    const server = new McpServer({
      name: 'aggelog-mcp',
      version: '0.1.0',
    });

    registerTools(server, {
      prisma: this.prisma,
      classification: this.classification,
      closing: this.closing,
      ocr: this.ocr,
      prediction: this.prediction,
      adapters: this.adapters,
      routing: this.routing,
      auth: this.authContext,
    });

    this.server = server;
    return server;
  }

  /** 등록된 도구 이름 목록 (테스트/검증용). */
  getToolNames(): readonly string[] {
    return TOOL_NAMES;
  }

  /**
   * stdio transport로 MCP 서버를 실행한다. Hermes 등 MCP 클라이언트가
   * stdin/stdout을 통해 이 프로세스와 통신한다.
   */
  async run(): Promise<void> {
    const server = await this.build();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }
}
