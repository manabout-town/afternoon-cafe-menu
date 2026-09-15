import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, ROOT, overflow, contrast } from './_helpers.mjs';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function openFile(rel, { width = 390, dir = ROOT } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto('file://' + path.join(dir, rel));
  await page.waitForSelector('body[data-source]');
  return page;
}

test('백업 모드: 설정이 비어 있으면 menu-backup.js 메뉴 6개, 종류 3개', async () => {
  const page = await openFile('index.html');
  assert.equal(await page.getAttribute('body', 'data-source'), 'backup');
  assert.deepEqual(await page.$$eval('.tab', t => t.map(e => e.textContent)), ['커피', '음료', '디저트']);
  assert.equal(await page.$$eval('li.item', l => l.length), 6);
  assert.match(await page.textContent('#notice'), /최신 정보가 아닐 수 있어요/);
  await page.close();
});

test('품절: 줄 긋기 + "품절" 글자(색만으로 구분하지 않음)', async () => {
  const page = await openFile('index.html');
  const sold = page.locator('li.item.sold-out');
  assert.equal(await sold.count(), 1);
  assert.match(await sold.textContent(), /유자 에이드[\s\S]*품절/);
  await page.close();
});

test('한/영 전환', async () => {
  const page = await openFile('index.html');
  await page.click('#lang');
  assert.deepEqual(await page.$$eval('.tab', t => t.map(e => e.textContent)), ['Coffee', 'Drinks', 'Dessert']);
  assert.match(await page.textContent('li.item.sold-out'), /Sold out/);
  assert.match(await page.textContent('li.item'), /₩4,500/);
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await page.click('#lang');
  assert.equal(await page.getAttribute('html', 'lang'), 'ko');
  await page.close();
});

test('백업 파일이 깨지면 고칠 곳을 알려 준다', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'acm-broken-'));
  for (const f of ['index.html', 'style.css', 'menu.js', 'config.js']) cpSync(path.join(ROOT, f), path.join(dir, f));
  writeFileSync(path.join(dir, 'menu-backup.js'), 'window.MENU_BACKUP = { "items": [ },');
  const page = await openFile('index.html', { dir });
  assert.match(await page.textContent('#notice'), /menu-backup\.js/);
  await page.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const width of [320, 390, 430]) {
  test(`${width}px: 가로 넘침 없음`, async () => {
    const page = await openFile('index.html', { width });
    assert.ok(await overflow(page) <= 0);
    await page.close();
  });
}

test('작은 글씨 대비 4.5:1 이상', async () => {
  const page = await openFile('index.html');
  for (const sel of ['.foot p', '.desc', '#notice', 'li.sold-out h3']) {
    const r = await contrast(page, sel);
    assert.ok(r >= 4.5, `${sel} ${r.toFixed(2)}`);
  }
  await page.close();
});
