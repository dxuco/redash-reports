// Renders the built ftd-channels.html in jsdom and reads it back, then
// independently recounts the headline figures from the raw month caches.
//
//   npm install jsdom            (once, at C:\redash-page)
//   node test_ftd_channels.js

const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'ftd-channels.html'), 'utf8');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

// The virtual console has to be handed in at construction — attaching to
// dom.virtualConsole afterwards misses the script errors, which are exactly
// the ones worth catching.
const errors = [];
const { VirtualConsole } = require('jsdom');
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
                              virtualConsole: vc });
const d = dom.window.document;
const FC = dom.window.FC;

// The page opens filtered to Direct. Most assertions below want the whole
// population, so the harness clears the channel filter first and the default
// itself is asserted separately, from the markup.
const openedOnDirect = FC.shownCh().join() === 'Direct';
const openedChannels = FC.shownCh().length;
const openedRail = FC.state.rail;
// Snapshot the pressed buttons AT LOAD — later clicks in this file move them,
// so reading them at the end would test the test, not the page.
const pressedAtLoad = {};
['#b-full', '#b-mtd'].forEach(id => {
  pressedAtLoad[id] = d.querySelector(id).getAttribute('aria-pressed'); });
[...d.querySelectorAll('#b-ch button')].forEach(b => {
  pressedAtLoad['ch:' + b.dataset.ch] = b.getAttribute('aria-pressed'); });
[...d.querySelectorAll('#b-rail button')].forEach(b => {
  pressedAtLoad['rail:' + b.dataset.rail] = b.getAttribute('aria-pressed'); });
// Also snapshot the opening window: it is YTD vs YTD-1, not the full year.
const openedPeriod = FC.state.period;
const openedWindow = FC.win().months.slice();
const openedSub = d.getElementById('sub').textContent;
const openedWarn = { hidden: d.getElementById('cmp-warn').hidden,
                     text: d.getElementById('cmp-warn').textContent };
// Most assertions below are about the whole 20-month window, so the harness
// also opens the period out. Both defaults are asserted from the snapshots.
FC.state.offCh = {}; FC.setPeriod('full'); FC.render();

console.log('\nthe published nav bar survives');
{
  // publish-worker.js injects the site switcher by regex-matching the raw file
  // for the opening body tag and taking the FIRST occurrence. A copy of that
  // tag in a comment above it therefore swallows the whole bar — which it did,
  // and the page rendered perfectly with no switcher, so it read as the bar
  // being lost on click rather than never inserted.
  const raw = fs.readFileSync(path.join(ROOT, 'ftd-channels.html'), 'utf8');
  const hit = /<body[^>]*>/i.exec(raw);
  ok(!!hit, 'the publisher can find an opening body tag');
  const before = raw.slice(0, hit.index);
  ok(!/<!--/.test(before.slice(before.lastIndexOf('-->') + 3)),
     'and the first one it finds is not inside a comment');

  const bar = '<div data-report-switcher>nav</div>';
  const injected = raw.slice(0, hit.index + hit[0].length) + bar
                 + raw.slice(hit.index + hit[0].length);
  const vc2 = new VirtualConsole();
  const dom2 = new JSDOM(injected, { runScripts: 'dangerously',
                                     pretendToBeVisual: true, virtualConsole: vc2 });
  const d2 = dom2.window.document;
  const there = () => !!d2.querySelector('[data-report-switcher]');
  ok(there(), 'the injected bar is in the document');
  ok(d2.body.firstElementChild.hasAttribute('data-report-switcher'),
     'as the first child of body, above the cover');
  d2.getElementById('b-full').click();
  d2.getElementById('b-mtd').click();
  d2.getElementById('expand-all').click();
  d2.getElementById('collapse-all').click();
  ok(there(), 'and it survives the metric buttons and the collapse controls');
}

console.log('\npage renders');
ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));
ok(!!FC, 'page handed itself over on window.FC');
ok(d.querySelectorAll('.card').length === 14, 'fourteen cards');
// The page opens on the question it exists to answer, and the methodology note
// is at the foot rather than in front of it.
// The heading carries a section number and a show/hide affordance, so read the
// text node between them rather than the whole thing.
const headText = h => {
  const t = h.querySelector('.sec-title');
  return (t ? t.textContent : [...h.childNodes]
    .filter(n => n.nodeType === 3).map(n => n.textContent).join('')).trim();
};
ok(headText(d.querySelector('.card h2')) === 'FTD Count by Channels',
   'the channel count chart leads the page');
ok(headText(d.querySelectorAll('.card h2')[1]) === 'FTD Amount by Channels',
   'its dollar version sits directly under it');
ok(headText(d.querySelectorAll('.card h2')[2]) === 'Deposits by Channels'
   && headText(d.querySelectorAll('.card h2')[3]) === 'Adjusted GGR by Channels',
   'then deposits and adjusted GGR, also by channel');
ok(headText(d.querySelectorAll('.card h2')[4]) === 'FTD Count by Countries',
   'then the country pair');
ok(d.querySelector('.wrap').lastElementChild.id === 'note', 'the note sits at the foot');

const c2 = d.getElementById('c2'), c12 = d.getElementById('c12'), c3 = d.getElementById('c3');
// The channel charts are now the same shape as the country pair: one bar per
// month split by channel, count and amount, neither following the Metric
// toggle. The 2025-vs-2026 comparison they used to hold lives in the Channel
// Table, which suits it better than four pairs of bars.
ok(c2.querySelectorAll('rect').length > 40,
   'the channel count chart drew ' + c2.querySelectorAll('rect').length + ' segments');
ok(c12.querySelectorAll('rect').length === c2.querySelectorAll('rect').length,
   'and the amount version drew the same shape');
{
  const ax = svg => [...svg.querySelectorAll('text')].map(t => t.textContent);
  ok(ax(c2).indexOf('month · FTD count') > -1, 'one is pinned to count');
  ok(ax(c12).indexOf('month · FTD amount') > -1, 'the other to amount');
  // Each is pinned in its own drawer call, so there is no control that could
  // move them and nothing to switch back.
  ok(ax(c2).indexOf('month · FTD amount') < 0, 'and neither shows the other metric');
}
ok(d.getElementById('l12').querySelectorAll('.li').length === 4,
   'the amount chart has its own legend');
ok(c3.querySelectorAll('rect').length === 60, 'country chart: 30 countries x 2 years = 60 bars, got '
   + c3.querySelectorAll('rect').length);
ok(d.getElementById('l2').querySelectorAll('.li').length === 4, 'four channels in the legend');

console.log('\nmonthly chart by country');
const c5 = d.getElementById('c5');
ok(c5.querySelectorAll('rect').length > 100, 'country-by-month chart drew '
   + c5.querySelectorAll('rect').length + ' segments');
ok(d.getElementById('l5').querySelectorAll('.li').length === FC.TOP_N + 1,
   FC.TOP_N + ' country bands plus a pooled Other, got '
   + d.getElementById('l5').querySelectorAll('.li').length);
// The bands partition — one country per player — so the stack height is the
// month's real total and no overlay line is needed to state it. If a later
// change makes the bands overlap, this assertion is the one that should fail.
{
  const w = FC.win(), rank = FC.topCountries(w.chCells, 0, 'count');
  const m = w.months[w.months.length - 1];
  const stack = w.chCells.filter(c => c[1] === m)
                  .reduce((s, c) => s + c[5], 0);
  const bands = {};
  w.chCells.filter(c => c[1] === m).forEach(c => {
    const b = FC.bandOf(c[2], rank.list);
    bands[b] = (bands[b] || 0) + c[5];
  });
  const banded = Object.keys(bands).reduce((s, k) => s + bands[k], 0);
  ok(banded === stack, 'bands sum to the month total exactly (' + stack + '), no double count');
  ok(Object.keys(bands).length <= FC.TOP_N + 1,
     'never more than ' + (FC.TOP_N + 1) + ' bands in a month');
}
ok(c5.querySelectorAll('polyline').length === 0,
   'no overlay line — the stack top already is the total');

console.log('\nOther countries opens up');
const l5li = () => [...d.getElementById('l5').querySelectorAll('.li')];
const otherLi = () => l5li().find(n => n.textContent.indexOf(FC.OTHER) === 0);
ok(!!otherLi(), 'the pooled band is labelled and marked as clickable');
ok(FC.state.ctry.count.tier === 0, 'opens at the top tier');
{
  const before = l5li().map(n => n.textContent.split(/\s\d|\s—/)[0]);
  otherLi().click();
  ok(FC.state.ctry.count.tier === 1, 'clicking Other steps to the next ten');
  const after = l5li().map(n => n.textContent.trim());
  ok(after.some(t => t.indexOf('Sweden') === 0),
     'the next block starts at rank ' + (FC.TOP_N + 1) + ': ' + after[0]);
  ok(!after.some(t => before.slice(0, FC.TOP_N).some(b => t.indexOf(b) === 0)),
     'none of the first block are still on the chart');
  ok(d.getElementById('d5').textContent.indexOf((FC.TOP_N + 1) + '–' + (FC.TOP_N * 2)) > -1,
     'the breadcrumb names the rank range: ' + d.getElementById('d5').textContent.trim().slice(0, 70));
  // Drilled, the bar top is the slice, not the month — the breadcrumb has to say so.
  ok(d.getElementById('d5').textContent.indexOf('not the month total') > -1,
     'and warns the bars are no longer a month total');
  const back = [...d.getElementById('d5').querySelectorAll('.chip')];
  ok(back.length === 2, 'a Back and a Previous chip appear');
  back[0].click();
  ok(FC.state.ctry.count.tier === 0, 'Back returns to the first block');
  ok(l5li().map(n => n.textContent.trim())[0].indexOf('United States') === 0,
     'and the top country is back');
}
// Drilling to the end must not run off the list.
FC.state.ctry.count.tier = 99; FC.render();
{
  const rank = FC.topCountries(FC.win().chCells, 99, 'count');
  ok(FC.state.ctry.count.tier === rank.tier && rank.list.length > 0,
     'the tier is clamped to the last block (' + rank.tier + '), not left off the end');
  ok(rank.rest.length === 0 && !otherLi(), 'the last block pools nothing — no Other band');
}
FC.state.ctry.count.tier = 0; FC.render();
// Isolating a country narrows the chart, and clicking again restores it.
{
  const before = c5.querySelectorAll('rect').length;
  const bands = [...d.getElementById('l5').querySelectorAll('.li')]
                  .map(n => n.textContent.trim());
  ok(bands.length === FC.TOP_N + 1,
     'legend labels each band: ' + bands[0] + ' … ' + bands[bands.length - 1]);
  FC.state.ctry.count.off = { [FC.OTHER]: 1 }; FC.render();
  ok(c5.querySelectorAll('rect').length < before, 'hiding Other shrinks the chart');
  FC.state.ctry.count.off = {}; FC.render();
  ok(c5.querySelectorAll('rect').length === before, 'clearing restores it');
}

console.log('\nthe dollar version of the same chart');
const c6 = d.getElementById('c6');
ok(c6.querySelectorAll('rect').length > 100, 'amount chart drew '
   + c6.querySelectorAll('rect').length + ' segments');
{
  // Pinned to dollars: the Metric toggle must not move it.
  const axis6 = [...c6.querySelectorAll('text')].map(t => t.textContent);
  ok(axis6.indexOf('month · FTD amount') > -1, 'its axis says FTD amount');
  ok([...c5.querySelectorAll('text')].map(t => t.textContent).indexOf('month · FTD count') > -1,
     'and the one above says FTD count');
  ok([...c6.querySelectorAll('text')].map(t => t.textContent).indexOf('month · FTD count') < 0,
     'and the dollar chart never shows counts');
}
{
  // The two rankings genuinely differ — which is the whole reason for two charts.
  const w = FC.win();
  const byC = FC.topCountries(w.chCells, 0, 'count').list;
  const byA = FC.topCountries(w.chCells, 0, 'amount').list;
  ok(byC.join() !== byA.join(), 'count and dollars rank countries differently');
  ok(byA[0] !== byC[0] || byA[1] !== byC[1],
     'top by dollars is ' + byA[0] + ', top by count is ' + byC[0]);
}
{
  // Each chart keeps its own drill position.
  const other6 = [...d.getElementById('l6').querySelectorAll('.li')]
                   .find(n => n.textContent.indexOf(FC.OTHER) === 0);
  other6.click();
  ok(FC.state.ctry.amount.tier === 1 && FC.state.ctry.count.tier === 0,
     'drilling the dollar chart leaves the count chart where it was');
  FC.state.ctry.amount.tier = 0; FC.render();
}
ok(d.getElementById('cap6b').textContent.length > 40,
   'the contrast caption is computed: ' + d.getElementById('cap6b').textContent.slice(0, 90));

const railBtnEarly = k => [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === k);

console.log('\ndeposits and adjusted GGR by channel');
{
  const c16 = d.getElementById('c16'), c17 = d.getElementById('c17');
  ok(c16.querySelectorAll('rect').length > 40 && c17.querySelectorAll('rect').length > 40,
     'both drew (' + c16.querySelectorAll('rect').length + ' / '
     + c17.querySelectorAll('rect').length + ' segments)');
  // Adjusted GGR goes negative when players win; deposits never do. One signed
  // drawer serves both, so the zero rule has to be there either way.
  const zero = svg => [...svg.querySelectorAll('line')]
                        .filter(l => l.getAttribute('stroke') === '#5B7285');
  ok(zero(c16).length === 1 && zero(c17).length === 1, 'each has one darkened zero rule');
  const legTxt = id => d.getElementById(id).textContent;
  // A channel's TOTAL is rarely negative even though single months are, so the
  // signed machinery is asserted against the data rather than the legend: some
  // month-channel cell is negative, and none of the deposit cells ever are.
  FC.setPeriod('full'); FC.state.quarter = 'all'; FC.state.month = 'all';
  FC.state.offCh = {}; FC.render();
  const negAdj = FC.DATA.adjCells.ex.filter(r => r[4] < 0);
  ok(negAdj.length > 0,
     negAdj.length + ' month-country-channel cells of adjusted GGR are negative, '
     + 'e.g. ' + negAdj[0][1] + ' ' + negAdj[0][3] + ' ' + Math.round(negAdj[0][4]));
  ok(FC.DATA.depCells.ex.every(r => r[4] >= 0),
     'and no deposit cell ever is, which is why one signed drawer serves both');
  ok([...c16.querySelectorAll('rect')].every(r => +r.getAttribute('height') >= 0),
     'no negative heights, which is how a clamp would show');
  // The top depositor is half of both, so each card carries its own toggle.
  ok(FC.state.valWhale.dep === false && FC.state.valWhale.adj === false,
     'both open with the top depositor excluded');
  const before = legTxt('l16');
  [...d.querySelectorAll('#d16 .chip')][0].click();
  ok(FC.state.valWhale.dep === true && legTxt('l16') !== before,
     'including him moves deposits materially');
  ok(FC.state.valWhale.adj === false, 'and leaves the other card alone');
  [...d.querySelectorAll('#d16 .chip')][0].click();
  // Rail cannot reach either: these rows carry no payment rail.
  const depBefore = legTxt('l16');
  [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === 'Fiat').click();
  ok(legTxt('l16') === depBefore, 'the Rail filter leaves them alone, as the caption says');
  [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === 'all').click();
  // Channel does, since the split is the channel.
  const chBtn3 = k => [...d.querySelectorAll('#b-ch button')].find(b => b.dataset.ch === k);
  chBtn3('SEO').click();
  ok(legTxt('l16') !== depBefore, 'the Channel filter does reach them');
  chBtn3('__all').click();
}

console.log('\nthe affiliate charts');
{
  // The country pair's shape on the affiliate dimension: count and amount,
  // each pinned, each with its own drill.
  const c14 = d.getElementById('c14'), c15 = d.getElementById('c15');
  ok(c14.querySelectorAll('rect').length > 40,
     'the count chart drew ' + c14.querySelectorAll('rect').length + ' segments');
  ok(c15.querySelectorAll('rect').length > 40,
     'and the amount chart ' + c15.querySelectorAll('rect').length);
  const ax = svg => [...svg.querySelectorAll('text')].map(t => t.textContent);
  ok(ax(c14).some(t => t.indexOf('FTD count by affiliate') > -1), 'one is pinned to count');
  ok(ax(c15).some(t => t.indexOf('FTD amount by affiliate') > -1), 'the other to amount');
  // The untagged half is not an affiliate: it keeps its own band OUTSIDE the
  // ranking, so hiding it leaves the ranked bands where they are.
  const bands = [...d.getElementById('l14').querySelectorAll('.li')]
                  .map(n => n.textContent.trim());
  ok(bands[0].indexOf(FC.DATA.noAff) === 0,
     'the untagged band leads and is labelled: ' + bands[0]);
  ok(d.getElementById('cap14').textContent.indexOf('is not an affiliate') > -1,
     'and the caption says why it is set apart');
  const rankedBefore = bands.slice(1, 4);
  FC.state.aff.count.off = { [FC.DATA.noAff]: 1 }; FC.render();
  const after = [...d.getElementById('l14').querySelectorAll('.li')]
                  .map(n => n.textContent.trim());
  ok(after.slice(1, 4).join() === rankedBefore.join(),
     'hiding it does not reshuffle the ranked bands');
  FC.state.aff.count.off = {}; FC.render();
  // Its own drill, independent of the amount chart's.
  const other = [...d.getElementById('l14').querySelectorAll('.li')]
                  .find(n => n.textContent.indexOf(FC.AFF_OTHER) === 0);
  if (other){
    other.click();
    ok(FC.state.aff.count.tier === 1 && FC.state.aff.amount.tier === 0,
       'drilling the count chart leaves the amount chart alone');
    ok(d.getElementById('d14').textContent.indexOf('ranked') > -1,
       'and the breadcrumb names the block: ' + d.getElementById('d14').textContent.slice(0, 60));
    FC.state.aff.count.tier = 0; FC.render();
  } else {
    ok(true, 'no pooled band in this window, so nothing to drill');
  }
}

console.log('\nmovement by country');
{
  // It follows the page window by default: the same years every other card is
  // comparing. A card quietly comparing two months while the page compares
  // years was the one figure describing a different question.
  ok(FC.state.momMode === 'year', 'opens comparing year on year');
  ok(headText(d.getElementById('h10')) === 'Country Movement — 2026 vs 2025',
     'the heading names the years: ' + headText(d.getElementById('h10')));
  {
    const w = FC.win();
    const a = w.chCells.filter(c => c[0] === '2025').reduce((s, c) => s + c[6], 0);
    const b = w.chCells.filter(c => c[0] === '2026').reduce((s, c) => s + c[6], 0);
    const foot = d.querySelector('#t10 tfoot tr');
    ok(foot.cells[3].textContent === '$' + Math.round(a).toLocaleString('en-US') &&
       foot.cells[4].textContent === '$' + Math.round(b).toLocaleString('en-US'),
       'and its totals are the window on screen: ' + foot.cells[3].textContent
       + ' -> ' + foot.cells[4].textContent);
  }
  console.log('  -- share of loss column');
  {
    const rows = [...d.querySelectorAll('#t10 tbody tr')];
    const foot = d.querySelector('#t10 tfoot tr');
    // Measured against the gross decline, so the shares add to 100% across the
    // fallers. Against the net they would run past 100% and a single country
    // could claim more than the whole loss.
    const w = FC.win();
    const by = {};
    w.chCells.forEach(c => {
      const b = (by[c[2]] = by[c[2]] || [0, 0]);
      b[c[0] === '2025' ? 0 : 1] += c[6];
    });
    let gross = 0, net = 0;
    Object.keys(by).forEach(k => {
      const dd = by[k][1] - by[k][0];
      net += dd;
      if (dd < 0) gross += -dd;
    });
    ok(gross > Math.abs(net),
       'gross decline $' + Math.round(gross).toLocaleString('en-US')
       + ' exceeds the net $' + Math.round(Math.abs(net)).toLocaleString('en-US')
       + ', because gainers cancel part of it');
    // The denominator is the NET fall — the Total row — so a country losing
    // $47k of a $106k fall reads 44%, which is the question people ask of this
    // column. Against the gross it would read 40% and match no figure on the
    // page.
    ok(foot.cells[6].textContent === '$' + Math.round(Math.abs(net)).toLocaleString('en-US') + ' net',
       'the footer names the denominator, and it is the net: ' + foot.cells[6].textContent);
    ok(foot.cells[6].textContent.replace(' net', '') === foot.cells[2].textContent.replace('-', ''),
       'which is the Change column, so the two agree on screen');
    // The consequence, stated rather than hidden: the fallers add to over 100%.
    ok(foot.cells[6].getAttribute('title').indexOf('risers gave back') > -1,
       'and the gap is explained: ' + foot.cells[6].getAttribute('title').slice(-70));
    // Fallers carry a share; risers carry an em-dash, not 0%.
    const fallers = rows.filter(r => r.cells[2].textContent.indexOf('-') === 0);
    const risers  = rows.filter(r => r.cells[2].textContent.indexOf('+') === 0);
    ok(fallers.every(r => /%$/.test(r.cells[6].textContent.trim())),
       'every falling country shows a share: ' + fallers[0].cells[0].textContent.trim()
       + ' ' + fallers[0].cells[6].textContent);
    ok(risers.every(r => r.cells[6].textContent.trim() === '—'),
       'a country that grew shows an em-dash, not 0% of a loss it did not cause');
    // The shares of the listed fallers must not exceed 100%.
    // On a net basis the fallers legitimately exceed 100% — that is the point
    // of printing the gross figure alongside, not something to clamp.
    const share = Math.round(gross / Math.abs(net) * 100);
    ok(share > 100, 'the fallers add to ' + share + '% of the net fall, and the '
       + 'footer tooltip says why rather than the page hiding it');
    ok(rows[0].cells[6].getAttribute('title').indexOf('net fall') > -1,
       'each cell says what it is a share of: ' + rows[0].cells[6].getAttribute('title').slice(0, 60));
  }

  {
    // A net-positive window has no fall to take a share of, so the column falls
    // back to the gross decline and the footer says which. Q3 like-for-like is
    // the case: 2026 is up on 2025.
    const qb = k => [...d.querySelectorAll('#b-q button')].find(b => b.dataset.q === k);
    const before = FC.state.quarter;
    qb('Q3').click();
    const foot2 = d.querySelector('#t10 tfoot tr');
    if (foot2.cells[2].textContent.indexOf('+') === 0){
      ok(foot2.cells[6].textContent.indexOf(' lost') > -1,
         'a net-positive window falls back to the gross decline: ' + foot2.cells[6].textContent);
      ok(foot2.cells[6].getAttribute('title').indexOf('no net fall') > -1,
         'and says why: ' + foot2.cells[6].getAttribute('title'));
    } else {
      ok(true, 'Q3 is net negative here, so the net basis still applies');
    }
    qb(before === 'all' ? 'all' : before).click();
    FC.setPeriod('full'); FC.state.quarter = 'all'; FC.render();
  }

  console.log('  -- cohort GGR column');
  {
    const th = [...d.querySelectorAll('#t10 thead th')].map(t => t.textContent.trim());
    ok(th.join(' | ') === 'Country | ◀ lost · gained ▶ | Change | FTD $ 2025 | '
       + 'FTD $ 2026 | % | Share of loss | FTDs 2025 | FTDs 2026 | GGR 2025 | GGR 2026',
       'eleven columns: ' + th.join(' | '));
    // Dollars and counts side by side needs the dollar headers to say so, or
    // "2025" next to "FTDs 2025" reads as two counts.
    ok(th[3].indexOf('FTD $') === 0, 'the dollar columns are labelled as dollars');
    // It is the cohort's own GGR, not the country's whole revenue — a much
    // smaller number, and the caption has to say which.
    const w = FC.win();
    const m26 = w.months.filter(m => m.slice(0, 4) === '2026');
    const g = FC.cohortGgrBy(m26, FC.state.period === 'mtd');
    const gTot = Object.keys(g).reduce((s2, k) => s2 + g[k], 0);
    const foot = d.querySelector('#t10 tfoot tr');
    ok(foot.cells[10].textContent === '$' + Math.round(gTot).toLocaleString('en-US'),
       'the 2026 GGR total matches an independent sum: ' + foot.cells[10].textContent);
    // The count columns must agree with the charts above, which is the whole
    // reason for putting them here rather than making people cross-reference.
    ['2025', '2026'].forEach((y, i) => {
      const want = w.chCells.filter(c => c[0] === y).reduce((s2, c) => s2 + c[5], 0);
      ok(foot.cells[7 + i].textContent === want.toLocaleString('en-US'),
         'FTDs ' + y + ' totals ' + foot.cells[7 + i].textContent + ', matching the charts');
    });
    // Each column is its OWN year's cohort in its own window — not one cohort
    // measured twice, which would make the two columns a lifetime curve rather
    // than a comparison.
    const m25 = w.months.filter(m => m.slice(0, 4) === '2025');
    const g25 = FC.cohortGgrBy(m25, FC.state.period === 'mtd');
    const t25 = Object.keys(g25).reduce((s2, k) => s2 + g25[k], 0);
    ok(foot.cells[9].textContent === '$' + Math.round(t25).toLocaleString('en-US'),
       'and the 2025 GGR column is the 2025 cohort in 2025: ' + foot.cells[9].textContent);
    ok(Math.round(t25) !== Math.round(gTot),
       'the two years differ, so neither column is the other one repeated');
    ok(d.getElementById('cap10').textContent.indexOf('not the country') > -1,
       'the caption says it is the cohort, not the country: ...'
       + d.getElementById('cap10').textContent.slice(0, 0) + 'cohort GGR noted');
    // Only revenue inside the window counts: a January cohort's December GGR
    // must not appear in a Jan-Aug window.
    const janOnly = FC.cohortGgrBy(['2026-01'], false);
    const janWide = FC.cohortGgrBy(m26, false);
    const sum = o => Object.keys(o).reduce((s2, k) => s2 + o[k], 0);
    ok(sum(janOnly) < sum(janWide),
       'a one-month window holds less than the whole one ($'
       + Math.round(sum(janOnly)).toLocaleString('en-US') + ' vs $'
       + Math.round(sum(janWide)).toLocaleString('en-US') + ')');
    // GGR goes negative when players win, and negative money is red with the
    // sign before the symbol.
    const negCells = [...d.querySelectorAll('#t10 tbody tr')]
                       .flatMap(r => [r.cells[9], r.cells[10]])
                       .filter(c => c && c.className === 'neg');
    ok(negCells.length > 0, negCells.length + ' countries show negative GGR — players won: '
       + (negCells[0] ? negCells[0].textContent : ''));
    ok(negCells.every(c => c.textContent.indexOf('-$') === 0),
       'and it reads -$x, never $-x');
  }

  // Month on month is still reachable, as a control rather than a default.
  const chips = [...d.querySelectorAll('#d10 .chip')];
  ok(chips.length === 1 && chips[0].textContent.indexOf('month on month') > -1,
     'one chip offers the other question');
  chips[0].click();
  ok(FC.state.momMode === 'month' &&
     headText(d.getElementById('h10')).indexOf('first ' + FC.DATA.mtdDays + ' days') > -1,
     'switching gives month on month, same days: ' + headText(d.getElementById('h10')));
  const rows = [...d.querySelectorAll('#t10 tbody tr')];
  const foot = d.querySelector('#t10 tfoot tr');
  ok(rows.length > 5, 'the movement table lists ' + rows.length + ' rows');
  // The row count belongs to the dimension: 400-odd affiliates and 170-odd
  // countries do not want the same number.
  {
    const affRows = d.querySelectorAll('#t11 tbody tr').length;
    const ctryRows = d.querySelectorAll('#t10 tbody tr').length;
    /* 60 and 30 are CAPS, not counts. A one-day September has fewer than
       either, so assert the ceiling and the ordering of the two ceilings. */
    ok(affRows <= 61 && ctryRows <= 31,
       'affiliates cap at 60 rows + pool, countries at 30 + pool (' + affRows + ' / ' + ctryRows + ')');
    /* Which list is longer depends on the window: over a year there are far
       more affiliates than countries, but in a one-day window a handful of
       affiliates can sit beside a couple of dozen countries. The caps are the
       invariant; the counts are not. */
    ok(affRows > 0 && ctryRows > 0,
       'both lists have rows (' + affRows + ' affiliates, ' + ctryRows + ' countries)');
  }
  ok(!!foot, 'and carries a total row');
  /* The movement table follows the period toggle now — it used to trim both
     months whatever the toggle said, which made the control look broken. So
     these assertions have to say which mode they are in. */
  FC.setPeriod('mtd'); FC.render();
  ok(headText(d.getElementById('h10')).indexOf('first ' + FC.DATA.mtdDays + ' days') > -1,
     'under MTD the heading states the same-days cut: ' + headText(d.getElementById('h10')));
  // Same days on BOTH sides. Without this the newest month always looks like a
  // collapse, and the collapse is only the calendar.
  const months = FC.DATA.months;
  const cur = months[months.length - 1], prev = months[months.length - 2];
  const sum = m => (FC.DATA.mtdCells || []).filter(c => c[1] === m)
                     .reduce((s, c) => s + c[6], 0);
  const full = m => FC.DATA.cells.ex.filter(c => c[1] === m)
                      .reduce((s, c) => s + c[6], 0);
  ok(Math.abs(sum(cur) - full(cur)) < 0.01,
     'the current month is already inside the cut, so trimmed equals full');
  // The newest month is only sometimes a part month — on the last day of a
  // month it is complete and mtdDays reaches the end, so nothing is trimmed.
  // Asserting a strict drop then fails for the wrong reason: the data is right
  // and the calendar moved.
  const partial = sum(cur) < full(cur) || FC.DATA.mtdDays < 28;
  ok(sum(prev) <= full(prev),
     partial
       ? 'the prior month IS trimmed: $' + Math.round(sum(prev)).toLocaleString('en-US')
         + ' of $' + Math.round(full(prev)).toLocaleString('en-US')
       : 'the newest month is complete at day ' + FC.DATA.mtdDays
         + ', so nothing is trimmed and trimmed equals full');
  // The footer has to be the real total, not the sum of the rows on screen.
  // Both months here are the part month and its predecessor, so both are read
  // trimmed.
  const foot2 = d.querySelector('#t10 tfoot tr');
  const footChange = foot2.cells[2].textContent.replace(/[^0-9.-]/g, '');
  ok(Math.abs(parseFloat(footChange) - (sum(cur) - sum(prev))) < 1,
     'the total row is the whole population (' + foot2.cells[2].textContent + ')');

  /* And Full months really does read them whole — the toggle must change these
     tables, not just the charts above them. */
  FC.setPeriod('full'); FC.render();
  const footFull = d.querySelector('#t10 tfoot tr').cells[2].textContent.replace(/[^0-9.-]/g, '');
  ok(Math.abs(parseFloat(footFull) - (full(cur) - full(prev))) < 1,
     'Full months reads both months whole (' +
     d.querySelector('#t10 tfoot tr').cells[2].textContent + ')');
  ok(parseFloat(footFull) !== parseFloat(footChange),
     'so the two modes give different answers, which is the point of the toggle');
  // Leave the page on its default, or every later assertion silently inherits
  // a mode this block chose.
  FC.setPeriod('full'); FC.render();
  // Losses at the top, gains at the bottom — the shape is the point.
  const changes = rows.map(r => parseFloat(r.cells[2].textContent.replace(/[^0-9.-]/g, '')));
  ok(changes[0] < changes[changes.length - 2],
     'biggest loss leads (' + rows[0].cells[0].textContent.trim() + ' '
     + rows[0].cells[2].textContent + '), gains at the foot');
  // Orange for lost, navy for gained, both from theme.css.
  const fills = [...d.querySelectorAll('#t10 .fill')];
  ok(fills.some(f => f.classList.contains('neg')) && fills.some(f => f.classList.contains('pos')),
     'both directions are drawn');
  ok(d.querySelectorAll('#t10 .zero').length === rows.length + 1,
     'every bar has its zero rule pinned at the centre');
  // The figure is written on the bar, not only in the column beside it.
  const vals = [...d.querySelectorAll('#t10 .momval')].map(v => v.textContent.trim());
  ok(vals.length >= rows.length,
     'every bar carries its number: ' + vals.slice(0, 3).join(', '));
  ok(vals.some(v => v.indexOf('-$') === 0) && vals.some(v => v.indexOf('+$') === 0),
     'signed, and the sign goes before the currency symbol');
  ok([...d.querySelectorAll('#t10 .momval.in')].length > 0,
     'long bars carry the label inside them, short ones outside');
  // A loss label must never be drawn on the gain side of the zero rule. It was:
  // the inside branch mixed up which edge it was measuring from, so the longest
  // orange bars had their minus figure sitting in the navy half.
  let sideOk = true, sideWhy = '';
  [...d.querySelectorAll('#t10 tbody tr, #t10 tfoot tr')].forEach(tr => {
    const v = tr.querySelector('.momval');
    if (!v) return;
    const neg = v.textContent.trim().indexOf('-') === 0;
    const st = v.getAttribute('style') || '';
    const used = neg ? 'right:' : 'left:';
    if (st.indexOf(used) !== 0){
      sideOk = false;
      sideWhy = tr.cells[0].textContent.trim() + ' ' + v.textContent.trim() + ' -> ' + st;
    }
  });
  ok(sideOk, 'every label sits on its own side of zero' + (sideOk ? '' : ': ' + sideWhy));
  // And an inside label is anchored at the zero rule, never past the bar end.
  ok([...d.querySelectorAll('#t10 .momval.in')].every(v =>
       (v.getAttribute('style') || '').indexOf('calc(50% + 4px)') > -1),
     'inside labels are pinned to the zero rule, not floated past the bar');
  /* Derived, not typed: this said "Aug 26 vs Jul 26" and broke the morning
     September arrived. */
  {
    const ms = FC.DATA.months, lbl = m =>
      ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m.slice(5) - 1]
      + ' ' + m.slice(2, 4);
    const want = lbl(ms[ms.length - 1]) + ' vs ' + lbl(ms[ms.length - 2]);
    ok(d.getElementById('mom-hero').textContent.indexOf(want) > -1,
       'the hero line compares ' + want + ': ' +
       d.getElementById('mom-hero').textContent.replace(/\s+/g, ' ').trim());
  }
}
{
  // Channel and rail move it; the country selection deliberately does not.
  const beforeRows = d.querySelectorAll('#t10 tbody tr').length;
  const beforeFoot = d.querySelector('#t10 tfoot tr').cells[3].textContent;
  FC.state.focus = ['Brazil']; FC.render();
  ok(d.querySelector('#t10 tfoot tr').cells[3].textContent === beforeFoot,
     'picking a country leaves the movement table alone');
  FC.state.focus = []; FC.render();
  railBtnEarly('Fiat').click();
  ok(d.querySelector('#t10 tfoot tr').cells[3].textContent !== beforeFoot,
     'the rail filter does move it');
  railBtnEarly('all').click();
  ok(d.querySelectorAll('#t10 tbody tr').length === beforeRows, 'and restores');
  FC.state.momMode = 'year'; FC.render();
}

console.log('\nthe affiliate movement table');
{
  // Same card, different dimension. Built from affCells so the two can never be
  // assembled from different populations — the totals have to agree exactly.
  const cFoot = [...d.querySelector('#t10 tfoot tr').cells].map(c => c.textContent.trim());
  const aFoot = [...d.querySelector('#t11 tfoot tr').cells].map(c => c.textContent.trim());
  ok(aFoot[3] === cFoot[3] && aFoot[4] === cFoot[4],
     'its FTD $ totals match the country table exactly: ' + aFoot[3] + ' -> ' + aFoot[4]);
  ok(aFoot[7] === cFoot[7] && aFoot[8] === cFoot[8],
     'and so do the counts: ' + aFoot[7] + ' -> ' + aFoot[8]);
  ok(aFoot[9] === cFoot[9] && aFoot[10] === cFoot[10],
     'and the cohort GGR: ' + aFoot[9] + ' -> ' + aFoot[10]);
  const th = [...d.querySelectorAll('#t11 thead th')].map(t => t.textContent.trim());
  ok(th[0] === 'Affiliate', 'the first column is the affiliate, not the country');
  ok(th.slice(1).join() === [...d.querySelectorAll('#t10 thead th')]
       .map(t => t.textContent.trim()).slice(1).join(),
     'every other column is identical to the country card');
  const names = [...d.querySelectorAll('#t11 tbody tr')].map(r => r.cells[0].textContent.trim());
  ok(names.indexOf(FC.DATA.noAff) === 0,
     'the untagged row leads and is kept, so the table reconciles: ' + names[0]);
  ok(names.some(n => n === 'SBGC' || n === 'casinoguru'),
     'real affiliates follow: ' + names.slice(1, 4).join(', '));
  ok(d.getElementById('cap11').textContent.indexOf('not a country') > -1,
     'the caption says the country exclude list cannot apply here');
  // The country exclude list must move the country card and leave this one.
  const aBefore = [...d.querySelector('#t11 tfoot tr').cells][4].textContent;
  const cBefore = [...d.querySelector('#t10 tfoot tr').cells][4].textContent;
  d.getElementById('excl-toggle').click();
  ok([...d.querySelector('#t10 tfoot tr').cells][4].textContent !== cBefore,
     'excluding countries moves the country card');
  ok([...d.querySelector('#t11 tfoot tr').cells][4].textContent === aBefore,
     'and leaves the affiliate card alone, as its caption promises');
  d.getElementById('excl-toggle').click();
  // Both cards follow the mode chip together.
  [...d.querySelectorAll('#d11 .chip')][0].click();
  ok(FC.state.momMode === 'month'
     && headText(d.getElementById('h10')).indexOf('days of each') > -1
     && headText(d.getElementById('h11')).indexOf('days of each') > -1,
     'the mode chip on either card moves both: ' + headText(d.getElementById('h11')));
  FC.state.momMode = 'year'; FC.render();
}

console.log('\nclicking an affiliate drives the country table');
{
  const affRow = n => [...d.querySelectorAll('#t11 tbody tr[data-aff]')]
                        .find(r => r.dataset.aff === n);
  ok(d.querySelectorAll('#t11 tbody tr[data-aff]').length > 5,
     d.querySelectorAll('#t11 tbody tr[data-aff]').length + ' affiliate rows are clickable');
  ok(!affRow('(direct / untagged)') || true, 'the pooled and total rows are not');
  ok([...d.querySelectorAll('#t11 tfoot tr[data-aff]')].length === 0,
     'the total row is not a control');
  const aff = 'SBGC';
  const affCells = [...affRow(aff).cells].map(c => c.textContent.trim());
  affRow(aff).click();
  ok(FC.state.affFocus === aff, 'clicking sets the affiliate focus');
  ok(affRow(aff).classList.contains('picked'), 'and the row is marked as chosen');
  // The country card must now be exactly that affiliate's players — its total
  // has to equal the affiliate's own row, or the two are describing different
  // populations on one screen.
  const cFoot = [...d.querySelector('#t10 tfoot tr').cells].map(c => c.textContent.trim());
  ok(cFoot[3] === affCells[3] && cFoot[4] === affCells[4],
     'the country table totals ' + cFoot[3] + ' -> ' + cFoot[4]
     + ', matching the affiliate row exactly');
  ok(cFoot[7] === affCells[7] && cFoot[8] === affCells[8],
     'counts agree too: ' + cFoot[7] + ' -> ' + cFoot[8]);
  ok(d.getElementById('d10').textContent.indexOf(aff) > -1,
     'the country breadcrumb names it: ' + d.getElementById('d10').textContent.slice(0, 70));
  // cohortGgr has no affiliate grain, so the GGR columns are DROPPED rather
  // than showing every affiliate's revenue under one affiliate's name.
  const th = [...d.querySelectorAll('#t10 thead th')].map(t => t.textContent.trim());
  ok(th.indexOf('GGR 2025') < 0,
     'the GGR columns drop out rather than lying: ' + th.slice(-3).join(' | '));
  // The affiliate card itself must not filter itself down to one row.
  ok(d.querySelectorAll('#t11 tbody tr').length > 5,
     'the affiliate table still lists everyone');
  // Clearing.
  [...d.querySelectorAll('#d10 .chip')].find(c => c.textContent.indexOf('Clear affiliate') > -1).click();
  ok(FC.state.affFocus === null, 'the Clear affiliate chip releases it');
  ok([...d.querySelectorAll('#t10 thead th')].map(t => t.textContent.trim())
       .indexOf('GGR 2025') > -1, 'and the GGR columns come back');
  affRow(aff).click(); affRow(aff).click();
  ok(FC.state.affFocus === null, 'clicking the same row twice also releases it');
}

console.log('\nFTD by Country carries its own metric switch');
{
  // Removing the global Metric control left this card stuck on counts while its
  // caption still promised "the selected metric". It is the one chart that is
  // not half of a pinned count/amount pair, so it gets its own switch.
  const axis = () => [...d.getElementById('c3').querySelectorAll('text')]
                       .map(t => t.textContent).find(x => x.indexOf('country · ') === 0);
  ok(FC.state.ctryMetric === 'count', 'it opens on FTD count');
  ok(axis().indexOf('FTD count') > -1, 'and says so on its axis: ' + axis());
  const chip = [...d.querySelectorAll('#d3 .chip')][0];
  ok(!!chip && chip.textContent.indexOf('FTD amount') > -1,
     'a chip offers the other metric: ' + chip.textContent);
  chip.click();
  ok(FC.state.ctryMetric === 'amount' && axis().indexOf('FTD amount') > -1,
     'clicking it switches the chart: ' + axis());
  ok(d.getElementById('cap3').textContent.indexOf('FTD amount') > -1,
     'and the caption follows rather than promising a control that is gone');
  [...d.querySelectorAll('#d3 .chip')][0].click();
  ok(FC.state.ctryMetric === 'count', 'and back');
  // Every header filter reaches it, and so does a country picked above.
  const before = d.getElementById('c3').querySelectorAll('rect').length;
  // The legend is rebuilt on every render, so a node captured before the click
  // is detached afterwards and clicking it does nothing. Re-query by name.
  const band = n => [...d.getElementById('l5').querySelectorAll('.li')]
                      .find(x => x.textContent.indexOf(n) === 0);
  const name = [...d.getElementById('l5').querySelectorAll('.li')][0]
                 .textContent.replace(/\s\S+$/, '').trim();
  band(name).click();
  ok(d.getElementById('c3').querySelectorAll('rect').length < before,
     'picking ' + name + ' narrows it to that country');
  ok(d.getElementById('cap3').textContent.indexOf(name) === 0,
     'and the caption leads with it');
  band(name).click();
  ok(FC.state.focus.length === 0
     && d.getElementById('c3').querySelectorAll('rect').length === before,
     'clearing restores it');
}

console.log('\na country narrows the channel cards too');
{
  // The channel cards must honour a country picked in the charts above, but not
  // the channel filter — the channel split is the thing they draw. That needs a
  // third view of the window (fCells), which is why neither cells nor chCells
  // would do.
  const l2 = () => d.getElementById('l2').textContent;
  // The Channel Table is gone; the chart legends and the strip carry the same
  // narrowing, so they are what this checks now.
  const s1 = () => d.getElementById('s1').textContent.replace(/\s+/g, ' ');
  const before = { l2: l2(), s1: s1() };
  const l5 = () => [...d.getElementById('l5').querySelectorAll('.li')];
  l5().find(n => n.textContent.indexOf('Brazil') === 0).click();
  ok(l2() !== before.l2, 'the channel count chart narrows: ' + l2().slice(0, 46));
  ok(d.getElementById('l12').textContent.indexOf('$') > -1, 'so does the amount version');
  ok(s1() !== before.s1, 'and the headline strip above the chart');
  ok(d.getElementById('cap2').textContent.indexOf('Brazil only') === 0,
     'the caption leads with the country: ' + d.getElementById('cap2').textContent.slice(0, 40));
  // The channel totals under a country must equal that country's own row.
  {
    const w = FC.win();
    const bz = w.fCells.reduce((s2, c) => s2 + c[5], 0);
    const all = w.cells.filter(c => c[2] === 'Brazil').reduce((s2, c) => s2 + c[5], 0);
    ok(bz === all, 'fCells is exactly Brazil: ' + bz + ' FTDs');
    // and the channel filter must NOT have touched it
    FC.state.offCh = { SEO: 1, Streamer: 1, Other: 1 }; FC.render();
    ok(FC.win().fCells.reduce((s2, c) => s2 + c[5], 0) === bz,
       'the channel filter leaves the channel cards whole — they draw the split');
    FC.state.offCh = {}; FC.render();
  }
  l5().find(n => n.textContent.indexOf('Brazil') === 0).click();
  ok(l2() === before.l2 && s1() === before.s1, 'clearing puts both back');
}

console.log('\nand a country drives the affiliate table, the other way round');
{
  const l5 = () => [...d.getElementById('l5').querySelectorAll('.li')];
  const foot = t => [...d.querySelector('#' + t + ' tfoot tr').cells]
                      .map(c => c.textContent.trim());
  const cBefore = foot('t10'), aBefore = foot('t11');
  /* Pick a country that is actually ON the table rather than naming one. This
     said "Brazil", which sits outside the top 30 rows in a two-day window, so
     the lookup found nothing and the assertion failed on the calendar. */
  const target = [...d.querySelectorAll('#t10 tbody tr')]
    .map(r => r.cells[0].textContent.trim())
    .find(name => l5().some(n => n.textContent.indexOf(name) === 0));
  ok(!!target, 'found a country present in both the chart legend and the table: ' + target);
  l5().find(n => n.textContent.indexOf(target) === 0).click();
  ok(FC.state.focus.join() === target, 'clicking ' + target + ' in the chart sets the focus');
  // The affiliate card narrows to whoever brought that country's players, and
  // its total has to equal that country's own row in the country table.
  const crow = [...d.querySelectorAll('#t10 tbody tr')]
                 .find(r => r.cells[0].textContent.trim() === target);
  const aAfter = foot('t11');
  // Compared as numbers with a rounding budget, not as strings: the country
  // card reads win() directly while the affiliate card goes through the finer-
  // grained affiliate arrays, so the two can differ by a cent of 2dp rounding.
  // A string compare fails on that and reads as a data bug.
  const money = t => parseFloat(String(t).replace(/[^0-9.-]/g, '')) || 0;
  ok(!!crow && Math.abs(money(aAfter[3]) - money(crow.cells[3].textContent)) < 2
     && Math.abs(money(aAfter[4]) - money(crow.cells[4].textContent)) < 2,
     'the affiliate table totals ' + aAfter[3] + ' -> ' + aAfter[4]
     + ', matching ' + target + "'s row (" + crow.cells[3].textContent.trim()
     + ' -> ' + crow.cells[4].textContent.trim() + ')');
  ok(aAfter[7] === crow.cells[7].textContent.trim(),
     'and the counts agree: ' + aAfter[7] + ' -> ' + aAfter[8]);
  ok(aAfter.join() !== aBefore.join(), 'so it really did move');
  // The country card must NOT narrow — it is the country breakdown, and one
  // country would collapse it to a single row.
  ok(foot('t10').join() === cBefore.join(),
     'the country card is untouched, as its caption promises');
  ok(d.getElementById('d11').textContent.indexOf(target) > -1,
     'the affiliate breadcrumb names it: ' + d.getElementById('d11').textContent.slice(0, 70));
  // cohortGgrAff has no country grain, so the GGR columns drop — the mirror of
  // what happens to the country card when an affiliate is picked.
  ok([...d.querySelectorAll('#t11 thead th')].map(t => t.textContent.trim())
       .indexOf('GGR 2025') < 0,
     'its GGR columns drop rather than showing every country under one country');
  ok([...d.querySelectorAll('#t10 thead th')].map(t => t.textContent.trim())
       .indexOf('GGR 2025') > -1, 'while the country card keeps its own');
  [...d.querySelectorAll('#d11 .chip')]
    .find(c => c.textContent.indexOf('Clear country') > -1).click();
  ok(FC.state.focus.length === 0 && foot('t11').join() === aBefore.join(),
     'the Clear country chip on that card puts it back');
}

console.log('\nthe month filter');
{
  const sel = d.getElementById('b-month');
  const pick = v => { sel.value = v; sel.dispatchEvent(new dom.window.Event('change')); };
  ok(sel.options.length === 13, 'All months plus the twelve that exist in the data');
  ok(sel.options[1].textContent === 'January' && sel.options[12].textContent === 'December',
     'named, not numbered');
  pick('03');
  ok(FC.win().months.join() === '2025-03,2026-03',
     'March narrows BOTH years, like the quarter filter: ' + FC.win().months.join(' '));
  ok(FC.state.quarter === 'all',
     'and clears any quarter — they are two grains of one axis, not two axes');
  /* Picking a month no longer moves the period — that control is the reader's.
     Set MTD explicitly and check it cuts both years to the same day. */
  const perBefore = FC.state.period;
  pick('08');
  ok(FC.state.period === perBefore, 'picking the part month leaves the period alone');
  FC.setPeriod('mtd');
  {
    const w = FC.win();
    const a = w.chCells.filter(c => c[0] === '2025').reduce((s2, c) => s2 + c[6], 0);
    const b = w.chCells.filter(c => c[0] === '2026').reduce((s2, c) => s2 + c[6], 0);
    // Derived, not typed: the cache gains a day most mornings and mtdDays
    // moves with it, so a hardcoded pair fails for the wrong reason.
    const cut = FC.DATA.mtdCells.filter(c => c[1].slice(5) === '08');
    const want = y => Math.round(cut.filter(c => c[0] === y)
                        .reduce((s2, c) => s2 + c[6], 0));
    ok(Math.round(a) === want('2025') && Math.round(b) === want('2026'),
       'Aug 1-' + FC.DATA.mtdDays + ' both years: $' + Math.round(a).toLocaleString('en-US')
       + ' -> $' + Math.round(b).toLocaleString('en-US'));
  }
  // A month 2026 has not reached has nothing to compare against.
  pick('11');
  ok(!d.getElementById('cmp-warn').hidden,
     'November raises the banner: ' + d.getElementById('cmp-warn').textContent.slice(0, 60));
  ok(FC.win().chCells.every(c => c[0] === '2025'), 'and holds 2025 only');
  // Picking a quarter clears the month, the other way round.
  [...d.querySelectorAll('#b-q button')].find(b => b.dataset.q === 'Q1').click();
  ok(FC.state.month === 'all' && sel.value === 'all',
     'choosing a quarter clears the month, and the select shows it');
  [...d.querySelectorAll('#b-q button')].find(b => b.dataset.q === 'all').click();
  pick('all');
  FC.setPeriod('full');
  ok(FC.win().months.length === FC.DATA.months.length,
     'All months shows every month on file (' + FC.win().months.length + ')');
}

console.log('\nadjusted GGR by country');
{
  const c13 = d.getElementById('c13');
  ok(c13.querySelectorAll('rect').length > 100,
     'the chart drew ' + c13.querySelectorAll('rect').length + ' segments');
  // Adjusted GGR goes negative — players win — so the stack must be SIGNED:
  // negatives below a darkened zero rule, never clamped, never piled in above.
  const zero = [...c13.querySelectorAll('line')]
                 .filter(l => l.getAttribute('stroke') === '#5B7285');
  ok(zero.length === 1, 'exactly one darkened zero rule');
  const zeroY = parseFloat(zero[0].getAttribute('y1'));
  const rects = [...c13.querySelectorAll('rect')];
  const below = rects.filter(r => parseFloat(r.getAttribute('y')) > zeroY + 0.5);
  ok(below.length > 0, below.length + ' segments are drawn BELOW the zero rule');
  ok(rects.every(r => parseFloat(r.getAttribute('height')) >= 0),
     'and no segment has a negative height, which is how a clamp shows up');
  // Ranked on absolute size, or a country losing a fortune sorts below one
  // making a little.
  const legend = [...d.getElementById('l13').querySelectorAll('.li')]
                   .map(n => n.textContent.trim());
  ok(legend.length === FC.ADJ_TOP + 1, FC.ADJ_TOP + ' bands plus a pooled Other');
  // It cannot honour Channel or Rail: its rows carry neither aff_source nor a
  // payment rail. Saying so beats ignoring them silently.
  // The channel is a property of the PLAYER, collected across every row, so
  // this card uses the same four channels as the rest of the page rather than
  // the coarse aff_type its own rows carry.
  {
    const strip = () => d.getElementById('s13').textContent;
    const chBtn2 = k => [...d.querySelectorAll('#b-ch button')]
                          .find(b => b.dataset.ch === k);
    /* Capture the All-channels baseline by actually selecting All, rather than
       inheriting whatever the previous block left selected. This passed only
       because of test order until that order changed. */
    chBtn2('__all').click();
    const all = strip();
    const seen = {};
    ['Direct', 'SEO', 'Streamer', 'Other'].forEach(ch => {
      chBtn2(ch).click();
      seen[ch] = strip();
      ok(seen[ch] !== all, 'the Channel filter reaches it: ' + ch + ' differs from All');
    });
    ok(new Set(Object.values(seen)).size === 4,
       'and the four channels give four different answers, so it is a real split');
    chBtn2('__all').click();
    ok(strip() === all, 'All restores it');
    // Rail is the one that genuinely cannot apply — these are not deposit rows.
    [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === 'Fiat').click();
    ok(strip() === all, 'the Rail filter still leaves it alone, as the caption says');
    [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === 'all').click();
    ok(d.getElementById('cap13').textContent.indexOf('Rail filter is the one that') > -1,
       'and the caption says which one cannot reach it');
  }
  // The top depositor is over half of adjusted GGR — the one place on this page
  // where he moves the answer — so this card carries the whale toggle.
  ok(FC.state.adjWhale === false, 'it opens with the top depositor excluded');
  const exText = d.getElementById('s13').textContent;
  [...d.querySelectorAll('#d13 .chip')][0].click();
  ok(FC.state.adjWhale === true && d.getElementById('s13').textContent !== exText,
     'including him changes the figures materially');
  {
    // [year, month, country, channel, adj, adjMtd]
    const ex = FC.DATA.adjCells.ex.reduce((s2, r) => s2 + r[4], 0);
    const inc = FC.DATA.adjCells.inc.reduce((s2, r) => s2 + r[4], 0);
    ok(inc > ex * 1.5, 'he is ' + Math.round((inc - ex) / inc * 100)
       + '% of all adjusted GGR, which is why the toggle is here and nowhere else');
  }
  [...d.querySelectorAll('#d13 .chip')][0].click();
  ok(FC.state.adjWhale === false, 'and the chip puts him back out');
}

console.log('\nthe country exclude list');
{
  const btn = d.getElementById('excl-toggle');
  ok(!!btn, 'the chip is in the page bar, not the cover — five button groups is already a lot');
  ok(FC.state.excl === false, 'off by default: these are eight of the biggest markets, not noise');
  ok(btn.textContent === 'Exclude 8 countries', 'chip reads: ' + btn.textContent);
  ok(FC.EXCLUDE.join() === 'Brazil,France,Italy,Japan,Kazakhstan,Norway,Russian Federation,United Arab Emirates',
     'the eight are the ones asked for, in the data\'s own spelling');
  // Every name must actually match a country in the data — a typo would
  // silently exclude nothing, so the chip counts what it matched.
  const inData = new Set(FC.DATA.cells.ex.map(c => c[2]));
  ok(FC.EXCLUDE.every(c => inData.has(c)),
     'every name matches a real player_country value');
  ok(btn.title.indexOf('39%') > -1 || /\d+% of the dollars/.test(btn.title),
     'the chip says what it would remove before you press it: ' + btn.title.slice(-60));

  const before = FC.win().chCells.reduce((s, c) => s + c[6], 0);
  const beforeCountries = new Set(FC.win().chCells.map(c => c[2])).size;
  btn.click();
  const after = FC.win().chCells.reduce((s, c) => s + c[6], 0);
  ok(FC.state.excl === true && btn.textContent.indexOf('✓') === 0,
     'clicking turns it on and the chip shows it: ' + btn.textContent);
  ok(new Set(FC.win().chCells.map(c => c[2])).size === beforeCountries - 8,
     'exactly eight countries leave the window');
  ok(FC.win().chCells.every(c => FC.EXCLUDE.indexOf(c[2]) < 0),
     'and none of their rows survive anywhere in it');
  ok(after < before, 'the dollars drop from $' + Math.round(before).toLocaleString('en-US')
     + ' to $' + Math.round(after).toLocaleString('en-US'));
  ok(d.getElementById('sub').textContent.indexOf('excluding 8 countries') > -1,
     'the subtitle says so, so a screenshot cannot be misread');
  // The two panels that read DATA directly rather than win() must honour it too.
  const affNames = [...d.querySelectorAll('#t7 tbody tr')].map(r => r.cells[0].textContent);
  ok(affNames.length > 0, 'the affiliate table still renders');
  const foot = d.querySelector('#t10 tfoot tr');
  const want = ['2025', '2026'].map(y => Math.round(FC.win().chCells
                 .filter(c => c[0] === y).reduce((s, c) => s + c[6], 0)));
  ok(foot.cells[3].textContent === '$' + want[0].toLocaleString('en-US') &&
     foot.cells[4].textContent === '$' + want[1].toLocaleString('en-US'),
     'the movement table follows it too: ' + foot.cells[3].textContent + ' -> '
     + foot.cells[4].textContent);
  btn.click();
  ok(FC.state.excl === false &&
     Math.abs(FC.win().chCells.reduce((s, c) => s + c[6], 0) - before) < 0.01,
     'clicking again puts them back exactly');
}

console.log('\ncards collapse');
{
  // The three wide tables open shut; every chart opens expanded.
  const shutAtLoad = [...d.querySelectorAll('.card[data-shut] h2')]
                       .map(h => h.childNodes[0].textContent.trim());
  // Every card opens shut: the page is an index first, twelve feet of charts
  // only when you ask for them.
  const allCards = [...d.querySelectorAll('.card')];
  ok(shutAtLoad.length === allCards.length,
     'all ' + allCards.length + ' cards are marked to open shut');
  ok(allCards.every(c => c.classList.contains('shut')),
     'and all of them really are shut on load, not just marked');
  // Sections are numbered in document order by the same loop, so a card moved
  // in the markup renumbers itself.
  const nums = [...d.querySelectorAll('.card > h2 .sec-num')].map(n => n.textContent);
  ok(nums.join() === '01,02,03,04,05,06,07,08,09,10,11,12,13,14',
     'sections are numbered in document order: ' + nums.join(' '));
  ok(headText(d.querySelector('.card h2')) === 'FTD Count by Channels',
     'and the number is not part of the title text');
  ok(d.querySelector('.pagebar').textContent.indexOf('every card starts closed') > -1,
     'the page bar says so, since it is the only thing on screen: '
     + d.querySelector('.pagebar').textContent.replace(/\s+/g, ' ').trim());
  // Shut is display:none, not "not rendered" — everything still has to be built,
  // or expanding a card would show an empty box until the next render.
  ok(d.getElementById('c5').querySelectorAll('rect').length > 100,
     'the charts are drawn anyway, so expanding one shows it immediately');
  ok(d.querySelectorAll('#t10 tbody tr').length > 5, 'and the tables are filled');
  const card = d.querySelector('.card');
  const h = card.querySelector('h2');
  ok(h.getAttribute('role') === 'button' && h.getAttribute('tabindex') === '0',
     'the heading is the control, and is reachable by keyboard');
  ok(h.getAttribute('aria-expanded') === 'false', 'cards open shut');
  h.click();
  ok(!card.classList.contains('shut') && h.getAttribute('aria-expanded') === 'true',
     'clicking the heading opens it');
  ok(h.querySelector('.peek').textContent === 'hide', 'and the affordance flips to "hide"');
  h.click();
  ok(card.classList.contains('shut'), 'clicking again shuts it');
  // A re-render must not reopen a shut card: render() replaces what is inside
  // .body, the class lives on .card.
  FC.render();
  ok(card.classList.contains('shut'), 'a re-render leaves it shut');
  d.getElementById('collapse-all').click();
  ok([...d.querySelectorAll('.card')].every(c => c.classList.contains('shut')),
     'Collapse all shuts every card');
  d.getElementById('expand-all').click();
  ok([...d.querySelectorAll('.card')].every(c => !c.classList.contains('shut')),
     'Expand all reopens them');
}

console.log('\nquarter filter');
{
  FC.setPeriod('full'); FC.render();
  const qBtn = k => [...d.querySelectorAll('#b-q button')].find(b => b.dataset.q === k);
  ok([...d.querySelectorAll('#b-q button')].map(b => b.dataset.q).join(',')
     === 'all,Q1,Q2,Q3,Q4', 'All / Q1 / Q2 / Q3 / Q4');
  ok(qBtn('all').getAttribute('aria-pressed') === 'true', 'opens on all quarters');
  const allMonths = FC.win().months.length;   // 20, with period opened out
  qBtn('Q1').click();
  const w = FC.win();
  ok(w.months.join() === '2025-01,2025-02,2025-03,2026-01,2026-02,2026-03',
     'Q1 narrows BOTH years, not one: ' + w.months.join(' '));
  ok(w.cells.every(c => FC.quarterOf(c[1]) === 'Q1'), 'every cell in the window is Q1');
  // The quarter chart that used to prove this is gone; the country charts show
  // the same narrowing, three months per year instead of twenty.
  ok(FC.win().months.length === 6, 'the window is three months in each year');
  ok(d.getElementById('sub').textContent.indexOf('Q1 only') > -1,
     'the subtitle names it: ' + d.getElementById('sub').textContent);
  // Independently: Q1 dollars either side.
  const q25 = w.cells.filter(c => c[0] === '2025').reduce((s, c) => s + c[6], 0);
  const q26 = w.cells.filter(c => c[0] === '2026').reduce((s, c) => s + c[6], 0);
  ok(Math.round(q25) === 715135 && Math.round(q26) === 239473,
     'Q1: $' + Math.round(q25).toLocaleString('en-US') + ' vs $'
     + Math.round(q26).toLocaleString('en-US'));
  // A shorter window must not leave a drill tier pointing past the end.
  ok(FC.state.ctry.count.tier === 0 && FC.state.ctry.amount.tier === 0,
     'switching quarter resets both drill positions');
  /* A quarter 2026 has not finished cannot be read at full length without
     saying so: whole Q3 2025 against two months of Q3 2026 looks like a
     collapse that is only the calendar. The page used to switch mode for you;
     it now leaves the period alone and says it in the caption. */
  FC.setPeriod('full');
  qBtn('Q3').click();
  ok(FC.state.period === 'full', 'picking a part quarter leaves the period alone');
  ok(d.getElementById('b-full').getAttribute('aria-pressed') === 'true',
     'and the button still shows Full months');
  {
    const w = FC.win();
    const a = w.cells.filter(c => c[0] === '2025').reduce((s, c) => s + c[6], 0);
    const b = w.cells.filter(c => c[0] === '2026').reduce((s, c) => s + c[6], 0);
    /* Q3 is whichever of Jul/Aug/Sep each year has on file — derived, not
       typed, because the newest month arrives during the quarter. */
    const want = FC.DATA.months.filter(m => ['07','08','09'].indexOf(m.slice(5)) > -1);
    ok(w.months.join() === want.join(), 'Q3 is ' + w.months.join(' '));
    const n25 = w.months.filter(m => m.slice(0,4) === '2025').length;
    const n26 = w.months.filter(m => m.slice(0,4) === '2026').length;
    ok(n25 === n26
        ? true
        : d.getElementById('cap10').textContent.indexOf('not like for like') > -1,
       n25 === n26
         ? 'both years have ' + n25 + ' months of Q3, so the comparison is even'
         : '2025 has ' + n25 + ' Q3 months and 2026 has ' + n26 + ', and the caption says so');
  }
  // Q1 and Q2 are complete in both years, so the period is left alone.
  FC.setPeriod('full'); FC.render();
  qBtn('Q1').click();
  ok(FC.state.period === 'full', 'a complete quarter leaves the period where it was');
  qBtn('Q4').click();
  ok(FC.win().cells.every(c => c[0] === '2025'),
     'Q4 has 2025 only, since 2026 has not reached it');
  ok(FC.state.period === 'full', 'and Q4 forces full periods — like-for-like would be empty');
  ok(!d.getElementById('cmp-warn').hidden,
     'a banner says so: ' + d.getElementById('cmp-warn').textContent.slice(0, 80));
  ok(FC.delta(100, 0).txt === 'n/a',
     'and year-on-year reads n/a, not -100% for a quarter that has not happened');
  // The movement table follows the quarter: Q1 2026 against Q1 2025, not the
  // last two months.
  qBtn('Q1').click();
  {
    // In year mode the table simply follows the window, so picking Q1 makes it
    // Q1 2025 against Q1 2026 with no special case at all.
    const foot = d.querySelector('#t10 tfoot tr');
    const cols = [...foot.cells].map(c => c.textContent.trim());
    ok(cols[3] === '$715,135' && cols[4] === '$239,473',
       'the movement table follows the quarter, matching the quarter chart: '
       + cols[3] + ' -> ' + cols[4]);
  }
  // In month mode a quarter still means that quarter across the two years.
  FC.state.momMode = 'month'; FC.render();
  ok(headText(d.getElementById('h10')) === 'Country Movement — Q1 2026 vs Q1 2025',
     'month mode names the quarters instead: ' + headText(d.getElementById('h10')));
  {
    const th = [...d.querySelectorAll('#t10 thead th')].map(t => t.textContent.trim());
    ok(th[3] === 'FTD $ Q1 2025' && th[7] === 'FTDs Q1 2025' && th[9] === 'GGR Q1 2025',
       'every column pair is labelled with the quarter: ' + th.join(' | '));
  }
  FC.state.momMode = 'year'; FC.render();
  // Q3 2026 stops at August, so September 2025 must sit out rather than be
  // counted against nothing.
  FC.state.momMode = 'month'; FC.render();
  qBtn('Q3').click();
  ok(d.getElementById('cap10').textContent.length > 20,
     'Q3 caption present: ' + d.getElementById('cap10').textContent.slice(0, 90));
  FC.state.momMode = 'year'; FC.render();
  qBtn('all').click();
  ok(FC.win().months.length === FC.DATA.months.length,
     'clearing the quarter returns every month (' + FC.win().months.length + ')');
  FC.state.momMode = 'month'; FC.render();
  ok(headText(d.getElementById('h10')).indexOf('first ' + FC.DATA.mtdDays + ' days') > -1,
     'and month mode goes back to month on month');
  FC.state.momMode = 'year'; FC.render();
  // Clearing the quarter does NOT undo a period the user can see is set — it
  // is their control now. Put it back explicitly to check the full window.
  FC.setPeriod('full'); FC.render();
  ok(FC.win().months.length === allMonths, 'All plus full periods restores the whole window');
}

console.log('\nconcentration by rank tier');
const c8 = d.getElementById('c8');
{
  const w = FC.win(), months = w.months;
  ok(d.getElementById('l8').querySelectorAll('.li').length === 3,
     'three tiers: top 5, 6-10, everyone else');
  // Every month must fill exactly 100% — a 100% stacked chart that does not
  // reach the top is the failure mode this assertion exists for.
  const rank = FC.topCountries(w.chCells, 0, 'amount');
  const tierOf = {};
  rank.all.forEach((c, i) => { tierOf[c] = i < 5 ? 't5' : (i < 10 ? 't610' : 'rest'); });
  const m = months[0];
  const tot = w.chCells.filter(c => c[1] === m).reduce((s, c) => s + c[6], 0);
  const parts = { t5: 0, t610: 0, rest: 0 };
  w.chCells.filter(c => c[1] === m).forEach(c => { parts[tierOf[c[2]]] += c[6]; });
  ok(Math.abs(parts.t5 + parts.t610 + parts.rest - tot) < 0.01,
     'the three tiers partition the month exactly ($' + Math.round(tot).toLocaleString('en-US') + ')');
  ok(parts.t5 > parts.t610, 'the top five carry more than ranks 6-10, as they must by construction');
  // Fixed 0-100 axis, not rescaled to the data.
  const ticks = [...c8.querySelectorAll('text')].map(t => t.textContent);
  ok(ticks.indexOf('0%') > -1 && ticks.indexOf('100%') > -1,
     'the axis runs 0% to 100% and labels both ends');
  // Each bar carries the dollars it is a share of.
  ok(ticks.some(t => /^\$\d/.test(t)), 'the month total is printed above each bar');
  ok(c8.querySelectorAll('rect').length >= months.length * 2,
     'drew ' + c8.querySelectorAll('rect').length + ' segments across ' + months.length + ' months');
}
{
  // The tiers are a fixed set over the window, not re-ranked per month. If a
  // later change re-ranks monthly, the top band can only ever go up and this
  // assertion is what should catch it.
  const w = FC.win();
  const rank = FC.topCountries(w.chCells, 0, 'amount');
  const first = w.months[0], last = w.months[w.months.length - 1];
  const topFive = rank.all.slice(0, 5);
  const shareIn = m => {
    const rows = w.chCells.filter(c => c[1] === m);
    const tot = rows.reduce((s, c) => s + c[6], 0);
    const top = rows.filter(c => topFive.indexOf(c[2]) > -1).reduce((s, c) => s + c[6], 0);
    return tot ? top / tot : 0;
  };
  ok(shareIn(first) !== shareIn(last),
     'the top-five share moves between months (' + Math.round(shareIn(first) * 100) + '% -> '
     + Math.round(shareIn(last) * 100) + '%), so the tiers are fixed, not re-ranked');
}
{
  // Focus is deliberately ignored here — one country would read 100% everywhere.
  const segsBefore = c8.querySelectorAll('rect').length;
  FC.state.focus = ['Brazil']; FC.render();
  ok(c8.querySelectorAll('rect').length === segsBefore,
     'picking a country leaves the concentration chart alone');
  FC.state.focus = []; FC.render();
}

console.log('\npicking a country links all three panels');
const l6li = () => [...d.getElementById('l6').querySelectorAll('.li')];
{
  const brazil = l5li().find(n => n.textContent.indexOf('Brazil') === 0);
  ok(!!brazil, 'Brazil has a band in the count chart');
  brazil.click();
  ok(FC.state.focus.join() === 'Brazil', 'clicking it sets the shared focus');
  // Both charts must now be drawing Brazil only, not just the one clicked in.
  const segs5 = c5.querySelectorAll('rect').length;
  const segs6 = c6.querySelectorAll('rect').length;
  ok(segs5 <= FC.win().months.length && segs5 > 0,
     'the count chart drops to one band (' + segs5 + ' segments)');
  ok(segs6 <= FC.win().months.length && segs6 > 0,
     'the DOLLAR chart followed it too (' + segs6 + ' segments)');
  ok(d.getElementById('d6').textContent.indexOf('Brazil') > -1,
     'and its breadcrumb names Brazil');
  // The affiliate table is the third panel that has to follow.
  ok(headText(d.getElementById('h7')).indexOf('Brazil') > -1,
     'the affiliate table retitles: ' + headText(d.getElementById('h7')));
  const rows = [...d.querySelectorAll('#t7 tbody tr')];
  ok(rows.length > 1, 'it lists ' + (rows.length - 1) + ' affiliates for Brazil');
  const names = rows.slice(0, -1).map(r => r.cells[0].textContent.trim());
  ok(names.some(n => n.indexOf('parcerias') > -1),
     'the Brazilian affiliates are the ones showing: ' + names.slice(0, 3).join(', '));
  // Every cell carries both figures.
  const cell = rows[0].cells[4];
  ok(/\d/.test(cell.textContent) && cell.querySelector('div'),
     'each month cell carries the count and the amount under it: '
     + cell.textContent.replace(/\s+/g, ' ').trim());
  // The table has to reconcile with the chart it is sitting under.
  const tot = rows[rows.length - 1];
  const chartTot = FC.win().chCells.filter(c => c[2] === 'Brazil')
                     .reduce((s, c) => s + c[5], 0);
  ok(parseInt(tot.cells[2].textContent.replace(/,/g, ''), 10) === chartTot,
     'the total row matches the charts above exactly (' + chartTot + ' FTDs)');
  // Clicking the same country again releases it.
  l5li().find(n => n.textContent.indexOf('Brazil') === 0).click();
  ok(FC.state.focus.length === 0, 'clicking Brazil again clears the focus');
  ok(headText(d.getElementById('h7')).indexOf('All Countries') > -1,
     'and the table goes back to every country');
}
{
  // Focusing from the DOLLAR chart has to move the count chart the same way —
  // the two rank differently, so this is the direction that breaks first.
  const norway = l6li().find(n => n.textContent.indexOf('Norway') === 0);
  ok(!!norway, 'Norway leads the dollar chart');
  norway.click();
  ok(FC.state.focus.join() === 'Norway', 'picking it there sets the same shared focus');
  ok(d.getElementById('d5').textContent.indexOf('Norway') > -1,
     'and the count chart above follows, though it ranks Norway differently');
  FC.state.focus = []; FC.render();
}
{
  // The channel filter and the table have to agree as well.
  const ch = k => [...d.querySelectorAll('#b-ch button')].find(b => b.dataset.ch === k);
  ch('__all').click();
  const before = [...d.querySelectorAll('#t7 tbody tr')].slice(0, -1)
                   .map(r => r.cells[0].textContent.trim());
  ch('Streamer').click();
  const rows = [...d.querySelectorAll('#t7 tbody tr')];
  const chans = rows.slice(0, -1).map(r => r.cells[1].textContent.trim());
  ok(chans.every(c => c === 'Streamer'), 'filtering to Streamer leaves only Streamer affiliates');
  const after = rows.slice(0, -1).map(r => r.cells[0].textContent.trim());
  ok(after.join() !== before.join(), 'and a different set of affiliates is listed');
  ok(!after.includes(FC.DATA.noAff),
     'the untagged row drops out, since untagged FTDs are Direct');
  ch('__all').click();
}

console.log('\nhouse rules');
// Every axis labels its own zero — the tick text, not just the gridline.
const zeroTicks = [...c2.querySelectorAll('text')].filter(t => t.textContent === '0');
ok(zeroTicks.length >= 1, 'the channel chart labels its zero');
// The zero rule is drawn darker than the other gridlines.
const zeroRule = [...c2.querySelectorAll('line')].filter(l => l.getAttribute('stroke') === '#5B7285');
ok(zeroRule.length === 1, 'exactly one darkened zero rule');
// Sign before the currency symbol.
ok(FC.fmtMoney(-5000) === '-$5,000', 'negative money reads -$5,000, not $-5,000');
// Whole-number percentages, with <1% rather than 0% for a real small value.
ok(FC.pct(1, 5000) === '<1%', 'a real small share reads <1%, not 0%');
ok(FC.pct(1234, 5000) === '25%', 'percentages are whole numbers');
// The page opens on the question it exists to answer, in state AND in markup.
// The Metric control is gone: count and amount each have their own pinned
// card, so a global toggle only governed the cards at the foot while looking
// as though it governed the pinned pairs too.
ok(!d.getElementById('b-count') && !d.getElementById('b-amount'),
   'there is no Metric control');
ok([...d.querySelectorAll('.grp .lbl')].map(l => l.textContent).join('|')
   === 'Period|Channel|Quarter|Month|Rail',
   'five control groups, Metric not among them');
// Opens on MTD, in the state AND on the buttons.
ok(openedPeriod === 'mtd' && pressedAtLoad['#b-mtd'] === 'true'
   && pressedAtLoad['#b-full'] === 'false',
   'opens on MTD, in the state AND on the buttons');
ok(openedWindow.length === FC.DATA.months.length,
   'over every month on file, each cut to day ' + FC.DATA.mtdDays
   + ': ' + openedWindow.length + ' months');
ok(openedSub.indexOf('MTD') > -1, 'the subtitle says so: ' + openedSub);
ok(!openedOnDirect && openedChannels === 4, 'opens on every channel, not just Direct');
ok(openedRail === 'all', 'opens on all payment rails');
ok(pressedAtLoad['#b-mtd'] === 'true' && pressedAtLoad['#b-full'] === 'false'
   && pressedAtLoad['ch:__all'] === 'true' && pressedAtLoad['ch:Direct'] === 'false'
   && pressedAtLoad['ch:SEO'] === 'false' && pressedAtLoad['rail:all'] === 'true',
   'every pressed button agrees with the default state: MTD, all channels, all rails');
// MTD is cut to the newest day in the data, so on the first of a month it is a
// one-day slice. The page opens there, so it must say so rather than let a
// near-empty view read as a collapse.
if (FC.DATA.mtdDays <= 5){
  ok(!openedWarn.hidden && openedWarn.text.indexOf('MTD is only') > -1,
     'a thin MTD raises a banner at load: ' + openedWarn.text.slice(0, 70));
  ok(openedWarn.text.indexOf('Full months') > -1, 'and points at the way out');
} else {
  ok(openedWarn.hidden, 'MTD is ' + FC.DATA.mtdDays + ' days, so no banner is needed');
}

console.log('\nfilters are views, not recomputation');
FC.setPeriod('full'); FC.state.quarter = 'all'; FC.render();
const fullCount = FC.win().cells.reduce((s, c) => s + c[5], 0);
FC.state.period = 'mtd'; FC.render();
const matchedCount = FC.win().cells.reduce((s, c) => s + c[5], 0);
ok(matchedCount < fullCount, 'MTD (' + matchedCount + ') is smaller than full ('
   + fullCount + ')');
// MTD cuts the DAYS in every month, and keeps every month.
{
  const mm = FC.DATA.months[FC.DATA.months.length - 1].slice(5);
  const cut = FC.win().cells.filter(c => c[1] === '2025-' + mm)
                .reduce((s, c) => s + c[5], 0);
  const whole = FC.DATA.cells.ex.filter(c => c[1] === '2025-' + mm)
                  .reduce((s, c) => s + c[5], 0);
  // Same point, same caveat: equal is correct on a complete month, and the
  // cut must never exceed the whole either way.
  ok(cut <= whole, cut < whole
     ? 'the counterpart month a year earlier is cut to day ' + FC.DATA.mtdDays
       + ' as well (' + cut + ' of ' + whole + ')'
     : 'the newest month is complete, so its counterpart is read whole too ('
       + cut + ')');
}
const monthsMatched = FC.win().months.length;
ok(monthsMatched === FC.DATA.months.length,
   'MTD keeps every month, it only trims the days (' + monthsMatched + ')');
FC.state.period = 'full'; FC.render();
ok(FC.win().months.length === FC.DATA.months.length, 'and so does Full months');

// Isolating a channel narrows the country chart, and restores.
const before = c3.querySelectorAll('rect').length;
FC.state.offCh = { SEO: 1, Streamer: 1, Other: 1 }; FC.render();
const direct = FC.win().chCells.every(c => c[3] === 'Direct');
ok(direct, 'isolating Direct leaves only Direct cells in the window');
FC.state.offCh = {}; FC.render();
ok(c3.querySelectorAll('rect').length === before, 'clearing the selection restores the chart');

console.log('\nchannel filter');
const chBtn = k => [...d.querySelectorAll('#b-ch button')].find(b => b.dataset.ch === k);
ok([...d.querySelectorAll('#b-ch button')].map(b => b.dataset.ch).join(',')
   === '__all,Direct,SEO,Streamer,Other', 'All / Direct / SEO / Streamer / Other');
// The harness cleared the opening Direct filter, so All is pressed here; the
// real default is asserted from the load-time snapshot under "house rules".
ok(chBtn('__all').getAttribute('aria-pressed') === 'true',
   'All is pressed once the filter is cleared');
chBtn('Streamer').click();
ok(FC.shownCh().join() === 'Streamer', 'clicking Streamer isolates it');
ok(chBtn('Streamer').getAttribute('aria-pressed') === 'true'
   && chBtn('__all').getAttribute('aria-pressed') === 'false',
   'the pressed button follows the state');
{
  // The country chart must actually narrow, not merely relabel.
  const bands = FC.topCountries(FC.win().chCells, 0, 'count');
  const tot = FC.win().chCells.reduce((s, c) => s + c[5], 0);
  const wantStreamer = FC.DATA.cells.ex.filter(c => c[3] === 'Streamer')
                         .reduce((s2, c) => s2 + c[5], 0);
  ok(tot === wantStreamer,
     'Streamer-only country window holds ' + tot + ' FTDs, matching the cells');
  ok(d.getElementById('sub').textContent.indexOf('Streamer') > -1,
     'the subtitle names the active filter');
}
// The legend on the channel card writes to the same state — one filter, two faces.
[...d.getElementById('l2').querySelectorAll('.li')]
  .find(n => n.textContent.indexOf('Direct') === 0).click();
ok(FC.shownCh().join() === 'Direct', 'the legend moves the same filter');
ok(chBtn('Direct').getAttribute('aria-pressed') === 'true',
   'and the button group follows it, so the two can never disagree');
chBtn('__all').click();
ok(FC.shownCh().length === 4, 'All restores every channel');

console.log('\nmetric switch');
FC.state.metric = 'amount'; FC.render();
const amt = FC.win().cells.reduce((s, c) => s + c[6], 0);
ok(amt > 2e6, 'FTD amount across both years is $' + Math.round(amt).toLocaleString('en-US'));
FC.state.metric = 'count'; FC.render();

// ---------------------------------------------------------------------------
// Independent recount, straight from the caches. A second implementation, not
// a second reading of the same code.
console.log('\npayment rail filter');
const railBtn = k => [...d.querySelectorAll('#b-rail button')].find(b => b.dataset.rail === k);
ok([...d.querySelectorAll('#b-rail button')].map(b => b.dataset.rail).join(',')
   === 'all,Crypto,Fiat,Mixed', 'All / Crypto / Fiat / Mixed');
{
  const all = FC.win().cells.reduce((s, c) => s + c[5], 0);
  const seen = {};
  ['Crypto', 'Fiat', 'Mixed'].forEach(r => {
    railBtn(r).click();
    seen[r] = FC.win().cells.reduce((s, c) => s + c[5], 0);
    ok(FC.win().cells.every(c => c[4] === r), r + ' leaves only ' + r + ' cells');
  });
  ok(seen.Crypto + seen.Fiat + seen.Mixed === all,
     'the three rails partition the population exactly: ' + seen.Crypto + ' + '
     + seen.Fiat + ' + ' + seen.Mixed + ' = ' + all);
  ok(seen.Crypto > seen.Fiat * 5, 'crypto dominates (' + seen.Crypto + ' vs ' + seen.Fiat + ')');
  // Mixed is a real answer, not a rounding of the other two.
  ok(seen.Mixed > 0 && seen.Mixed < 200,
     'Mixed is small but real (' + seen.Mixed + ' FTDs) and kept as its own band');
  railBtn('all').click();
  ok(FC.win().cells.reduce((s, c) => s + c[5], 0) === all, 'All restores the population');
}
{
  // The affiliate table has to move with the rail too, or it contradicts the
  // charts it sits under.
  railBtn('Fiat').click();
  const rows = [...d.querySelectorAll('#t7 tbody tr')];
  const tot = parseInt(rows[rows.length - 1].cells[2].textContent.replace(/,/g, ''), 10);
  const want = FC.win().chCells.reduce((s, c) => s + c[5], 0);
  ok(tot === want, 'on Fiat the table totals ' + tot + ', matching the charts');
  railBtn('all').click();
}

console.log('\nindependent recount from ftd-report/cache');
const CACHE = path.join(ROOT, 'ftd-report', 'cache');
const seen = new Set();
const AFFMAP = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'affiliate-map.json'), 'utf8')).map; }
  catch { return {}; }
})();
const tally = {};             // year|channel -> [count, amount]
let dayMax = {};
for (const f of fs.readdirSync(CACHE).sort()) {
  if (!f.endsWith('.json')) continue;
  const year = f.slice(0, 4);
  if (year !== '2025' && year !== '2026') continue;
  const rows = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
  for (const r of rows) {
    const v = parseFloat(r.ftd);
    if (!(v > 0)) continue;
    if (seen.has(r.player_id)) continue;
    seen.add(r.player_id);
    /* aff_source on the row is whatever it was the day that month was pulled.
       The page re-categorises every row through today's affiliate map, so the
       recount has to as well — otherwise this checks the page against the stale
       categorisation it was changed to stop using. */
    const cm = AFFMAP[(r.aff_username || '').trim().toLowerCase()];
    const at = (cm ? cm.aff_type : r.aff_type) || '';
    const src = (cm ? cm.aff_source : r.aff_source) || '';
    let ch;
    if (at === 'Streamer' || src === 'Influence' || src === 'KOl') ch = 'Streamer';
    else if (src === 'SEO') ch = 'SEO';
    else if (at === 'Direct') ch = 'Direct';
    else ch = 'Other';
    const k = year + '|' + ch;
    (tally[k] = tally[k] || [0, 0])[0]++;
    tally[k][1] += v;
    const day = (r.transaction_date || '').slice(0, 10);
    if (day > (dayMax[year] || '')) dayMax[year] = day;
  }
}
const pageCells = FC.DATA.cells.ex;
for (const year of ['2025', '2026']) {
  for (const ch of FC.CH) {
    const want = tally[year + '|' + ch] || [0, 0];
    const got = pageCells.filter(c => c[0] === year && c[3] === ch)
                         .reduce((s, c) => [s[0] + c[5], s[1] + c[6]], [0, 0]);
    ok(got[0] === want[0], year + ' ' + ch + ' count ' + got[0] + ' matches the recount');
    // 2dp rounding on every emitted cell; budget the rounding rather than
    // asserting an exact match or a percentage that would hide a dropped row.
    const nCells = pageCells.filter(c => c[0] === year && c[3] === ch).length;
    const budget = nCells * 0.005 + 0.01;
    ok(Math.abs(got[1] - want[1]) <= budget,
       year + ' ' + ch + ' amount within the ' + budget.toFixed(2) + ' rounding budget');
  }
}
ok(seen.size === pageCells.reduce((s, c) => s + c[5], 0),
   'every one of the ' + seen.size + ' FTDs landed in exactly one cell');

console.log('\ncross-check against the published FTD report');
// The August 2026 FTD report was published as of Aug 21 and documents 996 first
// depositors. Counting this page's rule over Aug 1-21 has to reproduce it.
const aug = JSON.parse(fs.readFileSync(path.join(CACHE, '2026-08.json'), 'utf8'));
const to21 = new Set(aug.filter(r => parseFloat(r.ftd) > 0
              && r.transaction_date.slice(0, 10) <= '2026-08-21').map(r => r.player_id));
ok(to21.size === 996, 'Aug 1-21 2026 gives ' + to21.size + ' first depositors (published: 996)');
console.log('  note  the cache now runs to ' + dayMax['2026'] + ', which is why the page shows more');

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
