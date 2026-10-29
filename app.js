'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = s => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const num2 = (v, loc) => v.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => v == null || !isFinite(v) ? '–' : num2(v, 'de-AT') + ' €';
const money = (v, cur) => v == null || !isFinite(v) ? '–' : cur && cur !== 'EUR' ? `${cur} ${num2(v, 'de-CH')}` : eur(v);
const round2 = v => Math.round(v * 100) / 100;
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const fmtDate = s => { const d = parse(s); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WD[d.getUTCDay()]}`; };
const fmtMD = s => { const d = parse(s); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ticketName = n => (n === 1 ? '一日票' : `${n} 天票`);

const LS_DATA = 'pixel-ski.data.v1';
const LS_PRICES = 'pixel-ski.prices.v1';
const LS_NOINSTALL = 'pixel-ski.hide-install';
const LS_ONBOARDED = 'pixel-ski.onboarded';
const LS_MINE = 'pixel-ski.only-my-pass';
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

let TOAST_T;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(TOAST_T); TOAST_T = setTimeout(() => (t.hidden = true), 2600); }

/* ---------- price data: loaded from prices.json ---------- */
const STATE_ORDER = ['Tirol', 'Salzburg', 'Vorarlberg', 'Steiermark', 'Kärnten', 'Oberösterreich', 'Niederösterreich', 'Wien', 'Burgenland'];
const COUNTRY_DEFAULT = { AT: '奥地利', CH: '瑞士', FR: '法国', DE: '德国' };
const PX = {
  loaded: false, season: '', updated: '', range: { from: '2026-09-01', to: '2027-06-30' }, tiers: { cheap: 65, pricey: 79 },
  notice: '', sources: [], skipped: 0, offline: false, countries: { ...COUNTRY_DEFAULT }, fx: { EUR: 1 }, fxNote: '', durations: [1],
  passes: [],
};
let R = [], RBY = {};

// Remove accents and German umlaut spellings so "Soelden", "solden" and "Sölden" all match.
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ß/g, 'ss').replace(/([aou])e/g, '$1').replace(/[^a-z0-9㐀-鿿]+/g, ' ').trim();

// Extra search keywords, so "瑞士", "蒂罗尔", "Savoie" or "冰川" suggest something.
const COUNTRY_KEYS = { AT: ['奥地利', 'Österreich', 'Austria'], CH: ['瑞士', 'Schweiz', 'Switzerland', 'Suisse'], FR: ['法国', 'France', 'Frankreich'], DE: ['德国', 'Deutschland', 'Germany', 'Allemagne'] };
const STATE_ZH = {
  Tirol: '蒂罗尔', Salzburg: '萨尔茨堡', Vorarlberg: '福拉尔贝格', Steiermark: '施蒂利亚', Kärnten: '克恩顿',
  Oberösterreich: '上奥地利', Niederösterreich: '下奥地利', Wallis: '瓦莱', Graubünden: '格劳宾登', Bern: '伯尔尼',
  Uri: '乌里', Obwalden: '上瓦尔登', Waadt: '沃州', 'St. Gallen': '圣加仑', Savoie: '萨瓦', 'Haute-Savoie': '上萨瓦',
  Isère: '伊泽尔', 'Hautes-Alpes': '上阿尔卑斯', 'Hautes-Pyrénées': '上比利牛斯',
  Oberbayern: '上巴伐利亚', Allgäu: '阿尔高', Schwarzwald: '黑森林', Sauerland: '绍尔兰', Erzgebirge: '厄尔士山',
  'Bayerischer Wald': '巴伐利亚森林', Fichtelgebirge: '菲希特尔山', 'Thüringer Wald': '图林根森林', Harz: '哈尔茨',
};
const GLACIER_KEYS = ['冰川', 'Gletscher', 'Glacier'];
const regionKeys = (c, st) => [st, STATE_ZH[st], ...(COUNTRY_KEYS[c] || [])];

// Turn one prices.json entry into the shape the UI uses; null if it is unusable.
function normResort(e) {
  if (!e || typeof e.id !== 'string' || !e.id || typeof e.name !== 'string' || typeof e.state !== 'string') return null;
  const okDate = s => typeof s === 'string' && DATE_RE.test(s);
  const num = v => typeof v === 'number' && isFinite(v) && v >= 0;
  const multi = m => {
    const out = {};
    if (m && typeof m === 'object') for (const [k, v] of Object.entries(m)) { const n = parseInt(k, 10); if (n >= 2 && n <= 21 && num(v)) out[n] = v; }
    return out;
  };
  const r = {
    id: e.id, n: e.name, x: typeof e.sub === 'string' ? e.sub : '', st: e.state,
    c: typeof e.country === 'string' ? e.country : 'AT', cur: typeof e.currency === 'string' ? e.currency : 'EUR',
    p: num(e.price) ? e.price : null, multi: multi(e.multi),
    open: okDate(e.open) ? e.open : null, close: okDate(e.close) ? e.close : null,
    dyn: !!e.dynamic, from: num(e.fromPrice) ? e.fromPrice : null, est: !!e.estimated,
    note: typeof e.note === 'string' ? e.note : '',
    shop: typeof e.shop === 'string' && /^https?:\/\//.test(e.shop) ? e.shop : '',
    aliases: Array.isArray(e.aliases) ? e.aliases.filter(a => typeof a === 'string') : [],
    per: [],
  };
  if (Array.isArray(e.periods)) {
    r.per = e.periods.filter(p => p && okDate(p.from) && okDate(p.to) && (num(p.price) || p.multi))
      .map(p => ({ from: p.from, to: p.to, p: num(p.price) ? p.price : null, label: String(p.label || ''), multi: multi(p.multi) }));
    if (r.per.length !== e.periods.length) console.warn('prices.json: 有时段格式不对，已忽略', e.id);
  }
  // search index: own names first, then broader keywords (region, country, "冰川")
  const glacier = /gletscher|glacier/i.test([r.n, ...r.aliases].join(' '));
  const keys = [[r.n, 'name'], ...r.aliases.map(a => [a, 'alias']), [r.x, 'sub'],
    ...regionKeys(r.c, r.st).map(k => [k, 'region']), ...(glacier ? GLACIER_KEYS.map(k => [k, 'tag']) : [])];
  r._keys = keys.filter(k => k[0]).map(([raw, kind]) => { const f = fold(raw); return { raw, kind, f, c: f.replace(/ /g, ''), words: f.split(' ').filter(Boolean) }; });
  r._words = [...new Set(r._keys.flatMap(k => k.words))];
  r._own = [...new Set(r._keys.filter(k => k.kind === 'name' || k.kind === 'alias' || k.kind === 'sub').flatMap(k => k.words))];
  return r;
}

function applyPrices(j) {
  if (!j || !Array.isArray(j.resorts)) throw new Error('prices.json 里没有 resorts 列表');
  const list = [], seen = new Set();
  let skipped = 0;
  for (const e of j.resorts) {
    const r = normResort(e);
    if (!r || seen.has(r.id)) { skipped++; console.warn('prices.json: 跳过无效或重复的雪场', e); continue; }
    seen.add(r.id); list.push(r);
  }
  R = list;
  RBY = Object.fromEntries(R.map(r => [r.id, r]));
  Object.assign(PX, {
    loaded: true, skipped,
    season: String(j.season || ''), updated: String(j.updated || ''), notice: String(j.notice || ''),
    sources: Array.isArray(j.sources) ? j.sources.filter(s => s && s.name && /^https?:\/\//.test(s.url || '')) : [],
    countries: { ...COUNTRY_DEFAULT, ...(j.countries || {}) },
  });
  if (j.range && DATE_RE.test(j.range.from) && DATE_RE.test(j.range.to)) PX.range = { from: j.range.from, to: j.range.to };
  if (j.tiers && isFinite(j.tiers.cheap) && isFinite(j.tiers.pricey)) PX.tiers = { cheap: +j.tiers.cheap, pricey: +j.tiers.pricey };
  PX.fx = { EUR: 1 };
  PX.fxNote = '';
  if (j.fx && typeof j.fx === 'object') {
    for (const [k, v] of Object.entries(j.fx)) if (/^[A-Z]{3}$/.test(k) && isFinite(v) && v > 0) PX.fx[k] = +v;
    const extra = Object.keys(PX.fx).filter(k => k !== 'EUR');
    if (extra.length) PX.fxNote = `汇率：${extra.map(k => `1 ${k} ≈ ${num2(PX.fx[k], 'de-AT')} €`).join('，')}${j.fx.date ? `（${esc(j.fx.date)}）` : ''}`;
  }
  const ds = new Set([1]);
  R.forEach(r => { Object.keys(r.multi).forEach(n => ds.add(+n)); r.per.forEach(p => Object.keys(p.multi).forEach(n => ds.add(+n))); });
  PX.durations = [...ds].sort((a, b) => a - b);
  PX.passes = Array.isArray(j.passes) ? j.passes.map(normPass).filter(Boolean) : [];
}

// One season pass from prices.json; resorts are ids from the resort list.
function normPass(e) {
  if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || !(isFinite(e.price) && e.price > 0)) return null;
  const okDate = s => typeof s === 'string' && DATE_RE.test(s);
  return {
    id: e.id, name: e.name, c: typeof e.country === 'string' ? e.country : 'INT', cur: typeof e.currency === 'string' ? e.currency : 'EUR',
    price: +e.price, early: isFinite(e.earlyPrice) && e.earlyPrice > 0 ? +e.earlyPrice : null, earlyUntil: okDate(e.earlyUntil) ? e.earlyUntil : null,
    season: String(e.season || ''), covers: String(e.covers || ''), note: String(e.note || ''),
    resorts: Array.isArray(e.resorts) ? e.resorts.filter(id => RBY[id]) : [],
    // resorts the pass only covers for a few days a season, e.g. { ischgl: 3 }
    limits: Object.fromEntries(Object.entries(e.limits && typeof e.limits === 'object' ? e.limits : {})
      .filter(([id, d]) => RBY[id] && Number.isInteger(d) && d > 0)),
    url: /^https:\/\//.test(e.url || '') ? e.url : '',
  };
}

async function loadPrices() {
  try {
    const res = await fetch('prices.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    applyPrices(j);
    lsSet(LS_PRICES, j);
  } catch (err) {
    console.warn('prices.json 加载失败，改用上次保存的价格', err);
    const j = lsGet(LS_PRICES);
    if (j) { try { applyPrices(j); PX.offline = true; } catch (e) { /* keep empty */ } }
  }
  UI.date = clampDate(UI.date);
  if (!PX.durations.includes(UI.n)) UI.n = 1;
  UI.mine = lsGet(LS_MINE) !== false && !!(myPass() && myPass().resorts.length);
  renderFilters(); renderPrices(); renderFooter(); renderMe();
  if (!D.settings && !lsGet(LS_ONBOARDED) && PX.passes.length) openPassPicker();
}

const clampDate = s => s < PX.range.from ? PX.range.from : s > PX.range.to ? PX.range.to : s;
const toEUR = (v, cur) => (v == null ? null : cur === 'EUR' || !cur ? v : PX.fx[cur] ? v * PX.fx[cur] : null);

// Price of an n-day ticket starting on date d.
function priceOn(r, d, n = 1) {
  if (r.open && d < r.open) return { s: 'pre', txt: '未开季' };
  if (r.close && d > r.close) return { s: 'post', txt: '已闭季' };
  if (r.dyn) return { s: 'dyn', txt: '动态价' };
  if (n === 1) {
    if (r.p == null) return { s: 'na', txt: '未公布' };
    for (const p of r.per) if (p.p != null && d >= p.from && d <= p.to) return { s: 'open', p: p.p, l: p.label };
    return { s: 'open', p: r.p, l: r.per.some(p => p.p != null) ? 'Hauptsaison' : '' };
  }
  for (const p of r.per) if (p.multi[n] != null && d >= p.from && d <= p.to) return { s: 'open', p: p.multi[n], l: p.label };
  if (r.multi[n] != null) return { s: 'open', p: r.multi[n], l: r.per.some(p => p.multi[n] != null) ? 'Hauptsaison' : '' };
  return { s: 'nomulti', txt: `无${n}天票数据` };
}
const perDayEUR = (r, i, n) => toEUR(i.p, r.cur) / n;
const tier = e => e == null ? 't-mid' : e <= PX.tiers.cheap ? 't-low' : e < PX.tiers.pricey ? 't-mid' : 't-high';
const tagCls = (r, i, n) => i.s === 'open' ? tier(perDayEUR(r, i, n)) : i.s === 'dyn' ? 't-dyn' : i.s === 'pre' ? 't-pre' : 't-off';
const tagTxt = (r, i) => i.s === 'open' ? money(i.p, r.cur) : i.s === 'pre' ? `${fmtMD(r.open)}开季` : i.txt;
// Before the season starts: the price on opening day, so the list still says what it will cost.
const openingPrice = (r, n) => { const i = r.open ? priceOn(r, r.open, n) : null; return i && i.s === 'open' ? i : null; };

/* ---------- fuzzy resort search ---------- */
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// Returns { score, via } — via is the alias that matched (for showing "别名：圣安东").
function scoreResort(r, qf) {
  const qc = qf.replace(/ /g, '');
  if (!qc) return null;
  let best = 0, via = null;
  for (const k of r._keys) {
    const isName = k.kind === 'name';
    let s = 0;
    if (k.c.startsWith(qc)) s = isName ? 100 : 85;
    else if (k.words.some(w => w.startsWith(qc))) s = isName ? 90 : 75;
    else if (k.c.includes(qc)) s = isName ? 70 : 55;
    // region / tag keywords only count from the start ("tir" → Tirol, but "arlb" must not hit Vorarlberg)
    if (k.kind === 'region' || k.kind === 'tag') s = s >= 75 ? s - 30 : 0;
    if (s > best) { best = s; via = k; }
  }
  const toks = qf.split(' ').filter(Boolean);
  if (!best && toks.length > 1 && toks.every(t => r._words.some(w => w.startsWith(t)))) best = 50;
  let fuzzy = false;
  if (!best && /[a-z]/.test(qc) && qc.length >= 4) {
    // typo tolerance on the resort's own names only: every token must be close to some word (or the start of one)
    let tot = 0;
    for (const t of toks.filter(t => t.length >= 4)) {
      const lim = t.length >= 7 ? 2 : 1;
      let m = lim + 1;
      for (const w of r._own) {
        m = Math.min(m, lev(t, w, lim), w.length > t.length ? lev(t, w.slice(0, t.length), lim) : lim + 1);
        if (!m) break;
      }
      if (m > lim) { tot = 0; break; }
      tot += 30 - 8 * m;
    }
    best = tot; fuzzy = true;
  }
  if (!(best > 0)) return null;
  const hint = via && via.kind === 'alias' ? `别名：${via.raw}` : via && via.kind === 'tag' ? via.raw : null;
  return { score: best, via: hint, fuzzy };
}
function searchResorts(q, pool = R) {
  const qf = fold(q);
  if (!qf) return [];
  const hits = pool.map(r => ({ r, m: scoreResort(r, qf) })).filter(x => x.m);
  // once something matches properly, drop the "did you mean" guesses
  const sure = hits.filter(x => !x.m.fuzzy);
  return (sure.length ? sure : hits).sort((a, b) => b.m.score - a.m.score || a.r.n.localeCompare(b.r.n, 'de'));
}
// Countries and regions whose name starts with the query, e.g. "tir" → Tirol, "瑞" → 瑞士.
function searchRegions(q) {
  const qc = fold(q).replace(/ /g, '');
  if (!qc) return [];
  const hit = keys => keys.some(k => k && fold(k).replace(/ /g, '').startsWith(qc));
  const out = [];
  for (const c of [...new Set(R.map(r => r.c))]) {
    const n = R.filter(r => r.c === c).length;
    if (hit(COUNTRY_KEYS[c] || [c])) out.push({ c, st: '全部', label: PX.countries[c] || c, n });
  }
  for (const st of [...new Set(R.map(r => r.st))]) {
    const rs = R.filter(r => r.st === st);
    if (hit([st, STATE_ZH[st]])) out.push({ c: rs[0].c, st, label: STATE_ZH[st] ? `${st}（${STATE_ZH[st]}）` : st, n: rs.length });
  }
  return out.slice(0, 2);
}

const POPULAR = ['arlberg', 'soelden', 'ischgl', 'kitz', 'zermatt', 'verbier', '3vallees', 'chamonix'];
const shopLink = (r, cls = 'sg-shop') => r.shop ? `<a class="${cls}" href="${esc(r.shop)}" target="_blank" rel="noopener" title="${esc(r.n)} 官网">官网购票 ↗</a>` : '';

// A dropdown of suggestions under a text input.
// extra(r) adds HTML on the right of a resort; onRegion makes country / region keywords pickable too.
function attachSuggest(input, { onPick, onType, onRegion, extra, max = 8 }) {
  const box = document.createElement('div');
  box.className = 'suggest'; box.setAttribute('role', 'listbox'); box.id = input.id + '-list'; box.hidden = true;
  input.parentElement.classList.add('sugwrap');
  input.parentElement.appendChild(box);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', box.id); input.setAttribute('aria-expanded', 'false'); input.autocomplete = 'off';
  let items = [], act = -1, head = '';
  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const row = (it, k) => {
    const a = `class="sg${it.g ? ' grp' : ''}${k === act ? ' act' : ''}" role="option" id="${box.id}-${k}" data-i="${k}" aria-selected="${k === act}"`;
    if (it.g) return `<div ${a}><span class="sgt"><b>📍 ${esc(it.g.label)}</b><small>${it.g.st === '全部' ? '国家' : esc(PX.countries[it.g.c] || it.g.c)} · ${it.g.n} 家雪场 · 点一下只看这里</small></span></div>`;
    const { r, m } = it;
    const sub = [PX.countries[r.c] || r.c, r.st, m && m.via].filter(Boolean).map(esc).join(' · ');
    return `<div ${a}><span class="sgt"><b>${esc(r.n)}</b><small>${sub}</small></span>${extra ? extra(r) : ''}</div>`;
  };
  const draw = () => {
    if (!items.length) {
      box.innerHTML = input.value.trim() ? `<div class="sg-empty">没有相近的雪场。试试村镇名、中文名或地区名（如“蒂罗尔”“瑞士”）</div>` : '';
      box.hidden = !input.value.trim(); input.setAttribute('aria-expanded', String(!box.hidden)); return;
    }
    box.innerHTML = (head ? `<div class="sg-head">${head}</div>` : '') + items.map(row).join('');
    box.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (act >= 0) input.setAttribute('aria-activedescendant', `${box.id}-${act}`); else input.removeAttribute('aria-activedescendant');
  };
  const refresh = () => {
    const q = input.value.trim();
    if (q) {
      head = '';
      const regions = onRegion ? searchRegions(q).map(g => ({ g })) : [];
      items = [...regions, ...searchResorts(q).slice(0, max - regions.length)];
    } else {
      head = '热门雪场 · 输入雪场、村镇、地区或国家';
      items = POPULAR.map(id => RBY[id]).filter(Boolean).map(r => ({ r, m: null }));
    }
    act = -1; draw();
  };
  const pick = k => {
    const it = items[k]; if (!it) return;
    close();
    if (it.g) { input.value = ''; onRegion(it.g); } else { input.value = it.r.n; onPick(it.r); }
  };
  input.addEventListener('input', () => { if (onType) onType(input.value); refresh(); });
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (box.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { act = (act + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { act = (act - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(act >= 0 ? act : 0); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  // keep focus in the input; a tap on the "官网" link opens the shop instead of picking the resort
  box.addEventListener('mousedown', e => { e.preventDefault(); if (e.target.closest('a')) return; const o = e.target.closest('[data-i]'); if (o) pick(+o.dataset.i); });
}

/* ---------- pixel sprites ---------- */
const PENGUIN = [
  '.....ww.....', '....bbbb....', '...bbbbbb...', '..kkkkkkkk..', '.kkwwwwwwkk.',
  '.kwkwwwwkwk.', '.kwwwoowwwk.', '.kpwwwwwwpk.', 'rrrrrrrrrrr.', 'kkwwwwwwwkkr',
  'kkwwwwwwwkk.', '.kwwwwwwwk..', '..kkkkkkk...', '..oo...oo...', 'rrrrrrrrrrrr'];
const COIN = ['.dddd.', 'dywyyd', 'dyyyyd', 'dyyyyd', 'dyyyyd', '.dddd.'];
const PINE = ['..g..', '.ggg.', '..g..', '.ggg.', 'ggggg', '..t..'];
const FLAG = ['kffff', 'kffff', 'kfff.', 'k....', 'k....', 'k....', 'k....', 'k....'];
const FLAKE = ['...w...', '.w.w.w.', '..www..', 'wwwwwww', '..www..', '.w.w.w.', '...w...'];
const BOOK = ['kkkkkkkk', 'kwwwwwwk', 'kwrrrrwk', 'kwwwwwwk', 'kwrrrwwk', 'kwwwwwwk', 'kwrrrrwk', 'kkkkkkkk'];
const PAL = { k: '--pk', w: '--pw', o: '--po', b: '--pb', r: '--pr', p: '--pp', y: '--gold', d: '--gd', g: '--pine', t: '--trunk', f: '--pink', F: '--gold' };
function sprite(map, x, y, sub = {}) {
  let s = '';
  map.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '.') return;
    s += `<rect x="${x + i}" y="${y + j}" width="1" height="1" style="fill:var(${PAL[sub[c] || c]})"/>`;
  }));
  return s;
}
const icon = (map, w) => `<svg class="px" viewBox="0 0 ${map[0].length} ${map.length}" width="${w}" aria-hidden="true">${sprite(map, 0, 0)}</svg>`;

/* ---------- UI state ---------- */
const UI = { view: 'prices', date: localToday(), n: 1, country: 'all', st: '全部', q: '', sort: 'asc', open: null, mine: false, confirmDel: null };

/* ---------- prices view ---------- */
function stateRank(s) { const i = STATE_ORDER.indexOf(s); return i < 0 ? 99 : i; }
function renderFilters() {
  const countries = [...new Set(R.map(r => r.c))];
  if (UI.country !== 'all' && !countries.includes(UI.country)) UI.country = 'all';
  const cc = [['all', '全部国家'], ...countries.map(c => [c, PX.countries[c] || c])];
  const mp = myPass();
  if (!mp || !mp.resorts.length) UI.mine = false;
  let html = `<div class="chips">${cc.map(([k, l]) => `<button class="chip" data-country="${esc(k)}" aria-pressed="${k === UI.country}">${esc(l)}</button>`).join('')}</div>`;
  if (UI.country !== 'all') {
    const sts = [...new Set(R.filter(r => r.c === UI.country).map(r => r.st))].sort((a, b) => stateRank(a) - stateRank(b) || a.localeCompare(b));
    if (!sts.includes(UI.st)) UI.st = '全部';
    html += `<div class="chips sm">${['全部', ...sts].map(s => `<button class="chip" data-st="${esc(s)}" aria-pressed="${s === UI.st}">${s === '全部' ? '全部地区' : esc(s)}</button>`).join('')}</div>`;
  } else UI.st = '全部';
  $('#states').innerHTML = html;
  $('#ticket').innerHTML = PX.durations.map(n => `<option value="${n}"${n === UI.n ? ' selected' : ''}>${ticketName(n)}</option>`).join('');
  const t = PX.tiers;
  $('#legend').innerHTML = `<span>按每天折合欧元：</span><span><i class="t-low"></i>≤ ${t.cheap} €</span><span><i class="t-mid"></i>${t.cheap}–${t.pricey} €</span><span><i class="t-high"></i>≥ ${t.pricey} €</span>
    <span><i class="t-dyn"></i>动态定价</span><span><i class="t-pre"></i>还没开季</span><span><i class="t-off"></i>已闭季 / 暂无数据</span>`;
  const di = $('#date'); di.min = PX.range.from; di.max = PX.range.to;
  if (PX.season) $('#tagline').textContent = `阿尔卑斯 ${PX.season} 雪季 · 雪票价格 + 我的雪季记录`;
}

function monthsFor(r) {
  const lo = r.open && r.open > PX.range.from ? r.open : PX.range.from;
  const hi = r.close && r.close < PX.range.to ? r.close : PX.range.to;
  const out = [];
  let [y, m] = lo.slice(0, 7).split('-').map(Number);
  while (`${y}-${pad(m)}` <= hi.slice(0, 7) && out.length < 12) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
// Month grids like a flight-search calendar: the date on top, that day's price underneath.
function calendar(r, n) {
  const today = localToday();
  const short = v => String(Math.round(v));
  // without an opening date we don't know which days are really skiable: dashed cells, and say so
  const guess = !r.open;
  const head = `<p class="note">${ticketName(n)}每日价格（${r.cur === 'EUR' ? '€' : r.cur}，四舍五入）· 点日期切换：</p>`
    + (guess ? `<p class="note">⚠ 这个雪场还没公布开季 / 闭季日期，虚线格子是按全季同价推的，不代表那天一定开门，请以官网为准。</p>` : '');
  return head + `<div class="cal">` + monthsFor(r).map(([y, m]) => {
    const first = parse(`${y}-${pad(m)}-01`), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="wd">${w}</span>`).join('') + '<span></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(m)}-${pad(d)}`, i = priceOn(r, ds, n);
      const lab = i.s === 'open' ? money(i.p, r.cur) : i.txt;
      const cls = i.s === 'open' ? tagCls(r, i, n) + (guess ? ' guess' : '') : 'c-none';
      cells += `<button class="cell ${cls}${ds === UI.date ? ' sel' : ''}${ds === today ? ' today' : ''}" data-day="${ds}" title="${fmtDate(ds)} · ${lab}" aria-label="${fmtDate(ds)} ${lab}">`
        + `<span class="dn">${d}</span><span class="dp num">${i.s === 'open' ? short(i.p) : '–'}</span></button>`;
    }
    return `<div class="month"><h4>${y}年${m}月</h4><div class="mgrid">${cells}</div></div>`;
  }).join('') + `</div>`;
}
// Every ticket length this resort sells, priced for a start on the selected date.
function ticketTable(r) {
  const ns = new Set([1, ...Object.keys(r.multi).map(Number)]);
  r.per.forEach(p => Object.keys(p.multi).forEach(k => ns.add(+k)));
  const cells = [...ns].sort((a, b) => a - b).map(n => ({ n, i: priceOn(r, UI.date, n) })).filter(x => x.i.s === 'open');
  if (cells.length < 2) return '';
  return `<p class="note">${fmtMD(UI.date)} 出发的各种票（点一下切换，下面的日历跟着变）：</p><div class="tickets">${cells.map(({ n, i }) =>
    `<button class="tk${n === UI.n ? ' cur' : ''}" data-n="${n}" aria-pressed="${n === UI.n}"><b>${ticketName(n)}</b><span class="num">${money(i.p, r.cur)}</span><small>每天 ${money(i.p / n, r.cur)}</small></button>`).join('')}</div>`;
}
function detail(r) {
  const n = UI.n, i = priceOn(r, UI.date, n);
  const bits = [];
  let head = `<b>${fmtDate(UI.date)}${n > 1 ? ` 起的 ${n} 天票` : ''}</b>：`;
  if (i.s === 'open') {
    head += `${money(i.p, r.cur)}${n > 1 ? `（每天 ${money(i.p / n, r.cur)}）` : ''}${i.l ? ` · ${esc(i.l)}` : ''}`;
    if (r.cur !== 'EUR' && toEUR(i.p, r.cur) != null) head += ` · 约 ${eur(toEUR(i.p, r.cur))}`;
  } else head += i.txt;
  const op = i.s === 'pre' ? openingPrice(r, n) : null;
  if (op) head += ` · 开季当天 ${money(op.p, r.cur)}`;
  bits.push(`<p>${head}</p>`);
  if (inMyPass(r)) {
    const lim = passLimit(r), used = daysLoggedAt(r.id);
    bits.push(`<p class="note">🎫 ${lim
      ? `你的 ${esc(myPass().name)} 在这里每季可以滑 ${lim} 天（已记 ${used} 天${used >= lim ? '，用完了' : ''}），超出的天数要另买票。`
      : `你的 ${esc(myPass().name)} 能滑这里，不用另买票。`}</p>`);
  }
  bits.push(`<p class="note">开季：${r.open ? fmtDate(r.open) : '未公布'} · 闭季：${r.close ? fmtDate(r.close) : '未公布'}</p>`);
  bits.push(ticketTable(r));
  // price periods for the selected ticket length only
  const per = r.per.filter(p => (n === 1 ? p.p : p.multi[n]) != null);
  const base = n === 1 ? r.p : r.multi[n];
  if (per.length) {
    const md = s => s.slice(5).replace('-', '.');
    bits.push(`<p class="note">${ticketName(n)}分时段价格：</p><div class="periods">${per.map(p =>
      `<span>${esc(p.label)} ${md(p.from)}–${md(p.to)} · <b class="num">${money(n === 1 ? p.p : p.multi[n], r.cur)}</b></span>`).join('')}${base != null ? `<span>其余日期 · <b class="num">${money(base, r.cur)}</b></span>` : ''}${r.est ? '<span>⚠ 日期为推算</span>' : ''}</div>`);
  }
  if (r.dyn) bits.push(`<p class="note">动态定价：价格随日期和需求变化，越早在官网买越便宜${r.from != null ? `，官网约 ${money(r.from, r.cur)} 起` : ''}。</p>`);
  if (r.note) bits.push(`<p class="note">${esc(r.note)}</p>`);
  if (!r.dyn && (r.p != null || Object.keys(r.multi).length)) bits.push(calendar(r, n));
  bits.push(`<div class="bar">${shopLink(r, 'btn mint sm')}<button class="btn gold sm" data-log="${esc(r.id)}">我在 ${fmtDate(UI.date)} 滑了这里${n > 1 ? `（${n} 天票）` : ''} → 记一笔</button></div>`);
  if (r.shop) bits.push(`<p class="note">“官网购票”会打开 ${esc(r.n)} 的官方网站，很多雪场在官网提前买比售票处便宜。</p>`);
  return `<div class="detail">${bits.filter(Boolean).join('')}</div>`;
}
// "only resorts my season pass covers" — the default view for pass holders, remembered per device
function setMine(on) {
  UI.mine = on;
  lsSet(LS_MINE, on);
  renderFilters(); renderPrices();
}
function mineBar(count) {
  const mp = myPass();
  if (!mp || !mp.resorts.length) return '';
  return UI.mine
    ? `<div class="minebar"><span>🎫 正在看 <b>${esc(mp.name)}</b> 能滑的 <b>${count}</b> 个雪场${count < mp.resorts.length ? `（共 ${mp.resorts.length} 个，其余被上面的国家 / 地区筛掉了）` : ''}。</span><button class="btn sm ghost" data-mine>看全部雪场</button></div>`
    : `<div class="minebar off"><span>你的通票是 <b>${esc(mp.name)}</b>。</span><button class="btn sm gold" data-mine>只看它能滑的 ${mp.resorts.length} 个雪场</button></div>`;
}

function renderPrices() {
  $('#date').value = UI.date;
  if (!PX.loaded) {
    $('#summary').innerHTML = '';
    $('#list').innerHTML = `<p class="empty">价格数据没加载出来。请联网后重新打开 App。</p>`;
    return;
  }
  const d = UI.date, n = UI.n;
  const pool = R.filter(r => (UI.country === 'all' || r.c === UI.country) && (UI.st === '全部' || r.st === UI.st) && (!UI.mine || inMyPass(r)));
  const matches = UI.q ? searchResorts(UI.q, pool) : pool.map(r => ({ r, m: null }));
  const rows = matches.map(({ r, m }) => {
    const i = priceOn(r, d, n);
    return { r, m, i, op: i.s === 'pre' ? openingPrice(r, n) : null };
  });
  const rank = i => i.s === 'open' ? 0 : i.s === 'dyn' ? 1 : i.s === 'pre' ? 2 : i.s === 'na' || i.s === 'nomulti' ? 3 : 4;
  const sortEUR = x => x.i.s === 'open' ? perDayEUR(x.r, x.i, n) : x.op ? perDayEUR(x.r, x.op, n) : null;
  if (!UI.q) rows.sort((a, b) => {
    if (UI.sort === 'name') return a.r.n.localeCompare(b.r.n, 'de');
    const ea = sortEUR(a), eb = sortEUR(b);
    return rank(a.i) - rank(b.i)
      || (ea != null && eb != null ? (UI.sort === 'asc' ? 1 : -1) * (ea - eb) : (ea == null) - (eb == null))
      || a.r.n.localeCompare(b.r.n, 'de');
  });
  const open = rows.filter(x => x.i.s === 'open' && perDayEUR(x.r, x.i, n) != null);
  const pick = cmp => open.length ? open.reduce((a, b) => (cmp(perDayEUR(a.r, a.i, n), perDayEUR(b.r, b.i, n)) ? a : b)) : null;
  const lo = pick((a, b) => a <= b), hi = pick((a, b) => a >= b);
  const tile = (label, x) => `<div class="sumtile"><small>${label}${n > 1 ? `（${n} 天票）` : ''}</small><b class="num">${x ? money(x.i.p, x.r.cur) : '–'}</b><small>${x ? esc(x.r.n) + (n > 1 ? ` · 每天 ${money(x.i.p / n, x.r.cur)}` : '') : '这天没有可查的价格'}</small></div>`;
  $('#summary').innerHTML = mineBar(rows.length) + `
    <div class="sumtile"><small>${fmtDate(d)}${n > 1 ? ' 出发' : ''}</small><b class="num">${open.length}<span style="font-size:14px"> 家有价</span></b><small>共 ${rows.length} 家${UI.q ? '匹配' : ''}</small></div>
    ${tile('最便宜', lo)}${tile('最贵', hi)}${preseasonHint(rows)}`;
  $('#list').innerHTML = rows.length ? rows.map(({ r, m, i, op }) => {
    const ex = UI.open === r.id;
    const lim = passLimit(r);
    const sub = [lim ? `🎫 通票可滑 ${lim} 天` : !UI.mine && inMyPass(r) ? '🎫 通票能滑' : '', UI.country === 'all' ? PX.countries[r.c] || r.c : '', r.st, r.x, m && m.via,
      i.s === 'open' && n > 1 ? `每天 ${money(i.p / n, r.cur)}` : '', i.s === 'open' && i.l ? i.l : '',
      op ? `开季后 ${money(op.p, r.cur)}` : '',
      i.s === 'dyn' && r.from != null ? `约 ${money(r.from, r.cur)} 起` : '', !r.open && i.s === 'open' ? '开季日未公布' : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="item"><button class="row" data-id="${esc(r.id)}" aria-expanded="${ex}">
      <span class="rname"><b>${esc(r.n)}</b><small>${sub}</small></span>
      <span class="tag ${tagCls(r, i, n)}">${tagTxt(r, i)}</span><span class="chev">›</span></button>
      ${ex ? detail(r) : ''}</div>`;
  }).join('') : `<p class="empty">${UI.q ? '没找到相近的雪场。试试只输入名字的前几个字母，或者换成村镇名。' : '这个筛选下没有雪场。'}</p>`;
}
// Early in the season most resorts are still closed: offer a jump to the first weekend most of them are open.
function preseasonHint(rows) {
  const pre = rows.filter(x => x.i.s === 'pre');
  if (!pre.length || pre.length * 3 < rows.length) return '';
  const opens = pre.map(x => x.r.open).sort();
  let target = opens[Math.min(opens.length - 1, Math.floor(opens.length * 0.75))];
  while (parse(target).getUTCDay() !== 6) target = addDays(target, 1);
  target = clampDate(target);
  return `<div class="hintbar"><span>这天还有 <b>${pre.length}</b> 家雪场没开季，所以大多显示开季日期。大部分雪场开门后的第一个周六是 ${fmtDate(target)}。</span>
    <button class="btn sm gold" data-jump="${target}">看 ${fmtMD(target)} 的价格 →</button></div>`;
}

/* ---------- my season: data ---------- */
// settings: { mode: 'pass' | 'diary', passName, passPrice, compare }
// entry: { id, date, days, kind: 'day' | 'multi', resortId, resortName, value (EUR, whole ticket), note, createdAt }
const D = { settings: null, days: [] };
const daysOf = e => Math.max(1, parseInt(e.days, 10) || 1);
function validDay(d) { return d && DATE_RE.test(d.date) && typeof d.resortName === 'string' && isFinite(+d.value) && daysOf(d) <= 30; }
function loadData() {
  const j = lsGet(LS_DATA);
  if (j) { D.settings = j.settings || null; D.days = Array.isArray(j.days) ? j.days.filter(validDay) : []; }
}
let persistAsked = false;
function saveData() {
  const ok = lsSet(LS_DATA, { version: 2, settings: D.settings, days: D.days });
  if (!ok) toast('没存上：浏览器不允许保存数据（无痕模式？）');
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  return ok;
}
const isPass = () => D.settings && D.settings.mode === 'pass';

function stats() {
  const entries = [...D.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = entries.reduce((s, d) => s + (+d.value || 0), 0);
  const dayCount = entries.reduce((s, d) => s + daysOf(d), 0);
  const price = isPass() ? +D.settings.passPrice || 0 : +(D.settings && D.settings.compare) || 0;
  let breakDate = null, cum = 0;
  for (const d of entries) { cum += +d.value || 0; if (price && !breakDate && cum >= price) breakDate = d.date; }
  const known = R.filter(r => r.p != null).map(r => toEUR(r.p, r.cur)).filter(v => v != null).sort((a, b) => a - b);
  const avg = dayCount ? total / dayCount : (known.length ? known[Math.floor(known.length / 2)] : 75);
  const counts = {};
  entries.forEach(d => (counts[d.resortName] = (counts[d.resortName] || 0) + daysOf(d)));
  const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  // one stamp per ski day, in date order
  const stamps = entries.flatMap(e => Array.from({ length: daysOf(e) }, (_, k) => ({ date: addDays(e.date, k), name: e.resortName, multi: daysOf(e) > 1 })));
  return { entries, total, dayCount, price, pct: price ? total / price : 0, breakDate, avg, left: Math.max(0, price - total), resorts: Object.keys(counts).length, fav, stamps };
}

/* ---------- my season: pass-mode scene ---------- */
const hgt = x => (x <= 78 ? 6 + Math.floor(x / 3) : 32 - Math.floor((x - 78) / 2));
function scene(pct) {
  const W = 96, H = 44;
  let s = '';
  for (let x = 0; x < W; x++) {
    const h = hgt(x);
    s += `<rect x="${x}" y="${H - h}" width="1" height="${h}" style="fill:var(${x % 6 < 3 ? '--rock' : '--rock2'})"/><rect x="${x}" y="${H - h}" width="1" height="2" style="fill:var(--snow)"/>`;
  }
  [6, 15, 24, 86].forEach(x => (s += sprite(PINE, x, H - hgt(x + 2) - 5)));
  [0.25, 0.5, 0.75].forEach(m => { const cx = Math.round(4 + m * 68); s += `<g opacity="${pct >= m ? 1 : 0.35}">${sprite(COIN, cx, H - hgt(cx + 3) - 14)}</g>`; });
  s += sprite(FLAG, 78, H - 32 - 8, pct >= 1 ? { f: 'F' } : {});
  const px = Math.round(2 + Math.min(pct, 1) * (pct >= 1 ? 64 : 68));
  s += sprite(PENGUIN, px, H - hgt(px + 8) - 14);
  if (pct >= 1) for (let k = 0; k < 10; k++) {
    const cx = 60 + ((k * 37) % 34), cy = 3 + ((k * 13) % 10);
    s += `<rect x="${cx}" y="${cy}" width="1" height="1" style="fill:var(${['--gold', '--pink', '--mint', '--sky'][k % 4]})"/>`;
  }
  return `<svg class="px" viewBox="0 0 ${W} ${H}" role="img" aria-label="回本进度 ${Math.round(pct * 100)}%">${s}</svg>`;
}

/* ---------- my season: diary-mode stamp card ---------- */
const BADGES = [[1, '第一滑'], [5, '周末战士'], [10, '雪场常客'], [20, '雪山住民'], [30, '雪季传说']];
function stampCard(stamps) {
  const slots = Math.max(20, Math.ceil((stamps.length + 1) / 10) * 10);
  const flake = icon(FLAKE, 28);
  let s = '';
  for (let k = 0; k < slots; k++) {
    const d = stamps[k];
    if (d) {
      const dt = parse(d.date);
      s += `<div class="slot on${d.multi ? ' multi' : ''}" title="${esc(fmtDate(d.date) + ' · ' + d.name + (d.multi ? ' · 多天通票' : ''))}">${flake}<small>${dt.getUTCMonth() + 1}/${dt.getUTCDate()}</small></div>`;
    } else s += `<div class="slot" aria-hidden="true"></div>`;
  }
  return `<div class="stamps" role="img" aria-label="集章卡：已盖 ${stamps.length} 个章">${s}</div>
    <div class="legend"><span><i class="t-high"></i>单日票</span><span><i class="stamp-multi"></i>多天通票</span></div>`;
}

/* ---------- my season: forms ---------- */
const FORM = { kind: 'day', ndays: 3, date: localToday(), resort: '', rname: '', value: '', note: '' };
const formN = () => (FORM.kind === 'multi' ? Math.max(2, Math.min(21, parseInt(FORM.ndays, 10) || 2)) : 1);
function autoValue() {
  const r = RBY[FORM.resort];
  if (!r || !DATE_RE.test(FORM.date)) return null;
  const i = priceOn(r, FORM.date, formN());
  const e = i.s === 'open' ? toEUR(i.p, r.cur) : null;
  return e == null ? null : round2(e);
}
function hintText() {
  const r = RBY[FORM.resort], n = formN();
  const what = n > 1 ? `${n} 天票` : '一日票';
  if (!FORM.resort && !FORM.rname.trim()) return `输入雪场名（中文、别名、拼错几个字母都行），会按当天的${what}门市价自动填金额。`;
  if (!r) return `“${FORM.rname.trim()}”不在列表里，会按你写的名字记录，金额请手填。`;
  const mp = myPass();
  const lim = passLimit(r), used = lim ? daysLoggedAt(r.id) : 0;
  const outside = mp && mp.resorts.length && !inMyPass(r) ? `⚠ ${r.n} 不在 ${mp.name} 里，这天一般要另外买票。`
    : lim && used + n > lim ? `⚠ ${mp.name} 在 ${r.n} 每季只能滑 ${lim} 天，已经记了 ${used} 天，超出的要另外买票。`
    : lim ? `🎫 这是 ${mp.name} 在 ${r.n} 的第 ${used + 1}${n > 1 ? `–${used + n}` : ''} / ${lim} 天。` : '';
  const i = priceOn(r, FORM.date, n);
  if (i.s !== 'open') return `${outside}${r.n} 这天${i.txt}，请手动填金额。`;
  const conv = r.cur !== 'EUR' ? `（${money(i.p, r.cur)}，按 1 ${r.cur} ≈ ${num2(PX.fx[r.cur], 'de-AT')} € 换算）` : '';
  const tail = isPass() ? '' : '网上买得更便宜的话改成实际价格。';
  return `${outside}按 ${r.n} ${fmtMD(FORM.date)} 起的${what} ${eur(toEUR(i.p, r.cur))}${conv} 自动填好了，可以改。${tail}`;
}

// Shown in 我的雪季 until a recording mode is chosen.
function welcomeView() {
  return `<div><h2>你这个雪季怎么滑？</h2><p class="sub">告诉雪票本你买了哪张通票（或者没买），它就能帮你算回本进度、记滑雪日记。</p></div>
    <div class="choices">
      <button class="choice" data-open-picker>${icon(FLAG, 30)}<span><b>选择我的通票</b><small>奥地利、瑞士、法国、德国的常见通票，每滑一天按当天票价抵扣，看小企鹅爬到山顶回本。</small></span></button>
      <button class="choice" data-open-picker="none">${icon(BOOK, 32)}<span><b>没买通票，只想记录</b><small>记下每次去哪滑、花了多少（单日票或多天通票），集满滑雪章。</small></span></button>
    </div>`;
}

/* ---------- season-pass picker (first open, and 我的雪季 → 设置) ---------- */
const PASS_REGION = { AT: '奥地利', CH: '瑞士', FR: '法国', DE: '德国', INT: '多国通票' };
const PK = { step: 'list', region: 'all', q: '', id: null };
const passBy = id => PX.passes.find(p => p.id === id) || null;
const myPass = () => (isPass() && D.settings.passId ? passBy(D.settings.passId) : null);
const inMyPass = r => { const p = myPass(); return !!(p && p.resorts.includes(r.id)); };
const passLimit = r => { const p = myPass(); return p && p.limits[r.id] ? p.limits[r.id] : null; };
const daysLoggedAt = id => D.days.filter(d => d.resortId === id).reduce((s, d) => s + daysOf(d), 0);

function openPassPicker(step = 'list') {
  Object.assign(PK, { step, region: 'all', q: '', id: null });
  drawPicker();
  const d = $('#onboard');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
}
function closePicker() { const d = $('#onboard'); if (d.close) d.close(); else { d.removeAttribute('open'); lsSet(LS_ONBOARDED, true); } }

function passPriceTxt(p) {
  const conv = p.cur !== 'EUR' && toEUR(p.price, p.cur) != null ? ` ≈ ${eur(toEUR(p.price, p.cur))}` : '';
  return money(p.price, p.cur) + conv;
}
function passListHTML() {
  const qf = fold(PK.q);
  const list = PX.passes.filter(p => (PK.region === 'all' || p.c === PK.region)
    && (!qf || fold([p.name, p.covers, ...p.resorts.map(id => RBY[id].n), ...p.resorts.flatMap(id => RBY[id].aliases)].join(' ')).includes(qf)));
  const cur = D.settings && D.settings.passId;
  return list.length ? list.map(p => `<button class="pass${p.id === cur ? ' cur' : ''}" data-pass="${esc(p.id)}">
      <span class="pn"><b>${esc(p.name)}</b><small>${esc(PASS_REGION[p.c] || p.c)} · ${esc(p.covers)}</small></span>
      <span class="pp num">${money(p.price, p.cur)}<small>${p.early ? `早鸟 ${money(p.early, p.cur)}` : p.season && p.season !== PX.season ? `${esc(p.season)} 价格` : '成人价'}</small></span></button>`).join('')
    : `<p class="empty">没有找到。可以换个关键词，或者点下面「自己填」。</p>`;
}
function pickerList() {
  const regions = ['all', ...Object.keys(PASS_REGION).filter(k => PX.passes.some(p => p.c === k))];
  return `<div><h2>你这个雪季买了哪张通票？</h2><p class="sub">选好后，每滑一天就按当天的票价帮你算回本进度。之后在「我的雪季 → 设置」随时可以改。</p></div>
    <button class="btn mint nopass" data-pk="none">❄ 我没有买通票，只想记录滑雪日记</button>
    <div class="chips">${regions.map(k => `<button class="chip" data-pk-region="${k}" aria-pressed="${k === PK.region}">${k === 'all' ? '全部' : PASS_REGION[k]}</button>`).join('')}</div>
    <input type="search" id="pk-q" placeholder="搜通票或雪场：SuperSkiCard、Magic、采尔马特…" value="${esc(PK.q)}" aria-label="搜索通票">
    <div class="passlist" id="pk-list">${passListHTML()}</div>
    <div class="bar"><button class="btn ghost sm" data-pk="custom">我的通票不在列表里 → 自己填</button><button class="btn ghost sm" data-pk="later">以后再说</button></div>`;
}
function pickerConfirm(p) {
  // most season passes are bought at the early-bird price, so start from that one
  const v = toEUR(p.early || p.price, p.cur);
  const names = p.resorts.map(id => RBY[id].n + (p.limits[id] ? `（${p.limits[id]} 天）` : ''));
  const ended = p.earlyUntil && p.earlyUntil < localToday();
  const early = p.early ? `早鸟价 ${money(p.early, p.cur)}${p.earlyUntil ? `（${ended ? '已于' : ''}${fmtMD(p.earlyUntil)}${ended ? '截止' : '前'}）` : ''}。` : '';
  return `<div><h2>${esc(p.name)}</h2><p class="sub">${esc(PASS_REGION[p.c] || p.c)} · ${esc(p.covers)}</p></div>
    ${names.length ? `<p class="note">雪票本里能用这张通票滑的雪场（${names.length} 个）：${names.map(esc).join('、')}</p>` : '<p class="note">雪票本的价格表里暂时没有这张通票覆盖的雪场，记账时金额需要手填。</p>'}
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
    <form class="form" id="pk-form">
      <label class="f wide"><span>你实际付了多少 (€)</span><input id="pk-price" type="number" required min="1" step="0.01" inputmode="decimal" value="${v == null ? '' : round2(v)}"></label>
      <p class="hint wide">${p.early ? `先按早鸟价${p.cur !== 'EUR' ? '折成欧元' : ''}填好了。` : ''}成人正价 ${passPriceTxt(p)}${p.season && p.season !== PX.season ? `（${esc(p.season)} 雪季的价格，新价格还没公布）` : ''}。${early}学生、青少年或长者价不一样的话，改成你实际付的。</p>
      <div class="bar wide"><button class="btn ghost" type="button" data-pk="back">← 换一张</button><button class="btn gold" type="submit">就是这张，开始记录</button>${p.url ? `<a class="btn ghost sm" href="${esc(p.url)}" target="_blank" rel="noopener">官网 ↗</a>` : ''}</div>
    </form>`;
}
function pickerCustom() {
  const s = D.settings || {};
  const own = s.mode === 'pass' && !s.passId;
  return `<div><h2>自己填通票</h2><p class="sub">列表里没有的通票也能记，只是不会标出它覆盖哪些雪场。</p></div>
    <form class="form" id="pk-form">
      <label class="f"><span>通票名称</span><input id="pk-name" required maxlength="60" placeholder="如：Skipass Saison XY" value="${own ? esc(s.passName || '') : ''}"></label>
      <label class="f"><span>价格 (€)</span><input id="pk-price" type="number" required min="1" step="0.01" inputmode="decimal" placeholder="如：990" value="${own ? s.passPrice ?? '' : ''}"></label>
      <div class="bar wide"><button class="btn ghost" type="button" data-pk="back">← 返回</button><button class="btn gold" type="submit">开始记录</button></div>
    </form>`;
}
function pickerNone() {
  const s = D.settings || {};
  return `<div><h2>没买通票，只想记录</h2><p class="sub">每滑一天盖一个雪花章，集满解锁徽章，还能看到一共花了多少钱。</p></div>
    <form class="form" id="pk-form">
      <label class="f wide"><span>想看看买通票值不值？填一个通票价格做对比（可不填）</span><input id="pk-compare" type="number" min="1" step="0.01" inputmode="decimal" placeholder="如：1010" value="${s.compare ?? ''}"></label>
      <div class="bar wide"><button class="btn ghost" type="button" data-pk="back">← 返回</button><button class="btn gold" type="submit">开始记录</button></div>
    </form>`;
}
function drawPicker() {
  const d = $('#onboard');
  const p = PK.step === 'confirm' ? passBy(PK.id) : null;
  const body = p ? pickerConfirm(p) : PK.step === 'custom' ? pickerCustom() : PK.step === 'none' ? pickerNone() : pickerList();
  d.innerHTML = `<div class="in">${body}</div><button class="x" data-pk="later" aria-label="关闭">✕</button>`;
  const q = $('#pk-q');
  if (q) q.oninput = () => { PK.q = q.value; $('#pk-list').innerHTML = passListHTML(); };
  const f = $('#pk-form');
  if (f) f.onsubmit = e => { e.preventDefault(); savePicker(p); };
  d.scrollTop = 0;
}
function savePicker(p) {
  const prev = D.settings || {};
  let next;
  if (PK.step === 'none') {
    const c = +$('#pk-compare').value;
    next = { ...prev, mode: 'diary', compare: c > 0 ? c : null };
  } else {
    const price = +$('#pk-price').value;
    const name = p ? p.name : $('#pk-name').value.trim();
    if (!name || !(price > 0)) { toast('通票名称和价格都要填'); return; }
    next = { ...prev, mode: 'pass', passId: p ? p.id : '', passName: name, passPrice: price };
  }
  D.settings = next;
  if (!saveData()) return;
  closePicker();
  const mp = myPass();
  if (mp && mp.resorts.length) {
    UI.country = 'all'; UI.st = '全部'; UI.q = ''; $('#q').value = '';
    setMine(true);
    location.hash = 'prices'; show('prices');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`已选择 ${mp.name}，下面是它能滑的 ${mp.resorts.length} 个雪场`);
  } else {
    UI.mine = false; renderFilters(); renderPrices();
    toast(next.mode === 'pass' ? `已选择 ${next.passName}，滑完一天去「我的雪季」记一笔` : '好的，去「我的雪季」记录每一次滑雪');
  }
  renderMe();
}
function bindPicker() {
  const d = $('#onboard');
  d.addEventListener('click', e => {
    if (e.target === d) { closePicker(); return; }   // tap on the dimmed backdrop
    const b = e.target.closest('[data-pk],[data-pk-region],[data-pass]');
    if (!b) return;
    if (b.dataset.pass) { PK.step = 'confirm'; PK.id = b.dataset.pass; drawPicker(); return; }
    if (b.dataset.pkRegion) { PK.region = b.dataset.pkRegion; drawPicker(); return; }
    const a = b.dataset.pk;
    if (a === 'later') closePicker();
    else if (a === 'back') { PK.step = 'list'; drawPicker(); }
    else { PK.step = a; drawPicker(); }
  });
  d.addEventListener('close', () => lsSet(LS_ONBOARDED, true));
}

function logFormView() {
  const av = autoValue();
  if (FORM.value === '' && av != null) FORM.value = String(av);
  const multi = FORM.kind === 'multi';
  return `<h3>记一笔</h3>
  <div class="seg" role="group" aria-label="票种">
    <button class="chip" data-kind="day" aria-pressed="${!multi}">单日票</button>
    <button class="chip" data-kind="multi" aria-pressed="${multi}">多天通票</button>
  </div>
  <form class="form" id="logForm">
    <label class="f"><span>${multi ? '第一天' : '日期'}</span><input type="date" id="lf-date" required value="${FORM.date}"></label>
    ${multi ? `<label class="f"><span>滑了几天</span><input type="number" id="lf-n" required min="2" max="21" step="1" inputmode="numeric" value="${esc(FORM.ndays)}"></label>` : ''}
    <div class="f"><label for="lf-resort">雪场</label><input id="lf-resort" required maxlength="60" placeholder="如：索尔登 / Soelden / arlberg" value="${esc(FORM.rname)}"></div>
    <label class="f"><span>${multi ? '整张票' : '这天'}${isPass() ? '抵了多少钱' : '花了多少'} (€)</span><input type="number" id="lf-value" required min="0" step="0.01" inputmode="decimal" value="${esc(FORM.value)}"></label>
    <label class="f wide"><span>备注（可选）</span><input id="lf-note" maxlength="120" placeholder="粉雪！/ 和朋友 / 摔了三次…" value="${esc(FORM.note)}"></label>
    <p class="hint wide" id="lf-hint">${esc(hintText())}</p>
    <div class="bar wide"><button class="btn pink" type="submit">盖章！+${formN()} 天</button></div>
  </form>`;
}

function logListView(st) {
  const list = [...st.entries].reverse();
  const head = `<h3>滑雪日记 <span class="sub">（${st.dayCount} 天 · ${st.resorts} 个雪场）</span></h3>`;
  if (!list.length) return head + `<p class="empty">还没有记录。滑完第一天回来盖个章吧！</p>`;
  return head + `<div class="log">${list.map(d => {
    const dt = parse(d.date), n = daysOf(d);
    const span = n > 1 ? `${n} 天通票 · ${fmtMD(d.date)}–${fmtMD(addDays(d.date, n - 1))}` : '';
    return `<div class="stub${n > 1 ? ' multi' : ''}">
      <div class="d num"><b>${dt.getUTCDate()}</b>${dt.getUTCMonth() + 1}月</div>
      <div class="what"><b>${esc(d.resortName)}</b>${span ? `<small>${span}</small>` : ''}${d.note ? `<small>${esc(d.note)}</small>` : ''}</div>
      <span class="tag t-mid num">${eur(+d.value)}</span>
      ${UI.confirmDel === d.id
        ? `<span class="del bar"><button class="btn sm pink" data-del-yes="${esc(d.id)}">删除</button><button class="btn sm ghost" data-del-no>留着</button></span>`
        : `<button class="btn sm ghost del" data-del="${esc(d.id)}" aria-label="删除这条记录">✕</button>`}
    </div>`;
  }).join('')}</div>`;
}

function backupView() {
  return `<details class="box"><summary>备份与恢复</summary>
    <div class="bar">
      <button class="btn sm mint" id="bk-export">导出备份</button>
      <button class="btn sm ghost" id="bk-import">从备份恢复</button>
      <input type="file" id="bk-file" accept="application/json,.json" hidden>
    </div>
    <p class="note" style="margin-top:8px">记录只存在这台设备的这个浏览器里。换手机、清理浏览器数据前，先导出一份备份文件（存到“文件”或网盘）。</p>
  </details>`;
}

/* ---------- my season: render ---------- */
function renderMe() {
  const el = $('#me');
  if (!D.settings) { el.innerHTML = welcomeView(); bindMe(); return; }
  const st = stats();
  const parts = [];
  const s = D.settings;
  if (isPass()) {
    parts.push(`<div class="passhead"><div class="passcard"><span class="modechip">季票回本</span><span class="ticket num">${esc(s.passName)}</span><span class="num">${eur(+s.passPrice)}</span></div><button class="btn sm ghost" id="openSettings">设置</button></div>`);
    const mp = myPass();
    if (mp && mp.resorts.length) parts.push(`<div class="minebar off"><span>🎫 ${esc(mp.covers)}</span><button class="btn sm gold" data-goto-mine>看我的通票能滑的 ${mp.resorts.length} 个雪场 →</button></div>`);
    const pct = st.pct;
    const bubble = pct >= 1 ? `回本啦！${st.breakDate ? fmtDate(st.breakDate) : ''}` : st.dayCount ? `还差 ${eur(st.left)}` : '第一天在哪里滑？';
    parts.push(`<div class="scene">${scene(pct)}<span class="bubble">${bubble}</span></div>`);
    const blocks = Array.from({ length: 20 }, (_, k) => `<i class="${pct >= (k + 1) / 20 ? (pct >= 1 ? 'over' : 'on') : ''}"></i>`).join('');
    parts.push(`<div class="bigpct"><b class="num">${Math.floor(pct * 100)}%</b><span class="sub">${pct >= 1 ? `已经净赚 ${eur(st.total - st.price)}，接下来每一天都是白滑 ✦` : `回本进度 · 已抵 ${eur(st.total)} / ${eur(st.price)}`}</span></div><div class="blocks" aria-hidden="true">${blocks}</div>`);
    parts.push(`<div class="stats">
      <div class="stat"><small>已滑天数</small><b class="num">${st.dayCount} 天</b></div>
      <div class="stat"><small>已抵扣</small><b class="num">${eur(st.total)}</b></div>
      <div class="stat"><small>${st.left > 0 ? '还差' : '净赚'}</small><b class="num">${eur(st.left > 0 ? st.left : st.total - st.price)}</b></div>
      <div class="stat"><small>${st.left > 0 ? `大约还要滑（按 ${eur(st.avg)}/天）` : '摊到每天的票价'}</small><b class="num">${st.left > 0 ? Math.ceil(st.left / st.avg) + ' 天' : eur(st.price / st.dayCount)}</b></div>
    </div>`);
  } else {
    parts.push(`<div class="passhead"><div class="passcard"><span class="modechip">滑雪日记</span><span class="sub">${PX.season ? PX.season + ' 雪季' : '这个雪季'}的集章卡</span></div><button class="btn sm ghost" id="openSettings">设置</button></div>`);
    parts.push(stampCard(st.stamps));
    parts.push(`<div class="badges">${BADGES.map(([n, name]) => st.dayCount >= n
      ? `<span class="badge">★ ${name}</span>`
      : `<span class="badge locked">${name} · 还差 ${n - st.dayCount} 天</span>`).join('')}</div>`);
    parts.push(`<div class="stats">
      <div class="stat"><small>滑雪天数</small><b class="num">${st.dayCount} 天</b></div>
      <div class="stat"><small>雪票总花费</small><b class="num">${eur(st.total)}</b></div>
      <div class="stat"><small>平均每天</small><b class="num">${st.dayCount ? eur(st.total / st.dayCount) : '–'}</b></div>
      <div class="stat"><small>最常去</small><b>${st.fav ? esc(st.fav[0]) + ` <span class="sub">×${st.fav[1]} 天</span>` : '–'}</b></div>
    </div>`);
    if (st.price) {
      parts.push(`<p class="compare">对比 ${eur(st.price)} 的季票：${st.total >= st.price
        ? `你已经花了 ${eur(st.total)}，比季票多 ${eur(st.total - st.price)}。下个雪季可以考虑买季票。`
        : `再滑大约 <b class="num">${Math.ceil(st.left / st.avg)}</b> 天（按 ${eur(st.avg)}/天），买季票就比单买划算。`}</p>`);
    }
  }
  parts.push(logFormView());
  parts.push(logListView(st));
  parts.push(backupView());
  el.innerHTML = parts.join('');
  bindMe();
}

function bindMe() {
  document.querySelectorAll('[data-open-picker]').forEach(b => (b.onclick = () => openPassPicker(b.dataset.openPicker || 'list')));
  const os = $('#openSettings');
  if (os) os.onclick = () => openPassPicker();
  const gm = $('[data-goto-mine]');
  if (gm) gm.onclick = () => { location.hash = 'prices'; show('prices'); setMine(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  document.querySelectorAll('[data-kind]').forEach(b => (b.onclick = () => { FORM.kind = b.dataset.kind; FORM.value = ''; renderMe(); }));
  const lf = $('#logForm');
  if (lf) {
    const resync = () => {
      const av = autoValue();
      if (av != null) { FORM.value = String(av); $('#lf-value').value = FORM.value; }
      $('#lf-hint').textContent = hintText();
      lf.querySelector('button[type="submit"]').textContent = `盖章！+${formN()} 天`;
    };
    $('#lf-date').onchange = e => { FORM.date = e.target.value; resync(); };
    const nIn = $('#lf-n');
    if (nIn) nIn.oninput = e => { FORM.ndays = e.target.value; resync(); };
    attachSuggest($('#lf-resort'), {
      onType: v => { FORM.rname = v; FORM.resort = ''; $('#lf-hint').textContent = hintText(); },
      onPick: r => { FORM.resort = r.id; FORM.rname = r.n; FORM.value = ''; resync(); },
    });
    $('#lf-value').oninput = e => (FORM.value = e.target.value);
    $('#lf-note').oninput = e => (FORM.note = e.target.value);
    lf.onsubmit = e => {
      e.preventDefault();
      const r = RBY[FORM.resort];
      const name = r ? r.n : FORM.rname.trim();
      const value = +FORM.value, n = formN();
      if (!DATE_RE.test(FORM.date) || !name || FORM.value === '' || !(value >= 0)) { toast('日期、雪场和金额都要填'); return; }
      const before = stats().pct;
      D.days.push({
        id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: FORM.date, days: n, kind: n > 1 ? 'multi' : 'day',
        resortId: r ? r.id : '', resortName: name, value, note: FORM.note.trim(), createdAt: new Date().toISOString(),
      });
      if (!saveData()) { D.days.pop(); return; }
      FORM.note = '';
      renderMe();
      const st = stats();
      if (isPass()) toast(before < 1 && st.pct >= 1 ? '回本啦！之后每一天都是白滑' : `+${eur(value)}，回本进度 ${Math.floor(st.pct * 100)}%`);
      else {
        const b = BADGES.filter(([k]) => st.dayCount >= k && st.dayCount - n < k).pop();
        toast(b ? `解锁徽章：${b[1]}！` : `盖章成功，一共 ${st.dayCount} 天`);
      }
    };
  }

  $('#me').onclick = e => {
    const d = e.target.closest('[data-del]');
    if (d) { UI.confirmDel = d.dataset.del; renderMe(); return; }
    if (e.target.closest('[data-del-no]')) { UI.confirmDel = null; renderMe(); return; }
    const y = e.target.closest('[data-del-yes]');
    if (y) { D.days = D.days.filter(x => x.id !== y.dataset.delYes); UI.confirmDel = null; saveData(); renderMe(); toast('已删除'); }
  };

  const ex = $('#bk-export');
  if (ex) ex.onclick = exportData;
  const im = $('#bk-import'), file = $('#bk-file');
  if (im) { im.onclick = () => file.click(); file.onchange = () => { if (file.files[0]) importData(file.files[0]); file.value = ''; }; }
}

/* ---------- backup ---------- */
async function exportData() {
  const name = `pixel-ski-backup-${localToday()}.json`;
  const blob = new Blob([JSON.stringify({ app: 'pixel-ski', version: 2, exportedAt: new Date().toISOString(), settings: D.settings, days: D.days }, null, 2)], { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare) {
    const f = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: '像素雪票本备份' }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('备份文件已下载');
}
async function importData(f) {
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { toast('读不了这个文件：不是有效的 JSON'); return; }
  if (!j || j.app !== 'pixel-ski' || !Array.isArray(j.days)) { toast('这不是像素雪票本的备份文件'); return; }
  const days = j.days.filter(validDay);
  if (!confirm(`备份里有 ${days.length} 条记录。恢复后会替换现在的 ${D.days.length} 条记录和设置，继续吗？`)) return;
  D.settings = j.settings || D.settings; D.days = days;
  if (saveData()) toast(`已恢复 ${days.length} 条记录`);
  renderMe();
}

/* ---------- footer, install hint ---------- */
function renderFooter() {
  const bits = [];
  if (PX.loaded) {
    bits.push(`<div>价格数据：${esc(PX.season)} 雪季 · 更新于 ${esc(PX.updated)}${PX.offline ? ' · 离线，显示的是上次保存的价格' : ''}${PX.skipped ? ` · ⚠ 有 ${PX.skipped} 条数据格式不对，已跳过` : ''}</div>`);
    if (PX.notice) bits.push(`<div>${esc(PX.notice)}</div>`);
    if (PX.fxNote) bits.push(`<div>${PX.fxNote}。瑞士雪场记账时按这个汇率换算成欧元。</div>`);
    if (PX.sources.length) bits.push(`<div>来源：${PX.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(' · ')}</div>`);
  }
  $('#footer').innerHTML = bits.join('');
}

let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const box = $('#install');
  if (standalone() || lsGet(LS_NOINSTALL)) { box.hidden = true; return; }
  if (installEvt) box.innerHTML = `<span>把雪票本装到手机桌面，没信号也能打开。</span><span class="bar"><button class="btn sm" id="in-go">安装</button><button class="btn sm ghost" id="in-no">不用了</button></span>`;
  else if (isIOS) box.innerHTML = `<span>装到桌面：点 Safari 底部的「分享」→「添加到主屏幕」。</span><button class="btn sm ghost" id="in-no">知道了</button>`;
  else { box.hidden = true; return; }
  box.hidden = false;
  const go = $('#in-go');
  if (go) go.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; renderInstall(); };
  $('#in-no').onclick = () => { lsSet(LS_NOINSTALL, true); box.hidden = true; };
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; $('#install').hidden = true; });

/* ---------- tabs / routing ---------- */
function show(v) {
  UI.view = v === 'me' ? 'me' : 'prices';
  $('#view-prices').hidden = UI.view !== 'prices';
  $('#view-me').hidden = UI.view !== 'me';
  $('#tab-prices').setAttribute('aria-selected', UI.view === 'prices');
  $('#tab-me').setAttribute('aria-selected', UI.view === 'me');
}
function prefillLog(id, date) {
  const r = RBY[id];
  Object.assign(FORM, { resort: id, rname: r ? r.n : '', date, value: '', kind: UI.n > 1 ? 'multi' : 'day', ndays: UI.n > 1 ? UI.n : FORM.ndays });
  location.hash = 'me'; show('me'); renderMe();
  const f = $('#logForm') || $('#me');
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!D.settings) openPassPicker();
}

/* ---------- boot ---------- */
function boot() {
  $('#mascot').innerHTML = icon(PENGUIN, 72);
  $('#ico-coin').innerHTML = icon(COIN, 22);
  $('#ico-flag').innerHTML = icon(FLAG, 18);
  const hero = $('#hero');
  for (let i = 0; i < 14; i++) {
    const f = document.createElement('span');
    f.className = 'flake'; f.style.left = Math.random() * 100 + '%';
    f.style.animationDuration = 5 + Math.random() * 6 + 's'; f.style.animationDelay = -Math.random() * 10 + 's';
    hero.appendChild(f);
  }

  $('#states').addEventListener('click', e => {
    const c = e.target.closest('[data-country]');
    if (c) { UI.country = c.dataset.country; UI.st = '全部'; renderFilters(); renderPrices(); return; }
    const b = e.target.closest('[data-st]');
    if (b) { UI.st = b.dataset.st; renderFilters(); renderPrices(); }
  });
  $('#date').addEventListener('change', e => { if (e.target.value) { UI.date = clampDate(e.target.value); renderPrices(); } });
  $('#prev').onclick = () => { UI.date = clampDate(addDays(UI.date, -1)); renderPrices(); };
  $('#next').onclick = () => { UI.date = clampDate(addDays(UI.date, 1)); renderPrices(); };
  $('#today').onclick = () => { UI.date = clampDate(localToday()); renderPrices(); };
  $('#ticket').addEventListener('change', e => { UI.n = +e.target.value || 1; renderPrices(); });
  attachSuggest($('#q'), {
    onType: v => { UI.q = v.trim(); renderPrices(); },
    onPick: r => {
      UI.q = r.n; UI.open = r.id;
      if (UI.country !== 'all' && r.c !== UI.country) { UI.country = 'all'; renderFilters(); }
      renderPrices();
    },
    onRegion: g => { UI.q = ''; UI.country = g.c; UI.st = g.st; renderFilters(); renderPrices(); },
    extra: r => { const i = priceOn(r, UI.date, UI.n); return `<span class="tag ${tagCls(r, i, UI.n)}">${tagTxt(r, i)}</span>${shopLink(r)}`; },
  });
  $('#summary').addEventListener('click', e => {
    const j = e.target.closest('[data-jump]'); if (j) { UI.date = j.dataset.jump; renderPrices(); return; }
    if (e.target.closest('[data-mine]')) setMine(!UI.mine);
  });
  $('#sort').addEventListener('change', e => { UI.sort = e.target.value; renderPrices(); });
  $('#list').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const cell = e.target.closest('[data-day]'); if (cell) { UI.date = cell.dataset.day; renderPrices(); return; }
    const tk = e.target.closest('[data-n]'); if (tk) { UI.n = +tk.dataset.n; $('#ticket').value = UI.n; renderPrices(); return; }
    const lg = e.target.closest('[data-log]'); if (lg) { prefillLog(lg.dataset.log, UI.date); return; }
    const row = e.target.closest('.row'); if (row) { UI.open = UI.open === row.dataset.id ? null : row.dataset.id; renderPrices(); }
  });
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    location.hash = b.dataset.view; show(b.dataset.view);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  loadData();
  bindPicker();
  show(location.hash.slice(1));
  renderMe();
  renderInstall();
  loadPrices();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker 注册失败', err));
  }
}
boot();
