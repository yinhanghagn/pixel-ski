"""Check prices.json before publishing it.

    python3 tools/validate_prices.py                     # check prices.json
    python3 tools/validate_prices.py --old old.json      # also list what changed vs. an older copy

Exits with status 1 if there are errors. Warnings are printed but don't fail the check.
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ID = re.compile(r'^[a-z0-9][a-z0-9-]*$')
TOP_KEYS = {'season', 'updated', 'currency', 'range', 'tiers', 'notice', 'sources', 'resorts', 'countries', 'fx', 'passes'}
PASS_KEYS = {'id', 'name', 'country', 'currency', 'price', 'earlyPrice', 'earlyUntil', 'season', 'covers', 'resorts', 'url',
             'source', 'note'}
PASS_COUNTRIES = {'AT', 'CH', 'FR', 'DE', 'INT'}
PASS_MIN, PASS_MAX = 150, 4000          # plausible adult season-pass price
RESORT_KEYS = {'id', 'name', 'sub', 'country', 'state', 'currency', 'price', 'multi', 'open', 'close', 'periods',
               'dynamic', 'fromPrice', 'estimated', 'aliases', 'note', 'source', 'shop'}
PERIOD_KEYS = {'from', 'to', 'price', 'label', 'multi'}
PRICE_MIN, PRICE_MAX = 20, 200          # plausible adult 1-day price, in EUR/CHF


def is_date(s):
    if not isinstance(s, str) or not DATE.match(s):
        return False
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f'{where}: {msg}')

    def warn(self, where, msg):
        self.warnings.append(f'{where}: {msg}')


def check_multi(rep, where, multi, day_price):
    if not isinstance(multi, dict):
        rep.err(where, 'multi 必须是 {"天数": 价格} 的对象')
        return
    prev_n, prev_p = 1, day_price
    dearer, cheap = [], []
    for k in sorted(multi, key=lambda k: int(k) if str(k).isdigit() else 0):
        v = multi[k]
        if not str(k).isdigit() or not 2 <= int(k) <= 21:
            rep.err(where, f'multi 的天数 "{k}" 必须是 2–21 的整数')
            continue
        if not is_num(v) or v <= 0:
            rep.err(where, f'multi["{k}"] 必须是正数')
            continue
        n = int(k)
        if prev_p is not None and v < prev_p:
            rep.err(where, f'{n} 天票 {v} 比 {prev_n} 天票 {prev_p} 还便宜，可能填错了')
        elif prev_p is not None and v == prev_p and prev_n > 1:
            # "6 days for the price of 5" offers are common in France
            rep.warn(where, f'{n} 天票和 {prev_n} 天票同价（{v}）——如果是“多送一天”优惠，在 note 里写明即可')
        if day_price is not None and v / n > day_price * 1.05:
            dearer.append(f'{n}天 {v / n:.2f}')
        if day_price is not None and v / n < day_price * 0.5:
            cheap.append(f'{n}天 {v / n:.2f}')
        prev_n, prev_p = n, v
    if dearer:
        rep.warn(where, f'多天票折合每天比一日票 {day_price} 还贵（{", ".join(dearer)}）——如果多天票覆盖更大的区域，在 note 里说明即可')
    if cheap:
        rep.warn(where, f'多天票折合每天不到一日票 {day_price} 的一半（{", ".join(cheap)}），确认一下')


def validate(doc):
    rep = Report()
    if not isinstance(doc, dict):
        rep.err('文件', '顶层必须是对象')
        return rep
    for k in doc:
        if k not in TOP_KEYS:
            rep.warn('顶层', f'未知字段 "{k}"')
    for k in ('season', 'updated', 'resorts'):
        if k not in doc:
            rep.err('顶层', f'缺少 "{k}"')
    if 'updated' in doc and not is_date(doc['updated']):
        rep.err('updated', '必须是 YYYY-MM-DD')
    rng = doc.get('range', {})
    if not (is_date(rng.get('from')) and is_date(rng.get('to')) and rng['from'] < rng['to']):
        rep.err('range', '需要 from / to 两个日期，且 from 早于 to')
    fx = doc.get('fx', {})
    currencies = {'EUR'} | {k for k, v in fx.items() if re.match(r'^[A-Z]{3}$', k) and is_num(v) and v > 0}
    for k, v in fx.items():
        if re.match(r'^[A-Z]{3}$', k) and not (is_num(v) and 0.5 < v < 2):
            rep.err('fx', f'{k} 汇率 {v} 看起来不对（应为 1 {k} 换多少欧元）')
    countries = set((doc.get('countries') or {}).keys()) or {'AT', 'CH', 'FR'}

    seen = set()
    for idx, r in enumerate(doc.get('resorts', [])):
        rid = r.get('id') if isinstance(r, dict) else None
        where = f'resorts[{idx}] {rid or "?"}'
        if not isinstance(r, dict):
            rep.err(where, '必须是对象')
            continue
        for k in r:
            if k not in RESORT_KEYS:
                rep.warn(where, f'未知字段 "{k}"')
        if not isinstance(rid, str) or not ID.match(rid):
            rep.err(where, 'id 必须是小写字母、数字或连字符')
        elif rid in seen:
            rep.err(where, 'id 重复')
        seen.add(rid)
        for k in ('name', 'state'):
            if not isinstance(r.get(k), str) or not r.get(k).strip():
                rep.err(where, f'缺少 {k}')
        country = r.get('country', 'AT')
        if country not in countries:
            rep.err(where, f'country "{country}" 不在 countries 里')
        cur = r.get('currency', 'EUR')
        if cur not in currencies:
            rep.err(where, f'currency "{cur}" 没有对应的 fx 汇率')
        dyn = bool(r.get('dynamic'))
        price = r.get('price')
        if dyn:
            if price is not None:
                rep.warn(where, '动态定价的雪场一般不写 price')
            if 'fromPrice' in r and not (is_num(r['fromPrice']) and 0 < r['fromPrice'] < PRICE_MAX):
                rep.err(where, 'fromPrice 必须是合理的正数')
        elif price is None:
            if 'price' not in r:
                rep.warn(where, '没有 price；如果价格未公布请明确写 null')
        elif not is_num(price) or not PRICE_MIN <= price <= PRICE_MAX:
            rep.err(where, f'price {price} 不在 {PRICE_MIN}–{PRICE_MAX} 之间')
        day_price = price if is_num(price) else None
        if 'multi' in r:
            check_multi(rep, where, r['multi'], day_price)
        for k in ('open', 'close'):
            if k in r and not is_date(r[k]):
                rep.err(where, f'{k} 必须是有效的 YYYY-MM-DD')
        if is_date(r.get('open')) and is_date(r.get('close')) and r['open'] > r['close']:
            rep.err(where, 'open 晚于 close')
        for j, p in enumerate(r.get('periods', []) or []):
            pw = f'{where} periods[{j}]'
            if not isinstance(p, dict):
                rep.err(pw, '必须是对象')
                continue
            for k in p:
                if k not in PERIOD_KEYS:
                    rep.warn(pw, f'未知字段 "{k}"')
            if not (is_date(p.get('from')) and is_date(p.get('to')) and p['from'] <= p['to']):
                rep.err(pw, '需要有效的 from / to，且 from 不晚于 to')
            if 'price' not in p and 'multi' not in p:
                rep.err(pw, '至少要有 price 或 multi')
            if 'price' in p and not (is_num(p['price']) and PRICE_MIN <= p['price'] <= PRICE_MAX):
                rep.err(pw, f'price {p.get("price")} 不在 {PRICE_MIN}–{PRICE_MAX} 之间')
            if 'multi' in p:
                check_multi(rep, pw, p['multi'], p.get('price', day_price) if is_num(p.get('price', day_price)) else None)
        if 'aliases' in r and not (isinstance(r['aliases'], list) and all(isinstance(a, str) for a in r['aliases'])):
            rep.err(where, 'aliases 必须是字符串列表')
        if 'source' in r and not str(r['source']).startswith(('http://', 'https://')):
            rep.err(where, 'source 必须是网址')
        if 'shop' not in r:
            rep.warn(where, '没有 shop（官网购票链接）')
        elif not str(r['shop']).startswith('https://'):
            rep.err(where, 'shop 必须是 https:// 开头的官网网址')
    check_passes(rep, doc.get('passes', []), seen, currencies)
    return rep


def check_passes(rep, passes, resort_ids, currencies):
    if not isinstance(passes, list):
        rep.err('passes', '必须是列表')
        return
    seen = set()
    for idx, p in enumerate(passes):
        pid = p.get('id') if isinstance(p, dict) else None
        where = f'passes[{idx}] {pid or "?"}'
        if not isinstance(p, dict):
            rep.err(where, '必须是对象')
            continue
        for k in p:
            if k not in PASS_KEYS:
                rep.warn(where, f'未知字段 "{k}"')
        if not isinstance(pid, str) or not ID.match(pid):
            rep.err(where, 'id 必须是小写字母、数字或连字符')
        elif pid in seen:
            rep.err(where, 'id 重复')
        seen.add(pid)
        if not isinstance(p.get('name'), str) or not p['name'].strip():
            rep.err(where, '缺少 name')
        if p.get('country') not in PASS_COUNTRIES:
            rep.err(where, f'country 必须是 {sorted(PASS_COUNTRIES)} 之一')
        cur = p.get('currency', 'EUR')
        if cur not in currencies:
            rep.err(where, f'currency "{cur}" 没有对应的 fx 汇率')
        if not (is_num(p.get('price')) and PASS_MIN <= p['price'] <= PASS_MAX):
            rep.err(where, f'price {p.get("price")} 不在 {PASS_MIN}–{PASS_MAX} 之间')
        if p.get('earlyPrice') is not None:
            if not (is_num(p['earlyPrice']) and 0 < p['earlyPrice'] <= p.get('price', 0)):
                rep.err(where, 'earlyPrice 必须是正数，且不高于 price')
            if 'earlyUntil' in p and p['earlyUntil'] is not None and not is_date(p['earlyUntil']):
                rep.err(where, 'earlyUntil 必须是 YYYY-MM-DD')
        unknown = [r for r in p.get('resorts', []) if r not in resort_ids]
        if unknown:
            rep.err(where, f'resorts 里有不存在的雪场 id：{", ".join(unknown)}')
        if not str(p.get('url', 'https://')).startswith('https://'):
            rep.err(where, 'url 必须是 https:// 开头')


def diff(old, new):
    """Human-readable list of changes, for the pull request description."""
    o = {r['id']: r for r in old.get('resorts', []) if isinstance(r, dict) and 'id' in r}
    n = {r['id']: r for r in new.get('resorts', []) if isinstance(r, dict) and 'id' in r}
    lines, warn = [], []
    op = {p['id']: p for p in old.get('passes', []) if isinstance(p, dict) and 'id' in p}
    for p in new.get('passes', []):
        if isinstance(p, dict) and p.get('id') in op:
            for k in ('price', 'earlyPrice', 'season', 'resorts'):
                if op[p['id']].get(k) != p.get(k):
                    lines.append(f'通票 {p["id"]}: {k} {json.dumps(op[p["id"]].get(k), ensure_ascii=False)} → {json.dumps(p.get(k), ensure_ascii=False)}')
        elif isinstance(p, dict):
            lines.append(f'新增通票 {p.get("id")}（{p.get("name")}）')
    for rid in sorted(o.keys() - n.keys()):
        warn.append(f'删除了雪场 {rid}（{o[rid].get("name")}）—— 已有的滑雪记录仍保留名字，但不再自动填价')
    for rid in sorted(n.keys() - o.keys()):
        lines.append(f'新增 {rid}（{n[rid].get("name")}）')
    for rid in sorted(o.keys() & n.keys()):
        a, b = o[rid], n[rid]
        for k in ('price', 'fromPrice', 'open', 'close', 'dynamic', 'multi', 'periods', 'shop'):
            if a.get(k) != b.get(k):
                lines.append(f'{rid}: {k} {json.dumps(a.get(k), ensure_ascii=False)} → {json.dumps(b.get(k), ensure_ascii=False)}')
                if k == 'price' and is_num(a.get(k)) and is_num(b.get(k)) and abs(b[k] - a[k]) / a[k] > 0.15:
                    warn.append(f'{rid} 一日票变化超过 15%（{a[k]} → {b[k]}），请重点核对')
    return lines, warn


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file', nargs='?', default=str(ROOT / 'prices.json'))
    ap.add_argument('--old', help='旧版 prices.json，用来列出改动')
    args = ap.parse_args()
    try:
        doc = json.loads(Path(args.file).read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        print(f'✗ JSON 格式错误：第 {e.lineno} 行第 {e.colno} 列：{e.msg}')
        sys.exit(1)
    rep = validate(doc)
    n = len(doc.get('resorts', []))
    by_country = {}
    for r in doc.get('resorts', []):
        by_country[r.get('country', 'AT')] = by_country.get(r.get('country', 'AT'), 0) + 1
    print(f'{args.file}: {n} 个雪场 {by_country}')
    if args.old:
        old = json.loads(Path(args.old).read_text(encoding='utf-8'))
        lines, warn = diff(old, doc)
        print(f'\n改动（{len(lines)} 处）：')
        for line in lines:
            print('  ·', line)
        rep.warnings.extend(warn)
    for w in rep.warnings:
        print('⚠', w)
    for e in rep.errors:
        print('✗', e)
    print(f'\n{len(rep.errors)} 个错误，{len(rep.warnings)} 个提醒')
    sys.exit(1 if rep.errors else 0)


if __name__ == '__main__':
    main()
