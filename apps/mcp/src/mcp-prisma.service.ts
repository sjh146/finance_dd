import { Injectable } from '@nestjs/common';
import { PrismaService } from '@aggelog/api/prisma/prisma.service';

/**
 * McpPrismaService — PrismaService 변형으로, DB가 없어도 MCP 컨텍스트가
 * 부팅되도록 onModuleInit의 $connect() 실패를 삼킨다.
 *
 * 실제 도구 호출 시 Prisma 쿼리가 실패하면 명확한 오류 메시지로 변환되어
 * 클라이언트(Hermes)에 반환된다 (요구사항 3: "DB가 없어도 도구가 오류를
 * 명확히 반환하도록 처리").
 */
@Injectable()
export class McpPrismaService extends PrismaService {
  override async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (e) {
      // DB 미가동 — 컨텍스트는 계속 부팅. 도구 호출 시점에 명확한 오류 반환.
      console.error(
        '[mcp] DB 연결 실패 (도구 호출 시 명확한 오류를 반환합니다):',
        (e as Error).message,
      );
    }
  }
}
