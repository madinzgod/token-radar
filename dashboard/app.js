// Token Radar's dashboard. A static page with no network: main.ts writes the whole dataset
// beside this folder as radar-data.js (window.RADAR_DATA), and everything below renders from it —
// the ranked board, one detail view per protocol with its value breakdown and farm plan, the
// already-trading set kept apart, and the methodology the board runs on. Views are hash routes,
// so a filtered board or a protocol's page can be linked (and screenshotted) directly:
//   #/board   #/board?chain=Base&tab=watchlist   #/protocol/<slug>   #/method

(function () {
  'use strict';

  var DATA = window.RADAR_DATA;
  var app = document.getElementById('app');

  /* Small DOM helpers ---------------------------------------------------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function link(href, cls, text) {
    var a = el('a', cls, text);
    a.href = href;
    return a;
  }

  /* Formatting ------------------------------------------------------------ */

  function formatUsd(value) {
    if (value === null || value === undefined) return '—';
    if (value >= 1e9) return '$' + trimNum(value / 1e9) + 'B';
    if (value >= 1e6) return '$' + trimNum(value / 1e6) + 'M';
    if (value >= 1e3) return '$' + trimNum(value / 1e3) + 'K';
    return '$' + value;
  }

  function trimNum(n) {
    return n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
  }

  function formatPct(change) {
    if (change === null || change === undefined) return 'unreported';
    var sign = change > 0 ? '+' : '';
    return sign + (Math.round(change * 10) / 10) + '%';
  }

  function pctClass(change) {
    if (change === null || change === undefined || change === 0) return 'flat';
    return change > 0 ? 'up' : 'down';
  }

  function formatAge(days) {
    if (days === null || days === undefined) return 'unreported';
    if (days < 365) return days + 'd tokenless';
    return (days / 365.25).toFixed(1) + ' yrs tokenless';
  }

  function chainLabel(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 2) return chains.join(', ');
    return chains[0] + ' +' + (chains.length - 1);
  }

  /** Why a protocol's signal runs hot, in one line, from its own figures. */
  function signalReason(row) {
    var parts = [];
    if (row.change_7d !== null && row.change_7d !== undefined && row.change_7d > 2) {
      parts.push('TVL ' + formatPct(row.change_7d) + ' in 7 days');
    }
    if (row.age_days !== null && row.age_days >= 730) parts.push(formatAge(row.age_days));
    if (row.chains.length >= 4) parts.push('runs on ' + row.chains.length + ' chains');
    if (parts.length === 0 && row.change_7d !== null && row.change_7d !== undefined) {
      parts.push('TVL ' + formatPct(row.change_7d) + ' in 7 days');
    }
    if (parts.length === 0) parts.push(formatAge(row.age_days));
    return parts.slice(0, 3).join(' · ');
  }

  /* Routing ---------------------------------------------------------------- */

  function parseHash() {
    var raw = window.location.hash.replace(/^#/, '') || '/board';
    var qAt = raw.indexOf('?');
    var path = qAt >= 0 ? raw.slice(0, qAt) : raw;
    var params = new URLSearchParams(qAt >= 0 ? raw.slice(qAt + 1) : '');
    return { path: path, params: params };
  }

  function boardHash(state) {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.chain) p.set('chain', state.chain);
    if (state.cat) p.set('cat', state.cat);
    if (state.tab && state.tab !== 'board') p.set('tab', state.tab);
    if (state.sort && state.sort !== 'implied') p.set('sort', state.sort);
    var s = p.toString();
    return '#/board' + (s ? '?' + s : '');
  }

  /* The board -------------------------------------------------------------- */

  function statCard(valueHtml, label) {
    var card = el('div', 'stat');
    var v = el('div', 'stat-value');
    v.innerHTML = valueHtml;
    card.appendChild(v);
    card.appendChild(el('div', 'stat-label', label));
    return card;
  }

  function renderStats() {
    var wrap = el('section', 'stats');
    var totalImplied = DATA.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
    wrap.appendChild(statCard(String(DATA.counts.scanned), 'protocols in the snapshot'));
    wrap.appendChild(statCard('<em>' + DATA.counts.ranked + '</em>', 'pre-token protocols ranked'));
    wrap.appendChild(statCard(DATA.counts.watchlist + ' / ' + DATA.counts.watchlist, 'watchlist protocols covered'));
    wrap.appendChild(statCard(formatUsd(totalImplied), 'total implied launch value'));
    wrap.appendChild(statCard(String(DATA.counts.live), 'protocols already trading'));
    return wrap;
  }

  function renderSignals() {
    var wrap = el('section', 'signals');
    wrap.appendChild(el('h2', null, 'Strongest signals — hot, not just big'));
    var row = el('div', 'signal-row');
    var top = DATA.rows.slice().sort(function (a, b) { return b.signal_score - a.signal_score || a.rank - b.rank; }).slice(0, 5);
    top.forEach(function (r) {
      var card = link('#/protocol/' + encodeURIComponent(r.slug), 'signal-card');
      var head = el('div');
      head.appendChild(el('span', 'signal-score', String(r.signal_score)));
      head.appendChild(el('span', 'signal-name', r.name));
      card.appendChild(head);
      card.appendChild(el('div', 'signal-why', signalReason(r) + ' · implied ' + formatUsd(r.implied_value_usd)));
      row.appendChild(card);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function allChains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function allCategories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function buildControls(state) {
    var bar = el('div', 'controls');

    var tabs = el('div', 'tabs');
    [['board', 'Ranked board'], ['watchlist', 'Watchlist'], ['live', 'Already trading']].forEach(function (pair) {
      var b = el('button', 'tab', pair[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', state.tab === pair[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.tab = pair[0];
        window.location.hash = boardHash(state);
      });
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);

    var search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search protocols…  ( / )';
    search.value = state.q || '';
    search.setAttribute('aria-label', 'Search protocols');
    search.addEventListener('input', function () {
      state.q = search.value;
      history.replaceState(null, '', boardHash(state));
      updateResults(state);
    });
    bar.appendChild(search);

    var chainSel = document.createElement('select');
    chainSel.setAttribute('aria-label', 'Filter by chain');
    chainSel.appendChild(new Option('Every chain', ''));
    allChains().forEach(function (c) { chainSel.appendChild(new Option(c, c)); });
    chainSel.value = state.chain || '';
    chainSel.addEventListener('change', function () {
      state.chain = chainSel.value;
      window.location.hash = boardHash(state);
    });
    bar.appendChild(chainSel);

    var catSel = document.createElement('select');
    catSel.setAttribute('aria-label', 'Filter by category');
    catSel.appendChild(new Option('Every category', ''));
    allCategories().forEach(function (c) { catSel.appendChild(new Option(c, c)); });
    catSel.value = state.cat || '';
    catSel.addEventListener('change', function () {
      state.cat = catSel.value;
      window.location.hash = boardHash(state);
    });
    bar.appendChild(catSel);

    var sortSel = document.createElement('select');
    sortSel.setAttribute('aria-label', 'Sort the board');
    [['implied', 'Sort: implied value'], ['signal', 'Sort: signal score'], ['tvl', 'Sort: TVL'],
     ['change', 'Sort: 7d change'], ['age', 'Sort: tokenless age']].forEach(function (pair) {
      sortSel.appendChild(new Option(pair[1], pair[0]));
    });
    sortSel.value = state.sort || 'implied';
    sortSel.addEventListener('change', function () {
      state.sort = sortSel.value;
      window.location.hash = boardHash(state);
    });
    bar.appendChild(sortSel);

    return bar;
  }

  function rowMatches(row, state) {
    if (state.tab === 'watchlist' && !row.on_watchlist) return false;
    if (state.chain && row.chains.indexOf(state.chain) < 0) return false;
    if (state.cat && row.category !== state.cat) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function sortRows(rows, sort) {
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      signal: function (a, b) { return b.signal_score - a.signal_score || a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    };
    return rows.sort(by[sort] || by.implied);
  }

  function boardTable(rows) {
    var table = el('table', 'board-table');
    var head = el('thead');
    var hr = el('tr');
    [['#', ''], ['Protocol', ''], ['Chains', 'chains-col'], ['TVL', 'num'], ['7d', 'num'],
     ['Tokenless', ''], ['Implied value', 'num'], ['Signal', '']].forEach(function (pair) {
      hr.appendChild(el('th', pair[1], pair[0]));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.addEventListener('click', function () {
        window.location.hash = '#/protocol/' + encodeURIComponent(r.slug);
      });
      tr.appendChild(el('td', 'rank', String(r.rank)));
      var nameCell = el('td');
      var nameLine = el('div');
      nameLine.appendChild(el('span', 'proto-name', r.name));
      if (r.on_watchlist) nameLine.appendChild(el('span', 'tag', 'WATCHLIST'));
      nameCell.appendChild(nameLine);
      nameCell.appendChild(el('div', 'proto-cat', r.category || 'Uncategorised'));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', 'chains chains-col', chainLabel(r.chains)));
      tr.appendChild(el('td', 'num', formatUsd(r.tvl_usd)));
      var ch = el('td', 'num ' + pctClass(r.change_7d), formatPct(r.change_7d));
      tr.appendChild(ch);
      tr.appendChild(el('td', 'chains', formatAge(r.age_days)));
      tr.appendChild(el('td', 'implied', formatUsd(r.implied_value_usd)));
      var sig = el('td', 'signal-cell');
      sig.appendChild(el('span', 'num', String(r.signal_score)));
      var bar = el('div', 'signal-bar');
      var fill = el('i');
      fill.style.width = r.signal_score + '%';
      bar.appendChild(fill);
      sig.appendChild(bar);
      tr.appendChild(sig);
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function liveTable(state) {
    var rows = DATA.live.filter(function (r) {
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q.toLowerCase()) < 0) return false;
      return true;
    });
    var table = el('table', 'board-table');
    var head = el('thead');
    var hr = el('tr');
    ['Protocol', 'Symbol', 'Chains', 'TVL', '7d', 'Market cap (the market’s own)'].forEach(function (label, i) {
      hr.appendChild(el('th', i >= 3 ? 'num' : '', label));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      var nameCell = el('td');
      nameCell.appendChild(el('span', 'proto-name', r.name));
      nameCell.appendChild(el('div', 'proto-cat', r.category || 'Uncategorised'));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', 'chains', r.symbol || '—'));
      tr.appendChild(el('td', 'chains chains-col', chainLabel(r.chains)));
      tr.appendChild(el('td', 'num', formatUsd(r.tvl_usd)));
      tr.appendChild(el('td', 'num ' + pctClass(r.change_7d), formatPct(r.change_7d)));
      tr.appendChild(el('td', 'implied', formatUsd(r.mcap_usd)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  var resultsHost = null;

  function updateResults(state) {
    if (!resultsHost) return;
    resultsHost.textContent = '';
    if (state.tab === 'live') {
      resultsHost.appendChild(liveTable(state));
      return;
    }
    var rows = sortRows(DATA.rows.filter(function (r) { return rowMatches(r, state); }), state.sort);
    if (rows.length === 0) {
      resultsHost.appendChild(el('p', 'empty-note', 'No protocol matches that filter. Loosen the chain, category or search.'));
      return;
    }
    resultsHost.appendChild(boardTable(rows));
  }

  function renderBoard(state) {
    app.textContent = '';
    app.appendChild(renderStats());
    app.appendChild(renderSignals());
    app.appendChild(buildControls(state));
    var count = el('p', 'result-count');
    count.id = 'result-count';
    app.appendChild(count);
    resultsHost = el('div');
    resultsHost.id = 'results';
    app.appendChild(resultsHost);
    updateResults(state);
    var shown = state.tab === 'live' ? DATA.live.length : DATA.rows.filter(function (r) { return rowMatches(r, state); }).length;
    count.textContent = state.tab === 'live'
      ? 'Already trading — kept apart from the ranked board, at the market’s own values.'
      : 'Showing ' + shown + ' of ' + DATA.rows.length + ' ranked protocols. Click a row for its value breakdown and farm plan.';
  }

  /* Movers and chains --------------------------------------------------------- */

  function renderMovers() {
    app.textContent = '';
    app.appendChild(link('#/board', 'back-link', '← back to the board'));
    app.appendChild(el('h1', 'view-title', 'Top movers — where the TVL is rushing in'));
    app.appendChild(el('p', 'detail-sub',
      'The ranked board’s biggest seven-day TVL gains, as of ' + DATA.as_of + '. A launch is worth more when users are ' +
      'arriving before it happens, so the radar watches the inflow as closely as the size.'));

    var gainers = DATA.rows
      .filter(function (r) { return r.change_7d !== null && r.change_7d !== undefined; })
      .slice()
      .sort(function (a, b) { return b.change_7d - a.change_7d || a.rank - b.rank; })
      .slice(0, 15);
    var table = el('table', 'board-table');
    var head = el('thead');
    var hr = el('tr');
    [['#', ''], ['Protocol', ''], ['Chains', 'chains-col'], ['TVL', 'num'], ['7d change', 'num'],
     ['Implied value', 'num'], ['Signal', '']].forEach(function (pair) {
      hr.appendChild(el('th', pair[1], pair[0]));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    gainers.forEach(function (r) {
      var tr = el('tr');
      tr.addEventListener('click', function () {
        window.location.hash = '#/protocol/' + encodeURIComponent(r.slug);
      });
      tr.appendChild(el('td', 'rank', String(r.rank)));
      var nameCell = el('td');
      var nameLine = el('div');
      nameLine.appendChild(el('span', 'proto-name', r.name));
      if (r.on_watchlist) nameLine.appendChild(el('span', 'tag', 'WATCHLIST'));
      nameCell.appendChild(nameLine);
      nameCell.appendChild(el('div', 'proto-cat', r.category || 'Uncategorised'));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', 'chains chains-col', chainLabel(r.chains)));
      tr.appendChild(el('td', 'num', formatUsd(r.tvl_usd)));
      tr.appendChild(el('td', 'num mover-change ' + pctClass(r.change_7d), formatPct(r.change_7d)));
      tr.appendChild(el('td', 'implied', formatUsd(r.implied_value_usd)));
      tr.appendChild(el('td', 'num', String(r.signal_score)));
      body.appendChild(tr);
    });
    table.appendChild(body);
    app.appendChild(table);
    app.appendChild(el('p', 'result-count',
      'The 15 fastest growers of the ' + DATA.rows.length + ' ranked protocols. Rows whose seven-day change is ' +
      'unreported are counted as flat by the model and cannot appear here. Click a row for its breakdown and farm plan.'));

    app.appendChild(el('h2', 'section-title chain-title', 'Chains at a glance'));
    app.appendChild(el('p', 'detail-sub',
      'Every chain the ranked board touches, by the protocols that run on it: how much of the board sits there, ' +
      'what it is worth together, and the hottest protocol on it this week. A protocol on several chains counts once per chain.'));
    var byChain = {};
    DATA.rows.forEach(function (r) {
      r.chains.forEach(function (c) {
        var s = byChain[c] || (byChain[c] = { chain: c, count: 0, tvl: 0, implied: 0, best: null });
        s.count += 1;
        s.tvl += r.tvl_usd;
        s.implied += r.implied_value_usd;
        if (r.change_7d !== null && r.change_7d !== undefined && (!s.best || r.change_7d > s.best.change_7d)) s.best = r;
      });
    });
    var chains = Object.keys(byChain).map(function (k) { return byChain[k]; })
      .sort(function (a, b) { return b.implied - a.implied || b.count - a.count || (a.chain < b.chain ? -1 : 1); })
      .slice(0, 12);
    var ctable = el('table', 'board-table');
    var chead = el('thead');
    var chr = el('tr');
    ['Chain', 'Protocols', 'Board TVL', 'Implied value together', 'Hottest this week (7d)'].forEach(function (label, i) {
      chr.appendChild(el('th', i >= 1 && i <= 3 ? 'num' : '', label));
    });
    chead.appendChild(chr);
    ctable.appendChild(chead);
    var cbody = el('tbody');
    chains.forEach(function (s) {
      var tr = el('tr');
      tr.appendChild(el('td', 'proto-name', s.chain));
      tr.appendChild(el('td', 'num', String(s.count)));
      tr.appendChild(el('td', 'num', formatUsd(s.tvl)));
      tr.appendChild(el('td', 'implied', formatUsd(s.implied)));
      var hot = el('td');
      if (s.best) {
        hot.appendChild(link('#/protocol/' + encodeURIComponent(s.best.slug), null, s.best.name));
        hot.appendChild(el('span', 'num ' + pctClass(s.best.change_7d), '  ' + formatPct(s.best.change_7d)));
      } else {
        hot.textContent = '—';
      }
      tr.appendChild(hot);
      cbody.appendChild(tr);
    });
    ctable.appendChild(cbody);
    app.appendChild(ctable);
  }

  /* One protocol ------------------------------------------------------------- */

  function meterRow(name, note, fraction, valueText, amber) {
    var row = el('div', 'break-row');
    var label = el('div', 'break-name', name);
    if (note) label.appendChild(el('div', 'proto-cat', note));
    row.appendChild(label);
    var meter = el('div', 'meter' + (amber ? ' amber' : ''));
    var fill = el('i');
    fill.style.width = Math.max(2, Math.min(100, fraction * 100)) + '%';
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(el('div', 'break-value', valueText));
    return row;
  }

  function renderProtocol(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    app.textContent = '';
    if (!row) {
      app.appendChild(link('#/board', 'back-link', '← back to the board'));
      app.appendChild(el('p', 'empty-note', 'No ranked protocol with that name in this snapshot.'));
      return;
    }
    app.appendChild(link('#/board', 'back-link', '← back to the board'));

    var head = el('div', 'detail-head');
    head.appendChild(el('h1', null, row.name));
    head.appendChild(el('span', 'detail-rank', 'rank #' + row.rank + ' of ' + DATA.rows.length));
    if (row.on_watchlist) head.appendChild(el('span', 'tag', 'ON THE WATCHLIST'));
    app.appendChild(head);
    app.appendChild(el('p', 'detail-sub',
      (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.join(', ') : 'no chains recorded') +
      ' · records no token in the ' + DATA.as_of + ' snapshot'));

    var hero = el('div', 'implied-hero');
    hero.appendChild(el('div', 'hero-value', formatUsd(row.implied_value_usd)));
    hero.appendChild(el('div', 'hero-label',
      'implied launch value under the ' + DATA.model_version + ' model — the board’s claim, built below from this protocol’s own figures'));
    app.appendChild(hero);

    var grid = el('div', 'detail-grid');
    grid.appendChild(statCard(formatUsd(row.tvl_usd), 'total value locked'));
    grid.appendChild(statCard(formatPct(row.change_7d), 'TVL change, 7 days'));
    grid.appendChild(statCard(row.age_days === null ? '—' : (row.age_days < 365 ? row.age_days + ' days' : (row.age_days / 365.25).toFixed(1) + ' yrs'),
      'tokenless tenure' + (row.listed_at ? ' · tracked since ' + row.listed_at : ' · date unreported')));
    grid.appendChild(statCard(String(row.chains.length), 'chains it runs on'));
    grid.appendChild(statCard(String(row.signal_score) + ' / 100', 'signal score (heat, not size)'));
    app.appendChild(grid);

    var bd = row.breakdown;
    var base = Math.round(row.tvl_usd * bd.category_multiple);
    var box = el('section', 'breakdown');
    box.appendChild(el('h2', 'section-title', 'How the value is built'));
    box.appendChild(meterRow('Base value', 'TVL × category multiple ×' + bd.category_multiple, base / Math.max(1, row.implied_value_usd), formatUsd(base), false));
    box.appendChild(meterRow('Momentum', '7d TVL change ' + formatPct(row.change_7d) + ', clamped and weighted', (bd.momentum_multiplier - 0.7) / 0.9, '×' + bd.momentum_multiplier.toFixed(2), false));
    box.appendChild(meterRow('Tokenless tenure', formatAge(row.age_days) + (bd.age_assumed ? ' (date unreported, assumed)' : ''), (bd.tenure_multiplier - 0.75) / 0.5, '×' + bd.tenure_multiplier.toFixed(2), true));
    box.appendChild(meterRow('Reach', row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' of distribution', (bd.reach_multiplier - 1) / 0.4, '×' + bd.reach_multiplier.toFixed(2), false));
    app.appendChild(box);

    var plan = el('section', 'farm-plan');
    plan.appendChild(el('h2', 'section-title', 'The farm plan'));
    var list = el('ol');
    row.farm_steps.forEach(function (step) { list.appendChild(el('li', null, step)); });
    plan.appendChild(list);
    app.appendChild(plan);
  }

  /* Methodology ---------------------------------------------------------------- */

  function renderMethod() {
    app.textContent = '';
    app.appendChild(link('#/board', 'back-link', '← back to the board'));
    var box = el('section', 'method');
    box.innerHTML =
      '<h2>The accrued launch value model</h2>' +
      '<p>Every protocol in the snapshot that records no token — no market cap, no CoinGecko id, no symbol — ' +
      'is a launch that has not happened. The board ranks those protocols by one stated formula, computed by the ' +
      'program from the snapshot’s own figures. Nothing is ranked by hand and no name is special-cased: run the same ' +
      'program on a fresh snapshot and the board re-derives itself.</p>' +
      '<p class="formula">implied value = TVL × category multiple × momentum × tokenless tenure × reach</p>' +
      '<h2>The four factors</h2>' +
      '<ul>' +
      '<li><strong>Category multiple.</strong> What a launched token in the protocol’s category has typically been worth against the TVL behind it. A chain’s own token carries the richest multiple; a canonical bridge, which is infrastructure a chain runs, the thinnest.</li>' +
      '<li><strong>Momentum.</strong> The seven-day TVL change, clamped to −50%…+100% and weighted at 0.6, so a doubling week lifts value by 60% and a halving week cuts it by 30%. Unreported change counts as flat.</li>' +
      '<li><strong>Tokenless tenure.</strong> How long the protocol has run at scale with no token, from the day DefiLlama began tracking it to the snapshot’s day. The credit rises from ×0.75 to ×1.25 over four years: value and users accrue to a launch the longer it is waited for. An unreported date is assumed at eighteen months and flagged on the protocol’s page.</li>' +
      '<li><strong>Reach.</strong> Each chain past the first adds 4%, up to ten extra chains: a launch is worth more with distribution already built.</li>' +
      '</ul>' +
      '<h2>Coverage</h2>' +
      '<p>The board covers every protocol on the snapshot’s watchlist — and goes well past it. The watchlist is a floor of ' +
      'large, tokenless protocols; the radar’s work is the long tail below it, ranked by the same formula. Set aside, and never ' +
      'ranked: centralised exchanges, versioned pools of a parent protocol, and wrapped or staked forms of an asset that already ' +
      'trades — none of them can launch a first token of their own. One more line, drawn where the watchlist draws its own: at or ' +
      'above the watchlist’s $50M floor, a protocol in a product category — a bridge, a liquid staking pool, a restaked asset, a ' +
      'stablecoin wrapper — is a form of an asset that already trades (WBTC is Bitcoin on Ethereum, not a launch), so it is set ' +
      'aside at that size; below the floor those categories are ranked, because no traded parent is established there and ' +
      'surfacing them early is the radar’s job. Protocols whose token already trades are shown apart, at the market’s own ' +
      'market cap, never at a model value.</p>' +
      '<h2>The signal score</h2>' +
      '<p>A 0–100 heat score, separate from size: the protocol’s percentile on seven-day momentum (45%), tokenless tenure (30%) ' +
      'and chain reach (25%) among every ranked protocol. It answers “what is moving”, where the rank answers “what is biggest”.</p>' +
      '<h2>Farm plans</h2>' +
      '<p>Each plan is generated from the protocol’s own record: its category picks the playbook (supply and borrow for lending, ' +
      'liquidity for a DEX, stake for staking, crossings for a bridge), its first chain picks the funding route and fees, its TVL ' +
      'band picks the position size, its tokenless age picks the campaign’s length, and its chain count decides whether the plan ' +
      'works a second chain. Every step states what it costs and how long it takes. The wording varies from protocol to protocol — ' +
      'the opening, the second action and the weekly rhythm are picked per protocol — so the plans do not read as one template ' +
      'filled in hundreds of times, and a watchlist protocol, or one above $250M of TVL, carries an extra mid-campaign review step.</p>';
    var title = el('h2', null, 'Category multiples');
    box.appendChild(title);
    var table = el('table');
    var hr = el('tr');
    hr.appendChild(el('th', null, 'Category'));
    hr.appendChild(el('th', null, 'Multiple'));
    table.appendChild(hr);
    Object.keys(DATA.model.category_multiples).sort(function (a, b) {
      return DATA.model.category_multiples[b] - DATA.model.category_multiples[a];
    }).forEach(function (cat) {
      var tr = el('tr');
      tr.appendChild(el('td', null, cat));
      tr.appendChild(el('td', 'num', '×' + DATA.model.category_multiples[cat]));
      table.appendChild(tr);
    });
    var def = el('tr');
    def.appendChild(el('td', null, 'Any other category'));
    def.appendChild(el('td', 'num', '×' + DATA.model.default_category_multiple));
    table.appendChild(def);
    box.appendChild(table);
    box.appendChild(el('p', null,
      'Data: ' + DATA.source + '. The board is the program’s reading of that one snapshot, as of ' + DATA.as_of + '.'));
    app.appendChild(box);
  }

  /* Boot ------------------------------------------------------------------------ */

  function renderApp() {
    var route = parseHash();
    document.getElementById('snapshot-line').textContent =
      'Snapshot ' + DATA.as_of + ' · model ' + DATA.model_version + ' · ' + DATA.counts.ranked + ' ranked · every watchlist protocol covered';
    app.setAttribute('aria-busy', 'false');
    if (route.path.indexOf('/protocol/') === 0) {
      renderProtocol(decodeURIComponent(route.path.slice('/protocol/'.length)));
      return;
    }
    if (route.path === '/method') {
      renderMethod();
      return;
    }
    if (route.path === '/movers') {
      renderMovers();
      return;
    }
    var state = {
      q: route.params.get('q') || '',
      chain: route.params.get('chain') || '',
      cat: route.params.get('cat') || '',
      tab: route.params.get('tab') || 'board',
      sort: route.params.get('sort') || 'implied',
    };
    renderBoard(state);
  }

  if (!DATA) {
    app.appendChild(el('p', 'empty-note', 'The radar data did not load: radar-data.js must sit beside the dashboard folder.'));
    return;
  }

  var topnav = el('div', 'topnav');
  topnav.appendChild(link('#/movers', 'back-link', 'Top movers →'));
  topnav.appendChild(link('#/method', 'back-link', 'How the ranking works →'));
  document.body.insertBefore(topnav, app);

  window.addEventListener('hashchange', renderApp);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      var search = document.querySelector('input[type="search"]');
      if (search) { ev.preventDefault(); search.focus(); }
    }
  });
  renderApp();
})();
