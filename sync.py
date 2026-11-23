#!/usr/bin/env python3
"""Pull the sandbox catalog from the BigCommerce API into a local SQLite search index (catalog.db)."""
import json, os, re, sqlite3, sys, time, html, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR', HERE)
DB = os.path.join(DATA_DIR, 'catalog.db')
STORE = os.environ.get('BC_STORE_HASH', '30u8hht1vo')          # sandbox by default for local runs
def _token():
    if os.environ.get('BC_ACCESS_TOKEN'):
        return os.environ['BC_ACCESS_TOKEN']
    f = os.environ.get('BC_TOKEN_FILE')      # optional: a stencil secrets.stencil.json file (local development)
    return json.load(open(f))['accessToken'] if f and os.path.exists(f) else ''
TOKEN = _token()
BASE = f'https://api.bigcommerce.com/stores/{STORE}/v3'
HDR = {'X-Auth-Token': TOKEN, 'Accept': 'application/json'}
LIMIT_PAGES = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None   # quick tests

def get(path, **params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    url = f'{BASE}{path}?{q}'
    for attempt in range(6):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=90)
            return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get('X-Rate-Limit-Time-Reset-Ms', '3000')) / 1000 + 0.5
                time.sleep(wait); continue
            if e.code >= 500:
                time.sleep(2 + attempt * 2); continue
            raise
        except Exception:
            time.sleep(2 + attempt * 2)
    raise RuntimeError('too many retries: ' + url)

def pages(path, **params):
    page = 1
    while True:
        d = get(path, limit=250, page=page, **params)
        yield from d['data']
        total = d['meta']['pagination']['total_pages']
        print(f'  {path} page {page}/{total}', flush=True)
        if page >= total or (LIMIT_PAGES and page >= LIMIT_PAGES):
            break
        page += 1

def strip_html(s):
    s = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s or '', flags=re.S | re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()

def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

XREF_FIELDS = {'fits these products', 'replacement parts', 'replacement parts tab', 'accessories tab',
               'alternative', 'newer model', 'this-replaces', 'table products tab', 'core_product'}

def main():
    if not TOKEN:
        raise SystemExit('No BigCommerce token: set BC_ACCESS_TOKEN (and BC_STORE_HASH).')
    print('brands...'); brands = {b['id']: b['name'] for b in pages('/catalog/brands')}
    print('categories...'); cats = {c['id']: c['name'] for c in pages('/catalog/categories')}
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DB + '.building'
    if os.path.exists(tmp): os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript('''
    CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, sku TEXT, mpn TEXT, upc TEXT, brand TEXT, categories TEXT,
        url TEXT, price REAL, sale_price REAL, stock INTEGER, tracked TEXT, image TEXT, descr TEXT, specs TEXT, xref TEXT,
        sold INTEGER, availability TEXT);
    CREATE TABLE pn(norm TEXT, product_id INTEGER, kind TEXT, raw TEXT);
    CREATE INDEX pn_norm ON pn(norm);
    ''')
    n = 0
    for p in pages('/catalog/products', include='custom_fields,variants,primary_image', is_visible='true'):
        cf = p.get('custom_fields') or []
        specs = '; '.join(f"{c['name']}: {c['value']}" for c in cf
                          if not c['name'].startswith('__') and not c['name'].startswith('**'))
        xref = ' '.join(c['value'] for c in cf if c['name'].strip().lower() in XREF_FIELDS)
        catnames = ' > '.join(cats.get(i, '') for i in (p.get('categories') or [])[:8])
        img = (p.get('primary_image') or {}).get('url_thumbnail') or ''
        brand = brands.get(p.get('brand_id'), '')
        url = (p.get('custom_url') or {}).get('url') or ''
        db.execute('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
            p['id'], p['name'], p.get('sku'), p.get('mpn'), p.get('upc'), brand, catnames, url,
            p.get('price'), p.get('sale_price') or None, p.get('inventory_level'), p.get('inventory_tracking'),
            img, strip_html(p.get('description'))[:4000], specs, xref, p.get('total_sold'), p.get('availability')))
        seen = set()
        def add(raw, kind):
            for part in re.split(r'[,\s;|]+', str(raw or '')):
                nn = norm(part)
                if len(nn) >= 3 and (nn, kind) not in seen:
                    seen.add((nn, kind)); db.execute('INSERT INTO pn VALUES (?,?,?,?)', (nn, p['id'], kind, part))
        add(p.get('sku'), 'sku'); add(p.get('mpn'), 'mpn'); add(p.get('upc'), 'upc'); add(p.get('gtin'), 'upc')
        for v in p.get('variants') or []:
            add(v.get('sku'), 'variant'); add(v.get('mpn'), 'mpn'); add(v.get('upc'), 'upc')
        add(xref, 'xref')
        n += 1
        if n % 2000 == 0: db.commit()
    db.commit()
    db.executescript('''
    CREATE VIRTUAL TABLE fts USING fts5(name, brand, categories, skus, specs, descr,
        tokenize="porter unicode61 remove_diacritics 2", prefix="2 3 4");
    INSERT INTO fts(rowid, name, brand, categories, skus, specs, descr)
        SELECT p.id, p.name, p.brand, p.categories,
               COALESCE(p.sku,'')||' '||COALESCE(p.mpn,'')||' '||COALESCE((SELECT group_concat(raw,' ') FROM pn WHERE product_id=p.id AND kind IN ('variant')),''),
               p.specs, p.descr FROM products p;
    CREATE VIRTUAL TABLE vocab USING fts5vocab(fts, 'row');
    ''')
    db.commit()
    print('indexed products:', n, '| part-number keys:', db.execute('select count(*) from pn').fetchone()[0], flush=True)
    db.close()
    os.replace(tmp, DB)   # atomic swap: readers never see a half-built index
    return n

if __name__ == '__main__':
    main()
