/*! GFS AI search widget (prototype).
 *  GFSAISearch.attach(inputElement, { api: 'http://127.0.0.1:8787', siteBase: 'https://globalfuelingsystems.com' })
 *  - search-as-you-type: part numbers (exact / partial / cross-reference), keywords, typo fixes, brand aware
 *  - "Ask AI" for natural-language questions
 */
(function () {
  'use strict';

  var CSS = '\
.gfsai-panel{position:absolute;z-index:99999;left:0;right:0;top:100%;margin-top:6px;background:#fff;border:1px solid #e0e0e0;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16);max-height:75vh;overflow:auto;font-family:inherit;font-size:14px;color:#1a1a1a;text-align:left;display:none}\
.gfsai-panel.is-open{display:block}\
.gfsai-sec{padding:8px 0;border-bottom:1px solid #f0f0f0}.gfsai-sec:last-child{border-bottom:0}\
.gfsai-h{padding:4px 14px 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b6b6b}\
.gfsai-item{display:flex;gap:12px;align-items:center;padding:8px 14px;text-decoration:none;color:inherit;cursor:pointer}\
.gfsai-item:hover,.gfsai-item.is-active{background:#f2fbf7}\
.gfsai-img{width:46px;height:46px;flex:0 0 46px;border:1px solid #efefef;border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}\
.gfsai-img img{max-width:100%;max-height:100%}\
.gfsai-main{flex:1;min-width:0}\
.gfsai-name{font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\
.gfsai-name mark{background:#d9f5e8;color:inherit;border-radius:2px}\
.gfsai-meta{font-size:12px;color:#6b6b6b;margin-top:2px}\
.gfsai-side{text-align:right;flex:0 0 auto;font-size:13px;font-weight:700;color:#10ab71}\
.gfsai-side s{color:#8a8a8a;font-weight:400;margin-right:4px}\
.gfsai-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:20px;padding:2px 8px;margin-right:6px;vertical-align:1px}\
.gfsai-b-pn{background:#10ab71;color:#fff}.gfsai-b-part{background:#e4f6ee;color:#0d7a52}.gfsai-b-xref{background:#fff2d9;color:#8a5a00}\
.gfsai-stock{font-size:11px;font-weight:600;color:#0d7a52;display:block;margin-top:2px}.gfsai-ship{font-size:11px;color:#8a8a8a;display:block;margin-top:2px;font-weight:400}\
.gfsai-note{padding:6px 14px;font-size:12px;color:#6b6b6b}.gfsai-note b{color:#1a1a1a}\
.gfsai-ask{display:flex;gap:10px;align-items:center;padding:10px 14px;cursor:pointer;background:linear-gradient(90deg,#f2fbf7,#fff);font-weight:600}\
.gfsai-ask:hover,.gfsai-ask.is-active{background:#e4f6ee}.gfsai-spark{color:#10ab71;font-size:16px}\
.gfsai-ans{padding:12px 14px;line-height:1.5}.gfsai-ans p{margin:0 0 8px}.gfsai-load{color:#6b6b6b;font-style:italic;padding:12px 14px}\
.gfsai-foot{padding:10px 14px;text-align:center}.gfsai-foot a{color:#10ab71;font-weight:700;text-decoration:none}\
.gfsai-empty{padding:16px 14px;color:#6b6b6b}';

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Call'; }
  function highlight(text, q) {
    var out = esc(text);
    String(q).split(/\s+/).filter(function (w) { return w.length > 1; }).slice(0, 6).forEach(function (w) {
      try { out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); } catch (e) { /* ignore */ }
    });
    return out;
  }
  function isQuestion(q) { return q.trim().split(/\s+/).length >= 4 || /\?|^(what|which|how|do you|does|can i|will|need)\b/i.test(q); }

  function attach(input, opts) {
    opts = opts || {};
    var api = (opts.api || 'http://127.0.0.1:8787').replace(/\/$/, '');
    var site = (opts.siteBase || 'https://globalfuelingsystems.com').replace(/\/$/, '');
    var searchPage = opts.searchPage || (site + '/search.php?search_query=');
    if (!document.getElementById('gfsai-css')) { var st = el('style'); st.id = 'gfsai-css'; st.textContent = CSS; document.head.appendChild(st); }

    var host = input.closest('form') ? input.closest('form').parentNode : input.parentNode;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var panel = el('div', 'gfsai-panel'); host.appendChild(panel);
    input.setAttribute('autocomplete', 'off');

    var timer = null, seq = 0, items = [], active = -1, lastQ = '';

    function close() { panel.classList.remove('is-open'); active = -1; }
    function open() { panel.classList.add('is-open'); }
    function setActive(i) {
      items.forEach(function (n) { n.classList.remove('is-active'); });
      active = i; if (i >= 0 && items[i]) { items[i].classList.add('is-active'); items[i].scrollIntoView({ block: 'nearest' }); }
    }
    function url(p) { return p.url ? site + p.url : searchPage + encodeURIComponent(p.name); }

    function productRow(p, q, badge) {
      var a = el('a', 'gfsai-item'); a.href = url(p);
      var badges = badge === 'part_number' ? '<span class="gfsai-badge gfsai-b-pn">Part # match</span>'
        : badge === 'part_number_partial' ? '<span class="gfsai-badge gfsai-b-part">Similar part #</span>'
        : badge === 'cross_reference' ? '<span class="gfsai-badge gfsai-b-xref">Cross-reference</span>' : '';
      a.innerHTML = '<div class="gfsai-img">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="gfsai-main"><div class="gfsai-name">' + highlight(p.name, q) + '</div>' +
        '<div class="gfsai-meta">' + badges + esc(p.brand || '') + (p.sku ? ' &middot; ' + esc(p.sku) : '') + '</div></div>' +
        '<div class="gfsai-side">' + (p.sale_price && p.sale_price < p.price ? '<s>' + money(p.price) + '</s>' : '') + money(p.sale_price || p.price) +
        (p.in_stock ? '<span class="gfsai-stock">In stock</span>' : '<span class="gfsai-ship">Ships from manufacturer</span>') + '</div>';
      return a;
    }

    function askRow(q, first) {
      var r = el('div', 'gfsai-ask', '<span class="gfsai-spark">&#10024;</span><span>Ask AI: &ldquo;' + esc(q) + '&rdquo;</span>');
      r.addEventListener('click', function () { runAsk(q); });
      r.dataset.kind = 'ask';
      return r;
    }

    function render(data, q) {
      panel.innerHTML = ''; items = [];
      var res = data.results || [], info = data.interpretation || {};
      if (data.error === 'index_building') { panel.appendChild(el('div', 'gfsai-note', 'Search is warming up &mdash; try again in a minute.')); open(); return; }
      var pn = res.filter(function (r) { return r.match === 'part_number' || r.match === 'part_number_partial' || r.match === 'cross_reference'; });
      var kw = res.filter(function (r) { return pn.indexOf(r) < 0; });
      var q2 = q;
      if (isQuestion(q)) { var s0 = el('div', 'gfsai-sec'); s0.appendChild(askRow(q)); panel.appendChild(s0); }
      if (info.corrections && info.corrections.length) {
        panel.appendChild(el('div', 'gfsai-note', 'Showing results for <b>' + esc(info.corrections.map(function (c) { return c[1]; }).join(', ')) + '</b> (you typed ' + esc(info.corrections.map(function (c) { return c[0]; }).join(', ')) + ')'));
      }
      if (pn.length) {
        var s1 = el('div', 'gfsai-sec'); s1.appendChild(el('div', 'gfsai-h', 'Part numbers'));
        pn.slice(0, 5).forEach(function (p) { s1.appendChild(productRow(p, q2, p.match)); }); panel.appendChild(s1);
      }
      if (kw.length) {
        var s2 = el('div', 'gfsai-sec'); s2.appendChild(el('div', 'gfsai-h', info.brand ? 'Products &middot; ' + esc(info.brand) : 'Products'));
        kw.slice(0, 6).forEach(function (p) { s2.appendChild(productRow(p, q2)); }); panel.appendChild(s2);
      }
      if (!res.length) panel.appendChild(el('div', 'gfsai-empty', 'No matches for &ldquo;' + esc(q) + '&rdquo;. Try a part number, brand or a question.'));
      if (!isQuestion(q)) { var s3 = el('div', 'gfsai-sec'); s3.appendChild(askRow(q)); panel.appendChild(s3); }
      var f = el('div', 'gfsai-foot', '<a href="' + esc(searchPage + encodeURIComponent(q)) + '">See all results for &ldquo;' + esc(q) + '&rdquo; &rarr;</a>'); panel.appendChild(f);
      items = [].slice.call(panel.querySelectorAll('.gfsai-item, .gfsai-ask'));
      open();
    }

    function runAsk(q) {
      panel.innerHTML = '<div class="gfsai-load">&#10024; Thinking&hellip;</div>'; items = []; open();
      fetch(api + '/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: q }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          panel.innerHTML = '';
          if (d.answer) {
            var s = el('div', 'gfsai-sec'); s.appendChild(el('div', 'gfsai-h', '&#10024; AI answer'));
            s.appendChild(el('div', 'gfsai-ans', '<p>' + esc(d.answer) + '</p>')); panel.appendChild(s);
            if (d.products && d.products.length) {
              var s2 = el('div', 'gfsai-sec'); s2.appendChild(el('div', 'gfsai-h', 'Recommended'));
              d.products.forEach(function (p) { s2.appendChild(productRow(p, q)); }); panel.appendChild(s2);
            }
          } else {
            panel.appendChild(el('div', 'gfsai-note', '<b>AI answers are off.</b> ' + esc(d.note || '') + ' Showing the best matches instead.'));
            var s3 = el('div', 'gfsai-sec'); (d.results || []).slice(0, 6).forEach(function (p) { s3.appendChild(productRow(p, q, p.match)); }); panel.appendChild(s3);
          }
          panel.appendChild(el('div', 'gfsai-foot', '<a href="' + esc(searchPage + encodeURIComponent(q)) + '">See all results &rarr;</a>'));
          items = [].slice.call(panel.querySelectorAll('.gfsai-item'));
        })
        .catch(function () { panel.innerHTML = '<div class="gfsai-empty">Could not reach the search service.</div>'; });
    }

    function query(q) {
      var my = ++seq;
      fetch(api + '/search?q=' + encodeURIComponent(q) + '&limit=14')
        .then(function (r) { return r.json(); })
        .then(function (d) { if (my === seq && input.value.trim() === q) render(d, q); })
        .catch(function () { /* service unreachable: leave the normal search alone */ });
    }

    input.addEventListener('input', function () {
      var q = input.value.trim(); clearTimeout(timer);
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () { lastQ = q; query(q); }, 140);
    });
    input.addEventListener('focus', function () { if (panel.innerHTML && input.value.trim().length >= 2) open(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (!panel.classList.contains('is-open') || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); items[active].click(); }
    });
    document.addEventListener('click', function (e) { if (!host.contains(e.target)) close(); });
    return { close: close, panel: panel };
  }

  window.GFSAISearch = { attach: attach };
})();
