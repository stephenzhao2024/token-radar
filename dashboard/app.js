/* Token Radar — the page. window.RADAR is written by main.ts into ../data.js; everything below reads
   that one object and draws it: the board, the size-against-value map, the sieve, the multiples table
   and one protocol's brief. No network, no framework, no imports, no clock, no randomness: the same
   data draws the same bytes twice.

   The page carries three things the ranking rests on, and shows all three rather than asserting them:
   the fitted curve with its coefficients, the blind test that picked the model over five alternatives,
   and the net of a $1,000 ticket after gas and the cost of the capital that sits in the position. */

(function () {
  'use strict';

  var R = window.RADAR;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }

  function mk(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function fill(host, kids) {
    host.textContent = '';
    for (var i = 0; i < kids.length; i++) host.appendChild(kids[i]);
    return host;
  }

  /* ── numbers, as an instrument prints them ─────────────────────────────── */

  function brief(n) {
    if (!isFinite(n)) return '\u2014';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(Math.abs(n / 1e9) >= 100 ? 0 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(Math.abs(n / 1e6) >= 100 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function exact(n) {
    if (!isFinite(n)) return '\u2014';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(v) {
    if (v === null || v === undefined) return 'n/a';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function times(v) {
    if (!isFinite(v)) return '\u2014';
    if (v >= 1) return '\u00d7' + v.toFixed(2);
    return '\u00d7' + v.toFixed(3);
  }

  function signed(n, places) {
    var d = places === undefined ? 2 : places;
    return (n >= 0 ? '+' : '\u2212') + '$' + Math.abs(n).toFixed(d);
  }

  function span(days) {
    if (days === null || days === undefined) return 'age unrecorded';
    if (days < 60) return days + ' days token-less';
    if (days < 730) return Math.round(days / 30.44) + ' months token-less';
    return (days / 365).toFixed(1) + ' years token-less';
  }

  /* ── state, and the address bar as its one record ──────────────────────── */

  var state = {
    view: 'board', q: '', cat: {}, chain: {}, band: {},
    watch: false, sort: 'implied', dir: 'desc', open: null
  };

  var KEYS = {
    implied: function (r) { return r.implied; },
    tvl: function (r) { return r.tvl; },
    chg: function (r) { return r.chg === null ? -Infinity : r.chg; },
    ratio: function (r) { return r.implied / Math.max(r.tvl, 1); },
    age: function (r) { return r.age === null ? -1 : r.age; },
    name: function (r) { return r.name.toLowerCase(); }
  };

  function readAddress() {
    var p = new URLSearchParams(location.search);
    if (p.get('view')) state.view = p.get('view');
    if (p.get('q')) state.q = p.get('q');
    p.getAll('cat').forEach(function (k) { if (k) state.cat[k] = true; });
    p.getAll('chain').forEach(function (k) { if (k) state.chain[k] = true; });
    p.getAll('band').forEach(function (k) { if (k) state.band[k] = true; });
    if (p.get('watch') === '1') state.watch = true;
    if (p.get('sort') && KEYS[p.get('sort')]) state.sort = p.get('sort');
    if (p.get('dir') === 'asc') state.dir = 'asc';
    if (p.get('detail')) state.open = p.get('detail');
  }

  function writeAddress() {
    var p = new URLSearchParams();
    if (state.view !== 'board') p.set('view', state.view);
    if (state.q) p.set('q', state.q);
    Object.keys(state.cat).forEach(function (k) { p.set('cat', k); });
    Object.keys(state.chain).forEach(function (k) { p.set('chain', k); });
    Object.keys(state.band).forEach(function (k) { p.set('band', k); });
    if (state.watch) p.set('watch', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== 'desc') p.set('dir', state.dir);
    if (state.open) p.set('detail', state.open);
    var qs = p.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  /* ── which rows show, and in what order ───────────────────────────────── */

  function keeps(r) {
    var cats = Object.keys(state.cat);
    if (cats.length && cats.indexOf(r.category || 'Uncategorised') < 0) return false;
    var chains = Object.keys(state.chain);
    if (chains.length) {
      var hit = false;
      for (var i = 0; i < chains.length; i++) if (r.chains.indexOf(chains[i]) >= 0) hit = true;
      if (!hit) return false;
    }
    var bands = Object.keys(state.band);
    if (bands.length && bands.indexOf(r.band) < 0) return false;
    if (state.watch && !r.watch) return false;
    if (state.q) {
      var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
    }
    return true;
  }

  function orderedRows() {
    var rows = R.rows.filter(keeps);
    var key = KEYS[state.sort];
    var sign = state.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x === y) return a.rank - b.rank;
      return x > y ? sign : -sign;
    });
    return rows;
  }

  function bySlug(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }

  function usedTest() {
    for (var i = 0; i < R.tests.length; i++) if (R.tests[i].name === R.variant) return R.tests[i];
    return R.tests[0];
  }

  function sectorOf(category) {
    for (var i = 0; i < R.sectors.length; i++) if (R.sectors[i].category === category) return R.sectors[i];
    return null;
  }

  /* ── the head ─────────────────────────────────────────────────────────── */

  function plate(label, value, sub) {
    var box = mk('div');
    box.appendChild(mk('dt', null, label));
    var dd = mk('dd', null, value);
    if (sub) dd.appendChild(mk('small', null, ' ' + sub));
    box.appendChild(dd);
    return box;
  }

  function drawHead() {
    $('build').textContent = R.model.version;
    fill($('ledger'), [
      plate('Snapshot', R.as_of),
      plate('Ranked', String(R.rows.length), 'of ' + R.counts.launchable),
      plate('Watchlist', String(R.counts.watchlist), 'covered'),
      plate('Already trading', String(R.counts.live), 'priced by the market'),
      plate('Categories', String(R.counts.categories))
    ]);
  }

  /* ── the four tiles: what the snapshot says before any row is read ────── */

  function drawTiles() {
    var t = usedTest();
    var pick = [
      ['Record no token', String(R.counts.launchable),
        'of the ' + R.counts.protocols + ' protocols in the snapshot, at every size'],
      ['On a $1,000 ticket', R.counts.farm + ' FARM',
        R.counts.thin + ' THIN and ' + R.counts.skip + ' SKIP after gas and the yield the capital forgoes in '
        + R.model.hold_months + ' months'],
      ['Best an hour', signed(R.counts.best_per_hour), R.counts.best_name + ', net of every cost its plan names'],
      ['Blind miss', '\u00d7' + t.miss,
        Math.round(t.within3 * 100) + '% land within three times, over ' + R.blind_n + ' held-out tokens']
    ];
    fill($('tiles'), pick.map(function (x, i) {
      var box = mk('div');
      box.appendChild(mk('div', 'k', x[0]));
      box.appendChild(mk('div', 'v' + (i === 2 ? ' a' : ''), x[1]));
      box.appendChild(mk('div', 's', x[2]));
      return box;
    }));
  }

  /* ── the map: TVL across, implied value up, with iso-multiple diagonals ── */

  function drawPlot(rows) {
    var host = $('plot');
    host.textContent = '';
    if (!rows.length) { $('plothd').textContent = ''; return; }

    var W = Math.max(host.clientWidth || 900, 480), H = 190;
    var m = { l: 62, r: 18, t: 12, b: 26 };
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

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    function ink(name, attrs, text) {
      var n = document.createElementNS(SVGNS, name);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    }

    function tick(x, y, text, anchor, colour, size) {
      ink('text', {
        x: x, y: y, 'text-anchor': anchor || 'start', fill: colour || '#6f829a',
        'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace', 'font-size': size || 10.5
      }, text);
    }

    for (var dx = x0; dx <= x1; dx++) {
      ink('line', { x1: sx(dx), y1: m.t, x2: sx(dx), y2: m.t + ih, stroke: '#18222e', 'stroke-width': 1 });
      tick(sx(dx), H - 8, brief(Math.pow(10, dx)), sx(dx) > W - m.r - 24 ? 'end' : 'middle');
    }
    for (var dy = y0; dy <= y1; dy++) {
      ink('line', { x1: m.l, y1: sy(dy), x2: m.l + iw, y2: sy(dy), stroke: '#18222e', 'stroke-width': 1 });
      tick(m.l - 9, sy(dy) + 3.5, brief(Math.pow(10, dy)), 'end');
    }

    /* implied = TVL x m, so on log axes every multiple is a line of slope one */
    [0.1, 0.25, 0.5, 1].forEach(function (mo) {
      var off = lg(mo);
      var a = Math.max(x0, y0 - off), b = Math.min(x1, y1 - off);
      if (b <= a) return;
      ink('line', {
        x1: sx(a), y1: sy(a + off), x2: sx(b), y2: sy(b + off),
        stroke: '#2a3849', 'stroke-width': 1, 'stroke-dasharray': '4 4'
      });
      tick(sx(b) - 3, sy(b + off) - 5, times(mo), 'end', '#43586f', 10);
    });

    var top = Math.max.apply(null, rows.map(function (r) { return r.implied; }));
    rows.forEach(function (r) {
      var cx = sx(lg(Math.max(r.tvl, 1))), cy = sy(lg(Math.max(r.implied, 1)));
      var rad = 2.4 + 3.2 * Math.sqrt(r.implied / top);
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'dot');
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', (r.watch ? rad + 1.3 : rad).toFixed(2));
      c.setAttribute('fill', r.watch ? '#f5b83d' : '#5f92c4');
      c.setAttribute('fill-opacity', r.watch ? '0.85' : '0.5');
      c.setAttribute('stroke', r.watch ? '#f5b83d' : '#5f92c4');
      c.setAttribute('stroke-opacity', '0.9');
      c.setAttribute('stroke-width', '0.8');
      g.appendChild(c);
      var tip = document.createElementNS(SVGNS, 'title');
      tip.textContent = r.name + ' \u2014 ' + brief(r.tvl) + ' TVL, ' + brief(r.implied) + ' implied';
      g.appendChild(tip);
      g.addEventListener('click', function () { state.open = r.slug; render(); });
      svg.appendChild(g);
    });

    host.appendChild(svg);

    var left = mk('span');
    left.appendChild(mk('span', 'cap', 'Size against implied value'));
    left.appendChild(document.createTextNode(' \u00b7 a dot above a diagonal is worth more than that multiple of its TVL'));
    var right = mk('span', 'legend');
    right.appendChild(mk('i', 'k'));
    right.appendChild(document.createTextNode('watchlist'));
    right.appendChild(mk('i', 'b'));
    right.appendChild(document.createTextNode('below the floor'));
    right.appendChild(document.createTextNode(' \u00b7 ' + rows.length + ' plotted'));
    fill($('plothd'), [left, right]);
  }

  /* ── the sieve, built from the rows themselves ─────────────────────────── */

  function census(field) {
    var out = {};
    R.rows.forEach(function (r) {
      var keys = field === 'chains' ? r.chains : [field === 'band' ? r.band : (r.category || 'Uncategorised')];
      keys.forEach(function (k) { out[k] = (out[k] || 0) + 1; });
    });
    return out;
  }

  function group(title, counts, active, limit, flip) {
    var box = mk('div');
    box.appendChild(mk('h2', null, title));
    var strip = mk('div', 'chips');
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var shown = keys.slice(0, limit);
    Object.keys(active).forEach(function (k) { if (shown.indexOf(k) < 0) shown.push(k); });
    shown.forEach(function (k) {
      var b = mk('button', 'chip' + (active[k] ? ' on' : ''));
      b.type = 'button';
      b.appendChild(mk('span', null, k));
      b.appendChild(mk('i', null, String(counts[k])));
      b.addEventListener('click', function () { flip(k); });
      strip.appendChild(b);
    });
    box.appendChild(strip);
    return box;
  }

  function toggle(bag, k) {
    if (bag[k]) delete bag[k]; else bag[k] = true;
  }

  function drawFilters() {
    var rail = $('filters');
    var scope = mk('div');
    scope.appendChild(mk('h2', null, 'Scope'));
    var only = mk('button', 'chip' + (state.watch ? ' on' : ''));
    only.type = 'button';
    only.appendChild(mk('span', null, 'Watchlist only'));
    only.appendChild(mk('i', null, String(R.counts.watchlist)));
    only.addEventListener('click', function () { state.watch = !state.watch; render(); });
    scope.appendChild(only);

    var wipe = mk('button', 'wipe', 'Clear the sieve');
    wipe.type = 'button';
    wipe.addEventListener('click', function () {
      state.cat = {}; state.chain = {}; state.band = {}; state.watch = false; state.q = '';
      $('q').value = '';
      render();
    });

    fill(rail, [
      scope,
      group('Category', census('category'), state.cat, 9, function (k) { toggle(state.cat, k); render(); }),
      group('Chain', census('chains'), state.chain, 7, function (k) { toggle(state.chain, k); render(); }),
      group('Time token-less', census('band'), state.band, 4, function (k) { toggle(state.band, k); render(); }),
      wipe
    ]);
  }

  /* ── the board's columns, and its rows ────────────────────────────────── */

  var COLS = [
    { key: null, label: '#', cls: 'r' },
    { key: 'name', label: 'Protocol \u00b7 plan \u00b7 TVL \u00b7 7d', cls: 's' },
    { key: 'implied', label: 'Implied value \u00b7 P10\u2013P90', cls: 's r' },
    { key: null, label: '$1k slice', cls: 'r' },
    { key: null, label: 'Net of costs', cls: 'r' }
  ];

  function drawCols() {
    fill($('cols'), COLS.map(function (c) {
      var s = mk('span', c.cls);
      s.appendChild(mk('span', null, c.label));
      if (c.key) {
        if (state.sort === c.key) {
          s.classList.add('on');
          s.appendChild(mk('span', null, state.dir === 'asc' ? '\u2191' : '\u2193'));
          s.addEventListener('click', function () { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; render(); });
        } else {
          s.addEventListener('click', function () {
            state.sort = c.key;
            state.dir = c.key === 'name' ? 'asc' : 'desc';
            render();
          });
        }
      }
      return s;
    }));
  }

  function rowNode(r, ceiling) {
    var b = mk('button', 'line' + (r.watch ? ' watch' : '') + (state.open === r.slug ? ' sel' : ''));
    b.type = 'button';
    b.appendChild(mk('span', 'rank', String(r.rank)));

    var who = mk('span', 'who');
    who.appendChild(mk('b', null, r.name));
    var sub = mk('span');
    sub.appendChild(mk('em', null, r.strategy));
    sub.appendChild(mk('i', 'sep', ' \u00b7 ' + brief(r.tvl) + ' \u00b7 '));
    var flow = mk('i', 'fl ' + (r.chg === null ? '' : r.chg >= 0 ? 'up' : 'down'));
    flow.textContent = r.chg === null ? 'no 7d print' : (r.chg >= 0 ? '\u25b2' : '\u25bc') + Math.abs(r.chg).toFixed(1) + '%';
    sub.appendChild(flow);
    who.appendChild(sub);
    b.appendChild(who);

    var bar = mk('span', 'measure');
    bar.style.setProperty('--w', Math.max(4, Math.round((r.implied / ceiling) * 100)) + '%');
    bar.appendChild(mk('span', null, brief(r.implied)));
    bar.appendChild(mk('u', null, brief(r.low) + '\u2013' + brief(r.high)));
    b.appendChild(bar);

    b.appendChild(mk('span', 'money', '$' + r.econ.slice_usd.toFixed(2)));

    var v = mk('span', 'verdict ' + r.econ.verdict);
    v.appendChild(mk('b', null, r.econ.verdict.toUpperCase() + ' ' + signed(r.econ.net_usd)));
    v.appendChild(mk('i', null, signed(r.econ.per_hour) + '/h'));
    b.appendChild(v);

    b.addEventListener('click', function () {
      state.open = state.open === r.slug ? null : r.slug;
      render();
    });
    return b;
  }

  function drawLines(rows) {
    var host = $('lines');
    if (!rows.length) {
      fill(host, [mk('div', 'tail', 'No protocol survives this sieve. Clear one filter and the board returns.')]);
      return;
    }
    var ceiling = 1;
    rows.forEach(function (r) { if (r.implied > ceiling) ceiling = r.implied; });
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(rowNode(r, ceiling)); });
    fill(host, [frag]);
  }

  /* ── the sheet, when nothing is open: what the page stands on ──────────── */

  function drawMethod() {
    var d = $('sheet');
    var head = mk('div', 'mhead');
    head.appendChild(mk('div', 'kicker', 'the method'));
    head.appendChild(mk('h1', null, 'How a launch is priced'));
    d.appendChild(head);

    var box = mk('div', 'formula');
    box.appendChild(mk('div', 'f1', 'implied = ' + R.fit.a + ' \u00d7 TVL^' + R.fit.b));
    box.appendChild(mk('div', 'f2', '\u00d7 sector \u00d7 flow \u00d7 record'));
    box.appendChild(mk('div', 'f3', 'least squares over the ' + R.fit.n + ' protocols here whose token already trades, r\u00b2 ' + R.fit.r2 + '. The size curve is the market\u2019s own answer to what a dollar of TVL has been worth as a dollar of market cap.'));
    d.appendChild(box);

    var facs = mk('div', 'factors');
    var factor = function (name, note, items) {
      var row = mk('div', 'factor');
      row.appendChild(mk('span', 'fn', name));
      row.appendChild(mk('span', 'fd', note));
      var bags = mk('div', 'fv');
      items.forEach(function (it) { bags.appendChild(mk('i', null, it[0] + ' ' + times(it[1]))); });
      row.appendChild(bags);
      facs.appendChild(row);
    };
    factor('size', 'what a dollar of TVL has been worth', []);
    factor('sector', 'its category against that curve, shrunk by twenty pseudo-peers',
      R.sectors.slice(0, 4).map(function (s) { return [s.category, s.adj]; }));
    factor('flow', 'seven-day TVL change, in four buckets',
      [['shrinking', R.factors.flow.shrinking], ['flat', R.factors.flow.flat],
        ['growing', R.factors.flow.growing], ['surging', R.factors.flow.surging]]);
    factor('record', 'how long it has run with no token',
      [['new', R.factors.age.new], ['forming', R.factors.age.forming],
        ['seasoned', R.factors.age.seasoned], ['old', R.factors.age['long-standing']]]);
    d.appendChild(facs);

    var bt = mk('div', 'sect');
    bt.appendChild(mk('span', null, 'Left out, refitted, asked back'));
    bt.appendChild(mk('span', null, 'median miss \u00b7 within 3\u00d7'));
    d.appendChild(bt);
    var table = mk('div', 'blind');
    R.tests.forEach(function (t) {
      var row = mk('div', 'brow' + (t.name === R.variant ? ' on' : ''));
      row.appendChild(mk('span', null, t.name));
      row.appendChild(mk('b', null, '\u00d7' + t.miss));
      row.appendChild(mk('i', null, Math.round(t.within3 * 100) + '%'));
      table.appendChild(row);
    });
    d.appendChild(table);

    var fn = mk('div', 'sect');
    fn.appendChild(mk('span', null, 'Farm next'));
    fn.appendChild(mk('span', null, 'net an hour'));
    d.appendChild(fn);
    var list = mk('div', 'pick');
    R.farm_next.forEach(function (x) {
      var row = mk('div');
      var go = mk('button', null, x.name);
      go.type = 'button';
      go.addEventListener('click', function () {
        for (var i = 0; i < R.rows.length; i++) {
          if (R.rows[i].name === x.name) { state.open = R.rows[i].slug; break; }
        }
        render();
      });
      row.appendChild(go);
      row.appendChild(mk('i', null, '#' + x.rank));
      row.appendChild(mk('b', null, signed(x.per_hour) + '/h'));
      list.appendChild(row);
    });
    d.appendChild(list);

    d.appendChild(mk('div', 'note',
      'Each trading token is left out in turn, every parameter refitted without it, and its own market cap asked back. '
      + 'The arrow marks the model the board uses: a shade behind the bare size curve on the typical miss and ahead of '
      + 'every variant on how often it lands within three times, so flow and record earn their place. The range on each '
      + 'row is that measured miss at P10 and P90, not a guess. Implied value is this entry\u2019s own claim about what a '
      + 'token would be worth if the record stood still; it is not a forecast that a token is issued, and it is not '
      + 'make.fun\u2019s. A protocol can hold a token its record does not carry.'));
  }

  /* ── the sheet, with one row open: why it ranks, what it would net ─────── */

  function stepRow(label, value, op, total) {
    var n = mk('div', 'step' + (op ? ' op' : '') + (total ? ' total' : ''));
    n.appendChild(mk('span', null, label));
    n.appendChild(mk('b', null, value));
    return n;
  }

  function peerRow(name, detail, ratio) {
    var n = mk('div');
    n.appendChild(mk('span', null, name));
    n.appendChild(mk('i', null, detail));
    n.appendChild(mk('b', null, ratio));
    return n;
  }

  function drawBrief(row) {
    var d = $('sheet');

    var bar = mk('div', 'bar');
    bar.appendChild(mk('span', null, 'Protocol brief'));
    var close = mk('button', null, 'Close \u00b7 esc');
    close.type = 'button';
    close.addEventListener('click', function () { state.open = null; render(); });
    bar.appendChild(close);
    d.appendChild(bar);

    var head = mk('div', 'open');
    var kicker = mk('div', 'kicker');
    kicker.appendChild(mk('span', null, 'rank ' + row.rank + ' of ' + R.rows.length));
    kicker.appendChild(mk('span', null, row.watch ? '\u00b7 on the watchlist' : '\u00b7 below the floor, still launchable'));
    head.appendChild(kicker);
    head.appendChild(mk('h1', null, row.name));
    head.appendChild(mk('div', 'meta', (row.category || 'Uncategorised') + ' \u00b7 ' + row.chains.join(' / ')));
    var meta2 = mk('div', 'meta');
    meta2.appendChild(document.createTextNode('TVL '));
    meta2.appendChild(mk('b', null, exact(row.tvl)));
    meta2.appendChild(document.createTextNode(' \u00b7 7d ' + pct(row.chg) + ' \u00b7 ' + span(row.age)
      + (row.listed ? ' (tracked since ' + row.listed + ')' : '')));
    head.appendChild(meta2);
    d.appendChild(head);

    d.appendChild(mk('p', 'why', row.why));

    var head2 = mk('div', 'headline');
    head2.appendChild(mk('div', 'lbl', 'Implied token value'));
    head2.appendChild(mk('div', 'v', exact(row.implied)));
    head2.appendChild(mk('div', 'sub', 'if ' + row.name + '\u2019s record stood still: the market\u2019s size curve, '
      + 'its category against that curve, its flow and its record, multiplied out'));
    d.appendChild(head2);

    var der = mk('div', 'steps');
    der.appendChild(stepRow('TVL at the snapshot block', exact(row.tvl)));
    der.appendChild(stepRow('size curve, ' + R.fit.a + ' \u00d7 TVL^' + R.fit.b, exact(row.curve), true));
    der.appendChild(stepRow('\u00d7 sector, ' + (row.category || 'all categories') + ' against the curve', times(row.adj), true));
    der.appendChild(stepRow('\u00d7 flow, TVL over seven days at ' + pct(row.chg), times(row.flowf), true));
    der.appendChild(stepRow('\u00d7 record, ' + span(row.age), times(row.agef), true));
    der.appendChild(stepRow('implied token value', exact(row.implied), false, true));
    der.appendChild(stepRow('P10 to P90, on the blind miss', brief(row.low) + ' \u2013 ' + brief(row.high)));
    d.appendChild(der);

    var econ = mk('div', 'econ ' + row.econ.verdict);
    var eh = mk('div', 'eh');
    eh.appendChild(mk('span', null, 'On a $' + R.model.ticket_usd + ' ticket'));
    eh.appendChild(mk('b', null, row.econ.verdict.toUpperCase() + '  ' + signed(row.econ.net_usd)));
    econ.appendChild(eh);
    var el = mk('div', 'el');
    el.appendChild(mk('i', null, 'slice $' + row.econ.slice_usd.toFixed(2)));
    el.appendChild(mk('i', null, '\u2212 gas $' + row.econ.gas_usd.toFixed(2)));
    el.appendChild(mk('i', null, '\u2212 capital $' + row.econ.capital_usd.toFixed(2)));
    el.appendChild(mk('i', null, '\u00f7 ' + row.econ.hours + ' h = ' + signed(row.econ.per_hour) + ' an hour'));
    econ.appendChild(el);
    d.appendChild(econ);

    var peerHead = mk('div', 'sect');
    peerHead.appendChild(mk('span', null, 'The multiple, measured'));
    d.appendChild(peerHead);
    var peers = mk('div', 'peers');
    peers.appendChild(peerRow('this protocol, at the multiple the board applied', '', times(row.implied / Math.max(row.tvl, 1))));
    var sector = sectorOf(row.category || '');
    if (sector && sector.examples.length) {
      sector.examples.forEach(function (x) {
        peers.appendChild(peerRow(x.name, brief(x.mcap_usd) + ' / ' + brief(x.tvl_usd), times(x.ratio)));
      });
    } else {
      var world = R.sectors[R.sectors.length - 1];
      peers.appendChild(peerRow('no four trading peers in ' + (row.category || 'this category')
        + ': the whole snapshot\u2019s median of ' + world.peers + ' trading protocols applies', '', times(world.adj)));
    }
    d.appendChild(peers);

    var planHead = mk('div', 'sect');
    planHead.appendChild(mk('span', null, 'How to farm it'));
    planHead.appendChild(mk('span', null, row.steps.length + ' steps'));
    d.appendChild(planHead);

    var plan = mk('ol', 'plan');
    row.steps.forEach(function (s) {
      var li = mk('li');
      li.appendChild(document.createTextNode(s.text));
      var t = mk('div', 't');
      t.appendChild(mk('i', 'c', s.cost));
      t.appendChild(mk('i', null, s.time));
      li.appendChild(t);
      plan.appendChild(li);
    });
    d.appendChild(plan);

    var total = mk('div', 'plantotal');
    total.appendChild(mk('span', null, 'The whole plan'));
    var tt = mk('div', 't');
    tt.appendChild(mk('i', 'c', row.total.capital));
    tt.appendChild(mk('i', 'c', row.total.gas));
    tt.appendChild(mk('i', null, row.total.time));
    total.appendChild(tt);
    d.appendChild(total);

    d.appendChild(mk('div', 'note',
      'It records no token: the snapshot carries neither a ticker nor a coin id for it, and that is not proof none '
      + 'exists, because a record can lag. The implied value ranks what its figures would be worth today; it says '
      + 'nothing about whether or when a token is issued, and it is this entry\u2019s own claim, not make.fun\u2019s.'));
  }

  /* ── the two other boards ─────────────────────────────────────────────── */

  function hidePlot() {
    $('plot').textContent = '';
    $('plothd').textContent = '';
    $('plotwrap').style.display = 'none';
  }

  function showPlot() { $('plotwrap').style.display = ''; }

  function drawLive() {
    hidePlot();
    fill($('cols'), [
      { label: '#', cls: 'r' }, { label: 'Protocol whose token already trades', cls: '' },
      { label: 'Market cap', cls: 'r' }, { label: 'TVL', cls: 'r' },
      { label: 'Cap / TVL', cls: 'r' }, { label: '7d flow', cls: 'r' }
    ].map(function (c) { return mk('span', c.cls, c.label); }));

    var frag = document.createDocumentFragment();
    R.live.forEach(function (r, i) {
      var b = mk('button', 'line');
      b.type = 'button';
      b.appendChild(mk('span', 'rank', String(i + 1)));
      var who = mk('span', 'who');
      who.appendChild(mk('b', null, r.name));
      var sub = mk('span');
      sub.appendChild(mk('em', null, r.category || 'Uncategorised'));
      sub.appendChild(document.createTextNode(' \u00b7 ' + r.chains.slice(0, 3).join(' / ')));
      who.appendChild(sub);
      b.appendChild(who);
      b.appendChild(mk('span', 'money', brief(r.mcap_usd)));
      b.appendChild(mk('span', 'money', brief(r.tvl_usd)));
      b.appendChild(mk('span', 'ratio', times(r.ratio)));
      var flow = mk('span', 'pill ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'));
      flow.textContent = r.change_7d === null ? '\u00b7' : pct(r.change_7d);
      b.appendChild(flow);
      b.appendChild(mk('span'));
      frag.appendChild(b);
    });
    fill($('lines'), [frag]);
    $('tail').textContent = 'These ' + R.live.length + ' already trade, the largest by market cap. The market has '
      + 'priced them, so the radar ranks them apart from the ' + R.counts.launchable + ' still to come, and fits its '
      + 'curve and its category multiples on their market caps against their TVL.';
  }

  function drawSectors() {
    hidePlot();
    $('cols').textContent = '';
    var wrap = mk('div', 'sectors');
    var head = mk('div', 'srow');
    ['Category', 'Multiple', 'Trading peers', 'Largest trading members, and their own cap/TVL'].forEach(function (t, i) {
      head.appendChild(mk(i === 0 ? 'b' : i === 3 ? 'ex' : i === 1 ? 'm' : 'p', null, t));
    });
    wrap.appendChild(head);
    R.sectors.forEach(function (s) {
      var row = mk('div', 'srow');
      row.appendChild(mk('b', null, s.category));
      row.appendChild(mk('div', 'm', times(s.adj)));
      row.appendChild(mk('div', 'p', String(s.peers)));
      row.appendChild(mk('div', 'ex', s.examples.length
        ? s.examples.map(function (e) { return e.name + ' ' + times(e.ratio); }).join('  \u00b7  ')
        : s.basis));
      wrap.appendChild(row);
    });
    fill($('lines'), [wrap]);
    $('tail').textContent = 'Every multiple is measured, never assumed: it is the residual of a category\u2019s trading '
      + 'members against the size curve, shrunk toward one by twenty pseudo-peers so a thin category cannot run away '
      + 'with the board. A category with fewer than four trading members is left on the curve alone.';
  }

  /* ── the foot ─────────────────────────────────────────────────────────── */

  function drawColophon() {
    var t = usedTest();
    [
      ['implied value', R.fit.a + ' \u00d7 TVL^' + R.fit.b + ' \u00d7 sector \u00d7 flow \u00d7 record'],
      ['fit', 'least squares on ' + R.fit.n + ' trading tokens, r\u00b2 ' + R.fit.r2],
      ['blind test', 'each held out and refitted: \u00d7' + R.tests[0].miss + ' for a flat multiple, \u00d7' + t.miss + ' here'],
      ['source', R.source]
    ].forEach(function (p) {
      var s = mk('span');
      s.appendChild(mk('b', null, p[0] + ': '));
      s.appendChild(document.createTextNode(p[1]));
      $('colophon').appendChild(s);
    });
  }

  /* ── draw it ──────────────────────────────────────────────────────────── */

  function render() {
    $('frame').classList.toggle('wide', state.view !== 'board');
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    showPlot();
    drawTiles();

    if (state.view === 'live') {
      drawLive();
    } else if (state.view === 'sectors') {
      drawSectors();
    } else {
      var rows = orderedRows();
      drawPlot(rows);
      drawCols();
      drawLines(rows);
      fill($('tail'), [
        mk('b', null, String(rows.length)),
        document.createTextNode(' of ' + R.rows.length + ' ranked rows \u00b7 ' + R.counts.watchlist
          + ' watchlist protocols covered \u00b7 the largest implied values belong to the largest protocols, so a '
          + '$1,000 ticket buys a thin slice of them and most of the top rows skip \u00b7 the rows that pay sit lower '
          + 'down, and Farm next names them \u00b7 ')
      ]);
      $('tail').appendChild(mk('b', null, 'FARM'));
      $('tail').appendChild(document.createTextNode(' and '));
      $('tail').appendChild(mk('b', null, 'THIN'));
      $('tail').appendChild(document.createTextNode(' are net of all costs, not gross of them.'));
    }

    var open = state.open ? bySlug(state.open) : null;
    fill($('sheet'), []);
    if (open) drawBrief(open); else drawMethod();
    drawFilters();
    drawHead();
    writeAddress();
    $('board').focus({ preventScroll: true });
  }

  function boot() {
    if (!R) {
      document.body.textContent = 'The radar data did not load: data.js has to sit beside the page.';
      return;
    }
    readAddress();
    $('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.dataset.view; render(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) { state.open = null; render(); }
      else if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    });
    var timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { if (state.view === 'board') render(); }, 120);
    });
    if (state.q) $('q').value = state.q;
    drawColophon();
    render();
  }

  boot();
})();
