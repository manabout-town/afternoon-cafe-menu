import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, Menu } from './_helpers.mjs';

const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const tracked = () => execSync('git ls-files', { cwd: ROOT }).toString().trim().split('\n');
const TEXT = /\.(html|js|mjs|css|sql|md|json|txt)$/;

test('필수 파일', () => {
  for (const f of ['index.html', 'style.css', 'menu.js', 'config.js', 'menu-backup.js', 'admin/index.html',
    'tools/import-csv.html', 'tools/security-check.html', 'tools/pin-demo.html', 'qr/card-a6.html',
    'supabase/setup.sql', 'supabase/add-owner.sql', 'supabase/pin-demo.sql',
    'steps/01-first10/menu-backup.js', 'steps/02-config/config.js', 'steps/04-pin-bypass/console.js', 'steps/README.md',
    'prompts.md', 'README.md', 'vercel.json', '.vercelignore', 'images/menu-1.jpg']) assert.ok(existsSync(path.join(ROOT, f)), f);
});

test('비밀 값이 저장소에 없다', () => {
  const files = tracked();
  assert.equal(files.some(f => f.startsWith('.env')), false, '.env 파일이 커밋됨');
  // tests/ 는 가짜 secret-키 문자열을 UI 검증용 픽스처로 일부러 쓴다(예: 'sb_secret_test') — 실제 유출이 아니라 스캔 대상에서 뺀다.
  for (const f of files.filter(f => TEXT.test(f) && !f.startsWith('tests/'))) {
    const t = read(f);
    assert.doesNotMatch(t, /sb_secret_[A-Za-z0-9]/, f);
    for (const jwt of t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) || []) assert.equal(Menu.isSecretKey(jwt), false, `${f}: service_role 키`);
  }
});

test('연락처가 저장소에 없다', () => {
  for (const f of tracked().filter(f => TEXT.test(f))) {
    const t = read(f);
    assert.doesNotMatch(t, /01[016789]-?\d{3,4}-?\d{4}/, f);
    assert.doesNotMatch(t, /[\w.-]+@[\w-]+\.[a-z]{2,}\b/i, f);
  }
});

test('저장소의 config.js는 빈 값(첫 10분은 DB 없이)', () => {
  assert.match(read('config.js'), /SUPABASE_URL: '',\n  SUPABASE_ANON_KEY: '',/);
});

test('첫 10분 결과: 메뉴 3개, JSON으로 읽힘', () => {
  const b = Menu.parseBackupJs(read('steps/01-first10/menu-backup.js'));
  assert.equal(b.items.length, 3);
});

test('menu-backup.js 샘플 = setup.sql 샘플(이름·가격·품절)', () => {
  const sql = [...read('supabase/setup.sql').matchAll(/\('(?:커피|음료|디저트)', '([^']+)', '[^']*', (\d+), '[^']*', (?:null|'[^']*'), (true|false), \d\)/g)]
    .map(m => `${m[1]}/${m[2]}/${m[3]}`).sort();
  const js = Menu.parseBackupJs(read('menu-backup.js')).items.map(i => `${i.name}/${i.price}/${i.sold_out}`).sort();
  assert.equal(sql.length, 6);
  assert.deepEqual(js, sql);
});

test('prompts.md 지시문 6개', () => {
  const md = read('prompts.md');
  assert.equal([...md.slice(md.indexOf('## 지시문')).matchAll(/### [^\n]+\n```\n[\s\S]*?```/g)].length, 6);
});

test('README 사용 조건', () => {
  const t = read('README.md');
  assert.match(t, /재판매/);
  assert.match(t, /비밀 키/);
});

test('vercel.json: 빌드 때 설정 주입', () => {
  assert.equal(JSON.parse(read('vercel.json')).buildCommand, 'node scripts/write-config.mjs');
});
