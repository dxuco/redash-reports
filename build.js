/**
 * build.js — regenerates data.json for the Bonus Cost report from Redash.
 *
 *   node build.js            full build -> data.json
 *   node build.js --probe    connectivity + auth check only, no heavy queries
 *   node build.js --verify   build, then diff against the numbers baked into
 *                            bonus_cost_by_group_2026_8.html
 *
 * Sources
 *   1731  Bonus Cost By Categories   -> bonus cost per player/bonus/month,
 *                                       plus the slot/live_casino/sport/other split
 *   1732  Marketing General Report   -> adjusted GGR, raw GGR, bet, deposits,
 *                                       daily detail, segments, countries, FTD
 *
 * Group taxonomy (CRM / Loyalty Program / General Promo / Acquisition) is not in
 * either query — it comes from bonus-groups.json, keyed by bonus_id.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ─────────────────────────── config ─────────────────────────── */

function loadConfig() {
  const file = path.join(__dirname, "config.env");
  const out = {};
  if (fs.existsSync(file)) {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[line.slice(0, eq).trim()] = v;
    }
  }
  return out;
}

const FILE_CFG = loadConfig();
const cfg = (k, d = "") => process.env[k] ?? FILE_CFG[k] ?? d;

const HOST = cfg("REDASH_HOST").replace(/\/+$/, "");
const ACCOUNT_KEY = cfg("REDASH_USER_API_KEY");
const KEY_COST = ACCOUNT_KEY || cfg("REDASH_KEY_1731");
const KEY_MAIN = ACCOUNT_KEY || cfg("REDASH_KEY_1732");
const Q_COST = 1731;
const Q_MAIN = 1732;
const FROM = cfg("BUILD_FROM", "2026-01");

/* BUILD_TO used to be a fixed month in config.env, which meant the bonus cost
   report silently stopped following the calendar the day the month turned over
   and stayed there until someone remembered to edit the file. Set it to `auto`
   (or leave it out) and it tracks the current month by itself.
   A literal YYYY-MM still pins it, which is what you want when rebuilding an
   old range on purpose. */
const TO_CFG = cfg("BUILD_TO", "auto").trim();
const TO = /^\d{4}-\d{2}$/.test(TO_CFG)
  ? TO_CFG
  : (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)(new Date());
if (TO !== TO_CFG) console.log(`  Building through ${TO} (BUILD_TO=${TO_CFG || "unset"}).`);
/* The players carved out of the default view. This used to be a single
   OUTLIER_USERNAME from config, which is the one thing the house rule says not
   to do: ids here have changed username mid-year, and a name-based rule stops
   matching silently the day one does — the page would quietly go back to
   reporting the outlier inside the totals. The list is shared with every other
   report; see data-exclusions.json. */
const { CARVED, CARVE_LABEL } = require("./data-exclusions");
const OUTLIER = CARVE_LABEL;
const isOutlier = pid => CARVED.has(String(pid));

/* Who appears in the drill-downs.
   The daily panel is cheap — only a few thousand players are active on any one
   day — so everyone active is included there by default.
   Month-wide is expensive: every player who ever placed a bet, not just the
   ~7,700 who received a bonus, which multiplies data.json several times over.
   Off unless you ask for it. */
const ALL_PLAYERS_DAILY = !/^(no|false|0)$/i.test(cfg("ALL_PLAYERS_DAILY", "yes"));
const ALL_PLAYERS_MONTHLY = /^(yes|true|1)$/i.test(cfg("ALL_PLAYERS_MONTHLY", "no"));
const TIMEOUT = Number(cfg("QUERY_TIMEOUT_MS", 600000));

/* ---------- the month cache ----------
 *
 * Query 1732 is dated to the day, so a closed month's figures do not move.
 * This used to refetch every month in the range on every run — nine queries a
 * morning, eight of them for months that had already finished.
 *
 * Closed months are cached and re-read from disk. They are still refreshed
 * periodically, because the numbers are not the whole story: player segment,
 * status and channel are restated upstream, which is how Regular quietly
 * redistributed into Churn. CLOSED_MONTH_REFRESH_DAYS is how long a cached
 * closed month is trusted before being pulled again.
 *
 *   --no-cache   ignore all of this and refetch everything
 *
 * The current month is always refetched — it is still filling up.
 *
 * This cache is deliberately NOT the one in ftd-report/cache. That one trims
 * to the columns the FTD report needs, and this build also reads
 * current_segment and bonus_id, which are not among them. Sharing would look
 * like it worked and silently drop the segment split.
 */
const CACHE_DIR = path.join(__dirname, "output/cache/cache-bonus");
const CLOSED_MONTH_REFRESH_DAYS = Number(cfg("CLOSED_MONTH_REFRESH_DAYS", "7"));

/* The 1732 columns this build reads. Anything else is dropped before caching. */
const KEEP_MAIN = [
  "transaction_date", "player_id", "username", "player_country",
  "first_deposit_date", "ftd", "ftd_type", "current_segment",
  "game_product", "bet", "ggr", "adjusted_ggr", "deposit",
  "bonus_cost", "bonus_id", "bonus_name",
];

const ARGV = process.argv.slice(2);
const ARGS = new Set(ARGV);
const PROBE = ARGS.has("--probe");
const VERIFY = ARGS.has("--verify");
const NO_CACHE = ARGS.has("--no-cache");
const SEGPROBE = ARGS.has("--segprobe");
const GROUPS_ONLY = ARGS.has("--groups");
const GGR_YEAR = (ARGV.find(a => a.startsWith("--ggr=")) || "").slice(6);

/* --from=YYYY-MM --to=YYYY-MM --out=file.json override config.env, so a short
   test build can run without touching the real data.json. */
const flag = name => {
  const hit = ARGV.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
/* --if-stale: only build if today's build hasn't happened yet. Lets the job be
   attached to several triggers (the daily time, and logon) without rebuilding
   repeatedly — whichever fires first does the work. */
if (ARGS.has("--if-stale")) {
  const target = path.join(__dirname, "output/data/data.json");
  const dueHour = Number(cfg("BUILD_HOUR", 7));
  const dueMinute = Number(cfg("BUILD_MINUTE", 0));

  const dueToday = new Date();
  dueToday.setHours(dueHour, dueMinute, 0, 0);

  if (fs.existsSync(target)) {
    const built = fs.statSync(target).mtime;
    const freshEnough = built >= dueToday || (Date.now() - built) < 60 * 60 * 1000;
    if (freshEnough) {
      console.log(`Already up to date (data.json written ${built.toLocaleString()}). Nothing to do.`);
      process.exit(0);
    }
  }
  console.log("Data is stale — building.");
}

const RANGE_FROM = flag("from") || FROM;
const RANGE_TO = flag("to") || TO;
const OUT_FILE = flag("out") || "data.json";

/* Segment display order, matching the report. Unseen segments get appended. */
const SEGMENTS = ["Vip", "Elit", "Regular", "Mass", "Risk", "One Timer", "Pre Elit", "Free Rider", "Churn", "Unknown"];

/* ---------- user type ----------
 *
 * A second way of cutting the same players, for the bonus-group-by-user-type
 * table. It is NOT a segment: "FTD 2026" is derived from the first deposit
 * date, and it cuts across every segment there is.
 *
 * The four buckets overlap in the source data — 639 of the 2026 first
 * depositors are also Regular and 6 are Vip — so a player is assigned to the
 * FIRST bucket they match and no other. That keeps the columns adding up to
 * the group total, which is the whole point of the table; the alternative is
 * four columns that each look right and sum to more than the row.
 *
 * Order matters and is deliberate: a player who first deposited this year is
 * counted as a new depositor even if they have already climbed to Vip.
 */
const USER_TYPES = ["FTD 2026", "Vip", "Regular", "All other"];

function userTypeOf(ftdDate, segment) {
  if (String(ftdDate || "").startsWith("2026")) return 0;
  if (segment === "Vip") return 1;
  if (segment === "Regular") return 2;
  return 3;
}

/* 1732.game_product -> the four product buckets the report shows.
   Matching on exact strings was too brittle: anything with different spacing,
   an underscore, a hyphen or a stray space fell through to "Other", which is
   how Live Casino GGR silently read zero in every month. Match on shape
   instead, and record what was actually seen so it can be checked. */
const PRODUCTS_SEEN = new Map();

function productBucket(raw) {
  const s = String(raw == null ? "" : raw).toLowerCase().replace(/[\s_\-]+/g, " ").trim();

  let bucket;
  if (!s || s === "no product" || s === "null") bucket = "Other";
  else if (s.includes("live")) bucket = "Live Casino";          // before "casino"
  else if (s.includes("slot") || s.includes("casino")) bucket = "Slot";
  else if (s.includes("sport") || s.includes("betting")) bucket = "Sport";
  else bucket = "Other";

  const key = `${raw} -> ${bucket}`;
  PRODUCTS_SEEN.set(key, (PRODUCTS_SEEN.get(key) || 0) + 1);
  return bucket;
}
/* FTD types. The source spelling varies (hyphens, casing, spaces), so match on
   shape and keep a record of what was actually seen. Anything unrecognised is
   kept under its own name rather than quietly folded into another bucket. */
const FTD_TYPES_SEEN = new Map();
const FTD_ORDER = ["Superqualified", "Qualified", "Non-qualified"];

function ftdTypeLabel(raw) {
  const s = String(raw == null ? "" : raw).toLowerCase().replace(/[\s_\-]+/g, " ").trim();
  let label;
  if (!s || s === "null" || s === "nan") label = "Unknown";
  else if (s.includes("super")) label = "Superqualified";
  else if (s.startsWith("non") || s.includes("not qualified")) label = "Non-qualified";
  else if (s.includes("qualified")) label = "Qualified";
  else label = String(raw).trim();
  FTD_TYPES_SEEN.set(`${raw} -> ${label}`, (FTD_TYPES_SEEN.get(`${raw} -> ${label}`) || 0) + 1);
  return label;
}

const PRODUCTS = ["Slot", "Live Casino", "Sport", "Other"];
const PROD_KEY = { "Slot": "slot", "Live Casino": "live_casino", "Sport": "sport", "Other": "other" };

/* ─────────────────────────── helpers ─────────────────────────── */

const log = (...a) => console.log(...a);
const r2 = v => Math.round(v * 100) / 100;
const r4 = v => Math.round(v * 10000) / 10000;
const num = v => (typeof v === "number" && isFinite(v) ? v : 0);

function segLabel(s) {
  s = String(s == null ? "" : s).trim();
  return (s === "" || s === "nan" || s === "None" || s === "(none)" || s === "NaN" || s === "null") ? "Unknown" : s;
}

function monthList(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const monthLabel = ym => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(ym.split("-")[1]) - 1];
const daysInMonth = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const dayOf = d => Number(String(d).slice(8, 10));
const monthOf = d => String(d).slice(0, 7);

/* ─────────────────────────── Redash client ─────────────────────────── */

/* How long a just-computed result stays acceptable, in seconds. Only used to
   collect a run we started ourselves moments earlier. */
const CACHE_WINDOW = 900;

/* A per-query API key can only reach endpoints scoped under its own query.
   The global /api/jobs/<id> path answers 404 for it, so prefer the scoped
   form and lock onto whichever works. */
let JOB_PATH_STYLE = null;

async function waitForJob(queryId, k, jobId, label) {
  const deadline = Date.now() + TIMEOUT;
  const styles = JOB_PATH_STYLE
    ? [JOB_PATH_STYLE]
    : ["scoped", "global"];

  while (Date.now() < deadline) {
    await new Promise(s => setTimeout(s, 2000));

    let j = null, lastStatus = null, lastBody = "";
    for (const style of styles) {
      const p = style === "scoped"
        ? `${HOST}/api/queries/${queryId}/jobs/${jobId}?api_key=${k}`
        : `${HOST}/api/jobs/${jobId}?api_key=${k}`;
      const jr = await fetch(p, { headers: { Accept: "application/json" } });
      if (jr.ok) { const b = await jr.json(); j = b.job || b; JOB_PATH_STYLE = style; break; }
      lastStatus = jr.status;
      lastBody = (await jr.text()).slice(0, 200);
    }
    if (!j) throw new Error(`${label}: job poll failed ${lastStatus} — ${lastBody}`);

    if (j.status === 3) return j.query_result_id;
    if (j.status === 4) throw new Error(`${label}: query failed — ${j.error}`);
    process.stdout.write(".");
  }
  throw new Error(`${label}: timed out after ${Math.round(TIMEOUT / 1000)}s`);
}

async function runQuery(queryId, apiKey, parameters, label) {
  const t0 = Date.now();
  const k = encodeURIComponent(apiKey);
  const url = `${HOST}/api/queries/${queryId}/results?api_key=${k}`;

  const post = async maxAge => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: queryId, max_age: maxAge, parameters }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${label}: POST failed ${r.status} — ${text.slice(0, 300)}`);
    try { return JSON.parse(text); }
    catch { throw new Error(`${label}: unparseable response — ${text.slice(0, 200)}`); }
  };

  /* Force a fresh run for these parameters. */
  let payload = await post(0);
  if (payload.query_result) return finish(payload.query_result, t0, label);
  if (!payload.job) throw new Error(`${label}: no job in response`);
  await waitForJob(queryId, k, payload.job.id, label);

  /* Now collect it. A query API key cannot GET a query_result by id, so ask
     for the same parameters again with a cache window — the run we just
     finished satisfies it and Redash returns the rows inline. */
  for (let attempt = 1; attempt <= 3; attempt++) {
    payload = await post(CACHE_WINDOW);
    if (payload.query_result) return finish(payload.query_result, t0, label);
    if (payload.job) { await waitForJob(queryId, k, payload.job.id, label); continue; }
    throw new Error(`${label}: unexpected result shape`);
  }
  throw new Error(`${label}: could not collect results after 3 attempts`);
}

/* ---------- the month cache ---------- */

const thisMonthYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Age of a cache file in days, or Infinity if it is not there. */
function cacheAgeDays(file) {
  try { return (Date.now() - fs.statSync(file).mtimeMs) / 86400000; }
  catch { return Infinity; }
}

/**
 * One month of query 1732, from disk when we can trust it.
 *
 * The current month is never trusted — it is still being written to. A closed
 * month is trusted for CLOSED_MONTH_REFRESH_DAYS, then pulled again to pick up
 * any upstream reclassification.
 */
/* Months that could not be refreshed and fell back to disk. */
const STALE_MONTHS = [];

async function monthRowsCached(ym) {
  const file = path.join(CACHE_DIR, `${ym}.json`);
  const isCurrent = ym === thisMonthYm();
  const age = cacheAgeDays(file);

  if (!NO_CACHE && !isCurrent && age <= CLOSED_MONTH_REFRESH_DAYS) {
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    log(`  1732 ${ym}: ${rows.length.toLocaleString()} rows from cache ` +
        `(${age < 1 ? "today" : Math.floor(age) + "d old"})`);
    return rows;
  }

  const why = isCurrent ? "current month"
    : age === Infinity ? "not cached"
    : NO_CACHE ? "--no-cache" : `cache ${Math.floor(age)}d old`;
  log(`  1732 ${ym}: fetching (${why})`);

  const last = daysInMonth(ym);
  const span = async (a, b, label) => runQuery(Q_MAIN, KEY_MAIN, {
    date_range: { start: `${ym}-${String(a).padStart(2, "0")}`, end: `${ym}-${String(b).padStart(2, "0")}` },
    "Current Segment": "All",
  }, label);

  /* Redash runs each query in a worker with its own memory ceiling, and a big
     month can trip it: August 2026 came back as
       "Worker exited prematurely: signal 9 (SIGKILL)"
     which is that worker being killed, not a problem with the query or the
     connection. The rows are fine when asked for in smaller pieces, so a
     failed month is retried as halves and then as weeks before giving up.
     Splitting only on failure keeps the normal path to one request. */
  let rows;
  try {
    rows = await span(1, last, `1732 ${ym}`);
  } catch (e) {
    log(`  1732 ${ym}: one-shot failed (${e.message.split("—").pop().trim()})`);
    const chunks = [[[1, 15], [16, last]], [[1, 8], [9, 15], [16, 23], [24, last]]];
    for (const plan of chunks) {
      try {
        const parts = [];
        for (const [a, b] of plan) {
          log(`  1732 ${ym}: fetching days ${a}-${b}`);
          parts.push(await span(a, b, `1732 ${ym} d${a}-${b}`));
        }
        rows = parts.flat();
        log(`  1732 ${ym}: recovered in ${plan.length} pieces, ${rows.length.toLocaleString()} rows`);
        break;
      } catch (e2) {
        log(`  1732 ${ym}: ${plan.length}-piece attempt failed too (${e2.message.split("—").pop().trim()})`);
      }
    }
    if (!rows) {
      /* Still nothing. A stale copy of a closed month beats no report at all,
         so fall back to it and say so rather than aborting nine months of work
         over one bad fetch. */
      if (!isCurrent && fs.existsSync(file)) {
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        log("");
        log(`  ****  ${ym} could not be refreshed - using the cached copy  ****`);
        log(`        ${cached.length.toLocaleString()} rows, ${Math.floor(age)}d old.`);
        log(`        ${e.message}`);
        log("");
        STALE_MONTHS.push({ ym, age: Math.floor(age), why: e.message });
        return cached;
      }
      throw e;
    }
  }

  /* Trim to the columns this build reads, then write through a temp file so a
     run killed mid-write cannot leave a half-parsed month behind. */
  /* Corrupt and excluded rows go here too, so a refresh of this cache cannot
     put back what scrub-data.js took out of it. Same module the scrub uses —
     see data-exclusions.json. */
  const EXCL = require("./data-exclusions");
  const trimmed = rows.map(r => {
    const o = {};
    for (const k of KEEP_MAIN) if (r[k] !== undefined && r[k] !== null && r[k] !== "") o[k] = r[k];
    return o;
  });
  const { rows: slim, dropped } = EXCL.filterRows(trimmed);
  if (dropped.length) {
    log(`     (${dropped.length} row(s) excluded from ${ym}: ${
      [...new Set(dropped.map(r => r._why))].join("; ")})`);
  }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(slim));
    fs.renameSync(file + ".tmp", file);
  } catch (e) {
    /* A cache that cannot be written is a slow build, not a broken one. */
    log(`     (could not cache ${ym}: ${e.message})`);
  }
  return slim;
}

function finish(qr, t0, label) {
  const rows = (qr.data && qr.data.rows) || [];
  log(`  ${label}: ${rows.length.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return rows;
}

/* ─────────────────────────── registries ─────────────────────────── */

class Registry {
  constructor() { this.index = new Map(); this.list = []; }
  idx(key, make) {
    let i = this.index.get(key);
    if (i === undefined) { i = this.list.length; this.index.set(key, i); this.list.push(make()); }
    return i;
  }
}


/* ─────────────────── bonus categorisation from Google Sheets ───────────────────
   A published Google Sheet can be read as CSV with no credentials:
     https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>
   Set BONUS_GROUPS_URL in config.env to that link and the categorisation is
   picked up on every build, so new bonuses stop landing in "Unmapped".

   The local bonus-groups.json stays as the fallback and is refreshed on every
   successful fetch. A Drive outage, a permissions change or a VPN hiccup then
   cannot stop the morning build — it just uses yesterday's copy and says so. */

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

/* Column names vary between spreadsheets, so match on shape rather than
   demanding exact headers. */
function findColumn(headers, patterns) {
  for (const pat of patterns) {
    const i = headers.findIndex(h => pat.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/* ─────────────────── reading .xlsx without any dependency ───────────────────
   A .xlsx file is a ZIP of XML parts. Node ships zlib, so the whole thing can
   be read with no npm install: walk the ZIP central directory, inflate the two
   parts that matter, and pull the cell values out.

   This exists because the bonus categorisation lives in Drive as an uploaded
   Excel file rather than a native Google Sheet, and Google's CSV export only
   works for native Sheets. */


function unzip(buf) {
  /* End of central directory: signature, then the offset of the directory. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    /* The local header repeats the name/extra lengths, and they can differ
       from the central directory's, so read them again rather than assume. */
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&");

/* Column letters -> zero-based index, so gaps in the row are preserved. */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buffer) {
  const files = unzip(buffer);

  /* Shared strings: most text cells point into this table. */
  const shared = [];
  const ssFile = files["xl/sharedStrings.xml"];
  if (ssFile) {
    const xml = ssFile.toString("utf8");
    for (const si of xml.split("<si>").slice(1)) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1]));
      shared.push(parts.join(""));
    }
  }

  /* First worksheet. The part name is usually sheet1.xml but not always. */
  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error("no worksheet found inside the workbook");
  const sheet = files[sheetName].toString("utf8");

  const rows = [];
  for (const rowXml of sheet.split(/<row[^>]*>/).slice(1)) {
    const cells = [];
    for (const m of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = m[1] || m[3] || "";
      const body = m[2] || "";
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1];

      let value = "";
      if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join("");
      } else {
        const v = (/<v[^>]*>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        if (v !== undefined) value = type === "s" ? (shared[+v] ?? "") : decodeXml(v);
      }

      const idx = colIndex(ref);
      if (idx >= 0) { while (cells.length < idx) cells.push(""); cells[idx] = value; }
      else cells.push(value);
    }
    rows.push(cells);
  }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}


/* Accepts whatever link is pasted and works out how to fetch it:
     native Google Sheet   -> CSV export
     uploaded xlsx/csv     -> direct download
   Saves anyone having to hand-craft an export URL. */
function normaliseSourceUrl(raw) {
  const url = String(raw).trim();
  const id = (/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url)
           || /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url)
           || /[?&]id=([a-zA-Z0-9_-]+)/.exec(url) || [])[1];

  if (!id) return [{ url, kind: "as given" }];

  const gid = (/[?&#]gid=(\d+)/.exec(url) || [])[1];

  /* Both are tried in turn. A native Google Sheet answers the first; an
     uploaded .xlsx or .csv answers the second. Which link was pasted does not
     matter, because the file type is not always obvious from the URL. */
  return [
    { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` + (gid ? `&gid=${gid}` : ""),
      kind: "native Google Sheet, CSV export" },
    { url: `https://drive.google.com/uc?export=download&id=${id}`,
      kind: "uploaded file, direct download" },
    /* Drive puts a "we can't scan this" page in front of some downloads —
       macro-enabled workbooks among them — and answers the real bytes only on
       this host with confirm set. Without it a perfectly shared .xlsm looks
       exactly like a permissions failure. */
    { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      kind: "uploaded file, scan-warning bypass" },
  ];
}

/**
 * The same subgroup name can legitimately sit under more than one group:
 * "Community" is Acquisition for most bonuses and Retention for one, and that
 * distinction is the point of the row.
 *
 * An earlier version of this resolved such cases by majority vote and moved the
 * odd ones out. That was wrong. It was written for a genuine typo - two
 * "Smartico - VIP" rows filed under Loyalty Program instead of CRM - but the
 * mechanism cannot tell a typo from an intentional split, so it silently
 * rewrote the spreadsheet's own answer and moved $2.34M between categories.
 *
 * So this now only reports. The sheet is the source of truth; where it is
 * wrong, it gets fixed in the sheet.
 */
function reconcileGroups(map) {
  const seen = new Map();                       // sub -> Map(group -> [ids])
  for (const [id, v] of Object.entries(map)) {
    const sub = String(v.sub || "").trim();
    if (!sub) continue;
    if (!seen.has(sub)) seen.set(sub, new Map());
    const byGroup = seen.get(sub);
    const g = String(v.group || "").trim();
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(id);
  }

  const split = [];
  for (const [sub, byGroup] of seen) {
    if (byGroup.size < 2) continue;
    split.push({ sub, groups: [...byGroup].sort((a, b) => b[1].length - a[1].length) });
  }

  if (split.length) {
    log("\n  Subgroup names that appear under more than one group:");
    for (const f of split) {
      log(`    "${f.sub}"`);
      for (const [g, ids] of f.groups) {
        const show = ids.length > 6 ? ids.slice(0, 6).join(", ") + `, +${ids.length - 6} more` : ids.join(", ");
        log(`       ${String(ids.length).padStart(4)} under ${g.padEnd(16)} ${show}`);
      }
    }
    log("    Each is reported separately, exactly as the sheet has it.");
    log("    If one of these is a typo rather than a real split, fix it in the sheet.");
  }
  return map;
}

/**
 * Drive sometimes answers a download with an interstitial rather than the file.
 * It is a plain form; submitting it returns the bytes. Returns a Buffer, or
 * null if this page was not that form.
 */
async function followDriveConfirm(html, sourceUrl) {
  const form = /<form[^>]+action="([^"]+)"[^>]*>/i.exec(html);
  if (!form) return null;
  const action = form[1].replace(/&amp;/g, "&");

  const params = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]+)"/i.exec(m[0]);
    const value = /value="([^"]*)"/i.exec(m[0]);
    if (name) params.set(name[1], value ? value[1].replace(/&amp;/g, "&") : "");
  }
  if (!params.has("confirm")) params.set("confirm", "t");

  const url = action + (action.includes("?") ? "&" : "?") + params.toString();
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const b = Buffer.from(await res.arrayBuffer());
    /* Only accept it if it really is a workbook or CSV, not another page. */
    if (b[0] === 0x50 && b[1] === 0x4b) return b;
    if (!/<html/i.test(b.toString("utf8", 0, 400))) return b;
    return null;
  } catch { return null; }
}

async function loadBonusGroups() {
  const localPath = path.join(__dirname, "bonus-groups.json");
  const readLocal = () => {
    if (!fs.existsSync(localPath)) return null;
    try { return JSON.parse(fs.readFileSync(localPath, "utf8")).map; } catch { return null; }
  };

  const localStamp = () => {
    try { return JSON.parse(fs.readFileSync(localPath, "utf8")).generated || ""; } catch { return ""; }
  };

  const configured = cfg("BONUS_GROUPS_URL", "").trim();
  if (!configured) return { map: reconcileGroups(readLocal() || {}), stale: true,
    source: "bonus-groups.json (no BONUS_GROUPS_URL set)", generated: localStamp(),
    reason: "BONUS_GROUPS_URL is empty in config.env" };

  log("\nBonus categorisation");
  const candidates = normaliseSourceUrl(configured);

  try {
    let buf = null, usedKind = "", usedUrl = "";
    const tried = [];
    for (const c of candidates) {
      try {
        const res = await fetch(c.url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
        if (!res.ok) { tried.push(`${c.kind}: HTTP ${res.status}`); continue; }
        const b = Buffer.from(await res.arrayBuffer());
        const head = b.toString("utf8", 0, 400);
        /* Google answers a failed export with an HTML error page, so a 200 is
           not on its own proof that we got the file. */
        if (/<html/i.test(head) && !(b[0] === 0x50 && b[1] === 0x4b)) {
          /* The scan warning is a real form: pull its action and fields and
             submit it, rather than giving up on a file we are allowed to read. */
          const retry = await followDriveConfirm(b.toString("utf8"), c.url);
          if (retry) { buf = retry; usedKind = c.kind + " (via the scan warning)"; usedUrl = c.url; break; }
          tried.push(`${c.kind}: got an HTML page, not the file`);
          continue;
        }
        buf = b; usedKind = c.kind; usedUrl = c.url; break;
      } catch (e) { tried.push(`${c.kind}: ${e.message}`); }
    }
    if (!buf) throw new Error("could not download it —\n     " + tried.join("\n     "));
    log(`  source: ${usedKind}`);

    let rows;
    if (buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
      /* "PK" — a zip, so an xlsx workbook rather than CSV. */
      rows = readXlsx(buf);
      log("  format: Excel workbook");
    } else {
      const text = buf.toString("utf8");
      if (/<html/i.test(text.slice(0, 400))) {
        throw new Error("got a web page instead of the file — it is probably not shared with " +
          "'anyone with the link', or Drive is showing a virus-scan warning");
      }
      rows = parseCsv(text);
      log("  format: CSV");
    }
    if (rows.length < 2) throw new Error("the file appears to be empty");

    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    const iId = findColumn(headers, [/^bonus[_ ]?id$/, /^id$/, /^code$/, /bonus.*id/, /id/]);
    const iGroup = findColumn(headers, [/^group$/, /bonus.*group/, /^category$/, /group/]);
    const iSub = findColumn(headers, [/^sub[_ ]?group$/, /^subgroup$/, /^sub$/, /sub/]);
    const iName = findColumn(headers, [/^bonus[_ ]?name$/, /^name$/, /name/]);

    if (iId < 0 || iGroup < 0) {
      throw new Error(`could not find the id and group columns. Headers seen: ${headers.join(", ")}`);
    }

    const map = {};
    let skipped = 0;
    for (const r of rows.slice(1)) {
      const id = String(r[iId] ?? "").trim();
      const group = String(r[iGroup] ?? "").trim();
      if (!id || !group) { skipped++; continue; }
      map[id] = {
        name: iName >= 0 ? String(r[iName] ?? "").trim() : "",
        group,
        sub: iSub >= 0 ? (String(r[iSub] ?? "").trim() || "Not in bonus list") : "Not in bonus list",
      };
    }

    const count = Object.keys(map).length;
    if (!count) throw new Error("no usable rows found");

    log(`  read ${count.toLocaleString()} bonuses from the Google Sheet`);
    log(`  columns used: id="${headers[iId]}", group="${headers[iGroup]}"` +
        (iSub >= 0 ? `, subgroup="${headers[iSub]}"` : ", no subgroup column") +
        (skipped ? `  (${skipped} rows skipped for missing id or group)` : ""));

    reconcileGroups(map);

    /* Keep the local copy current so the fallback is never stale. */
    fs.writeFileSync(localPath, JSON.stringify({
      _comment: "Cached from BONUS_GROUPS_URL. Edited copies are overwritten on the next successful fetch.",
      generated: new Date().toISOString(),
      /* The candidate that answered. This said `url`, which is not defined in
         this scope - so every build threw a ReferenceError immediately after a
         successful download, was caught by the fallback handler below, and
         quietly used the stale cache instead. */
      source: usedUrl,
      map,
    }, null, 1));

    return { map, source: "Google Drive", stale: false, generated: new Date().toISOString() };

  } catch (e) {
    const local = readLocal();
    if (local) {
      const stamp = localStamp();
      const ageH = stamp ? Math.round((Date.now() - new Date(stamp)) / 3600000) : null;
      /* Loud on purpose. This used to be one "!" line that scrolled past, and a
         build would then quietly categorise against a stale copy for hours -
         the only symptom being new bonuses landing in "Unmapped". */
      log("");
      log("  ****************************************************************");
      log("  *  COULD NOT READ THE BONUS SHEET FROM GOOGLE DRIVE            *");
      log("  ****************************************************************");
      log(`     ${e.message}`);
      log("");
      log(`     Falling back to bonus-groups.json: ${Object.keys(local).length} bonuses,`);
      log(`     last refreshed ${stamp || "unknown"}${ageH !== null ? `  (${ageH}h ago)` : ""}.`);
      log("     Any bonus added to the sheet since then will show as Unmapped.");
      log("");
      return { map: reconcileGroups(local), source: "bonus-groups.json (fallback)",
        stale: true, generated: stamp, reason: e.message };
    }
    log(`  ! could not read the Google Sheet: ${e.message}`);
    throw new Error("No bonus categorisation available: the sheet could not be read and there is " +
      "no local bonus-groups.json to fall back on.");
  }
}

/* ─────────────────────────── the build ─────────────────────────── */

async function build() {
  const months = monthList(RANGE_FROM, RANGE_TO);
  const nM = months.length;
  const labels = months.map(monthLabel);
  log(`Building ${months[0]} … ${months[nM - 1]} (${nM} months)\n`);

  const groupsLoaded = await loadBonusGroups();
  const groupMap = groupsLoaded.map;

  const players = new Registry();          // player_id -> index (bonused players only)
  const bids = new Registry();             // bonus_id  -> index
  const pinfo = [];                        // per player: {name,country,seg,ftd}
  const bidRows = [];                      // per bonus: [name, group, sub, code]
  const segOfPid = new Map();              // player_id -> segment, for ALL players
  const pidByIndex = [];                   // index -> player_id
  /* Per player-month revenue for EVERY player, not just the bonused ones.
     Held only while the build runs - it never reaches data.json - so the
     depositor and win/lose counts are complete regardless of the
     ALL_PLAYERS_MONTHLY setting. */
  const bucketPm = new Map();              // `${pid}|${mi}` -> [aggr, dep]
  const ftdTypeOfPid = new Map();          // player_id -> Superqualified / Qualified / ...
  const ftdMonthOfPid = new Map();         // player_id -> month index of the first deposit

  const playerIdx = pid => players.idx(String(pid), () => {
    pinfo.push({ name: String(pid), country: "", seg: "Unknown", ftd: "", lastDep: "" });
    pidByIndex.push(String(pid));
    return null;
  });
  const bonusIdx = (bonusId, bonusName) => bids.idx(String(bonusId ?? ""), () => {
    const g = groupMap[String(bonusId ?? "")];
    bidRows.push([
      bonusName == null || bonusName === "" ? "(no bonus code)" : String(bonusName),
      g ? g.group : "Unmapped",
      g ? g.sub : "Not in bonus list",
      bonusId == null ? "" : String(bonusId),
    ]);
    return null;
  });

  /* accumulators, indexed [monthIndex] */
  const zeros = () => new Array(nM).fill(0);
  const acc = {
    full: newScope(), mtd: newScope(),
  };
  function newScope() {
    return {
      cost: new Map(),        // `${p}|${mi}|${bx}` -> cost
      groupCost: new Map(),   // `${group}|${sub}` -> number[nM]   ('' sub = group total)
      prodSplit: { slot: zeros(), live_casino: zeros(), sport: zeros(), other: zeros() },
      aggr: zeros(), ggr: zeros(), bet: zeros(),
      segAggr: new Map(), segGGR: new Map(),   // label -> number[nM]
      prodGGR: new Map(),                       // label -> number[nM]
      pm: new Map(),                            // `${p}|${mi}` -> [ggr, aggr, dep]
      nrows: 0,
      // the outlier's own contribution, so the "without" scenario is exact
      outl: {
        prodSplit: { slot: zeros(), live_casino: zeros(), sport: zeros(), other: zeros() },
        bet: zeros(), prodGGR: new Map(),
      },
    };
  }

  /* mtdDay: how far the final month's data actually runs. */
  let mtdDay = daysInMonth(months[nM - 1]);
  const partial = [];

  /* ---------- pass 1: query 1731, bonus cost ---------- */

  log("Query 1731 — bonus cost");
  const costFullRows = await runQuery(Q_COST, KEY_COST,
    { date_range: { start: `${months[0]}-01`, end: `${months[nM - 1]}-${String(daysInMonth(months[nM - 1])).padStart(2, "0")}` } },
    "1731 full period");

  const miOf = ym => months.indexOf(ym);

  function ingestCost(rows, scope) {
    for (const row of rows) {
      const mi = miOf(monthOf(row.transaction_month));
      if (mi < 0) continue;
      const p = playerIdx(row.player_id);
      const bx = bonusIdx(row.bonus_id, row.bonus_name);
      const cost = num(row.bonus_cost);
      if (cost <= 0) continue;

      /* [total, slot, live_casino, sport, other] — the product split is kept
         per bonus so clicking a product cell can list the exact players and
         bonus names behind it, rather than an approximation. */
      const k = `${p}|${mi}|${bx}`;
      const cur = scope.cost.get(k) || [0, 0, 0, 0, 0];
      cur[0] += cost;
      cur[1] += num(row.slot);
      cur[2] += num(row.live_casino);
      cur[3] += num(row.sport);
      cur[4] += num(row.other);
      scope.cost.set(k, cur);

      const [, group, sub] = bidRows[bx];
      bump(scope.groupCost, `${group}|`, mi, cost, nM);
      bump(scope.groupCost, `${group}|${sub}`, mi, cost, nM);

      scope.prodSplit.slot[mi] += num(row.slot);
      scope.prodSplit.live_casino[mi] += num(row.live_casino);
      scope.prodSplit.sport[mi] += num(row.sport);
      scope.prodSplit.other[mi] += num(row.other);

      if (isOutlier(row.player_id)) {
        scope.outl.prodSplit.slot[mi] += num(row.slot);
        scope.outl.prodSplit.live_casino[mi] += num(row.live_casino);
        scope.outl.prodSplit.sport[mi] += num(row.sport);
        scope.outl.prodSplit.other[mi] += num(row.other);
      }

      // player display info, first non-empty wins
      const pi = pinfo[p];
      if (pi.name === String(row.player_id) && row.username) pi.name = String(row.username);
      if (pi.seg === "Unknown") pi.seg = segLabel(row.current_segment);
    }
  }

  ingestCost(costFullRows, acc.full);

  /* MTD needs a separate run per month, cut at mtdDay. Deferred until we know
     mtdDay, which comes from how far 1732's data actually reaches. */

  /* ---------- pass 2: query 1732, revenue ---------- */

  log("\nQuery 1732 — revenue, per month");
  const dailyByMonth = new Map();   // ym -> Map(day -> {cost,ggr,aggr, costK:Map, pmK:Map, seg:Map})

  for (let mi = 0; mi < nM; mi++) {
    const ym = months[mi];
    /* Still needed further down, where the partial-month check compares the
       last day with data against the last day of the calendar month. It used
       to be declared next to the query that has since moved into
       monthRowsCached, and deleting it there broke a line 120 lines below. */
    const last = daysInMonth(ym);
    const rows = await monthRowsCached(ym);

    const days = new Map();
    let maxDay = 0;

    for (const row of rows) {
      const d = dayOf(row.transaction_date);
      if (!d) continue;
      if (d > maxDay) maxDay = d;

      const pid = String(row.player_id);
      const ggr = num(row.ggr), aggr = num(row.adjusted_ggr), bet = num(row.bet), dep = num(row.deposit);
      const bonusCost = num(row.bonus_cost);
      const bucket = productBucket(row.game_product);

      /* One segment per player for the whole period — first non-Unknown wins.
         Segment totals must cover every player, including those who never
         received a bonus, so this map is kept separately from `players`. */
      const rowSeg = segLabel(row.current_segment);
      if (rowSeg !== "Unknown" && !segOfPid.has(pid)) segOfPid.set(pid, rowSeg);
      const seg = segOfPid.get(pid) || rowSeg;

      /* Only players who receive a bonus at some point are carried in the
         report — everyone else contributes to totals but not to the tables. */
      /* An FTD in this period always earns a slot, whatever the flags say,
         so the cohort tables are complete. */
      const ftdFlag = num(row.ftd);
      if (row.ftd_type != null && String(row.ftd_type).trim() && !ftdTypeOfPid.has(pid)) {
        ftdTypeOfPid.set(pid, ftdTypeLabel(row.ftd_type));
      }
      if (ftdFlag > 0 && !ftdMonthOfPid.has(pid)) ftdMonthOfPid.set(pid, mi);

      {
        const bk = `${pid}|${mi}`;
        const cur = bucketPm.get(bk) || [0, 0];
        cur[0] += aggr; cur[1] += dep;
        bucketPm.set(bk, cur);
      }

      let p = players.index.get(pid);
      if (p === undefined && (bonusCost > 0 || ftdFlag > 0 || ALL_PLAYERS_DAILY || ALL_PLAYERS_MONTHLY)) p = playerIdx(pid);
      if (p !== undefined) {
        const pi = pinfo[p];
        if (row.username) pi.name = String(row.username);
        if (row.player_country) pi.country = String(row.player_country);
        if (pi.seg === "Unknown" && seg !== "Unknown") pi.seg = seg;
        if (row.first_deposit_date && !pi.ftd) pi.ftd = String(row.first_deposit_date).slice(0, 10);
        /* Latest day with money actually coming in. Only rows with a deposit
           count, so a player who only played does not look like a depositor. */
        if (dep > 0) {
          const day = String(row.transaction_date).slice(0, 10);
          if (!pi.lastDep || day > pi.lastDep) pi.lastDep = day;
        }
      }

      let day = days.get(d);
      if (!day) { day = { ggr: 0, aggr: 0, bet: 0, dep: 0, cost: 0, seg: new Map(), prodGGR: new Map(), pm: new Map(), costK: new Map(), n: 0, outlBet: 0, outlDep: 0, outlProdGGR: new Map() }; days.set(d, day); }
      day.ggr += ggr; day.aggr += aggr; day.bet += bet; day.dep += dep; day.cost += bonusCost; day.n++;

      addTo(day.seg, seg, [ggr, aggr, bonusCost]);

      /* Raw ggr here, and it has to be. In query 1732 the two measures live on
         different rows: `ggr` only on rows that carry a game_product, and
         `adjusted_ggr` only on the summary row per player-day, where product is
         null. So adjusted GGR has no product dimension at all — asking for it
         by product puts everything in "Other", because that is literally where
         the data sits. The product table therefore reports raw GGR, and will
         not tie to the adjusted totals elsewhere. */
      addTo(day.prodGGR, bucket, [ggr, 0, 0]);

      if (isOutlier(row.player_id)) {
        day.outlBet += bet;
        day.outlDep += dep;
        addTo(day.outlProdGGR, bucket, [ggr, 0, 0]);
      }

      if (p !== undefined) {
        const pk = String(p);
        const cur = day.pm.get(pk) || [0, 0, 0];
        cur[0] += ggr; cur[1] += aggr; cur[2] += dep;
        day.pm.set(pk, cur);

        if (bonusCost > 0) {
          const bx = bonusIdx(row.bonus_id, row.bonus_name);
          const ck = `${p}|${bx}`;
          day.costK.set(ck, (day.costK.get(ck) || 0) + bonusCost);
        }
      }
    }

    dailyByMonth.set(ym, days);
    // Only the final month can legitimately be incomplete. An earlier month
    // missing its last day means missing data, not a partial period.
    if (mi === nM - 1) {
      mtdDay = maxDay || last;
      if (maxDay && maxDay < last) partial.push(mi);
    } else if (maxDay && maxDay < last) {
      log(`  ! ${ym} has no rows after day ${maxDay} of ${last} — check the source`);
    }
  }

  log(`\nLast month reaches day ${mtdDay}${partial.length ? ` — months marked partial: ${partial.join(", ")}` : ""}`);

  /* Show how every game_product was classified. If something real is landing in
     "Other", it shows up here rather than silently reading zero. */
  log("\nProduct mapping (from 1732.game_product):");
  const seen = [...PRODUCTS_SEEN.entries()].sort((a, b) => b[1] - a[1]);
  for (const [what, count] of seen) log(`  ${String(count).padStart(9)}  ${what}`);
  const buckets = new Set(seen.map(([w]) => w.split(" -> ")[1]));
  for (const needed of ["Slot", "Live Casino", "Sport"]) {
    if (!buckets.has(needed)) log(`  ! nothing mapped to "${needed}" — that column will read zero`);
  }

  /* fold daily 1732 data into monthly full + mtd scopes */
  for (let mi = 0; mi < nM; mi++) {
    const days = dailyByMonth.get(months[mi]);
    if (!days) continue;
    for (const [d, day] of days) {
      for (const scope of (d <= mtdDay ? [acc.full, acc.mtd] : [acc.full])) {
        scope.ggr[mi] += day.ggr; scope.aggr[mi] += day.aggr; scope.bet[mi] += day.bet;
        scope.nrows += day.n;

        /* Month-to-date bonus cost has to come from 1732, which is dated to
           the day. Query 1731 filters by whole month, so asking it for
           1st-16th returns the entire month and cannot answer MTD. */
        if (scope === acc.mtd) {
          for (const [ck, cost] of day.costK) {
            const [p, bx] = ck.split("|").map(Number);
            const k = `${p}|${mi}|${bx}`;
            /* 1732 has no product split, so MTD records carry the total only.
               The product tables use the full-month scope anyway. */
            const cur = scope.cost.get(k) || [0, 0, 0, 0, 0];
            cur[0] += cost;
            scope.cost.set(k, cur);
            const [, group, sub] = bidRows[bx];
            bump(scope.groupCost, `${group}|`, mi, cost, nM);
            bump(scope.groupCost, `${group}|${sub}`, mi, cost, nM);
          }
        }

        for (const [lbl, v] of day.seg) {
          bump(scope.segGGR, lbl, mi, v[0], nM);
          bump(scope.segAggr, lbl, mi, v[1], nM);
        }
        for (const [lbl, v] of day.prodGGR) bump(scope.prodGGR, lbl, mi, v[0], nM);
        scope.outl.bet[mi] += day.outlBet;
        for (const [lbl, v] of day.outlProdGGR) bump(scope.outl.prodGGR, lbl, mi, v[0], nM);
        for (const [pk, v] of day.pm) {
          const k = `${pk}|${mi}`;
          const cur = scope.pm.get(k) || [0, 0, 0];
          cur[0] += v[0]; cur[1] += v[1]; cur[2] += v[2];
          scope.pm.set(k, cur);
        }
      }
    }
  }

  /* ---------- assemble ---------- */

  log("\nAssembling…");

  const segList = SEGMENTS.slice();
  for (const s of segOfPid.values()) if (!segList.includes(s)) segList.push(s);
  for (const pi of pinfo) if (!segList.includes(pi.seg)) segList.push(pi.seg);
  const segIndex = Object.fromEntries(segList.map((s, i) => [s, i]));
  const pseg = pinfo.map(pi => segIndex[pi.seg] ?? segIndex.Unknown);
  const putype = pinfo.map(pi => userTypeOf(pi.ftd, pi.seg));

  const outlierIdx = [];
  pinfo.forEach((pi, i) => { if (isOutlier(pidByIndex[i])) outlierIdx.push(i); });
  if (!outlierIdx.length) log(`  ! none of the carved-out players (${OUTLIER}) was found — `
                              + `with/without will be identical`);

  const rowsHierarchy = buildHierarchy(bidRows, acc.full.groupCost, nM);

  const out = {
    months, labels, partial, mtdDay,
    rows: rowsHierarchy,
    players: pinfo.map(pi => [pi.name, pi.country, pi.seg]),
    segments: segList,
    pseg,
    userTypes: USER_TYPES,
    putype,
    ftd: pinfo.map(pi => pi.ftd || ""),
    lastDep: pinfo.map(pi => pi.lastDep || ""),
    /* Where the categorisation came from, so the report can warn when a build
       fell back to the cached copy rather than reading the live sheet. */
    /* Months served from a stale cache because the refetch failed. */
    staleMonths: STALE_MONTHS.map(m => ({ ym: m.ym, age: m.age })),
    groupsMeta: {
      source: groupsLoaded.source || "",
      generated: groupsLoaded.generated || "",
      stale: !!groupsLoaded.stale,
      reason: groupsLoaded.reason || "",
    },
    bids: bidRows,
    /* Flow label per bonus, parallel to bids. Empty for everything outside the
       FLOW subgroup. The report needs it to tell which bonuses belong to a
       flow row when you click into one. */
    bflow: bidRows.map(r => flowOf(r[0], r[2])),
    flowSep: FLOW_SEP,
    karIdx: outlierIdx,
    products: PRODUCTS.slice(),
    pprod: pinfo.map(() => 0),
    prodSplitProds: ["slot", "live_casino", "sport", "other"],
    generated_at: new Date().toISOString(),
    /* Last day covered by the data. Used as "today" when ageing deposits, so
       the colouring is the same whenever the page is opened. */
    dataThrough: "",
  };

  const outlierSet = new Set(outlierIdx);

  for (const [name, scope] of [["", acc.full], ["mtd", acc.mtd]]) {
    const block = assembleScope(scope, { nM, bidRows, rowsHierarchy, outlierSet, segList, pseg, putype, nMonths: nM });
    if (name === "") Object.assign(out, block);
    else out.mtd = block;
  }

  /* kar / karAggr */
  out.kar = deriveDiff(out.data.with.total, out.data.without.total);
  out.karAggr = deriveDiff(out.data.with.aggr, out.data.without.aggr);
  out.mtd.kar = deriveDiff(out.mtd.data.with.total, out.mtd.data.without.total);
  out.mtd.karAggr = deriveDiff(out.mtd.data.with.aggr, out.mtd.data.without.aggr);

  /* prodSplit — full scope only, matching the original */
  out.prodSplit = {
    with: mapVals(acc.full.prodSplit, a => a.map(r2)),
    without: mapVals(acc.full.prodSplit, (a, k) => a.map(r2)),
  };
  for (const k of Object.keys(out.prodSplit.without))
    out.prodSplit.without[k] = acc.full.prodSplit[k].map((v, i) => r2(v - acc.full.outl.prodSplit[k][i]));

  /* ---- FTD cohorts -------------------------------------------------
     For each month, the players who made their first deposit that month,
     grouped by FTD type, together with the bonus cost and adjusted GGR those
     same players generated in that same month. A player counts once, in the
     month they arrived.

     Two cuts are produced side by side: the first-month one above, and a
     lifetime-to-date one (lcost / laggr / ldep / lbonused) covering every
     month since the cohort arrived. The lifetime cut answers "what has the
     January intake cost us so far", which the first-month cut cannot. */
  {
    const types = new Set();
    for (const [pid, mi] of ftdMonthOfPid) types.add(ftdTypeOfPid.get(pid) || "Unknown");
    const ordered = FTD_ORDER.filter(t => types.has(t))
      .concat([...types].filter(t => !FTD_ORDER.includes(t) && t !== "Unknown").sort())
      .concat(types.has("Unknown") ? ["Unknown"] : []);

    /* bonus cost per player-month, from the records we already hold */
    const costByPlayerMonth = new Map();
    for (const [k, v] of acc.full.cost) {
      const [p, mi] = k.split("|").map(Number);
      const kk = `${p}|${mi}`;
      costByPlayerMonth.set(kk, (costByPlayerMonth.get(kk) || 0) + v[0]);
    }

    /* Lifetime totals per player: everything they have cost and generated
       since arriving, not just their first month. Used for the cohort-to-date
       tables, where a January FTD is judged on all eight months. */
    const lifeCost = new Map(), lifeAggr = new Map(), lifeDep = new Map();
    for (const [k, v] of acc.full.cost) {
      const p = Number(k.slice(0, k.indexOf("|")));
      lifeCost.set(p, (lifeCost.get(p) || 0) + v[0]);
    }
    for (const [k, v] of acc.full.pm) {
      const p = Number(k.slice(0, k.indexOf("|")));
      lifeAggr.set(p, (lifeAggr.get(p) || 0) + v[1]);
      lifeDep.set(p, (lifeDep.get(p) || 0) + v[2]);
    }

    const blank = () => Object.fromEntries(ordered.map(t => [t, new Array(nM).fill(0)]));
    const scen = () => ({
      /* bonused: how many of the cohort took a bonus in that same first month,
         the counterpart of `cost`. lbonused below is the lifetime version. */
      count: blank(), cost: blank(), aggr: blank(), bonused: blank(),
      /* lifetime-to-date, indexed by the cohort's arrival month */
      lcost: blank(), laggr: blank(), ldep: blank(), lbonused: blank(),
    });
    const ftd = { types: ordered, with: scen(), without: scen() };

    for (const [pid, mi] of ftdMonthOfPid) {
      const type = ftdTypeOfPid.get(pid) || "Unknown";
      if (!ftd.with.count[type]) continue;
      const p = players.index.get(pid);
      const cost = p === undefined ? 0 : (costByPlayerMonth.get(`${p}|${mi}`) || 0);
      const pmv = p === undefined ? null : acc.full.pm.get(`${p}|${mi}`);
      const aggr = pmv ? pmv[1] : 0;

      const lc = p === undefined ? 0 : (lifeCost.get(p) || 0);
      const la = p === undefined ? 0 : (lifeAggr.get(p) || 0);
      const ld = p === undefined ? 0 : (lifeDep.get(p) || 0);

      for (const scenario of ["with", "without"]) {
        if (scenario === "without" && p !== undefined && outlierSet.has(p)) continue;
        const b = ftd[scenario];
        b.count[type][mi] += 1;
        b.cost[type][mi] += cost;
        b.aggr[type][mi] += aggr;
        if (cost > 0) b.bonused[type][mi] += 1;
        b.lcost[type][mi] += lc;
        b.laggr[type][mi] += la;
        b.ldep[type][mi] += ld;
        if (lc > 0) b.lbonused[type][mi] += 1;
      }
    }

    for (const scenario of ["with", "without"])
      for (const field of ["cost", "aggr", "lcost", "laggr", "ldep"])
        for (const t of ordered) ftd[scenario][field][t] = ftd[scenario][field][t].map(r2);

    out.ftdCohort = ftd;

    /* Per player: which cohort they belong to and which FTD type, as indexes
       into months[] and ftdCohort.types. -1 when they did not first deposit
       inside the reported range. The report needs these to answer "who is
       behind this cell" when an FTD table is clicked, and deriving them here
       rather than from the stored FTD date keeps the drill-down consistent
       with the counts in the tables above. */
    {
      const ci = new Array(players.list.length).fill(-1);
      const ti = new Array(players.list.length).fill(-1);
      for (const [pid, mi] of ftdMonthOfPid) {
        const p = players.index.get(pid);
        if (p === undefined) continue;
        ci[p] = mi;
        const t = ordered.indexOf(ftdTypeOfPid.get(pid) || "Unknown");
        ti[p] = t;
      }
      out.ftdCohortIdx = ci;
      out.ftdTypeIdx = ti;
    }

    /* ---- cohort retention -------------------------------------------
       For each arrival month, how many of that intake were active in every
       month, and what they cost in bonuses in each of those months.
       Indexed [cohort][month].

       Months before a cohort arrives are NOT skipped, though it is tempting:
       $914 of bonus cost and 419 player-months of betting belong to players
       who were registered and playing before they first deposited. Cutting
       the grid at the diagonal loses that and leaves the row totals short of
       the lifetime figures shown elsewhere.

       "Active" means the player has a row in that month's activity - they
       bet. That is a wider set than the bonused players, which is why this
       reads from pm rather than from the bonus records. */
    {
      const empty = () => ordered.map(() => null);
      const grid = () => months.map(() => new Array(nM).fill(0));
      const scen = () => ({ active: grid(), bonused: grid(), cost: grid(), size: new Array(nM).fill(0) });
      const ret = { with: scen(), without: scen() };

      for (const [pid, cm] of ftdMonthOfPid) {
        const p = players.index.get(pid);
        if (p === undefined) continue;
        const scopes = outlierSet.has(p) ? ["with"] : ["with", "without"];
        for (const sc of scopes) ret[sc].size[cm] += 1;

        for (let mi = 0; mi < nM; mi++) {
          const act = acc.full.pm.get(`${p}|${mi}`);
          const c = costByPlayerMonth.get(`${p}|${mi}`) || 0;
          if (!act && c <= 0) continue;
          for (const sc of scopes) {
            if (act) ret[sc].active[cm][mi] += 1;
            if (c > 0) { ret[sc].bonused[cm][mi] += 1; ret[sc].cost[cm][mi] += c; }
          }
        }
      }
      for (const sc of ["with", "without"])
        ret[sc].cost = ret[sc].cost.map(row => row.map(r2));
      out.ftdRetention = ret;

      const K = a => a.reduce((x, y) => x + y, 0);
      log("\nCohort retention (all players), active players per month since arrival:");
      months.forEach((ym, c) => {
        if (!ret.with.size[c]) return;
        log(`  ${ym}  size ${String(ret.with.size[c]).padStart(5)}  ` +
            ret.with.active[c].slice(c).map(v => String(v).padStart(6)).join(""));
      });
      log(`  total bonus cost across the grid: ${K(ret.with.cost.map(K)).toFixed(0)}`);
    }

    log("\nFTD types seen (from 1732.ftd_type):");
    const seen = [...FTD_TYPES_SEEN.entries()].sort((a, b) => b[1] - a[1]);
    if (!seen.length) log("  none — the ftd_type column was empty for every row");
    for (const [what, count] of seen.slice(0, 12)) log(`  ${String(count).padStart(9)}  ${what}`);
    log(`  first deposits in range: ${ftdMonthOfPid.size.toLocaleString()}`);
  }

  /* ---- deposit x result matrix ---------------------------------------
     Every active player lands in exactly one cell, so the six add up to the
     month's active players. Overlapping cuts were confusing: win + lose could
     exceed depositors because plenty of players play without depositing.

       depPos    deposited, house up on them
       depNeg    deposited, player up
       noDepPos  no deposit, house up      (playing off balance or bonus)
       noDepNeg  no deposit, player up
       depFlat / noDepFlat   adjusted GGR exactly zero  */
  {
    const outlierPids = new Set();
    for (const i of outlierSet) if (pidByIndex[i]) outlierPids.add(pidByIndex[i]);

    const costByPidMonth = new Map();
    for (const [k, v] of acc.full.cost) {
      const [pi, mi] = k.split("|").map(Number);
      const pid = pidByIndex[pi];
      if (pid === undefined) continue;
      const kk = `${pid}|${mi}`;
      costByPidMonth.set(kk, (costByPidMonth.get(kk) || 0) + v[0]);
    }

    const CELLS = ["depPos", "depNeg", "depFlat", "noDepPos", "noDepNeg", "noDepFlat"];
    const empty = () => ({
      players: new Array(nM).fill(0),
      bonused: new Array(nM).fill(0),
      cost: new Array(nM).fill(0),
      dep: new Array(nM).fill(0),
      aggr: new Array(nM).fill(0),
    });
    const mk = () => Object.fromEntries(CELLS.map(c => [c, empty()]));
    const matrix = { with: mk(), without: mk() };

    for (const [key, v] of bucketPm) {
      const sep = key.lastIndexOf("|");
      const pid = key.slice(0, sep);
      const mi = Number(key.slice(sep + 1));
      const [aggr, dep] = v;
      const cost = costByPidMonth.get(key) || 0;

      const cell = (dep > 0 ? "dep" : "noDep") + (aggr > 0 ? "Pos" : aggr < 0 ? "Neg" : "Flat");

      for (const scenario of ["with", "without"]) {
        if (scenario === "without" && outlierPids.has(pid)) continue;
        const c = matrix[scenario][cell];
        c.players[mi] += 1;
        c.dep[mi] += dep;
        c.aggr[mi] += aggr;
        if (cost > 0) { c.bonused[mi] += 1; c.cost[mi] += cost; }
      }
    }

    for (const scenario of ["with", "without"])
      for (const c of CELLS)
        for (const f of ["cost", "dep", "aggr"])
          matrix[scenario][c][f] = matrix[scenario][c][f].map(r2);

    out.matrix = matrix;
    out.matrixCells = CELLS;

    log("\nDeposit x result, whole period (all players):");
    const K = a => a.reduce((x, y) => x + y, 0).toLocaleString();
    for (const c of CELLS)
      log(`  ${c.padEnd(10)} ${K(matrix.with[c].players).padStart(10)} player-months, ` +
          `${K(matrix.with[c].bonused).padStart(9)} bonused, cost ${K(matrix.with[c].cost).padStart(12)}`);
  }

  /* The last calendar date the data actually covers. */
  out.dataThrough = `${months[nM - 1]}-${String(mtdDay).padStart(2, "0")}`;

  /* daily block for the final month */
  Object.assign(out, buildDaily(dailyByMonth.get(months[nM - 1]), months[nM - 1], mtdDay, outlierSet, segList, pseg, bidRows));

  return out;
}

/* ─────────────────────────── assembly helpers ─────────────────────────── */

function bump(map, key, mi, v, nM) {
  let a = map.get(key);
  if (!a) { a = new Array(nM).fill(0); map.set(key, a); }
  a[mi] += v;
}
function addTo(map, key, vec) {
  const cur = map.get(key) || [0, 0, 0];
  for (let i = 0; i < vec.length; i++) cur[i] += vec[i];
  map.set(key, cur);
}
const mapVals = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
const deriveDiff = (a, b) => a.map((v, i) => r2(v - b[i]));

function buildHierarchy(bidRows, groupCost, nM) {
  const order = ["CRM", "Loyalty Program", "General Promo", "Acquisition", "Unmapped"];
  const groups = new Map();
  for (const [, g, s] of bidRows) {
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(s);
  }
  const sortedGroups = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return sortedGroups.map(g => {
    const subs = [...groups.get(g)];
    const tot = s => (groupCost.get(`${g}|${s}`) || []).reduce((x, y) => x + y, 0);
    subs.sort((a, b) => tot(b) - tot(a));
    return { group: g, subs };
  });
}

/* ---- CRM flow labels ----------------------------------------------------
   Inside "Smartico - FLOW" the individual bonuses are named after the flow
   that sent them - "Churn: Mid Value 20 Free Spins", "RND Wheel: ...",
   "JRNY:FTD_...". The subgroup total hides which flow the money went to, so
   the name prefix is folded into a flow label and reported as a third level
   under the subgroup.

   Scoped to the FLOW subgroup deliberately: elsewhere the bonus names carry
   campaign titles, not flow names, and splitting on them would be noise. */
const FLOW_SUBS = new Set(["Smartico - FLOW"]);
const FLOW_SEP = "\u203A";                 // > — cannot occur in a group name

function flowOf(name, sub) {
  if (!FLOW_SUBS.has(sub)) return "";
  const s = String(name == null ? "" : name).trim().toLowerCase();
  if (!s) return "Other";
  if (s.startsWith("churn")) return "Churn";
  if (s.startsWith("retention")) return "Retention";
  if (s.startsWith("rnd")) return "RND";
  if (s.startsWith("jrny")) return "Journey (FTD)";
  if (s.startsWith("for ftd wheel")) return "FTD Wheel";
  if (s.startsWith("smartico")) return "Smartico Wheel";
  return "Other";
}

/* `Smartico - FLOW>Churn`. Kept free of "|" so costVal's two-part split still
   resolves it as an ordinary entry under the group. */
const flowKey = (sub, flow) => sub + FLOW_SEP + flow;

function assembleScope(scope, ctx) {
  const { nM, bidRows, rowsHierarchy, outlierSet, segList, pseg, putype } = ctx;

  /* detail: player -> [[mi, bx, cost, slot, live_casino, sport, other]]
     The four extra numbers are appended, so anything reading indexes 0-2
     keeps working unchanged. */
  const detail = {};
  for (const [k, v] of scope.cost) {
    const [p, mi, bx] = k.split("|").map(Number);
    (detail[p] || (detail[p] = [])).push([mi, bx, r4(v[0]), r4(v[1]), r4(v[2]), r4(v[3]), r4(v[4])]);
  }
  for (const p of Object.keys(detail)) detail[p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  /* per-scenario group blocks */
  const mk = (skipOutlier) => {
    const g = {};
    const total = new Array(nM).fill(0);
    for (const r of rowsHierarchy) { g[r.group] = { _: new Array(nM).fill(0) }; for (const s of r.subs) g[r.group][s] = new Array(nM).fill(0); }
    for (const [k, v] of scope.cost) {
      const cost = v[0];
      const [p, mi, bx] = k.split("|").map(Number);
      if (skipOutlier && outlierSet.has(p)) continue;
      const [nm, grp, sub] = bidRows[bx];
      if (!g[grp]) g[grp] = { _: new Array(nM).fill(0) };
      if (!g[grp][sub]) g[grp][sub] = new Array(nM).fill(0);
      g[grp]._[mi] += cost; g[grp][sub][mi] += cost; total[mi] += cost;
      const fl = flowOf(nm, sub);
      if (fl) {
        const fk = flowKey(sub, fl);
        if (!g[grp][fk]) g[grp][fk] = new Array(nM).fill(0);
        g[grp][fk][mi] += cost;
      }
    }
    for (const grp of Object.keys(g)) for (const s of Object.keys(g[grp])) g[grp][s] = g[grp][s].map(r2);
    return { g, total: total.map(r2) };
  };

  /* revenue, scenario-aware via pm */
  const revenue = (skipOutlier) => {
    const aggr = new Array(nM).fill(0), bet = new Array(nM).fill(0);
    if (!skipOutlier) return { aggr: scope.aggr.map(r2), bet: scope.bet.map(r2) };
    let oa = new Array(nM).fill(0);
    for (const [k, v] of scope.pm) {
      const [p, mi] = k.split("|").map(Number);
      if (outlierSet.has(p)) oa[mi] += v[1];
    }
    for (let i = 0; i < nM; i++) { aggr[i] = scope.aggr[i] - oa[i]; bet[i] = scope.bet[i] - scope.outl.bet[i]; }
    return { aggr: aggr.map(r2), bet: bet.map(r2) };
  };

  const withB = { ...mk(false), ...revenue(false) };
  const withoutB = { ...mk(true), ...revenue(true) };

  /* per segment */
  const dataS = {};
  for (let si = 0; si < segList.length; si++) {
    const inSeg = p => pseg[p] === si;
    const mkS = (skipOutlier) => {
      const g = {}; const total = new Array(nM).fill(0);
      for (const [k, v] of scope.cost) {
        const cost = v[0];
        const [p, mi, bx] = k.split("|").map(Number);
        if (!inSeg(p) || (skipOutlier && outlierSet.has(p))) continue;
        const [nm, grp, sub] = bidRows[bx];
        if (!g[grp]) g[grp] = { _: new Array(nM).fill(0) };
        if (!g[grp][sub]) g[grp][sub] = new Array(nM).fill(0);
        g[grp]._[mi] += cost; g[grp][sub][mi] += cost; total[mi] += cost;
        const fl = flowOf(nm, sub);
        if (fl) {
          const fk = flowKey(sub, fl);
          if (!g[grp][fk]) g[grp][fk] = new Array(nM).fill(0);
          g[grp][fk][mi] += cost;
        }
      }
      const aggr = new Array(nM).fill(0), bet = new Array(nM).fill(0);
      for (const [k, v] of scope.pm) {
        const [p, mi] = k.split("|").map(Number);
        if (!inSeg(p) || (skipOutlier && outlierSet.has(p))) continue;
        aggr[mi] += v[1];
      }
      for (const grp of Object.keys(g)) for (const s of Object.keys(g[grp])) g[grp][s] = g[grp][s].map(r2);
      return { g, total: total.map(r2), aggr: aggr.map(r2), bet: bet.map(r2) };
    };
    dataS[String(si)] = { with: mkS(false), without: mkS(true) };
  }

  /* per user type — same shape as dataS, so the report can render either with
     one piece of code. Kept monthly rather than pre-summed to a year: the
     table shows a year to date today, and a month-by-month view later costs
     nothing if the numbers are already here. */
  const dataU = {};
  for (let ui = 0; ui < USER_TYPES.length; ui++) {
    const inType = p => putype[p] === ui;
    const mkU = (skipOutlier) => {
      const g = {}; const total = new Array(nM).fill(0);
      for (const [k, v] of scope.cost) {
        const cost = v[0];
        const [p, mi, bx] = k.split("|").map(Number);
        if (!inType(p) || (skipOutlier && outlierSet.has(p))) continue;
        const [, grp] = bidRows[bx];
        if (!g[grp]) g[grp] = new Array(nM).fill(0);
        g[grp][mi] += cost; total[mi] += cost;
      }
      /* Adjusted GGR for the same players, so "% of adj GGR" has a denominator
         that matches its numerator. Using the whole book's GGR here would make
         every column look small in a different way. */
      const aggr = new Array(nM).fill(0);
      for (const [k, v] of scope.pm) {
        const [p, mi] = k.split("|").map(Number);
        if (!inType(p) || (skipOutlier && outlierSet.has(p))) continue;
        aggr[mi] += v[1];
      }
      for (const grp of Object.keys(g)) g[grp] = g[grp].map(r2);
      return { g, total: total.map(r2), aggr: aggr.map(r2) };
    };
    dataU[String(ui)] = { with: mkU(false), without: mkU(true) };
  }

  /* cells: key -> month -> [[player, cost]] sorted desc */
  const cells = {};
  const push = (key, mi, p, cost) => {
    const c = cells[key] || (cells[key] = {});
    const m = c[mi] || (c[mi] = new Map());
    m.set(p, (m.get(p) || 0) + cost);
  };
  for (const [k, v] of scope.cost) {
    const cost = v[0];
    const [p, mi, bx] = k.split("|").map(Number);
    const [nm, grp, sub] = bidRows[bx];
    push(grp, mi, p, cost);
    push(`${grp}|${sub}`, mi, p, cost);
    const fl = flowOf(nm, sub);
    if (fl) push(`${grp}|${flowKey(sub, fl)}`, mi, p, cost);
    push("__ALL__", mi, p, cost);
  }
  for (const key of Object.keys(cells))
    for (const mi of Object.keys(cells[key]))
      cells[key][mi] = [...cells[key][mi].entries()].map(([p, c]) => [p, r4(c)]).sort((a, b) => b[1] - a[1]);

  /* pm */
  const pm = {};
  for (const [k, v] of scope.pm) {
    const [p, mi] = k.split("|");
    (pm[p] || (pm[p] = {}))[mi] = [r4(v[0]), r4(v[1]), r4(v[2])];
  }

  const segObj = (map, skipOutlier) => {
    const o = {};
    for (const lbl of ctx.segList) o[lbl] = (map.get(lbl) || new Array(nM).fill(0)).map(r2);
    return o;
  };

  /* segAggr / prodGGR: outlier removal via pm for segAggr, proportional not possible for prodGGR */
  const segAggrWith = segObj(scope.segAggr);
  const segAggrWithout = JSON.parse(JSON.stringify(segAggrWith));
  for (const [k, v] of scope.pm) {
    const [p, mi] = k.split("|").map(Number);
    if (!ctx.outlierSet.has(p)) continue;
    const lbl = ctx.segList[pseg[p]];
    segAggrWithout[lbl][mi] = r2(segAggrWithout[lbl][mi] - v[1]);
  }

  const prodGGRWith = {}, prodGGRWithout = {};
  for (const lbl of ["Slot", "Live Casino", "Sport", "Other"]) {
    const all = scope.prodGGR.get(lbl) || new Array(nM).fill(0);
    const out = scope.outl.prodGGR.get(lbl) || new Array(nM).fill(0);
    prodGGRWith[lbl] = all.map(r2);
    prodGGRWithout[lbl] = all.map((v, i) => r2(v - out[i]));
  }

  return {
    data: { with: withB, without: withoutB },
    dataS,
    dataU,
    detail,
    cells,
    pm,
    segAggr: { with: segAggrWith, without: segAggrWithout },
    prodGGR: { with: prodGGRWith, without: prodGGRWithout },
    nrows: scope.nrows,
  };
}

function buildDaily(days, ym, mtdDay, outlierSet, segList, pseg, bidRows) {
  if (!days) return {};
  const dayNums = [...days.keys()].filter(d => d <= mtdDay).sort((a, b) => a - b);
  const n = dayNums.length;
  const z = () => new Array(n).fill(0);

  const dailyLast = {
    label: monthLabel(ym), month: ym, days: dayNums,
    with: z(), with_ggr: z(), with_aggr: z(), with_dep: z(), with_bet: z(),
    without: z(), without_ggr: z(), without_aggr: z(), without_dep: z(), without_bet: z(),
  };
  const dailySeg = {};
  segList.forEach((_, si) => dailySeg[String(si)] = { with: z(), with_ggr: z(), with_aggr: z(), with_dep: z(), with_bet: z(), without: z(), without_ggr: z(), without_aggr: z(), without_dep: z(), without_bet: z() });

  const dayDet = [];
  const dayPm = {};

  dayNums.forEach((d, di) => {
    const day = days.get(d);
    dailyLast.with[di] = r2(day.cost);
    dailyLast.with_ggr[di] = r2(day.ggr);
    dailyLast.with_aggr[di] = r2(day.aggr);
    dailyLast.with_dep[di] = r2(day.dep);
    dailyLast.with_bet[di] = r2(day.bet);

    let oc = 0, og = 0, oa = 0, od = 0;
    for (const [pk, v] of day.pm) {
      const p = Number(pk);
      dayPm[pk] || (dayPm[pk] = {});
      if (outlierSet.has(p)) { og += v[0]; oa += v[1]; od += v[2]; }
    }

    const det = [];
    for (const [ck, cost] of day.costK) {
      const [p, bx] = ck.split("|").map(Number);
      det.push([p, bx, r4(cost)]);
      if (outlierSet.has(p)) oc += cost;
      const si = pseg[p];
      if (dailySeg[String(si)]) dailySeg[String(si)].with[di] += cost;
    }
    dayDet.push(det);

    for (const [pk, v] of day.pm) {
      const p = Number(pk);
      if (!day.costK.size) break;
      // only players who received a bonus that day are kept, matching the report
      dayPm[pk] = dayPm[pk] || {};
    }
    const bonused = new Set(det.map(r => r[0]));
    for (const [pk, v] of day.pm) {
      const p = Number(pk);
      /* Without this the day panel could only ever show players who received a
         bonus, so its GGR never added up to the chart bar. */
      if (!ALL_PLAYERS_DAILY && !bonused.has(p)) continue;
      (dayPm[pk] || (dayPm[pk] = {}))[String(di)] = [r2(v[0]), r2(v[1]), r2(v[2])];
      const si = pseg[p];
      if (dailySeg[String(si)]) { dailySeg[String(si)].with_ggr[di] += v[0]; dailySeg[String(si)].with_aggr[di] += v[1]; dailySeg[String(si)].with_dep[di] += v[2]; }
    }

    dailyLast.without[di] = r2(day.cost - oc);
    dailyLast.without_ggr[di] = r2(day.ggr - og);
    dailyLast.without_aggr[di] = r2(day.aggr - oa);
    dailyLast.without_dep[di] = r2(day.dep - od);
    dailyLast.without_bet[di] = r2(day.bet - day.outlBet);

    segList.forEach((_, si) => {
      const s = dailySeg[String(si)];
      const isOutlierSeg = [...outlierSet].some(p => pseg[p] === si);
      s.without[di] = r2(s.with[di] - (isOutlierSeg ? oc : 0));
      s.without_ggr[di] = r2(s.with_ggr[di] - (isOutlierSeg ? og : 0));
      s.without_aggr[di] = r2(s.with_aggr[di] - (isOutlierSeg ? oa : 0));
      s.without_dep[di] = r2(s.with_dep[di] - (isOutlierSeg ? od : 0));
      /* Bet is not tracked per player, so segment bet is left at the all-player
         figure rather than guessed at. */
      s.with_bet[di] = r2(dailyLast.with_bet[di]);
      s.without_bet[di] = r2(dailyLast.without_bet[di]);
      s.with[di] = r2(s.with[di]); s.with_ggr[di] = r2(s.with_ggr[di]); s.with_aggr[di] = r2(s.with_aggr[di]); s.with_dep[di] = r2(s.with_dep[di]);
    });
  });

  for (const pk of Object.keys(dayPm)) if (!Object.keys(dayPm[pk]).length) delete dayPm[pk];

  return { dailyLast, dailySeg, dayDet, dayPm };
}

/* ─────────────────────────── probe ─────────────────────────── */

async function probe() {
  log(`Host: ${HOST}\n`);
  for (const [id, key, params] of [
    [Q_COST, KEY_COST, { date_range: { start: "2026-08-01", end: "2026-08-02" } }],
    [Q_MAIN, KEY_MAIN, { date_range: { start: "2026-08-01", end: "2026-08-02" }, "Current Segment": "All" }],
  ]) {
    try {
      const rows = await runQuery(id, key, params, `query ${id}`);
      log(`  query ${id}: OK — columns: ${Object.keys(rows[0] || {}).slice(0, 8).join(", ")}…\n`);
    } catch (e) {
      log(`  query ${id}: FAILED — ${e.message}\n`);
    }
  }
}

/* ─────────────────────────── ad-hoc GGR for a year ───────────────────────────
   Pulls query 1732 one month at a time and totals the revenue columns.
   A whole year in a single request would be well over a million rows. */

async function ggrYear(year) {
  log(`GGR for ${year}, from query 1732 (Marketing General Report)\n`);
  const months = monthList(`${year}-01`, `${year}-12`);
  const out = [];
  let tGGR = 0, tAGGR = 0, tBet = 0, tDep = 0, tRows = 0, tBonus = 0;

  for (const ym of months) {
    const last = daysInMonth(ym);
    let rows;
    try {
      rows = await runQuery(Q_MAIN, KEY_MAIN, {
        date_range: { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` },
        "Current Segment": "All",
      }, `1732 ${ym}`);
    } catch (e) {
      log(`  ${ym}: FAILED — ${e.message.split("\n")[0]}`);
      out.push({ ym, failed: true });
      continue;
    }

    let ggr = 0, aggr = 0, bet = 0, dep = 0, bonus = 0;
    for (const r of rows) {
      ggr += num(r.ggr); aggr += num(r.adjusted_ggr);
      bet += num(r.bet); dep += num(r.deposit); bonus += num(r.bonus_cost);
    }
    out.push({ ym, rows: rows.length, ggr, aggr, bet, dep, bonus });
    tGGR += ggr; tAGGR += aggr; tBet += bet; tDep += dep; tBonus += bonus; tRows += rows.length;

    const M = v => Math.round(v).toLocaleString("en-US");
    log(`  ${ym}   GGR ${M(ggr).padStart(14)}   adj GGR ${M(aggr).padStart(14)}   bet ${M(bet).padStart(16)}`);
  }

  const M = v => Math.round(v).toLocaleString("en-US");
  log("\n  " + "-".repeat(70));
  log(`  ${year} TOTAL`);
  log(`     GGR          ${M(tGGR).padStart(18)}`);
  log(`     adjusted GGR ${M(tAGGR).padStart(18)}`);
  log(`     bet          ${M(tBet).padStart(18)}`);
  log(`     deposits     ${M(tDep).padStart(18)}`);
  log(`     bonus cost   ${M(tBonus).padStart(18)}`);
  log(`     rows scanned ${tRows.toLocaleString().padStart(18)}`);
  const failed = out.filter(o => o.failed).map(o => o.ym);
  if (failed.length) log(`\n  Months that failed: ${failed.join(", ")} — total above excludes them.`);
  if (tRows === 0) log(`\n  No rows at all for ${year}. The query's source tables may not go back that far.`);
  log("");
}

/* ─────────────────────────── segment probe ───────────────────────────
   1732 carries three segment columns. Work out which one the original
   report was segmented by, by comparing all three against it for one month. */

async function segprobe() {
  const ym = RANGE_FROM;
  const mi = monthList("2026-01", ym).length - 1;
  log(`Comparing segment columns for ${ym} (month index ${mi})\n`);

  const refFile = path.join(__dirname, "output/reports/bonus_cost_by_group_2026_8.html");
  const m = fs.readFileSync(refFile, "utf8").match(/<script id="d" type="application\/json">([\s\S]*?)<\/script>/);
  const ref = JSON.parse(m[1]);

  const rows = await runQuery(Q_MAIN, KEY_MAIN, {
    date_range: { start: `${ym}-01`, end: `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}` },
    "Current Segment": "All",
  }, `1732 ${ym}`);

  const columns = ["current_segment", "player_segment", "financial_segment"];
  const byCol = {};
  for (const c of columns) byCol[c] = new Map();
  let total = 0;

  for (const row of rows) {
    const aggr = num(row.adjusted_ggr);
    total += aggr;
    for (const c of columns) {
      const lbl = segLabel(row[c]);
      byCol[c].set(lbl, (byCol[c].get(lbl) || 0) + aggr);
    }
  }

  const refSeg = {};
  for (const [lbl, arr] of Object.entries(ref.segAggr.with)) refSeg[lbl] = arr[mi];

  log(`  total adjusted GGR: ${Math.round(total).toLocaleString()}  (report: ${Math.round(ref.data.with.aggr[mi]).toLocaleString()})\n`);

  for (const c of columns) {
    let matched = 0, checked = 0, worst = null;
    const lines = [];
    for (const [lbl, refVal] of Object.entries(refSeg)) {
      if (Math.abs(refVal) < 1) continue;
      const mine = byCol[c].get(lbl) || 0;
      const pct = 100 * (mine - refVal) / Math.abs(refVal);
      checked++;
      if (Math.abs(pct) < 1) matched++;
      if (!worst || Math.abs(pct) > Math.abs(worst.pct)) worst = { lbl, mine, refVal, pct };
      lines.push(`      ${lbl.padEnd(12)} mine ${Math.round(mine).toLocaleString().padStart(12)}   report ${Math.round(refVal).toLocaleString().padStart(12)}   ${pct.toFixed(1)}%`);
    }
    log(`  ${c}:  ${matched}/${checked} segments within 1%`);
    log(lines.join("\n"));
    log("");
  }

  log("  Whichever column matches is the one the report was built from.");
  log("  Labels the report doesn't use at all mean that column has a different taxonomy.\n");
  for (const c of columns) {
    log(`  ${c} labels seen: ${[...byCol[c].keys()].slice(0, 12).join(", ")}`);
  }
}

/* ─────────────────────────── verify ─────────────────────────── */

function verify(fresh) {
  const old = path.join(__dirname, "output/reports/bonus_cost_by_group_2026_8.html");
  if (!fs.existsSync(old)) { log("\nNo reference file to verify against."); return; }
  const html = fs.readFileSync(old, "utf8");
  const m = html.match(/<script id="d" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) { log("\nCould not find the reference data block."); return; }
  const ref = JSON.parse(m[1]);

  log("\n─── verification against bonus_cost_by_group_2026_8.html ───\n");
  const cmp = (label, a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) { log(`  ${label}: missing on one side`); return; }
    const rows = a.map((v, i) => {
      const w = b[i] ?? 0;
      const d = v - w;
      const pct = w === 0 ? (v === 0 ? 0 : Infinity) : (100 * d / Math.abs(w));
      return { i, fresh: v, ref: w, diff: d, pct };
    });
    const worst = rows.reduce((x, y) => Math.abs(y.pct) > Math.abs(x.pct) ? y : x, rows[0]);
    const ok = rows.every(r => Math.abs(r.pct) < 0.5 || Math.abs(r.diff) < 1);
    log(`  ${ok ? "OK  " : "DIFF"} ${label.padEnd(28)} worst month ${worst.i}: ${worst.fresh.toFixed(0)} vs ${worst.ref.toFixed(0)} (${isFinite(worst.pct) ? worst.pct.toFixed(2) + "%" : "n/a"})`);
  };

  cmp("bonus cost total (with)", fresh.data.with.total, ref.data.with.total);
  cmp("bonus cost total (without)", fresh.data.without.total, ref.data.without.total);
  cmp("adjusted GGR (with)", fresh.data.with.aggr, ref.data.with.aggr);
  cmp("bet (with)", fresh.data.with.bet, ref.data.with.bet);
  cmp("outlier cost", fresh.kar, ref.kar);
  cmp("MTD total (with)", fresh.mtd.data.with.total, ref.mtd.data.with.total);

  for (const g of ["CRM", "Loyalty Program", "General Promo", "Acquisition", "Unmapped"]) {
    if (fresh.data.with.g[g] && ref.data.with.g[g]) cmp(`group ${g}`, fresh.data.with.g[g]._, ref.data.with.g[g]._);
  }
  for (const s of ["Vip", "Regular", "Mass", "Free Rider"]) {
    if (fresh.segAggr.with[s] && ref.segAggr.with[s]) cmp(`segAggr ${s}`, fresh.segAggr.with[s], ref.segAggr.with[s]);
  }
  for (const p of ["slot", "live_casino", "sport", "other"]) {
    if (fresh.prodSplit.with[p] && ref.prodSplit.with[p]) cmp(`prodSplit ${p}`, fresh.prodSplit.with[p], ref.prodSplit.with[p]);
  }

  log(`\n  players   fresh ${fresh.players.length}  ref ${ref.players.length}`);
  log(`  bonuses   fresh ${fresh.bids.length}  ref ${ref.bids.length}`);
  log(`  detail    fresh ${Object.keys(fresh.detail).length}  ref ${Object.keys(ref.detail).length}`);
  log("\n  Differences are expected where the reference was built from a spreadsheet");
  log("  export rather than a live query. Investigate anything over a few percent.\n");
}

/* ─────────────────────────── main ─────────────────────────── */

(async () => {
  if (!HOST || !KEY_COST || !KEY_MAIN) {
    console.error("Missing REDASH_HOST / REDASH_KEY_1731 / REDASH_KEY_1732 in config.env");
    process.exit(1);
  }
  try {
    if (GROUPS_ONLY) {
      /* Just the bonus categorisation, so the Google Sheet link can be checked
         in seconds instead of waiting out a full build. */
      const r = await loadBonusGroups();
      const map = r.map || {};
      const ids = Object.keys(map);
      log(`\n  source used : ${r.source}`);
      log(`  bonuses     : ${ids.length.toLocaleString()}`);
      const groups = {};
      for (const v of Object.values(map)) groups[v.group] = (groups[v.group] || 0) + 1;
      for (const [g, n] of Object.entries(groups).sort((a, b) => b[1] - a[1]))
        log(`     ${String(n).padStart(5)}  ${g}`);
      log(ids.length ? "\n  Looks good.\n" : "\n  Nothing was read.\n");
      return;
    }
    if (PROBE) { await probe(); return; }
    if (SEGPROBE) { await segprobe(); return; }
    if (GGR_YEAR) { await ggrYear(GGR_YEAR); return; }

    const t0 = Date.now();
    const data = await build();

    const dest = path.join(__dirname, "output/data", OUT_FILE);
    const tmp = dest + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, dest);

    const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
    log(`\nWrote ${OUT_FILE} — ${mb} MB in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
    log(`  months ${data.months[0]}…${data.months[data.months.length - 1]}` +
        `  players ${data.players.length}  bonuses ${data.bids.length}`);
    log(`  bonus cost by month: ${data.data.with.total.map(v => Math.round(v).toLocaleString()).join("  ")}`);
    if (STALE_MONTHS.length) {
      log("");
      log("  ****************************************************************");
      log("  *  SOME MONTHS COULD NOT BE REFRESHED                          *");
      log("  ****************************************************************");
      for (const m of STALE_MONTHS) log(`     ${m.ym}: served from a ${m.age}d-old cache — ${m.why}`);
      log("     Those months are as of the cache date, not today.");
      log("");
    }

    /* Refresh the double-clickable snapshot too, so it never lags the build. */
    try {
      require("child_process").execFileSync(process.execPath, [path.join(__dirname, "make-standalone.js")], { stdio: "inherit" });
    } catch (e) {
      log("  (could not refresh bonus-cost-report.html — the served page is unaffected)");
    }

    /* Push the fresh numbers to the public site. Only if it has been set up —
       otherwise this is just a local build and there is nothing to publish to. */
    if (cfg("CF_API_TOKEN") && cfg("CF_ACCOUNT_ID")) {
      try {
        log("\nPublishing to the web...");
        require("child_process").execFileSync(process.execPath, [path.join(__dirname, "publish-worker.js")], { stdio: "inherit" });
      } catch (e) {
        log("\n  ! Publishing failed. The numbers were rebuilt and saved locally,");
        log("    so the site keeps serving yesterday's copy until this is fixed.");
      }
    }

    if (VERIFY) verify(data);
  } catch (e) {
    console.error("\nBuild failed:", e.message);
    process.exit(1);
  }
})();
