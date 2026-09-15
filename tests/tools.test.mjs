import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, serve, configJs, loadEnv, rest, login, Menu } from './_helpers.mjs';

const env = loadEnv();
let browser, server, owner;
before(async () => {
  browser = await chromium.launch(); server = await serve();
  owner = rest(env, await login(env, env.OWNER_EMAIL, env.OWNER_PASSWORD));
});
after(async () => { await browser.close(); server.close(); });

async function context({ loggedIn = false, config = configJs(env) } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: config }));
  if (loggedIn) {
    const p = await ctx.newPage();
    await p.goto(server.url + '/admin/');
    await p.fill('#login [name=email]', env.OWNER_EMAIL);
    await p.fill('#login [name=password]', env.OWNER_PASSWORD);
    await p.click('#login button[type=submit]');
    await p.waitForSelector('#panel:not([hidden])');
    await p.close();
  }
  return ctx;
}

test('CSV 올리기: 로그인 안 했으면 올리기 버튼이 잠김', async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/import-csv.html');
  await page.waitForFunction(() => /로그인/.test(document.querySelector('#who').textContent));
  await page.fill('#src', '카테고리,이름,영문명,가격,설명\n커피,라떼,,6000,');
  await page.click('#preview');
  assert.equal(await page.isDisabled('#upload'), true);
  await ctx.close();
});

test('CSV 올리기: 잘못된 줄은 번호로 알려 주고 올리지 않음', async () => {
  const ctx = await context({ loggedIn: true });
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/import-csv.html');
  await page.waitForFunction(() => /사장님 계정/.test(document.querySelector('#who').textContent));
  await page.fill('#src', '카테고리,이름,영문명,가격,설명\n커피,라떼,,육천원,');
  await page.click('#preview');
  assert.match(await page.textContent('#msg'), /2번째 줄/);
  assert.equal(await page.isDisabled('#upload'), true);
  await ctx.close();
});

test('CSV 올리기: 새 종류와 메뉴가 DB에 들어간다', async () => {
  const ctx = await context({ loggedIn: true });
  const page = await ctx.newPage();
  const cat = `테스트종류${Date.now()}`;
  try {
    await page.goto(server.url + '/tools/import-csv.html');
    await page.waitForFunction(() => /사장님 계정/.test(document.querySelector('#who').textContent));
    await page.fill('#src', `카테고리\t이름\t영문명\t가격\t설명\n${cat}\t쑥라떼\tMugwort Latte\t6,500\t\n${cat}\t흑임자라떼\t\t6500원\t고소함`);
    await page.click('#preview');
    assert.equal(await page.$$eval('#table tbody tr', r => r.length), 2);
    await page.click('#upload');
    await page.waitForFunction(() => /2개 메뉴를 올렸습니다/.test(document.querySelector('#msg').textContent));
    const c = (await owner('GET', `acm_categories?name=eq.${encodeURIComponent(cat)}&select=id`)).data[0];
    const items = (await owner('GET', `acm_menu_items?category_id=eq.${c.id}&select=name,price,sort&order=sort`)).data;
    assert.deepEqual(items, [{ name: '쑥라떼', price: 6500, sort: 1 }, { name: '흑임자라떼', price: 6500, sort: 2 }]);
  } finally {
    await owner('DELETE', `acm_categories?name=eq.${encodeURIComponent(cat)}`);
    await ctx.close();
  }
});

test('백업으로 복원: 모두 지우고 백업 내용으로 되돌린다', async () => {
  const snapshot = {
    categories: (await owner('GET', 'acm_categories?select=*')).data,
    items: (await owner('GET', 'acm_menu_items?select=*')).data,
  };
  const ctx = await context({ loggedIn: true });
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/import-csv.html');
  await page.waitForFunction(() => /사장님 계정/.test(document.querySelector('#who').textContent));
  await page.fill('#src', Menu.toBackupJs(snapshot, '2026-09-15'));
  await page.click('#preview');
  await page.check('#replace');
  page.once('dialog', d => d.accept());
  await page.click('#upload');
  await page.waitForFunction(() => /메뉴를 올렸습니다/.test(document.querySelector('#msg').textContent), null, { timeout: 20000 });
  const names = async () => (await owner('GET', 'acm_menu_items?select=name,price,sold_out')).data
    .map(i => `${i.name}/${i.price}/${i.sold_out}`).sort();
  assert.deepEqual(await names(), snapshot.items.map(i => `${i.name}/${i.price}/${i.sold_out}`).sort());
  await ctx.close();
});

test('보안 점검: 제대로 막힌 DB는 통과', async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/security-check.html');
  await page.click('#run');
  await page.waitForFunction(() => /^(통과|실패|점검하지 못함)/.test(document.querySelector('#verdict').textContent), null, { timeout: 20000 });
  assert.match(await page.textContent('#verdict'), /^통과/);
  assert.equal(await page.$$eval('#results tbody tr', r => r.length), 7);
  await ctx.close();
});

test('보안 점검: 수정이 먹히는 DB는 실패로 표시', async () => {
  const ctx = await context();
  await ctx.route('**/rest/v1/acm_menu_items**', r => r.request().method() === 'PATCH'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":1}]' }) : r.continue());
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/security-check.html');
  await page.click('#run');
  await page.waitForFunction(() => /^(통과|실패|점검하지 못함)/.test(document.querySelector('#verdict').textContent), null, { timeout: 20000 });
  assert.match(await page.textContent('#verdict'), /^실패/);
  await ctx.close();
});

test('시연용 acm_pin_demo 표가 운영 DB에 남아 있지 않다', async () => {
  const r = await rest(env)('GET', 'acm_pin_demo?select=id');
  assert.notEqual(r.status, 200, '시연이 끝났으면 drop table public.acm_pin_demo; 를 실행');
});

test('PIN 시연 화면: 번호가 틀리면 안 열리고, 맞으면 수정 칸이 열린다(화면만 막음)', async () => {
  const ctx = await context({ config: 'window.MENU_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' });
  const page = await ctx.newPage();
  await page.goto(server.url + '/tools/pin-demo.html');
  await page.fill('#pin [name=pin]', '1111'); await page.click('#pin button');
  assert.match(await page.textContent('#pin-msg'), /틀렸습니다/);
  assert.equal(await page.isHidden('#edit'), true);
  await page.fill('#pin [name=pin]', '0415'); await page.click('#pin button');
  assert.equal(await page.isHidden('#edit'), false);
  await ctx.close();
});

test('QR 카드: 넣은 주소가 QR로 읽히고, 인쇄할 때 입력칸이 숨는다', async () => {
  const ctx = await context();
  const page = await ctx.newPage();
  const url = 'https://example.org/menu/';
  await page.goto(`${server.url}/qr/card-a6.html?url=${encodeURIComponent(url)}&shop=${encodeURIComponent('오후세시 커피')}`);
  await page.waitForSelector('#qr svg');
  assert.equal(await page.textContent('.card .shop'), '오후세시 커피');
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js' });
  const decoded = await page.evaluate(async () => {
    const xml = new XMLSerializer().serializeToString(document.querySelector('#qr svg'));
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(img, 40, 40, 320, 320);
    const d = g.getImageData(0, 0, 400, 400);
    return window.jsQR(d.data, 400, 400)?.data;
  });
  assert.equal(decoded, url);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.isHidden('.controls'), true);
  await page.emulateMedia({ media: 'screen' });
  await page.fill('#url', 'http://no-https.example'); // fill은 input 이벤트를 보낸다
  assert.match(await page.textContent('#qr'), /https:\/\//);
  await ctx.close();
});
