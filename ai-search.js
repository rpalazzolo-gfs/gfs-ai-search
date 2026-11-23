/*! GFS AI search widget (prototype).
 *  GFSAISearch.attach(inputElement, { api: 'http://127.0.0.1:8787', siteBase: 'https://globalfuelingsystems.com' })
 *  - search-as-you-type: part numbers (exact / partial / cross-reference), keywords, typo fixes, brand aware
 *  - "Ask AI" for natural-language questions
 */
(function () {
  'use strict';

  var CSS = '\
.gfsai-panel{position:absolute;z-index:99999;left:0;width:100%;max-width:560px;top:100%;margin-top:4px;background:#efefef;border:0;border-radius:0;box-shadow:0 8px 24px rgba(0,0,0,.22);max-height:420px;overflow-y:auto;font-family:inherit;font-size:12px;line-height:20px;color:#323232;text-align:left;display:none}\
.gfsai-panel.is-open{display:block}\
.gfsai-sec{padding:0;border-bottom:0}\
.gfsai-h{padding:10px 15px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#a0a0a0}\
.gfsai-item{display:block;padding:10px 15px;border-bottom:1px solid #eaeaea;text-decoration:none;color:inherit;cursor:pointer}\
.gfsai-card{display:flex;align-items:stretch;background:#efefef;border:3px solid #ddd;padding:10px}\
.gfsai-item:hover .gfsai-card,.gfsai-item.is-active .gfsai-card{border-color:#bdbdbd;background:#f6f6f6}\
.gfsai-img{width:70px;flex:0 0 70px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:70px}\
.gfsai-img img{max-width:100%;max-height:90px;display:block}\
.gfsai-main{flex:1;min-width:0;padding-left:15px}\
.gfsai-brand{font-size:12px;color:#a0a0a0;margin:0}\
.gfsai-name{font-size:12px;font-weight:400;line-height:20px;color:#323232;margin:0}\
.gfsai-name mark{background:#fff2a8;color:inherit}\
.gfsai-meta{font-size:11px;color:#a0a0a0;margin-top:2px}\
.gfsai-price{margin-top:4px;font-size:13px;font-weight:500;color:#e95144}\
.gfsai-price s{color:#a0a0a0;margin-right:6px;font-weight:500}\
.gfsai-stock{display:inline-block;margin-left:8px;font-size:11px;font-weight:600;color:#10ab71}\
.gfsai-ship{display:inline-block;margin-left:8px;font-size:11px;font-weight:400;color:#a0a0a0}\
.gfsai-badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;border-radius:2px;padding:0 6px;margin-right:6px;vertical-align:1px;line-height:16px}\
.gfsai-b-pn{background:#10ab71;color:#fff}.gfsai-b-part{background:#d9efe6;color:#0d7a52}.gfsai-b-xref{background:#fbe6a8;color:#6b4a00}\
.gfsai-note{padding:8px 15px;font-size:12px;color:#646464}.gfsai-note b{color:#323232}\
.gfsai-ask{display:flex;gap:10px;align-items:center;padding:12px 15px;cursor:pointer;background:#fff;border-bottom:1px solid #eaeaea;font-weight:600;font-size:13px}\
.gfsai-ask:hover,.gfsai-ask.is-active{background:#f3fbf7}.gfsai-spark{color:#10ab71;font-size:16px}\
.gfsai-ans{padding:12px 15px;line-height:1.5;font-size:13px;background:#fff}.gfsai-ans p{margin:0 0 8px}.gfsai-load{color:#646464;font-style:italic;padding:14px 15px}\
.gfsai-foot{padding:12px 15px;text-align:center;background:#fff}.gfsai-foot a{color:#323232;font-weight:600;text-decoration:underline}\
.gfsai-empty{padding:16px 15px;color:#646464}';

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
      var ours = p.sale_price || p.price;
      var priceHtml = (p.sale_price && p.price && p.sale_price < p.price ? '<s>' + money(p.price) + '</s>' : '') + money(ours);
      a.innerHTML = '<div class="gfsai-card"><div class="gfsai-img">' + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="gfsai-main">' + (p.brand ? '<div class="gfsai-brand">' + esc(p.brand) + '</div>' : '') +
        '<div class="gfsai-name">' + highlight(p.name, q) + '</div>' +
        '<div class="gfsai-meta">' + badges + (p.sku ? 'SKU ' + esc(p.sku) : '') + '</div>' +
        '<div class="gfsai-price">' + priceHtml + (p.in_stock ? '<span class="gfsai-stock">In stock</span>' : '<span class="gfsai-ship">Ships from manufacturer</span>') + '</div></div></div>';
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
