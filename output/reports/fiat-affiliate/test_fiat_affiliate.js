// Renders the built page in jsdom and reads it back. The assertions here are
// the decisions someone might undo by accident, not arithmetic for its own sake:
// that distinct players are unioned rather than summed, that the success rate is
// weighted rather than the mean of the monthly rates, that the breakdown tables
// ignore their own filter, that the page opens unfiltered on deposits, and that
// the chart and the drill actually draw something.
//
//   npm install jsdom && node test_fiat_affiliate.js
//
// PAGE env var overrides which built file is read, so the same test can be run
// against a staged copy elsewhere.

const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const PAGE = process.env.PAGE || path.join(__dirname, '..', 'fiat-affiliate.html');
const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), { runScripts: 'dangerously' });
const w = dom.window, doc = w.document;
let fail = 0;
const ok = (nm, c, x) => {
  if (c) console.log('  PASS ' + nm);
  else { console.log('  FAIL ' + nm + (x !== undefined ? '  -> ' + x : '')); fail++; }
};

ok('script ran and exported a handle', !!w.OV);
const D = w.OV.D, S = w.OV.state, C = w.OV.C;
const num = s => Number(String(s).replace(/[^0-9.-]/g, ''));

// --- defaults: the page must open on the question it exists to answer ------
ok('opens on deposits', S.kind === 0, S.kind);
ok('opens on the full span', S.from === 0 && S.to === D.days.length - 1, S.from + '..' + S.to);
ok('opens unfiltered by country', S.country === -1, S.country);
ok('opens unfiltered by method', S.method === -1, S.method);
ok('markup agrees with state (deposits pressed)',
  doc.querySelector('#kind button[data-k="0"]').getAttribute('aria-pressed') === 'true');
ok('markup agrees with state (All pressed)',
  doc.querySelector('#preset button[data-p="all"]').getAttribute('aria-pressed') === 'true');
ok('country dropdown agrees with state', doc.getElementById('country').value === '-1');
ok('method dropdown agrees with state', doc.getElementById('method').value === '-1');
ok('no filter chips on load', doc.querySelectorAll('#chips .chip').length === 0);

// --- the tables render, and each total row is the sum of its rows ---------
function checkTable(id, label) {
  const rows = [...doc.querySelectorAll('#' + id + ' tbody tr')].filter(r => !r.classList.contains('tot'));
  const tot = doc.querySelector('#' + id + ' tbody tr.tot');
  ok(label + ' has rows', rows.length > 0, rows.length);
  ok(label + ' has a totals row', !!tot);
  if (!rows.length || !tot) return null;
  const cells = tot.children.length;
  // the figure block is always the last 8 columns
  const att = cells - 8, cre = cells - 7, fai = cells - 6;
  const sa = rows.reduce((a, r) => a + num(r.children[att].textContent), 0);
  const sc = rows.reduce((a, r) => a + num(r.children[cre].textContent), 0);
  ok(label + ' total attempted = sum of rows', sa === num(tot.children[att].textContent),
    sa + ' vs ' + num(tot.children[att].textContent));
  ok(label + ' total created = sum of rows', sc === num(tot.children[cre].textContent));
  let arith = true;
  rows.forEach(r => {
    if (num(r.children[att].textContent) !== num(r.children[cre].textContent) + num(r.children[fai].textContent))
      arith = false;
  });
  ok(label + ': attempted = created + failed on every row', arith);
  return { rows, attempted: sa, created: sc };
}
const T_AFF = checkTable('tmain', 'affiliate table');
const T_CTY = checkTable('tctry', 'country table');
const T_MTH = checkTable('tmth', 'method table');

// every transaction has a country and a method, so all three tables cover the
// same set of transactions and must agree on the totals
ok('the three tables agree on attempted',
  T_AFF.attempted === T_CTY.attempted && T_AFF.attempted === T_MTH.attempted,
  [T_AFF.attempted, T_CTY.attempted, T_MTH.attempted].join(' / '));
ok('the three tables agree on created',
  T_AFF.created === T_CTY.created && T_AFF.created === T_MTH.created);

// --- distinct players are unioned, never summed ---------------------------
// A player active in several months, countries or methods is one player. If
// someone ever "fixes" the walker by adding up per-cell counts, the window
// figure jumps above the per-affiliate lifetime count and this fails.
const W = w.OV.byAffiliate();
let overLifetime = [];
W.rows.forEach(r => { if (r.npa > D.affs[r.i].np) overLifetime.push(D.affs[r.i].n + ' ' + r.npa + '>' + D.affs[r.i].np); });
ok('no affiliate shows more players than it has ever had', overLifetime.length === 0,
  overLifetime.slice(0, 3).join(', '));
ok('window players never exceed the whole player base', W.tot.npa <= D.nPlayers,
  W.tot.npa + ' > ' + D.nPlayers);

let naive = 0;
w.OV.walk((i, c) => { naive += c[C.ATT] && c[8].length; });
ok('the naive per-cell sum really is larger than the union', naive > W.tot.npa,
  naive + ' vs ' + W.tot.npa);

// country rows must NOT add up to the total, because one player pays from more
// than one country -- that gap is real and the page says so
const ctyPlayers = w.OV.byDim(C.CTRY, 'country').reduce((a, r) => a + r.npa, 0);
ok('country player counts exceed the distinct total (they overlap, as stated)',
  ctyPlayers > W.tot.npa, ctyPlayers + ' vs ' + W.tot.npa);

// --- the success rate is weighted, not the mean of the monthly rates ------
const M = w.OV.monthly();
const weighted = M.reduce((a, m) => a + m.s, 0) / M.reduce((a, m) => a + m.a, 0);
const meanOfRates = M.reduce((a, m) => a + (m.a ? m.s / m.a : 0), 0) / M.length;
ok('weighted rate differs from the mean of monthly rates (so a mean cannot creep in)',
  Math.abs(weighted - meanOfRates) > 1e-6,
  weighted.toFixed(4) + ' vs ' + meanOfRates.toFixed(4));
ok('headline rate matches the weighted rate',
  Math.round(100 * W.tot.s / W.tot.a) === Math.round(100 * weighted));

// --- the chart drew something, with a labelled zero -----------------------
ok('chart svg exists', !!doc.querySelector('.chartbox svg'));
const bars = [...doc.querySelectorAll('.chartbox rect')];
ok('chart has bars', bars.length >= M.length * 2, bars.length);
ok('chart has a rate line', !!doc.querySelector('.chartbox path.rate'));
const texts = [...doc.querySelectorAll('.chartbox text')].map(t => t.textContent);
ok('the value axis labels its zero', texts.includes('0'));
ok('the rate axis labels 0% and 100%', texts.includes('0%') && texts.includes('100%'));
let stacked = true;
for (let i = 0; i < M.length; i++) {
  const created = bars[2 * i], failed = bars[2 * i + 1];
  if (!created || !failed) { stacked = false; break; }
  if (Number(failed.getAttribute('y')) > Number(created.getAttribute('y'))) stacked = false;
}
ok('failures stack above created, not underneath', stacked);

// --- KPIs -----------------------------------------------------------------
const kpis = [...doc.querySelectorAll('#kpis .kpi .v')].map(e => e.textContent);
ok('seven KPI tiles rendered', kpis.length === 7, kpis.length);
ok('KPI attempted matches the table total', num(kpis[0]) === T_AFF.attempted,
  kpis[0] + ' vs ' + T_AFF.attempted);

// --- the country switcher actually narrows the page ----------------------
const allAtt = W.tot.a;
const de = D.countries.indexOf('DE');
S.country = de; w.OV.syncDims(); w.OV.render();
const deW = w.OV.byAffiliate();
ok('picking a country narrows the page', deW.tot.a > 0 && deW.tot.a < allAtt,
  deW.tot.a + ' vs ' + allAtt);
ok('a filter chip appears', doc.querySelectorAll('#chips .chip').length === 1);
// the country table must still list every country -- it ignores its own filter
const ctyRowsFiltered = [...doc.querySelectorAll('#tctry tbody tr[data-k]')].length;
ok('the country table still lists every country while one is selected',
  ctyRowsFiltered === D.countries.length, ctyRowsFiltered + ' of ' + D.countries.length);
ok('the selected country row is marked', !!doc.querySelector('#tctry tbody tr[data-k="' + de + '"].sel'));
// but the method table must respect the country filter
const mthAttFiltered = [...doc.querySelectorAll('#tmth tbody tr[data-k]')]
  .reduce((a, r) => a + num(r.children[r.children.length - 8].textContent), 0);
ok('the method table respects the country filter', mthAttFiltered === deW.tot.a,
  mthAttFiltered + ' vs ' + deW.tot.a);

// --- the method switcher stacks with it ----------------------------------
const visa = D.methods.indexOf('VISA');
S.method = visa; w.OV.syncDims(); w.OV.render();
const bothW = w.OV.byAffiliate();
ok('the two filters combine', bothW.tot.a > 0 && bothW.tot.a < deW.tot.a,
  bothW.tot.a + ' vs ' + deW.tot.a);
ok('two filter chips appear', doc.querySelectorAll('#chips .chip').length === 2);
ok('the method table still lists every method while one is selected',
  [...doc.querySelectorAll('#tmth tbody tr[data-k]')].length === D.methods.length);

// clearing both puts it back exactly where it started
doc.querySelector('#chips button[data-clear="all"]').click();
ok('clear both restores the unfiltered window', w.OV.byAffiliate().tot.a === allAtt,
  w.OV.byAffiliate().tot.a + ' vs ' + allAtt);
ok('clearing removes the chips', doc.querySelectorAll('#chips .chip').length === 0);

// --- switching to withdrawals really changes the page ---------------------
S.kind = 1; w.OV.render();
const wdAtt = w.OV.byAffiliate().tot.a;
ok('withdrawals give a different, non-empty window', wdAtt > 0 && wdAtt !== allAtt,
  allAtt + ' vs ' + wdAtt);
ok('withdrawals are the smaller book', wdAtt < allAtt);
S.kind = 0; w.OV.render();

// --- a narrower window is a subset ---------------------------------------
w.OV.setPreset('30'); w.OV.render();
const short = w.OV.byAffiliate().tot;
ok('30-day window is smaller than all time', short.a < allAtt, short.a + ' vs ' + allAtt);
ok('30-day window is not empty', short.a > 0);
w.OV.setPreset('all'); w.OV.render();

// --- the drill panel actually becomes visible ----------------------------
// #drill{display:none} lives in the stylesheet, so clearing the inline style
// is not enough to show it -- it has to be set to block explicitly. This is
// the assertion that catches that regression.
const drill = doc.getElementById('drill');
ok('drill starts hidden', w.getComputedStyle(drill).display === 'none');
doc.querySelectorAll('#tmain tbody tr[data-i]')[1].click();
ok('drill is visible after clicking a row',
  w.getComputedStyle(drill).display !== 'none', w.getComputedStyle(drill).display);
ok('drill names the affiliate that was clicked',
  doc.getElementById('dname').textContent.length > 0, doc.getElementById('dname').textContent);
ok('drill has monthly rows', doc.querySelectorAll('#tmon tbody tr').length > 0);
ok('drill lists decline reasons', doc.querySelectorAll('#treason tbody tr').length > 0);
doc.getElementById('dclose').click();
ok('close hides it again', w.getComputedStyle(drill).display === 'none');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
