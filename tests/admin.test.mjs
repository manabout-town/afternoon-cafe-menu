import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, serve, configJs, loadEnv, rest, login, overflow } from './_helpers.mjs';

const env = loadEnv();
let browser, server, owner;
before(async () => {
  browser = await chromium.launch(); server = await serve();
  owner = rest(env, await login(env, env.OWNER_EMAIL, env.OWNER_PASSWORD));
});
after(async () => { await browser.close(); server.close(); });

async function open({ config = configJs(env), width = 390 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: config }));
  await page.goto(server.url + '/admin/');
  return page;
}
async function signIn(page, email, password) {
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#login [name=email]', email);
  await page.fill('#login [name=password]', password);
  await page.click('#login button[type=submit]');
}
async function asOwner(opts) {
  const page = await open(opts);
  await signIn(page, env.OWNER_EMAIL, env.OWNER_PASSWORD);
  await page.waitForSelector('#panel:not([hidden]) .edit');
  return page;
}
const saved = page => page.waitForFunction(() => /저장했습니다/.test(document.querySelector('#msg').textContent));
const itemByName = async name => (await owner('GET', `acm_menu_items?name=eq.${encodeURIComponent(name)}&select=*`)).data[0];

test('config.js가 비어 있으면 PART 2로 안내', async () => {
  const page = await open({ config: 'window.MENU_CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' });
  assert.match(await page.textContent('#setup-msg'), /PART 2/);
  assert.equal(await page.isHidden('#login'), true);
  await page.close();
});

test('비밀 키가 들어 있으면 멈추고 폐기하라고 알림', async () => {
  const page = await open({ config: configJs(env, { SUPABASE_ANON_KEY: 'sb_secret_test' }) });
  assert.match(await page.textContent('#setup-msg'), /비밀 키/);
  await page.close();
});

test('비밀번호가 틀리면 안내', async () => {
  const page = await open();
  await signIn(page, env.OWNER_EMAIL, 'wrong-password-123');
  await page.waitForFunction(() => /맞지 않습니다/.test(document.querySelector('#login-msg').textContent));
  assert.equal(await page.isHidden('#panel'), true);
  await page.close();
});

test('사장님 명단에 없는 계정은 들어갈 수 없다', async () => {
  const page = await open();
  await signIn(page, env.OTHER_EMAIL, env.OTHER_PASSWORD);
  await page.waitForFunction(() => /사장님으로 등록된 계정이 아닙니다/.test(document.querySelector('#login-msg').textContent));
  assert.equal(await page.isHidden('#panel'), true);
  await page.close();
});

test('품절 켜기·끄기가 DB에 저장된다', async () => {
  const page = await asOwner();
  const before = await itemByName('아메리카노');
  const box = page.locator('.edit[data-name="아메리카노"] [name=sold_out]');
  try {
    await box.setChecked(!before.sold_out); await saved(page);
    assert.equal((await itemByName('아메리카노')).sold_out, !before.sold_out);
  } finally {
    await owner('PATCH', `acm_menu_items?id=eq.${before.id}`, { sold_out: before.sold_out });
    await page.close();
  }
});

test('가격 바꾸기, 음수는 거절', async () => {
  const page = await asOwner();
  const before = await itemByName('아메리카노');
  const price = page.locator('.edit[data-name="아메리카노"] [name=price]');
  try {
    await price.fill('4600'); await price.blur(); await saved(page);
    assert.equal((await itemByName('아메리카노')).price, 4600);
    await price.fill('-5'); await price.blur();
    await page.waitForFunction(() => /0 이상의 숫자/.test(document.querySelector('#msg').textContent));
    assert.equal((await itemByName('아메리카노')).price, 4600);
  } finally {
    await owner('PATCH', `acm_menu_items?id=eq.${before.id}`, { price: before.price });
    await page.close();
  }
});

test('메뉴 추가 후 삭제', async () => {
  const page = await asOwner();
  const name = `테스트 메뉴 ${Date.now()}`;
  try {
    await page.selectOption('#add-item [name=category_id]', { label: '디저트' });
    await page.fill('#add-item [name=name]', name);
    await page.fill('#add-item [name=price]', '5000');
    await page.click('#add-item button[type=submit]');
    await page.waitForSelector(`.edit[data-name="${name}"]`);
    assert.equal((await itemByName(name)).price, 5000);
    page.once('dialog', d => d.accept());
    await page.click(`.edit[data-name="${name}"] [data-delete]`);
    await page.waitForSelector(`.edit[data-name="${name}"]`, { state: 'detached' });
    assert.equal(await itemByName(name), undefined);
  } finally {
    await owner('DELETE', `acm_menu_items?name=eq.${encodeURIComponent(name)}`);
    await page.close();
  }
});

test('순서 바꾸기: 아래로 → 위로', async () => {
  const page = await asOwner();
  const names = () => page.$$eval('.cat:first-of-type .edit', r => r.map(e => e.dataset.name));
  const first = (await names())[0];
  const originals = (await owner('GET', 'acm_menu_items?select=id,sort')).data;
  try {
    await page.click(`.edit[data-name="${first}"] [data-move="1"]`);
    await page.waitForFunction(n => document.querySelector('.cat .edit').dataset.name !== n, first);
    assert.equal((await names())[1], first);
    await page.click(`.edit[data-name="${first}"] [data-move="-1"]`);
    await page.waitForFunction(n => document.querySelector('.cat .edit').dataset.name === n, first);
  } finally {
    for (const o of originals) await owner('PATCH', `acm_menu_items?id=eq.${o.id}`, { sort: o.sort });
    await page.close();
  }
});

test('백업 내려받기: menu-backup.js 형식', async () => {
  const page = await asOwner();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
  assert.equal(download.suggestedFilename(), 'menu-backup.js');
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  assert.match(text, /^window\.MENU_BACKUP = \{/);
  await page.close();
});

for (const width of [320, 390, 430]) {
  test(`${width}px: 로그인 후 가로 넘침 없음, 이메일이 화면에 안 보임`, async () => {
    const page = await asOwner({ width });
    assert.ok(await overflow(page) <= 0, `${await overflow(page)}px`);
    assert.equal((await page.evaluate(() => document.body.innerText)).includes(env.OWNER_EMAIL), false);
    await page.close();
  });
}
