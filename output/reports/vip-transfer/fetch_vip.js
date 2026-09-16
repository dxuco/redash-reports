/* One-click refresh for the VIP Transfer page.
 *
 *   1. pulls the tracker straight from the Google Sheet (it is link-readable,
 *      so no browser session is needed)
 *   2. resolves rows whose User ID cell is blank by looking the username up in
 *      public.players -- 13 rows needed this in Aug 2026 and the column is
 *      still not reliably filled
 *   3. runs the cohort query against Redash with the account-level key
 *   4. writes every data/*.json the builder reads
 *
 * build_vip_transfer.py then turns those into the page. Nothing here needs a
 * browser or a person.
 */
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const DATA = path.join(HERE, "data");
const ENV  = Object.fromEntries(
  fs.readFileSync(path.join(HERE, "..", "config.env"), "utf8")
    .split(/\r?\n/)
    .filter(l => l && !l.trim().startsWith("#") && l.includes("="))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const HOST  = (ENV.REDASH_HOST || "").replace(/\/+$/, "");
const KEY   = ENV.REDASH_USER_API_KEY;
const DS    = Number(ENV.VIP_DATA_SOURCE_ID || 20);
const SHEET = ENV.VIP_SHEET_ID  || "11k8dhQj-DlRc9Mj4gXy3pUjUPYAqU8tW6fNGWH7RIcM";
const GID   = ENV.VIP_SHEET_GID || "1232832892";

if (!KEY)  { console.error("  ** REDASH_USER_API_KEY missing from config.env"); process.exit(1); }
if (!HOST) { console.error("  ** REDASH_HOST missing from config.env"); process.exit(1); }

/* ---------- the sheet ---------- */
function parseCsvLine(l) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}
const isoDate = s => {
  s = (s || "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};
/* A tracker row typed 2016 for 2026 kept a player out of the cohort for a day.
   Anything before the programme existed is a typo in the year. */
const sane = d => (d && d < "2025-01-01") ? "2026" + d.slice(4) : d;

const CASINO_FIX = { bitstarz:"BitStarz", Bitstarz:"BitStarz", bitsler:"Bitsler", rainbet:"Rainbet",
  "1xbit":"1xBit", "1xbet":"1xBet", thrill:"Thrill", sportzino:"Sportzino", betbox:"Betbox",
  "rollhub.com":"Rollhub", "jet casino":"Jet Casino", "500casino":"500 Casino",
  "Yabby casino":"Yabby Casino", "Mevcut casino":"Mevcut Casino", DANNCHE06:"Other",
  Luskywave:"Luckywave", "myprize.us":"MyPrize", "punkz.com":"Punkz", stnzzz:"Stnzzz", "":"Other" };

async function readSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&gid=${GID}&headers=0&_=${Date.now()}`;
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`sheet fetch failed ${r.status} — is it still link-readable?`);
  const rows = (await r.text()).split("\n").map(parseCsvLine).filter(c => c.length > 8);
  const withId = [], byName = [];
  for (const c of rows) {
    const va = (c[4] || "").trim(), user = (c[1] || "").trim();
    const id = (c[2] || "").replace(/\s/g, "");
    /* A row needs a VA and SOME way to name the player -- a username or a User
       ID. It used to demand the username, which silently dropped every row that
       had only an ID: Mariam Khoperia's ~290 players were assigned with column B
       left blank and none of them reached the report, with nothing to say so.
       The ID is the better identifier anyway; the username lookup exists only
       because the ID column is often the one left empty. */
    if (!va || va === "VA Name" || (!user && !/^\d{6,}$/.test(id))) continue;
    const rec = {
      onboard: sane(isoDate(c[7]) || isoDate(c[0])),
      va,
      casino: CASINO_FIX[(c[3] || "").trim()] ?? ((c[3] || "").trim() || "Other"),
      /* "Player Replied?" (column P). Three states, and the blank is a real one:
         39 of 225 rows are blank, almost all of them the newest assignments that
         nobody has worked yet. Folding blank into "No" would report those as
         players who ignored us. Carried through verbatim -- the sheet holds only
         "Yes", "No" and "" today, and if a fourth value ever appears it should
         show up on the page rather than be silently bucketed here. */
      replied: (c[15] || "").trim(),
    };
    if (/^\d{6,}$/.test(id)) withId.push({ player_id: Number(id), ...rec });
    else byName.push({ username: user, ...rec });
  }
  return { withId, byName };
}

/* ---------- the VAs' own notebooks ----------
 *
 * Nine tabs, one per VA, holding what the manager actually wrote about a
 * player: "says VIP status didn't improve his experience", "most likely fraud,
 * device match with another VIP". None of that exists in the warehouse, and it
 * is often the only explanation of a number on the page.
 *
 * Every tab has a different schema -- Feedback, Comment, communication,
 * "Assitant Comment" (sic), "Expectations:" -- and Elene's ID column has an
 * EMPTY header, so matching on column names alone finds nothing there. Columns
 * are therefore identified by what they contain: the ID column is the one whose
 * cells are mostly 6-9 digit numbers, the email column the one with the @s.
 * That survives a VA reordering their own tab, which several have.
 *
 * The VA's name is not in any column. It is the tab name, so it is mapped here.
 */
const NOTE_TABS = [
  ["Lizi U.",  "Lizi Utiashvili"],
  ["Sophi",    "Sophi Matchavariani"],
  ["Anna Sh.", "Ana Shergelashvili"],
  ["Nini",     "Nini Berozashvili"],
  ["Ani S.",   "Ani Sulakveridze"],
  ["Ramazi",   "Ramaz Getiashvili"],
  ["Elene",    "Elene Ghambarashvili"],
  ["Naniko",   "Naniko Tkhilaishvili"],
  ["Giorgi",   "Giorgi Todua"],
];
// headers that hold a remark, and headers that hold the state around it
const NOTE_COL   = /feedback|comment|communication|expectation/i;
const STATUS_COL = /contact status|^activity|deposited since|preferred bonus/i;

async function sheetCsv(tab) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq`
            + `?tqx=out:csv&headers=0&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`tab "${tab}": ${r.status}`);
  return (await r.text()).split("\n").map(parseCsvLine);
}

/** The column index whose values most often look like a player id. */
function idColumn(rows) {
  const n = Math.max(...rows.map(r => r.length));
  let best = -1, bestHits = 0;
  for (let c = 0; c < n; c++) {
    let hits = 0;
    for (let i = 1; i < rows.length; i++)
      if (/^\d{6,9}$/.test((rows[i][c] || "").trim())) hits++;
    if (hits > bestHits) { bestHits = hits; best = c; }
  }
  return bestHits >= 2 ? best : -1;
}
function emailColumn(rows) {
  const n = Math.max(...rows.map(r => r.length));
  let best = -1, bestHits = 0;
  for (let c = 0; c < n; c++) {
    let hits = 0;
    for (let i = 1; i < rows.length; i++) if ((rows[i][c] || "").includes("@")) hits++;
    if (hits > bestHits) { bestHits = hits; best = c; }
  }
  return bestHits >= 2 ? best : -1;
}

/* The onboarding survey. The tab does not exist yet -- it is added later -- so
 * this reads it if it is there and stays quiet if it is not, rather than
 * failing the whole refresh over a sheet nobody has made.
 *
 * Expected shape, mirroring the paper form: ONE ROW PER PLAYER PER QUESTION.
 *   a player id column (detected by content, as in the VA tabs)
 *   a question column   -- the number 1-5, or the question text
 *   a "current casino"  column: header contains "current" or "have"
 *   an "expect"         column: header contains "expect"
 * Anything else on the row is ignored. If the sheet ends up one-row-per-player
 * instead, this is the function to change and nothing else.
 */
async function readSurvey(emailToId) {
  let rows;
  try { rows = await sheetCsv("Survey"); }
  catch { console.log("    no Survey tab yet"); return []; }
  rows = rows.filter(r => r.some(c => (c || "").trim()));
  if (rows.length < 2) { console.log("    Survey tab is empty"); return []; }

  const head = rows[0].map(h => (h || "").trim());
  const find = re => head.findIndex(h => re.test(h));
  const qc = find(/^#$|question/i), hc = find(/current|have/i), ec = find(/expect/i);
  const idc = idColumn(rows), emc = emailColumn(rows);
  /* gviz does not error on a missing sheet name -- it silently returns the FIRST
     tab instead. Asking for "Survey" today hands back the Dashboard. So the tab
     is identified by its own shape: an "expect" column is what makes this the
     survey and nothing else in the workbook has one. Without it, assume the tab
     does not exist yet rather than parsing whatever arrived. */
  if (ec < 0) { console.log("    no Survey tab yet (or it has no \"expect\" column)"); return []; }

  const out = [];
  let unmatched = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const have = hc >= 0 ? (r[hc] || "").trim() : "";
    const expect = ec >= 0 ? (r[ec] || "").trim() : "";
    if (!have && !expect) continue;
    let pid = idc >= 0 ? Number((r[idc] || "").replace(/\D/g, "")) : 0;
    if (!pid && emc >= 0) pid = emailToId.get((r[emc] || "").trim().toLowerCase()) || 0;
    if (!pid) { unmatched++; continue; }
    out.push({ player_id: pid, q: qc >= 0 ? (r[qc] || "").trim() : String(out.length + 1),
               have, expect });
  }
  console.log(`    Survey: ${out.length} answers`
            + (unmatched ? `, ${unmatched} with no id` : ""));
  return out;
}

async function readNotes(emailToId) {
  const out = [];
  for (const [tab, va] of NOTE_TABS) {
    let rows;
    try { rows = await sheetCsv(tab); }
    catch (e) { console.log(`    ! ${tab}: ${e.message}`); continue; }
    rows = rows.filter(r => r.some(c => (c || "").trim()));
    if (rows.length < 2) { console.log(`    ${tab}: empty`); continue; }

    const head = rows[0].map(h => (h || "").trim());
    const noteCols   = head.map((h, i) => NOTE_COL.test(h)   ? i : -1).filter(i => i >= 0);
    const statusCols = head.map((h, i) => STATUS_COL.test(h) ? i : -1).filter(i => i >= 0);
    const idc = idColumn(rows), emc = emailColumn(rows);
    if (!noteCols.length) { console.log(`    ${tab}: no remark column`); continue; }

    let kept = 0, unmatched = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const text = noteCols.map(c => (r[c] || "").trim()).filter(Boolean).join(" — ");
      if (!text) continue;
      // trailing spaces and stray newlines are common in these cells
      let pid = idc >= 0 ? Number((r[idc] || "").replace(/\D/g, "")) : 0;
      if (!pid && emc >= 0) pid = emailToId.get((r[emc] || "").trim().toLowerCase()) || 0;
      if (!pid) { unmatched++; continue; }
      out.push({
        player_id: pid, va, tab, text,
        status: statusCols.map(c => (r[c] || "").trim()).filter(Boolean).join(" · "),
      });
      kept++;
    }
    console.log(`    ${tab}: ${kept} note${kept === 1 ? "" : "s"}`
              + (unmatched ? `, ${unmatched} with no id or known email` : ""));
  }
  return out;
}

/* ---------- Redash ---------- */
async function sql(statement, label) {
  const r = await fetch(`${HOST}/api/query_results?api_key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ data_source_id: DS, query: statement, max_age: 0 }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${label}: ${r.status} — ${text.slice(0, 300)}`);
  let body; try { body = JSON.parse(text); }
  catch { throw new Error(`${label}: unparseable response`); }
  if (body.query_result) return body.query_result.data.rows;
  if (!body.job) throw new Error(`${label}: no job and no result`);
  /* poll */
  const deadline = Date.now() + 9 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(s => setTimeout(s, 2000));
    const jr = await fetch(`${HOST}/api/jobs/${body.job.id}?api_key=${encodeURIComponent(KEY)}`,
                           { headers: { Accept: "application/json" } });
    if (!jr.ok) throw new Error(`${label}: job poll ${jr.status}`);
    const j = (await jr.json()).job;
    if (j.status === 3) {
      const rr = await fetch(`${HOST}/api/query_results/${j.query_result_id}?api_key=${encodeURIComponent(KEY)}`,
                             { headers: { Accept: "application/json" } });
      if (!rr.ok) throw new Error(`${label}: result fetch ${rr.status}`);
      return (await rr.json()).query_result.data.rows;
    }
    if (j.status === 4) throw new Error(`${label}: query failed — ${j.error}`);
    process.stdout.write(".");
  }
  throw new Error(`${label}: timed out`);
}

const q = s => "'" + String(s).replace(/'/g, "''") + "'";

(async () => {
  console.log("  reading the tracker sheet...");
  const { withId, byName } = await readSheet();
  console.log(`    ${withId.length} rows with a User ID, ${byName.length} without`);

  let resolved = [];
  if (byName.length) {
    const names = byName.map(b => `(${q(b.username)})`).join(",");
    const rows = await sql(
      `with want(u) as (values ${names})
       select w.u sheet_username, count(p.id) matches, min(p.id) player_id
       from want w left join public.players p on lower(p.username) = lower(w.u)
       group by w.u`, "username lookup");
    const map = new Map(rows.map(r => [String(r.sheet_username).toLowerCase(), r]));
    for (const b of byName) {
      const hit = map.get(b.username.toLowerCase());
      if (!hit || !hit.player_id) { console.log(`    ! no account for "${b.username}" — skipped`); continue; }
      if (Number(hit.matches) > 1) { console.log(`    ! "${b.username}" matches ${hit.matches} accounts — skipped`); continue; }
      resolved.push({ player_id: Number(hit.player_id), onboard: b.onboard, va: b.va,
                      casino: b.casino, id_from: "username:" + b.username });
    }
    console.log(`    resolved ${resolved.length} of ${byName.length} by username`);
  }

  const seen = new Set(), roster = [];
  for (const r of [...withId, ...resolved]) {
    if (seen.has(r.player_id)) continue;
    seen.add(r.player_id); roster.push(r);
  }
  roster.sort((a, b) => a.player_id - b.player_id);
  fs.writeFileSync(path.join(DATA, "roster.json"), JSON.stringify(roster, null, 0));
  console.log(`  roster.json: ${roster.length} players`);

  const values = roster.map(r => `(${r.player_id},${q(r.onboard)})`).join(",");
  const cohortSql = fs.readFileSync(path.join(DATA, "queries", "cohort.template.sql"), "utf8")
                      .replace("__SHEET_VALUES__", values);
  console.log("  running the cohort query");
  const rows = await sql(cohortSql, "cohort");
  fs.writeFileSync(path.join(DATA, "cohort.json"), JSON.stringify(rows));
  console.log(`\n  cohort.json: ${rows.length} rows`);

  // Deposit sizes and transfer free spins. No template substitution: the query
  // takes its own cohort from loyalty_transfer_request.
  // Everything below takes its own cohort straight from
  // loyalty_transfer_request, so no template substitution is needed. These four
  // used to be refreshed by hand, which is how the drill-down history came to be
  // two days behind the summary tables while the page still said it was current.
  for (const [file, label] of [["daily", "daily history"], ["contact", "contact"],
                               ["usd", "deposits in dollars"],
                               ["tier", "loyalty tiers"],
                               ["tbfam", "transfer offers by family"], ["tbonus", "transfer offers by player"]]) {
    console.log(`  running the ${label} query`);
    const rows = await sql(fs.readFileSync(path.join(DATA, "queries", file + ".sql"), "utf8"), file);
    fs.writeFileSync(path.join(DATA, file + ".json"), JSON.stringify(rows));
    console.log(`  ${file}.json: ${rows.length} rows`);
  }

  console.log("  running the bonus query");
  const bon = await sql(fs.readFileSync(path.join(DATA, "queries", "bonus.sql"), "utf8"), "bonus");
  fs.writeFileSync(path.join(DATA, "bonus.json"), JSON.stringify(bon));
  console.log(`  bonus.json: ${bon.length} rows`);

  console.log("  running the deposit-size query");
  const dsz = await sql(fs.readFileSync(path.join(DATA, "queries", "depsize.sql"), "utf8"), "depsize");
  fs.writeFileSync(path.join(DATA, "depsize.json"), JSON.stringify(dsz));
  console.log(`  depsize.json: ${dsz.length} rows`);

  /* The VA notebooks. Naniko's tab has no player id at all, only an email, and
     several other tabs have rows where the id was left blank -- so the Sheet10
     tab is read first as an email -> id bridge. It is the same 7-digit id the
     tracker and the warehouse use. */
  console.log("  reading the VA notebooks");
  const emailToId = new Map();
  try {
    for (const row of await sheetCsv("Sheet10")) {
      const id = (row[0] || "").trim(), em = (row[4] || "").trim().toLowerCase();
      if (/^\d{6,9}$/.test(id) && em.includes("@")) emailToId.set(em, Number(id));
    }
    console.log(`    Sheet10: ${emailToId.size} email -> id pairs`);
  } catch (e) { console.log(`    ! Sheet10: ${e.message}`); }
  const notes = await readNotes(emailToId);
  fs.writeFileSync(path.join(DATA, "notes.json"), JSON.stringify(notes));
  const survey = await readSurvey(emailToId);
  fs.writeFileSync(path.join(DATA, "survey.json"), JSON.stringify(survey));
  console.log(`  notes.json: ${notes.length} notes across `
            + `${new Set(notes.map(n => n.player_id)).size} players`);
})().catch(e => { console.error("\n  ** " + e.message); process.exit(1); });
