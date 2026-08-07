import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ApiKeyGuard 테스트.
 *
 * 1) 공개 엔드포인트(/health, /api/domain/health)는 인증 없이 통과.
 * 2) X-API-Key 헤더 누락 시 401.
 * 3) 유효하지 않은 API 키 시 401.
 * 4) 유효한 API 키 시 통과 + request.authMemberId 주입.
 */
describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: { member: { findUnique: jest.Mock } };

  function makeContext(
    path: string,
    header?: string,
  ): {
    context: any;
    request: { path: string; header: jest.Mock; authMemberId?: string };
  } {
    const request = {
      path,
      header: jest.fn().mockReturnValue(header),
      authMemberId: undefined,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };
    return { context, request };
  }

  beforeEach(async () => {
    prisma = {
      member: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    guard = module.get(ApiKeyGuard);
  });

  it('공개 엔드포인트 /health는 인증 없이 통과한다', async () => {
    const { context } = makeContext('/health');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('공개 엔드포인트 /api/domain/health는 인증 없이 통과한다', async () => {
    const { context } = makeContext('/api/domain/health');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('X-API-Key 헤더 누락 시 401을 던진다', async () => {
    const { context } = makeContext('/api/pipeline/run');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('유효하지 않은 API 키 시 401을 던진다', async () => {
    prisma.member.findUnique.mockResolvedValue(null);
    const { context } = makeContext('/api/pipeline/run', 'invalid-key');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('유효한 API 키 시 통과하고 request.authMemberId를 주입한다', async () => {
    prisma.member.findUnique.mockResolvedValue({ id: 'member-1' });
    const { context, request } = makeContext(
      '/api/pipeline/run',
      'valid-key',
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authMemberId).toBe('member-1');
  });
});
