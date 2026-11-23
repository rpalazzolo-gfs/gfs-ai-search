#!/usr/bin/env python3
"""GFS AI search prototype server (stdlib only).

  GET  /search?q=...        -> ranked products (part-number match + keyword/typo-tolerant + brand aware)
  POST /ask  {"q": "..."}   -> natural-language answer built from the top matches (needs ANTHROPIC_API_KEY in .env)
  GET  /                    -> demo page,  GET /ai-search.js -> the search-box widget

Run:  python3 -I server.py        (default http://127.0.0.1:8787)
"""
import bisect, difflib, json, math, os, re, sqlite3, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
DATA_DIR = os.environ.get('DATA_DIR', HERE)
DB_PATH = os.path.join(DATA_DIR, 'catalog.db')
PORT = int(os.environ.get('PORT', '8787'))
HOST = os.environ.get('HOST', '127.0.0.1')
MODEL = 'claude-haiku-5-5'


def load_env():
    env = dict(os.environ)
    p = os.path.join(HERE, '.env')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
API_KEY = ENV.get('ANTHROPIC_API_KEY', '')
ALLOWED_ORIGINS = [o.strip().rstrip('/') for o in ENV.get('ALLOWED_ORIGINS', '*').split(',') if o.strip()]
ASK_PER_IP_HOUR = int(ENV.get('ASK_PER_IP_HOUR', '20'))      # Ask AI questions per visitor per hour
ASK_DAILY_CAP = int(ENV.get('ASK_DAILY_CAP', '1000'))        # Ask AI questions per day, all visitors

# ------------------------------------------------------------------ helpers
STOP = set('a an the for of to and or with in on my i do you have need what which is are that will fit fits does how can me '
           'looking want best any your it this get show find please there some one'.split())
SYNONYMS = {
    'atg': ['automatic tank gauge', 'tank gauge'],
    'def': ['diesel exhaust fluid'],
    'breakaway': ['breakaway', 'break-away'],
    'filter': ['filter', 'element'],
    'gas': ['gasoline', 'gas'],
    'dispenser': ['dispenser', 'pump'],
    'hose': ['hose'],
}


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def looks_like_pn(tok):
    t = tok.strip().strip(',.;:()"\'')
    n = norm(t)
    digits = sum(c.isdigit() for c in n)
    return len(n) >= 3 and (digits >= 2 or (len(n) >= 5 and digits >= 1))


class Engine:
    def __init__(self):
        self.lock = threading.Lock()
        self.reload()

    def conn(self):
        c = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True, check_same_thread=False)
        c.row_factory = sqlite3.Row
        return c

    def reload(self):
        self.ready = os.path.exists(DB_PATH)
        if not self.ready:
            self.vocab, self.vocab_sorted, self.brands, self.count = set(), [], {}, 0
            return
        c = self.conn()
        from collections import Counter
        cnt = Counter()
        for r in c.execute('select name, brand, categories from products'):
            for fld in r:
                cnt.update(set(re.findall(r'[a-z0-9]+', (fld or '').lower())))
        self.vocab = {t for t, n in cnt.items() if n >= 2 and not t.isdigit()}
        self.vocab_sorted = sorted(self.vocab)
        self.brands = {}
        for r in c.execute("select distinct brand from products where brand<>''"):
            self.brands[norm(r['brand'])] = r['brand']
        self.count = c.execute('select count(*) from products').fetchone()[0]
        c.close()

    # ---- typo tolerance
    def correct(self, tok, is_last):
        if len(tok) < 4 or tok in self.vocab or tok.isdigit():
            return tok, False
        if is_last:  # typeahead: fine if some term starts with it
            i = bisect.bisect_left(self.vocab_sorted, tok)
            if i < len(self.vocab_sorted) and self.vocab_sorted[i].startswith(tok):
                return tok, False
        cands = [t for t in self.vocab_sorted if t[0] == tok[0] and abs(len(t) - len(tok)) <= 2]
        m = difflib.get_close_matches(tok, cands, n=1, cutoff=0.8)
        return (m[0], True) if m else (tok, False)

    # ---- search
    def search(self, q, limit=12):
        q = (q or '').strip()[:200]
        info = {'corrections': [], 'part_numbers': [], 'brand': None}
        if not q or not self.ready:
            return {'results': [], 'interpretation': info}
        raw_tokens = q.split()
        c = self.conn()
        scores, why = {}, {}

        def bump(pid, s, label):
            if s > scores.get(pid, 0):
                scores[pid] = s; why[pid] = label
            elif pid in scores:
                scores[pid] += 1

        # 1) part numbers (exact / prefix / contains), plus the whole query squashed ("70012 300 30")
        pn_tokens = [t.strip(',.;:()"\'') for t in raw_tokens if looks_like_pn(t)]
        squashed = norm(q)
        digit_share = sum(c.isdigit() for c in squashed) / max(len(squashed), 1)
        if (2 <= len(raw_tokens) <= 4 and len(squashed) >= 5 and digit_share >= 0.5
                and squashed not in [norm(t) for t in pn_tokens]):
            pn_tokens.append(q)
        for t in pn_tokens:
            n = norm(t)
            if len(n) < 3:
                continue
            info['part_numbers'].append(t)
            kind_w = {'sku': 1000, 'mpn': 950, 'variant': 900, 'upc': 900, 'xref': 420}
            for r in c.execute('select product_id, kind from pn where norm=?', (n,)):
                lab = 'cross_reference' if r['kind'] == 'xref' else 'part_number'
                bump(r['product_id'], kind_w[r['kind']], lab)
            if len(n) >= 4:
                for r in c.execute("select product_id, kind from pn where norm like ? and norm<>? and kind<>'xref' limit 80", (n + '%', n)):
                    bump(r['product_id'], 620, 'part_number_partial')
            if len(n) >= 5:
                for r in c.execute("select product_id from pn where norm like ? and norm not like ? and kind<>'xref' limit 60", ('%' + n + '%', n + '%')):
                    bump(r['product_id'], 330, 'part_number_partial')

        # 2) keyword search (FTS5/BM25), brand aware, typo tolerant, synonyms
        words = []
        for i, t in enumerate(raw_tokens):
            if looks_like_pn(t):
                continue
            w = re.sub(r'[^a-z0-9]', '', t.lower())
            if not w or w in STOP:
                continue
            words.append(w)
        groups = []
        for i, w in enumerate(words):
            is_last = (i == len(words) - 1)
            w2, fixed = self.correct(w, is_last)
            if fixed:
                info['corrections'].append([w, w2])
            alts = [w2] + [s for s in SYNONYMS.get(w2, []) if s != w2]
            pieces = []
            for a in alts:
                phrase = ' '.join(re.findall(r'[a-z0-9]+', a))
                if phrase:
                    pieces.append('"%s"%s' % (phrase, '*' if (is_last and a == w2) else ''))
            if pieces:
                groups.append('(' + ' OR '.join(pieces) + ')')
        # brand: look at windows of 1-3 words ("veeder root", "cim tek", "franklin fueling")
        wl = [self.correct(w, False)[0] for w in words]
        for size in (3, 2, 1):
            for i in range(len(wl) - size + 1):
                nw = norm(''.join(wl[i:i + size]))
                if len(nw) < 3 or info['brand']:
                    continue
                if nw in self.brands:
                    info['brand'] = self.brands[nw]
                elif len(nw) >= 6:
                    cands = [b for k, b in self.brands.items() if k.startswith(nw)]
                    if len(cands) == 1:
                        info['brand'] = cands[0]
        # pn tokens also participate as phrases against names/specs
        for t in pn_tokens:
            parts = re.findall(r'[a-z0-9]+', t.lower())
            if parts and len(parts) > 1:
                groups.append('("%s")' % ' '.join(parts))
        fts_hits = {}
        if groups:
            def run(expr, cap):
                try:
                    rows = c.execute('select rowid, bm25(fts, 10, 6, 3, 8, 2, 1) as r from fts where fts match ? order by r limit ?', (expr, cap)).fetchall()
                except sqlite3.OperationalError:
                    return []
                return rows
            rows = run(' AND '.join(groups), 150)
            if len(rows) < 8 and len(groups) > 1:
                more = run(' OR '.join(groups), 150)
                seen = {r['rowid'] for r in rows}
                rows += [r for r in more if r['rowid'] not in seen]
            if rows:
                best = max(-r['r'] for r in rows) or 1
                for r in rows:
                    fts_hits[r['rowid']] = 100.0 * (-r['r']) / best
        phrase_hits = set()
        pairs = ['%s %s' % (words[i], words[i + 1]) for i in range(len(words) - 1)
                 if any(ch.isdigit() for ch in words[i] + words[i + 1])]
        for ph in pairs[:3]:
            try:
                for r in c.execute('select rowid from fts where fts match ? limit 300', ('name : "%s"' % ph,)):
                    phrase_hits.add(r['rowid'])
            except sqlite3.OperationalError:
                pass
        for pid, s in fts_hits.items():
            scores[pid] = scores.get(pid, 0) + s
            why.setdefault(pid, 'keyword')

        if not scores:
            c.close()
            return {'results': [], 'interpretation': info}

        ids = list(scores)
        marks = ','.join('?' * len(ids))
        rows = {r['id']: r for r in c.execute(f'select * from products where id in ({marks})', ids)}
        c.close()
        ranked = []
        for pid, s in scores.items():
            r = rows.get(pid)
            if not r:
                continue
            bonus = 0
            name_l = ((r['name'] or '') + ' ' + (r['brand'] or '')).lower()
            if words:
                cov = sum(1 for w in words if w in name_l) / len(words)
                bonus += 70 * cov + (25 if cov == 1 else 0)
            if pid in phrase_hits:
                bonus += 45
            if info['brand'] and r['brand'] == info['brand']:
                bonus += 20
            if (r['stock'] or 0) > 0:
                bonus += 8
            bonus += 4 * math.log1p(r['sold'] or 0)
            ranked.append((s + bonus, pid))
        ranked.sort(reverse=True)
        out = []
        for _, pid in ranked[:limit]:
            r = rows[pid]
            out.append({
                'id': pid, 'name': r['name'], 'sku': r['sku'], 'brand': r['brand'], 'price': r['price'],
                'sale_price': r['sale_price'], 'url': r['url'], 'image': r['image'], 'in_stock': (r['stock'] or 0) > 0,
                'match': why.get(pid, 'keyword'), 'categories': (r['categories'] or '').split(' > ')[:2],
            })
        return {'results': out, 'interpretation': info}

    def product_facts(self, ids):
        c = self.conn()
        marks = ','.join('?' * len(ids))
        rows = {r['id']: r for r in c.execute(f'select * from products where id in ({marks})', ids)}
        c.close()
        return [rows[i] for i in ids if i in rows]


ENGINE = Engine()
INDEX_STATE = {'building': False, 'last_built': None, 'error': None}


def rebuild_index():
    """Re-pull the catalog and swap in the new index (runs in a background thread)."""
    if INDEX_STATE['building']:
        return
    INDEX_STATE['building'] = True
    try:
        import sync
        print('index rebuild started', flush=True)
        sync.main()
        ENGINE.reload()
        INDEX_STATE.update(last_built=int(time.time()), error=None)
        print(f'index rebuild done: {ENGINE.count} products', flush=True)
    except BaseException as e:   # keep serving the old index if a rebuild fails
        INDEX_STATE['error'] = str(e)[:300]
        print('index rebuild FAILED:', e, file=sys.stderr, flush=True)
    finally:
        INDEX_STATE['building'] = False


def index_scheduler():
    """Build at start-up if there is no (or a stale) index, then refresh nightly at ~03:00 UTC."""
    import sync
    if not sync.TOKEN:
        print('BC_ACCESS_TOKEN not set: index will not be built', file=sys.stderr, flush=True)
        return
    if os.path.exists(DB_PATH):
        age = time.time() - os.path.getmtime(DB_PATH)
        INDEX_STATE['last_built'] = int(os.path.getmtime(DB_PATH))
        if age > 26 * 3600:
            rebuild_index()
    else:
        rebuild_index()
    last_day = time.strftime('%Y-%m-%d', time.gmtime())
    while True:
        time.sleep(300)
        now = time.gmtime()
        if now.tm_hour == 3 and time.strftime('%Y-%m-%d', now) != last_day:
            last_day = time.strftime('%Y-%m-%d', now)
            rebuild_index()


# --- simple abuse limits for Ask AI (in memory; resets on restart)
_ask_ip, _ask_day = {}, {'day': '', 'n': 0}
_ask_lock = threading.Lock()


def ask_allowed(ip):
    with _ask_lock:
        today = time.strftime('%Y-%m-%d', time.gmtime())
        if _ask_day['day'] != today:
            _ask_day.update(day=today, n=0)
        if _ask_day['n'] >= ASK_DAILY_CAP:
            return False, 'Ask AI has reached its daily limit. The regular search still works.'
        hits = [t for t in _ask_ip.get(ip, []) if time.time() - t < 3600]
        if len(hits) >= ASK_PER_IP_HOUR:
            _ask_ip[ip] = hits
            return False, 'You have asked a lot of questions this hour. Please try again later.'
        hits.append(time.time()); _ask_ip[ip] = hits; _ask_day['n'] += 1
        return True, ''

# ------------------------------------------------------------------ AI layer (Claude)
SYSTEM_BASE = ('You work for Global Fueling Systems (GFS), an online store for fuel dispensing and fuel management equipment '
               '(brands include Veeder-Root, OPW, Franklin Fueling Systems, Gilbarco, Wayne, Cim-Tek, Husky, Piusi, GPI, Velcon).')


def claude(system, user, max_tokens=500):
    body = json.dumps({'model': MODEL, 'max_tokens': max_tokens, 'system': system,
                       'messages': [{'role': 'user', 'content': user}]}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, method='POST', headers={
        'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.loads(r.read())
    return ''.join(b.get('text', '') for b in d.get('content', []) if b.get('type') == 'text')


def parse_json(text):
    m = re.search(r'\{.*\}', text, re.S)
    return json.loads(m.group(0)) if m else {}


QUESTION_WORDS = ('what', 'which', 'how', 'do you', 'does', 'can i', 'will', 'need', 'looking for', 'best', 'compatible', 'fit', 'replace', 'difference', '?')


def is_natural_language(q):
    ql = q.lower()
    return len(q.split()) >= 4 or any(w in ql for w in QUESTION_WORDS)


def understand(q):
    """Turn a natural-language request into search terms. Falls back to the raw query without an API key."""
    if not API_KEY or not is_natural_language(q):
        return None
    try:
        out = parse_json(claude(
            SYSTEM_BASE + ' You turn a shopper message into store-search terms. Reply with ONLY JSON: '
            '{"terms": ["product-type and spec words, no filler"], "brand": "brand or null", "part_numbers": ["any part numbers"]}',
            q, 200))
        terms = [str(t) for t in out.get('terms', [])][:8]
        if out.get('brand') and out['brand'] != 'null':
            terms.append(str(out['brand']))
        terms += [str(p) for p in out.get('part_numbers', [])][:4]
        return ' '.join(terms).strip() or None
    except Exception as e:
        print('understand() failed:', e, file=sys.stderr)
        return None


def ask(q):
    rewritten = understand(q) or q
    res = ENGINE.search(rewritten, limit=10)
    data = {'query': q, 'rewritten': rewritten, 'results': res['results'], 'interpretation': res['interpretation'], 'answer': None, 'products': []}
    if not API_KEY:
        data['note'] = 'AI answers are switched off: add ANTHROPIC_API_KEY to the .env file next to server.py and restart.'
        return data
    facts = ENGINE.product_facts([r['id'] for r in res['results']])
    lines = []
    for r in facts:
        price = f"${r['sale_price'] or r['price']:.2f}" if (r['sale_price'] or r['price']) else 'call'
        lines.append(f"[{r['id']}] {r['name']} | SKU {r['sku']} | brand {r['brand']} | {price} | "
                     f"{'in stock' if (r['stock'] or 0) > 0 else 'drop-shipped / ships from manufacturer'} | specs: {(r['specs'] or '')[:260]} | {(r['descr'] or '')[:260]}")
    try:
        out = parse_json(claude(
            SYSTEM_BASE + ' Answer the shopper using ONLY the candidate products below. Be brief (max 90 words), practical and friendly. '
            'If the candidates do not clearly answer the question, say so and suggest contacting the GFS team. Never invent specs, prices or compatibility. '
            'Reply with ONLY JSON: {"answer": "text", "product_ids": [up to 4 candidate ids, best first]}',
            f'Shopper question: {q}\n\nCandidate products:\n' + '\n'.join(lines), 500))
        data['answer'] = out.get('answer')
        ids = [int(i) for i in out.get('product_ids', []) if str(i).isdigit()]
        by_id = {r['id']: r for r in res['results']}
        data['products'] = [by_id[i] for i in ids if i in by_id][:4]
    except Exception as e:
        data['note'] = f'AI step failed: {e}'
    return data


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _origin(self):
        o = (self.headers.get('Origin') or '').rstrip('/')
        if '*' in ALLOWED_ORIGINS:
            return '*'
        return o if o in ALLOWED_ORIGINS else (ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else '*')

    def _ip(self):
        xff = self.headers.get('X-Forwarded-For')
        return (xff.split(',')[0].strip() if xff else self.client_address[0])

    def _send(self, code, body, ctype='application/json'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', self._origin())
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        # echo whatever headers the browser asks for (the BigCommerce storefront adds x-sf-csrf-token to its requests)
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers') or 'content-type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b'', 'text/plain')

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path == '/search':
            q = qs.get('q', [''])[0]
            t0 = time.time()
            res = ENGINE.search(q, limit=int(qs.get('limit', ['12'])[0]))
            res['ms'] = round((time.time() - t0) * 1000)
            res['ai'] = bool(API_KEY)
            try:
                with open(os.path.join(DATA_DIR, 'queries.log'), 'a', encoding='utf-8') as f:
                    f.write(json.dumps({'t': int(time.time()), 'q': q, 'n': len(res['results'])}) + '\n')
            except OSError:
                pass
            if not ENGINE.ready:
                res['error'] = 'index_building'
            return self._send(200, res)
        if u.path == '/health':
            return self._send(200, {'ok': True, 'products': ENGINE.count, 'ai': bool(API_KEY), 'model': MODEL if API_KEY else None,
                                    'index': {'ready': ENGINE.ready, **INDEX_STATE}})
        if u.path in ('/', '/index.html'):
            return self._send(200, open(os.path.join(HERE, 'demo.html'), encoding='utf-8').read(), 'text/html')
        if u.path == '/ai-search.js':
            return self._send(200, open(os.path.join(HERE, 'ai-search.js'), encoding='utf-8').read(), 'application/javascript')
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        if urlparse(self.path).path != '/ask':
            return self._send(404, {'error': 'not found'})
        n = int(self.headers.get('Content-Length') or 0)
        try:
            q = (json.loads(self.rfile.read(n) or b'{}').get('q') or '').strip()[:300]
        except Exception:
            q = ''
        if not q:
            return self._send(400, {'error': 'missing q'})
        ok, why = ask_allowed(self._ip())
        if not ok:
            res = ENGINE.search(q, limit=8)
            return self._send(200, {'query': q, 'answer': None, 'note': why, 'results': res['results'], 'interpretation': res['interpretation'], 'products': []})
        t0 = time.time()
        data = ask(q)
        data['ms'] = round((time.time() - t0) * 1000)
        self._send(200, data)


if __name__ == '__main__':
    print(f'GFS AI search: {ENGINE.count} products | AI answers: {"ON (" + MODEL + ")" if API_KEY else "OFF (no ANTHROPIC_API_KEY in .env)"}')
    threading.Thread(target=index_scheduler, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
