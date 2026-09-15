import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, rest, login, Menu } from './_helpers.mjs';

const env = loadEnv();
const T = Menu.tables(process.env.ACM_PREFIX || 'acm_');
let anon, owner, other, cat, item;

before(async () => {
  anon = rest(env);
  owner = rest(env, await login(env, env.OWNER_EMAIL, env.OWNER_PASSWORD));
  other = rest(env, await login(env, env.OTHER_EMAIL, env.OTHER_PASSWORD));
  cat = (await anon('GET', `${T.categories}?select=*&order=id&limit=1`)).data?.[0];
  item = (await anon('GET', `${T.items}?select=*&order=id&limit=1`)).data?.[0];
  assert.ok(cat && item, '샘플 데이터 없음 — setup.sql 먼저 실행');
});

// 막히지 않으면 실제 데이터가 바뀌므로 지우기 시도는 맨 뒤에 둔다. 실패하면 setup.sql을 다시 실행해 샘플을 되살린다.
const attempts = () => [
  ['메뉴 추가', 'insert', c => c('POST', T.items, { category_id: cat.id, name: '보안 테스트', price: 0 })],
  ['메뉴 가격 바꾸기', 'change', c => c('PATCH', `${T.items}?id=eq.${item.id}`, { price: item.price })],
  ['종류 추가', 'insert', c => c('POST', T.categories, { name: '보안 테스트' })],
  ['종류 이름 바꾸기', 'change', c => c('PATCH', `${T.categories}?id=eq.${cat.id}`, { name: cat.name })],
  ['사장님 명단에 끼어들기', 'insert', c => c('POST', T.owners, { user_id: '00000000-0000-0000-0000-000000000000' })],
  ['메뉴 지우기', 'change', c => c('DELETE', `${T.items}?id=eq.${item.id}`)],
  ['종류 지우기', 'change', c => c('DELETE', `${T.categories}?id=eq.${cat.id}`)],
];

for (const [who, client] of [['손님(공개 키만)', () => anon], ['로그인했지만 사장님이 아닌 사람', () => other]]) {
  test(`${who}: 추가·수정·삭제가 전부 막힌다`, async () => {
    for (const [name, kind, run] of attempts()) {
      const res = await run(client());
      assert.equal(Menu.classify(res, kind), 'blocked', `${name}: ${res.status} ${JSON.stringify(res.error || res.data)}`);
    }
  });
}

test('사장님 명단은 손님에게 안 보이고, 다른 사용자에게는 빈 목록', async () => {
  assert.equal(Menu.classify(await anon('GET', `${T.owners}?select=*`), 'change'), 'blocked');
  const seen = await other('GET', `${T.owners}?select=*`);
  assert.deepEqual(seen.data, []);
});

test('손님은 메뉴를 읽을 수 있다', async () => {
  const r = await anon('GET', `${T.items}?select=name,price,sold_out`);
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 6);
});

test('사장님: 품절 바꾸기·되돌리기, 추가·삭제가 된다', async () => {
  let addedId;
  try {
    const flip = await owner('PATCH', `${T.items}?id=eq.${item.id}`, { sold_out: !item.sold_out });
    assert.equal(flip.data?.length, 1, JSON.stringify(flip.error));
    const back = await owner('PATCH', `${T.items}?id=eq.${item.id}`, { sold_out: item.sold_out });
    assert.equal(back.data?.length, 1);
    const added = await owner('POST', T.items, { category_id: cat.id, name: '사장님 테스트', price: 1000 });
    assert.equal(added.data?.length, 1, JSON.stringify(added.error));
    addedId = added.data[0].id;
    const del = await owner('DELETE', `${T.items}?id=eq.${addedId}`);
    assert.equal(del.data?.length, 1);
    addedId = undefined;
  } finally {
    await owner('PATCH', `${T.items}?id=eq.${item.id}`, { sold_out: item.sold_out, price: item.price });
    if (addedId) await owner('DELETE', `${T.items}?id=eq.${addedId}`);
  }
});

test('가격은 음수가 될 수 없다(DB 규칙)', async () => {
  const r = await owner('PATCH', `${T.items}?id=eq.${item.id}`, { price: -1 });
  assert.equal(r.error?.code, '23514');
});
