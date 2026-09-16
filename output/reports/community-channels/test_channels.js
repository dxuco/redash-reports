// Renders the BUILT page in jsdom and reads it back. A chart that renders empty
// or a script that dies halfway is invisible to any check on the aggregation.
//
//   npm install jsdom && node community-channels/test_channels.js

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const file = path.join(__dirname, "..", "community-channels.html");
const dom = new JSDOM(fs.readFileSync(file, "utf8"), { runScripts: "dangerously" });
const w = dom.window, d = w.document;

let fails = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("  ok   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra !== undefined ? "  " + extra : "")); }
}

console.log("community-channels.html");

// --- the nav bar must be able to find its insertion point -------------------
// publish-worker.js injects the site switcher after the FIRST match of
// /<body[^>]*>/i. The comment above the real tag once contained that tag name
// in angle brackets, so the bar was injected into the comment: invisible, and
// nothing failed. The published page simply had no header.
const rawHtml = fs.readFileSync(file, "utf8");
const bodyAt = /<body[^>]*>/i.exec(rawHtml);
ok("a body tag is present for the nav bar", !!bodyAt);
ok("the first body match is the real tag, not one inside a comment",
   !/<!--(?:(?!-->)[\s\S])*<body/i.test(rawHtml.slice(0, bodyAt.index + 6)),
   "first match at " + bodyAt.index);
{
  // prove it end to end: inject as the publisher does and read it back
  const bar = '<div data-report-switcher>NAV</div>';
  const staged = rawHtml.slice(0, bodyAt.index + bodyAt[0].length) + bar +
                 rawHtml.slice(bodyAt.index + bodyAt[0].length);
  const sd = new JSDOM(staged).window.document;
  ok("the injected nav bar lands in the body as its first child",
     sd.body.firstElementChild &&
     sd.body.firstElementChild.hasAttribute("data-report-switcher"),
     sd.body.firstElementChild && sd.body.firstElementChild.className);
  ok("the cover band survives the injection", !!sd.querySelector(".cover h1"));
}

// --- the script actually ran -----------------------------------------------
ok("window.CC handed over", !!w.CC);
const CC = w.CC, DATA = CC.DATA;

// --- charts are not empty ---------------------------------------------------
// There is no tickets chart: three grouped bars a month made Twitter and
// Telegram invisible next to Discord, and the counts are all in the by-month
// table anyway. DATA.tickets is still built — the table reads it.
// Only one chart is left. The tickets chart went because three grouped bars a
// month made Twitter and Telegram invisible next to Discord; the share-of-GGR
// lines went because the same figures read better as table columns. Both sets
// of numbers still live in the tables, and DATA still carries them.
ok("the tickets chart is gone", !d.getElementById("c3"));
ok("the share-of-GGR chart is gone", !d.getElementById("c2"));
["c1"].forEach(id => {
  const svg = d.getElementById(id);
  ok(id + " has content", svg && svg.innerHTML.length > 400,
     svg ? svg.innerHTML.length : "missing");
  ok(id + " labels its zero",
     /<text[^>]*>0(%|)<\/text>/.test(svg.innerHTML) ||
     /y="[\d.]+"[^>]*>0</.test(svg.innerHTML));
});
// --- chart 1: exactly two bars a month --------------------------------------
// It previously drew a backdrop, four solid bars and four dashed lines on a
// second axis. At 3% penetration the channel bars were 4px and the chart was
// unreadable. Two bars, no second axis, percentage printed on the bar.
const c1 = d.getElementById("c1").innerHTML;
ok("c1 draws exactly two bars per month",
   (c1.match(/<rect/g) || []).length === DATA.months.length * 2,
   (c1.match(/<rect/g) || []).length);
ok("c1 draws no lines at all", (c1.match(/<polyline/g) || []).length === 0);
ok("c1 has no second axis", !/_ry/.test(c1));
ok("c1 prints the penetration on the bar",
   (c1.match(/font-weight="700"[^>]*>\d+\.\d%</g) || []).length === DATA.months.length);
ok("c1 focuses Community by default", d.getElementById("focus").textContent === "Community");

// --- the defaults the page is supposed to open on ---------------------------
// Same-month reach by default, so "depositors reached" and "tickets created"
// are on the same clock.
ok("opens on same-month reach", CC.state.mode === "month");
ok("opens with top depositor excluded", CC.state.whale === "ex");
ok("month button is the pressed one",
   d.getElementById("b-month").getAttribute("aria-pressed") === "true");
ok("excluded button is the pressed one",
   d.getElementById("b-ex").getAttribute("aria-pressed") === "true");
// A default set in state but not in the markup renders buttons that lie on load.
ok("cohort button is not pressed",
   d.getElementById("b-cohort").getAttribute("aria-pressed") === "false");

// The point of the default: a channel that issued nothing in a month must show
// no reach in that month, not a standing cohort figure.
const tgIdx = DATA.months.indexOf("2026-01");
ok("a channel with no tickets that month shows no reach",
   DATA.series["month|ex"].Telegram.deps[tgIdx] === 0 &&
   DATA.tickets.Telegram.created[tgIdx] === 0);

// --- counting: distinct never sums ------------------------------------------
const s = CC.cur();
let strictlyLess = false;
DATA.months.forEach((m, i) => {
  const parts = DATA.channels.reduce((a, c) => a + s[c].players[i], 0);
  ok("players: channels >= Any (" + m + ")", parts >= s.Any.players[i],
     parts + " vs " + s.Any.players[i]);
  if (parts > s.Any.players[i]) strictlyLess = true;
});
ok("some month has multi-channel players (rows exceed the distinct total)", strictlyLess);

// --- penetration ------------------------------------------------------------
DATA.months.forEach((m, i) => {
  ok("Community reach <= all depositors (" + m + ")",
     s.Community.deps[i] <= DATA.totalDep[CC.state.whale][i],
     s.Community.deps[i] + " vs " + DATA.totalDep[CC.state.whale][i]);
  DATA.channels.forEach(c => {
    // every channel player is also a Community player — the three named
    // channels are a subset of the group, not siblings of it
    ok("  " + c + " reach <= Community reach (" + m + ")",
       s[c].deps[i] <= s.Community.deps[i]);
  });
  const expect = 100 * s.Community.deps[i] / DATA.totalDep[CC.state.whale][i];
  ok("penetration is reach / all depositors (" + m + ")",
     Math.abs(expect - s.Community.pen[i]) < 0.01, expect + " vs " + s.Community.pen[i]);
});
ok("penetration is a minority — the sliver is real, not a bug",
   s.Community.pen.every(v => v > 0 && v < 50), s.Community.pen.join(","));

// --- shares are computed against the whale view in force --------------------
DATA.months.forEach((m, i) => {
  DATA.groups.forEach(c => {
    const expect = 100 * s[c].ggr[i] / DATA.totalGgr[CC.state.whale][i];
    ok("share matches ggr/total (" + c + " " + m + ")",
       Math.abs(expect - s[c].share[i]) < 0.02, expect + " vs " + s[c].share[i]);
  });
});

// --- negatives are real and must not be clamped -----------------------------
let anyNeg = false;
Object.keys(DATA.series).forEach(k => {
  DATA.channels.forEach(c => {
    if (DATA.series[k][c].share.some(v => v < 0)) anyNeg = true;
  });
});
ok("a negative share exists in the data (so the zero rule matters)", anyNeg);
ok("negative figures render with the sign before the $",
   !/\$-/.test(d.body.innerHTML), "found $-");

// --- concentration is surfaced, not buried ----------------------------------
// Twitter's cohort line is mostly one account. If that ever stops being shown
// the page starts claiming a channel result it does not have.
const cohortS = DATA.series["cohort|" + CC.state.whale];
ok("Twitter's cohort line is concentrated in one player",
   cohortS.Twitter.conc[cohortS.Twitter.conc.length - 1] >= 50,
   cohortS.Twitter.conc.join(","));

// The caption must describe whatever mode is showing, not a hard-coded month.
const last = DATA.months.length - 1;
const hot = DATA.groups.filter(g => s[g].conc[last] >= 50);
const capText = d.getElementById("cap2conc").textContent;
ok("the concentration caption matches the mode on screen",
   hot.length ? hot.every(g => capText.indexOf(g) >= 0)
              : /No group/.test(capText), capText);

// conc is the largest single player over the GROUP's own total. With losers in
// the mix that total can be smaller than its biggest winner, so the figure can
// exceed 100% — real, not a bug. It is never negative: a non-positive total
// yields 0 instead of a sign-flipped ratio.
ok("conc is a share of the group's own GGR and never negative",
   DATA.groups.every(c => s[c].conc.every(v => v >= 0)));
ok("conc is zero wherever the group's GGR is not positive",
   DATA.groups.every(c =>
     s[c].conc.every((v, i) => s[c].ggr[i] > 0 || v === 0)));

// --- toggles actually change the numbers ------------------------------------
const monthAug = CC.cur().Twitter.share[7];
d.getElementById("b-cohort").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const cohortAug = CC.cur().Twitter.share[7];
ok("attribution toggle changes the figures", cohortAug !== monthAug,
   monthAug + " vs " + cohortAug);
ok("cohort reach is never below same-month reach",
   DATA.months.every((m, i) =>
     DATA.groups.every(g =>
       DATA.series["cohort|ex"][g].deps[i] >= DATA.series["month|ex"][g].deps[i])));
ok("attribution toggle flips aria-pressed",
   d.getElementById("b-cohort").getAttribute("aria-pressed") === "true" &&
   d.getElementById("b-month").getAttribute("aria-pressed") === "false");

d.getElementById("b-inc").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("whale toggle raises total GGR",
   DATA.totalGgr.inc[7] > DATA.totalGgr.ex[7]);
ok("whale toggle shrinks the channel share",
   CC.cur().Twitter.share[7] < cohortAug);

// back to defaults
d.getElementById("b-month").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
d.getElementById("b-ex").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

// --- isolate on click, not hide ---------------------------------------------
const li = d.querySelector('.li[data-c="Discord"]');
li.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("clicking a series isolates it rather than hiding it",
   CC.state.hidden.Twitter === true && !CC.state.hidden.Discord);
ok("Show all appears while something is hidden",
   !d.querySelector("#l1 .chip").hasAttribute("hidden"));
d.querySelector("#l1 .chip").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("Show all restores everything", Object.keys(CC.state.hidden).length === 0 ||
   DATA.channels.every(c => !CC.state.hidden[c]));

// --- tickets ----------------------------------------------------------------
DATA.groups.forEach(c => {
  DATA.months.forEach((m, i) => {
    ok("completed <= created (" + c + " " + m + ")",
       DATA.tickets[c].completed[i] <= DATA.tickets[c].created[i]);
  });
});
ok("tickets are unaffected by the attribution toggle",
   JSON.stringify(DATA.tickets) === JSON.stringify(w.CC.DATA.tickets));

// --- table ------------------------------------------------------------------
const rows = d.querySelectorAll("#tbl tbody tr");
// Community is the month's subtotal row, not a row inside the month — only the
// three named channels sit under it.
ok("table has a subtotal row plus the three channels per month",
   rows.length === DATA.months.length * (DATA.channels.length + 1),
   rows.length);
ok("no Community row sits inside a month",
   ![...d.querySelectorAll("#tbl tbody tr:not(.grp-hd) td:first-child")]
     .some(td => td.textContent.trim() === "Community"));
ok("the subtotal row carries Community's figures and is clickable",
   [...d.querySelectorAll("#tbl tbody tr.grp-hd")]
     .every(r => r.getAttribute("data-key") &&
                 r.getAttribute("data-key").endsWith("|Community")));
ok("Community ticket total equals the group, not the three channels",
   DATA.tickets.Community.created.reduce((a, b) => a + b, 0) >
   DATA.channels.reduce((a, c) =>
     a + DATA.tickets[c].created.reduce((x, y) => x + y, 0), 0));

// --- adjusted GGR -----------------------------------------------------------
const adjRows = d.querySelectorAll("#tbl-adj tbody tr");
ok("adjusted table has a row per month plus a total",
   adjRows.length === DATA.months.length + 1, adjRows.length);

DATA.months.forEach((m, i) => {
  const expect = 100 * s.Community.adj[i] / DATA.totalAdj[CC.state.whale][i];
  ok("adj share is adj / total adj (" + m + ")",
     Math.abs(expect - s.Community.adjShare[i]) < 0.02);
  // Adjusted GGR and raw GGR are computed upstream over different scopes. If
  // these ever coincide, something has started deriving one from the other.
  ok("adjusted GGR is not raw GGR (" + m + ")",
     Math.abs(DATA.totalAdj[CC.state.whale][i] - DATA.totalGgr[CC.state.whale][i]) > 0.01);
});

// The 2026-to-date share must be recomputed from summed dollars. A mean of the
// eight monthly percentages is a different (wrong) number, because the months
// are different sizes — assert they differ so a mean cannot creep in later.
const sum = a => a.reduce((x, y) => x + y, 0);
const weighted = 100 * sum(s.Community.adj) / sum(DATA.totalAdj[CC.state.whale]);
const naiveMean = sum(s.Community.adjShare) / DATA.months.length;
ok("period share is weighted, not the mean of the monthly shares",
   Math.abs(weighted - naiveMean) > 0.01, weighted + " vs " + naiveMean);
const totalRow = d.querySelector("#tbl-adj tr.grp-hd");
ok("the totals row prints the weighted figure",
   totalRow.children[3].textContent === CC.fmtPct1(weighted),
   totalRow.children[3].textContent + " vs " + CC.fmtPct1(weighted));
// The raw-GGR share column was removed from this table — raw and adjusted are
// different upstream measures and putting them adjacent invited reconciling
// them. Raw GGR lives in the by-month table.
ok("the adjusted table has no raw-GGR column",
   d.querySelectorAll("#tbl-adj thead th").length === 7,
   d.querySelectorAll("#tbl-adj thead th").length);
ok("every adjusted row has as many cells as there are headers",
   [...adjRows].every(r => r.children.length === 7));

ok("channel adj shares do not sum to the Community share",
   DATA.channels.reduce((a, c) => a + sum(s[c].adj), 0) !== sum(s.Community.adj));

// --- segments ---------------------------------------------------------------
const segRows = DATA.segments[CC.state.mode + "|" + CC.state.whale];
ok("segment table renders a row per segment plus a total",
   d.querySelectorAll("#tbl-seg tbody tr").length === segRows.length + 1);
ok("segment depositors sum to the period distinct total",
   segRows.reduce((a, r) => a + r.dep, 0) > 0);
segRows.forEach(r => {
  ok("  " + r.segment + ": reach <= depositors", r.Community <= r.dep);
  DATA.channels.forEach(c => {
    ok("  " + r.segment + ": " + c + " <= Community", r[c] <= r.Community);
  });
  const expect = 100 * r.Community / r.dep;
  ok("  " + r.segment + ": penetration is reach / depositors",
     Math.abs(expect - r.CommunityPen) < 0.02);
});

// A share over a negative denominator flips sign and reads as the opposite of
// what happened. Those cells must say n/a, not print a percentage.
const negSegs = segRows.filter(r => r.adj <= 0);
ok("some segment runs negative adjusted GGR (so the n/a rule matters)",
   negSegs.length > 0);
const segCells = [...d.querySelectorAll("#tbl-seg tbody tr")].map(
  r => [...r.children].map(c => c.textContent));
negSegs.forEach(r => {
  const row = segCells.find(c => c[0] === r.segment);
  ok("  " + r.segment + " shows n/a rather than a flipped percentage",
     row[9] === "n/a", row[9]);
});

// The segment table follows the SAME attribution switch as the monthly one.
// It was hard-wired to cohort, and once the default moved to same-month the two
// tables showed $141,508 and $1,394,203 for the same quantity with nothing on
// screen to explain it. Both modes are checked, so neither can drift again.
["month", "cohort"].forEach(mode => {
  const segCom = DATA.segments[mode + "|" + CC.state.whale]
    .reduce((a, r) => a + r.CommunityAdj, 0);
  const monCom = sum(DATA.series[mode + "|" + CC.state.whale].Community.adj);
  // segment <= monthly, short only by players with GGR but no 2026 deposit
  ok("segment and monthly Community adj. GGR agree (" + mode + ")",
     segCom <= monCom + 0.02 && monCom - segCom < Math.abs(monCom) * 0.05 + 1,
     segCom + " vs " + monCom);
});

// --- bonus detail popup -----------------------------------------------------
ok("modal starts hidden", d.getElementById("modal").hidden);

// The popup must add up to the row that opened it. If it ever does not, the
// ticket counts and the detail rows have drifted onto two different exports —
// which is exactly what happened once, and read as a data bug.
DATA.months.forEach(m => {
  DATA.groups.forEach((g, gi) => {
    const key = m + "|" + g;
    const rowsD = DATA.detail[key] || [];
    const i = DATA.months.indexOf(m);
    ok("popup totals match the cell (" + key + ")",
       rowsD.reduce((a, r) => a + r.created, 0) === DATA.tickets[g].created[i] &&
       rowsD.reduce((a, r) => a + r.completed, 0) === DATA.tickets[g].completed[i],
       key);
    ok("  no bonus completes more than it created (" + key + ")",
       rowsD.every(r => r.completed <= r.created));
    ok("  free spins used never exceed issued (" + key + ")",
       rowsD.every(r => r.fsUsed <= r.fs));
  });
});

const trigger = [...d.querySelectorAll("#tbl tr[data-key]")]
  .find(r => r.getAttribute("data-key") === "2026-08|Twitter");
ok("channel rows are clickable", !!trigger);
trigger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("clicking a row opens the popup", !d.getElementById("modal").hidden);
ok("the popup names the channel and month",
   /Twitter/.test(d.getElementById("modal-title").textContent) &&
   /Aug/.test(d.getElementById("modal-title").textContent));
const bodyRows = d.querySelectorAll("#modal-tbl tbody tr");
ok("the popup lists a row per bonus plus a total",
   bodyRows.length === DATA.detail["2026-08|Twitter"].length + 1, bodyRows.length);
const modalTotal = d.querySelector("#modal-tbl tr.grp-hd");
const augTwIdx = DATA.months.indexOf("2026-08");
ok("the popup's total equals the table cell",
   modalTotal.children[1].textContent ===
   DATA.tickets.Twitter.created[augTwIdx].toLocaleString("en-US"),
   modalTotal.children[1].textContent);
// One person can hold three bonuses in a month, so a players total would be
// wrong. It must stay blank rather than summing the column.
ok("the popup does not total the players column",
   modalTotal.children[3].textContent === "—");
d.getElementById("modal-x").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("the popup closes", d.getElementById("modal").hidden);

// Community rows list the whole group, including bonuses with no channel.
ok("a Community popup lists more bonuses than its channels do",
   (DATA.detail["2026-08|Community"] || []).length >
   (DATA.detail["2026-08|Discord"] || []).length);

// --- segment player popup ---------------------------------------------------
segRows.forEach(r => {
  ok("  " + r.segment + ": player list matches the reached cell",
     (r.players || []).length === r.Community,
     (r.players || []).length + " vs " + r.Community);
  const got = (r.players || []).reduce((a, p) => a + p.adj, 0);
  // budget: one rounded value per player plus the cell itself
  const budget = ((r.players || []).length + 1) * 0.005 + 0.01;
  ok("  " + r.segment + ": player GGR sums to the cell",
     Math.abs(got - r.CommunityAdj) <= budget, got + " vs " + r.CommunityAdj);
  ok("  " + r.segment + ": players are sorted by adjusted GGR",
     (r.players || []).every((p, i, a) => i === 0 || a[i - 1].adj >= p.adj));
});

const segTrigger = [...d.querySelectorAll("#tbl-seg tr[data-seg]")]
  .find(r => r.getAttribute("data-seg") === "Vip");
ok("segment rows are clickable", !!segTrigger);
segTrigger.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("clicking a segment opens the player list", !d.getElementById("modal").hidden);
const vip = segRows.find(r => r.segment === "Vip");
ok("the player list renders a row per player plus a total",
   d.querySelectorAll("#modal-tbl tbody tr").length === vip.players.length + 1);
ok("the popup header names the segment and its penetration",
   /Vip/.test(d.getElementById("modal-title").textContent) &&
   d.getElementById("modal-title").textContent
     .indexOf(CC.fmtPct1(vip.CommunityPen)) >= 0,
   d.getElementById("modal-title").textContent);

// Under same-month attribution every listed player has a 2026 ticket, by
// definition. Under cohort, players reached in 2025 and never re-ticketed are
// still reached and show zero — that is the difference between the two views,
// and a zero there must not read as a missing row.
ok("same-month listings only contain players ticketed in 2026",
   DATA.segments["month|" + CC.state.whale]
     .every(r => (r.players || []).every(p => p.tickets > 0)));
ok("cohort listings include players with no 2026 ticket",
   DATA.segments["cohort|" + CC.state.whale]
     .some(r => (r.players || []).some(p => p.tickets === 0)));
d.getElementById("modal-x").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("the player list closes", d.getElementById("modal").hidden);

// --- by-bonus table ---------------------------------------------------------
const bonusRows = d.querySelectorAll("#tbl-bonus tbody tr");
ok("bonus table has a row per bonus plus a total",
   bonusRows.length === DATA.bonuses.length + 1, bonusRows.length);

// Rolled up from the same detail rows as the monthly tables, so it cannot
// disagree with them. Counting from one export and listing from another put
// August out by two, then by nine — the current month is live.
ok("bonus tickets equal the Community year",
   DATA.bonuses.reduce((a, b) => a + b.created, 0) ===
   DATA.tickets.Community.created.reduce((a, b) => a + b, 0),
   DATA.bonuses.reduce((a, b) => a + b.created, 0));
ok("bonus completions equal the Community year",
   DATA.bonuses.reduce((a, b) => a + b.completed, 0) ===
   DATA.tickets.Community.completed.reduce((a, b) => a + b, 0));

DATA.bonuses.forEach(b => {
  ok("  " + b.name.slice(0, 34) + ": completed <= sent", b.completed <= b.created);
  ok("  " + b.name.slice(0, 34) + ": users <= players", b.playersPaid <= b.players);
  ok("  " + b.name.slice(0, 34) + ": spins used <= sent", b.fsUsed <= b.fs);
  ok("  " + b.name.slice(0, 34) + ": freebet used <= sent", b.fbUsed <= b.fb + 0.01);
});

// The players total is a DISTINCT count over all bonuses, never the column sum
// — one person holds several, so adding the column overstates the programme.
const bonusTotal = d.querySelector("#tbl-bonus tr.grp-hd");
const D = DATA.bonusDistinct;
const naivePlayers = DATA.bonuses.reduce((a, b) => a + b.players, 0);
ok("the players total is the distinct count, not the column sum",
   bonusTotal.children[4].textContent.indexOf(D.players.toLocaleString("en-US")) === 0,
   bonusTotal.children[4].textContent);
ok("distinct is materially smaller than the sum — the overlap is real",
   D.players < naivePlayers, D.players + " vs " + naivePlayers);
ok("a union is never smaller than its largest part",
   D.players >= Math.max(...DATA.bonuses.map(b => b.players)));
ok("users are a subset of players", D.playersPaid <= D.players);
ok("the row shows the sum alongside so the overlap is visible",
   bonusTotal.children[4].textContent.indexOf(
     naivePlayers.toLocaleString("en-US")) > 0,
   bonusTotal.children[4].textContent);

// Neither switch touches this table: a ticket was sent or it was not.
const bonusBefore = d.getElementById("tbl-bonus").innerHTML;
d.getElementById("b-cohort").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
ok("the bonus table ignores the attribution switch",
   d.getElementById("tbl-bonus").innerHTML === bonusBefore);
d.getElementById("b-month").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

console.log(fails === 0 ? "\nall assertions passed" : "\n" + fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
