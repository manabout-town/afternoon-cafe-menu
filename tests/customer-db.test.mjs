import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium, ROOT, serve, configJs, loadEnv, rest, login } from './_helpers.mjs';

const env = loadEnv();
let browser, server;
before(async () => { browser = await chromium.launch(); server = await serve(); });
after(async () => { await browser.close(); server.close(); });

async function open({ config = configJs(env), routes = [] } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: config }));
  for (const [pattern, handler] of routes) await page.route(pattern, handler);
  await page.goto(server.url + '/');
  await page.waitForSelector('body[data-source]', { timeout: 15000 });
  return page;
}

test('DB 모드: 안내 문구 없이 DB 메뉴를 보여 준다', async () => {
  const page = await open();
  assert.equal(await page.getAttribute('body', 'data-source'), 'db');
  assert.equal(await page.isHidden('#notice'), true);
  assert.equal(await page.$$eval('li.item', l => l.length) >= 6, true);
  await page.close();
});

test('영어 모드에서도 이미지 alt가 보이는 이름과 같은 라벨을 쓴다', async () => {
  const page = await open();
  await page.click('#lang');
  const img = page.locator('li.item img').first();
  const alt = await img.getAttribute('alt');
  const name = await img.locator('xpath=../div/div/h3').textContent();
  assert.equal(alt, name);
  await page.close();
});

test('사장님이 품절로 바꾸면 손님 화면에 반영된다(새로 고침 후)', async () => {
  const owner = rest(env, await login(env, env.OWNER_EMAIL, env.OWNER_PASSWORD));
  const item = (await owner('GET', 'acm_menu_items?name=eq.아메리카노&select=*')).data[0];
  try {
    await owner('PATCH', `acm_menu_items?id=eq.${item.id}`, { sold_out: true });
    const page = await open();
    assert.match(await page.locator('li.item.sold-out', { hasText: '아메리카노' }).textContent(), /품절/);
    await page.close();
  } finally {
    await owner('PATCH', `acm_menu_items?id=eq.${item.id}`, { sold_out: item.sold_out });
  }
});

test('DB가 멈추면(540) 백업 메뉴 + 안내', async () => {
  const page = await open({ routes: [['**/rest/v1/**', r => r.fulfill({ status: 540, body: 'paused' })]] });
  assert.equal(await page.getAttribute('body', 'data-source'), 'backup');
  assert.match(await page.textContent('#notice'), /2026-09-15 기준/);
  await page.close();
});

test('라이브러리를 못 불러와도 백업 메뉴', async () => {
  const page = await open({ routes: [['**/supabase-js@*/**', r => r.abort()]] });
  assert.equal(await page.getAttribute('body', 'data-source'), 'backup');
  await page.close();
});

test('비밀 키가 들어 있으면 DB에 요청하지 않고 백업', async () => {
  let asked = false;
  const page = await open({ config: configJs(env, { SUPABASE_ANON_KEY: 'sb_secret_test' }),
    routes: [['**/rest/v1/**', r => { asked = true; r.abort(); }]] });
  assert.equal(await page.getAttribute('body', 'data-source'), 'backup');
  assert.equal(asked, false);
  await page.close();
});

function copyForScript() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acm-cfg-'));
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.join(ROOT, 'scripts/write-config.mjs'), path.join(dir, 'scripts/write-config.mjs'));
  cpSync(path.join(ROOT, 'config.js'), path.join(dir, 'config.js'));
  cpSync(path.join(ROOT, 'menu.js'), path.join(dir, 'menu.js'));
  return dir;
}
const runScript = (dir, extraEnv) => spawnSync('node', ['scripts/write-config.mjs'], {
  cwd: dir, env: { PATH: process.env.PATH, ...extraEnv }, encoding: 'utf8' });

test('write-config: 환경 변수가 있으면 채우고, 없으면 그대로, 비밀 키면 거부', () => {
  const dir = copyForScript();
  const original = readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.equal(runScript(dir, {}).status, 0);
  assert.equal(readFileSync(path.join(dir, 'config.js'), 'utf8'), original);
  assert.equal(runScript(dir, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_x' }).status, 1);
  assert.equal(readFileSync(path.join(dir, 'config.js'), 'utf8'), original);
  assert.equal(runScript(dir, { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x' }).status, 0);
  const filled = readFileSync(path.join(dir, 'config.js'), 'utf8');
  assert.match(filled, /SUPABASE_URL: 'https:\/\/x\.supabase\.co'/);
  assert.match(filled, /SUPABASE_ANON_KEY: 'sb_publishable_x'/);
  assert.match(filled, /비밀 키/); // 안내 주석은 남는다
  rmSync(dir, { recursive: true, force: true });
});
