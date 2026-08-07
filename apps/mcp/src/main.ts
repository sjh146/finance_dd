import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { McpServerModule } from './mcp-server.module';
import { McpServerService } from './mcp-server.service';

/**
 * .env.example에서 DATABASE_URL을 주입한다 (실제 .env는 읽지 않음).
 * 요구사항 3: "DATABASE_URL은 .env.example에서 주입, .env 미사용".
 *
 * 이미 process.env에 DATABASE_URL이 있으면 그대로 사용하고, 없으면
 * 루트 .env.example에서 추출해 설정한다.
 */
function loadDatabaseUrlFromEnvExample(): void {
  if (process.env['DATABASE_URL']) {
    return;
  }
  const envExamplePath = resolve(__dirname, '../../../.env.example');
  try {
    const content = readFileSync(envExamplePath, 'utf8');
    const match = /^DATABASE_URL=(.+)$/m.exec(content);
    if (match) {
      process.env['DATABASE_URL'] = match[1].trim();
    } else {
      console.error(
        '[mcp] .env.example에서 DATABASE_URL을 찾을 수 없습니다. DB 도구는 오류를 반환합니다.',
      );
    }
  } catch (e) {
    console.error(
      '[mcp] .env.example을 읽지 못했습니다:',
      (e as Error).message,
    );
  }
}

/**
 * MCP_API_KEY가 환경변수에 설정되어 있는지 확인한다.
 * 없으면 하드코딩/기본값으로 폴백하지 않고 명확한 에러로 시작을 거부한다.
 */
export function assertMcpApiKeyConfigured(): void {
  if (!process.env['MCP_API_KEY']) {
    throw new Error(
      'MCP_API_KEY is not set. Set MCP_API_KEY in the environment before starting the MCP server.',
    );
  }
}

/**
 * MCP 서버 부트스트랩.
 *
 * NestFactory.createApplicationContext로 NestJS 애플리케이션 컨텍스트를
 * 생성해 기존 도메인 서비스(분류·예측·체크리스트·OCR·어댑터·LLM)를 주입받고,
 * McpServerService가 stdio transport로 MCP 서버를 실행한다.
 */
async function bootstrap(): Promise<void> {
  loadDatabaseUrlFromEnvExample();
  assertMcpApiKeyConfigured();

  const app = await NestFactory.createApplicationContext(McpServerModule, {
    logger: ['error', 'warn'],
  });

  const mcp = app.get(McpServerService);
  await mcp.run();
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error('[mcp] MCP 서버 부팅 실패:', e);
    process.exit(1);
  });
}
