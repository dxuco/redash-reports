"use strict";
/**
 * build-month.js — builds the data for one monthly FTD Performance page.
 *
 *   node build-month.js                     the month we are in now
 *   node build-month.js --month=2026-08
 *   node build-month.js --no-cache          refetch the current month
 *   node build-month.js --cached            trust the cache, even for this month
 *   node build-month.js --offline           cache only, never touch Redash
 *   node build-month.js --cap=18            pin the month-to-date cut-off
 *
 * Writes <month>-data.json next to this file. make-month-html.js bakes that
 * into the page.
 *
 * Four months are needed: the one being reported, the one before it, the same
 * month last year, and the month before that one — the page compares against
 * all three. They share the month cache with build-ftd.js and use the same
 * on-disk format, so whichever runs first pays for the download and the other
 * reads it for free.
 */

const fs = require("fs");
const path = require("path");
const { runQuery, loadConfig } = require("../redash-kit/redash");
const { aggregateMonth, lastDayWithData, prevMonth, prevYear } = require("./month-aggregate");
const { buildGameHz } = require("./gamehz");

const HERE = __dirname;
const CFG = Object.assign({}, loadConfig(path.join(HERE, "..")), loadConfig(HERE));
const CACHE = path.join(HERE, "cache");

const ARGV = process.argv.slice(2);
const flag = n => { const h = ARGV.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const has = n => ARGV.includes(`--${n}`);

const QUERY = Number(CFG.FTD_QUERY || 1732);
const KEY = CFG[`REDASH_KEY_${QUERY}`];
const TIMEOUT = Number(CFG.QUERY_TIMEOUT_MS || 900000);

const pad = n => String(n).padStart(2, "0");
const lastDay = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };

const today = new Date();
const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
const MONTH = flag("month") || CFG.FTD_MONTH || thisMonth;
const OUT = flag("out") || path.join(HERE, `${MONTH}-data.json`);

/* Same column list build-ftd.js caches. Kept identical on purpose: the two
   scripts share cache files, and a month written by one must be readable by
   the other. */
const KEEP = [
  "transaction_date", "player_id", "username", "player_country",
  "aff_type", "is_affiliate", "aff_source", "aff_username",
  "reg_date", "first_deposit_date", "ftd_type", "favourite_product",
  "sign_up", "ftd", "blockchain", "deposit", "withdraw",
  "game_product", "bet", "ggr", "ngr", "adjusted_ggr", "bonus_cost",
  "player_status", "deposit_count", "bonus_group", "bonus_name", "game_id",
  "click_count",
  /* Verification state, for the Deposit Retention page's filters. Must stay
     identical to build-ftd.js — the two share cache files. */
  "kyc_status", "email_verified_at", "phone_verified_at",
];

function trim(rows) {
  return rows.map(r => {
    const o = {};
    for (const k of KEEP) if (r[k] !== undefined && r[k] !== null && r[k] !== "") o[k] = String(r[k]);
    return o;
  });
}

/**
 * Columns this page needs that were added to KEEP long after the first months
 * were cached. A month pulled before that has none of them.
 *
 * That is not a freshness problem, so no age check finds it — the file can be
 * from this morning and still be missing the columns. And the consequence is
 * not an error: player_status absent reads as nobody blocked, deposit_count
 * absent reads as every player depositing once. The Blocked and One-Time rows
 * would show 0% and 100% in the comparison columns, which looks like a result.
 *
 * So a cache file that predates these columns is treated as unusable and
 * pulled again. It costs one slow run, once, and then the page stays complete.
 */
const REQUIRED_COLUMNS = ["player_status", "deposit_count"];

function cacheIsComplete(rows) {
  if (!rows.length) return true;
  const wanted = new Set(REQUIRED_COLUMNS);
  for (const r of rows) {
    for (const k of [...wanted]) if (r[k] !== undefined) wanted.delete(k);
    if (!wanted.size) return true;
  }
  return false;
}

async function monthRows(ym, { refetch = false } = {}) {
  const file = path.join(CACHE, `${ym}.json`);
  let stale = "", fallback = null;
  if (fs.existsSync(file) && !refetch) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cacheIsComplete(cached)) return cached;
    fallback = cached;
    /* Pulled before the columns this page needs existed. Offline there is
       nothing to be done, so use it and let the build report the gap. */
    if (has("offline")) {
      console.log(`  ${ym}  cached without ${REQUIRED_COLUMNS.join(" / ")} — offline, keeping it`);
      return cached;
    }
    stale = `missing ${REQUIRED_COLUMNS.join(" / ")}`;
  }
  if (has("offline")) {
    console.log(`  ${ym}  not cached, skipped (offline)`);
    return [];
  }
  if (stale) console.log(`  ${ym}  refetching — ${stale}`);
  if (!KEY) {
    console.error(`\n  No API key for query ${QUERY}. Add REDASH_KEY_${QUERY}=… to config.env.`);
    console.error(`  (Redash: open the query -> the "…" menu -> Show API Key)\n`);
    process.exit(1);
  }

  process.stdout.write(`  ${ym}  fetching `);
  const t0 = Date.now();
  let rows;
  try {
    ({ rows } = await runQuery({
      queryId: QUERY, apiKey: KEY, host: CFG.REDASH_HOST,
      parameters: {
        date_range: { start: `${ym}-01`, end: `${ym}-${pad(lastDay(ym))}` },
        "Current Segment": "All",
      },
      label: `1732 ${ym}`, timeoutMs: TIMEOUT,
      onTick: () => process.stdout.write("."),
    }));
  } catch (e) {
    /* A repair that cannot reach Redash must not be worse than not trying.
       There is a usable, if incomplete, copy on disk — build with it and show
       dashes in two rows, rather than failing the step and leaving the whole
       page on yesterday's copy. Only a month with no cache at all is fatal. */
    if (fallback) {
      console.log(`\n  Could not refetch ${ym} (${e.message.split("\n")[0]}).`);
      console.log(`  Using the cached copy — its Blocked and One-Time rows will show a dash.\n`);
      return fallback;
    }
    console.error(`\n\n  Failed on ${ym}: ${e.message}`);
    console.error(`  If it could not connect, check the VPN, then run this again.\n`);
    process.exit(1);
  }
  const slim = trim(rows);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(slim));
  fs.renameSync(file + ".tmp", file);
  console.log(` ${rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return slim;
}

(async () => {
  const pm = prevMonth(MONTH), py = prevYear(MONTH), pypm = prevYear(prevMonth(MONTH));
  console.log(`\n  Monthly FTD build — ${MONTH}`);
  console.log(`  comparing against ${pm} (prior month), ${py} (prior year), ${pypm} (prior year, prior month)\n`);

  /* Only the reported month is ever refetched. The comparison months are
     closed and will not change, so re-downloading them each morning would add
     several minutes for nothing.

     --cached suppresses even that. The daily run refreshes the current month
     through build-ftd.js a step earlier, and both scripts share this cache, so
     pulling ~80,000 rows a second time would cost minutes and change nothing. */
  const refetchCurrent = has("no-cache") || (MONTH === thisMonth && !has("cached"));
  const months = {
    cur: await monthRows(MONTH, { refetch: refetchCurrent }),
    pm: await monthRows(pm),
    py: await monthRows(py),
    pypm: await monthRows(pypm),
  };

  if (!months.cur.length) {
    console.error(`\n  No rows for ${MONTH}. Nothing to build.\n`);
    process.exit(1);
  }
  for (const [slot, ym] of [["pm", pm], ["py", py], ["pypm", pypm]]) {
    if (!months[slot].length) console.log(`  note: ${ym} is missing, so its comparison column will read zero.`);
  }

  const cap = Number(flag("cap")) || Number(CFG.FTD_MTD_DAY) || lastDayWithData(months.cur);
  console.log(`\n  Month-to-date runs to day ${cap}, the last day ${MONTH} has data for.`);

  const data = aggregateMonth({ month: MONTH, months, cap });

  /* Section 08 offers a by-month axis over two years, so it needs every month
     of the reported year AND the one before it — the prior year is what makes
     a month readable as high or low rather than just a number. Read straight
     from the caches. Both the reported month and its prior-year twin are
     pinned to the page's cut-off, so a part-month is never compared against a
     whole one. */
  {
    const yr = +MONTH.slice(0, 4);
    const prevSame = `${yr - 1}-${MONTH.slice(5, 7)}`;
    const hzMonths = [];
    for (const y of [yr - 1, yr]) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        if (fs.existsSync(path.join(CACHE, `${ym}.json`))) hzMonths.push(ym);
        if (ym === MONTH) break;
      }
    }
    process.stdout.write(`  Game horizon: reading ${hzMonths.length} month(s) `);
    data.GHZ = buildGameHz(CACHE, hzMonths, 30, { [MONTH]: cap, [prevSame]: cap });
    console.log(`- ${data.GHZ.players.length} players, ${data.GHZ.rows.length} rows`);
    /* the username list is reference only and nothing on the page reads it;
       two years of it is a quarter-megabyte of page weight for nothing */
    delete data.GHZ.players;
  }

  fs.writeFileSync(OUT + ".tmp", JSON.stringify(data));
  fs.renameSync(OUT + ".tmp", OUT);

  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  console.log(`\n  ${data.meta.ftdCount.toLocaleString()} first deposits, ` +
              `${data.DATA.period.amount.toLocaleString()} in first-deposit amount`);
  console.log(`  Written to ${OUT}  (${mb} MB)`);

  if (data.meta.unknownRails.length) {
    console.log(`\n  Payment rails not in the known list, counted as crypto:`);
    console.log(`    ${data.meta.unknownRails.join(", ")}`);
    console.log(`  If any of those are cards or bank transfers, add them to`);
    console.log(`  FIAT_RAILS in month-aggregate.js or the crypto/fiat split will be wrong.`);
  }
  if ((data.meta.thinMonths || []).length) {
    console.log(`\n  These months still lack player_status / deposit_count:`);
    console.log(`    ${data.meta.thinMonths.join(", ")}`);
    console.log(`  Their Blocked and One-Time rows show a dash rather than a figure.`);
    console.log(`  A normal run repairs this by refetching them; it was skipped here`);
    console.log(`  because of --offline, or Redash could not be reached.`);
  }
  if (data.meta.unmappedCountries.length) {
    console.log(`\n  Country names that look like unshortened ISO long-form:`);
    console.log(`    ${data.meta.unmappedCountries.join(", ")}`);
    console.log(`  Add them to COUNTRY_RENAME in month-aggregate.js to tidy the labels.`);
  }

  console.log(`\n  Next: node make-month-html.js --month=${MONTH}\n`);
})();
