# Testing a built report

Two layers, and they catch different things.

**The arithmetic** — recompute the headline figures straight from the cache rows
with a second, independent implementation and compare. A second reading of the
same code finds nothing; a second implementation finds the bug.

**The page** — render the built HTML in a headless DOM and read it back. A chart
that renders empty, a script that dies halfway, a legend that never populates:
none of these are visible to any check on the aggregation, and all of them ship
a page that looks broken to the reader and fine to the builder.

```
npm install jsdom
node test_<name>.js
```

## The harness

```js
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '<name>.html'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

const errors = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
dom.virtualConsole.on('jsdomError', e => errors.push(e.message));
const d = dom.window.document;
const OV = dom.window.OV;          // the explicit export — see below

ok(errors.length === 0, 'script ran without errors' + (errors.length ? ': ' + errors[0] : ''));

// ... checks ...

console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
```

Group checks under `console.log('\nsection')` headings. The output gets read by
a human far more often than its exit code gets read by a machine, so make it
scannable and put the actual numbers in the messages — `'$117,789/day'` tells
you something the next time it changes; `'ok'` does not.

## `window.OV` — the page has to hand itself over

`const` at the top level of a classic script is **script-scoped**: it never
becomes a property of `window`. Neither the test nor the console can see
`state`, `win()` or the chart configs unless the page hands them over on
purpose:

```js
window.OV = { DATA, state, win, render, setMtd, setWhale, setGran,
              currentWindow, playersChart, moneyChart, /* ... */ };
```

The same rule bites inside a page with several `<script>` blocks — a helper
defined in block 2 is invisible in block 7, which fails silently with an empty
fallback rather than an error. Anything crossing a boundary goes on `window`.

## What is worth asserting

Not coverage — **decisions someone might undo**. Each of these encodes a
judgement call, so the assertion doubles as the explanation of why the code
looks the way it does.

**It renders at all**

```js
ok(d.querySelectorAll('.card').length === 7, 'seven chart cards');
ok(svg.querySelectorAll('rect[fill^="#"]').length > 15, 'bars drawn');
ok(svg.querySelectorAll('.hit').length === w.n, 'one hover band per point');
```

**House rules**

```js
const left = [...svg.querySelectorAll('text[text-anchor="end"]')].map(t => t.textContent);
ok(left.includes('0') || left.includes('$0'), 'left axis labels its zero');
ok(OV.money(-5000) === '-$5,000', 'sign before the currency symbol');
```

**Counting**

```js
ok(rowSum > w.distBet, 'category rows exceed distinct bettors — multi-category counted once');
ok(daySum > w.distDep, 'daily bars exceed distinct depositors — repeat depositors counted once');
ok(M.distDep < monthlySum * 0.8, 'range distinct is well below the sum of monthly distincts');
ok(M.distDep === OV.DATA.range.ex.full.dep, 'and is read from the builder, not derived');
```

**Reconciliation, against the rounding budget**

```js
const budget = (w.n * (w.betCats.length + 2)) * 0.005;   // half a cent per rounded value
ok(Math.abs(catTotal + uncat - dayTotal) <= budget, 'parts equal the whole, within rounding');
```

`< 0.01` on 168 rounded values fails on 6 cents of rounding and looks like a
data bug. A percentage tolerance hides a real dropped row. Compute the budget
from how many values were rounded.

**Things that must stay different** — the strongest assertions in the suite,
because they stop a plausible-looking "fix":

```js
ok(Math.abs(weighted - naiveMean) > 0.1,
   'weighted total differs from the naive mean — so a mean would be wrong here');
ok(Math.abs(derived - adjSum) > 1,
   'adjusted GGR is not raw GGR minus bonus cost');
```

**Defaults, in both places**

```js
ok(OV.state.gran === 'month', 'opens in the months view');
ok(d.getElementById('bMonth').getAttribute('aria-pressed') === 'true', 'and the button agrees');
```

A default set in `state` but not in the markup renders buttons that lie on load.

**Filters actually filter**

```js
d.getElementById('bInc').click();
ok(after !== before, 'headline responds to the whale toggle');
ok(incW.distDep === w.distDep + 1, 'and adds exactly one distinct depositor');
```

## jsdom's limits

- **`getBoundingClientRect()` returns zeros.** Anything resolving pointer
  position to chart geometry can't run. Guard on `if (!box.height) return;`,
  assert the handler is wired, and tell the user that path needs a real browser.
- **`clientWidth` is 0**, so charts fall back to their default width. Fine for
  structural checks; to test a specific width, `Object.defineProperty` the
  container's `clientWidth` and re-render.
- **Re-render after changing state directly.** `OV.state.ym = '2026-08'` alone
  leaves the DOM showing the previous month — the legend and totals are built by
  `render()`. A test that forgets this fails on a difference it created itself.
- Colour-based selectors catch more than intended once white label plates are
  rects too. Filter by the series colours rather than `rect[fill^="#"]`.

## Extracting the real SVG for a look

To see what actually rendered without a browser, run the page in jsdom at a
chosen width and write the SVG out:

```js
Object.defineProperty(d.querySelector('.chartbox'), 'clientWidth', { get: () => 1400 });
OV.render();
fs.writeFileSync('/tmp/chart.svg', d.getElementById('chartMoney').outerHTML);
```

Useful for checking label arithmetic against the source arrays — read the drawn
figures back and compare them to `w.depAmount` rather than trusting the eye.
