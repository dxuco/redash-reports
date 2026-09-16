/* Renders the built ../streamers.html in jsdom and reads it back, then
   recomputes the headline figures straight from the query-1732 month caches
   with a second, independent implementation.
 *
 *   npm install jsdom
 *   node test_streamers.js
 *
 * The assertions here are the decisions someone might undo — that the cohort is
 * FTD-in-2026 rather than active-in-2026, that a negative bar falls BELOW the
 * zero rule instead of being clamped, that the sign goes before the currency
 * symbol, that adjusted GGR is never derived as GGR minus bonus cost. */

const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'streamers.html'), 'utf8');

let fails = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
};
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmt = n => Math.round(n).toLocaleString('en-US');

const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
dom.virtualConsole.on('jsdomError', e => errors.push(e.message));
const d = dom.window.document;
const OV = dom.window.OV;

console.log('\nthe page runs');
ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));
ok(!!OV, 'window.OV handed over — const is script-scoped and never reaches window');
ok(!html.includes('__DATA__'), 'the __DATA__ token was replaced by the maker script');

const DATA = OV.DATA;
const ms = DATA.months;

console.log('\nthe cohort');
ok(DATA.year === '2026', 'year is 2026: ' + DATA.year);
/* Follow the calendar rather than pinning a count: this said "eight months"
   and went red the morning September arrived, which is a true statement about
   the date and a false one about the report. The rule is that the year runs
   from January, contiguously, to the newest month the cache has. */
const contiguous = ms.every((m, i) => {
  if (i === 0) return m === DATA.year + '-01';
  const [py, pm] = ms[i - 1].split('-').map(Number);
  const nxt = pm === 12 ? (py + 1) + '-01' : py + '-' + String(pm + 1).padStart(2, '0');
  return m === nxt;
});
ok(ms.length >= 1 && contiguous,
   ms.length + ' month(s) from ' + DATA.year + '-01, contiguous: ' + ms.join(' '));
ok(DATA.cohortPlayers > 2000, DATA.cohortPlayers + ' players in the cohort');

/* --- independent recompute, straight from the caches --------------------- */
const CACHE = path.join(ROOT, 'ftd-report', 'cache');
const num = v => (v === null || v === undefined || v === '' || v === 'None') ? 0 : (+v || 0);
const cohort = new Map();               // pid -> [aff, ftd_type]
const monthRows = {};
ms.forEach(m => {
  monthRows[m] = JSON.parse(fs.readFileSync(path.join(CACHE, m + '.json'), 'utf8'));
  monthRows[m].forEach(r => {
    if (r.aff_type !== 'Streamer' || num(r.ftd) <= 0) return;
    if (cohort.has(r.player_id)) return;
    cohort.set(r.player_id, [r.aff_username || DATA.untagged, r.ftd_type || 'Non Qualified']);
  });
});
let dep = 0, adj = 0, ftdv = 0, sq = 0;
const affs = new Set(), byAff = new Map();
cohort.forEach(([a, t], pid) => {
  affs.add(a);
  if (t === 'Super Qualified') sq++;
  if (!byAff.has(a)) byAff.set(a, 0);
});
ms.forEach(m => monthRows[m].forEach(r => {
  const c = cohort.get(r.player_id);
  if (!c) return;
  dep += num(r.deposit); adj += num(r.adjusted_ggr);
  byAff.set(c[0], byAff.get(c[0]) + num(r.adjusted_ggr));
  if (num(r.ftd) > 0 && r.aff_type === 'Streamer') ftdv += num(r.ftd);
}));

const T = DATA.variants.all.totals;
console.log('\nthe arithmetic, recomputed from the caches');
ok(T.streamers === affs.size, 'streamers tested: page ' + T.streamers + ', recomputed ' + affs.size);
ok(T.ftd === cohort.size, 'FTDs: page ' + T.ftd + ', recomputed ' + cohort.size);
ok(T.sq === sq, 'Super Qualified FTDs: page ' + T.sq + ', recomputed ' + sq);
/* budget = one rounded value per streamer, per the rounding rule */
const budget = (T.streamers + ms.length) * 0.005;
ok(Math.abs(T.dep - dep) <= budget,
   'deposits: page ' + money(T.dep) + ', recomputed ' + money(dep));
ok(Math.abs(T.adj - adj) <= budget,
   'adjusted GGR: page ' + money(T.adj) + ', recomputed ' + money(adj));
ok(Math.abs(T.ftdv - ftdv) <= budget,
   'first-deposit value: page ' + money(T.ftdv) + ', recomputed ' + money(ftdv));

let nPos = 0, nNeg = 0, sPos = 0, sNeg = 0;
byAff.forEach(v => { if (v > 0) { nPos++; sPos += v; } else if (v < 0) { nNeg++; sNeg += v; } });
ok(T.nPos === nPos && T.nNeg === nNeg,
   'positive/negative split: page ' + T.nPos + '/' + T.nNeg + ', recomputed ' + nPos + '/' + nNeg);
ok(Math.abs(T.adjPos - sPos) <= budget && Math.abs(T.adjNeg - sNeg) <= budget,
   'and their totals: ' + money(T.adjPos) + ' / ' + money(T.adjNeg));
ok(T.nPos + T.nNeg + T.nZero === T.streamers,
   'every streamer lands in exactly one of profit / loss / flat');

console.log('\nthe cohort is FTD-in-2026, not active-in-2026');
/* A player who first deposited in 2025 through a streamer and merely PLAYED in
   2026 must not be here. If this ever flips, deposits jump by an order of
   magnitude and nothing else on the page complains. */
let strays = 0;
ms.forEach(m => monthRows[m].forEach(r => {
  if (!cohort.has(r.player_id)) return;
  const fd = (r.first_deposit_date || '').slice(0, 4);
  if (fd && fd !== '2026') strays++;
}));
ok(strays === 0, strays + ' cohort rows carry a pre-2026 first_deposit_date');
/* Read the list rather than naming one id: the builder asserts the same thing
   and would already have refused to write the page, but a test that pins the
   id goes green for the wrong reason the day a second player is carved out. */
const CARVED_IDS = Object.keys(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-exclusions.json'), 'utf8'))
    .carve_out.reduce((m, p) => (m[String(p.player_id)] = 1, m), {}));
const inCohort = CARVED_IDS.filter(id => cohort.has(id));
ok(inCohort.length === 0,
   'no carved-out player (' + CARVED_IDS.join(', ') + ') is in the cohort — ' +
   'which is why this page has no carve-out toggle');

console.log('\nadjusted GGR is not derived');
/* adjusted_ggr and ngr are computed upstream over different scopes. Asserting
   they differ stops anyone "fixing" the builder by subtracting bonus cost. */
ok(Math.abs(T.adj - (T.ngr)) > 1,
   'adjusted GGR ' + money(T.adj) + ' differs from NGR ' + money(T.ngr));
ok(Math.abs(T.adj - (T.ngr - T.bonus)) > 1 || T.bonus === 0,
   'and is not NGR minus bonus cost (' + money(T.ngr - T.bonus) + ')');

console.log('\nthe variants are separate cohorts, not filters on one');
const Q = DATA.variants.q.totals, SQ = DATA.variants.sq.totals;
ok(SQ.ftd === SQ.sq && SQ.ftd === T.sq,
   'Super Qualified variant holds exactly the ' + T.sq + ' SQ players');
ok(Q.ftd === T.q + T.sq, 'Qualified+ variant holds ' + Q.ftd + ' = ' + T.q + ' + ' + T.sq);
ok(SQ.streamers < Q.streamers && Q.streamers <= T.streamers,
   'streamer counts narrow with the cohort: ' + T.streamers + ' / ' + Q.streamers +
   ' / ' + SQ.streamers);
ok(SQ.dep !== T.dep, 'and the money is recomputed with them, not carried over');

console.log('\nthe charts render');
const cFtd = d.getElementById('chartFtd'), cAdj = d.getElementById('chartAdj');
ok(cFtd.querySelectorAll('rect[fill^="#"]').length > 8, 'FTD chart drew bars');
ok(cAdj.querySelectorAll('rect[fill^="#"]').length > 8, 'money chart drew bars');
ok(cFtd.querySelectorAll('.hit').length === ms.length,
   'one hover band per month on the FTD chart (' + ms.length + ')');
ok(cFtd.querySelectorAll('polyline.depline').length === 1, 'the deposits overlay line is drawn');
ok(d.getElementById('legFtd').querySelectorAll('.lg').length >= 4,
   'FTD legend populated with the three tiers plus the line');
ok(d.getElementById('legAdj').querySelectorAll('.lg').length === 2,
   'money legend has the profit and loss bands');

console.log('\nhouse rules');
/* Every axis labels its own zero — a zero rule drawn with no number beside it
   put every figure on the wrong side of the line in an earlier report. */
const zeroRule = [...cAdj.querySelectorAll('line')].filter(l => l.getAttribute('stroke') === '#5B7285');
ok(zeroRule.length === 1, 'exactly one darkened zero rule on the money chart');
const axisTexts = [...cAdj.querySelectorAll('text')].map(t => t.textContent);
ok(axisTexts.includes('$0'), 'the money axis labels its zero: ' +
   axisTexts.filter(t => /^-?\$/.test(t)).slice(0, 6).join(' '));

/* Negative bars fall BELOW the zero rule, never clamped and never piled in with
   the positives. */
const zeroY = +zeroRule[0].getAttribute('y1');
const negBars = [...cAdj.querySelectorAll('rect[fill="#C0392B"]')];
ok(negBars.length > 0, negBars.length + ' loss bars drawn');
ok(negBars.every(r => +r.getAttribute('y') >= zeroY - 0.5),
   'every loss bar starts at or below the zero rule (y=' + zeroY.toFixed(1) + ')');
/* A band is coloured by the streamer's WHOLE-year result, so a profit band can
   still hold a losing month and be drawn below the rule. What must never
   happen is a single bar straddling zero — that would mean a signed value was
   stacked from the wrong base. */
const allBars = [...cAdj.querySelectorAll('rect[fill^="#"]')];
ok(allBars.every(r => {
     const y = +r.getAttribute('y'), h = +r.getAttribute('height');
     return y >= zeroY - 0.5 || y + h <= zeroY + 0.5;
   }), 'no bar straddles the zero rule — each one stacks from the right base');
ok(allBars.some(r => +r.getAttribute('y') + +r.getAttribute('height') <= zeroY + 0.5),
   'and profit bars are drawn above it');

/* The sign goes before the currency symbol. */
ok(OV.money(-5000) === '-$5,000', 'money(-5000) is -$5,000, not $-5,000');
ok(OV.moneyShort(-42000) === '-$42k', 'moneyShort(-42000) is -$42k');
/* Checked on rendered text, not on the source — the source carries a comment
   that spells out the wrong form in order to forbid it. */
const visible = [...d.querySelectorAll('.card, .cover')].map(n => n.textContent).join(' ');
ok(!visible.includes('$-'), 'no $- in any rendered figure on the page');

/* Percentages are whole numbers, with <1% rather than 0% for a real value. */
ok(OV.pctW(0.4) === '<1%', 'pctW(0.4) is <1%, not 0%');
ok(OV.pctW(12.6) === '13%', 'pctW(12.6) is 13%');
ok(OV.pctW(null) === '—', 'pctW(null) is an em-dash, not NaN%');

console.log('\ndefaults, in state AND in the markup');
/* A default set in only one place renders buttons that lie on load. */
ok(OV.state.variant === 'all', 'state opens on the full cohort');
ok(d.querySelector('[data-var="all"]').getAttribute('aria-pressed') === 'true',
   'and the All FTDs button is the pressed one');
ok(OV.state.money === 'adj', 'state opens on adjusted GGR');
ok(d.querySelector('[data-money="adj"]').getAttribute('aria-pressed') === 'true',
   'and the Adjusted GGR button is the pressed one');
ok(d.querySelector('#tbl th[data-s="mny"]').getAttribute('aria-sort') === 'descending',
   'the table opens sorted by the money column, descending');

console.log('\nthe table');
const bodyRows = () => d.querySelectorAll('#tbl tbody tr');
ok(bodyRows().length === T.streamers,
   'a row per streamer: ' + bodyRows().length + ' of ' + T.streamers);
/* Found by data-c, never by column index — five columns were inserted to the
   left of it once already, and an index silently started reading SQ share. */
const mnyCell = tr => tr.querySelector('td[data-c="mny"]').textContent;
const firstCell = mnyCell(bodyRows()[0]);
ok(firstCell.startsWith('$'), 'sorted descending, so the top row is a profit: ' + firstCell);
ok(mnyCell(d.querySelector('#tbl tbody tr:last-child')).startsWith('-$'),
   'and the bottom row is the worst loss');

/* The result chips are filters, not a re-sort — the count has to fall. */
d.querySelector('[data-res="neg"]').dispatchEvent(new dom.window.Event('click'));
ok(bodyRows().length === T.nNeg, 'the loss chip shows exactly ' + T.nNeg + ' streamers');
ok([...bodyRows()].every(r => mnyCell(r).startsWith('-$')),
   'and every one of them is negative');
/* The totals row follows the filter. A fixed total under a filtered table
   reads as a bug, and is the thing most likely to be broken by a later edit. */
const foot = () => d.querySelector('#tbl tfoot tr');
ok(foot().cells[0].textContent === T.nNeg + ' streamers',
   'the totals row counts the filtered rows: ' + foot().cells[0].textContent);
/* Displayed shortened, exact on the tooltip — so the assertion reads the title,
   which is the number people actually copy out. */
ok(foot().querySelector('td[data-c="mny"]').title === money(T.adjNeg),
   'and its money total is the filtered total: ' +
   foot().querySelector('td[data-c="mny"]').title);
d.querySelector('[data-res="all"]').dispatchEvent(new dom.window.Event('click'));
ok(bodyRows().length === T.streamers, 'All puts every streamer back');

console.log('\nretention, on the Retention report’s definition');
/* Recomputed independently: retained by day N = a deposit on day 1..N after
   first_deposit_date; eligible = observed at least N days. */
const fdd = new Map(), depDays = new Map();
ms.forEach(m => monthRows[m].forEach(r => {
  if (!cohort.has(r.player_id)) return;
  if (r.first_deposit_date) fdd.set(r.player_id, r.first_deposit_date.slice(0, 10));
  if (r.deposit) {
    if (!depDays.has(r.player_id)) depDays.set(r.player_id, new Set());
    depDays.get(r.player_id).add((r.transaction_date || '').slice(0, 10));
  }
}));
const asDay = s => Date.UTC(+s.slice(0,4), +s.slice(5,7) - 1, +s.slice(8,10)) / 86400000;
const cut = asDay(DATA.cutoff);
const R = { 7: [0, 0], 30: [0, 0] };
fdd.forEach((f, pid) => {
  const f0 = asDay(f), obs = cut - f0;
  if (obs < 0) return;
  const lags = [...(depDays.get(pid) || [])].map(x => asDay(x) - f0).filter(g => g >= 1);
  const back = lags.length ? Math.min(...lags) : null;
  for (const n of [7, 30]) {
    if (obs < n) continue;
    R[n][1]++;
    if (back !== null && back <= n) R[n][0]++;
  }
});
ok(T.r7 === R[7][0] && T.r7n === R[7][1],
   'D7: page ' + T.r7 + '/' + T.r7n + ', recomputed ' + R[7][0] + '/' + R[7][1] +
   ' (' + Math.round(T.r7 / T.r7n * 100) + '%)');
ok(T.r30 === R[30][0] && T.r30n === R[30][1],
   'D30: page ' + T.r30 + '/' + T.r30n + ', recomputed ' + R[30][0] + '/' + R[30][1] +
   ' (' + Math.round(T.r30 / T.r30n * 100) + '%)');
ok(T.r7n > T.r30n,
   'fewer players are eligible at D30 than D7 — the observation window is enforced');
/* Cumulative return rises with N — but ONLY on a fixed population. The two
   published counts are over different denominators (D30 drops everyone observed
   7 to 29 days, some of whom did return by day 7), so D7 > D30 in the raw
   counts is correct, not a bug. Checked on the D30-eligible population instead,
   where the monotonicity is real. */
let m7 = 0, m30 = 0;
fdd.forEach((f, pid) => {
  const f0 = asDay(f);
  if (cut - f0 < 30) return;
  const lags = [...(depDays.get(pid) || [])].map(x => asDay(x) - f0).filter(g => g >= 1);
  const back = lags.length ? Math.min(...lags) : null;
  if (back !== null && back <= 7) m7++;
  if (back !== null && back <= 30) m30++;
});
ok(m7 <= m30,
   'on the D30-eligible population, return by day 7 (' + m7 + ') <= by day 30 (' + m30 + ')');
/* This used to assert T.r7 > T.r30, which is not an invariant — it holds only
   while the 7-to-29-day band is thick enough, and it flipped (507 vs 553) the
   month that band thinned. What is actually true, and is the point, is that
   the published D7 sits on a different population from the fixed-population
   D7 above, so the two published counts cannot be compared with each other. */
ok(m7 !== T.r7,
   'and the published D7 (' + T.r7 + ') is a different population from the ' +
   'D30-eligible D7 (' + m7 + ') — which is why the published counts are not ' +
   'comparable in either direction');
/* A rate is never the mean of the streamers' rates — a streamer with 4 eligible
   players would weigh the same as one with 400. */
const all = DATA.variants.all.streamers.filter(s => s.r7n >= DATA.minEligible);
const meanOfRates = all.reduce((s, x) => s + x.r7 / x.r7n, 0) / all.length * 100;
const weighted = T.r7 / T.r7n * 100;
ok(Math.abs(meanOfRates - weighted) > 0.5,
   'the weighted D7 rate (' + weighted.toFixed(1) + '%) differs from the mean of the ' +
   'streamers\' rates (' + meanOfRates.toFixed(1) + '%) — so a mean cannot creep in unnoticed');

console.log('\npositive GGR / negative NGR, split at the player');
const pm = new Map();
ms.forEach(m => monthRows[m].forEach(r => {
  if (!cohort.has(r.player_id)) return;
  const p = pm.get(r.player_id) || [0, 0];
  p[0] += num(r.ggr); p[1] += num(r.ngr);
  pm.set(r.player_id, p);
}));
let gp = 0, nn = 0, nW = 0, nL = 0;
pm.forEach(([g, n]) => {
  if (g > 0) { gp += g; nW++; }
  if (n < 0) { nn += n; nL++; }
});
ok(Math.abs(T.ggrPos - gp) <= budget,
   'positive GGR: page ' + money(T.ggrPos) + ', recomputed ' + money(gp) +
   ' from ' + nW + ' players');
ok(Math.abs(T.ngrNeg - nn) <= budget,
   'negative NGR: page ' + money(T.ngrNeg) + ', recomputed ' + money(nn) +
   ' from ' + nL + ' players');
ok(T.nWin === nW && T.nLose === nL, 'and the player counts match');
/* The two groups overlap — bonus cost puts some GGR-positive players into
   negative NGR — so they are not a partition and the page must not imply one. */
ok(T.nWin + T.nLose > T.ftd,
   'winners + losers (' + (T.nWin + T.nLose) + ') exceeds the ' + T.ftd +
   ' FTDs: the two groups overlap and are not a partition');
ok(d.getElementById('tblCap').textContent.includes('overlap'),
   'and the caption says so, so nobody reads them as complementary');

console.log('\ninvestment, joined from the CPA deal sheet');
ok(!!DATA.costFile, 'a cost file was found: ' + (DATA.costNote || 'none'));
ok(T.inv > 0, 'total invested ' + money(T.inv) + ' across ' + T.nInv + ' of ' +
   T.streamers + ' streamers');
/* A streamer with no deal on file is null, never 0 — "$0 spent" and "we have no
   record" are different facts, and folding the second into the first would
   understate every cost-per-FTD figure on the page. */
const noDeal = DATA.variants.all.streamers.filter(s => s.inv === null);
ok(noDeal.length > 0 && noDeal.every(s => s.inv === null),
   noDeal.length + ' streamers have no deal on file and carry null, not 0');
ok(T.nInv + noDeal.length === T.streamers, 'and those two account for every streamer');
ok(T.invFtd < T.ftd,
   'cost per FTD divides by the ' + fmt(T.invFtd) + ' FTDs from streamers with a deal, ' +
   'not all ' + fmt(T.ftd) + ' — otherwise the ones with no cost row discount the CPA');
const cpfAll = T.inv / T.ftd, cpfReal = T.inv / T.invFtd;
ok(cpfReal > cpfAll,
   'which matters: ' + money(cpfReal) + ' per FTD, not ' + money(cpfAll));
/* The em-dash must reach the rendered cell, not just the data. */
const dashRows = [...bodyRows()].filter(r => r.cells[5].textContent.trim() === '—');
ok(dashRows.length === noDeal.length,
   dashRows.length + ' rows render an em-dash in the Invested column');
/* The investment is real money against a programme that is already negative. */
ok(T.adj - T.inv < T.adj,
   'net of cost: ' + money(T.adj) + ' adjusted GGR less ' + money(T.inv) +
   ' invested = ' + money(T.adj - T.inv));

console.log('\nswitching cohort rebuilds every figure, not just the table');
const depBefore = d.getElementById('head').textContent;
d.querySelector('[data-var="sq"]').dispatchEvent(new dom.window.Event('click'));
const depAfter = d.getElementById('head').textContent;
ok(depBefore !== depAfter, 'the headline strip changed with the cohort');
ok(bodyRows().length === SQ.streamers,
   'the table now holds the ' + SQ.streamers + ' streamers with a Super Qualified FTD');
ok(d.getElementById('head').textContent.includes(String(SQ.ftd)),
   'and the headline FTD count is the Super Qualified one (' + SQ.ftd + ')');
d.querySelector('[data-var="all"]').dispatchEvent(new dom.window.Event('click'));

console.log('\nisolate on click, not hide on click');
/* People click a thing because they want to look at it. */
const legFtd = d.getElementById('legFtd');
legFtd.querySelector('[data-cat="Super Qualified"]').dispatchEvent(new dom.window.Event('click'));
ok(OV.state.off.ftd.size > 0 && !OV.state.off.ftd.has('Super Qualified'),
   'clicking a tier isolated it rather than hiding it');
ok(!!d.getElementById('legFtd').querySelector('.showall'),
   'and a Show all chip appeared while something is hidden');
d.getElementById('legFtd').querySelector('[data-cat="__all"]')
  .dispatchEvent(new dom.window.Event('click'));
ok(OV.state.off.ftd.size === 0, 'Show all brings every tier back');

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
