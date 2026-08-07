import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 테스트 환경에서 DATABASE_URL을 .env.example에서 주입한다 (실제 .env는 읽지 않음).
// PrismaService 생성자는 DATABASE_URL 문자열을 요구하므로, DB가 실제로
// 실행 중이 아니어도 URL만 설정하면 컨텍스트가 부팅된다.
if (!process.env['DATABASE_URL']) {
  const envExamplePath = resolve(__dirname, '../../../.env.example');
  try {
    const content = readFileSync(envExamplePath, 'utf8');
    const match = /^DATABASE_URL=(.+)$/m.exec(content);
    if (match) {
      process.env['DATABASE_URL'] = match[1].trim();
    }
  } catch {
    // .env.example이 없으면 DATABASE_URL 미설정 — PrismaService가 명확한 오류를 던진다.
  }
}
