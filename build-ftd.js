"use strict";
/**
 * build-ftd.js — pulls query 1732 from Redash, month by month, and writes
 * ftd-data.json: every number the FTD report displays.
 *
 *   node build-ftd.js                     the range in config.env
 *   node build-ftd.js --from=2025-01 --to=2026-08
 *   node build-ftd.js --month=2026-08     refresh one month into the cache
 *   node build-ftd.js --no-cache          ignore the month cache, pull everything
 *   node build-ftd.js --offline           rebuild from cached months, no Redash
 *   node build-ftd.js --csv="C:\\folder"   build from CSV exports instead, no VPN needed
 *
 * Each month is cached under cache/ as soon as it succeeds, holding only the
 * fields the aggregation needs — about 15 MB a month rather than 40. A run that
 * dies on month 14 of 20 resumes rather than starting over, which matters when
 * the only thing that failed was the VPN.
 *
 * Redash is reachable over the company VPN only, so this has to run on a
 * machine that is on it.
 */

const fs = require("fs");
const path = require("path");
const { runQuery, loadConfig } = require("../redash-kit/redash");
const { createAggregator } = require("./ftd-aggregate");
const { readCsvObjects } = require("./csv-rows");
/* Corrupt and excluded rows are dropped on the way into the cache, so a
   refresh cannot put back what scrub-data.js just took out. Same module the
   scrub uses — see data-exclusions.json. */
const EXCL = require("../data-exclusions");

const HERE = __dirname;
const CFG = Object.assign({}, loadConfig(path.join(HERE, "..")), loadConfig(HERE));
const CACHE = path.join(HERE, "cache");

const ARGV = process.argv.slice(2);
const flag = name => {
  const hit = ARGV.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = name => ARGV.includes(`--${name}`);

const QUERY = Number(CFG.FTD_QUERY || 1732);
const KEY = CFG[`REDASH_KEY_${QUERY}`];
const TIMEOUT = Number(CFG.QUERY_TIMEOUT_MS || 900000);
const OUT = flag("out") || path.join(HERE, "ftd-data.json");

/* The country filter list, pinned in config.env. Empty means "pick the busiest
   forty", which is not what the original did — see ftd-aggregate.js. */
const COUNTRIES = (CFG.FTD_COUNTRIES || "").split(",").map(s => s.trim()).filter(Boolean);

/* The MTD comparison runs to the last day the newest month actually holds, so
   it moves forward as Redash fills in. Set FTD_MTD_DAY to pin it instead. */
function lastDayWithData(rows) {
  let max = 0;
  for (const r of rows) {
    const d = parseInt(String(r.transaction_date).slice(8, 10), 10);
    if (d > max) max = d;
  }
  return max;
}

/* Only these columns are kept. The rest of the ~42 are not used by the report
   and would triple the cache. */
const KEEP = [
  "transaction_date", "player_id", "username", "player_country",
  "aff_type", "is_affiliate", "aff_source", "aff_username",
  "reg_date", "first_deposit_date", "ftd_type", "favourite_product",
  "sign_up", "ftd", "blockchain", "deposit", "withdraw",
  "game_product", "bet", "ggr", "ngr", "adjusted_ggr", "bonus_cost",
  /* Added for the monthly FTD Performance report: blocked counts, the bonus
     usage table and the distinct-game count. Costs roughly 40% more cache per
     month and saves a separate CSV export of the same query. */
  "player_status", "deposit_count", "bonus_group", "bonus_name", "game_id",
  /* Added to 1732 later than the rest. Kept so it survives caching — it was
     being silently dropped here, which made it look as though the query did
     not return it at all. */
  "click_count",
  /* Verification state, for the Deposit Retention page's filters. Exactly the
     same trap as click_count above, and it cost the same afternoon: 1732 has
     selected all three from bi.players_info_mv for a while, `trim()` dropped
     every one, and the cache looked like proof that the query returned
     nothing. It is not — this list is an allowlist, so a column absent from it
     is invisible downstream no matter what Redash sends.
     A closed month is never refetched (see the `usable` rule below), so these
     only reach the cache for months pulled from here on. To backfill the
     history: node build-ftd.js --no-cache  — twenty months, 20–40 minutes, VPN
     required. */
  "kyc_status", "email_verified_at", "phone_verified_at",
];

const pad = n => String(n).padStart(2, "0");
const lastDay = ym => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/* transaction_date is the day everything downstream groups by, so it is stored
   as YYYY-MM-DD and nothing else.

   Query 1732 was edited on 2026-08-26 and began returning it as a full
   timestamp — "2026-08-01T00:02:19.191Z". Readers that sliced the first ten
   characters carried on working; build-month.js did not, and died with
   "Invalid time value" on every run from that day. Worse than the crash was the
   near miss: anything grouping on the raw string would have seen tens of
   thousands of distinct "days" in a month and reported it without complaint.

   Normalising here means the cache is correct whatever the query returns, and
   only this line has to know. reg_date, first_deposit_date and block_date are
   deliberately left as timestamps — code reads times off them. */
function trim(rows) {
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], o = {};
    for (const k of KEEP) if (r[k] !== undefined && r[k] !== null && r[k] !== "") o[k] = String(r[k]);
    if (o.transaction_date) o.transaction_date = o.transaction_date.slice(0, 10);
    out[i] = o;
  }
  return out;
}

const today = new Date();
const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
const FROM = flag("month") || flag("from") || CFG.FTD_FROM || "2025-01";
const TO = flag("month") || flag("to") || CFG.FTD_TO || thisMonth;
const ONLY = flag("month");

/* Building from a folder of CSV exports instead of Redash. Useful off the VPN,
   and it is how the aggregation was checked against the original report. */
function monthsFromCsvFolder(dir) {
  const picked = new Map();
  for (const f of fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith(".csv"))) {
    const rows = readCsvObjects(path.join(dir, f));
    if (!rows.length) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(rows[0].transaction_date))) {
      console.log(`  ${f}  skipped — transaction_date is not YYYY-MM-DD, so this file was`);
      console.log(`  ${" ".repeat(f.length)}  reformatted by a spreadsheet and no longer matches Redash`);
      continue;
    }
    const seen = new Map();
    for (const r of rows) {
      const ym = String(r.transaction_date).slice(0, 7);
      if (ym) seen.set(ym, (seen.get(ym) || 0) + 1);
    }
    let ym = null, best = 0;
    for (const [k, n] of seen) if (n > best) { best = n; ym = k; }
    const prev = picked.get(ym);
    if (!prev || rows.length > prev.rows.length) picked.set(ym, { f, rows });
    console.log(`  ${f.padEnd(24)} ${ym}  ${rows.length.toLocaleString()} rows`);
  }
  return picked;
}

(async () => {
  const csvDir = flag("csv");
  if (csvDir) {
    console.log(`\n  FTD report build — from CSV exports in ${csvDir}\n`);
    const picked = monthsFromCsvFolder(csvDir);
    const months = [...picked.keys()].sort();
    if (!months.length) { console.error("\n  No usable CSVs found.\n"); process.exit(1); }
    const mpy = {};
    for (const ym of months) {
      const y = ym.slice(0, 4), i = parseInt(ym.slice(5, 7), 10);
      mpy[y] = Math.max(mpy[y] || 0, i);
    }
    const newestCsv = picked.get(months[months.length - 1]);
    const agg = createAggregator({ years: Object.keys(mpy).sort(), monthsPerYear: mpy, excludeUser: CFG.FTD_EXCLUDE_USER,
      countries: COUNTRIES, mtdCap: Number(CFG.FTD_MTD_DAY || 0) || lastDayWithData(newestCsv) || 16 });
    for (const ym of months) agg.addMonth(ym, picked.get(ym).rows);
    const data = agg.finish();
    fs.writeFileSync(OUT + ".tmp", JSON.stringify(data));
    fs.renameSync(OUT + ".tmp", OUT);
    console.log(`\n  ${data.meta.ftdCount.toLocaleString()} first deposits across ${months.length} months`);
    console.log(`  Written to ${OUT}\n`);
    return;
  }

  if (!KEY) {
    console.error(`\n  No API key for query ${QUERY}.`);
    console.error(`  Add REDASH_KEY_${QUERY}=... to config.env`);
    console.error(`  (Redash: open the query -> the "..." menu -> Show API Key)\n`);
    process.exit(1);
  }
  fs.mkdirSync(CACHE, { recursive: true });

  const months = monthRange(FROM, TO);
  console.log(`\n  FTD report build — query ${QUERY}, ${months[0]} to ${months[months.length - 1]}`);
  console.log(`  ${months.length} month${months.length === 1 ? "" : "s"}. Expect several minutes; ` +
              `each month is 80,000–130,000 rows.\n`);

  const started = Date.now();
  let pulled = 0, cached = 0;

  for (const ym of months) {
    const file = path.join(CACHE, `${ym}.json`);
    const isCurrent = ym === thisMonth;
    const onDisk = fs.existsSync(file);
    /* The current month is normally refetched, since it is still filling up. */
    const usable = onDisk && !has("no-cache") && (has("offline") || !(isCurrent && !ONLY));
    if (usable) { cached++; console.log(`  ${ym}  cached`); continue; }
    if (has("offline")) {
      console.log(`  ${ym}  not cached, skipped (offline)`);
      continue;
    }

    process.stdout.write(`  ${ym}  `);
    const t0 = Date.now();
    let rows;
    try {
      ({ rows } = await runQuery({
        queryId: QUERY,
        apiKey: KEY,
        host: CFG.REDASH_HOST,
        parameters: {
          date_range: { start: `${ym}-01`, end: `${ym}-${pad(lastDay(ym))}` },
          "Current Segment": "All",
        },
        label: `1732 ${ym}`,
        timeoutMs: TIMEOUT,
        onTick: () => process.stdout.write("."),
      }));
    } catch (e) {
      console.error(`\n\n  Failed on ${ym}: ${e.message}`);
      console.error(`  If it could not connect, check the VPN. Months already pulled are`);
      console.error(`  cached, so rerunning picks up where this stopped.\n`);
      process.exit(1);
    }
    const { rows: slim, dropped } = EXCL.filterRows(trim(rows));
    fs.writeFileSync(file + ".tmp", JSON.stringify(slim));
    fs.renameSync(file + ".tmp", file);
    pulled++;
    console.log(` ${rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s` +
                (dropped.length ? ` (${dropped.length} excluded: ${
                  [...new Set(dropped.map(r => r._why))].join("; ")})` : ""));
  }

  if (ONLY) {
    console.log(`\n  Cached ${ONLY}. Run without --month to rebuild ftd-data.json.\n`);
    return;
  }

  console.log(`\n  ${pulled} month(s) pulled, ${cached} from cache. Aggregating…`);

  const monthsPerYear = {};
  for (const ym of months) {
    const y = ym.slice(0, 4), i = parseInt(ym.slice(5, 7), 10);
    monthsPerYear[y] = Math.max(monthsPerYear[y] || 0, i);
  }
  const years = Object.keys(monthsPerYear).sort();

  const loadedMonths = months.filter(ym => fs.existsSync(path.join(CACHE, `${ym}.json`)));

  /* The MTD cap is the last day the newest month has data for — but on the 1st
     of a month that month is empty, lastDayWithData returns 0, and this used to
     fall through to a hardcoded 16. The report then compared "days 1-16" of
     every month against nothing in particular, with no hint on the page or in
     the console that 16 was invented rather than measured.
     
     So walk back to the newest month that actually has enough days to compare,
     exactly as build_overview.py does. A month is skipped only when it cannot
     support the comparison, and the console says which and why. */
  /* 1 = follow the calendar; a month is only skipped when it has no data at
     all, which is what stopped the hardcoded 16 being used. */
  const MIN_DAYS = 1;
  let newest = null, mtdCap = Number(CFG.FTD_MTD_DAY || 0);
  if (mtdCap) {
    newest = loadedMonths[loadedMonths.length - 1];
    console.log(`  Month-to-date comparison pinned to day ${mtdCap} by FTD_MTD_DAY.`);
  } else {
    for (let i = loadedMonths.length - 1; i >= 0; i--) {
      const ym = loadedMonths[i];
      const d = lastDayWithData(JSON.parse(fs.readFileSync(path.join(CACHE, `${ym}.json`), "utf8")));
      if (d >= MIN_DAYS) { newest = ym; mtdCap = d; break; }
      console.log(`  ${ym} has ${d} day(s) of data — too few to compare, looking further back`);
    }
    if (!mtdCap) {
      console.error(`\n  No cached month has ${MIN_DAYS}+ days of data. Nothing to build.\n`);
      process.exit(1);
    }
    console.log(`  Month-to-date comparison runs to day ${mtdCap}, the last day ${newest} has data for.`);
  }

  const agg = createAggregator({ years, monthsPerYear, excludeUser: CFG.FTD_EXCLUDE_USER, countries: COUNTRIES, mtdCap });
  for (const ym of loadedMonths) {
    agg.addMonth(ym, JSON.parse(fs.readFileSync(path.join(CACHE, `${ym}.json`), "utf8")));
  }
  const data = agg.finish();

  fs.writeFileSync(OUT + ".tmp", JSON.stringify(data));
  fs.renameSync(OUT + ".tmp", OUT);

  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\n  ${data.meta.ftdCount.toLocaleString()} first deposits across ${months.length} months`);
  console.log(`  ${data.CTRY.length - 1} countries, ${data.AFFKEYS.length} affiliates`);
  console.log(`  Written to ${OUT}  (${mb} MB, ${secs}s)`);
  if (data.meta.unknownPaymentMethods.length) {
    console.log(`\n  Payment methods not in the known list, counted as Fiat:`);
    console.log(`    ${data.meta.unknownPaymentMethods.join(", ")}`);
    console.log(`  If any of those are crypto, add them to CRYPTO_RAILS in ftd-aggregate.js.`);
  }
  console.log(`\n  Next: node make-ftd-html.js\n`);
})();
