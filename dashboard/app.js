/* Token Radar — the page. Reads window.RADAR (written by main.ts beside this file) and renders
   the board, the size-against-value chart, the filters, the multiples table and one protocol's
   dossier. No network, no framework, no imports. */

(function () {
  'use strict';

  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };
  var SVG = 'http://www.w3.org/2000/svg';

  /* ── formatting ──────────────────────────────────────────────────── */

  function compact(n) {
    if (!isFinite(n)) return '\u2014';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(Math.abs(n / 1e9) >= 100 ? 0 : 2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(Math.abs(n / 1e6) >= 100 ? 0 : 1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function full(n) {
    if (!isFinite(n)) return '\u2014';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(v) { return v === null || v === undefined ? 'n/a' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function mult(v) { return !isFinite(v) ? '\u2014' : '\u00d7' + (v >= 1 ? v.toFixed(2) : v.toFixed(3)); }

  function days(n) {
    if (n === null || n === undefined) return 'age unrecorded';
    if (n < 60) return n + ' days token-less';
    if (n < 730) return Math.round(n / 30.44) + ' months token-less';
    return (n / 365).toFixed(1) + ' years token-less';
  }

  /* ── state ───────────────────────────────────────────────────────── */

  var state = { view: 'board', q: '', cats: {}, chains: {}, bands: {}, watch: false, sort: 'implied', dir: 'desc', detail: null };

  var SORTS = {
    implied: function (r) { return r.implied; },
    tvl: function (r) { return r.tvl; },
    chg: function (r) { return r.chg === null ? -1e9 : r.chg; },
    ratio: function (r) { return r.implied / Math.max(r.tvl, 1); },
    age: function (r) { return r.age === null ? -1 : r.age; },
    name: function (r) { return r.name.toLowerCase(); }
  };

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (p.get('view')) state.view = p.get('view');
    if (p.get('q')) state.q = p.get('q');
    p.getAll('cat').forEach(function (k) { if (k) state.cats[k] = true; });
    p.getAll('chain').forEach(function (k) { if (k) state.chains[k] = true; });
    p.getAll('band').forEach(function (k) { if (k) state.bands[k] = true; });
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('sort') && SORTS[p.get('sort')]) state.sort = p.get('sort');
    if (p.get('dir') === 'asc') state.dir = 'asc';
    if (p.get('detail')) state.detail = p.get('detail');
  }

  function writeUrl() {
    var p = new URLSearchParams();
    if (state.view !== 'board') p.set('view', state.view);
    if (state.q) p.set('q', state.q);
    Object.keys(state.cats).forEach(function (k) { p.set('cat', k); });
    Object.keys(state.chains).forEach(function (k) { p.set('chain', k); });
    Object.keys(state.bands).forEach(function (k) { p.set('band', k); });
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== 'desc') p.set('dir', state.dir);
    if (state.detail) p.set('detail', state.detail);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  /* ── the view model ──────────────────────────────────────────────── */

  function matches(r) {
    var cats = Object.keys(state.cats);
    if (cats.length && cats.indexOf(r.category || 'Uncategorised') < 0) return false;
    var chains = Object.keys(state.chains);
    if (chains.length && !chains.some(function (c) { return r.chains.indexOf(c) >= 0; })) return false;
    var bands = Object.keys(state.bands);
    if (bands.length && bands.indexOf(r.band) < 0) return false;
    if (state.watch && !r.watch) return false;
    if (state.q) {
      var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
    }
    return true;
  }

  function visible() {
    var rows = R.rows.filter(matches);
    var key = SORTS[state.sort];
    var sign = state.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x === y) return a.rank - b.rank;
      return x > y ? sign : -sign;
    });
    return rows;
  }

  /* ── header ──────────────────────────────────────────────────────── */

  function stat(label, value, sub) {
    var d = el('div');
    d.appendChild(el('dt', null, label));
    var dd = el('dd', null, value);
    if (sub) dd.appendChild(el('small', null, ' ' + sub));
    d.appendChild(dd);
    return d;
  }

  function drawHeader() {
    $('tag').textContent = R.model.version;
    var box = $('stats');
    box.textContent = '';
    box.appendChild(stat('Snapshot', R.as_of));
    box.appendChild(stat('Ranked', String(R.rows.length), 'of ' + R.counts.launchable));
    box.appendChild(stat('Watchlist', String(R.counts.watchlist), 'covered'));
    box.appendChild(stat('Trading now', String(R.counts.live), 'protocols'));
    box.appendChild(stat('Categories', String(R.counts.categories)));
  }
  function drawHero() {
    var host = $('hero');
    host.textContent = '';
    var top = R.rows[0];
    var tiles = [
      ['Record no token', String(R.counts.launchable), 'protocols at any size, of ' + R.counts.protocols + ' in the snapshot'],
      ['Their TVL at stake', compact(R.counts.watchlist_tvl), R.counts.watchlist + ' on the watchlist, ' + R.counts.below_floor + ' more below the floor'],
      ['Largest implied value', compact(top.implied), top.name + ', rank 1 of ' + R.rows.length],
      ['Whole-snapshot multiple', mult(R.sectors[R.sectors.length - 1].multiple), 'median cap/TVL across ' + R.sectors[R.sectors.length - 1].peers + ' trading protocols']
    ];
    tiles.forEach(function (t, i) {
      var d = el('div');
      d.appendChild(el('div', 'k', t[0]));
      d.appendChild(el('div', 'v' + (i === 2 ? ' a' : ''), t[1]));
      d.appendChild(el('div', 's', t[2]));
      host.appendChild(d);
    });
  }

  /* ── the chart: TVL against implied value, iso-multiple diagonals ── */

  function drawChart(rows) {
    var host = $('chart');
    host.textContent = '';
    if (!rows.length) return;
    var W = Math.max(host.clientWidth || 900, 480);
    var H = 190;
    var m = { l: 60, r: 18, t: 12, b: 26 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;

    var lg = Math.log10;
    var xs = rows.map(function (r) { return lg(Math.max(r.tvl, 1)); });
    var ys = rows.map(function (r) { return lg(Math.max(r.implied, 1)); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    if (x1 - x0 < 3) x1 = x0 + 3;
    if (y1 - y0 < 2) y1 = y0 + 2;

    var sx = function (v) { return m.l + ((v - x0) / (x1 - x0)) * iw; };
    var sy = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };

    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    var mk = function (name, attrs, text) {
      var n = document.createElementNS(SVG, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    };

    var label = function (x, y, text, anchor, fill, size) {
      return mk('text', {
        x: x, y: y, 'text-anchor': anchor || 'start', fill: fill || '#6f829a',
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': size || 10.5
      }, text);
    };

    for (var dx = x0; dx <= x1; dx++) {
      mk('line', { x1: sx(dx), y1: m.t, x2: sx(dx), y2: m.t + ih, stroke: '#18222e', 'stroke-width': 1 });
      label(sx(dx), H - 8, compact(Math.pow(10, dx)), sx(dx) > W - m.r - 24 ? 'end' : 'middle');
    }
    for (var dy = y0; dy <= y1; dy++) {
      mk('line', { x1: m.l, y1: sy(dy), x2: m.l + iw, y2: sy(dy), stroke: '#18222e', 'stroke-width': 1 });
      label(m.l - 9, sy(dy) + 3.5, compact(Math.pow(10, dy)), 'end');
    }

    // iso-multiple diagonals: implied = tvl x m  =>  y = x + log10(m)
    [0.1, 0.25, 0.5, 1].forEach(function (mo) {
      var off = lg(mo);
      var xa = Math.max(x0, y0 - off), xb = Math.min(x1, y1 - off);
      if (xb <= xa) return;
      mk('line', {
        x1: sx(xa), y1: sy(xa + off), x2: sx(xb), y2: sy(xb + off),
        stroke: '#2a3849', 'stroke-width': 1, 'stroke-dasharray': '4 4'
      });
      label(sx(xb) - 3, sy(xb + off) - 5, mult(mo), 'end', '#43586f', 10);
    });

    var maxImplied = Math.max.apply(null, rows.map(function (r) { return r.implied; }));
    rows.forEach(function (r) {
      var cx = sx(lg(Math.max(r.tvl, 1))), cy = sy(lg(Math.max(r.implied, 1)));
      var rad = 2.4 + 3.2 * Math.sqrt(r.implied / maxImplied);
      var g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', 'dot');
      var c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy);
      c.setAttribute('r', (r.watch ? rad + 1.3 : rad).toFixed(2));
      c.setAttribute('fill', r.watch ? '#f5b83d' : '#5f92c4');
      c.setAttribute('fill-opacity', r.watch ? '0.85' : '0.5');
      c.setAttribute('stroke', r.watch ? '#f5b83d' : '#5f92c4');
      c.setAttribute('stroke-opacity', '0.9');
      c.setAttribute('stroke-width', '0.8');
      g.appendChild(c);
      var tip = document.createElementNS(SVG, 'title');
      tip.textContent = r.name + ' \u2014 ' + compact(r.tvl) + ' TVL, ' + compact(r.implied) + ' implied';
      g.appendChild(tip);
      g.addEventListener('click', function () { state.detail = r.slug; render(); });
      svg.appendChild(g);
    });

    host.appendChild(svg);

    var head = $('charthead');
    head.textContent = '';
    var left = el('span');
    left.appendChild(el('b', null, 'Size against implied value'));
    left.appendChild(document.createTextNode(' \u00b7 a dot above a diagonal is worth more than that multiple of its TVL'));
    head.appendChild(left);
    var right = el('span', 'legend');
    right.appendChild(el('i', 'k', ''));
    right.appendChild(document.createTextNode('watchlist '));
    right.appendChild(el('i', 'b', ''));
    right.appendChild(document.createTextNode('below the floor \u00b7 ' + rows.length + ' plotted'));
    head.appendChild(right);
  }

  /* ── filters ─────────────────────────────────────────────────────── */

  function counts(field) {
    var out = {};
    R.rows.forEach(function (r) {
      var keys = field === 'chains' ? r.chains : [field === 'band' ? r.band : r.category || 'Uncategorised'];
      keys.forEach(function (k) { out[k] = (out[k] || 0) + 1; });
    });
    return out;
  }

  function chipGroup(title, values, active, limit, onToggle) {
    var wrap = el('div');
    wrap.appendChild(el('h2', null, title));
    var box = el('div', 'chips');
    var keys = Object.keys(values).sort(function (a, b) { return values[b] - values[a]; });
    var shown = keys.slice(0, limit);
    if (active) Object.keys(active).forEach(function (k) { if (shown.indexOf(k) < 0) shown.push(k); });
    shown.forEach(function (k) {
      var b = el('button', 'chip' + (active && active[k] ? ' on' : ''));
      b.type = 'button';
      b.appendChild(el('span', null, k));
      b.appendChild(el('i', null, String(values[k])));
      b.addEventListener('click', function () { onToggle(k); });
      box.appendChild(b);
    });
    wrap.appendChild(box);
    return wrap;
  }

  function drawRail() {
    var rail = $('rail');
    rail.textContent = '';
    var scope = el('div');
    scope.appendChild(el('h2', null, 'Scope'));
    var wb = el('button', 'chip' + (state.watch ? ' on' : ''));
    wb.type = 'button';
    wb.appendChild(el('span', null, 'Watchlist only'));
    wb.appendChild(el('i', null, String(R.counts.watchlist)));
    wb.addEventListener('click', function () { state.watch = !state.watch; render(); });
    scope.appendChild(wb);
    rail.appendChild(scope);

    rail.appendChild(chipGroup('Category', counts('category'), state.cats, 9, function (k) {
      state.cats[k] = !state.cats[k];
      if (!state.cats[k]) delete state.cats[k];
      render();
    }));
    rail.appendChild(chipGroup('Chain', counts('chains'), state.chains, 7, function (k) {
      state.chains[k] = !state.chains[k];
      if (!state.chains[k]) delete state.chains[k];
      render();
    }));
    rail.appendChild(chipGroup('Time token-less', counts('band'), state.bands, 4, function (k) {
      state.bands[k] = !state.bands[k];
      if (!state.bands[k]) delete state.bands[k];
      render();
    }));

    var reset = el('button', 'reset', 'Clear filters');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      state.cats = {}; state.chains = {}; state.bands = {}; state.watch = false; state.q = '';
      $('q').value = '';
      render();
    });
    rail.appendChild(reset);
  }

  /* ── board ───────────────────────────────────────────────────────── */

  var COLUMNS = [
    { key: null, label: '#', cls: 'r' },
    { key: 'name', label: 'Protocol', cls: 's' },
    { key: 'tvl', label: 'TVL', cls: 's r' },
    { key: 'chg', label: '7d flow', cls: 's r' },
    { key: 'ratio', label: 'Mult', cls: 's r' },
    { key: 'implied', label: 'Implied token value', cls: 's r' },
    { key: 'age', label: 'Record', cls: 's r' }
  ];

  function drawHead() {
    var head = $('thead');
    head.textContent = '';
    COLUMNS.forEach(function (c) {
      var s = el('span', c.cls.indexOf('s') >= 0 ? 's' : '');
      s.appendChild(el('span', null, c.label));
      if (c.key) {
        if (state.sort === c.key) {
          s.classList.add('on');
          s.appendChild(el('span', null, state.dir === 'asc' ? '\u2191' : '\u2193'));
          s.addEventListener('click', function () { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; render(); });
        } else {
          s.addEventListener('click', function () {
            state.sort = c.key;
            state.dir = c.key === 'name' ? 'asc' : 'desc';
            render();
          });
        }
      }
      head.appendChild(s);
    });
  }

  function drawBoard(rows) {
    var max = 1;
    rows.forEach(function (r) { if (r.implied > max) max = r.implied; });
    var host = $('rows');
    host.textContent = '';
    if (!rows.length) {
      host.appendChild(el('div', 'foot-note', 'No protocol matches these filters. Clear one and the board returns.'));
      return;
    }
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var b = el('button', 'row' + (r.watch ? ' watch' : '') + (state.detail === r.slug ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'rank', String(r.rank)));
      var who = el('span', 'who');
      who.appendChild(el('b', null, r.name));
      var sub = el('span');
      sub.appendChild(el('em', null, r.category || 'Uncategorised'));
      sub.appendChild(document.createTextNode(' \u00b7 ' + r.chains.slice(0, 3).join(' / ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')));
      who.appendChild(sub);
      b.appendChild(who);
      b.appendChild(el('span', 'n', compact(r.tvl)));
      var flow = el('span', 'pill ' + (r.chg === null ? '' : r.chg >= 0 ? 'up' : 'down'));
      flow.textContent = r.chg === null ? '\u00b7' : (r.chg >= 0 ? '\u25b2 ' : '\u25bc ') + Math.abs(r.chg).toFixed(1) + '%';
      b.appendChild(flow);
      b.appendChild(el('span', 'mult', mult(r.implied / Math.max(r.tvl, 1))));
      var bar = el('span', 'bar');
      bar.style.setProperty('--w', Math.max(4, Math.round((r.implied / max) * 100)) + '%');
      bar.appendChild(el('span', null, compact(r.implied)));
      b.appendChild(bar);
      var bandCol = el('span', 'bandcol');
      bandCol.appendChild(el('span', 'bnd ' + r.band, r.band.replace('-', ' ')));
      b.appendChild(bandCol);
      b.addEventListener('click', function () { state.detail = state.detail === r.slug ? null : r.slug; render(); });
      frag.appendChild(b);
    });
    host.appendChild(frag);
  }

  /* ── trading-now view ────────────────────────────────────────────── */

  function noChart() {
    $('chart').textContent = '';
    $('charthead').textContent = '';
    $('chartwrap').style.display = 'none';
  }

  function drawLive() {
    noChart();
    var head = $('thead');
    head.textContent = '';
    [
      { label: '#', cls: 'r' }, { label: 'Protocol whose token already trades', cls: '' },
      { label: 'Market cap', cls: 'r' }, { label: 'TVL', cls: 'r' },
      { label: 'Cap / TVL', cls: 'r' }, { label: '7d flow', cls: 'r' }
    ].forEach(function (c) { head.appendChild(el('span', c.cls, c.label)); });

    var host = $('rows');
    host.textContent = '';
    var frag = document.createDocumentFragment();
    R.live.forEach(function (r, i) {
      var b = el('button', 'row');
      b.type = 'button';
      b.appendChild(el('span', 'rank', String(i + 1)));
      var who = el('span', 'who');
      who.appendChild(el('b', null, r.name));
      var sub = el('span');
      sub.appendChild(el('em', null, r.category || 'Uncategorised'));
      sub.appendChild(document.createTextNode(' \u00b7 ' + r.chains.slice(0, 3).join(' / ')));
      who.appendChild(sub);
      b.appendChild(who);
      b.appendChild(el('span', 'n', compact(r.mcap_usd)));
      b.appendChild(el('span', 'n', compact(r.tvl_usd)));
      b.appendChild(el('span', 'mult', mult(r.ratio)));
      var flow = el('span', 'pill ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'));
      flow.textContent = r.change_7d === null ? '\u00b7' : pct(r.change_7d);
      b.appendChild(flow);
      b.appendChild(el('span'));
      frag.appendChild(b);
    });
    host.appendChild(frag);
    $('footnote').textContent = 'These ' + R.live.length + ' already trade, the largest by market cap: the market has priced them, so the radar ranks them apart from the ' + R.counts.launchable + ' still to come, and uses their market-cap-to-TVL ratios as the multiples the board applies.';
  }

  /* ── multiples view ──────────────────────────────────────────────── */

  function drawSectors() {
    noChart();
    $('thead').textContent = '';
    var host = $('rows');
    host.textContent = '';
    var wrap = el('div', 'sectors');
    var head = el('div', 'srow');
    ['Category', 'Multiple', 'Trading peers', 'Largest trading members, and their own cap/TVL'].forEach(function (t, i) {
      head.appendChild(el(i === 0 ? 'b' : i === 3 ? 'ex' : i === 1 ? 'm' : 'p', null, t));
    });
    wrap.appendChild(head);
    R.sectors.forEach(function (s) {
      var row = el('div', 'srow');
      row.appendChild(el('b', null, s.category));
      row.appendChild(el('div', 'm', mult(s.multiple)));
      row.appendChild(el('div', 'p', String(s.peers)));
      row.appendChild(el('div', 'ex', s.examples.length ? s.examples.map(function (e) { return e.name + ' ' + mult(e.ratio); }).join('  \u00b7  ') : s.basis));
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
    $('footnote').textContent = 'Every multiple is measured, not assumed: it is the median market-cap-to-TVL ratio of the protocols in that category whose token already trades, read from the same snapshot. A category with fewer than three trading members borrows the whole snapshot\u2019s median.';
  }

  /* ── detail drawer ───────────────────────────────────────────────── */

  function stepLine(label, value, op, total) {
    var n = el('div', 'step' + (op ? ' op' : '') + (total ? ' total' : ''));
    n.appendChild(el('span', null, label));
    n.appendChild(el('b', null, value));
    return n;
  }

  function peerRow(name, mcap, tvl, ratio) {
    var n = el('div');
    n.appendChild(el('span', null, name));
    n.appendChild(el('i', null, mcap ? mcap + ' / ' + tvl : ''));
    n.appendChild(el('b', null, ratio));
    return n;
  }

  function drawDrawer() {
    var d = $('drawer');
    d.textContent = '';
    var row = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === state.detail) row = R.rows[i];
    if (!row) return;

    var bar = el('div', 'dbar');
    bar.appendChild(el('span', null, 'Protocol dossier'));
    var close = el('button', null, 'Close  esc');
    close.type = 'button';
    close.addEventListener('click', function () { state.detail = null; render(); });
    bar.appendChild(close);
    d.appendChild(bar);

    var head = el('div', 'd-head');
    var kick = el('div', 'kicker');
    kick.appendChild(el('span', null, 'rank ' + row.rank + ' of ' + R.rows.length));
    kick.appendChild(el('span', null, row.watch ? '\u00b7 on the watchlist' : '\u00b7 below the floor'));
    head.appendChild(kick);
    head.appendChild(el('h1', null, row.name));
    head.appendChild(el('div', 'meta', (row.category || 'Uncategorised') + ' \u00b7 ' + row.chains.join(' / ')));
    var meta2 = el('div', 'meta');
    meta2.appendChild(document.createTextNode('TVL '));
    meta2.appendChild(el('b', null, full(row.tvl)));
    meta2.appendChild(document.createTextNode(' \u00b7 7d ' + pct(row.chg) + ' \u00b7 ' + days(row.age) + (row.listed ? ' (tracked since ' + row.listed + ')' : '')));
    head.appendChild(meta2);
    d.appendChild(head);

    d.appendChild(el('p', 'why', row.why));

    var vb = el('div', 'value-block');
    vb.appendChild(el('div', 'lbl', 'Implied token value'));
    vb.appendChild(el('div', 'v', full(row.implied)));
    vb.appendChild(el('div', 'sub', 'if ' + row.name + '\u2019s record stood still: TVL \u00d7 the trading multiple of its category \u00d7 its flow \u00d7 its record'));
    d.appendChild(vb);

    var der = el('div', 'derive');
    der.appendChild(stepLine('TVL at the snapshot block', full(row.tvl), false));
    der.appendChild(stepLine('\u00d7 ' + (row.category || 'every category') + ' multiple, ' + row.sectorBasis, mult(row.sector), true));
    der.appendChild(stepLine('\u00d7 flow, TVL over seven days at ' + pct(row.chg), mult(row.growth), true));
    der.appendChild(stepLine('\u00d7 record, ' + days(row.age), mult(row.maturity), true));
    der.appendChild(stepLine('implied token value', full(row.implied), false, true));
    d.appendChild(der);

    var peerHead = el('div', 'sect');
    peerHead.appendChild(el('span', null, 'The multiple, from the market'));
    d.appendChild(peerHead);
    var peers = el('div', 'peers');
    peers.appendChild(peerRow('this protocol, at the multiple the board applied', '\u2014', '\u2014', mult(row.implied / Math.max(row.tvl, 1))));
    var sector = null;
    for (var s = 0; s < R.sectors.length; s++) if (R.sectors[s].category === (row.category || '')) sector = R.sectors[s];
    if (sector && sector.examples.length) {
      sector.examples.forEach(function (x) { peers.appendChild(peerRow(x.name, compact(x.mcap_usd), compact(x.tvl_usd), mult(x.ratio))); });
    } else {
      var world = R.sectors[R.sectors.length - 1];
      var line = el('div');
      line.appendChild(el('span', null, 'no three trading peers in ' + (row.category || 'this category') + ': the whole snapshot\u2019s median of ' + world.peers + ' trading protocols applies'));
      line.appendChild(el('i', null, ''));
      line.appendChild(el('b', null, mult(world.multiple)));
      peers.appendChild(line);
    }
    d.appendChild(peers);

    var planHead = el('div', 'sect');
    planHead.appendChild(el('span', null, 'How to farm it'));
    planHead.appendChild(el('span', null, row.steps.length + ' steps'));
    d.appendChild(planHead);
    var plan = el('ol', 'plan');
    row.steps.forEach(function (s) {
      var li = el('li');
      li.appendChild(document.createTextNode(s.text));
      var t = el('div', 't');
      t.appendChild(el('i', 'c', s.cost));
      t.appendChild(el('i', null, s.time));
      li.appendChild(t);
      plan.appendChild(li);
    });
    d.appendChild(plan);

    var total = el('div', 'plantotal');
    total.appendChild(el('span', null, 'The whole plan'));
    var t2 = el('div', 't');
    t2.appendChild(el('i', 'c', row.total.capital));
    t2.appendChild(el('i', 'c', row.total.gas));
    t2.appendChild(el('i', null, row.total.time));
    total.appendChild(t2);
    d.appendChild(total);

    d.appendChild(el('div', 'note', 'It records no token: the snapshot carries neither a ticker nor a coin id for it. That is not proof none exists \u2014 a record can lag. Implied value ranks what its figures would be worth today; it says nothing about whether or when a token is issued, and it is this entry\u2019s own claim, not make.fun\u2019s.'));
  }

  /* ── footer + wire-up ────────────────────────────────────────────── */

  function drawFormula() {
    var f = $('formula');
    f.textContent = '';
    [
      ['implied value', 'TVL \u00d7 sector multiple \u00d7 flow \u00d7 record'],
      ['sector multiple', 'median cap/TVL of that category\u2019s trading protocols'],
      ['flow', '1 + 0.5 \u00d7 7d change, clamped to \u221260% \u2026 +120%'],
      ['record', '0.55 + 0.45 \u00d7 (1 \u2212 e^\u2212age/500d)'],
      ['source', R.source]
    ].forEach(function (p) {
      var s = el('span');
      s.appendChild(el('b', null, p[0] + ': '));
      s.appendChild(document.createTextNode(p[1]));
      f.appendChild(s);
    });
  }

  function render() {
    var open = state.detail !== null && state.view === 'board';
    document.querySelector('.shell').classList.toggle('wide', !open);
    document.querySelectorAll('.switch button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    $('chartwrap').style.display = '';
    drawHero();

    if (state.view === 'live') {
      drawLive();
    } else if (state.view === 'sectors') {
      drawSectors();
    } else {
      var rows = visible();
      drawChart(rows);
      drawHead();
      drawBoard(rows);
      var f = $('footnote');
      f.textContent = '';
      f.appendChild(el('b', null, String(rows.length)));
      f.appendChild(document.createTextNode(
        ' of ' + R.rows.length + ' ranked rows \u00b7 ' + R.counts.watchlist + ' watchlist protocols covered \u00b7 '
        + 'every protocol that records no token, at any size, ranked by what its token would be worth \u00b7 '
        + 'pick a row or a dot for its derivation and farm plan'
      ));
    }
    drawDrawer();
    drawRail();
    drawHeader();
    writeUrl();
    $('stage').focus({ preventScroll: true });
  }

  function boot() {
    if (!R) {
      document.body.textContent = 'The radar data did not load: data.js must sit beside the page.';
      return;
    }
    readUrl();
    $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    document.querySelectorAll('.switch button').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.dataset.view; render(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.detail) { state.detail = null; render(); }
      else if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    });
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { if (state.view === 'board') render(); }, 120);
    });
    if (state.q) $('q').value = state.q;
    drawFormula();
    render();
  }

  boot();
})();
