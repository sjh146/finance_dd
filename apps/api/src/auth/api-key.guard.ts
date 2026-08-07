import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ApiKeyGuard — MVP API 키 인증 가드.
 *
 * `X-API-Key` 헤더(API_KEY_HEADER 환경변수로 변경 가능)를 검증해 요청에
 * 인증된 memberId를 주입한다. 공개 엔드포인트(/health, /api/domain/health)는
 * 제외한다.
 *
 * 인증 성공 시 request.authMemberId에 memberId를 설정한다.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly headerName: string;

  constructor(private readonly prisma: PrismaService) {
    this.headerName = process.env['API_KEY_HEADER'] ?? 'X-API-Key';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // 공개 엔드포인트는 인증 없이 통과.
    if (this.isPublic(request)) {
      return true;
    }

    const apiKey = request.header(this.headerName);
    if (!apiKey) {
      throw new UnauthorizedException(
        `Missing ${this.headerName} header. Provide a valid API key.`,
      );
    }

    const member = await this.prisma.member.findUnique({
      where: { apiKey },
      select: { id: true },
    });
    if (!member) {
      throw new UnauthorizedException('Invalid API key.');
    }

    // 인증된 memberId를 요청에 주입 (컨트롤러/서비스에서 사용).
    (request as Request & { authMemberId?: string }).authMemberId = member.id;
    return true;
  }

  private isPublic(request: Request): boolean {
    const path = request.path;
    return path === '/health' || path === '/api/domain/health';
  }
}
