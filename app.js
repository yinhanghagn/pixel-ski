'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = s => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const eur = v => v == null || !isFinite(v) ? '–' : v.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const fmtDate = s => { const d = parse(s); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 周${WD[d.getUTCDay()]}`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LS_DATA = 'pixel-ski.data.v1';
const LS_PRICES = 'pixel-ski.prices.v1';
const LS_NOINSTALL = 'pixel-ski.hide-install';
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

let TOAST_T;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(TOAST_T); TOAST_T = setTimeout(() => (t.hidden = true), 2600); }

/* ---------- price data: loaded from prices.json ---------- */
const STATE_ORDER = ['Tirol', 'Salzburg', 'Vorarlberg', 'Steiermark', 'Kärnten', 'Oberösterreich', 'Niederösterreich', 'Wien', 'Burgenland'];
const PX = { loaded: false, season: '', updated: '', range: { from: '2026-09-01', to: '2027-06-30' }, tiers: { cheap: 65, pricey: 79 }, notice: '', sources: [], skipped: 0, offline: false };
let R = [], RBY = {}, STATES = ['全部'];

// Turn one prices.json entry into the compact shape the UI uses; null if it is unusable.
function normResort(e) {
  if (!e || typeof e.id !== 'string' || !e.id || typeof e.name !== 'string' || typeof e.state !== 'string') return null;
  const okDate = s => typeof s === 'string' && DATE_RE.test(s);
  const num = v => typeof v === 'number' && isFinite(v) && v >= 0;
  const r = {
    id: e.id, n: e.name, x: typeof e.sub === 'string' ? e.sub : '', st: e.state,
    p: num(e.price) ? e.price : null, open: okDate(e.open) ? e.open : null, close: okDate(e.close) ? e.close : null,
    dyn: !!e.dynamic, est: !!e.estimated, note: typeof e.note === 'string' ? e.note : '',
  };
  if (Array.isArray(e.periods)) {
    const per = e.periods.filter(p => p && okDate(p.from) && okDate(p.to) && num(p.price)).map(p => [p.from, p.to, p.price, String(p.label || '')]);
    if (per.length !== e.periods.length) console.warn('prices.json: 有时段格式不对，已忽略', e.id);
    if (per.length) r.per = per;
  }
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
  const rank = s => { const i = STATE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  STATES = ['全部', ...[...new Set(R.map(r => r.st))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))];
  Object.assign(PX, {
    loaded: true, skipped,
    season: String(j.season || ''), updated: String(j.updated || ''), notice: String(j.notice || ''),
    sources: Array.isArray(j.sources) ? j.sources.filter(s => s && s.name && /^https?:\/\//.test(s.url || '')) : [],
  });
  if (j.range && DATE_RE.test(j.range.from) && DATE_RE.test(j.range.to)) PX.range = { from: j.range.from, to: j.range.to };
  if (j.tiers && isFinite(j.tiers.cheap) && isFinite(j.tiers.pricey)) PX.tiers = { cheap: +j.tiers.cheap, pricey: +j.tiers.pricey };
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
  FORM.date = clampFormDate(FORM.date);
  renderStates(); renderPrices(); renderFooter(); renderMe();
}

const clampDate = s => s < PX.range.from ? PX.range.from : s > PX.range.to ? PX.range.to : s;
const clampFormDate = s => DATE_RE.test(s) ? s : localToday();

function priceOn(r, d) {
  if (r.open && d < r.open) return { s: 'pre', txt: '未开季' };
  if (r.close && d > r.close) return { s: 'post', txt: '已闭季' };
  if (r.dyn) return { s: 'dyn', txt: '动态价' };
  if (r.p == null) return { s: 'na', txt: '未公布' };
  for (const [a, b, p, l] of (r.per || [])) if (d >= a && d <= b) return { s: 'open', p, l };
  return { s: 'open', p: r.p, l: r.per ? 'Hauptsaison' : '' };
}
const tier = p => p <= PX.tiers.cheap ? 't-low' : p < PX.tiers.pricey ? 't-mid' : 't-high';
const tagCls = i => i.s === 'open' ? tier(i.p) : i.s === 'dyn' ? 't-dyn' : 't-off';

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
const UI = { view: 'prices', date: localToday(), st: '全部', q: '', sort: 'asc', open: null, editSettings: false, pickMode: null, confirmDel: null };

/* ---------- prices view ---------- */
function renderStates() {
  if (!STATES.includes(UI.st)) UI.st = '全部';
  $('#states').innerHTML = STATES.map(s => `<button class="chip" data-st="${esc(s)}" aria-pressed="${s === UI.st}">${esc(s)}</button>`).join('');
  const t = PX.tiers;
  $('#legend').innerHTML = `<span><i class="t-low"></i>≤ ${t.cheap} €</span><span><i class="t-mid"></i>${t.cheap}–${t.pricey} €</span><span><i class="t-high"></i>≥ ${t.pricey} €</span>
    <span><i class="t-dyn"></i>动态定价</span><span><i class="t-off"></i>未开 / 已闭 / 未公布</span>`;
  const di = $('#date'); di.min = PX.range.from; di.max = PX.range.to;
  if (PX.season) $('#tagline').textContent = `奥地利 ${PX.season} 雪季 · 每日雪票价格 + 我的雪季记录`;
}

function monthsFor(r) {
  const start = (r.open || PX.range.from).slice(0, 7);
  const end = (r.close || PX.range.to).slice(0, 7);
  const out = [];
  let [y, m] = start.split('-').map(Number);
  while (`${y}-${pad(m)}` <= end && out.length < 12) { out.push([y, m]); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
function calendar(r) {
  return `<div class="cal">` + monthsFor(r).map(([y, m]) => {
    const first = parse(`${y}-${pad(m)}-01`), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    let cells = ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="wd">${w}</span>`).join('') + '<span></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(m)}-${pad(d)}`, i = priceOn(r, ds);
      const lab = i.s === 'open' ? eur(i.p) : i.txt;
      cells += `<button class="cell ${tagCls(i)}${ds === UI.date ? ' sel' : ''}" data-day="${ds}" title="${fmtDate(ds)} · ${lab}" aria-label="${fmtDate(ds)} ${lab}">${d}</button>`;
    }
    return `<div class="month"><h4>${y}年${m}月</h4><div class="mgrid">${cells}</div></div>`;
  }).join('') + `</div>`;
}
function detail(r) {
  const i = priceOn(r, UI.date);
  const bits = [];
  bits.push(`<p><b>${fmtDate(UI.date)}</b>：${i.s === 'open' ? `${eur(i.p)}${i.l ? ` · ${esc(i.l)}` : ''}` : i.txt}</p>`);
  bits.push(`<p class="note">开季：${r.open ? fmtDate(r.open) : '未公布'} · 闭季：${r.close ? fmtDate(r.close) : '未公布'}</p>`);
  if (r.per) {
    const md = s => s.slice(5).replace('-', '.');
    bits.push(`<div class="periods">${r.per.map(([a, b, p, l]) => `<span>${esc(l)} ${md(a)}–${md(b)} · <b class="num">${eur(p)}</b></span>`).join('')}<span>其余日期 · <b class="num">${eur(r.p)}</b></span>${r.est ? '<span>⚠ 日期为推算</span>' : ''}</div>`);
  }
  if (r.note) bits.push(`<p class="note">${esc(r.note)}</p>`);
  if (!r.dyn && r.p != null) bits.push(calendar(r));
  else if (r.dyn) bits.push(`<p class="note">动态定价：越早在官网买越便宜，没有固定门市价。</p>`);
  bits.push(`<div class="bar"><button class="btn gold sm" data-log="${esc(r.id)}">我在 ${fmtDate(UI.date)} 滑了这里 → 记一笔</button></div>`);
  return `<div class="detail">${bits.join('')}</div>`;
}
function renderPrices() {
  $('#date').value = UI.date;
  if (!PX.loaded) {
    $('#summary').innerHTML = '';
    $('#list').innerHTML = `<p class="empty">价格数据没加载出来。请联网后重新打开 App。</p>`;
    return;
  }
  const d = UI.date;
  const rows = R.filter(r => (UI.st === '全部' || r.st === UI.st) && (!UI.q || `${r.n} ${r.x} ${r.st}`.toLowerCase().includes(UI.q)))
    .map(r => ({ r, i: priceOn(r, d) }));
  const rank = i => i.s === 'open' ? 0 : i.s === 'dyn' ? 1 : i.s === 'na' ? 2 : 3;
  rows.sort((a, b) => {
    if (UI.sort === 'name') return a.r.n.localeCompare(b.r.n, 'de');
    return rank(a.i) - rank(b.i)
      || (a.i.s === 'open' ? (UI.sort === 'asc' ? a.i.p - b.i.p : b.i.p - a.i.p) : 0)
      || a.r.n.localeCompare(b.r.n, 'de');
  });
  const open = rows.filter(x => x.i.s === 'open');
  const lo = open.length ? open.reduce((a, b) => (a.i.p <= b.i.p ? a : b)) : null;
  const hi = open.length ? open.reduce((a, b) => (a.i.p >= b.i.p ? a : b)) : null;
  const known = open.filter(x => x.r.open).length;
  $('#summary').innerHTML = `
    <div class="sumtile"><small>${fmtDate(d)}</small><b class="num">${open.length}<span style="font-size:14px"> 家有价</span></b><small>共 ${rows.length} 家，其中 ${known} 家已确认开季</small></div>
    <div class="sumtile"><small>最便宜</small><b class="num">${lo ? eur(lo.i.p) : '–'}</b><small>${lo ? esc(lo.r.n) : '这天没有开放的雪场'}</small></div>
    <div class="sumtile"><small>最贵</small><b class="num">${hi ? eur(hi.i.p) : '–'}</b><small>${hi ? esc(hi.r.n) : '–'}</small></div>`;
  $('#list').innerHTML = rows.length ? rows.map(({ r, i }) => {
    const ex = UI.open === r.id;
    const sub = [r.st, r.x, i.s === 'open' && i.l ? i.l : '', !r.open && i.s === 'open' ? '开季日未公布' : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="item"><button class="row" data-id="${esc(r.id)}" aria-expanded="${ex}">
      <span class="rname"><b>${esc(r.n)}</b><small>${sub}</small></span>
      <span class="tag ${tagCls(i)}">${i.s === 'open' ? eur(i.p) : i.txt}</span><span class="chev">›</span></button>
      ${ex ? detail(r) : ''}</div>`;
  }).join('') : `<p class="empty">没有找到这个雪场。换个关键词试试？</p>`;
}

/* ---------- my season: data ---------- */
// settings: { mode: 'pass' | 'diary', passName, passPrice, compare }
// day: { id, date, resortId, resortName, value, note, createdAt }
const D = { settings: null, days: [] };
function loadData() {
  const j = lsGet(LS_DATA);
  if (j) { D.settings = j.settings || null; D.days = Array.isArray(j.days) ? j.days.filter(validDay) : []; }
}
function validDay(d) { return d && DATE_RE.test(d.date) && typeof d.resortName === 'string' && isFinite(+d.value); }
let persistAsked = false;
function saveData() {
  const ok = lsSet(LS_DATA, { version: 1, settings: D.settings, days: D.days });
  if (!ok) toast('没存上：浏览器不允许保存数据（无痕模式？）');
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  return ok;
}
const isPass = () => D.settings && D.settings.mode === 'pass';

function stats() {
  const days = [...D.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = days.reduce((s, d) => s + (+d.value || 0), 0);
  const price = isPass() ? +D.settings.passPrice || 0 : +(D.settings && D.settings.compare) || 0;
  let breakDate = null, cum = 0;
  for (const d of days) { cum += +d.value || 0; if (price && !breakDate && cum >= price) breakDate = d.date; }
  const known = R.map(r => r.p).filter(p => p != null).sort((a, b) => a - b);
  const avg = days.length ? total / days.length : (known.length ? known[Math.floor(known.length / 2)] : 75);
  const counts = {};
  days.forEach(d => (counts[d.resortName] = (counts[d.resortName] || 0) + 1));
  const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { days, total, price, pct: price ? total / price : 0, breakDate, avg, left: Math.max(0, price - total), resorts: Object.keys(counts).length, fav };
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
function stampCard(days) {
  const slots = Math.max(20, Math.ceil((days.length + 1) / 10) * 10);
  const flake = icon(FLAKE, 28);
  let s = '';
  for (let k = 0; k < slots; k++) {
    const d = days[k];
    if (d) {
      const dt = parse(d.date);
      s += `<div class="slot on" title="${esc(fmtDate(d.date) + ' · ' + d.resortName)}">${flake}<small>${dt.getUTCMonth() + 1}/${dt.getUTCDate()}</small></div>`;
    } else s += `<div class="slot" aria-hidden="true"></div>`;
  }
  return `<div class="stamps" role="img" aria-label="集章卡：已盖 ${days.length} 个章">${s}</div>`;
}

/* ---------- my season: forms ---------- */
const FORM = { date: localToday(), resort: '', value: '', note: '', custom: '' };
function resortOptions(sel) {
  let o = `<option value="">选雪场…</option>`;
  for (const st of STATES.slice(1)) {
    o += `<optgroup label="${esc(st)}">` + R.filter(r => r.st === st).map(r => `<option value="${esc(r.id)}"${r.id === sel ? ' selected' : ''}>${esc(r.n)}</option>`).join('') + `</optgroup>`;
  }
  return o + `<option value="_other"${sel === '_other' ? ' selected' : ''}>其他雪场（自己填）</option>`;
}
function autoValue() {
  const r = RBY[FORM.resort];
  if (!r) return null;
  const i = priceOn(r, FORM.date);
  return i.s === 'open' ? i.p : null;
}
function hintText() {
  const r = RBY[FORM.resort];
  if (!FORM.resort) return '选好日期和雪场，会按那天的门市价自动填金额。';
  if (FORM.resort === '_other') return '自己填雪场名和金额。';
  const i = priceOn(r, FORM.date);
  const what = isPass() ? '' : '（网上买得更便宜的话改成实际价格）';
  return i.s === 'open' ? `按 ${r.n} ${fmtDate(FORM.date)} 门市价 ${eur(i.p)} 自动填好了${what}，可以改。` : `${r.n} 这天${i.txt}，请手动填金额。`;
}

function settingsView() {
  const s = D.settings || {};
  const mode = UI.pickMode || s.mode || '';
  const parts = [];
  parts.push(`<div><h2>${D.settings ? '设置' : '你这个雪季怎么滑？'}</h2><p class="sub">选一种记录方式，之后随时可以在设置里换。已经记下的滑雪日不会丢。</p></div>`);
  parts.push(`<div class="choices">
    <button class="choice" data-mode="pass" aria-pressed="${mode === 'pass'}">${icon(FLAG, 30)}<span><b>我买了季票</b><small>每滑一天按当天票价抵扣，看小企鹅爬到山顶回本。</small></span></button>
    <button class="choice" data-mode="diary" aria-pressed="${mode === 'diary'}">${icon(BOOK, 32)}<span><b>没季票，只想记录</b><small>记下每次去哪滑、花了多少，集满滑雪章。</small></span></button>
  </div>`);
  if (mode) {
    parts.push(`<form class="form" id="setForm">
      ${mode === 'pass' ? `
        <label class="f"><span>季票名称</span><input id="sf-name" required maxlength="60" placeholder="如：SuperSkiCard" value="${esc(s.passName || '')}"></label>
        <label class="f"><span>季票价格 (€)</span><input id="sf-price" type="number" required min="1" step="0.01" inputmode="decimal" placeholder="如：1010" value="${s.passPrice ?? ''}"></label>`
      : `
        <label class="f wide"><span>想看看买季票值不值？填一个季票价格做对比（可不填）</span><input id="sf-compare" type="number" min="1" step="0.01" inputmode="decimal" placeholder="如：1010" value="${s.compare ?? ''}"></label>`}
      <div class="bar wide"><button class="btn gold" type="submit">${D.settings ? '保存设置' : '开始记录'}</button>${D.settings ? '<button class="btn ghost" type="button" id="sf-cancel">取消</button>' : ''}</div>
    </form>`);
  }
  return parts.join('');
}

function logFormView() {
  const av = autoValue();
  if (FORM.value === '' && av != null) FORM.value = String(av);
  return `<h3>记一笔滑雪日</h3>
  <form class="form" id="logForm">
    <label class="f"><span>日期</span><input type="date" id="lf-date" required value="${FORM.date}"></label>
    <label class="f"><span>雪场</span><select id="lf-resort" required>${resortOptions(FORM.resort)}</select></label>
    ${FORM.resort === '_other' ? `<label class="f"><span>雪场名称</span><input id="lf-custom" required maxlength="60" value="${esc(FORM.custom)}"></label>` : ''}
    <label class="f"><span>${isPass() ? '抵了多少钱 (€)' : '这天花了多少 (€)'}</span><input type="number" id="lf-value" required min="0" step="0.01" inputmode="decimal" value="${esc(FORM.value)}"></label>
    <label class="f wide"><span>备注（可选）</span><input id="lf-note" maxlength="120" placeholder="粉雪！/ 和朋友 / 摔了三次…" value="${esc(FORM.note)}"></label>
    <p class="hint wide" id="lf-hint">${esc(hintText())}</p>
    <div class="bar wide"><button class="btn pink" type="submit">盖章！+1 天</button></div>
  </form>`;
}

function logListView(st) {
  const list = [...st.days].reverse();
  const head = `<h3>滑雪日记 <span class="sub">（${st.days.length} 天 · ${st.resorts} 个雪场）</span></h3>`;
  if (!list.length) return head + `<p class="empty">还没有记录。滑完第一天回来盖个章吧！</p>`;
  return head + `<div class="log">${list.map(d => {
    const dt = parse(d.date);
    return `<div class="stub">
      <div class="d num"><b>${dt.getUTCDate()}</b>${dt.getUTCMonth() + 1}月</div>
      <div class="what"><b>${esc(d.resortName)}</b>${d.note ? `<small>${esc(d.note)}</small>` : ''}</div>
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
  if (!D.settings || UI.editSettings) { el.innerHTML = settingsView(); bindMe(); return; }
  const st = stats();
  const parts = [];
  const s = D.settings;
  if (isPass()) {
    parts.push(`<div class="passhead"><div class="passcard"><span class="modechip">季票回本</span><span class="ticket num">${esc(s.passName)}</span><span class="num">${eur(+s.passPrice)}</span></div><button class="btn sm ghost" id="openSettings">设置</button></div>`);
    const pct = st.pct;
    const bubble = pct >= 1 ? `回本啦！${st.breakDate ? fmtDate(st.breakDate) : ''}` : st.days.length ? `还差 ${eur(st.left)}` : '第一天在哪里滑？';
    parts.push(`<div class="scene">${scene(pct)}<span class="bubble">${bubble}</span></div>`);
    const blocks = Array.from({ length: 20 }, (_, k) => `<i class="${pct >= (k + 1) / 20 ? (pct >= 1 ? 'over' : 'on') : ''}"></i>`).join('');
    parts.push(`<div class="bigpct"><b class="num">${Math.floor(pct * 100)}%</b><span class="sub">${pct >= 1 ? `已经净赚 ${eur(st.total - st.price)}，接下来每一天都是白滑 ✦` : `回本进度 · 已抵 ${eur(st.total)} / ${eur(st.price)}`}</span></div><div class="blocks" aria-hidden="true">${blocks}</div>`);
    parts.push(`<div class="stats">
      <div class="stat"><small>已滑天数</small><b class="num">${st.days.length} 天</b></div>
      <div class="stat"><small>已抵扣</small><b class="num">${eur(st.total)}</b></div>
      <div class="stat"><small>${st.left > 0 ? '还差' : '净赚'}</small><b class="num">${eur(st.left > 0 ? st.left : st.total - st.price)}</b></div>
      <div class="stat"><small>${st.left > 0 ? `大约还要滑（按 ${eur(st.avg)}/天）` : '摊到每天的票价'}</small><b class="num">${st.left > 0 ? Math.ceil(st.left / st.avg) + ' 天' : eur(st.price / st.days.length)}</b></div>
    </div>`);
  } else {
    parts.push(`<div class="passhead"><div class="passcard"><span class="modechip">滑雪日记</span><span class="sub">${PX.season ? PX.season + ' 雪季' : '这个雪季'}的集章卡</span></div><button class="btn sm ghost" id="openSettings">设置</button></div>`);
    parts.push(stampCard(st.days));
    parts.push(`<div class="badges">${BADGES.map(([n, name]) => st.days.length >= n
      ? `<span class="badge">★ ${name}</span>`
      : `<span class="badge locked">${name} · 还差 ${n - st.days.length} 天</span>`).join('')}</div>`);
    parts.push(`<div class="stats">
      <div class="stat"><small>滑雪天数</small><b class="num">${st.days.length} 天</b></div>
      <div class="stat"><small>雪票总花费</small><b class="num">${eur(st.total)}</b></div>
      <div class="stat"><small>平均每天</small><b class="num">${st.days.length ? eur(st.total / st.days.length) : '–'}</b></div>
      <div class="stat"><small>最常去</small><b>${st.fav ? esc(st.fav[0]) + ` <span class="sub">×${st.fav[1]}</span>` : '–'}</b></div>
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
  document.querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => { UI.pickMode = b.dataset.mode; renderMe(); }));
  const sf = $('#setForm');
  if (sf) {
    sf.onsubmit = e => {
      e.preventDefault();
      const mode = UI.pickMode || (D.settings && D.settings.mode);
      const next = { ...(D.settings || {}), mode };
      if (mode === 'pass') {
        const name = $('#sf-name').value.trim(), price = +$('#sf-price').value;
        if (!name || !(price > 0)) { toast('季票名称和价格都要填'); return; }
        Object.assign(next, { passName: name, passPrice: price });
      } else {
        const c = +$('#sf-compare').value;
        next.compare = c > 0 ? c : null;
      }
      D.settings = next;
      if (saveData()) toast('设置已保存');
      UI.editSettings = false; UI.pickMode = null; renderMe();
    };
    const c = $('#sf-cancel');
    if (c) c.onclick = () => { UI.editSettings = false; UI.pickMode = null; renderMe(); };
  }
  const os = $('#openSettings');
  if (os) os.onclick = () => { UI.editSettings = true; UI.pickMode = D.settings.mode; renderMe(); };

  const lf = $('#logForm');
  if (lf) {
    const resync = () => { const av = autoValue(); if (av != null) { FORM.value = String(av); $('#lf-value').value = FORM.value; } $('#lf-hint').textContent = hintText(); };
    $('#lf-date').onchange = e => { FORM.date = e.target.value; resync(); };
    $('#lf-resort').onchange = e => { FORM.resort = e.target.value; FORM.value = ''; renderMe(); };
    $('#lf-value').oninput = e => (FORM.value = e.target.value);
    $('#lf-note').oninput = e => (FORM.note = e.target.value);
    const cu = $('#lf-custom');
    if (cu) cu.oninput = e => (FORM.custom = e.target.value);
    lf.onsubmit = e => {
      e.preventDefault();
      const r = RBY[FORM.resort];
      const name = r ? r.n : FORM.custom.trim();
      const value = +FORM.value;
      if (!DATE_RE.test(FORM.date) || !name || FORM.value === '' || !(value >= 0)) { toast('日期、雪场和金额都要填'); return; }
      const before = stats().pct;
      D.days.push({ id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: FORM.date, resortId: r ? r.id : '', resortName: name, value, note: FORM.note.trim(), createdAt: new Date().toISOString() });
      if (!saveData()) { D.days.pop(); return; }
      FORM.note = '';
      renderMe();
      const st = stats();
      if (isPass()) toast(before < 1 && st.pct >= 1 ? '回本啦！之后每一天都是白滑' : `+${eur(value)}，回本进度 ${Math.floor(st.pct * 100)}%`);
      else { const b = BADGES.find(([n]) => n === st.days.length); toast(b ? `解锁徽章：${b[1]}！` : `盖章成功，第 ${st.days.length} 天`); }
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
  const blob = new Blob([JSON.stringify({ app: 'pixel-ski', version: 1, exportedAt: new Date().toISOString(), settings: D.settings, days: D.days }, null, 2)], { type: 'application/json' });
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
  if (!confirm(`备份里有 ${days.length} 条滑雪记录。恢复后会替换现在的 ${D.days.length} 条记录和设置，继续吗？`)) return;
  D.settings = j.settings || D.settings; D.days = days;
  if (saveData()) toast(`已恢复 ${days.length} 条记录`);
  renderMe();
}

/* ---------- footer, install hint ---------- */
function renderFooter() {
  const bits = [];
  if (PX.loaded) {
    bits.push(`<div>价格数据：${esc(PX.season)} 雪季 · 更新于 ${esc(PX.updated)}${PX.offline ? ' · 离线，显示的是上次保存的价格' : ''}${PX.skipped ? ` · ⚠ prices.json 里有 ${PX.skipped} 条格式不对，已跳过` : ''}</div>`);
    if (PX.notice) bits.push(`<div>${esc(PX.notice)}</div>`);
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
  Object.assign(FORM, { resort: id, date, value: '' });
  location.hash = 'me'; show('me'); renderMe();
  const f = $('#logForm') || $('#me');
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!D.settings) toast('先选一种记录方式，再记这一笔');
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
    const b = e.target.closest('[data-st]'); if (!b) return;
    UI.st = b.dataset.st;
    document.querySelectorAll('#states .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.st === UI.st));
    renderPrices();
  });
  $('#date').addEventListener('change', e => { if (e.target.value) { UI.date = clampDate(e.target.value); renderPrices(); } });
  $('#prev').onclick = () => { UI.date = clampDate(addDays(UI.date, -1)); renderPrices(); };
  $('#next').onclick = () => { UI.date = clampDate(addDays(UI.date, 1)); renderPrices(); };
  $('#today').onclick = () => { UI.date = clampDate(localToday()); renderPrices(); };
  $('#q').addEventListener('input', e => { UI.q = e.target.value.trim().toLowerCase(); renderPrices(); });
  $('#sort').addEventListener('change', e => { UI.sort = e.target.value; renderPrices(); });
  $('#list').addEventListener('click', e => {
    const cell = e.target.closest('[data-day]'); if (cell) { UI.date = cell.dataset.day; renderPrices(); return; }
    const lg = e.target.closest('[data-log]'); if (lg) { prefillLog(lg.dataset.log, UI.date); return; }
    const row = e.target.closest('.row'); if (row) { UI.open = UI.open === row.dataset.id ? null : row.dataset.id; renderPrices(); }
  });
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    location.hash = b.dataset.view; show(b.dataset.view);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  loadData();
  show(location.hash.slice(1));
  renderMe();
  renderInstall();
  loadPrices();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker 注册失败', err));
  }
}
boot();
