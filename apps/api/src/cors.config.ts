/**
 * CORS 허용 origin 목록을 CORS_ORIGINS 환경변수(콤마 구분)에서 읽는다.
 * 기본값은 localhost 개발 origin. 와일드카드(*)는 허용하지 않는다.
 */
export function corsOrigins(): string[] {
  const raw = process.env['CORS_ORIGINS'];
  if (!raw) {
    return ['http://localhost:3000', 'http://localhost:3001'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((origin) => origin !== '*');
}
