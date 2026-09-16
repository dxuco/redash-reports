/**
 * check-theme.js — confirms every report uses the house palette.
 *
 *   node check-theme.js
 *
 * The reports are standalone single-file HTML, so they cannot share a
 * stylesheet: each carries its own copy of the colours. That makes drift easy
 * and invisible. This reads theme.css as the source of truth and flags any
 * colour in any report that is not in it.
 *
 * Exits non-zero if anything is off-palette, so it can gate a publish.
 */

const fs = require("fs");
const path = require("path");

const REPORTS = [
  ["Bonus Cost",        "report.html"],
  ["Bonus Cost (built)", "bonus-cost-report.html"],
  ["FTD Report",        path.join("ftd-report", "ftd-report.html")],
  ["FTD template",      path.join("ftd-report", "ftd-report-template.html")],
  ["FTD Aug 2026",      "august-2026-ftd.html"],
  ["Acquisition 2026",  "acquisition-2026.html"],
  ["Community Chan.",   "community-channels.html"],
  ["Community Ch. tpl", path.join("community-channels", "channels-template.html")],
  ["FTD Channels",     "ftd-channels.html"],
  ["FTD Channels tpl", path.join("ftd-channels", "ftd-channels-template.html")],
  ["Streamers",        "streamers.html"],
  ["Streamers tpl",    path.join("streamers", "streamers-template.html")],
  ["Retention",        "retention.html"],
  ["Retention tpl",    path.join("retention", "retention-template.html")],
  ["Reactivation",     "reactivation.html"],
  ["Reactivation tpl", path.join("reactivation", "reactivation-template.html")],
  /* retention-full.html is no longer built. Its template stays on disk and stays
     on the palette check, so if it is ever revived it does not come back off-house. */
  ["Retention all tpl", path.join("retention-full", "retention-full-template.html")],
  ["Deposit Frequency",  "deposit-frequency.html"],
  ["Deposit Freq tpl",   path.join("deposit-frequency", "deposit-frequency-template.html")],
  /* These were never on the list, so neither their colours nor their cover
     were ever checked — including business-overview, which is the page the
     cover standard is benchmarked against. */
  ["Business Overview", "business-overview.html"],
  ["Overview tpl",      path.join("overview", "overview-template.html")],
  ["Depositor Mix",     "depositor-mix.html"],
  ["Mix tpl",           path.join("overview", "mix-template.html")],
  ["FTD Share",         "ftd-share.html"],
  ["Acquisition 2025",  "acquisition-2025.html"],
  ["Acquisition tpl",   path.join("acquisition-report", "acquisition-template.html")],
];

/* Pages that carry the house COVER but keep their own body palette.
   They are tools rather than reports — a dashboard shell, a keyword tracker,
   a fixtures calendar — and were built with their own colour schemes. On
   2026-08-25 they were given the standard green header so the site reads as
   one thing when you click between pages; putting them through the palette
   scan as well would flag dozens of deliberate colours, so only the cover is
   checked here. */
const COVER_ONLY = [
  ["VIP Transfer",     "vip-transfer.html"],
  ["KW Radar",         "kw-radar.html"],
  ["Sports Calendar",  "sports-calendar.html"],
  ["Dashboard index",  "index.html"],
];

/* Colours that are fine anywhere: pure white/black and transparent shorthands.
   Everything else has to come from theme.css. */
const FREE = new Set(["#FFF", "#FFFFFF", "#000", "#000000"]);

function palette() {
  const file = path.join(__dirname, "theme.css");
  if (!fs.existsSync(file)) {
    console.error("theme.css is missing — it is the source of truth for this check.");
    process.exit(2);
  }
  const css = fs.readFileSync(file, "utf8");
  const set = new Set(FREE);
  for (const m of css.matchAll(/--[a-z0-9-]+\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    set.add(m[1].toUpperCase());
  }
  return set;
}

/* `&#9664;` is an arrow entity, not a colour. Requiring a non-& before the #
   keeps those out of the results. */
const HEX = /(?<![&\w])#[0-9A-Fa-f]{3,6}\b/g;

/* An id selector can look exactly like a 3-digit colour — `#dd2{display:none}`
   is an element, not a shade of green. Anything followed by a brace or by
   another selector fragment is markup, so skip it. */
const SELECTOR_AFTER = /^\s*[{,.:#>[]/;

function scan(file, allowed) {
  const html = fs.readFileSync(file, "utf8");
  const bad = new Map();
  for (const m of html.matchAll(HEX)) {
    const hex = m[0].toUpperCase();
    if (allowed.has(hex)) continue;
    if (SELECTOR_AFTER.test(html.slice(m.index + m[0].length, m.index + m[0].length + 3))) continue;
    if (!bad.has(hex)) bad.set(hex, { n: 0, first: "" });
    const e = bad.get(hex);
    e.n++;
    if (!e.first) e.first = html.slice(Math.max(0, m.index - 45), m.index + 12).replace(/\s+/g, " ");
  }
  return bad;
}

const allowed = palette();
console.log(`\n  theme.css defines ${allowed.size - FREE.size} colours.\n`);

let problems = 0, missing = 0;
for (const [label, rel] of REPORTS) {
  const file = path.join(__dirname, rel);
  if (!fs.existsSync(file)) {
    console.log(`  --  ${label.padEnd(20)} not built yet (${rel})`);
    missing++;
    continue;
  }
  const bad = scan(file, allowed);
  if (bad.size === 0) {
    console.log(`  ok  ${label.padEnd(20)} on palette`);
  } else {
    problems += bad.size;
    console.log(`  !!  ${label.padEnd(20)} ${bad.size} off-palette colour(s):`);
    for (const [hex, e] of [...bad].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`        ${String(e.n).padStart(3)}x  ${hex}   ...${e.first}`);
    }
  }
}

/* ---------------------------------------------------------------------------
   The cover band.

   Colour drift was already caught above; SIZE drift was not, and it happened:
   the reports had settled into three different green bands because each new
   page copied whatever the previous one did, and two files carry a duplicate
   stylesheet whose second `.cover` rule silently wins. The numbers live in
   theme.css now — this checks the reports still agree with them.

   Only the last matching rule counts, because that is the one the browser
   applies — which is the whole reason the drift went unnoticed.

   Padding and widths are checked everywhere. Title and subtitle sizes are
   checked only where a page scopes them to `.cover`; the older pages style a
   bare `h1` and `.sub` instead, and those selectors are reused elsewhere in
   the file, so matching on them produces false alarms rather than findings.
   Those pages are reported as "no rule to check" — verified by hand on
   2026-08-25 as 1.55rem / .86rem, but not machine-checked.
   ------------------------------------------------------------------------- */
function coverStandard() {
  const css = fs.readFileSync(path.join(__dirname, "theme.css"), "utf8");
  const get = (name) => {
    const m = new RegExp("--" + name + "\\s*:\\s*([^;]+);").exec(css);
    return m ? m[1].trim() : null;
  };
  return {
    padding: get("cover-padding"),
    title: get("cover-title"),
    subtitle: get("cover-subtitle"),
    width: get("page-width"),
    lineHeight: get("cover-line-height"),
    innerMin: get("cover-inner-min"),
  };
}

/* Last value of `prop` in any block for `sel` — the one that wins. */
function lastDecl(html, sel, prop) {
  const re = new RegExp("(?:^|[},;\\s])" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                        "\\s*\\{([^}]*)\\}", "g");
  let m, found = null;
  while ((m = re.exec(html))) {
    const d = new RegExp(prop + "\\s*:\\s*([^;}]+)").exec(m[1]);
    if (d) found = d[1].trim();
  }
  return found;
}

const std = coverStandard();
const sizeIssues = [];
console.log("");
const reportFiles = new Set(REPORTS.map(([, r]) => r));
for (const [label, rel] of REPORTS.concat(COVER_ONLY)) {
  const isReport = reportFiles.has(rel);
  const file = path.join(__dirname, rel);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  if (!/\.cover\s*\{/.test(html)) continue;          // not a cover-style page

  const pad = lastDecl(html, ".cover", "padding");
  const inner = lastDecl(html, ".cover-inner", "max-width");
  const wrap = lastDecl(html, ".wrap", "max-width") || lastDecl(html, "section", "max-width");
  /* Only selectors SCOPED to .cover are checked. An earlier version fell back
     to a bare `h1` / `.sub` when the scoped rule was missing, and promptly
     failed six reports over a 10.5px `.sub` belonging to a chart legend. A
     check that cries wolf gets switched off, so unscoped pages are reported
     as unverifiable instead of broken. */
  const title = lastDecl(html, ".cover h1", "font-size");
  const sub = lastDecl(html, ".cover p", "font-size");

  const norm = (v) => (v || "").replace(/\s+/g, " ").replace(/(^|\s)\./g, "$10.");
  const wrong = [];
  if (norm(pad) !== norm(std.padding)) wrong.push(`padding ${pad}`);
  /* Every cover is --page-width wide, on every page, so the title sits in the
     same place when you click between them. That was tried the other way
     first — matching each page's own content column — and on the live site the
     header visibly jumped on the narrower tool pages. A header that moves is
     worse than a title that is wider than the table beneath it. */
  if (inner && norm(inner) !== norm(std.width)) wrong.push(`cover-inner ${inner}`);
  if (isReport && wrap && norm(wrap) !== norm(std.width)) wrong.push(`container ${wrap}`);
  if (title && norm(title) !== norm(std.title)) wrong.push(`title ${title}`);
  if (sub && norm(sub) !== norm(std.subtitle)) wrong.push(`subtitle ${sub}`);

  /* The two that actually equalise the band height. Padding and type sizes
     alone left the bands visibly different, because line-height is inherited
     from body (1.45 on some pages, 1.5 on others) and because some covers
     hold controls while others hold only a title. */
  const lh = lastDecl(html, ".cover", "line-height");
  const min = lastDecl(html, ".cover-inner", "height") ||
              lastDecl(html, ".cover-inner", "min-height");
  if (norm(lh) !== norm(std.lineHeight)) wrong.push(`line-height ${lh || "unset"}`);
  if (norm(min) !== norm(std.innerMin)) wrong.push(`inner height ${min || "unset"}`);
  const nowrap = lastDecl(html, ".cover-inner", "flex-wrap");
  if (nowrap !== "nowrap") wrong.push(`flex-wrap ${nowrap || "unset"} — the band will grow when controls wrap`);

  const unscoped = [];
  if (!title) unscoped.push("h1");
  if (!sub) unscoped.push("p");

  if (wrong.length) {
    sizeIssues.push(label);
    console.log(`  !!  ${label.padEnd(20)} cover differs: ${wrong.join(", ")}`);
  } else if (unscoped.length) {
    console.log(`  ok  ${label.padEnd(20)} cover matches (no .cover ${unscoped.join("/")} rule to check)`);
  } else {
    console.log(`  ok  ${label.padEnd(20)} cover matches theme.css`);
  }
}

console.log("");
if (problems) {
  console.log(`  ${problems} colour(s) are not in theme.css.`);
  console.log("  Either change them to a palette colour, or add them to theme.css");
  console.log("  with a comment saying what they are for.\n");
  process.exit(1);
}
if (sizeIssues.length) {
  console.log(`  ${sizeIssues.length} report(s) have a cover that does not match theme.css.`);
  console.log("  The cover is one house style — see the --cover-* variables there.");
  console.log("  Fix the report, or change theme.css and every report together.\n");
  process.exit(1);
}
console.log(`  Every report is on the house palette and the house cover.${missing ? `  (${missing} not built yet)` : ""}\n`);
