import { corsOrigins } from './cors.config';

/**
 * CORS 제한 테스트.
 *
 * 1) CORS_ORIGINS 미설정 시 기본 localhost origin 목록.
 * 2) CORS_ORIGINS 콤마 구분 파싱.
 * 3) 와일드카드(*)는 허용하지 않는다 (origin 목록에 포함되지 않음).
 */
describe('corsOrigins', () => {
  const prev = process.env['CORS_ORIGINS'];

  afterEach(() => {
    if (prev === undefined) {
      delete process.env['CORS_ORIGINS'];
    } else {
      process.env['CORS_ORIGINS'] = prev;
    }
  });

  it('CORS_ORIGINS 미설정 시 기본 localhost origin 목록을 반환한다', () => {
    delete process.env['CORS_ORIGINS'];
    expect(corsOrigins()).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
    ]);
  });

  it('CORS_ORIGINS 콤마 구분 origin 목록을 파싱한다', () => {
    process.env['CORS_ORIGINS'] =
      'https://app.example.com, https://admin.example.com';
    expect(corsOrigins()).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('와일드카드(*)는 origin 목록에 포함되지 않는다', () => {
    process.env['CORS_ORIGINS'] = '*';
    const origins = corsOrigins();
    expect(origins).not.toContain('*');
  });
});
