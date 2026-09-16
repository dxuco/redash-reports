/**
 * Render the built pivot page in jsdom and read it back.
 *
 *   npm install jsdom      (already present in C:\redash-page\node_modules)
 *   node pivot/test_pivot.js
 *
 * The assertions worth having are the ones that encode a decision someone
 * might undo later: that the page opens with the top depositor out, that a
 * ratio subtotal is weighted rather than averaged, that adjusted GGR cannot be
 * split by game category, and that the grand total equals the rows above it.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const FILE = path.join(__dirname, "..", "pivot.html");
let failures = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (extra ? "   " + extra : ""));
  if (!cond) failures++;
};

const dom = new JSDOM(fs.readFileSync(FILE, "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
});
const w = dom.window;
const doc = w.document;
const PV = w.PV;

if (!PV) { console.log("  FAIL  page script did not run"); process.exit(1); }

const rows = () => [...doc.querySelectorAll("#pivot tbody tr")];
const cellsOf = tr => [...tr.children].map(c => c.textContent.trim());
const money = s => Number(s.replace(/[$,\u2014]/g, "")) || 0;

// -------------------------------------------------- what the page opens on
ok("the subtitle says the last month is partial, not just its code",
   doc.getElementById("sub").textContent.includes("2026-09") &&
   doc.getElementById("sub").textContent.includes("through the " + PV.RAW.meta.mtd_cap));
ok("opens on the chart", PV.state.view === "chart" &&
   doc.getElementById("chartHost").hidden === false &&
   doc.querySelectorAll("#plot svg").length === 1);
ok("opens on MTD", PV.state.period === "mtd" &&
   doc.getElementById("perMtd").getAttribute("aria-pressed") === "true" &&
   doc.getElementById("perFull").getAttribute("aria-pressed") === "false");
ok("opens on first depositors by month and affiliate type",
   PV.state.rows.join() === "month" && PV.state.cols.join() === "afftype" &&
   PV.state.vals.join() === "ftd_players");
ok("no headline strip above the legend", !doc.getElementById("headline"));
ok("the page is titled Marketing Report",
   doc.querySelector(".cover h1").textContent === "Marketing Report" &&
   doc.title === "Marketing Report");
ok("heatmap and copy-table controls have been removed from the header",
   !doc.getElementById("heatBtn") && !doc.getElementById("copyBtn"));
ok("the whale filter keeps its own button rather than a chip in Filters",
   [...doc.querySelectorAll('[data-zone="filters"] .chip')].length === 0);
ok("affiliate name is offered as a dimension",
   !!PV.FIELDS.find(f => f.key === "affname") &&
   PV.FIELDS.find(f => f.key === "affname").levels.length > 500,
   (PV.FIELDS.find(f => f.key === "affname") || {levels:[]}).levels.length + " affiliate names");
ok("FTD cohorts are offered as a dimension",
   !!PV.FIELDS.find(f => f.key === "ftdyear") &&
   PV.FIELDS.find(f => f.key === "ftdyear").levels.some(l => l === "FTD 2025") &&
   PV.FIELDS.find(f => f.key === "ftdyear").levels.some(l => l === "FTD 2026"),
   (PV.FIELDS.find(f => f.key === "ftdyear") || {levels:[]}).levels.join(", "));

// FTD cohort reads newest-first everywhere it's displayed -- alphabetical
// order (the default for every other categorical dimension) would put
// "(never deposited)" before FTD 2023 and "pre-2023" after FTD 2026, since
// that's where '(' and lowercase 'p' fall, not where the calendar puts them.
PV.state.view = "chart"; PV.state.period = "full";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0; PV.state.cols.push("ftdyear");
PV.state.vals.length = 0; PV.state.vals.push("bet_days");
PV.state.chartMeas = "bet_days";
PV.render();
const cohortOrder = [...doc.querySelectorAll("#legend .lg")].map(b => b.children[1].textContent);
ok("the FTD cohort legend reads newest first, then pre-2023, then never-deposited",
   cohortOrder.join() === "FTD 2026,FTD 2025,FTD 2024,FTD 2023,pre-2023,(never deposited)",
   cohortOrder.join());

// The legend reading newest-first is only half of it -- the bar itself used to
// stack in that same order bottom-up, which buried the newest cohort at the
// foot of the bar. Segments are drawn bottom-to-top in REVERSE of series
// order, so the first series (now FTD 2026) is drawn last and ends up on top.
const hexToRgb = hex => {
  const h = hex.replace("#", "");
  return "rgb(" + [0, 2, 4].map(o => parseInt(h.substr(o, 2), 16)).join(", ") + ")";
};
const barRects = [...doc.querySelectorAll("#plot svg rect")];
const byX = new Map();
barRects.forEach(r => {
  const x = Number(r.getAttribute("x"));
  (byX.get(x) || byX.set(x, []).get(x)).push(r);
});
let lastPointGroup = null, maxX = -Infinity;
for (const [x, group] of byX) if (x > maxX){ maxX = x; lastPointGroup = group; }
const topRect = lastPointGroup[lastPointGroup.length - 1];   // last drawn = topmost
const ftd2026Swatch = doc.querySelector("#legend .lg .sw");   // FTD 2026 is the first chip
ok("the newest cohort's segment sits on top of the stack, not the bottom",
   hexToRgb(topRect.getAttribute("fill")) === ftd2026Swatch.style.background,
   "topmost rect fill=" + topRect.getAttribute("fill") +
   " vs FTD 2026 swatch=" + ftd2026Swatch.style.background);

PV.state.view = "table";
PV.state.rows.length = 0; PV.state.rows.push("ftdyear");
PV.state.cols.length = 0;
PV.render();
const cohortRowOrder = rows().filter(r => r.className !== "grand").map(r => cellsOf(r)[0]);
ok("the same order holds when the cohort is in Rows instead of Columns",
   cohortRowOrder.join() === "FTD 2026,FTD 2025,FTD 2024,FTD 2023,pre-2023,(never deposited)",
   cohortRowOrder.join());
PV.applyLayout({rows:["month"], cols:["afftype"], vals:["ftd_players"]});

// ---------------------------------------------- the whale is out by default
const whaleField = PV.FIELDS.find(f => f.key === "whale");
const sel = PV.state.filters.whale;
ok("opens with the top depositor excluded",
   !!sel && sel.size === 1 && whaleField.levels[[...sel][0]].startsWith("Everyone"));
ok("the header button names him and agrees with the state",
   doc.getElementById("whaleBtn").textContent === "karolik777: excluded",
   doc.getElementById("whaleBtn").textContent);
ok("the page carries no explanatory body text under the table",
   !doc.getElementById("honesty") && !doc.querySelector(".meta"));

// the sidebar folds
const fieldsCard = doc.getElementById("cardFields");
fieldsCard.querySelector(".chead").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("the fields panel folds from its heading",
   fieldsCard.classList.contains("closed") &&
   fieldsCard.querySelector(".tog").textContent === "+");
fieldsCard.querySelector(".chead").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("and unfolds again", !fieldsCard.classList.contains("closed") &&
   fieldsCard.querySelector(".tog").textContent === "−");

// ---------------------------------------------------------------- structure
// Back to full months and a plain monthly table for the arithmetic checks.
PV.state.view = "table"; PV.state.period = "full";
PV.state.cols.length = 0;
PV.state.vals.length = 0; PV.state.vals.push("deposit", "bet", "ggr", "ngr", "ftd_players");
PV.render();
ok("table renders rows", rows().length > 5, rows().length + " rows");
ok("one row per cached month", rows().length === PV.RAW.meta.months.length + 1,
   rows().length + " rows for " + PV.RAW.meta.months.length + " months + total");
ok("grand total row is last", rows()[rows().length - 1].className === "grand");

// August 2026 deposits: ~$12.1M with him in, ~$3.85M without. A page that
// quietly included him would read 3x high, which is the failure this catches.
const augRow = rows().find(r => cellsOf(r)[0] === "2026-08");
const augDep = money(cellsOf(augRow)[1]);
ok("August 2026 deposits are the ex-whale figure", augDep > 3e6 && augDep < 5e6,
   "$" + augDep.toLocaleString());

// ------------------------------------------------------- totals reconcile
// 14 measures x 22 rounded values printed per column; the rounding budget for
// a column of whole dollars is half a dollar per printed row.
const bodyRows = rows().filter(r => r.className !== "grand");
const sumDep = bodyRows.reduce((a, r) => a + money(cellsOf(r)[1]), 0);
const grandDep = money(cellsOf(rows()[rows().length - 1])[1]);
ok("months sum to the grand total", Math.abs(sumDep - grandDep) <= bodyRows.length * 0.5 + 1,
   "rows $" + sumDep.toLocaleString() + " vs total $" + grandDep.toLocaleString());

// ------------------------------------------------- ratios stay weighted
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.vals.length = 0; PV.state.vals.push("bet", "ggr", "house_edge");
PV.render();
const r2 = rows().filter(r => r.className !== "grand");
const edges = r2.map(r => parseFloat(cellsOf(r)[3]));
const mean = edges.reduce((a, b) => a + b, 0) / edges.length;
const totalEdge = parseFloat(cellsOf(rows()[rows().length - 1])[3]);
ok("house edge total is weighted, not the mean of the months",
   Math.abs(totalEdge - mean) > 0.01,
   "weighted " + totalEdge.toFixed(2) + "% vs mean of months " + mean.toFixed(2) + "%");
const derivedEdge = money(cellsOf(rows()[rows().length - 1])[2]) / money(cellsOf(rows()[rows().length - 1])[1]) * 100;
ok("and it equals total GGR / total bet", Math.abs(totalEdge - derivedEdge) < 0.05,
   totalEdge.toFixed(2) + "% vs " + derivedEdge.toFixed(2) + "%");

// ------------------------------ adjusted GGR never shares a row with a category
PV.state.rows.length = 0; PV.state.rows.push("game");
PV.state.vals.length = 0; PV.state.vals.push("adj_ggr", "ggr");
PV.render();
const cat = rows().filter(r => r.className !== "grand" && !/no category/.test(cellsOf(r)[0]));
const anyAdj = cat.some(r => money(cellsOf(r)[1]) !== 0);
ok("adjusted GGR is empty for every real game category", !anyAdj,
   "all of it sits in the uncategorised row, as the source data does");
const uncat = rows().find(r => /no category/.test(cellsOf(r)[0]));
ok("and it is not zero overall", uncat && money(cellsOf(uncat)[1]) > 0);

// -------------------------------------------- a nested layout still totals
PV.state.rows.length = 0; PV.state.rows.push("year", "game");
PV.state.cols.length = 0;
PV.state.vals.length = 0; PV.state.vals.push("bet");
PV.state.subtotals = true;
PV.render();
const all = rows();
const subs = all.filter(r => r.className === "sub");
ok("subtotal rows appear for the outer level", subs.length >= 2, subs.length + " subtotals");
const subSum = subs.reduce((a, r) => a + money(cellsOf(r)[1]), 0);
const gTotal = money(cellsOf(all[all.length - 1])[1]);
ok("subtotals sum to the grand total", Math.abs(subSum - gTotal) <= subs.length * 0.5 + 1,
   "$" + subSum.toLocaleString() + " vs $" + gTotal.toLocaleString());

// ------------------------------------------------------ columns axis works
PV.state.rows.length = 0; PV.state.rows.push("year");
PV.state.cols.length = 0; PV.state.cols.push("railtype");
PV.state.vals.length = 0; PV.state.vals.push("deposit");
PV.state.subtotals = false;
PV.render();
const head = [...doc.querySelectorAll("#pivot thead tr")][0];
const heads = [...head.children].map(c => c.textContent.trim());
ok("rail type splits crypto from fiat on the column axis",
   heads.includes("Crypto") && heads.includes("Fiat"), heads.join(" | "));
const yr = rows().find(r => cellsOf(r)[0] === "2026");
const parts = cellsOf(yr).slice(1, -1).reduce((a, s) => a + money(s), 0);
ok("the rail columns sum to the row total",
   Math.abs(parts - money(cellsOf(yr)[cellsOf(yr).length - 1])) <= 2,
   "$" + parts.toLocaleString());

// ------------------------------------------------------------- chart view
const svgEls = () => [...doc.querySelectorAll("#plot svg")];
// Bar segments only: the hover bands are transparent and the line-label
// plates are white, and neither is a bar.
const rects = () => [...doc.querySelectorAll("#plot svg rect")]
  .filter(r => ["transparent", "#fff"].indexOf(r.getAttribute("fill")) === -1);

PV.state.view = "chart";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0; PV.state.cols.push("game");
PV.state.vals.length = 0; PV.state.vals.push("bet", "ggr");
PV.state.chartMeas = "bet";
PV.render();

ok("chart view draws an svg", svgEls().length === 1);
ok("table is hidden while the chart is up",
   doc.querySelector(".tablewrap").hidden === true && doc.getElementById("chartHost").hidden === false);
const gameLevels = PV.FIELDS.find(f => f.key === "game").levels.length;
ok("one legend chip per game category present in the window",
   doc.querySelectorAll("#legend .lg").length === gameLevels,
   doc.querySelectorAll("#legend .lg").length + " chips for " + gameLevels + " categories");
ok("each legend chip carries its own window total",
   [...doc.querySelectorAll("#legend .lg .lv")].every(s => s.textContent.length > 1));

// Bars: 21 months x 7 categories, minus the empty ones. Enough that a chart
// which silently drew nothing would be caught.
ok("bars are drawn", rects().length > 60, rects().length + " segments");
ok("the x axis labels every month",
   [...doc.querySelectorAll("#plot svg text")].some(t => t.textContent === "2025-01"));
ok("a dashed divider marks the year change",
   [...doc.querySelectorAll("#plot svg line")].some(l => l.getAttribute("stroke-dasharray")) &&
   [...doc.querySelectorAll("#plot svg text")].some(t => t.textContent === "2026"));
ok("the y axis labels its own zero",
   [...doc.querySelectorAll("#plot svg text")].some(t => t.textContent === "$0"));

// Isolate on click: clicking a legend chip should leave only that series.
const before = rects().length;
const casinoChip = [...doc.querySelectorAll("#legend .lg")].find(b => b.textContent.startsWith("Casino"));
casinoChip.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
const after = rects().length;
ok("clicking a series isolates it rather than hiding it", after < before && after > 0,
   before + " segments -> " + after);
ok("a Show all chip appears while anything is hidden",
   !!doc.querySelector("#legend .lg.all"));
doc.querySelector("#legend .lg.all").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("Show all puts them back", rects().length === before);

// A ratio cannot be stacked: house edge must come out as lines.
PV.state.vals.length = 0; PV.state.vals.push("house_edge");
PV.state.chartMeas = "house_edge";
PV.render();
ok("a ratio measure is drawn as lines, not stacked bars",
   doc.querySelectorAll("#plot svg polyline").length > 0 && rects().length === 0,
   doc.querySelectorAll("#plot svg polyline").length + " lines");

// A legend total is the weighted figure for that series, matching the table.
const legEdge = [...doc.querySelectorAll("#legend .lg")]
  .find(b => b.textContent.startsWith("Casino")).querySelector(".lv").textContent;
PV.state.view = "table";
PV.state.rows.length = 0; PV.state.rows.push("game");
PV.state.cols.length = 0;
PV.state.vals.length = 0; PV.state.vals.push("house_edge");
PV.render();
const casinoRow = rows().find(r => cellsOf(r)[0] === "Casino");
ok("a legend total matches the same figure in the table",
   legEdge === cellsOf(casinoRow)[1],
   "legend " + legEdge + " vs table " + cellsOf(casinoRow)[1]);

// ------------------------------------------------------------------- MTD
PV.state.view = "table";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0;
PV.state.vals.length = 0; PV.state.vals.push("deposit");
PV.state.period = "full";
PV.render();
const fullByMonth = Object.fromEntries(rows().filter(r => r.className !== "grand")
  .map(r => [cellsOf(r)[0], money(cellsOf(r)[1])]));
PV.state.period = "mtd";
PV.paint();
const mtdByMonth = Object.fromEntries(rows().filter(r => r.className !== "grand")
  .map(r => [cellsOf(r)[0], money(cellsOf(r)[1])]));

const cap = PV.RAW.meta.mtd_cap;
const last = PV.RAW.meta.months[PV.RAW.meta.months.length - 1];
ok("MTD trims every complete month",
   Object.keys(fullByMonth).filter(m => m !== last).every(m => mtdByMonth[m] < fullByMonth[m]),
   "cap = day " + cap);
ok("MTD leaves the current part-month alone",
   Math.abs(mtdByMonth[last] - fullByMonth[last]) <= 1,
   last + ": $" + mtdByMonth[last].toLocaleString() + " vs $" + fullByMonth[last].toLocaleString());
ok("MTD is roughly the right share of a full month",
   mtdByMonth["2026-08"] / fullByMonth["2026-08"] > cap / 31 * 0.5 &&
   mtdByMonth["2026-08"] / fullByMonth["2026-08"] < cap / 31 * 1.8,
   "Aug ran at " + Math.round(mtdByMonth["2026-08"] / fullByMonth["2026-08"] * 100) +
   "% of the month in its first " + cap + " days");
ok("the MTD button shows the state",
   doc.getElementById("perMtd").getAttribute("aria-pressed") === "true");
PV.state.period = "full";
PV.render();

// --------------------------------------------------- scroll stays put on click
// Clicking a legend chip destroys and rebuilds the whole legend (and the
// chart under it), which drops focus back to <body> mid-click -- the browser
// bug this exists to counter. jsdom models the same focus-loss, so scrollTo
// spy calls prove the wrapper actually ran, even though jsdom's own layout
// can't reproduce the resulting jump.
PV.state.view = "chart";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0; PV.state.cols.push("game");
PV.render();
// jsdom does not actually implement scrolling -- scrollX/scrollY stay 0
// regardless of scrollTo() -- so the real position is stubbed directly and
// scrollTo is spied on, rather than relying on jsdom to move it for real.
Object.defineProperty(w, "scrollY", {value:850, configurable:true});
Object.defineProperty(w, "scrollX", {value:0, configurable:true});
let sawRestore = false;
w.scrollTo = (x, y) => { if (y === 850) sawRestore = true; };
const chip = doc.querySelector("#legend .lg");
chip.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("clicking a legend chip restores the pre-click scroll position",
   sawRestore, "scrollTo(_, 850) was " + (sawRestore ? "" : "NOT ") + "called after the redraw");

// ------------------------------------------------------------- saved layouts
// paintPresets() was written but never wired into the render pipeline, so the
// "Saved layouts" panel rendered permanently empty -- these assertions exist
// specifically so that regression can't come back silently.
const presetsBox = () => doc.getElementById("presets");
// save button + a "Built in" group label + one chip per preset
ok("the Saved layouts panel is not empty",
   presetsBox().children.length === PV.PRESETS.length + 2,
   presetsBox().children.length + " children for " + PV.PRESETS.length + " built-ins + label + save button");
ok("every built-in preset is clickable",
   [...presetsBox().querySelectorAll(".chip.d")].length === PV.PRESETS.length);
ok("every built-in preset carries its own delete control",
   [...presetsBox().querySelectorAll(".chip.d .x")].length === PV.PRESETS.length);

// This jsdom document has no real server behind it -- the initial GET to
// /api/pivot-layouts has nothing to answer it, exactly the case a real
// browser hits if the Worker is down -- so saving should come up disabled
// and the page should say so rather than silently doing nothing.
ok("save is correctly detected as unavailable with no server to answer it",
   PV.CAN_SAVE === false);
const saveBtn = presetsBox().querySelector(".chip.save");
ok("the save button explains why it's disabled rather than just not working",
   saveBtn.disabled === true && /reach the server|saving is off/i.test(saveBtn.title));

// The save/apply/delete mechanics don't depend on CAN_SAVE -- only whether the
// result reaches disk does -- so they're exercised directly here.
PV.state.view = "table"; PV.state.period = "full";
PV.state.rows.length = 0; PV.state.rows.push("country");
PV.state.cols.length = 0; PV.state.cols.push("game");
PV.state.vals.length = 0; PV.state.vals.push("ngr");
PV.state.filters.whale = new Set([PV.FIELDS.find(f => f.key === "whale").levels
  .findIndex(l => l.startsWith("karolik"))]);   // deliberately put the whale back in
PV.state.subtotals = false;
PV.state.chartMeas = "ngr";

const saved = PV.currentLayout("Test layout");
ok("a saved layout captures the filter by label, not by numeric code",
   Array.isArray(saved.filters.whale) && saved.filters.whale[0].indexOf("karolik") > -1,
   JSON.stringify(saved.filters.whale));
ok("and captures the rest of the state that makes a layout reproducible",
   saved.rows.join() === "country" && saved.cols.join() === "game" &&
   saved.subtotals === false && saved.period === "full");

PV.custom = [...PV.custom, saved];
PV.paintPresets();
ok("a saved layout appears in its own \"Saved\" group above the built-ins",
   [...presetsBox().querySelectorAll(".grouplabel")].map(g => g.textContent).join() === "Saved,Built in");
ok("both the custom layout and every built-in now carry a delete control",
   [...presetsBox().querySelectorAll(".chip.d .x")].length === 1 + PV.PRESETS.length);

// Move controls reorder a person's own saved layouts. Add a second one so
// there's an order to disturb; built-ins are untouched by any of this.
const secondSaved = PV.currentLayout("Second layout");
PV.custom = [...PV.custom, secondSaved];
PV.paintPresets();
const yoursChips = () => [...presetsBox().querySelectorAll(".chip.d")].slice(0, PV.custom.length);
const yoursNames = () => yoursChips().map(c => c.querySelector(".nm").textContent);
ok("a second saved layout renders after the first, in save order",
   yoursNames().join() === "Test layout,Second layout");
ok("the first chip's up arrow is disabled, the last chip's down arrow is disabled",
   yoursChips()[0].querySelectorAll(".mv")[0].disabled === true &&
   yoursChips()[0].querySelectorAll(".mv")[1].disabled === false &&
   yoursChips()[1].querySelectorAll(".mv")[0].disabled === false &&
   yoursChips()[1].querySelectorAll(".mv")[1].disabled === true);
yoursChips()[0].querySelectorAll(".mv")[1].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("moving the first layout down swaps it with its neighbour",
   PV.custom.map(c => c.name).join() === "Second layout,Test layout" &&
   yoursNames().join() === "Second layout,Test layout");
yoursChips()[1].querySelectorAll(".mv")[0].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("moving the second layout up puts the order back",
   PV.custom.map(c => c.name).join() === "Test layout,Second layout");
ok("clicking a layout's own row still applies it rather than doing nothing",
   (() => {
     PV.state.rows.length = 0; PV.state.rows.push("month");
     yoursChips()[0].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
     return PV.state.rows.join() === "country";
   })());

// Drop the second one -- the tests below assume a single saved layout.
PV.custom = PV.custom.filter(c => c.id !== secondSaved.id);
PV.paintPresets();

// Reset state to something different, then load the saved layout back.
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0;
delete PV.state.filters.whale;
PV.applyLayout(saved);
ok("loading a saved layout restores rows, columns and the filter together",
   PV.state.rows.join() === "country" && PV.state.cols.join() === "game" &&
   !!PV.state.filters.whale && PV.state.filters.whale.size === 1 &&
   PV.FIELDS.find(f => f.key === "whale").levels[[...PV.state.filters.whale][0]].startsWith("karolik"));

// Delete removes it from the list, not just hides it.
const delBtn = presetsBox().querySelector(".chip.d .x");
delBtn.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("deleting a saved layout removes it from the panel", PV.custom.length === 0);
ok("built-ins are unaffected by deleting a custom one",
   presetsBox().children.length === PV.PRESETS.length + 2);

// Deleting a BUILT-IN hides it (not the same as CUSTOM deletion, which drops
// the row for good) and offers a way back -- "give me access to delete saved
// layouts" reasonably covers the built-ins too, not only ones typed by hand.
const targetName = PV.PRESETS[0].name;
const targetChip = [...presetsBox().querySelectorAll(".chip.d")]
  .find(b => b.querySelector(".nm").textContent === targetName);
targetChip.querySelector(".x").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("deleting a built-in preset hides it from the panel",
   PV.dismissed.has(PV.PRESETS[0].id) &&
   ![...presetsBox().querySelectorAll(".nm")].some(n => n.textContent === targetName));
ok("PRESETS itself is untouched -- only what's rendered changes",
   PV.PRESETS.length === 8 && PV.PRESETS[0].name === targetName);
const restoreChip = [...presetsBox().querySelectorAll("button")]
  .find(b => /Restore 1 hidden/.test(b.textContent));
ok("a Restore control appears once something is hidden", !!restoreChip);
restoreChip.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
ok("Restore brings it back",
   PV.dismissed.size === 0 &&
   [...presetsBox().querySelectorAll(".nm")].some(n => n.textContent === targetName));

// Restore the default state (excluding the whale) for anything after this.
PV.applyLayout({rows:["month"], cols:["afftype"], vals:["ftd_players"]});

// -------------------------------------------------------- active depositors
/* Recounted from the cache here rather than pinned to a literal. It was pinned
   to 2,737, which was a true number about one particular carve-out list and
   went stale the moment a second player joined it — a red test that was right
   about the arithmetic and wrong about the question. Excluding whoever is
   carved out, from the same file the builder read, is the recount the name
   promises. */
const { CARVED } = require("../data-exclusions");
function recountAugDepositors() {
  const rows = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "ftd-report", "cache", "2026-08.json"), "utf8"));
  const ids = new Set();
  for (const r of rows) {
    if (!(Number(r.deposit) > 0)) continue;
    const id = String(r.player_id);
    if (CARVED.has(id)) continue;
    ids.add(id);
  }
  return ids.size;
}
const AUG_DEP = recountAugDepositors();
// A genuine distinct headcount, stored as WHO (a player-code list) per cube
// cell rather than a size, and unioned -- never summed -- into any rollup.
// Reference figures below are recomputed independently straight from the raw
// August 2026 cache.
PV.state.view = "table"; PV.state.period = "full"; PV.state.subtotals = true;
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0;
PV.state.vals.length = 0; PV.state.vals.push("active_dep");
PV.state.filters.whale = new Set([PV.FIELDS.find(f => f.key === "whale").levels
  .findIndex(l => l.startsWith("Everyone"))]);   // ex-whale, the default
PV.render();
const augActiveDep = money(cellsOf(rows().find(r => cellsOf(r)[0] === "2026-08"))[1]);
ok("active depositors matches an independent recount from the raw cache",
   augActiveDep === AUG_DEP,
   "page says " + augActiveDep + ", raw cache says " + AUG_DEP);
ok("no overlap caveat with no column split (nothing to overlap yet)",
   doc.getElementById("tableOverlap").hidden === true);

// The whole point: summing a distinct count across a dimension a depositor can
// straddle (payment rail) must NOT equal what's shown, because 463 August
// depositors used more than one rail that month.
PV.state.cols.length = 0; PV.state.cols.push("rail");
PV.render();
const augRailRow = rows().find(r => cellsOf(r)[0] === "2026-08");
const augCells = cellsOf(augRailRow).slice(1);
const augTotal = money(augCells[augCells.length - 1]);
const augRailSum = augCells.slice(0, -1).reduce((a, s) => a + money(s), 0);
ok("the Total column is the true distinct count, not the sum of the rail columns",
   augTotal === AUG_DEP && augRailSum > augTotal,
   "Total=" + augTotal + " vs naive rail-sum=" + augRailSum + " (463 depositors used >1 rail that month)");
ok("the table surfaces an overlap caveat once split by rail",
   doc.getElementById("tableOverlap").hidden === false &&
   /rail/.test(doc.getElementById("tableOverlap").textContent) &&
   /don't sum/.test(doc.getElementById("tableOverlap").textContent));

// A year subtotal unions its months rather than summing them -- summing would
// double-count anyone who deposited in more than one month that year.
PV.state.cols.length = 0;
PV.state.rows.length = 0; PV.state.rows.push("year", "month");
PV.render();
const yearSub = rows().find(r => r.className === "sub" && cellsOf(r)[0].startsWith("2026"));
const yearMonths = [...rows()].filter(r => r.className !== "sub" && r.className !== "grand" &&
  /^2026-/.test(cellsOf(r)[0]) && rows().indexOf(r) > rows().indexOf(yearSub) &&
  rows().indexOf(r) < (rows().findIndex(r2 => r2.className === "grand")));
const monthNaiveSum = yearMonths.reduce((a, r) => a + money(cellsOf(r)[1]), 0);
ok("a year subtotal is the union of its months, not their sum",
   money(cellsOf(yearSub)[1]) > 0 && money(cellsOf(yearSub)[1]) <= monthNaiveSum,
   "2026 subtotal=" + cellsOf(yearSub)[1] + " vs naive month-sum=" + monthNaiveSum);

// The whole-window distinct total (everyone, no filters) matches the figure
// the builder computed once from every raw row, independent of any rollup.
PV.state.rows.length = 0; PV.state.rows.push("month");
delete PV.state.filters.whale;
PV.render();
const grandActiveDep = money(cellsOf(rows()[rows().length - 1])[1]);
ok("the grand total (everyone, unfiltered) matches the builder's own count",
   grandActiveDep === PV.RAW.meta.active_depositors_total,
   grandActiveDep + " vs meta " + PV.RAW.meta.active_depositors_total);

// The chart draws active depositors as bars (it is additive-looking, not a
// ratio) and its combo() path -- used for the "Other" bucket and the total
// line -- must union rather than sum for the same reason cellValue() does.
// Split by rail rather than game: a deposit row never carries a game category
// (same reason adjusted GGR can't be split by one), so rail is what actually
// has the multi-value overlap this is meant to exercise.
PV.state.view = "chart"; PV.state.period = "full";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0; PV.state.cols.push("rail");
PV.state.vals.length = 0; PV.state.vals.push("active_dep");
PV.state.chartMeas = "active_dep";
PV.render();
ok("active depositors draws as bars, not a ratio line",
   doc.querySelectorAll("#plot svg rect").length > 0 &&
   doc.querySelectorAll("#plot svg polyline").length === 0);
const railLegendTotals = [...doc.querySelectorAll("#legend .lg .lv")].map(s => money(s.textContent));
const railLegendSum = railLegendTotals.reduce((a, b) => a + b, 0);
ok("legend totals sum to more than the true window total, because rails overlap",
   railLegendSum > grandActiveDep,
   "rail legend sum=" + railLegendSum + " vs true window total=" + grandActiveDep);
ok("the chart surfaces the same overlap caveat when split by rail",
   doc.getElementById("chartOverlap").hidden === false &&
   /rail/.test(doc.getElementById("chartOverlap").textContent));

// Switching back to an unsplit measure (no columns) hides the chart caveat again.
PV.state.cols.length = 0;
PV.render();
ok("the chart caveat clears once the split is removed",
   doc.getElementById("chartOverlap").hidden === true);

// -------------------------------------------------------- chart series cap
// A dimension with hundreds of values (affiliate name) can't get a legend
// chip each -- the chart keeps the top 20 by window total and buckets the
// rest into one "Other" series, so the legend stays readable either way.
PV.state.view = "chart"; PV.state.period = "mtd";
PV.state.rows.length = 0; PV.state.rows.push("month");
PV.state.cols.length = 0; PV.state.cols.push("affname");
PV.state.vals.length = 0; PV.state.vals.push("ftd_players");
PV.state.chartMeas = "ftd_players";
PV.render();
const affnameChips = [...doc.querySelectorAll("#legend .lg")];
const nameOf = chip => chip.children[1].textContent;
const otherChip = affnameChips.find(b => nameOf(b).indexOf("Other (") === 0);
const affnameColCount = PV.last.colCols.length;
ok("the chart shows the top 20 affiliate names plus one Other bucket",
   affnameChips.length === 21 && !!otherChip,
   affnameChips.length + " legend chips");
ok("the Other bucket names how many affiliate names it's hiding",
   !!otherChip && nameOf(otherChip) === "Other (" + (affnameColCount - 20) + " affiliate name)",
   otherChip && nameOf(otherChip));

// Reset to defaults for anything after this.
PV.applyLayout({rows:["month"], cols:["afftype"], vals:["ftd_players"]});
PV.state.period = "mtd"; PV.state.view = "chart";
PV.render();

console.log(failures ? "\n" + failures + " FAILED" : "\nall assertions passed");
process.exit(failures ? 1 : 0);
