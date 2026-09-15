import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
export const Menu = require(path.join(ROOT, 'menu.js'));

export function loadEnv(file = path.join(ROOT, '.env.test')) {
  if (!existsSync(file)) throw new Error('.env.test 없음 — Task 2 Step 2 참고');
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(l => /^\w+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.sql': 'text/plain; charset=utf-8' };
export function serve(root = ROOT) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

export const configJs = (env, extra = {}) =>
  `window.MENU_CONFIG = ${JSON.stringify({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, ...extra })};`;

export function rest(env, token) {
  const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token || env.SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json', Prefer: 'return=representation' };
  return async (method, pathQuery, body) => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathQuery}`, { method, headers, body: body && JSON.stringify(body) });
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    return r.ok ? { status: r.status, data: json, error: null } : { status: r.status, data: null, error: json };
  };
}

export async function login(env, email, password) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`로그인 실패 ${r.status}: ${j.msg || j.error_description || j.error_code}`);
  return j.access_token;
}

export const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// 반투명 글자색을 body 배경 위에 섞은 뒤 WCAG 대비를 계산
export const contrast = (page, selector) => page.$eval(selector, el => {
  const nums = v => v.match(/[\d.]+/g).map(Number);
  const [r, g, b, a = 1] = nums(getComputedStyle(el).color);
  const [R, G, B] = nums(getComputedStyle(document.body).backgroundColor);
  const mix = [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
  const lum = c => { const s = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
  const [hi, lo] = [lum([R, G, B]), lum(mix)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
});
