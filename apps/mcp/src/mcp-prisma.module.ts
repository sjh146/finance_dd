import { Global, Module } from '@nestjs/common';
import { PrismaService } from '@aggelog/api/prisma/prisma.service';
import { McpPrismaService } from './mcp-prisma.service';

/**
 * McpPrismaModule — MCP 컨텍스트 전용 @Global Prisma 모듈.
 *
 * API의 PrismaModule은 @Global로 PrismaService를 제공하지만, DB 미가동 시
 * onModuleInit의 $connect()가 실패해 컨텍스트 부팅을 막는다. 이 모듈은
 * PrismaService 토큰을 DB 미가동에도 부팅되는 McpPrismaService로 대체해
 * 전역에 제공한다. 도구 호출 시점에 명확한 오류를 반환한다.
 */
@Global()
@Module({
  providers: [{ provide: PrismaService, useClass: McpPrismaService }],
  exports: [PrismaService],
})
export class McpPrismaModule {}
