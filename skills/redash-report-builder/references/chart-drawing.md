# Drawing the charts

Hand-written SVG, no libraries — the pages are standalone and have no network.
Two drawers cover everything these reports need. Both take a config object, so
adding a chart means writing a config, not another drawer.

`C:\redash-page\overview\overview-template.html` is the worked example.

## Contents

- [The config contract](#the-config-contract)
- [Stacked bars, with signed stacking](#stacked-bars-with-signed-stacking)
- [The second axis](#the-second-axis)
- [Lines, for ratios](#lines-for-ratios)
- [Value labels](#value-labels)
- [Isolate on click](#isolate-on-click)
- [The window object](#the-window-object)

## The config contract

Both drawers read the same fields, so a chart can change form without its
caller changing:

```js
{
  key:       'money',            // names the per-chart hidden-series set
  svgId:     'chartMoney',
  legendId:  'legMoney',
  totalsId:  'totMoney',
  totals:    [[label, value, isNegative?], ...],   // headline strip
  days:      [...],              // one entry per point, whatever a point is
  labelAt:   i => '...',         // x tick label
  axisTitle: 'day of August 2026',
  pointName: i => '...',         // tooltip heading
  leftFmt:   moneyShort,         // also selects the left gutter width
  rightFmt:  fmt,
  stacks:    [{key,label,color,values,legendValue}, ...],   // bars
  series:    [{key,label,color,values,emphasis}, ...],      // lines
  line:      {label,values,legendValue} | null,             // bar overlay
  tip:       (i, shown, showLine) => html
}
```

`labelAt` / `axisTitle` / `pointName` come from the window object (below), which
is what lets one config serve both the daily and the monthly view.

## Stacked bars, with signed stacking

Positive and negative segments stack in **opposite directions** from the zero
rule. GGR and NGR both go negative — clamping to zero, or letting a negative
stack on top of the positives, are both lies about the data.

```js
const posTot = days.map((_,i) => shown.reduce((s,d) => s + Math.max(0, d.values[i]), 0));
const negTot = days.map((_,i) => shown.reduce((s,d) => s + Math.min(0, d.values[i]), 0));
const maxBar = Math.max(0, ...posTot) || 1;
const minBar = Math.min(0, ...negTot);

const stepL = niceStep(Math.max(maxBar - minBar, 1e-9), 5);
const topL  = Math.ceil(maxBar/stepL)*stepL || stepL;
const botL  = Math.floor(minBar/stepL)*stepL;
const yL    = v => PAD.t + ih - ((v - botL)/(topL - botL))*ih;
```

Then per point, two accumulators:

```js
let accPos = 0, accNeg = 0;
shown.forEach(st => {
  const v = st.values[i];
  if (!v) return;
  const base = v > 0 ? accPos : accNeg;
  const y0 = yL(base), y1 = yL(base + v);
  rect(x, Math.min(y0,y1), barW, Math.abs(y1-y0), st.color);
  if (v > 0) accPos += v; else accNeg += v;
});
```

`niceStep` anchors ticks to multiples of a step size so **every axis labels its
own zero**. Dividing min-to-max into four ticks produced axes like
`-$200k -$125k -$50k $25k $100k` — a zero line drawn across the plot with no
label near it and every number on the wrong side of it.

Draw the zero gridline darker (`#5B7285`, 1.3px) than the others (`#E5E5E5`,
1px). On a chart with negatives it is the most important line on the plot.

## The second axis

Only when a line overlays bars, and it must be **pinned to the left axis's
zero**:

```js
const botR = topL ? botL * (topR/topL) : 0;
const yR   = v => PAD.t + ih - ((v - botR)/(topR - botR))*ih;
```

Left to itself the right axis puts its zero on the floor while the bars' zero
sits partway up the plot — which once drew a $571k cumulative *underneath* a
$97k bar. Not a rendering quirk: the chart said the opposite of the data.

Prefer no second axis at all. Two scales invite comparisons that aren't real; a
cumulative line also ends 6–13× above the tallest daily bar, flattening every
bar into the floor of the plot when the daily shape was the point.

## Lines, for ratios

A ratio cannot be stacked — adding two percentages is meaningless — and the
total is a **weighted** ratio, not the mean of the category lines. It sits
nearest whichever category carries the volume, which is the correct and useful
behaviour, so make sure a later change can't quietly replace it with a mean.

- Compute the domain across shown series only, always including 0.
- `null` means no data for that point. **Break the line rather than dropping it
  to zero** — a flat zero reads as "players broke even". Accumulate a segment,
  flush it on null, and draw a dot for a lone surviving point.
- Emphasise the total (3px) over the categories (1.8px, 0.9 opacity), and label
  only the emphasised one. Seven labelled lines is a wall of text.

## Value labels

The figures belong on the chart, not only in the tooltip.

- **Day total** just clear of the bar: above `accPos`, or below `accNeg` when
  the point is entirely under water. Red when negative.
- **Segment value** centred inside the block, white at 0.92 opacity, only when
  the block is at least 15px tall and the bar at least 34px wide. A label that
  spills across two colours is worse than no label.
- **Line points** on a white plate (`rx=3`, 0.88 opacity) so they stay readable
  where the line crosses a bar.
- Drop day totals below 30px of band width and segment values below 34px of bar
  width — a 31-day month in a narrow window can't hold them.
- Add headroom (`PAD.t ≈ 26`) or the tallest bar's label is clipped.

One case to skip deliberately: if a stack's height is a row-sum that
double-counts (players by category), don't label the total. A bold number that
contradicts the distinct count beside it is worse than no number.

## Isolate on click

Clicking a series shows **only** that one. Clicking it again restores
everything, and a dashed "Show all" chip appears whenever anything is hidden.
Alt/Cmd/Ctrl-click hides a single series.

Hiding-on-click seems like the natural default and is the wrong one — people
click a thing because they want to look at it.

```js
function pick(cfgKey, allKeys, key, hideOnly){
  const off = state.off[cfgKey];
  if (hideOnly){ off.has(key) ? off.delete(key) : off.add(key); return; }
  const isolated = !off.has(key) && allKeys.every(k => k === key || off.has(k));
  off.clear();
  if (!isolated) allKeys.forEach(k => { if (k !== key) off.add(k); });
}
```

Keep `off` as a set of *hidden* keys rather than switching to a "selected" key:
every chart already draws from it and isolating is just the complement. Keep one
set per chart so isolating on one leaves the others alone.

Clicking a bar works too, but the hover bands sit above the bars so the tooltip
can cover the whole column — which means the click lands on the band. Record
each segment's `{i, key, top, bot}` while drawing and resolve the click from the
pointer's y position:

```js
const box = svg.getBoundingClientRect();
if (!box.height) return;                       // jsdom reports zero; bail
const yUser = (e.clientY - box.top) * (H / box.height);
const seg = segs.find(g => g.i === i && yUser >= g.top - 1 && yUser <= g.bot + 1);
```

That geometry cannot be exercised in jsdom. Test the legend path, assert the
handler is wired, and tell the user the bar click is the bit they should try in
a real browser.

## The window object

One object describes "what a point is", and both drawers plus every config read
from it. That is what makes a days/months switch cheap: build a second window
with the same interface and nothing downstream changes.

```js
{
  isMonths, unit: 'day'|'month', n,
  days, labelAt, pointName, axisTitle,
  depositors, bettors, depAmount, ftd,     // per-point series
  cats, cat(c), betCats, catBet(c), catGgr(c), catNgr(c),
  rails, railAmt(r),
  dayBet, dayGgr, dayNgr, dayAdj, dayBonus,
  uncatBet, uncatGgr, uncatNgr,
  distDep, distBet, distCat(c)             // distinct over the WINDOW
}
```

The `dist*` fields are the trap. In the daily view they read the last element of
a running-distinct array. In the monthly view they **cannot be derived** from
the monthly figures at all — they come from a cross-month union the builder
emits. See SKILL.md §4.

Use `w.unit` in labels (`'Per ' + w.unit`) so "Per day" becomes "Per month"
without a second set of strings.
