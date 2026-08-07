import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * AuthMemberId — ApiKeyGuard가 주입한 인증된 memberId를 파라미터로 추출한다.
 *
 * 사용: `@AuthMemberId() memberId: string`
 */
export const AuthMemberId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request & { authMemberId?: string }>();
    return request.authMemberId ?? '';
  },
);
