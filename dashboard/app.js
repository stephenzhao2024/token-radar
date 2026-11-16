/* Token Radar — the page. Reads window.RADAR (written by main.ts beside this file), renders the
   ranked board, the filters, the sector multiples and the trading-now set, and opens a detail
   view for one protocol. No network, no framework, no imports. */

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

  /* ── formatting ──────────────────────────────────────────────────── */

  var compact = (function () {
    var units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    return function (n) {
      if (!isFinite(n)) return '—';
      var abs = Math.abs(n);
      if (abs >= 1e3) {
        for (var i = 0; i < units.length; i++) {
          var at = units[i][0];
          if (abs >= at) {
            var v = n / at;
            return '$' + (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)) + units[i][1];
          }
        }
      }
      return '$' + Math.round(n);
    };
  })();

  function full(n) {
    if (!isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(v) {
    if (v === null || v === undefined) return 'n/a';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function mult(v) {
    if (!isFinite(v)) return '—';
    return '×' + (v >= 1 ? v.toFixed(2) : v.toFixed(3));
  }

  function days(n) {
    if (n === null || n === undefined) return 'age unrecorded';
    if (n < 60) return n + ' days token-less';
    if (n < 730) return Math.round(n / 30.44) + ' months token-less';
    return (n / 365).toFixed(1) + ' years token-less';
  }

  /* ── state ───────────────────────────────────────────────────────── */

  var state = {
    view: 'board',
    q: '',
    cats: {},
    chains: {},
    bands: {},
    watch: false,
    sort: 'implied',
    dir: 'desc',
    detail: null,
  };

  var SORTS = {
    implied: function (r) { return r.implied; },
    tvl: function (r) { return r.tvl; },
    chg: function (r) { return r.chg === null ? -1e9 : r.chg; },
    ratio: function (r) { return r.implied / Math.max(r.tvl, 1); },
    age: function (r) { return r.age === null ? -1 : r.age; },
    name: function (r) { return r.name.toLowerCase(); },
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

    var watch = el('div');
    watch.appendChild(el('h2', null, 'Scope'));
    var wb = el('button', 'chip' + (state.watch ? ' on' : ''));
    wb.type = 'button';
    wb.appendChild(el('span', null, 'Watchlist only'));
    wb.appendChild(el('i', null, String(R.counts.watchlist)));
    wb.addEventListener('click', function () { state.watch = !state.watch; render(); });
    watch.appendChild(wb);
    rail.appendChild(watch);

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
    { key: 'age', label: 'Record', cls: 's r' },
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
          s.appendChild(el('span', null, state.dir === 'asc' ? '↑' : '↓'));
          s.addEventListener('click', function () {
            state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            render();
          });
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

  function drawBoard() {
    var rows = visible();
    var max = 1;
    rows.forEach(function (r) { if (r.implied > max) max = r.implied; });

    var host = $('rows');
    host.textContent = '';

    if (rows.length === 0) {
      var none = el('div', 'foot-note');
      none.textContent = 'No protocol matches these filters. Clear one and the board returns.';
      host.appendChild(none);
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
      sub.appendChild(document.createTextNode(' · ' + r.chains.slice(0, 3).join(' / ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')));
      who.appendChild(sub);
      b.appendChild(who);

      b.appendChild(el('span', 'n', compact(r.tvl)));

      var flow = el('span', 'pill ' + (r.chg === null ? '' : r.chg >= 0 ? 'up' : 'down'));
      flow.textContent = (r.chg === null ? '·' : (r.chg >= 0 ? '▲ ' : '▼ ') + Math.abs(r.chg).toFixed(1) + '%');
      b.appendChild(flow);

      b.appendChild(el('span', 'mult', mult(r.implied / Math.max(r.tvl, 1))));

      var bar = el('span', 'bar');
      bar.style.setProperty('--w', Math.max(4, Math.round((r.implied / max) * 100)) + '%');
      bar.appendChild(el('span', null, compact(r.implied)));
      b.appendChild(bar);

      var bandCol = el('span', 'bandcol');
      bandCol.appendChild(el('span', 'bnd ' + r.band, r.band.replace('-', ' ')));
      b.appendChild(bandCol);

      b.addEventListener('click', function () {
        state.detail = state.detail === r.slug ? null : r.slug;
        render();
      });
      frag.appendChild(b);
    });
    host.appendChild(frag);
  }

  /* ── trading-now view ────────────────────────────────────────────── */

  function drawLive() {
    var host = $('rows');
    host.textContent = '';
    var head = $('thead');
    head.textContent = '';
    var cols = [
      { key: null, label: '#', cls: 'r' },
      { key: null, label: 'Protocol whose token already trades', cls: '' },
      { key: null, label: 'Market cap', cls: 'r' },
      { key: null, label: 'TVL', cls: 'r' },
      { key: null, label: 'Cap / TVL', cls: 'r' },
      { key: null, label: '7d flow', cls: 'r' },
    ];
    cols.forEach(function (c) {
      head.appendChild(el('span', c.cls, c.label));
    });

    var frag = document.createDocumentFragment();
    R.live.forEach(function (r, i) {
      var b = el('button', 'row');
      b.type = 'button';
      b.appendChild(el('span', 'rank', String(i + 1)));
      var who = el('span', 'who');
      who.appendChild(el('b', null, r.name));
      var sub = el('span');
      sub.appendChild(el('em', null, r.category || 'Uncategorised'));
      sub.appendChild(document.createTextNode(' · ' + r.chains.slice(0, 3).join(' / ')));
      who.appendChild(sub);
      b.appendChild(who);
      b.appendChild(el('span', 'n big', compact(r.mcap_usd)));
      b.appendChild(el('span', 'n', compact(r.tvl_usd)));
      b.appendChild(el('span', 'mult', mult(r.ratio)));
      var flow = el('span', 'pill ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'));
      flow.textContent = r.change_7d === null ? '·' : pct(r.change_7d);
      b.appendChild(flow);
      b.appendChild(el('span'));
      frag.appendChild(b);
    });
    host.appendChild(frag);
    $('footnote').textContent = 'These protocols already trade. A launch radar ranks them apart: their value is the market\u2019s own, and the board\u2019s job is the ones still to come. Market cap and TVL both read from the same sealed snapshot.';
  }

  /* ── sectors view ────────────────────────────────────────────────── */

  function drawSectors() {
    $('thead').textContent = '';
    var host = $('rows');
    host.textContent = '';
    var wrap = el('div', 'sectors');
    var head = el('div', 'srow');
    ['Category', 'Multiple', 'Peers', 'Largest trading members'].forEach(function (t, i) {
      var n = el(i === 0 ? 'b' : i === 3 ? 'ex' : i === 1 ? 'm' : 'p', null, t);
      head.appendChild(n);
    });
    wrap.appendChild(head);
    R.sectors.forEach(function (s) {
      var row = el('div', 'srow');
      row.appendChild(el('b', null, s.category));
      row.appendChild(el('div', 'm', mult(s.multiple)));
      row.appendChild(el('div', 'p', String(s.peers)));
      row.appendChild(el('div', 'ex', s.examples.length ? s.examples.map(function (e) { return e.name + ' ' + mult(e.ratio); }).join('  ·  ') : s.basis));
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
    $('footnote').textContent = 'Each category\u2019s multiple is the median market-cap-to-TVL ratio of the protocols in it whose token already trades \u2014 the snapshot\u2019s own market, not an assumption. A category with fewer than three trading members borrows the whole snapshot\u2019s median.';
  }

  /* ── detail drawer ───────────────────────────────────────────────── */

  function drawDrawer() {
    var d = $('drawer');
    d.textContent = '';
    var row = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === state.detail) row = R.rows[i];
    if (!row) {
      d.textContent = '';
      return;
    }

    var bar = el('div', 'dbar');
    bar.appendChild(el('span', null, 'Protocol dossier'));
    var close = el('button', null, 'Close  esc');
    close.type = 'button';
    close.addEventListener('click', function () {
      state.detail = null;
      render();
    });
    bar.appendChild(close);
    d.appendChild(bar);

    var head = el('div', 'd-head');
    var kick = el('div', 'kicker');
    kick.appendChild(el('span', null, 'rank ' + row.rank + ' of ' + R.rows.length));
    if (row.watch) kick.appendChild(el('span', null, '· on the watchlist'));
    head.appendChild(kick);
    head.appendChild(el('h1', null, row.name));
    var meta = el('div', 'meta');
    meta.textContent = (row.category || 'Uncategorised') + ' · ' + row.chains.join(' / ');
    head.appendChild(meta);
    var meta2 = el('div', 'meta');
    meta2.appendChild(document.createTextNode('TVL '));
    var b1 = el('b', null, full(row.tvl));
    meta2.appendChild(b1);
    meta2.appendChild(document.createTextNode(' · 7d ' + pct(row.chg) + ' · ' + days(row.age) + (row.listed ? ' (tracked since ' + row.listed + ')' : '')));
    head.appendChild(meta2);
    d.appendChild(head);

    var vb = el('div', 'value-block');
    vb.appendChild(el('div', 'lbl', 'Implied token value'));
    vb.appendChild(el('div', 'v', full(row.implied)));
    vb.appendChild(el('div', 'sub', 'if ' + row.name + '\u2019s record stood still: TVL × the trading multiple of its category × its flow × its record'));
    d.appendChild(vb);

    var der = el('div', 'derive');
    der.appendChild(stepLine('TVL at the snapshot block', full(row.tvl), false));
    der.appendChild(stepLine('× ' + (row.category || 'every category') + ' multiple, ' + row.sectorBasis, mult(row.sector), true));
    der.appendChild(stepLine('× flow, TVL over seven days at ' + pct(row.chg), mult(row.growth), true));
    der.appendChild(stepLine('× record, ' + days(row.age), mult(row.maturity), true));
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
      sector.examples.forEach(function (x) {
        peers.appendChild(peerRow(x.name, compact(x.mcap_usd), compact(x.tvl_usd), mult(x.ratio)));
      });
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
      var c = el('i', 'c', s.cost);
      t.appendChild(c);
      t.appendChild(el('i', null, s.time));
      li.appendChild(t);
      plan.appendChild(li);
    });
    d.appendChild(plan);

    var note = el('div', 'note');
    note.textContent = 'It records no token: DefiLlama\u2019s record carries neither a ticker nor a coin id for it. That is not proof none exists \u2014 a record can lag. Implied value ranks what its figures would be worth today, and says nothing about whether or when a token is issued.';
    d.appendChild(note);
  }

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

  /* ── footer + wire-up ────────────────────────────────────────────── */

  function drawFormula() {
    var f = $('formula');
    f.textContent = '';
    var parts = [
      ['implied value', 'TVL × sector multiple × flow × record'],
      ['sector multiple', 'median cap/TVL of that category\u2019s trading protocols'],
      ['flow', '1 + 0.5 × 7d change, clamped to −60% … +120%'],
      ['record', '0.55 + 0.45 × (1 − e^−age/500d): a proven, long token-less run'],
      ['source', R.source],
    ];
    parts.forEach(function (p) {
      var s = el('span');
      s.appendChild(el('b', null, p[0] + ': '));
      s.appendChild(document.createTextNode(p[1]));
      f.appendChild(s);
    });
  }

  function render() {
    var stage = $('stage');
    var open = state.detail !== null && state.view === 'board';
    document.querySelector('.shell').classList.toggle('wide', !open);
    document.querySelectorAll('.switch button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === state.view);
    });
    if (state.view === 'live') {
      drawLive();
    } else if (state.view === 'sectors') {
      drawSectors();
    } else {
      drawHead();
      drawBoard();
      var f = $('footnote');
      f.textContent = '';
      f.appendChild(el('b', null, String(visible().length)));
      f.appendChild(document.createTextNode(
        ' of ' + R.rows.length + ' ranked rows · ' + R.counts.watchlist + ' watchlist protocols covered · ' +
        'every protocol that records no token, at any size, ranked by what its token would be worth · ' +
        'pick a row for its derivation and farm plan'
      ));
    }
    drawDrawer();
    drawRail();
    drawHeader();
    writeUrl();
    stage.focus({ preventScroll: true });
  }

  function boot() {
    if (!R) {
      document.body.textContent = 'The radar data did not load: data.js must sit beside the page.';
      return;
    }
    readUrl();
    $('q').addEventListener('input', function (e) {
      state.q = e.target.value;
      render();
    });
    document.querySelectorAll('.switch button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.view = b.dataset.view;
        render();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.detail) {
        state.detail = null;
        render();
      } else if (e.key === '/' && document.activeElement !== $('q')) {
        e.preventDefault();
        $('q').focus();
      }
    });
    if (state.q) $('q').value = state.q;
    drawFormula();
    render();
  }

  boot();
})();
