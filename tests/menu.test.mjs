import test from 'node:test';
import assert from 'node:assert/strict';
import { Menu } from './_helpers.mjs';

const data = {
  categories: [{ id: 2, name: '디저트', name_en: 'Dessert', sort: 2 }, { id: 1, name: '커피', name_en: 'Coffee', sort: 1 }, { id: 3, name: '빈 종류', sort: 3 }],
  items: [
    { id: 1, category_id: 1, name: '라떼', name_en: 'Latte', price: 6000, sort: 2, visible: true },
    { id: 2, category_id: 1, name: '아메리카노', price: 4500, sort: 1, visible: true },
    { id: 3, category_id: 2, name: '숨긴 케이크', price: 6000, sort: 1, visible: false },
  ],
};

test('tables: 접두사로 표 이름을 만든다', () => {
  assert.deepEqual(Menu.tables(), { categories: 'acm_categories', items: 'acm_menu_items', owners: 'acm_owners' });
  assert.equal(Menu.tables('acmf_').items, 'acmf_menu_items');
});

test('formatPrice: 원 단위 쉼표, 영어는 ₩', () => {
  assert.equal(Menu.formatPrice(6000), '6,000원');
  assert.equal(Menu.formatPrice(12500, 'en'), '₩12,500');
});

test('groupMenu: 순서대로, 숨김·빈 종류 제외 / 사장님용은 전부', () => {
  const g = Menu.groupMenu(data);
  assert.deepEqual(g.map(c => c.name), ['커피']);
  assert.deepEqual(g[0].items.map(i => i.name), ['아메리카노', '라떼']);
  const all = Menu.groupMenu(data, { includeHidden: true });
  assert.deepEqual(all.map(c => c.name), ['커피', '디저트', '빈 종류']);
  assert.equal(all[1].items.length, 1);
});

test('label: 영문명이 없으면 한글', () => {
  assert.equal(Menu.label(data.items[0], 'en'), 'Latte');
  assert.equal(Menu.label(data.items[1], 'en'), '아메리카노');
});

test('isSecretKey: 비밀 키만 true', () => {
  const jwt = role => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y';
  assert.equal(Menu.isSecretKey('sb_secret_abc'), true);
  assert.equal(Menu.isSecretKey(jwt('service_role')), true);
  assert.equal(Menu.isSecretKey(jwt('anon')), false);
  assert.equal(Menu.isSecretKey('sb_publishable_abc'), false);
  assert.equal(Menu.isSecretKey(''), false);
});

test('parseCsv: 따옴표 안 쉼표·줄바꿈, 엑셀 탭 붙여넣기, BOM', () => {
  assert.deepEqual(Menu.parseCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(Menu.parseCsv('a\tb, c\n1\t2'), [['a', 'b, c'], ['1', '2']]);
});

test('csvToMenu: 머리줄 확인, 가격 "6,000원" 허용, 잘못된 줄은 번호와 함께', () => {
  const ok = Menu.csvToMenu('카테고리,이름,영문명,가격,설명\n커피,라떼,Latte,"6,000원",고소함\n커피,아메리카노,,4500,\n디저트,휘낭시에,,3800,');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.categories.map(c => [c.name, c.sort]), [['커피', 1], ['디저트', 2]]);
  assert.deepEqual(ok.items.map(i => [i.category, i.name, i.price, i.sort, i.name_en]),
    [['커피', '라떼', 6000, 1, 'Latte'], ['커피', '아메리카노', 4500, 2, null], ['디저트', '휘낭시에', 3800, 1, null]]);
  const bad = Menu.csvToMenu('카테고리,이름,영문명,가격,설명\n커피,,x,100,\n커피,라떼,,육천원,\n커피,모카,,,');
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /^2번째 줄/);
  assert.match(Menu.csvToMenu('이름,가격\n라떼,1').errors[0], /첫 줄/);
});

test('백업: toBackupJs → parseBackupJs 왕복, importFromText가 백업도 읽는다', () => {
  const text = Menu.toBackupJs(data, '2026-09-15');
  assert.ok(text.startsWith('window.MENU_BACKUP = '));
  const back = Menu.parseBackupJs(text);
  assert.equal(back.savedAt, '2026-09-15');
  assert.equal(back.items.length, 3);
  assert.equal('id' in back.items[0], false);
  const imp = Menu.importFromText(text);
  assert.deepEqual(imp.errors, []);
  assert.equal(imp.items.find(i => i.name === '라떼').category, '커피');
  assert.throws(() => Menu.parseBackupJs('{"a":1}'), /형식/);
});

test('classify: 42501이면 막힘, 0줄 수정이면 막힘, 다른 에러는 판단 불가', () => {
  assert.equal(Menu.classify({ error: { code: '42501' } }, 'insert'), 'blocked');
  assert.equal(Menu.classify({ error: { code: '23503' } }, 'insert'), 'unclear');
  assert.equal(Menu.classify({ data: [{ id: 1 }] }, 'insert'), 'open');
  assert.equal(Menu.classify({ data: [] }, 'change'), 'blocked');
  assert.equal(Menu.classify({ data: [{ id: 1 }] }, 'change'), 'open');
});

test('loadMenu: 설정 없음·비밀 키·라이브러리 없음·에러·시간 초과는 백업, 성공은 DB', async () => {
  const backup = { savedAt: '2026-09-15', categories: [], items: [] };
  const config = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_x' };
  const fake = result => () => ({ from: () => ({ select: () => result }) });
  assert.equal((await Menu.loadMenu({ config: {}, backup })).reason, 'no-config');
  assert.equal((await Menu.loadMenu({ config: { ...config, SUPABASE_ANON_KEY: 'sb_secret_x' }, backup })).reason, 'secret-key');
  assert.equal((await Menu.loadMenu({ config, backup })).reason, 'no-library');
  const err = await Menu.loadMenu({ config, backup, createClient: fake(Promise.resolve({ error: { message: 'paused' } })) });
  assert.deepEqual([err.source, err.reason], ['backup', 'paused']);
  const slow = await Menu.loadMenu({ config, backup, timeoutMs: 20, createClient: fake(new Promise(() => {})) });
  assert.deepEqual([slow.source, slow.reason], ['backup', 'timeout']);
  const ok = await Menu.loadMenu({ config, backup, createClient: fake(Promise.resolve({ data: [{ id: 1 }], error: null })) });
  assert.equal(ok.source, 'db');
  const broken = await Menu.loadMenu({ config: {}, backup: undefined });
  assert.equal(broken.data.broken, true);
});
