"use strict";
/**
 * scrub-data.js — removes corrupt and excluded rows from every file a report reads.
 *
 *   node scrub-data.js            remove them, saving what it removes
 *   node scrub-data.js --dry      say what it would remove, change nothing
 *
 * The rules live in data-exclusions.json. Read the note at the top of that
 * file before changing anything here.
 *
 * WHY A SCRUB AND NOT A CHECK IN EACH BUILDER
 *
 * Thirteen builders read these caches, each with its own loading code. A rule
 * added to all thirteen is a rule that will be missing from the fourteenth,
 * and the failure is silent — the report still builds, it just quietly counts
 * a $101bn bet. Removing the rows from the shared inputs means a builder
 * cannot include one even if nobody told it not to.
 *
 * The cache writers apply the same rules on the way in, so a refresh does not
 * undo this. Both halves are needed: this one cleans what is already on disk,
 * that one keeps it clean.
 *
 * NOTHING IS DESTROYED. Every removed row is appended to _excluded-rows/
 * first, under a name mirroring the file it came from.
 */

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const RULES_FILE = path.join(HERE, "data-exclusions.json");
const KEEP_DIR = path.join(HERE, "_excluded-rows");
const DRY = process.argv.includes("--dry");

/* Where player rows live. Anything else in the folder is left alone. */
const TARGETS = [
  { dir: path.join(HERE, "ftd-report", "cache"), ext: ".json" },
  { dir: path.join(HERE, "cache-bonus"), ext: ".json" },
  { dir: path.join(HERE, "_mcp-exports"), ext: ".json" },
  { dir: path.join(HERE, "_mcp-exports"), ext: ".csv" },
];

/* ------------------------------------------------------------------ rules */

/* The rules are applied by data-exclusions.js, not re-implemented here: the
   cache writers use the same module, so a row cannot be judged one way on
   the way in and another way on the way out. */
const EX = require("./data-exclusions");
if (EX.problem) {
  console.error(`\n  Cannot read data-exclusions.json: ${EX.problem}\n`);
  process.exit(1);
}
const CEILING = EX.CEILING, CEIL_FIELDS = EX.CEIL_FIELDS;
const LISTED = EX.rules.players || [];
const reasonToDrop = EX.reasonToDrop;

/* --------------------------------------------------------------- plumbing */

function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/* Removed rows are appended, not overwritten: scrubbing twice after two
   different refreshes must not throw away what the first one caught. */
function keep(relPath, rows) {
  if (!rows.length || DRY) return;
  const out = path.join(KEEP_DIR, relPath.replace(/[\\/]/g, "__") + ".json");
  fs.mkdirSync(KEEP_DIR, { recursive: true });
  let prev = [];
  if (fs.existsSync(out)) {
    try { prev = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { prev = []; }
  }
  writeAtomic(out, JSON.stringify(prev.concat(rows)));
}

/* ------------------------------------------------------------------- json */

/** The row array inside a file, whatever shape it arrived in. */
function rowsOf(data) {
  if (Array.isArray(data)) return { rows: data, put: r => r };
  if (data && Array.isArray(data.rows)) return { rows: data.rows, put: r => ({ ...data, rows: r }) };
  const qr = data && data.query_result && data.query_result.data;
  if (qr && Array.isArray(qr.rows)) {
    return {
      rows: qr.rows,
      put: r => ({ ...data, query_result: { ...data.query_result, data: { ...qr, rows: r } } }),
    };
  }
  return null;
}

function scrubJson(file, rel, tally) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return { skipped: "not JSON" }; }

  const found = rowsOf(data);
  if (!found) return { skipped: "no row array" };
  const { rows, put } = found;
  if (!rows.length) return { removed: 0, left: 0 };
  const first = rows[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return { skipped: "rows are not objects" };
  }
  const hasPlayer = first.player_id !== undefined || first.username !== undefined;
  const hasMoney = CEIL_FIELDS.some(k => first[k] !== undefined);
  if (!hasPlayer && !hasMoney) return { skipped: "no player or money column" };

  const gone = [], left = [];
  for (const r of rows) {
    const why = reasonToDrop(r);
    if (why) { gone.push({ ...r, _why: why }); tally.set(why, (tally.get(why) || 0) + 1); }
    else left.push(r);
  }
  if (!gone.length) return { removed: 0, left: left.length };

  keep(rel, gone);
  if (!DRY) writeAtomic(file, JSON.stringify(put(left)));
  return { removed: gone.length, left: left.length, gone };
}

/* -------------------------------------------------------------------- csv */

/** Splits one CSV line, honouring quoted fields containing commas. */
function splitCsv(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function scrubCsv(file, rel, tally) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { skipped: "empty" };
  const head = splitCsv(lines[0]).map(h => h.trim().toLowerCase());
  const cols = {};
  for (const k of ["player_id", "username"].concat(CEIL_FIELDS)) {
    const i = head.indexOf(k);
    if (i >= 0) cols[k] = i;
  }
  if (!Object.keys(cols).length) return { skipped: "no player or money column" };

  const gone = [], left = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "") { left.push(lines[i]); continue; }
    const cells = splitCsv(lines[i]);
    const row = {};
    for (const k of Object.keys(cols)) row[k] = cells[cols[k]];
    const why = reasonToDrop(row);
    if (why) { gone.push({ ...row, _why: why, _line: lines[i] }); tally.set(why, (tally.get(why) || 0) + 1); }
    else left.push(lines[i]);
  }
  if (!gone.length) return { removed: 0, left: left.length - 1 };

  keep(rel, gone);
  if (!DRY) writeAtomic(file, left.join("\n"));
  return { removed: gone.length, left: left.length - 1, gone };
}

/* ------------------------------------------------------------------- main */

console.log(`\n  Row ceiling ${CEILING.toLocaleString()} on ${CEIL_FIELDS.join(", ")}` +
            (LISTED.length ? `\n  Excluded player(s): ` +
              LISTED.map(p => `${p.username || "?"} (${p.player_id})`).join(", ") : "") );
if (DRY) console.log("  --dry: nothing will be written.");
console.log("");

let files = 0, removed = 0, touched = 0;
const skips = new Map(), tally = new Map();

for (const t of TARGETS) {
  if (!fs.existsSync(t.dir)) continue;
  for (const name of fs.readdirSync(t.dir).filter(f => f.toLowerCase().endsWith(t.ext)).sort()) {
    const file = path.join(t.dir, name);
    if (!fs.statSync(file).isFile()) continue;
    const rel = path.relative(HERE, file);
    files++;
    const r = t.ext === ".csv" ? scrubCsv(file, rel, tally) : scrubJson(file, rel, tally);
    if (r.skipped) { skips.set(r.skipped, (skips.get(r.skipped) || 0) + 1); continue; }
    if (r.removed) {
      touched++;
      removed += r.removed;
      console.log(`  ${rel.padEnd(36)} ${String(r.removed).padStart(4)} removed  ` +
                  `(${[...new Set(r.gone.map(g => g._why))].join("; ")})`);
    }
  }
}

console.log(`\n  ${files} file(s) checked, ${touched} changed, ${removed.toLocaleString()} row(s) removed.`);
if (tally.size) {
  console.log("  by reason: " + [...tally].map(([k, n]) => `${n}x ${k}`).join(", "));
}
if (skips.size) {
  console.log("  skipped: " + [...skips].map(([k, n]) => `${n} ${k}`).join(", "));
}
if (removed && !DRY) {
  console.log(`  removed rows saved under ${path.basename(KEEP_DIR)}/`);
  console.log("  Rebuild the reports (UPDATE-EVERYTHING.bat) for this to show.");
}
console.log("");
