/*! GFS AI search widget: full-screen search panel (same layout idea as the current site search).
 *  GFSAISearch.attach(inputElement, { api: 'https://...', siteBase: location.origin, searchPage: '/search.php?search_query=' })
 *  Clicking or typing in the attached input opens the panel: search box, latest searches, popular searches and
 *  recommended products; as you type it shows part-number matches, typo-corrected keyword results, brand filters
 *  and an "Ask AI" option.
 */
(function () {
  'use strict';

  var CSS = '\
.gfsai-ov{position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;background:#f3f4f4;overflow-y:auto;display:none;font-family:inherit;color:#323232;-webkit-overflow-scrolling:touch}\
.gfsai-ov.is-open{display:block}\
.gfsai-wrap{max-width:1500px;margin:0 auto;padding:14px 10px 60px}\
.gfsai-bar{display:flex;align-items:center;background:#fff;height:60px;padding:0 12px 0 18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}\
.gfsai-bar svg{flex:0 0 22px;width:22px;height:22px;fill:#1a1a1a;margin-right:14px}\
.gfsai-bar input{flex:1;border:0;outline:0;background:transparent;font:inherit;font-size:22px;color:#323232;height:58px;min-width:0;padding:0;box-shadow:none}\
.gfsai-bar input::placeholder{color:#9b9b9b}\
.gfsai-close{flex:0 0 44px;height:44px;border:0;background:transparent;cursor:pointer;font-size:30px;line-height:1;color:#6b6b6b;border-radius:50%}\
.gfsai-close:hover{background:#f0f0f0;color:#1a1a1a}\
.gfsai-recent{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:18px 2px 6px;font-size:13px}\
.gfsai-recent b{font-weight:700;margin-right:2px}\
.gfsai-chip{display:inline-flex;align-items:center;gap:10px;background:#e9ebeb;border-radius:20px;padding:6px 8px 6px 14px;cursor:pointer;color:#323232}\
.gfsai-chip:hover{background:#dfe2e2}\
.gfsai-chip i{font-style:normal;width:16px;height:16px;line-height:15px;text-align:center;font-weight:700;color:#1a1a1a;border-radius:50%}\
.gfsai-chip i:hover{background:#c9cdcd}\
.gfsai-link{background:none;border:0;padding:0;color:#10ab71;cursor:pointer;font:inherit;font-size:13px}\
.gfsai-cols{display:flex;gap:28px;margin-top:22px;align-items:flex-start}\
.gfsai-left{flex:0 0 285px;background:#fff;padding:16px 16px 22px}\
.gfsai-right{flex:1;min-width:0}\
.gfsai-h{font-size:17px;font-weight:700;margin:0 0 14px;color:#1a1a1a}\
.gfsai-list{list-style:none;margin:0;padding:0}\
.gfsai-list li{margin:0}\
.gfsai-list button{display:block;width:100%;text-align:left;background:none;border:0;padding:8px 0;font:inherit;font-size:14px;color:#323232;cursor:pointer}\
.gfsai-list button:hover{color:#10ab71}\
.gfsai-list button.is-on{color:#10ab71;font-weight:700}\
.gfsai-list .n{color:#9b9b9b;font-size:12px;margin-left:6px}\
.gfsai-row{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:6px;scrollbar-width:thin}\
.gfsai-row .gfsai-card{flex:0 0 220px;scroll-snap-align:start}\
.gfsai-carwrap{position:relative}\
.gfsai-arrow{position:absolute;top:44%;left:-34px;width:30px;height:44px;border:0;background:transparent;color:#10ab71;font-size:34px;cursor:pointer;line-height:1}\
.gfsai-arrow.r{left:auto;right:-6px}\
.gfsai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:12px}\
.gfsai-card{position:relative;display:flex;flex-direction:column;background:#fff;padding:12px 14px 16px;text-decoration:none;color:#323232;min-height:310px}\
.gfsai-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.12)}\
.gfsai-cimg{height:190px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}\
.gfsai-cimg img{max-width:100%;max-height:190px;display:block}\
.gfsai-ctitle{font-size:13px;line-height:20px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:12px}\
.gfsai-cbrand{font-size:12px;color:#9b9b9b;margin-bottom:2px}\
.gfsai-cprice{margin-top:auto;font-size:14px;font-weight:700;color:#1a1a1a}\
.gfsai-cprice s{color:#9b9b9b;font-weight:500;margin-right:6px}\
.gfsai-cprice.is-sale{color:#e95144}\
.gfsai-cstock{font-size:11px;margin-top:4px;font-weight:600;color:#10ab71}\
.gfsai-cstock.ship{color:#9b9b9b;font-weight:400}\
.gfsai-tag{position:absolute;left:10px;top:10px;z-index:1;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:2px;line-height:16px}\
.gfsai-t-pn{background:#10ab71;color:#fff}.gfsai-t-part{background:#d9efe6;color:#0d7a52}.gfsai-t-xref{background:#fbe6a8;color:#6b4a00}\
.gfsai-ask{display:flex;align-items:center;gap:12px;background:#fff;padding:14px 16px;margin-bottom:14px;cursor:pointer;font-weight:600;font-size:14px;border-left:4px solid #10ab71}\
.gfsai-ask:hover{background:#f3fbf7}.gfsai-ask span.sp{color:#10ab71;font-size:18px}\
.gfsai-note{margin:0 0 12px;font-size:13px;color:#646464}.gfsai-note b{color:#1a1a1a}\
.gfsai-ans{background:#fff;padding:16px 18px;margin-bottom:16px;font-size:14px;line-height:1.6;border-left:4px solid #10ab71}\
.gfsai-ans small{display:block;margin-bottom:6px;color:#10ab71;font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:11px}\
.gfsai-empty{background:#fff;padding:22px;color:#646464}\
.gfsai-more{display:block;margin:20px auto 0;text-align:center}\
.gfsai-more a{display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600;padding:12px 26px;font-size:14px}\
@media (max-width:900px){.gfsai-cols{flex-direction:column;gap:18px}.gfsai-left{flex:none;width:100%;box-sizing:border-box}.gfsai-bar input{font-size:18px}.gfsai-arrow{display:none}.gfsai-row .gfsai-card{flex-basis:170px}.gfsai-grid{grid-template-columns:repeat(2,1fr)}.gfsai-card{min-height:280px}.gfsai-cimg{height:140px}.gfsai-cimg img{max-height:140px}}';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Call'; }
  function isQuestion(q) { return q.trim().split(/\s+/).length >= 4 || /\?|^(what|which|how|do you|does|can i|will|need)\b/i.test(q); }
  var SEARCH_ICON = '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';

  var RECENT_KEY = 'gfsai.recent';
  function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
  function setRecent(a) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 10))); } catch (e) { /* storage blocked */ } }
  function addRecent(q) { q = q.trim(); if (q.length < 2) return; var a = getRecent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); }); a.unshift(q); setRecent(a); }

  var ov = null;   // single shared overlay

  function attach(input, opts) {
    opts = opts || {};
    var api = (opts.api || 'http://127.0.0.1:8787').replace(/\/$/, '');
    var site = (opts.siteBase || 'https://globalfuelingsystems.com').replace(/\/$/, '');
    var searchPage = opts.searchPage || (site + '/search.php?search_query=');
    input.setAttribute('autocomplete', 'off');
    if (!ov) build(api, site, searchPage);
    ov.sources.push(input);
    function open() { ov.open(input); }
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('input', open);
    return { close: function () { ov.close(); } };
  }

  function build(api, site, searchPage) {
    if (!document.getElementById('gfsai-css')) { var st = el('style'); st.id = 'gfsai-css'; st.textContent = CSS; document.head.appendChild(st); }
    var root = el('div', 'gfsai-ov'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Search');
    var wrap = el('div', 'gfsai-wrap');
    var bar = el('div', 'gfsai-bar', SEARCH_ICON);
    var box = el('input'); box.type = 'text'; box.placeholder = 'Search…'; box.setAttribute('autocomplete', 'off'); box.setAttribute('aria-label', 'Search');
    var closeBtn = el('button', 'gfsai-close', '&times;'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close search');
    bar.appendChild(box); bar.appendChild(closeBtn);
    var recentEl = el('div', 'gfsai-recent');
    var cols = el('div', 'gfsai-cols');
    var left = el('div', 'gfsai-left'), right = el('div', 'gfsai-right');
    cols.appendChild(left); cols.appendChild(right);
    wrap.appendChild(bar); wrap.appendChild(recentEl); wrap.appendChild(cols); root.appendChild(wrap);
    document.body.appendChild(root);

    var state = { q: '', seq: 0, timer: null, results: [], info: {}, brand: null, home: null, popular: null, ai: false };
    ov = { sources: [] };

    function lock(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }
    function go(q) { addRecent(q); hit(q); window.location.href = searchPage + encodeURIComponent(q); }
    function hit(q) { try { fetch(api + '/hit?q=' + encodeURIComponent(q)); } catch (e) { /* ignore */ } }

    ov.open = function (srcInput) {
      if (!root.classList.contains('is-open')) {
        root.classList.add('is-open'); lock(true);
        box.value = srcInput && srcInput.value ? srcInput.value : '';
        render();
        setTimeout(function () { box.focus(); var v = box.value; box.value = ''; box.value = v; }, 30);
        if (srcInput) srcInput.blur();
      }
    };
    ov.close = function () {
      root.classList.remove('is-open'); lock(false);
      ov.sources.forEach(function (i) { i.value = box.value; });
    };

    function productCard(p, tag) {
      var a = el('a', 'gfsai-card'); a.href = p.url ? site + p.url : searchPage + encodeURIComponent(p.name);
      var t = tag === 'part_number' ? '<span class="gfsai-tag gfsai-t-pn">Part # match</span>'
        : tag === 'part_number_partial' ? '<span class="gfsai-tag gfsai-t-part">Similar part #</span>'
        : tag === 'cross_reference' ? '<span class="gfsai-tag gfsai-t-xref">Cross-reference</span>' : '';
      var sale = p.sale_price && p.price && p.sale_price < p.price;
      a.innerHTML = t + '<div class="gfsai-cimg">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '</div>' +
        (p.brand ? '<div class="gfsai-cbrand">' + esc(p.brand) + '</div>' : '') +
        '<div class="gfsai-ctitle">' + esc(p.name) + '</div>' +
        '<div class="gfsai-cprice' + (sale ? ' is-sale' : '') + '">' + (sale ? '<s>' + money(p.price) + '</s>' : '') + money(p.sale_price || p.price) + '</div>' +
        (p.in_stock ? '<div class="gfsai-cstock">In stock</div>' : '<div class="gfsai-cstock ship">Ships from manufacturer</div>');
      a.addEventListener('click', function () { var q = box.value.trim(); if (q) { addRecent(q); hit(q); } });
      return a;
    }

    function carousel(items) {
      var wrapEl = el('div', 'gfsai-carwrap'), row = el('div', 'gfsai-row');
      items.forEach(function (p) { row.appendChild(productCard(p)); });
      var l = el('button', 'gfsai-arrow', '&#8249;'), r = el('button', 'gfsai-arrow r', '&#8250;');
      l.type = r.type = 'button';
      l.onclick = function () { row.scrollBy({ left: -600, behavior: 'smooth' }); };
      r.onclick = function () { row.scrollBy({ left: 600, behavior: 'smooth' }); };
      wrapEl.appendChild(l); wrapEl.appendChild(row); wrapEl.appendChild(r);
      return wrapEl;
    }

    function renderRecent() {
      recentEl.innerHTML = '';
      var rec = getRecent();
      if (!rec.length) { recentEl.style.display = 'none'; return; }
      recentEl.style.display = 'flex';
      recentEl.appendChild(el('b', null, 'Latest searches:'));
      rec.forEach(function (q) {
        var c = el('span', 'gfsai-chip', esc(q) + ' <i title="Remove">&times;</i>');
        c.addEventListener('click', function (e) {
          if (e.target.tagName === 'I') { setRecent(getRecent().filter(function (x) { return x !== q; })); renderRecent(); return; }
          setQuery(q);
        });
        recentEl.appendChild(c);
      });
      var del = el('button', 'gfsai-link', 'Delete all'); del.type = 'button';
      del.onclick = function () { setRecent([]); renderRecent(); };
      recentEl.appendChild(del);
    }

    function setQuery(q) { box.value = q; state.q = ''; render(); box.focus(); }

    function renderHome() {
      state.brand = null; left.style.display = '';
      left.innerHTML = ''; right.innerHTML = '';
      left.appendChild(el('h3', 'gfsai-h', 'Popular searches'));
      var ul = el('ul', 'gfsai-list');
      (state.popular || []).forEach(function (q) {
        var li = el('li'), b = el('button', null, esc(q)); b.type = 'button';
        b.onclick = function () { setQuery(q); };
        li.appendChild(b); ul.appendChild(li);
      });
      left.appendChild(ul);
      right.appendChild(el('h3', 'gfsai-h', 'Recommended products'));
      if (state.home && state.home.length) right.appendChild(carousel(state.home));
      if (state.popular === null) {
        state.popular = [];
        fetch(api + '/popular').then(function (r) { return r.json(); }).then(function (d) { state.popular = d.queries || []; if (box.value.trim().length < 2) renderHome(); }).catch(function () { /* ignore */ });
      }
      if (state.home === null) {
        state.home = [];
        fetch(api + '/recommended?limit=14').then(function (r) { return r.json(); }).then(function (d) { state.home = d.results || []; if (box.value.trim().length < 2) renderHome(); }).catch(function () { /* ignore */ });
      }
    }

    function renderResults() {
      var q = state.q, res = state.results, info = state.info || {};
      left.innerHTML = ''; right.innerHTML = '';
      var counts = {}; res.forEach(function (p) { if (p.brand) counts[p.brand] = (counts[p.brand] || 0) + 1; });
      var brands = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      left.appendChild(el('h3', 'gfsai-h', 'Brands'));
      var ul = el('ul', 'gfsai-list');
      var all = el('li'), allB = el('button', state.brand ? '' : 'is-on', 'All brands <span class="n">' + res.length + '</span>'); allB.type = 'button';
      allB.onclick = function () { state.brand = null; renderResults(); };
      all.appendChild(allB); ul.appendChild(all);
      brands.slice(0, 12).forEach(function (b) {
        var li = el('li'), bt = el('button', state.brand === b ? 'is-on' : '', esc(b) + ' <span class="n">' + counts[b] + '</span>'); bt.type = 'button';
        bt.onclick = function () { state.brand = b; renderResults(); };
        li.appendChild(bt); ul.appendChild(li);
      });
      left.appendChild(ul);
      left.style.display = brands.length ? '' : 'none';

      var shown = state.brand ? res.filter(function (p) { return p.brand === state.brand; }) : res;
      var ask = el('div', 'gfsai-ask', '<span class="sp">&#10024;</span><span>Ask AI: &ldquo;' + esc(q) + '&rdquo;</span>');
      ask.onclick = function () { runAsk(q); };
      if (state.ai && isQuestion(q)) right.appendChild(ask);
      if (info.corrections && info.corrections.length) {
        right.appendChild(el('p', 'gfsai-note', 'Showing results for <b>' + esc(info.corrections.map(function (c) { return c[1]; }).join(', ')) + '</b> (you typed ' + esc(info.corrections.map(function (c) { return c[0]; }).join(', ')) + ')'));
      }
      if (!shown.length) {
        right.appendChild(el('div', 'gfsai-empty', 'No matches for &ldquo;' + esc(q) + '&rdquo;. Try a part number, a brand, or ask a question.'));
      } else {
        right.appendChild(el('h3', 'gfsai-h', shown.length + ' result' + (shown.length === 1 ? '' : 's') + ' for &ldquo;' + esc(q) + '&rdquo;'));
        var grid = el('div', 'gfsai-grid');
        shown.forEach(function (p) { grid.appendChild(productCard(p, p.match)); });
        right.appendChild(grid);
      }
      if (state.ai && !isQuestion(q)) { var wrapAsk = el('div'); wrapAsk.style.marginTop = '16px'; wrapAsk.appendChild(ask); right.appendChild(wrapAsk); }
      var more = el('div', 'gfsai-more', '<a href="' + esc(searchPage + encodeURIComponent(q)) + '">See all results for &ldquo;' + esc(q) + '&rdquo;</a>');
      more.querySelector('a').addEventListener('click', function () { addRecent(q); hit(q); });
      right.appendChild(more);
    }

    function runAsk(q) {
      right.innerHTML = '<div class="gfsai-ans"><small>&#10024; AI answer</small>Thinking&hellip;</div>';
      fetch(api + '/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: q }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          right.innerHTML = '';
          if (d.answer) {
            right.appendChild(el('div', 'gfsai-ans', '<small>&#10024; AI answer</small>' + esc(d.answer)));
            if (d.products && d.products.length) {
              right.appendChild(el('h3', 'gfsai-h', 'Recommended for you'));
              var g = el('div', 'gfsai-grid'); d.products.forEach(function (p) { g.appendChild(productCard(p, p.match)); }); right.appendChild(g);
            }
          } else {
            right.appendChild(el('div', 'gfsai-ans', '<small>AI answers are off</small>' + esc(d.note || 'Showing the best matches instead.')));
            var g2 = el('div', 'gfsai-grid'); (d.results || []).slice(0, 8).forEach(function (p) { g2.appendChild(productCard(p, p.match)); }); right.appendChild(g2);
          }
        })
        .catch(function () { right.innerHTML = '<div class="gfsai-empty">Could not reach the search service.</div>'; });
    }

    function render() {
      renderRecent();
      var q = box.value.trim();
      if (q.length < 2) { state.q = ''; renderHome(); return; }
      if (q === state.q && state.results.length) { renderResults(); return; }
      var my = ++state.seq;
      fetch(api + '/search?q=' + encodeURIComponent(q) + '&limit=48')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (my !== state.seq || box.value.trim() !== q) return;
          if (d.error === 'index_building') { right.innerHTML = '<div class="gfsai-empty">Search is warming up &mdash; try again in a minute.</div>'; return; }
          state.q = q; state.results = d.results || []; state.info = d.interpretation || {}; state.brand = null; state.ai = !!d.ai;
          renderResults();
        })
        .catch(function () { right.innerHTML = '<div class="gfsai-empty">Could not reach the search service.</div>'; });
    }

    box.addEventListener('input', function () { clearTimeout(state.timer); state.timer = setTimeout(render, 160); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var q = box.value.trim(); if (q) go(q); }
      else if (e.key === 'Escape') ov.close();
    });
    closeBtn.addEventListener('click', function () { ov.close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('is-open')) ov.close(); });
  }

  window.GFSAISearch = { attach: attach };
})();
