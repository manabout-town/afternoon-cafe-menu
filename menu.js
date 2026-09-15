/*! 오후세시 커피 메뉴판 — 손님 화면·사장님 화면·도구가 함께 쓰는 함수 모음 */
(function (root) {
  const tables = (prefix = 'acm_') => ({ categories: `${prefix}categories`, items: `${prefix}menu_items`, owners: `${prefix}owners` });

  const formatPrice = (n, lang = 'ko') =>
    lang === 'en' ? '₩' + Number(n).toLocaleString('en-US') : Number(n).toLocaleString('ko-KR') + '원';

  function groupMenu(data, { includeHidden = false } = {}) {
    const bySort = (a, b) => (a.sort - b.sort) || String(a.name).localeCompare(String(b.name), 'ko');
    return [...data.categories].sort(bySort)
      .map(c => ({ ...c, items: data.items.filter(i => i.category_id === c.id && (includeHidden || i.visible !== false)).sort(bySort) }))
      .filter(c => includeHidden || c.items.length > 0);
  }

  const label = (obj, lang) => (lang === 'en' && obj.name_en ? obj.name_en : obj.name);

  function isSecretKey(key) {
    if (!key) return false;
    if (key.startsWith('sb_secret_')) return true;
    const part = key.split('.')[1];
    if (!part) return false;
    try { return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
    catch { return false; }
  }

  function parseCsv(text) {
    const s = text.replace(/^﻿/, '');
    const sep = s.split('\n')[0].includes('\t') ? '\t' : ',';
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
  }

  const HEADERS = ['카테고리', '이름', '영문명', '가격', '설명'];
  function csvToMenu(text) {
    const rows = parseCsv(text);
    if (!rows.length || rows[0].slice(0, 5).join(',') !== HEADERS.join(',')) {
      return { categories: [], items: [], errors: [`첫 줄은 ${HEADERS.join(',')} 이어야 합니다`] };
    }
    const categories = []; const items = []; const errors = [];
    rows.slice(1).forEach((r, idx) => {
      const line = idx + 2;
      const [cat, name, nameEn, priceText = '', desc] = r;
      const price = Number(priceText.replace(/[,원\s]/g, ''));
      if (!cat || !name) return errors.push(`${line}번째 줄: 카테고리와 이름은 꼭 적어야 합니다`);
      if (!priceText || !Number.isInteger(price) || price < 0) return errors.push(`${line}번째 줄: 가격 "${priceText}"을(를) 숫자로 읽을 수 없습니다`);
      if (!categories.some(c => c.name === cat)) categories.push({ name: cat, name_en: null, sort: categories.length + 1 });
      items.push({ category: cat, name, name_en: nameEn || null, price, description: desc || null, image: null,
        sold_out: false, visible: true, sort: items.filter(i => i.category === cat).length + 1 });
    });
    return { categories, items, errors };
  }

  const BACKUP_PREFIX = 'window.MENU_BACKUP = ';
  function toBackupJs(data, savedAt) {
    const clean = {
      savedAt,
      categories: data.categories.map(({ id, name, name_en = null, sort }) => ({ id, name, name_en, sort })),
      items: data.items.map(({ category_id, name, name_en = null, price, description = null, image = null, sold_out = false, sort, visible = true }) =>
        ({ category_id, name, name_en, price, description, image, sold_out, sort, visible })),
    };
    return BACKUP_PREFIX + JSON.stringify(clean, null, 2) + ';\n';
  }
  function parseBackupJs(text) {
    const t = text.trim();
    if (!t.startsWith(BACKUP_PREFIX)) throw new Error('menu-backup.js 형식이 아닙니다');
    return JSON.parse(t.slice(BACKUP_PREFIX.length).replace(/;\s*$/, ''));
  }
  function importFromText(text) {
    if (!text.trim().startsWith(BACKUP_PREFIX.trim())) return csvToMenu(text);
    const b = parseBackupJs(text);
    const nameOf = id => (b.categories.find(c => c.id === id) || {}).name;
    return {
      categories: b.categories.map(({ name, name_en, sort }) => ({ name, name_en, sort })),
      items: b.items.map(({ category_id, ...rest }) => ({ ...rest, category: nameOf(category_id) })),
      errors: [],
    };
  }

  function classify(res, kind) {
    if (res.error) return res.error.code === '42501' ? 'blocked' : 'unclear';
    if (kind === 'insert') return 'open';
    return Array.isArray(res.data) && res.data.length === 0 ? 'blocked' : 'open';
  }

  async function loadMenu({ config, backup, createClient, timeoutMs = 5000 }) {
    const fromBackup = reason => ({ source: 'backup', reason,
      data: backup || { savedAt: null, categories: [], items: [], broken: true } });
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return fromBackup('no-config');
    if (isSecretKey(config.SUPABASE_ANON_KEY)) return fromBackup('secret-key');
    if (typeof createClient !== 'function') return fromBackup('no-library');
    try {
      const T = tables(config.TABLE_PREFIX);
      const db = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
      const [c, i] = await Promise.race([Promise.all([db.from(T.categories).select('*'), db.from(T.items).select('*')]), timeout]);
      if (c.error || i.error) return fromBackup((c.error || i.error).message);
      if (!c.data.length) return fromBackup('empty');
      return { source: 'db', data: { categories: c.data, items: i.data } };
    } catch (e) { return fromBackup(e.message); }
  }

  const api = { tables, formatPrice, groupMenu, label, isSecretKey, parseCsv, csvToMenu, toBackupJs, parseBackupJs, importFromText, classify, loadMenu };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Menu = api;
})(typeof window !== 'undefined' ? window : globalThis);
