/**
 * export-csv.js — writes the CSV you would otherwise download from Redash by hand.
 *
 *   node export-csv.js                          last full month, query 1732
 *   node export-csv.js --from=2026-08-01 --to=2026-08-17
 *   node export-csv.js --query=1731 --out="C:\some\folder\bonus.csv"
 *   node export-csv.js --month=2026-07
 *   node export-csv.js --days=30
 *
 * The point is that your existing project keeps reading a CSV exactly as it
 * does today — only the manual export step disappears.
 *
 * Settings come from config.env:
 *   CSV_QUERY    which query to export (default 1732)
 *   CSV_OUT      where to write it
 *   CSV_DAYS     how many days back, when no range is given
 */

const fs = require("fs");
const path = require("path");
const { runQuery, toCsv, loadConfig } = require("./redash");

const CFG = loadConfig(__dirname);
const ARGV = process.argv.slice(2);
const flag = name => {
  const hit = ARGV.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const QUERY = Number(flag("query") || CFG.CSV_QUERY || 1732);
const KEY = CFG[`REDASH_KEY_${QUERY}`];
const DAYS = Number(flag("days") || CFG.CSV_DAYS || 0);

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/* Work out the date range. */
let from = flag("from"), to = flag("to");
const month = flag("month");

if (month) {
  const [y, m] = month.split("-").map(Number);
  from = `${month}-01`;
  to = `${month}-${pad(new Date(y, m, 0).getDate())}`;
} else if (!from || !to) {
  const today = new Date();
  if (DAYS > 0) {
    const start = new Date(today); start.setDate(start.getDate() - DAYS + 1);
    from = from || iso(start);
    to = to || iso(today);
  } else {
    /* Default: the month we are currently in, up to today. */
    from = from || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
    to = to || iso(today);
  }
}

const OUT = flag("out") || CFG.CSV_OUT ||
  path.join(__dirname, "exports", `query-${QUERY}_${from}_to_${to}.csv`);

(async () => {
  if (!KEY) {
    console.error(`\n  No API key for query ${QUERY}.`);
    console.error(`  Add a line to config.env:  REDASH_KEY_${QUERY}=your_query_api_key`);
    console.error(`  (Find it in Redash: open the query -> the "..." menu -> Show API Key)\n`);
    process.exit(1);
  }

  console.log(`\n  Query ${QUERY}, ${from} to ${to}`);
  const started = Date.now();

  let rows, columns;
  try {
    ({ rows, columns } = await runQuery({
      queryId: QUERY,
      apiKey: KEY,
      parameters: QUERY === 1732
        ? { date_range: { start: from, end: to }, "Current Segment": "All" }
        : { date_range: { start: from, end: to } },
      label: `query ${QUERY}`,
      onTick: () => process.stdout.write("."),
    }));
  } catch (e) {
    console.error(`\n\n  Failed: ${e.message}`);
    console.error("  If it could not connect, check the VPN.\n");
    process.exit(1);
  }

  const csv = toCsv(rows, columns);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  /* Write beside the target then rename, so a program reading the CSV never
     sees a half-written file. */
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, csv, "utf8");
  fs.renameSync(tmp, OUT);

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);

  console.log(`\n  ${rows.length.toLocaleString()} rows, ${columns.length} columns, ${mb} MB in ${secs}s`);
  console.log(`  Written to ${OUT}`);
  console.log(`  Columns: ${columns.slice(0, 6).join(", ")}${columns.length > 6 ? ", …" : ""}\n`);
})();
