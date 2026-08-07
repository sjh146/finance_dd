import { PrismaService } from '@aggelog/api/prisma/prisma.service';

/**
 * MCP 인증 컨텍스트.
 *
 * stdio 서버이므로 서버 시작 시 1회 인증한다. `MCP_API_KEY` 환경변수(또는
 * API 키 파일)로 호출자를 식별하고, 해당 키로 Member를 조회해 인증된
 * memberId를 결정한다. 모든 도구 핸들러는 이 컨텍스트로 소유권을 검증한다.
 */
export interface McpAuthContext {
  /** 인증된 회원 ID. 인증 실패 시 null. */
  memberId: string | null;
  /** 인증 여부. */
  authenticated: boolean;
}

/**
 * MCP_API_KEY 환경변수에서 인증 컨텍스트를 해석한다.
 *
 * - MCP_API_KEY가 없으면 인증되지 않은 컨텍스트를 반환한다 (도구는 401).
 * - MCP_API_KEY가 있으면 해당 키로 Member를 조회해 memberId를 결정한다.
 *   키가 유효하지 않으면 인증되지 않은 컨텍스트를 반환한다.
 */
export async function resolveAuthContext(
  prisma: PrismaService,
): Promise<McpAuthContext> {
  const apiKey = process.env['MCP_API_KEY'];
  if (!apiKey) {
    return { memberId: null, authenticated: false };
  }

  try {
    const member = await prisma.member.findUnique({
      where: { apiKey },
      select: { id: true },
    });
    if (!member) {
      return { memberId: null, authenticated: false };
    }
    return { memberId: member.id, authenticated: true };
  } catch {
    // DB 미가동 — 인증 불가.
    return { memberId: null, authenticated: false };
  }
}

/**
 * businessId가 인증된 회원 소유인지 확인한다.
 * 소유가 아니면 false를 반환한다.
 */
export async function isBusinessOwnedBy(
  prisma: PrismaService,
  businessId: string,
  memberId: string,
): Promise<boolean> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { memberId: true },
  });
  return !!business && business.memberId === memberId;
}

/**
 * ledgerId가 인증된 회원 소유인지 확인한다.
 * 장부 → 사업체 → 회원 경로로 소유권을 검증한다.
 */
export async function isLedgerOwnedBy(
  prisma: PrismaService,
  ledgerId: string,
  memberId: string,
): Promise<boolean> {
  const ledger = await prisma.ledger.findUnique({
    where: { id: ledgerId },
    select: { business: { select: { memberId: true } } },
  });
  return !!ledger && ledger.business.memberId === memberId;
}
