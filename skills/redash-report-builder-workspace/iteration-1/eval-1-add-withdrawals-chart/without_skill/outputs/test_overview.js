/* Renders the built business-overview.html in a headless DOM and reads the page
   back out. A chart that renders empty, or a script that dies halfway, is not
   something the aggregation checks can see — this is the check that the page
   itself works.

   node test_overview.js          (needs: npm install jsdom)
*/
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.join(__dirname, '..', 'business-overview.html');
const html = fs.readFileSync(FILE, 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
dom.virtualConsole.on('jsdomError', e => errors.push(e.message));
const { window } = dom;
const d = window.document;
const OV = window.OV;

console.log('page');
ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));
ok(!/^\s*$/.test(d.getElementById('sub').textContent), 'subtitle filled');
ok(d.querySelectorAll('.card').length === 7, 'seven chart cards');

console.log('\ndefaults on load');
ok(OV.state.gran === 'month', 'opens in the months view');
ok(OV.state.mtd === true, 'opens with MTD on');
// state and markup must agree, or the buttons render lying about the view
ok(d.getElementById('bMonth').getAttribute('aria-pressed') === 'true', 'Months shows as pressed');
ok(d.getElementById('bMtd').getAttribute('aria-pressed') === 'true', 'MTD shows as pressed');
ok(d.getElementById('bDay').getAttribute('aria-pressed') === 'false', 'Days shows as unpressed');
ok(d.getElementById('bFull').getAttribute('aria-pressed') === 'false', 'Whole months shows as unpressed');
ok(d.getElementById('chartMoney').querySelectorAll('.hit').length === OV.DATA.order.length,
   'and draws all ' + OV.DATA.order.length + ' months before anything is clicked');

// everything below is written against the daily view
OV.setGran('day');
d.getElementById('bFull').click();

// only the players chart carries an overlay line; the amount charts are bars
// alone since the running total was dropped
const LINES = { chartPlayers: 1, chartMoney: 0, chartBet: 0, chartGgr: 0, chartNgr: 0, chartAdj: 0 };
for (const id of ['chartPlayers', 'chartMoney', 'chartBet', 'chartGgr', 'chartNgr', 'chartAdj']) {
  console.log('\n' + id);
  const svg = d.getElementById(id);
  ok(svg.querySelectorAll('rect[fill^="#"]').length > 15, 'stacked bars drawn (' +
     svg.querySelectorAll('rect[fill^="#"]').length + ' segments)');
  ok(svg.querySelectorAll('.depline').length === LINES[id],
     LINES[id] ? 'overlay line drawn' : 'no overlay line');
  ok(svg.querySelectorAll('.hit').length === OV.win(OV.state.ym).days.length,
     'one hover band per day');
  // every axis labels its zero — the house rule
  const left = [...svg.querySelectorAll('text[text-anchor="end"]')].map(t => t.textContent);
  ok(left.includes('0') || left.includes('$0'), 'left axis labels its zero');
}

console.log('\nMTD filter');
d.getElementById('bMtd').click();
ok(d.getElementById('bMtd').getAttribute('aria-pressed') === 'true', 'MTD button takes the pressed state');
const widths = OV.DATA.order.map(ym => { OV.state.ym = ym; return OV.win(ym).n; });
ok(new Set(widths).size === 1, 'MTD trims every month to the same width (' + widths[0] + ' days)');

OV.state.ym = '2026-07';
const julMtd = OV.win('2026-07').distDep;
d.getElementById('bFull').click();
const julFull = OV.win('2026-07').distDep;
ok(julFull > julMtd, 'July full month (' + julFull + ') exceeds its MTD window (' + julMtd + ')');

console.log('\ndistinct counting');
OV.state.ym = '2026-08';
OV.render();
const w = OV.win('2026-08');
const rowSum = w.cats.reduce((s, c) => s + w.distCat(c), 0);
ok(rowSum > w.distBet, 'category rows (' + rowSum + ') exceed distinct bettors (' + w.distBet +
   ') — multi-category players counted once in the total');
const daySum = w.depositors.reduce((a, b) => a + b, 0);
ok(daySum > w.distDep, 'daily depositor bars (' + daySum + ') exceed distinct depositors (' +
   w.distDep + ') — repeat depositors counted once');

console.log('\ncrypto / fiat');
// the rail split must account for every deposited dollar, or the money chart is
// quietly dropping a rail
const railTotal = w.rails.reduce((s, r) => s + w.railAmt(r).reduce((a, b) => a + b, 0), 0);
const depTotal = w.depAmount.reduce((a, b) => a + b, 0);
ok(Math.abs(railTotal - depTotal) < 1,
   'rails reconcile to total deposits ($' + Math.round(railTotal).toLocaleString('en-US') + ')');
ok(w.rails.includes('crypto') && w.rails.includes('fiat'), 'both rails present');
ok(OV.moneyChart(w).line === null, 'deposits chart has no running-total line');

console.log('\nbet amounts');
const betChart = OV.betChart(w);
ok(betChart.line === null, 'bet chart has no running-total line');
const betTotal = betChart.stacks.reduce((s, st) => s + st.values.reduce((a, b) => a + b, 0), 0);
ok(betTotal > 0, 'bet dollars present ($' + Math.round(betTotal).toLocaleString('en-US') + ')');
// the stack must carry every category the players chart shows a bettor for,
// or a category is silently missing its turnover
ok(w.cats.every(c => w.betCats.includes(c)),
   'every category with bettors also has bet dollars');
// bet dollars per category must reconcile against the raw per-day arrays
const recomputed = w.betCats.reduce((s, c) => s + w.catBet(c).reduce((a, b) => a + b, 0), 0);
ok(Math.abs(recomputed - betTotal) < 1, 'stacks reconcile to the category totals');
const uncatBet = w.uncatBet.reduce((a, b) => a + b, 0);
ok(Math.abs(betTotal + uncatBet - w.dayBet.reduce((a, b) => a + b, 0))
     <= (w.n * (w.betCats.length + 2)) * 0.005,
   'category bet + uncategorised = day totals, within the rounding budget');

console.log('\nGGR');
const ggr = OV.ggrChart(w);
const ggrTotal = ggr.stacks.reduce((s, st) => s + st.values.reduce((a, b) => a + b, 0), 0);
// exact, not a tolerance: category GGR plus the uncategorised residue must be
// the day total to the cent, or something is being dropped on the floor
const uncatGgr = w.uncatGgr.reduce((a, b) => a + b, 0);
const dayGgrTotal = w.dayGgr.reduce((a, b) => a + b, 0);
// The builder rounds each emitted value to 2dp, so the two sides can differ by
// at most half a cent per rounded value — anything beyond that budget is a
// dropped row, not rounding.
const roundingBudget = (w.n * (w.betCats.length + 2)) * 0.005;
ok(Math.abs(ggrTotal + uncatGgr - dayGgrTotal) <= roundingBudget,
   'category GGR + uncategorised = day totals, within the rounding budget ($' +
   Math.abs(ggrTotal + uncatGgr - dayGgrTotal).toFixed(2) + ' of $' + roundingBudget.toFixed(2) + ')');
ok(Math.abs(uncatGgr) < Math.abs(dayGgrTotal) * 0.005,
   'the uncategorised residue is immaterial (' +
   (Math.abs(uncatGgr) / Math.abs(dayGgrTotal) * 100).toFixed(4) + '% of GGR)');
// negative GGR must survive as negative, and must be drawn below the zero rule
const hasNeg = ggr.stacks.some(st => st.values.some(v => v < 0));
ok(hasNeg, 'negative GGR segments present in the data');
const ggrSvg = d.getElementById('chartGgr');
const zeroRule = [...ggrSvg.querySelectorAll('line')].filter(l => l.getAttribute('stroke') === '#5B7285');
ok(zeroRule.length === 1, 'exactly one darker zero rule drawn');
const zeroY = parseFloat(zeroRule[0].getAttribute('y1'));
const bars = [...ggrSvg.querySelectorAll('rect[fill^="#"]')];
ok(bars.some(r => parseFloat(r.getAttribute('y')) + parseFloat(r.getAttribute('height')) > zeroY + 0.5),
   'some GGR bars extend below the zero rule');
ok(bars.some(r => parseFloat(r.getAttribute('y')) < zeroY - 0.5), 'and some above it');
// the sign belongs before the currency symbol
ok(OV.money(-5000) === '-$5,000', 'negative money formats as -$5,000 (got ' + OV.money(-5000) + ')');
ok(OV.moneyShort(-1500) === '-$2k' || OV.moneyShort(-1500) === '-$1k',
   'negative axis money keeps the sign first (' + OV.moneyShort(-1500) + ')');

console.log('\nNGR');
const ngr = OV.ngrChart(w);
const ngrSum = ngr.stacks.reduce((s, st) => s + st.values.reduce((a, b) => a + b, 0), 0);
ok(Math.abs(ngrSum - w.dayNgr.reduce((a, b) => a + b, 0)) <= (w.n * (w.betCats.length + 3)) * 0.005,
   'NGR stacks reconcile to the day totals ($' + Math.round(ngrSum).toLocaleString('en-US') + ')');
// the uncategorised bonus band is material for NGR and must be on the chart --
// unlike GGR, where it is $24 and legitimately invisible
const uncatNgr = w.uncatNgr.reduce((a, b) => a + b, 0);
ok(Math.abs(uncatNgr) > Math.abs(ngrSum) * 0.005,
   'the bonus band is material (' + (uncatNgr / ngrSum * 100).toFixed(1) + '% of NGR)');
ok(ngr.stacks.some(st => st.key === '__uncat'), 'and is drawn as its own band');
ok(uncatNgr < 0, 'it is negative, as bonus deductions should be');
// NGR must sit below GGR: bonus only ever takes away
ok(ngrSum < w.dayGgr.reduce((a, b) => a + b, 0), 'NGR is below GGR');
ok(d.getElementById('chartNgr').querySelectorAll('rect[fill="#B7C3CF"]').length > 0,
   'the grey bonus band renders');

console.log('\nadjusted GGR');
const adj = OV.adjChart(w);
ok(adj.stacks.length === 1, 'a single series — adjusted GGR is not split by category');
const adjSum = adj.stacks[0].values.reduce((a, b) => a + b, 0);
ok(Math.abs(adjSum - w.dayAdj.reduce((a, b) => a + b, 0)) < 0.01, 'chart reads the day totals');
ok(adjSum !== 0, 'adjusted GGR present ($' + Math.round(adjSum).toLocaleString('en-US') + ')');
// adjusted GGR is NOT raw ggr minus bonus cost — asserting the difference keeps
// anyone from "fixing" the builder to compute it that way
const derived = w.dayGgr.reduce((a, b) => a + b, 0) - w.dayBonus.reduce((a, b) => a + b, 0);
ok(Math.abs(derived - adjSum) > 1,
   'and is not raw GGR minus bonus cost ($' + Math.round(derived).toLocaleString('en-US') +
   ' vs $' + Math.round(adjSum).toLocaleString('en-US') + ')');
ok(d.querySelectorAll('#legAdj .lg').length === 1, 'one legend chip');

console.log('\nhouse edge');
const he = OV.heChart(w);
const heSvg = d.getElementById('chartHe');
ok(heSvg.querySelectorAll('.heline').length >= w.betCats.length,
   'a line per category plus the total (' + heSvg.querySelectorAll('.heline').length + ')');
// White label plates are rects too, so the check is for series-coloured rects:
// a bar in any category colour would mean someone stacked the ratios.
const seriesColours = new Set(Object.values(OV.COLOR).concat([OV.LINE_COLOR]));
const colouredRects = [...heSvg.querySelectorAll('rect[fill^="#"]')]
  .filter(r => seriesColours.has(r.getAttribute('fill')));
ok(colouredRects.length === 0, 'no bars — ratios are not stacked');
// the total must be the weighted ratio, never the mean of the category lines
const wBet = w.dayBet.reduce((a, b) => a + b, 0);
const wGgr = w.dayGgr.reduce((a, b) => a + b, 0);
const weighted = wGgr / wBet * 100;
const catHes = w.betCats.map(c => {
  const b = w.catBet(c).reduce((a, x) => a + x, 0);
  return w.catGgr(c).reduce((a, x) => a + x, 0) / b * 100;
});
const naiveMean = catHes.reduce((a, b) => a + b, 0) / catHes.length;
ok(Math.abs(weighted - naiveMean) > 0.1,
   'weighted total (' + weighted.toFixed(2) + '%) differs from the naive mean (' +
   naiveMean.toFixed(2) + '%) — so a mean would be wrong here');
ok(he.series[0].key === '__total' && he.series[0].legendValue === OV.pct1(weighted),
   'total line reports the weighted figure (' + he.series[0].legendValue + ')');
// category ggr and bet must reconcile to the day totals
const catBetSum = w.betCats.reduce((s, c) => s + w.catBet(c).reduce((a, b) => a + b, 0), 0);
ok(Math.abs(catBetSum - wBet) / wBet < 0.001,
   'category bet reconciles to the day totals (within 0.1%)');
// a negative house edge is real and must survive to the chart
const anyNegative = he.series.some(s => s.values.some(v => v !== null && v < 0));
ok(anyNegative, 'negative days are kept, not clamped to zero');
ok(he.series.every(s => s.values.every(v => v === null || isFinite(v))),
   'no NaN or Infinity from a zero-bet day');

console.log('\nwhale toggle');
// the page must open with the whale out, or the daily bars read as one player
ok(OV.state.inclWhale === false, 'page opens with ' + OV.DATA.whale + ' excluded');
const exPerDay = w.depAmount.reduce((a, b) => a + b, 0) / w.n;
ok(exPerDay > 60000 && exPerDay < 200000,
   'ex-whale deposits sit in the real daily range ($' +
   Math.round(exPerDay).toLocaleString('en-US') + '/day)');
d.getElementById('bInc').click();
const incW = OV.win('2026-08');
const incPerDay = incW.depAmount.reduce((a, b) => a + b, 0) / incW.n;
ok(incPerDay > exPerDay * 2, 'including him multiplies the daily figure (' +
   Math.round(incPerDay / exPerDay * 10) / 10 + 'x)');
ok(incW.distDep === w.distDep + 1, 'and adds exactly one distinct depositor');
d.getElementById('bEx').click();
ok(OV.win('2026-08').distDep === w.distDep, 'toggling back restores the excluded view');

console.log('\nvalue labels');
// jsdom reports clientWidth 0, so the chart falls back to its 1200px default —
// wide enough that labels must be drawn
{
  const money = d.getElementById('chartMoney');
  const texts = [...money.querySelectorAll('text')].map(t => t.textContent);
  const dayTotals = texts.filter(t => /^\$[\d.,]+k?M?$/.test(t));
  ok(dayTotals.length >= w.n, 'deposit bars carry day totals (' + dayTotals.length + ' money labels)');
  const white = money.querySelectorAll('text[fill="#FFFFFF"]');
  ok(white.length > 0, 'segment values drawn inside the bars (' + white.length + ')');
  // a label must never be drawn above the plot area
  const above = [...money.querySelectorAll('text')].filter(t => parseFloat(t.getAttribute('y')) < 0);
  ok(above.length === 0, 'no label clipped off the top');
}
{
  // the players chart deliberately has no bar-top total: the stack double-counts
  const players = d.getElementById('chartPlayers');
  ok(players.querySelectorAll('rect[fill="#FFFFFF"][fill-opacity=".88"]').length === w.n,
     'depositor line points are labelled');
}
{
  const he = d.getElementById('chartHe');
  const pcts = [...he.querySelectorAll('text')].filter(t => /%$/.test(t.textContent));
  ok(pcts.length > w.n, 'house edge total line is labelled alongside the axis');
}

console.log('\nheadline totals');
OV.render();
for (const id of ['totPlayers', 'totMoney', 'totBet', 'totGgr', 'totNgr', 'totAdj', 'totHe']) {
  const strip = d.getElementById(id);
  ok(strip && strip.children.length >= 4, id + ' has its figures (' +
     (strip ? strip.children.length : 0) + ')');
}
// the headline must move with the filters, or it reads as a bug next to a
// filtered chart
const depBefore = d.querySelector('#totMoney .t .v').textContent;
d.getElementById('bInc').click();
const depAfter = d.querySelector('#totMoney .t .v').textContent;
ok(depBefore !== depAfter, 'deposit headline responds to the whale toggle (' +
   depBefore + ' -> ' + depAfter + ')');
d.getElementById('bEx').click();
ok(d.querySelector('#totMoney .t .v').textContent === depBefore, 'and returns on the way back');
const mtdBefore = d.querySelector('#totBet .t .v').textContent;
d.getElementById('bMtd').click();
OV.state.ym = '2026-07'; OV.render();
ok(d.querySelector('#totBet .t .v').textContent !== mtdBefore, 'bet headline follows month and MTD');
OV.state.ym = '2026-08'; d.getElementById('bFull').click();

console.log('\nmonths view');
OV.setGran('month');
const M = OV.currentWindow();
ok(M.n === OV.DATA.order.length, 'one point per month on file (' + M.n + ')');
ok(M.labelAt(0) === "Jan '25" && M.labelAt(M.n - 1) === "Aug '26",
   'axis runs ' + M.labelAt(0) + ' to ' + M.labelAt(M.n - 1) + ' across both years');
ok(d.getElementById('month').disabled, 'the single-month picker is disabled');
ok(/by month/.test(d.querySelector('.chead h2').textContent), 'headings say month');

// the headline distinct must come from the builder's cross-month union, never
// the sum of the monthly bars
const monthlySum = M.depositors.reduce((a, b) => a + b, 0);
ok(M.distDep < monthlySum * 0.8,
   'range distinct (' + M.distDep.toLocaleString() + ') is well below the sum of monthly distincts (' +
   monthlySum.toLocaleString() + ') — returning players counted once');
ok(M.distDep === OV.DATA.range[OV.state.inclWhale ? 'inc' : 'ex'].full.dep,
   'and is read from the builder, not derived');

// money is additive, so the months view must equal the sum of every daily view
let dayByDay = 0;
OV.DATA.order.forEach(ym => { dayByDay += OV.DATA.months[ym].ex.depAmount.reduce((a, b) => a + b, 0); });
const monthsTotal = M.depAmount.reduce((a, b) => a + b, 0);
ok(Math.abs(monthsTotal - dayByDay) < 1,
   'deposits reconcile against the daily views ($' + Math.round(monthsTotal).toLocaleString('en-US') + ')');

// MTD must still trim, in months mode too
d.getElementById('bMtd').click();
const mtdTotal = OV.currentWindow().depAmount.reduce((a, b) => a + b, 0);
ok(mtdTotal < monthsTotal, 'MTD trims every month to ' + OV.MTD_DAYS + ' days ($' +
   Math.round(mtdTotal).toLocaleString('en-US') + ')');
ok(OV.currentWindow().distDep === OV.DATA.range.ex.mtd.dep, 'and swaps to the MTD range distinct');
d.getElementById('bFull').click();

// every chart must survive the switch
for (const id of ['chartPlayers', 'chartMoney', 'chartBet', 'chartGgr', 'chartNgr', 'chartAdj', 'chartHe']) {
  ok(d.getElementById(id).querySelectorAll('.hit').length === M.n, id + ' redrew at month grain');
}
OV.setGran('day');
ok(!d.getElementById('month').disabled, 'switching back re-enables the month picker');
ok(OV.currentWindow().n === 21, 'and returns to the daily window');

console.log('\nlegend');
OV.render();
const chips = d.querySelectorAll('#legPlayers .lg');
ok(chips.length === w.cats.length + 1, 'a chip per category plus the depositor line');
const moneyChips = d.querySelectorAll('#legMoney .lg');
ok(moneyChips.length === w.rails.length, 'a chip per rail, nothing else');
ok(d.querySelectorAll('#legBet .lg').length === w.betCats.length, 'a chip per bet category');
// a plain click isolates rather than hides
[...moneyChips].find(c => c.dataset.cat === 'fiat').click();
let shown = [...d.querySelectorAll('#chartMoney rect[fill^="#"]')].map(r => r.getAttribute('fill'));
ok(shown.includes(OV.COLOR.fiat), 'clicking fiat keeps fiat');
ok(!shown.includes(OV.COLOR.crypto), 'and drops everything else');
ok(d.querySelector('#legMoney .showall'), 'a Show all chip appears');

// clicking the isolated series again restores the rest
d.querySelector('#legMoney .lg[data-cat="fiat"]').click();
shown = [...d.querySelectorAll('#chartMoney rect[fill^="#"]')].map(r => r.getAttribute('fill'));
ok(shown.includes(OV.COLOR.crypto) && shown.includes(OV.COLOR.fiat), 'clicking it again brings all back');
ok(!d.querySelector('#legMoney .showall'), 'and the Show all chip goes away');

// alt-click still hides one
const alt = new dom.window.MouseEvent('click', { altKey: true, bubbles: true });
d.querySelector('#legMoney .lg[data-cat="fiat"]').dispatchEvent(alt);
shown = [...d.querySelectorAll('#chartMoney rect[fill^="#"]')].map(r => r.getAttribute('fill'));
ok(!shown.includes(OV.COLOR.fiat) && shown.includes(OV.COLOR.crypto), 'alt-click hides just that one');
d.querySelector('#legMoney .showall').click();
shown = [...d.querySelectorAll('#chartMoney rect[fill^="#"]')].map(r => r.getAttribute('fill'));
ok(shown.includes(OV.COLOR.fiat), 'Show all restores it');

// bars are clickable too. The handler resolves which segment was clicked from
// the pointer's y position against the SVG's on-screen box — jsdom reports a
// zero-height box, so the geometry itself cannot be exercised here; what is
// checked is that the handler is wired and the affordance is on the element.
{
  const hit = d.querySelector('#chartMoney .hit');
  ok(typeof hit.onclick === 'function', 'bar columns carry a click handler');
  ok(/cursor:\s*pointer/.test(hit.getAttribute('style') || ''), 'and show a pointer cursor');
}

// isolation is per chart, not global
d.querySelector('#legBet .lg[data-cat="casino"]').click();
ok(OV.state.off.bet.size > 0 && OV.state.off.money.size === 0,
   'isolating on the bet chart leaves the deposits chart alone');
d.querySelector('#legBet .showall').click();

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
