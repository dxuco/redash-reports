/**
 * Renders the built retention-full.html in a headless DOM and reads it back.
 *
 *   npm install jsdom
 *   node retention-full/test_retention_full.js
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

/* This page is no longer built — retention.html is the retention page and holds
   /retention. The builder, template and this suite stay on disk so it can be
   revived; until then there is nothing to render, and saying so beats a stack
   trace about a missing file. */
const PAGE = path.join(__dirname, '..', 'retention-full.html');
if (!fs.existsSync(PAGE)){
  console.log('retention-full.html is not built (the page is retired) - nothing to test.');
  console.log('Run retention-full\\build_retention_full.py and make_retention_full_html.py to revive it.');
  process.exit(0);
}
const html = fs.readFileSync(PAGE, 'utf8');

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
  rows:   d.querySelectorAll('#cohortTable tbody tr').length,
  sel:    Object.assign({}, R.state.sel),
  weeks:  R.state.weeks,
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
const total = () => { const T = R.tally(); let s = 0; for (let c = 0; c < T.K; c++) s += T.n[c]; return s; };

console.log('\nit renders at all');
ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));
ok(!!R, 'the page hands itself over on window.RET');
ok(d.querySelectorAll('.card').length === 1, 'one card — the cohort table and nothing else');
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

/* Captured above, then switched off for the rest of the file — the sections
   below read tables expecting every cohort in them. The window has its own
   section further down, which turns it back on. */
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
ok(DEFAULTS.emptyRows === 0,
   'every cohort row has figures on load — nothing is withheld by the default');
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
/* A column can pool zero cohorts and print a bare dash with no base to name.
   What must hold is that every cell carrying a FIGURE names its base. */
const footCells = [...d.querySelectorAll('#cohortTable tfoot td')].slice(2);
const footFigs = footCells.filter(c => c.textContent.trim() !== '\u2014');
ok(footFigs.length > 0 && footFigs.every(c => /across \d+ weeks?/.test(c.getAttribute('title') || '')),
   'and each of the ' + footFigs.length + ' footer figures names its own base on hover: "' +
   footFigs[footFigs.length-1].getAttribute('title').slice(0, 56) + '..."');

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
ok(D.dims.every(dim => dimControl(dim.key) !== 'MISSING'), 'each has its own control');
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
['kyc','email','phone','blk','blkr'].forEach(k => {
  const present = D.dims.some(x => x.key === k);
  ok(present && dimControl(k) !== 'MISSING',
     k + ' is present with its control — the database carries it for every player');
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

console.log('\nthe "after day N" measure');
ok(R.HAS_AFTER === false && d.getElementById('mBy') === null,
   'this build carries no last-return data (query 1758 returns the first return only), '+
   'so the measure switch is absent rather than dead — it appears by itself once the '+
   'query and builder emit players.last');

console.log('\nthe grain switch');
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

console.log('\nthe weekly view opens on a screenful, not a decade');
(() => {
  d.getElementById('gWeek').click();
  const rows = () => [...d.querySelectorAll('#cohortTable tbody tr')].map(r => r.dataset.cohort);
  R.state.year = R.YEARS[R.YEARS.length-1]; R.state.weeks = 10; R.render();
  const ten = rows(), all = R.cohorts().filter((_, c) => R.inYear(c));
  ok(ten.length === 10, 'ten weekly rows, not the ' + all.length + ' in the year (of ' +
     weekN + ' in the base)');
  ok(ten.join() === all.slice(-10).join(),
     'and they are the LAST ten (' + ten[0] + '..' + ten[9] + ')');
  let vis = 0; const T = R.tally();
  for (let c = 0; c < T.K; c++) if (R.inView(c)) vis += T.n[c];
  const footTotal = +d.querySelectorAll('#cohortTable tfoot td')[1].textContent.replace(/,/g,'');
  ok(footTotal === vis,
     'the All-cohorts row totals the ' + n0(vis) + ' on screen — the footer follows the ' +
     'window rather than pooling rows nobody can see');
  ok(/last 10 weeks/.test(d.getElementById('tableFilters').textContent),
     'and the header strip says so, so ten rows never read as all the data there is');
  R.state.weeks = 26; R.render(); ok(rows().length === 26, 'widening it to 26 shows 26');
  R.state.weeks = 0;  R.render();
  ok(rows().length === all.length, 'and All weeks shows every one of the ' + all.length);
  d.getElementById('gMonth').click();
  ok(d.getElementById('f_weeks').style.display === 'none',
     'the control is hidden on months — a permanently dead control reads as broken');
  d.getElementById('gWeek').click();
  R.state.year = 'all'; R.state.weeks = 0; R.render();   // hand the suite back as found
})();
d.getElementById('gWeek').click();
ok(R.cohorts().length === weekN, 'switching back restores weeks');

console.log('\npartial periods are marked, not dropped');
/* `partial` means the cohort's own calendar period is not whole: the first
   period when 2019-01 lands inside it, the last when today does. It is NOT a
   maturity flag — an earlier version marked the trailing thirteen weeks partial
   because their members were under 90 days old, which is a different and far
   less useful claim, and the maturity toggle already governs that.

   Which periods qualify depends on what day the build runs, so assert the rule
   rather than a fixed pair: today is a Monday, so last week closed exactly on
   the cutoff and is genuinely complete. */
const all = R.cohorts();
const partials = all.filter(ym => R.metaOf(ym).partial);
ok(partials.length >= 1 && partials.length <= 2,
   partials.length + ' period(s) flagged partial (' + partials.join(', ') + ')');
ok(partials.every(ym => ym === all[0] || ym === all[all.length - 1]),
   'and only ever the first or the last — never one in the middle');
ok(!all.slice(1, -1).some(ym => R.metaOf(ym).partial),
   'no interior period is partial, so this is not a maturity flag in disguise');
ok(d.querySelectorAll('#cohortTable .pt:not(.info)').length === partials.length,
   'each flagged period carries the badge');
ok([...d.querySelectorAll('#cohortTable .pt:not(.info)')]
     .every(n => /does not cover the whole/.test(n.getAttribute('title'))),
   'each explaining itself on hover');

console.log('\nan impossible combination says so rather than rendering blank');
D.dims.forEach(dim => setDim(dim.key, '0'));
const rare = D.dims.find(x => x.key === 'blkr');
setDim('blkr', String(rare.card - 1));                 // the rarest block reason
const empty = d.querySelector('#cohortTable .empty');
ok(total() === 0 ? !!empty : true,
   total() === 0 ? 'an empty result renders the "widen a filter" message'
                 : 'this combination still has ' + n0(total()) + ' players, so the table stands');
D.dims.forEach(dim => setDim(dim.key, 'all'));
ok(total() === D.totalMembers, 'and clearing every filter brings all ' +
   n0(D.totalMembers) + ' back');

/* Cohort meta must carry label/short/start/end, not only partial. The
   template's fallback fires when the whole entry is MISSING, so an entry that
   exists but is short of these keys draws every row as "undefined" — and every
   count-based assertion above still passes. It shipped that way once. */
console.log('\nevery row is labelled');
{
  const labels = [...d.querySelectorAll('#cohortTable tbody tr')]
    .map(tr => tr.children[0].textContent.trim());
  ok(labels.length > 0 && !labels.some(t => /undefined/.test(t)),
     'no cohort row renders "undefined" (' + labels.slice(0, 2).join(', ') + ' ...)');
  const need = ['label', 'short', 'start', 'end', 'partial'];
  ['month', 'week'].forEach(g => {
    const m = D.grains[g].meta, k = Object.keys(m)[0];
    ok(need.every(f => m[k][f] !== undefined),
       g + ' meta carries ' + need.join('/') + ' — the template reads all five');
  });
  ok(/^\d{4}-\d{2}-\d{2}$/.test(D.grains.month.meta['2019-01'].end),
     'and end is a real date, which the freshness check reads');
}

/* Cohort sizes against the figures published elsewhere in the business.
   The first build of query 1758 omitted the three joins that 1732 uses to drop
   staff, streamers and excluded transactions, and ran 4-9 players a month high
   — small enough to look like nothing and wrong enough to disagree with every
   other report. These are the published 2026 counts; they must match exactly.

   The current month is expected to be SHORT, not equal: a player who first
   deposited yesterday has had no opportunity to return, so they are out of
   scope until they have a day of observation. */
console.log('\ncohort sizes reconcile with the published figures');
{
  const published = {'2026-01':447,'2026-02':388,'2026-03':675,'2026-04':833,
                     '2026-05':1286,'2026-06':1171,'2026-07':1683};
  const g = D.grains.month, size = {};
  g.ci.forEach(c => { const k = g.cohorts[c]; size[k] = (size[k]||0)+1; });
  const bad = Object.keys(published).filter(k => size[k] !== published[k]);
  ok(bad.length === 0,
     bad.length === 0
       ? 'all ' + Object.keys(published).length + ' complete 2026 cohorts match to the player'
       : 'MISMATCH on ' + bad.map(k => k+': '+size[k]+' vs '+published[k]).join(', ') +
         ' — has the staff/streamer exclusion been dropped from query 1758?');
  const last = g.cohorts[g.cohorts.length-1];
  ok(g.meta[last].partial === 1,
     'the newest cohort (' + last + ', ' + n0(size[last]) + ') is flagged partial — ' +
     'it is short on purpose, because the last days of it have not been observed yet');
}

console.log('\nthe whole base, and where it honestly stops');
ok(D.cohortFrom === '2019-01', 'cohorts start 2019-01');
ok(D.grains.month.cohorts[0] === '2019-01', 'and the first monthly cohort is 2019-01');
ok(!D.grains.month.cohorts.some(c => c < '2019-01'),
   'nothing earlier is offered, however tempting');
ok(/2018-05-23/.test(D.truncationNote),
   'and the page carries the reason: ' + D.truncationNote.slice(0, 60) + '...');
ok(D.totalMembers > 80000,
   n0(D.totalMembers) + ' players — against ~19k on the cache-built page');
ok(D.grains.month.cohorts.length > 80,
   D.grains.month.cohorts.length + ' monthly cohorts, ~8 years');
ok(/query 1758/.test(D.source), 'provenance names the query: ' + D.source);

/* Blocked is deliberately two things. If a later edit folds the bulk dormant
   sweep in with bonus_abuse, the deliberate blocks vanish into it and the
   filter stops meaning anything. */
{
  const blk = D.dims.find(x => x.key === 'blk');
  ok(blk.card === 3, 'the block dimension has three states, not two');
  const labels = blk.opts.map(o => o[1]).join(' | ');
  ok(/Dormant/.test(labels) && /deliberate/i.test(labels),
     'dormant is separated from a real block: ' + labels);
  setDim('blk', '1'); const dormant = total();
  setDim('blk', '2'); const real = total();
  setDim('blk', 'all');
  ok(dormant > real * 10,
     'the dormant sweep (' + n0(dormant) + ') dwarfs deliberate blocks (' + n0(real) +
     ') — which is exactly why they are not one filter');
}

console.log('\nthe carved-out players need no toggle here, and the page says why');
ok(d.getElementById('bEx') === null && d.getElementById('bInc') === null,
   'no carve-out toggle on this page');
/* Unlike the other pages, this one's cohorts reach back to 2019, so the carved
   out players ARE in scope — the argument for having no toggle is that this
   page counts players rather than dollars. Check the note still makes that
   argument and still names whoever is on the list, rather than pinning one
   player's id and first-deposit date as it used to. */
ok(typeof D.whaleNote === 'string' && /counts players, not dollars/.test(D.whaleNote) &&
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
