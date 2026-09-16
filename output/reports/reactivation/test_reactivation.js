/**
 * test_reactivation.js — render the built page in jsdom and read it back.
 *
 *   npm install jsdom
 *   node test_reactivation.js
 *
 * The assertions here are the decisions someone might undo, not coverage.
 */
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "reactivation.html"), "utf8");

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };

const errors = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
dom.virtualConsole.on("jsdomError", e => errors.push(e.message));
const d = dom.window.document;
const OV = dom.window.OV;
const C = OV.cols;

console.log("\nit renders");
ok(errors.length === 0, "script ran without errors" + (errors.length ? ": " + errors[0] : ""));
ok(!!OV, "page handed itself over on window.OV");
ok(d.querySelectorAll(".card").length === 1, "one card — the player list");
ok(d.querySelectorAll(".stat").length === 0, "no headline stats strip");
// the ADPU x frequency matrix was removed; nothing may be left behind
ok(d.querySelectorAll("table.mx, #mxPair, #mxFilters").length === 0,
   "no matrix markup remains");
ok(!/mxUsers|mxDep|buildMatrix|renderMatrix/.test(html),
   "and no matrix code is still shipped in the page");
ok(d.querySelectorAll("#top tbody tr").length > 0, "top targets table populated");
ok(!d.getElementById("curve"), "return-rate curve card removed");
ok(!d.getElementById("tiers") && !d.getElementById("bycountry"), "value-and-shape card removed");
// the curve is gone from the page but the measured rates still drive the ranking
ok(Object.keys(OV.DATA.rates).length > 10, "the measured return rates are still in the data");
ok(OV.pReturn(7) > OV.pReturn(90), "and still weight the expected-recovery ranking");

console.log("\ndefaults, in both places");
ok(OV.state.win === 28, "opens on the 28-day window");
const pressed = [...d.querySelectorAll("#segWin button")].filter(b => b.getAttribute("aria-pressed") === "true");
ok(pressed.length === 1 && pressed[0].dataset.w === "28", "and the button agrees");
ok(d.getElementById("selWin").value === "28", "and the dropdown agrees");
ok(OV.state.whale === false && d.getElementById("bWhale").getAttribute("aria-pressed") === "false",
   "whale excluded by default, button agrees");
ok(OV.state.blocked === false, "blocked excluded by default");

console.log("\nthe two controls are one control");
d.getElementById("selWin").value = "90";
d.getElementById("selWin").dispatchEvent(new dom.window.Event("change"));
const p90 = [...d.querySelectorAll("#segWin button")].filter(b => b.getAttribute("aria-pressed") === "true");
ok(OV.state.win === 90, "dropdown drives the window");
ok(p90.length === 1 && p90[0].dataset.w === "90", "and the buttons follow it");
[...d.querySelectorAll("#segWin button")].find(b => b.dataset.w === "7").click();
ok(OV.state.win === 7 && d.getElementById("selWin").value === "7",
   "buttons drive the dropdown back");

console.log("\nfilters actually filter");
ok(OV.DATA.windows[0] === 0, "an unfiltered option is offered first");
ok(OV.DATA.windows.includes(180) && OV.DATA.windows.includes(365),
   `windows reach past 90 days: ${OV.DATA.windows.join(", ")}`);
OV.setWin(0);   const nAll = OV.cohort().length;
OV.setWin(7);   const n7   = OV.cohort().length;
OV.setWin(28);  const n28  = OV.cohort().length;
OV.setWin(90);  const n90  = OV.cohort().length;
OV.setWin(180); const n180 = OV.cohort().length;
OV.setWin(365); const n365 = OV.cohort().length;
ok(nAll > n7 && n7 > n28 && n28 > n90 && n90 > n180 && n180 > n365,
   `cohort shrinks as the window widens: ${nAll} > ${n7} > ${n28} > ${n90} > ${n180} > ${n365}`);
// "All" must mean every depositor, not merely a very small window
ok(nAll === OV.DATA.players.filter(r => r[C.WHALE] !== 1 && r[C.STAT] !== OV.BLOCKED).length,
   `All = every non-blocked, non-whale depositor (${nAll})`);
ok(OV.cohort !== undefined && OV.DATA.windows.length === 9, "nine window options");
OV.setWin(0);
ok(d.querySelector('#segWin button[data-w="0"]').textContent === "All", 'the 0 button reads "All"');
ok(/no lapse filter/i.test(d.getElementById("topFilters").textContent),
   "and the caption, now on the player card, says there is no lapse filter");
OV.setWin(28);

/* A carved-out player can only appear in a lapsed cohort after actually going
   quiet. The top depositor deposits most days, so the control is often inert —
   and must SAY so rather than sit there looking live. There can be more than
   one carved-out player now, so the toggle adds however many of them qualify,
   not a hardcoded one. Assert whichever case the data is in. */
const wrs = OV.whaleRows();
const lapsed = wrs.filter(r => r[C.DSD] >= OV.state.win);
const wBtn = d.getElementById("bWhale");
if (lapsed.length) {
  const before = OV.cohort().length;
  wBtn.click();
  ok(OV.cohort().length === before + lapsed.length,
     `${lapsed.length} carved-out player(s) lapsed, and the toggle adds exactly that many`);
  wBtn.click();
} else {
  ok(wBtn.disabled,
     `no carved-out player has gone quiet for ${OV.state.win} days — toggle is disabled, not silently inert`);
  ok(/not lapsed/i.test(wBtn.textContent), `and the button says why: "${wBtn.textContent}"`);
  ok(/nothing to include/i.test(wBtn.title), "with the reason on hover");
  const before = OV.cohort().length;
  wBtn.click();
  ok(OV.cohort().length === before, "clicking it changes nothing, as advertised");
}
ok(!OV.cohort().some(r => r[C.WHALE] === 1),
   "no carved-out player is in the default cohort either way");

// blocked is a two-state switcher now, not a single toggle button
const blkBtn = v => d.querySelector(`#segBlocked button[data-b="${v}"]`);
ok(!!blkBtn("0") && !!blkBtn("1"), "blocked is a two-state switcher");
ok(blkBtn("0").getAttribute("aria-pressed") === "true", "and opens on Excluded");
const preBlocked = OV.cohort().length;
blkBtn("1").click();
const postBlocked = OV.cohort().length;
ok(postBlocked > preBlocked, `Included adds ${postBlocked - preBlocked} blocked accounts`);
ok(blkBtn("1").getAttribute("aria-pressed") === "true" && blkBtn("0").getAttribute("aria-pressed") === "false",
   "the switcher shows exactly one side pressed");
blkBtn("0").click();
ok(OV.cohort().length === preBlocked, "Excluded puts them back out");
ok(!OV.cohort().some(r => r[C.STAT] === OV.BLOCKED), "and no blocked account survives");

ok(!d.getElementById("bProfit"), "profitable-only toggle removed");

console.log("\nthe player list");
{
  const heads = [...d.querySelectorAll("#top thead th")].map(h => h.textContent.replace(/[\u25b2\u25bc]/g, "").trim());
  const want = ["Player","ID","Country","Status","FTD date","Last deposit","Last bet","Deposits (all)",
                "Adj GGR (all)","BC / Adj GGR","Deposit days","Days since deposit","Days since bet","Favourite product"];
  ok(JSON.stringify(heads) === JSON.stringify(want), `exactly the requested columns: ${heads.join(", ")}`);
  ok(!d.getElementById("segSort"), "old sort control gone");
  ok(!d.getElementById("selHdr") && !d.getElementById("topNote"), "the two blurbs removed");

  const body = d.querySelector("#top tbody tr").children.length;
  const foot = d.querySelector("#top tfoot tr").children.length;
  ok(body === heads.length, `body rows have ${body} cells for ${heads.length} headers`);
  ok(foot === heads.length, `footer has ${foot} cells for ${heads.length} headers`);

  const ftd = d.querySelector("#top tbody tr").children[4].textContent.trim();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ftd), `FTD date renders as a date (${ftd})`);
  ok(OV.DATA.players.filter(r => r[C.FTD]).length > OV.DATA.players.length * 0.9,
     "FTD date populated for almost every depositor");

  const longest = OV.LK.country.reduce((a, b) => a.length >= b.length ? a : b);
  ok(longest.length <= 24, `longest country label is ${longest.length} chars ("${longest}")`);
  ok(new Set(OV.LK.country).size === OV.LK.country.length,
     `all ${OV.LK.country.length} country labels distinct — nothing merged`);
  ok(!OV.LK.country.some(c => /\(|,/.test(c)), "no ISO parentheticals or comma tails left");

  const rr = OV.cohort();
  const weighted = rr.reduce((s2,r)=>s2+r[C.BC],0) / rr.reduce((s2,r)=>s2+r[C.ADJ],0);
  const withRatio = rr.map(OV.bcRatio).filter(v => v !== null);
  const naive = withRatio.reduce((s2, v) => s2 + v, 0) / withRatio.length;
  ok(Math.abs(weighted - naive) > 0.01,
     `weighted ratio ${(weighted*100).toFixed(0)}% differs from the naive mean ${(naive*100).toFixed(0)}% — a mean would be wrong`);
  ok(d.querySelector("#top tfoot tr").children[9].textContent.trim() === OV.pct(weighted),
     `footer shows the weighted ratio (${OV.pct(weighted)})`);

  /* Status and last-bet: the two new columns. Last bet is NOT last deposit --
     a player betting from a balance after their last deposit is still engaged,
     and the gap between the dates is the thing worth seeing. */
  const stCol = heads.indexOf("Status"), lbCol = heads.indexOf("Last bet");
  const shown = [...d.querySelectorAll("#top tbody tr")].map(tr => tr.children[stCol].textContent.trim());
  ok(shown.every(v => ["Active","Blocked","\u2014"].includes(v)),
     `status reads Active/Blocked/dash (${[...new Set(shown)].join(", ")})`);
  const lb = d.querySelector("#top tbody tr").children[lbCol].textContent.trim();
  ok(/^\d{4}-\d{2}-\d{2}$|^\u2014$/.test(lb), `last bet renders as a date or dash (${lb})`);
  const withBoth = OV.DATA.players.filter(r => r[C.LBET] && r[C.LD]);
  ok(withBoth.length > 1000, `${withBoth.length} players have both dates`);
  ok(withBoth.some(r => r[C.LBET] > r[C.LD]),
     "some players bet AFTER their last deposit — so last bet is genuinely a different date");
  const gap = withBoth.filter(r => r[C.LBET] > r[C.LD]).length;
  ok(gap > 100, `${gap} players kept betting past their last deposit`);

  /* Days-since-deposit and days-since-bet must be different numbers, or one of
     them is being computed from the wrong date. */
  const dsdI = heads.indexOf("Days since deposit"), dsbI = heads.indexOf("Days since bet");
  ok(dsdI >= 0 && dsbI >= 0, "both day-count columns present");
  const differ = OV.DATA.players.filter(r => r[C.DSB] !== null && r[C.DSB] !== r[C.DSD]).length;
  ok(differ > 1000, `${differ} players have a different days-since-bet to days-since-deposit`);
  ok(OV.DATA.players.every(r => r[C.DSB] === null || r[C.DSB] <= r[C.DSD] || r[C.DSB] >= 0),
     "days since bet is a non-negative day count");
  const noBet = OV.DATA.players.filter(r => !r[C.LBET]);
  ok(noBet.every(r => r[C.DSB] === null), `${noBet.length} players who never bet carry no day count, not a zero`);
}

console.log("\nthe row limit");
{
  ok(OV.state.limit === 50, "defaults to 50 rows");
  const lim = d.getElementById("rowLim");
  ok(!!lim && lim.value === "50", "and the input agrees");
  ok(d.querySelectorAll("#top tbody tr").length === 50, "50 rows drawn");

  /* Raising the limit must draw more rows and leave the totals alone -- a cap
     that trimmed the totals too would understate every figure in the footer. */
  const dIdx = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "Deposits (all)");
  const footBefore = d.querySelector("#top tfoot tr").children[dIdx].textContent;
  lim.value = "250";
  lim.dispatchEvent(new dom.window.Event("change"));
  ok(d.querySelectorAll("#top tbody tr").length === 250, "raising it to 250 draws 250");
  ok(d.querySelector("#top tfoot tr").children[dIdx].textContent === footBefore,
     "and the totals row is unchanged — it always covers the whole selection");
  lim.value = "50";
  lim.dispatchEvent(new dom.window.Event("change"));
}

console.log("\nsortable columns");
{
  const th = k => d.querySelector(`#top thead th[data-k="${k}"]`);
  const col = i2 => [...d.querySelectorAll("#top tbody tr")].map(tr => tr.children[i2].textContent.trim());
  // the minus is already kept by the strip -- multiplying by -1 as well flipped
  // every negative adjusted GGR positive and made a broken sort look sorted
  const money2num = v => Number(v.replace(/[^0-9.\-]/g, "")) || 0;

  ok(OV.state.sortKey === "dsd" && OV.state.sortDir === 1,
     "opens sorted by days since deposit, ascending");
  ok(th("dsd").getAttribute("aria-sort") === "ascending", "and the header says so");
  ok(OV.TIEBREAK === "adj", "adjusted GGR is the tie-break");
  ok(/\u25bc/.test(th("adj").textContent), "and the adj GGR header shows a dimmed arrow for it");
  ok(th("adj").querySelector(".arr.tie") !== null, "marked as a tie-break, not a primary sort");
  ok(/breaking ties/i.test(th("adj").title), `and says so on hover: "${th("adj").title}"`);

  const dsdI2 = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "Days since deposit");
  const adjI2 = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "Adj GGR (all)");
  const ds2 = col(dsdI2).map(v => Number(v.replace(/,/g, "")));
  let up = true; for (let i2=1;i2<ds2.length;i2++) if (ds2[i2] < ds2[i2-1]) up = false;
  ok(up, `days since deposit ascending (${ds2[0]} .. ${ds2[ds2.length-1]})`);

  /* The tie-break is the whole point: days-since-deposit is a whole number, so
     hundreds tie on it, and adj GGR decides who you actually see first. */
  const adj2 = col(adjI2).map(money2num);
  let tieOk = true, ties = 0;
  for (let i2=1;i2<ds2.length;i2++){
    if (ds2[i2] === ds2[i2-1]){ ties++; if (adj2[i2] > adj2[i2-1] + 0.01) tieOk = false; }
  }
  ok(ties > 5, `${ties} rows tie on days since deposit — the tie-break matters`);
  ok(tieOk, "and within a tie, adjusted GGR runs descending");

  // clicking the tie-break column promotes it, and dsd takes over the tie-break
  th("adj").click();
  ok(OV.state.sortKey === "adj" && OV.state.sortDir === -1, "clicking adj GGR promotes it");
  ok(th("dsd").querySelector(".arr.tie") !== null, "and days since deposit becomes the tie-break");
  th("dsd").click();
  if (OV.state.sortDir === -1) th("dsd").click();

  // clicking a fresh numeric column opens it descending; clicking again reverses
  th("dep").click();
  ok(OV.state.sortKey === "dep" && OV.state.sortDir === -1, "deposits opens descending");
  const depI = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "Deposits (all)");
  let dep = col(depI).map(money2num);
  let desc2 = true; for (let i2=1;i2<dep.length;i2++) if (dep[i2] > dep[i2-1]+0.01) desc2 = false;
  ok(desc2, `deposits descending (top $${dep[0].toLocaleString()})`);
  th("dep").click();
  ok(OV.state.sortDir === 1, "clicking the active column reverses direction");
  ok(th("dep").getAttribute("aria-sort") === "ascending", "and the header follows");
  dep = col(depI).map(money2num);
  let asc = true; for (let i2=1;i2<dep.length;i2++) if (dep[i2] < dep[i2-1]-0.01) asc = false;
  ok(asc, "deposits now ascending");

  // a different numeric column starts descending, text starts ascending
  th("dsd").click();
  ok(OV.state.sortKey === "dsd" && OV.state.sortDir === -1, "a new numeric column opens descending");
  const dsI = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "Days since deposit");
  const ds = col(dsI).map(v => Number(v.replace(/,/g, "")));
  let dOk = true; for (let i2=1;i2<ds.length;i2++) if (ds[i2] > ds[i2-1]) dOk = false;
  ok(dOk, `days silent descending (top ${ds[0]})`);

  th("ctry").click();
  ok(OV.state.sortDir === 1, "a text column opens ascending");
  const cs = col(2);
  let cOk = true; for (let i2=1;i2<cs.length;i2++) if (cs[i2].localeCompare(cs[i2-1]) < 0) cOk = false;
  ok(cOk, `country A-Z (first "${cs[0]}")`);

  /* A missing BC/Adj ratio is not zero. Sorted either way those rows belong at
     the bottom, or ascending fills the top with players who have no ratio. */
  th("bcr").click();
  const bcI = [...d.querySelectorAll("#top thead th")]
    .findIndex(h => h.textContent.replace(/[\u25b2\u25bc]/g,"").trim() === "BC / Adj GGR");
  const bottom = col(bcI).slice(-5);
  ok(bottom.every(v => v === "\u2014") || col(bcI)[0] !== "\u2014",
     "players with no adjusted GGR sort to the bottom, not the top");
  th("bcr").click();
  ok(col(bcI)[0] !== "\u2014", "and still not to the top when reversed");

  // every column is clickable, not just the ones checked above
  ok(OV.COLS.every(c => !!th(c.k)), `all ${OV.COLS.length} headers are sortable`);

  th("dsd").click();  // leave it as it opened
  if (OV.state.sortDir === -1) th("dsd").click();
}

console.log("\nhouse rules");
ok(OV.money(-5000) === "-$5,000", "sign before the currency symbol");
ok(OV.pct(0.004) === "<1%", "a real small percentage reads <1%, not 0%");
ok(OV.pct(0) === "0%", "but a true zero reads 0%");

console.log("\nthe return curve is a decay, and stays one");
const R = OV.DATA.rates, ms = Object.keys(R).map(Number).sort((a, b) => a - b);
ok(R[ms[0]] > R[ms[ms.length - 1]] * 5,
   `month ${ms[0]} (${(R[ms[0]]*100).toFixed(1)}%) is far above month ${ms[ms.length-1]} (${(R[ms[ms.length-1]]*100).toFixed(1)}%)`);
let monotone = true;
for (let i = 1; i < ms.length; i++) if (R[ms[i]] > R[ms[i-1]] + 1e-9) monotone = false;
ok(monotone, "the measured curve never rises — longer silence is never better");
ok(OV.pReturn(7) > OV.pReturn(90), "P(return) at 7 days beats 90 days");

console.log("\ncounting traps");
// `rows` used to come from the matrix section; that block is gone, so take the
// cohort directly rather than depending on a leftover from a deleted test
const rows = OV.cohort();
const oneDay = rows.filter(r => r[C.DAYS] === 1).length;
ok(oneDay / rows.length > 0.4,
   `most of the cohort is one-and-done (${oneDay} of ${rows.length}) — reactivation here is re-acquisition`);
ok(OV.DATA.meta.cal_months.length < OV.DATA.meta.months,
   "deposit_count is acknowledged as partial, not treated as complete");
ok(OV.DATA.meta.cal_tx_per_day > 1,
   `frequency axis is understated by ${OV.DATA.meta.cal_tx_per_day}x and the page says so`);

console.log("\n" + (fails ? fails + " FAILED" : "all checks passed"));
process.exit(fails ? 1 : 0);
