// Vercel 빌드 때만 쓰는 스크립트: 환경 변수에 공개 키가 있으면 config.js 의 빈 따옴표를 채운다.
// 독자는 이 스크립트를 몰라도 된다(환경 변수가 없으면 아무것도 바꾸지 않는다).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isSecretKey } = require('../menu.js');
const file = new URL('../config.js', import.meta.url);
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('config.js: 환경 변수 없음, 그대로 둠');
} else if (isSecretKey(SUPABASE_ANON_KEY)) {
  console.error('config.js: 비밀 키는 넣을 수 없습니다. 공개 키(publishable/anon)로 바꾸세요.');
  process.exit(1);
} else {
  const src = readFileSync(file, 'utf8')
    .replace("SUPABASE_URL: ''", `SUPABASE_URL: '${SUPABASE_URL}'`)
    .replace("SUPABASE_ANON_KEY: ''", `SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}'`);
  writeFileSync(file, src);
  console.log('config.js: 환경 변수로 채움');
}
