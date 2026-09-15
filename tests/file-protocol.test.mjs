import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, chromium } from './_helpers.mjs';

// 독자는 이 파일들을 서버 없이 file:// 로 더블클릭해서 연다.
// 상대경로(../style.css 등)가 file:// 에서도 깨지지 않는지 확인한다.
const PAGES = {
  'tools/security-check.html': true,
  'tools/import-csv.html': true,
  'qr/card-a6.html': false, // menu.js를 안 씀(qrcode-generator만)
  'admin/index.html': true,
};

for (const [rel, usesMenu] of Object.entries(PAGES)) {
  test(`file:// 로 연 ${rel}: style.css 로 배경색이 먹는다${usesMenu ? ', Menu가 로드된다' : ''}`, async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await page.goto('file://' + path.join(ROOT, rel));
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(bg, 'rgb(246, 245, 242)', 'style.css의 --bg(#F6F5F2)가 안 먹음');
      if (usesMenu) {
        const hasMenu = await page.evaluate(() => typeof window.Menu === 'object' && typeof window.Menu.isSecretKey === 'function');
        assert.equal(hasMenu, true, 'menu.js(window.Menu)가 안 로드됨');
      }
    } finally {
      await browser.close();
    }
  });
}
