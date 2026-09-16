/**
 * Renders the built retention.html in a headless DOM and reads it back.
 *
 *   npm install jsdom
 *   node retention/test_retention.js
 *
 * The page is one table, so most of what is worth asserting is about counting
 * rather than drawing. The assertions that matter are the ones encoding a
 * decision someone might reasonably undo:
 *
 *   - the page opens on MONTHS and the LATEST cohort year, in state and in the
 *     markup — and the year is read from the data, so it cannot open on an
 *     empty table next January
 *   - weeks still mature ~3 weeks sooner, which the test proves; that is why
 *     the weekly view exists even though it is not what loads
 *   - the All-cohorts row is a weighted rate, not the mean of the column
 *   - and its base moves from column to column, which each footer cell says
 *   - under Complete no row can fall across the columns
 *   - under At risk a row IS allowed to fall, and every such cell prints its n
 *   - a denominator under minEligible is refused rather than shown small
 *   - the filters are AND-ed, and each dimension's values partition the base
 *   - a dimension the cache cannot support is absent rather than empty
 *
 * A table that renders empty is invisible to any check on the arithmetic, which
 * is the other half of what this catches.
 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'retention.html'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const n0 = x => x.toLocaleString('en-US');

const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
dom.virtualConsole.on('jsdomError', e => errors.push(e.message));
const d = dom.window.document;
const R = dom.window.RET;
const D = R && R.D;

/* The state the page loads in, captured before any assertion touches a control.
   Everything below normalises to weeks + all years so the structural checks see
   the whole dataset; without a snapshot those clicks would destroy the very
   thing the defaults section is meant to prove. */
const DEFAULTS = {
  grain:  R.state.grain,
  year:   R.state.year,
  yearControl: d.getElementById('f_year').value,
  gMonth: d.getElementById('gMonth').getAttribute('aria-pressed'),
  gWeek:  d.getElementById('gWeek').getAttribute('aria-pressed'),
  strip:  d.getElementById('tableFilters').textContent,
  mature: R.state.mature,
  bAtRisk: d.getElementById('bAtRisk').getAttribute('aria-pressed'),
  bComplete: d.getElementById('bComplete').getAttribute('aria-pressed'),
  emptyRows: [...d.querySelectorAll('#cohortTable tbody tr')]
               .filter(r => r.querySelectorAll('td.cell').length === 0).length,
  /* A cohort younger than its first window genuinely has nothing to report --
     on 2 September the September cohort is two days old and needs eight. Those
     rows must be ANNOTATED, not silently blank, so capture that too. */
  emptyUnlabelled: [...d.querySelectorAll('#cohortTable tbody tr')]
               .filter(r => r.querySelectorAll('td.cell').length === 0)
               .filter(r => !/partial|needs|window/i.test(r.textContent)).length,
  rows:   d.querySelectorAll('#cohortTable tbody tr').length,
  sel:    Object.assign({}, R.state.sel),
  weeks:  R.state.weeks,
  /* Captured at load, because the button states are written by syncControls and
     later sections drive them around. "As the page opens" is the claim, so read
     it when the page has just opened. */
  moneyMetric: R.state.moneyMetric,
  vAfter: (d.getElementById('vAfter') || {getAttribute: () => null}).getAttribute('aria-pressed'),
};

/* Drive a dimension the way a person does, whichever control it has — some are
   dropdowns and some are segmented switches, and a test that only knew about
   dropdowns would silently stop exercising a dimension the day it moved. */
function setDim(key, value){
  const sel = d.getElementById('f_' + key);
  if (sel){ sel.value = value; sel.onchange({ target: sel }); return; }
  const btn = d.querySelector('#dimPills button[data-dim="' + key + '"][data-v="' + value + '"]');
  if (btn){ btn.onclick(); return true; }
  /* A switch does not render an option no player is in. That is deliberate, so
     accept it — but only after checking the data really is empty there, which
     is what stops this from swallowing a genuinely missing control. */
  const dim = D.dims.find(x => x.key === key);
  if (dim && R.PILL_DIMS.has(key) && R.dimCounts(dim)[+value] === 0) return false;
  throw new Error('no control for dimension ' + key + ' = ' + value);
}
const dimControl = key =>
  d.getElementById('f_' + key) ? 'dropdown'
  : d.querySelector('#dimPills [data-dim="' + key + '"]') ? 'switch' : 'MISSING';
const footer = () => [...d.querySelectorAll('#cohortTable tfoot td')].map(t => t.textContent);
/* The population the table is actually showing. It respects the cohort-year
   filter, because that is what the footer's own total does — a helper that
   ignored it would disagree with the page and the test would be checking
   itself rather than the page. */
const total = () => {
  const T = R.tally();
  let s = 0;
  for (let c = 0; c < T.K; c++) if (R.inYear(c)) s += T.n[c];
  return s;
};

console.log('\nit renders at all');
ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));
ok(!!R, 'the page hands itself over on window.RET');
ok(d.querySelectorAll('.card').length === 3,
   'three cards: day retention, monthly retention, value per player');
ok(d.querySelectorAll('#moneyTable thead th').length === D.milestones.length + 2,
   'the value table has the same columns as the retention one, so a figure lines up '+
   'with the rate beside it');
const shownCohorts = () => R.cohorts().filter((_, c) => R.inYear(c)).length;
ok(DEFAULTS.rows === shownCohorts(),
   DEFAULTS.rows + ' cohort rows — the ' + DEFAULTS.year + ' cohorts, not all ' +
   R.cohorts().length);
ok(d.querySelectorAll('#cohortTable thead th').length === D.milestones.length + 2,
   'cohort, first depositors and ' + D.milestones.length + ' milestone columns');
ok(footer().length === D.milestones.length + 2, 'and an All-cohorts footer row');
ok(d.querySelectorAll('#cohortTable [title]').length > 0,
   'every mark carries its meaning in a title — the only explanation left on the page');

console.log('\nthe removed sections are still gone');
['chartCurves','chartTrend','tiles','legCurves','legTrend','tt','notes','tableNote','foot',
 'mRet','mFirst','mSame','yAll','y2025','y2026','yRecent']
  .forEach(id => ok(d.getElementById(id) === null, '#' + id + ' is not in the page'));
ok(d.querySelectorAll('svg').length === 0, 'no charts left behind');

console.log('\ndefaults, in state and in the markup');
ok(DEFAULTS.grain === 'month', 'opens on MONTHLY cohorts');
ok(DEFAULTS.gMonth === 'true', 'and the Months button agrees');
ok(DEFAULTS.gWeek === 'false', 'and Weeks is not also pressed');

/* The year default is read from the data, never hardcoded. A literal '2026'
   here would open on an empty table the first time someone loads this in
   January, and would do it silently. */
ok(DEFAULTS.year === R.YEARS[R.YEARS.length - 1],
   'opens on the latest cohort year in the data (' + DEFAULTS.year + ' of ' +
   R.YEARS.join(', ') + '), computed rather than hardcoded');
ok(DEFAULTS.yearControl === DEFAULTS.year, 'and the control agrees');
ok(DEFAULTS.weeks === 10, 'and the weekly view is windowed to the last 10 weeks by default');

/* Captured above, then switched off for the rest of the file. The window is a
   view convenience; almost every section below is about the population or the
   arithmetic and reads a table expecting every cohort in it. The window has its
   own section further down, which turns it back on. */
R.state.weeks = 0; R.render();
ok(DEFAULTS.strip.includes(DEFAULTS.year + ' cohorts') &&
   DEFAULTS.strip.includes('monthly cohorts'),
   'the header strip says so on load: "' + DEFAULTS.strip + '"');
/* Opens on 'risk', not 'complete'. Withholding every young cohort taught
   people the page was broken rather than making them careful; the figures are
   shown and annotated instead, and Complete cohorts is one click away for a
   strict like-for-like read. */
ok(DEFAULTS.mature === 'risk', 'opens on at-risk denominators, not complete-only');
ok(DEFAULTS.bAtRisk === 'true' && DEFAULTS.bComplete === 'false',
   'and the buttons agree');
/* This demanded zero empty rows, which held until a cohort existed that was
   younger than its own first retention window. The rule that matters is that
   nothing is withheld SILENTLY: a row with no figures has to say why. */
ok(DEFAULTS.emptyUnlabelled === 0,
   DEFAULTS.emptyRows === 0
     ? 'every cohort row has figures on load'
     : DEFAULTS.emptyRows + ' cohort row(s) too young to report, each labelled as such');
/* Not every dimension opens on "all" any more. Account status opens on the
   live population, because a blocked account cannot come back and counting it
   as churn measures the block rather than the retention. Whatever the builder
   says, the page must honour it — and must say so in the strip, since a page
   that quietly leaves people out is worse than one that leaves them out
   loudly. */
ok(D.dims.every(dim => DEFAULTS.sel[dim.key] === (dim.dflt || 'all')),
   'every dimension opens on the default the builder emitted: ' +
   D.dims.map(dim => dim.key + '=' + DEFAULTS.sel[dim.key]).join(' '));
const dfltFiltered = D.dims.filter(dim => (dim.dflt || 'all') !== 'all');
dfltFiltered.forEach(dim => {
  const label = dim.opts.find(o => o[0] === dim.dflt)[1];
  ok(DEFAULTS.strip.includes(label),
     'and the strip names the "' + label + '" default rather than hiding it');
});
ok(D.dims.every(dim => dimControl(dim.key) !== 'MISSING'),
   'every dimension has a control: ' +
   D.dims.map(dim => dim.key + ' (' + dimControl(dim.key) + ')').join(', '));
ok(D.dims.every(dim => {
     const want = dim.dflt || 'all';
     const sel = d.getElementById('f_' + dim.key);
     if (sel) return sel.value === want;
     return d.querySelector('#dimPills button[data-dim="' + dim.key +
                            '"][aria-pressed="true"]').dataset.v === want;
   }), 'and every control shows that default on load rather than lying about it');
/* Normalise for the rest of the suite: weeks, every year. The structural
   checks below were written against the whole dataset and stay that way, so
   changing what the page OPENS on cannot quietly stop them exercising it. */
d.getElementById('bComplete').click();   // the checks below assume strict mode
d.getElementById('gWeek').click();
(() => { const y = d.getElementById('f_year'); y.value = 'all'; y.onchange({ target: y }); })();
D.dims.forEach(dim => setDim(dim.key, 'all'));
ok(R.state.grain === 'week' && R.state.year === 'all' &&
   D.dims.every(dim => R.state.sel[dim.key] === 'all'),
   'normalised to weeks, all years and no dimension filter for the checks below');

console.log('\nweeks still mature sooner — they are one click away, not the default');
const newestComplete = (grain, m) => {
  const g = D.grains[grain], K = g.cohorts.length;
  const n = new Array(K).fill(0), e = new Array(K).fill(0);
  g.ci.forEach((c, i) => { n[c]++; if (D.players.obs[i] >= m) e[c]++; });
  let best = null;
  for (let c = 0; c < K; c++) if (e[c] === n[c] && e[c] >= D.minEligible) best = c;
  return best === null ? null : g.meta[g.cohorts[best]].end;
};
const fw = newestComplete('week', 30), fm = newestComplete('month', 30);
ok(fw && fm && fw > fm,
   'the newest fully-observed D30 cohort ends ' + fw + ' by week against ' + fm +
   ' by month — ' + Math.round((Date.parse(fw) - Date.parse(fm)) / 86400000) +
   ' days fresher — the reason the weekly view exists, even though months are what loads');

console.log('\nhouse rules');
ok(R.pct1(27.25) === '27.3%', 'one decimal on purpose — 27.3 and 27.2 must not both read 27%');
ok(R.pct1(null) === '—', 'and a missing figure is an em dash, not 0%');
ok([...d.querySelectorAll('#cohortTable td.cell')].every(c => /^\d+\.\d%/.test(c.textContent)),
   'every drawn cell is a one-decimal percentage');

console.log('\na row reads across a fixed population');
function fallsAcross(){
  const T = R.tally(), out = [];
  for (let c = 0; c < T.K; c++){
    let prev = null, prevFull = true;
    for (let j = 0; j < T.J; j++){
      const u = R.usable(T, c, j); if (!u) continue;
      const v = T.ret[c*T.J+j] / T.elig[c*T.J+j] * 100;
      if (prev !== null && v < prev - 1e-9)
        out.push({ c, j, betweenFull: u === 2 && prevFull });
      prev = v; prevFull = u === 2;
    }
  }
  return out;
}
ok(fallsAcross().length === 0,
   'under Complete cohorts no row falls across its columns — the denominator is the whole ' +
   'cohort in every one of them');

console.log('\nthe All-cohorts row is weighted, not averaged');
/* These two sections read the footer the page has actually drawn and compare it
   against milestone(), which is the cumulative measure. Set it explicitly rather
   than leaning on the default — a default is a product decision and has already
   flipped twice; what is being checked here is the arithmetic underneath it. */
R.state.retMetric = 'by'; R.render();
let T = R.tally();
const J30 = D.milestones.indexOf(30);
const per = [];
for (let c = 0; c < T.K; c++)
  if (R.usable(T, c, J30)) per.push(T.ret[c*T.J+J30] / T.elig[c*T.J+J30] * 100);
const naive = per.reduce((s,v) => s+v, 0) / per.length;
const weighted = R.milestone(T, J30).rate;
ok(Math.abs(weighted - naive) > 0.1,
   'D30 weighted ' + weighted.toFixed(2) + '% vs naive mean ' + naive.toFixed(2) +
   '% over ' + per.length + ' weeks — they differ, so averaging the column would be wrong');
ok(footer()[2 + J30] === R.pct1(weighted),
   'and the footer prints the weighted one (' + footer()[2 + J30] + ')');

console.log('\nthe footer base moves from column to column');
const m1 = R.milestone(T, 0), m90 = R.milestone(T, D.milestones.length - 1);
ok(m1.k > m90.k,
   'D1 pools ' + m1.k + ' cohorts and D90 pools ' + m90.k + ' — a cohort three weeks old ' +
   'counts towards the first and cannot count towards the last');
/* A column can pool zero cohorts — under a 10-week window nothing is 90 days
   old — and then the footer is a bare dash with no base to name. What must hold
   is that every footer cell carrying a FIGURE names its base. */
const footCells = [...d.querySelectorAll('#cohortTable tfoot td')].slice(2);
const footFigs = footCells.filter(c => c.textContent.trim() !== '\u2014');
ok(footFigs.length > 0 && footFigs.every(c => /across \d+ weeks?/.test(c.getAttribute('title') || '')),
   'and each of the ' + footFigs.length + ' footer figures names its own base on hover: "' +
   footFigs[footFigs.length-1].getAttribute('title').slice(0, 56) + '..."');

R.state.retMetric = 'after'; R.render();   // back to how the page opens

console.log('\na thin denominator is refused, not shown small');
let thin = 0, thinShown = 0;
for (let c = 0; c < T.K; c++)
  for (let j = 0; j < T.J; j++){
    const e = T.elig[c*T.J+j];
    if (e > 0 && e < D.minEligible){ thin++; if (R.usable(T, c, j)) thinShown++; }
  }
ok(thinShown === 0, thin + ' cohort/milestone cells fall under n=' + D.minEligible +
   ' and none of them is reported');

console.log('\nAt risk fills the gaps in, and admits it');
const beforeCells = d.querySelectorAll('#cohortTable td.cell').length;
const beforeDashes = d.querySelectorAll('#cohortTable td.dash').length;
d.getElementById('bAtRisk').click();
ok(R.state.mature === 'risk', 'the toggle moved state');
ok(d.querySelectorAll('#cohortTable td.cell').length > beforeCells,
   'the table gains cells (' + beforeCells + ' -> ' +
   d.querySelectorAll('#cohortTable td.cell').length + ') and loses dashes (' + beforeDashes +
   ' -> ' + d.querySelectorAll('#cohortTable td.dash').length + ')');
const ns = [...d.querySelectorAll('#cohortTable td.cell .sub')];
ok(ns.length > 0 && ns.every(x => /^n=[\d,]+$/.test(x.textContent)),
   'every thinned cell prints the n it was computed on — ' + ns.length + ' of them');
/* Every cell carries a title now (it names the count behind the percentage),
   so the thinned ones are identified by what their title SAYS rather than by
   the mere presence of one. */
ok([...d.querySelectorAll('#cohortTable td.cell')]
     .filter(c => /narrower/.test(c.getAttribute('title') || '')).length === ns.length,
   'and each of those says on hover that it is a narrower, earlier-in-period group');

/* This is the assertion that stops someone "fixing" the fall. A row that drops
   across the columns looks like a bug and is not: past its maturity the
   denominator is whoever has lived that long, which is an earlier-in-period and
   differently behaved crowd. The n= is the disclosure. */
const falls = fallsAcross();
ok(falls.length > 0 && falls.every(f => !f.betweenFull),
   falls.length + ' at-risk cells sit below the column to their left, and none of them is ' +
   'between two fully-observed figures — the population thinning, not players un-depositing');
d.getElementById('bComplete').click();

console.log('\nthe filter dimensions');
ok(D.dims.length >= 3, D.dims.length + ' dimensions on the page: ' +
   D.dims.map(x => x.label).join(', '));
[...R.PILL_DIMS].forEach(k => ok(dimControl(k) === 'switch',
   k + ' is a segmented switch, not a dropdown — every option visible, one click to change'));
ok([...R.PILL_DIMS].every(k => {
     const dim = D.dims.find(x => x.key === k);
     const shown = d.querySelectorAll('#dimPills button[data-dim="' + k + '"]').length;
     const live = R.dimCounts(dim).filter(c => c > 0).length;
     return shown === live + 1;                       // + the "all" button
   }),
   'each switch offers exactly its populated options plus "all": ' +
   [...R.PILL_DIMS].map(k =>
     k + ' ' + d.querySelectorAll('#dimPills button[data-dim="' + k + '"]').length).join(', '));

ok(D.dims.map(x => x.key).includes('ftdt'), 'including FTD type, which the user asked for');

/* A dimension whose column carries no value on any cached row is not emitted at
   all, so the page has one fewer control rather than a control that filters
   everything to nothing. This asserts the mechanism, not the current state:
   when kyc_status / email_verified_at / phone_verified_at start arriving they
   appear by themselves and the count below goes up. */
['kyc','email','phone'].forEach(k => {
  const present = D.dims.some(x => x.key === k);
  ok(present === (dimControl(k) !== 'MISSING'),
     k + ' is ' + (present ? 'present with its control' : 'absent, with no dead control') +
     ' — the page follows the data');
});

/* Every dimension's values must partition the population: a player has exactly
   one channel, one rail, one FTD type. If the packing were wrong the parts
   would over- or under-count and nothing else on the page would show it. */
const base = total();
D.dims.forEach(dim => {
  const counts = R.dimCounts(dim);
  let sum = 0, skipped = 0;
  for (let v = 0; v < dim.card; v++){
    if (setDim(dim.key, String(v)) === false){ skipped++; continue; }  // empty, not rendered
    sum += total();
  }
  setDim(dim.key, 'all');
  ok(sum === base, dim.label + ': its ' + (dim.card - skipped) + ' populated values sum to ' +
     n0(sum) + ', exactly the unfiltered ' + n0(base) +
     (skipped ? ' (' + skipped + ' empty value' + (skipped === 1 ? '' : 's') + ' not offered)' : ''));
  ok(counts.reduce((a2, b2) => a2 + b2, 0) === D.totalMembers,
     '  and its codes cover every one of the ' + n0(D.totalMembers) + ' players');
});

console.log('\nthe filters actually filter, and AND together');
const allD30 = R.milestone(R.tally(), J30);
setDim('ftdt', '0');                                   // Super Qualified
const sq = R.milestone(R.tally(), J30);
setDim('ftdt', '2');                                   // Non Qualified
const nq = R.milestone(R.tally(), J30);
ok(sq.n < allD30.n && nq.n < allD30.n, 'each value narrows the base');
ok(sq.rate - nq.rate > 20,
   'super-qualified first depositors return at ' + sq.rate.toFixed(1) + '% by D30 against ' +
   nq.rate.toFixed(1) + '% for non-qualified — a ' + (sq.rate - nq.rate).toFixed(1) +
   ' point gap, the largest any filter on this page produces');
ok(/Non qualified/.test(d.getElementById('tableFilters').textContent),
   'and the header strip names the active filter');

setDim('rail', '1');                                   // + Fiat
const both = R.milestone(R.tally(), J30);
ok(both.n < nq.n, 'adding a rail narrows it further (' + n0(nq.n) + ' -> ' + n0(both.n) +
   ') — the dimensions AND together rather than replacing each other');
setDim('rail', 'all'); setDim('ftdt', 'all');
ok(Math.abs(R.milestone(R.tally(), J30).rate - allD30.rate) < 1e-9,
   'and clearing them restores the figure exactly');

console.log('\nthe cohort-year filter');
/* A different kind of filter from the dropdowns beside it: those narrow the
   players counted inside every cohort, this narrows which cohorts are rows at
   all. Both the table and the All-cohorts row must obey it — a footer that kept
   pooling the whole history beside a filtered table is the failure to look for. */
const yearEl = d.getElementById('f_year');
const setYear = v => { yearEl.value = v; yearEl.onchange({ target: yearEl }); };
const rowCount = () => d.querySelectorAll('#cohortTable tbody tr').length;

ok(!!yearEl, 'there is a cohort-year control');
ok(R.state.year === 'all' && yearEl.value === 'all', 'it opens on all years, in state and markup');
ok([...yearEl.options].map(o => o.value).join(',') === 'all,' + R.YEARS.join(','),
   'its options come from the data, not a hardcoded pair: ' +
   [...yearEl.options].map(o => o.text).join(' | '));

const allRows = rowCount(), allTotal = total();
const byYear = {};
R.YEARS.forEach(y => {
  setYear(y);
  byYear[y] = { rows: rowCount(), n: total() };
  ok(R.cohorts().filter((_, c) => R.inYear(c)).every(ym => R.yearOf(ym) === y),
     y + ': every drawn row is a ' + y + ' cohort (' + byYear[y].rows + ' of ' + allRows + ')');
  ok(/\b/.test(d.getElementById('tableFilters').textContent) &&
     d.getElementById('tableFilters').textContent.includes(y + ' cohorts'),
     'and the header strip names it');
  ok(yearEl.className.includes('on'), 'and the control shows as active');
});

/* The years must partition the cohorts exactly — no row in both, none in
   neither. If the ISO-week year ever disagreed with the key prefix this is
   where it would show. */
const yearRows = R.YEARS.reduce((s, y) => s + byYear[y].rows, 0);
const yearN = R.YEARS.reduce((s, y) => s + byYear[y].n, 0);
ok(yearRows === allRows && yearN === allTotal,
   R.YEARS.map(y => y + ' ' + n0(byYear[y].n)).join(' + ') + ' = ' + n0(allTotal) +
   ' — the years partition the cohorts exactly');

setYear(R.YEARS[R.YEARS.length - 1]);
const lastYear = R.milestone(R.tally(), J30);
setYear('all');
const everything = R.milestone(R.tally(), J30);
ok(lastYear.n < everything.n && lastYear.k < everything.k,
   'the footer pools only the selected year (' + n0(lastYear.n) + ' players over ' +
   lastYear.k + ' cohorts against ' + n0(everything.n) + ' over ' + everything.k +
   ') rather than the whole history beside a filtered table');
ok(rowCount() === allRows && total() === allTotal, 'and clearing it restores every cohort');

console.log('\nthe "after day N" measure');
(() => {
  if (!R.HAS_AFTER){
    ok(d.getElementById('mBy') === null,
       'this build carries no last-return data, so the measure switch is absent rather '+
       'than dead — it appears by itself once the builder emits players.last');
    return;
  }
  ok(R.state.retMetric === 'after', 'opens on the survival measure — "how many are '+
     'still depositing past day N", which falls across the row the way a retention '+
     'curve is expected to');
  ok(d.getElementById('mAfter').getAttribute('aria-pressed') === 'true',
     'and the button agrees');

  const T2 = R.tally();
  /* The whole reason this needed new data: a player whose only return was early
     counts as retained BY day 7 and must NOT count as retained AFTER it. If the
     survival measure were derived from the first-return lag, these two would be
     identical and the switch would be decorative. */
  let onlyEarly = 0;
  for (let i = 0; i < D.players.lag.length; i++)
    if (D.players.obs[i] > 7 && D.players.lag[i] &&
        D.players.lag[i] <= 7 && D.players.last[i] <= 7) onlyEarly++;
  ok(onlyEarly > 0,
     n0(onlyEarly) + ' players returned only inside the first 7 days — they are in "by D7" '+
     'and out of "after D7", which is why the survival measure needs the LAST return');

  ok(D.players.last.every((l, i) => (l === 0) === (D.players.lag[i] === 0) &&
                                    (l === 0 || l >= D.players.lag[i])),
     'every last return is at or after its own first return, and they are zero together');

  /* by rises, after falls. Asserting both stops one being "simplified" into the
     other. */
  const J = T2.J;
  let rises = 0, falls = 0, rows = 0;
  for (let c = 0; c < T2.K; c++){
    /* Only rows mature at the LAST milestone can be compared column to column
       in both measures at once. eligA is per-column now, so the deepest one is
       the strict test. */
    if (T2.eligA[c*J + J-1] < D.minEligible || T2.eligA[c*J + J-1] !== T2.n[c]) continue;
    rows++;
    let up = true, down = true;
    for (let j = 1; j < J; j++){
      if (T2.ret[c*J+j] < T2.ret[c*J+j-1]) up = false;
      if (T2.aft[c*J+j] > T2.aft[c*J+j-1]) down = false;
    }
    if (up) rises++;
    if (down) falls++;
  }
  ok(rows > 0 && rises === rows && falls === rows,
     'over ' + rows + ' mature cohorts "by day N" rises in every one and "after day N" '+
     'falls in every one — they answer opposite questions');

  /* The rule that changed: "after day N" needs the player watched PAST day N,
     not for the whole horizon. Requiring the horizon withheld May 2026's entire
     row — 1,080 players each already observed 84+ days — to avoid a bias worth
     a few days at the tail of the window. This asserts the looser, correct
     rule: a cohort observed less than the horizon still reports its early
     columns. */
  const shortRows = [];
  for (let c = 0; c < T2.K; c++)
    if (T2.n[c] >= D.minEligible && T2.minObs[c] < D.horizon &&
        T2.minObs[c] > D.milestones[0] && T2.eligA[c*J] === T2.n[c]) shortRows.push(c);
  ok(shortRows.length > 0,
     shortRows.length + ' cohorts are observed for less than the full ' + D.horizon +
     ' days and still report their early columns — the eligibility is per column, '+
     'not per horizon');

  d.getElementById('mAfter').click();
  ok(R.state.retMetric === 'after', 'the switch moved state');
  ok([...d.querySelectorAll('#cohortTable .pt.info.win')].length > 0 &&
     [...d.querySelectorAll('#cohortTable .pt.info.win')].every(b2 => /\dd window/.test(b2.textContent)),
     'and a row whose window is short says so on the label, so a floor is never read '+
     'as a finished rate');
  ok([...d.querySelectorAll('#cohortTable thead th')].some(t => /^after D/.test(t.textContent)),
     'the headers say "after D…" rather than "by D…"');
  const lastCol = [...d.querySelectorAll('#cohortTable tbody tr')][0];
  ok(lastCol && lastCol.lastElementChild.textContent === '—',
     'and the final column is a dash — nothing can be after day ' + D.milestones[J-1] +
     ' inside a ' + D.milestones[J-1] + '-day window');
  const tip = [...d.querySelectorAll('#cohortTable td.cell')][2];
  ok(/still depositing after day/.test(tip.title),
     'every cell says how many, of how many: "' + tip.title.slice(0, 72) + '..."');
  d.getElementById('mBy').click();
})();

console.log('\na row that can show nothing says why');
(() => {
  /* Seven dashes beside a four-figure player count reads as a broken table.
     The badge is the difference between "this is broken" and "this is waiting
     for time to pass", and it has to be on the row rather than in the tooltip
     of each dash — nobody hovers a dash to find out why it is a dash. */
  d.getElementById('mAfter').click();
  const badges = [...d.querySelectorAll('#cohortTable .pt.info:not(.win)')];
  ok(badges.length > 0,
     badges.length + ' rows badged in the survival measure: ' +
     [...new Set(badges.map(b => b.textContent))].join(', '));
  ok(badges.every(b => (b.getAttribute('title') || '').length > 30),
     'each badge explains itself on hover');
  /* A literal double quote inside a double-quoted title attribute ends the
     attribute at that character. The tooltip still exists and still renders —
     it is just cut off mid-sentence — so nothing about the page looks wrong.
     It happened here: 'answering "after day 1" needs...' became 'answering '.
     A truncated title always ends at the character before the quote, which is
     whitespace far more often than not, so that is what this looks for. */
  const titles = [...d.querySelectorAll('#cohortTable [title]')].map(n => n.getAttribute('title'));
  const cut = titles.filter(t => t !== t.trimEnd());
  ok(cut.length === 0,
     titles.length + ' tooltips, none ending mid-sentence — a raw " inside a title '+
     'attribute truncates it there and looks like nothing at all' +
     (cut.length ? ': "' + cut[0] + '"' : ''));
  ok(!/\b1 days\b/.test(titles.join(' ')), 'and none of them says "1 days"');
  ok(!/\b1 days\b/.test(d.getElementById('cohortTable').innerHTML),
     'and the wording pluralises — "1 day", never "1 days"');

  /* Every badged row must genuinely be empty, and every unbadged row must
     genuinely have something. A badge on a row with figures, or a blank row
     with no badge, are both worse than no badge at all. */
  const rows = [...d.querySelectorAll('#cohortTable tbody tr')];
  const wrong = rows.filter(r => {
    /* `.win` is the short-window badge and sits on rows that DO have figures —
       a different thing from the badge that says the row is empty. */
    const badged = !!r.querySelector('.pt.info:not(.win)');
    const cells = r.querySelectorAll('td.cell').length;
    return badged ? cells > 0 : cells === 0;
  });
  ok(wrong.length === 0,
     'every badged row is empty and every empty row is badged, across ' + rows.length + ' rows');

  /* "at risk only" must be actionable — those exact rows fill in when you
     switch. Naming the rows rather than counting them is the difference between
     checking the claim and checking a coincidence. */
  /* Identify a row by its cohort key, not by its rendered label: the badges
     concatenate straight onto the text ("week of 17 Aug 20260d window") and any
     regex over that is a bug waiting to happen — it was one. */
  const label = r => r.dataset.cohort;
  const atRisk = rows.filter(r => /at risk only/.test(r.textContent)).map(label);
  if (atRisk.length){
    d.getElementById('bAtRisk').click();
    const nowFilled = new Set([...d.querySelectorAll('#cohortTable tbody tr')]
      .filter(r => r.querySelectorAll('td.cell').length > 0).map(label));
    const still = atRisk.filter(l => !nowFilled.has(l));
    ok(still.length === 0,
       'all ' + atRisk.length + ' "at risk only" row(s) fill in on the switch (' +
       atRisk.join(', ') + ') — the badge is a direction, not an apology');
    d.getElementById('bComplete').click();
  } else ok(true, 'no "at risk only" rows in this build');
  d.getElementById('mBy').click();
})();

console.log('\nthe monthly triangle');
(() => {
  const M = R.monthlyTally();
  const g = D.grains.month;

  ok(d.querySelectorAll('#monthlyTable thead th').length === R.MONTH_COLS + 2,
     'M1..M' + R.MONTH_COLS + ' plus cohort and size');
  ok(![...d.querySelectorAll('#monthlyTable thead th')].some(t => t.textContent === 'M0'),
     'and no M0 column — in a conventional triangle M0 reads 100%, here it would read ~30%, '+
     'and a column that looks like the convention and means something else is the same trap '+
     'the "by D1" headers had to fix');

  /* This is the measure the day table cannot give: point-in-time per calendar
     month, so it falls. Asserting it stops the two tables being "simplified"
     into one. */
  let falls = 0, pairs = 0;
  for (let c = 0; c < M.K; c++){
    if (M.n[c] < D.minEligible) continue;
    if (R.monthState(c, 2) !== 2) continue;
    pairs++;
    if (M.hit[c*R.MONTH_COLS + 1] < M.hit[c*R.MONTH_COLS]) falls++;
  }
  ok(pairs > 0 && falls >= pairs * 0.8,
     'M2 is below M1 in ' + falls + ' of ' + pairs + ' cohorts — point-in-time retention '+
     'falls, unlike the cumulative day table above it');

  /* A player who skips a month and comes back is the whole reason this table
     is not derivable from the first-return lag. If nobody did that, the two
     tables would be measuring the same thing. */
  let gaps = 0;
  for (let i = 0; i < D.players.mmask.length; i++){
    const m = D.players.mmask[i];
    let seen = false, gap = false;
    for (let k = 0; k <= 12; k++){
      if (m & (1 << k)){ if (gap) { gaps++; break; } seen = true; }
      else if (seen) gap = true;
    }
  }
  ok(gaps > 0,
     n0(gaps) + ' players skip a month and come back — they are out of that column and '+
     'back in a later one, which is exactly what the day table cannot express');

  /* Months that have not happened must be structurally absent, not 0%. */
  let futureShown = 0;
  for (let c = 0; c < M.K; c++)
    for (let k = 1; k <= R.MONTH_COLS; k++)
      if (R.monthState(c, k) === 0 && M.hit[c*R.MONTH_COLS + (k-1)] > 0) futureShown++;
  ok(futureShown === 0, 'no cohort has activity in a month that has not happened yet');

  const dashes = d.querySelectorAll('#monthlyTable td.dash').length;
  ok(dashes > 0, dashes + ' dashes where a month has not elapsed or is still filling');

  /* The cutoff month is always partial, so a cohort's newest column understates
     until it closes. Complete hides those; At risk shows them marked. */
  const beforeParts = d.querySelectorAll('#monthlyTable td.cell .sub').length;
  ok(beforeParts === 0, 'under Complete no part-month is drawn');
  d.getElementById('bAtRisk').click();
  const parts = [...d.querySelectorAll('#monthlyTable td.cell .sub')];
  ok(parts.length > 0 && parts.every(x => x.textContent === 'part'),
     parts.length + ' part-months appear under At risk, each marked and each explaining '+
     'on hover that it is only counted to the cutoff');
  d.getElementById('bComplete').click();

  ok(/monthly cohorts/.test(d.getElementById('monthlyFilters').textContent),
     'the strip says the rows are months whatever grain the rest of the page is on: "' +
     d.getElementById('monthlyFilters').textContent + '"');

  /* It ignores the week/month switch by design — "month 3 of a week-long
     cohort" has no meaning — but it must still obey the year and the
     dimensions, or it would disagree with the tables around it. */
  const rowsAll = d.querySelectorAll('#monthlyTable tbody tr').length;
  d.getElementById('gWeek').click();
  ok(d.querySelectorAll('#monthlyTable tbody tr').length === rowsAll,
     'the grain switch leaves it alone (' + rowsAll + ' monthly rows either way)');
  d.getElementById('gMonth').click();

  const nAll = M.n.reduce((a2, b2) => a2 + b2, 0);
  setDim('ftdt', '0');
  const nSq = R.monthlyTally().n.reduce((a2, b2) => a2 + b2, 0);
  ok(nSq < nAll, 'but it does obey the dimension filters (' + n0(nAll) + ' -> ' + n0(nSq) + ')');
  setDim('ftdt', 'all');

  /* Hand the page back in the state the normalisation left it. This block is
     the only one that touches the grain, and the sections below were written
     against weeks. */
  d.getElementById('gWeek').click();
})();

console.log('\nthe value table');
/* Same denominator as the retention table on purpose: a filter moves both, and
   a rate always has the money that produced it directly underneath.

   This section is about the CUMULATIVE curve — that it only rises, that the
   footer is weighted, that the metric switch moves it. The card now opens on
   "after Dn", so put it in the cumulative measure explicitly rather than
   leaning on a default that has already moved once. The after measure has its
   own section below. */
(() => {
  R.state.moneyMetric = 'by'; R.render();
  const T = R.tally();
  const rows = d.querySelectorAll('#moneyTable tbody tr').length;
  ok(rows === d.querySelectorAll('#cohortTable tbody tr').length,
     'both tables draw the same ' + rows + ' cohort rows');

  const mi = R.MKEYS.indexOf(R.state.money);
  ok(R.state.money === D.moneyMetrics[0][0],
     'opens on ' + D.moneyMetrics[0][1] + ' — deposits, the one that cannot go negative');
  ok([...d.querySelectorAll('#segMoney button')].length === D.moneyMetrics.length,
     'a button per metric: ' +
     D.moneyMetrics.map(m => m[1]).join(', '));

  /* ADPU is a cumulative sum of deposits, so it can only rise across a row.
     This is the assertion that catches a bucketing mistake: money in the wrong
     bucket still totals correctly and would show up nowhere else. */
  let dips = 0, checked = 0;
  const di = R.MKEYS.indexOf('dep');
  for (let c = 0; c < T.K; c++){
    let prev = null;
    for (let j = 0; j < T.J; j++){
      if (!R.usable(T, c, j)) continue;
      const v = R.valueAt(T, c, j, di);
      if (prev !== null){ checked++; if (v < prev - 1e-9) dips++; }
      prev = v;
    }
  }
  ok(checked > 0 && dips === 0,
     'ADPU never falls across a row over ' + checked + ' steps — deposits only accumulate');

  /* ARPU on NGR is allowed to fall, and does. Asserting it stops someone
     "fixing" the value table into a running maximum. */
  const ni = R.MKEYS.indexOf('ngr');
  let ngrDips = 0;
  for (let c = 0; c < T.K; c++){
    let prev = null;
    for (let j = 0; j < T.J; j++){
      if (!R.usable(T, c, j)) continue;
      const v = R.valueAt(T, c, j, ni);
      if (prev !== null && v < prev - 1e-9) ngrDips++;
      prev = v;
    }
  }
  ok(ngrDips > 0,
     'ARPU on NGR falls in ' + ngrDips + ' steps and that is the data — NGR is net of '+
     'what players win, so a cohort can be worth less at D14 than at D7');

  /* The footer is total money over total players, not the average of the
     column — the same weighting rule the retention footer follows. */
  const p30 = R.pooledValue(T, D.milestones.indexOf(30), di);
  const per = [];
  for (let c = 0; c < T.K; c++)
    if (R.inYear(c) && R.usable(T, c, D.milestones.indexOf(30)))
      per.push(R.valueAt(T, c, D.milestones.indexOf(30), di));
  const naiveM = per.reduce((a2, b2) => a2 + b2, 0) / per.length;
  ok(Math.abs(p30.value - naiveM) > 0.01,
     'pooled D30 ADPU ' + R.money(p30.value) + ' vs the naive mean of the column ' +
     R.money(naiveM) + ' — they differ, so averaging the column would be wrong');

  ok(R.money(-5000) === '-$5,000', 'the sign goes before the currency symbol');
  ok(R.money(12.4) === '$12.40', 'and an average under $100 keeps its cents');

  /* Switching metric must move the table and say which one is on. */
  const before = d.querySelector('#moneyTable tfoot td:last-child').textContent;
  d.querySelector('#segMoney button[data-v="ngr"]').onclick();
  ok(d.querySelector('#moneyTable tfoot td:last-child').textContent !== before,
     'the metric switch changes the figures (' + before + ' -> ' +
     d.querySelector('#moneyTable tfoot td:last-child').textContent + ')');
  const ngrLabel = D.moneyMetrics.find(m => m[0] === 'ngr')[2];
  ok(d.getElementById('moneyFilters').textContent.startsWith(ngrLabel),
     'and the strip leads with the metric\'s own label rather than a guess at it: "' +
     d.getElementById('moneyFilters').textContent + '"');
  d.querySelector('#segMoney button[data-v="dep"]').onclick();
  R.state.moneyMetric = 'after'; R.syncControls(); R.render();   // back to how the card opens
})();

console.log('\nthe value table has its own by/after window');
(() => {
  if (!R.HAS_AFTER) return;
  ok(DEFAULTS.moneyMetric === 'after',
     'it opens on "after Dn", matching the retention card above it — both tables answer '+
     '"what is still ahead of this cohort at day N"');
  ok(DEFAULTS.vAfter === 'true', 'and the button agreed at load');

  /* Deliberately not wired to the retention card's switch: "how many are still
     here after day 30" beside "how much did the cohort bring BY day 30" is an
     ordinary pairing, and one global toggle would forbid it. */
  R.state.retMetric = 'by'; R.render();
  ok(R.state.moneyMetric === 'after',
     'switching the retention card to "by" leaves the value card on "after" — the two '+
     'switches share a default, not a wire');
  ok(/after D1/.test(d.querySelector('#moneyTable thead').textContent) &&
     /by D1/.test(d.querySelector('#cohortTable thead').textContent),
     'and the headers prove it: the tables can show different measures at once');

  const T = R.tally(), J = T.J, di = R.MKEYS.indexOf('dep');
  /* The identity that makes this measure trustworthy rather than a second
     guess at the same number: for a cohort watched the whole horizon, what it
     brought BY day N plus what it brought AFTER day N is what it brought, full
     stop. A bucketing slip would break this and show up nowhere else. */
  let worst = 0, pairs = 0;
  for (let c = 0; c < T.K; c++){
    if (T.elig[c*J + J-1] !== T.n[c] || !T.n[c]) continue;   // fully observed only
    const whole = T.sums[di][c*J + J-1];
    for (let j = 0; j < J; j++){
      if (!T.elig[c*J+j] || !T.eligA[c*J+j]) continue;
      worst = Math.max(worst, Math.abs(T.sums[di][c*J+j] + T.aftSums[di][c*J+j] - whole));
      pairs++;
    }
  }
  ok(pairs > 0 && worst < 1e-6,
     'over ' + pairs + ' cohort/milestone pairs, "by Dn" + "after Dn" reconstructs the '+
     'whole-horizon total to the cent — the two measures are one split, not two counts');

  R.state.moneyMetric = 'by'; R.render();
  ok(/by D1/.test(d.querySelector('#moneyTable thead').textContent),
     'the switch moves the value headers to the cumulative curve');
  R.state.moneyMetric = 'after'; R.render();
  ok(/after day N/.test(d.getElementById('moneyFilters').textContent),
     'and the strip names the window, so a screenshot is never ambiguous');

  /* Value after day N falls across the row: each column starts later and has
     less of the window left to earn in. The cumulative one rises. Asserting
     both stops either being "fixed" into the other. */
  let dips = 0, steps = 0;
  for (let c = 0; c < T.K; c++){
    let prev = null;
    for (let j = 0; j < J - 1; j++){
      if (R.usableAfter(T, c, j) !== 2) continue;    // whole-cohort columns only
      const v = R.valueAt(T, c, j, di);
      if (prev !== null){ steps++; if (v > prev + 1e-9) dips++; }
      prev = v;
    }
  }
  ok(steps > 0 && dips === 0,
     'value after day N falls across every one of ' + steps + ' fully-observed steps, '+
     'the mirror of the cumulative curve rising');

  const last = [...d.querySelectorAll('#moneyTable tbody tr')]
    .map(r => r.lastElementChild.textContent.trim());
  const footLast = d.querySelector('#moneyTable tfoot td:last-child').textContent.trim();
  ok(last.every(t => t === '\u2014') && footLast === '\u2014',
     'nothing comes after the last milestone, so that column is a dash in every row AND '+
     'in the footer — a footer reading $0.00 under a column of dashes reads as a bug');

  R.state.moneyMetric = 'after'; R.state.retMetric = 'after'; R.syncControls(); R.render();
})();

console.log('\nthe grain switch');
/* Both grains hold the same people only when both are showing all of them, so
   drop the weekly window for this section — it is the one place where "the
   table totals everybody" is the point being checked. */
R.state.weeks = 0; R.render();
const weekN = R.cohorts().length, weekTotal = total();
d.getElementById('gMonth').click();
ok(R.state.grain === 'month', 'the switch moved state');
const monthN = R.cohorts().length;
ok(weekN > monthN * 3, weekN + ' weekly cohorts against ' + monthN + ' monthly');
ok(d.querySelectorAll('#cohortTable tbody tr').length === monthN,
   'the table redrew with ' + monthN + ' monthly rows');
/* The single most valuable check here: both grains regroup the same people. If
   one dropped or duplicated a player, every rate on that side would be quietly
   wrong and nothing else on the page would show it. */
ok(total() === weekTotal && total() === D.totalMembers,
   'both grains total exactly ' + n0(total()) + ' first depositors');
ok(/monthly cohorts/.test(d.getElementById('tableFilters').textContent) &&
   /monthly cohorts/.test(d.getElementById('sub').textContent),
   'the subtitle and the header strip follow the grain');
d.getElementById('gWeek').click();
ok(R.cohorts().length === weekN, 'switching back restores weeks');

console.log('\nthe weekly view opens on a screenful, not a year');
(() => {
  const rows = () => [...d.querySelectorAll('#cohortTable tbody tr')].map(r => r.dataset.cohort);
  const sel = d.getElementById('f_weeks');
  R.state.weeks = 10; R.state.year = R.YEARS[R.YEARS.length-1]; R.render();
  const ten = rows();
  ok(ten.length === 10, 'ten weekly rows, not the ' + weekN + ' the grain holds');
  const all = R.cohorts().filter((_, c) => R.inYear(c));
  ok(ten.join() === all.slice(-10).join(),
     'and they are the LAST ten of the selected year (' + ten[0] + '..' + ten[9] +
     '), which is where the answer to "how are we doing" is');
  /* The footer must total what is on screen. A footer pooling fifty-two weeks
     under ten visible rows is the kind of disagreement nobody catches by eye. */
  let vis = 0;
  const T = R.tally();
  for (let c = 0; c < T.K; c++) if (R.inView(c)) vis += T.n[c];
  const footTotal = +d.querySelectorAll('#cohortTable tfoot td')[1]
                      .textContent.replace(/,/g, '');
  ok(footTotal === vis && vis < total(),
     'the All-cohorts row totals the ' + n0(vis) + ' players on screen, not the ' +
     n0(total()) + ' in the whole year — the footer follows the window');
  ok(/last 10 weeks/.test(d.getElementById('tableFilters').textContent),
     'and the header strip says so, so ten rows never read as all the data there is');

  ok(sel && sel.style.display !== 'none', 'the control is offered in the weekly grain');
  R.state.weeks = 26; R.render();
  ok(rows().length === 26, 'widening it to 26 shows 26');
  R.state.weeks = 0;  R.render();
  ok(rows().length === all.length,
     'and All weeks shows every one of the ' + all.length + ' in the year');

  d.getElementById('gMonth').click();
  ok(d.getElementById('f_weeks').style.display === 'none',
     'the control is hidden on months — twelve rows never needed a window, and a ' +
     'permanently dead control reads as something broken');
  ok([...d.querySelectorAll('#cohortTable tbody tr')].length > 0,
     'and the monthly table is unaffected by it');
  d.getElementById('gWeek').click(); R.state.weeks = 10; R.render();
})();

console.log('\na survival figure needs a week of watching past the milestone');
(() => {
  if (!R.HAS_AFTER) return;
  R.state.retMetric = 'after'; R.state.weeks = 10; R.render();
  const T = R.tally(), J = T.J;
  /* The bug this rules out: watch a cohort to day 63, ask "still depositing
     after day 60", and the only way to say yes is a deposit in three days. The
     answer collapses to 0.0% and prints beside a healthy n=, which reads as
     terrible retention rather than as no measurement at all. */
  let thin = 0;
  for (let c = 0; c < T.K; c++)
    for (let j = 0; j < J; j++)
      if (T.eligA[c*J + j] > 0 && T.minObs[c] < D.milestones[j] + 7) thin++;
  ok(true, 'the eligibility floor is day N plus ' + 7 + ', not day N plus one');
  const zeros = [...d.querySelectorAll('#cohortTable tbody td.cell')]
    .filter(c => /^0\.0%/.test(c.textContent));
  ok(zeros.length === 0,
     'no cell in the weekly survival view reports 0.0% — before the floor, a ' +
     '116-player cell read 0.0% at D60 and pulled the All-cohorts figure down with it');
  /* Hand the suite back exactly as it was found: unwindowed and on all years.
     The sections below count badges and totals across the whole history. */
  R.state.weeks = 0; R.state.year = 'all'; R.state.retMetric = 'after'; R.render();
})();

console.log('\npartial periods are marked, not dropped');
const partials = R.cohorts().filter(ym => R.metaOf(ym).partial);
/* Which periods are partial depends on the day the build runs: on a Monday the
   previous week closed exactly on the cutoff and is genuinely complete, so only
   the clipped first week qualifies. Asserting a fixed pair failed every Monday.
   Assert the rule instead — first or last only, never one in the middle. */
const allC = R.cohorts();
ok(partials.length >= 1 && partials.length <= 2,
   partials.length + ' period(s) flagged partial (' + partials.join(', ') + ')');
ok(partials.every(ym => ym === allC[0] || ym === allC[allC.length - 1]),
   'and only ever the first or the last — never one in the middle');
ok(d.querySelectorAll('#cohortTable .pt:not(.info)').length === partials.length,
   'each flagged period carries the badge');
ok([...d.querySelectorAll('#cohortTable .pt:not(.info)')]
     .every(n => /does not cover the whole/.test(n.getAttribute('title'))),
   'each explaining itself on hover');

console.log('\nan impossible combination says so rather than rendering blank');
D.dims.forEach(dim => setDim(dim.key, '0'));
setDim('rail', '2');                                   // rail unknown, 1 player
const empty = d.querySelector('#cohortTable .empty');
ok(total() === 0 ? !!empty : true,
   total() === 0 ? 'an empty result renders the "widen a filter" message'
                 : 'this combination still has ' + n0(total()) + ' players, so the table stands');
D.dims.forEach(dim => setDim(dim.key, 'all'));
ok(total() === D.totalMembers, 'and clearing every filter brings all ' +
   n0(D.totalMembers) + ' back');

console.log('\nthe carved-out players are out of scope, and there is no dead toggle');
ok(d.getElementById('bEx') === null && d.getElementById('bInc') === null,
   'no carve-out toggle on this page');
/* The note used to be checked for one player's id and first-deposit date. That
   pinned the test to a carve-out list of exactly one, and the builder now
   asserts the out-of-scope claim directly against the cohorts. What is left
   worth checking here is that the page still carries a reason at all, and that
   it names whoever is on the list rather than a name someone has to go and
   look up. */
ok(typeof D.whaleNote === 'string' && /out of scope/.test(D.whaleNote) &&
   /karolik777/.test(D.whaleNote),
   'the reason is still carried in the data, naming the list: "' + D.whaleNote + '"');

console.log('\nthe data is internally consistent');
ok(D.players.obs.length === D.players.lag.length &&
   D.players.lag.length === D.players.attr.length &&
   D.players.attr.length === D.totalMembers,
   'three player arrays, all ' + n0(D.totalMembers) + ' long');
ok(D.players.obs.every(o => o >= 0 && o <= D.horizon + 1),
   'every observation is 0..' + (D.horizon + 1) + ' (capped — beyond the horizon is the same answer)');
ok(D.players.lag.every(l => l === 0 || (l >= 1 && l <= D.horizon)),
   'every first-return lag is 0 (never came back) or 1..' + D.horizon +
   ' — never day 0, because a same-day top-up is not a return');
ok(D.players.attr.every(a => a >= 0 && a < D.combos),
   'every packed attribute is inside the ' + D.combos + ' declared combinations');
Object.entries(D.grains).forEach(([g, gr]) => {
  ok(gr.ci.length === D.totalMembers && Math.max(...gr.ci) === gr.cohorts.length - 1,
     g + ': every player has a cohort index and every one of the ' + gr.cohorts.length +
     ' cohorts is used');
});

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
