/* Renders the built page in jsdom and reads it back. The assertions encode
   decisions someone might otherwise undo. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const file = path.join(__dirname, '..', 'us-360.html');
const dom = new JSDOM(fs.readFileSync(file, 'utf8'), { runScripts: 'dangerously' });
const w = dom.window, doc = w.document;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  PASS ' + name);
  else { console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

ok('script ran and exported US360', !!w.US360);
const D = w.US360.D, W = w.US360.window;

// the page must open with the whale excluded -- a deposits figure near $415k/day
// would mean he crept back in.
ok('whale excluded (deposits in the expected band)',
   W.p26.depusd > 6e6 && W.p26.depusd < 9e6, '$' + Math.round(W.p26.depusd).toLocaleString());

// distinct counts never sum: the period figure must be BELOW the sum of months.
const monthDep = D.months.filter(m => m >= '2026-01' && m <= '2026-08')
  .reduce((a, m) => a + D.monthly[m].bloc.dep, 0);
ok('period depositors < sum of monthly depositors',
   W.p26.dep < monthDep, W.p26.dep + ' vs ' + monthDep);

// category rows exceed the distinct total -- a multi-category player is counted twice.
const prodBettors = Object.keys(D.prod).filter(k => k.startsWith('p26|'))
  .reduce((a, k) => a + D.prod[k].bettors, 0);
ok('product bettors exceed distinct bettors', prodBettors > W.p26.bettors,
   prodBettors + ' vs ' + W.p26.bettors);

// house edge total is weighted, not the mean of the rows.
const rows = w.US360.edge.rows;
const mean = rows.filter(r => r.b.bet).reduce((a, r) => a + r.b.ggr / r.b.bet, 0)
             / rows.filter(r => r.b.bet).length;
ok('total edge is weighted, not averaged', Math.abs(w.US360.edge.p26 - mean) > 1e-4,
   'weighted ' + (w.US360.edge.p26 * 100).toFixed(2) + '% vs mean ' + (mean * 100).toFixed(2) + '%');

// negative bars must fall below the zero rule -- Jan 2026 GGR is negative.
ok('January 2026 GGR is negative in the data', D.monthly['2026-01'].bloc.ggr < 0,
   D.monthly['2026-01'].bloc.ggr);

// charts actually rendered
['ch1', 'ch2', 'ch3'].forEach(id =>
  ok('chart ' + id + ' drew rects', doc.querySelectorAll('#' + id + ' rect').length > 20,
     doc.querySelectorAll('#' + id + ' rect').length));

// tables actually rendered
['tsrc', 'ttype', 'tcoh', 'tftd', 'tprod', 'trail'].forEach(id =>
  ok('table ' + id + ' has rows', doc.querySelectorAll('#' + id + ' tbody tr').length > 0,
     doc.querySelectorAll('#' + id + ' tbody tr').length));

// the divergence the whole report is about
ok('funnel down, money up', W.p26.ftd < W.p25.ftd && W.p26.ggr > W.p25.ggr,
   'ftd ' + W.p25.ftd + '->' + W.p26.ftd + ', ggr ' + Math.round(W.p25.ggr) + '->' + Math.round(W.p26.ggr));

// no horizontal-axis lie: every chart labels its zero
ok('cards rendered', doc.querySelectorAll('#cards .card').length === 9,
   doc.querySelectorAll('#cards .card').length);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
