/**
 * list-columns.js — prints every column a Redash query returns.
 *
 *   node list-columns.js            both queries
 *   node list-columns.js 1732       just that one
 *
 * Why this exists: the local caches keep an allowlist of columns, so a newly
 * added column is invisible in them whether or not the query returns it. This
 * asks Redash directly.
 *
 * It runs one cheap day of data, not a whole month, so it is quick and does not
 * disturb the cached results the report uses.
 */

const fs = require("fs");
const path = require("path");

function loadConfig() {
  const out = {};
  const file = path.join(__dirname, "config.env");
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

const CFG = loadConfig();
const HOST = (CFG.REDASH_HOST || "").replace(/\/+$/, "");
const wanted = process.argv[2] ? [process.argv[2]] : ["1732", "1731"];

/* One recent day. Both queries take the same two date parameters. */
const d = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

async function columnsOf(qid) {
  const key = CFG[`REDASH_KEY_${qid}`];
  if (!key) return { qid, error: `no REDASH_KEY_${qid} in config.env` };

  const url = `${HOST}/api/queries/${qid}/results?api_key=${key}`;
  const body = JSON.stringify({
    parameters: { "Start Date": d, "End Date": d, start_date: d, end_date: d },
    max_age: 86400,          // reuse a cached run if Redash has one
  });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(180000),
    });
  } catch (e) {
    return { qid, error: `could not reach ${HOST} — is the VPN up? (${e.message})` };
  }
  if (!res.ok) return { qid, error: `HTTP ${res.status}` };

  let payload = await res.json();

  /* If Redash queued a job, wait for it. Job polling must be query-scoped:
     per-query API keys cannot read /api/jobs/<id>. */
  let job = payload.job;
  for (let i = 0; job && !job.query_result_id && i < 90; i++) {
    if (job.status === 4) return { qid, error: "the query failed in Redash: " + (job.error || "") };
    await new Promise(r => setTimeout(r, 2000));
    const p = await fetch(`${HOST}/api/queries/${qid}/jobs/${job.id}?api_key=${key}`);
    job = (await p.json()).job;
  }
  if (job && job.query_result_id) {
    const r2 = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    payload = await r2.json();
  }

  const qr = payload.query_result;
  if (!qr) return { qid, error: "no result returned" };

  /* Redash reports its own column list; fall back to the keys actually present. */
  let cols = (qr.data && qr.data.columns) || [];
  cols = cols.map(c => (typeof c === "string" ? { name: c, type: "" } : { name: c.name, type: c.type || "" }));
  const rows = (qr.data && qr.data.rows) || [];
  if (!cols.length && rows.length) {
    const seen = new Set();
    for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
    cols = [...seen].map(name => ({ name, type: "" }));
  }

  /* How many of the sampled rows actually carry a value — a column that exists
     but is empty everywhere is easy to mistake for a missing one. */
  const filled = {};
  for (const c of cols) filled[c.name] = 0;
  for (const r of rows) for (const c of cols) {
    const v = r[c.name];
    if (v !== undefined && v !== null && v !== "") filled[c.name]++;
  }
  return { qid, cols, filled, nrows: rows.length, rows };
}

/**
 * Profile one column, to work out how it may safely be aggregated.
 *
 * This query returns sparse rows: a single player-day is spread over several
 * of them (one per game product, another carrying adjusted_ggr, another the
 * deposit). So a value that is repeated on every row of a player-day must NOT
 * be summed — that would multiply it by the number of rows. This reports
 * enough to tell the two cases apart before any code sums anything.
 */
function profile(col, rows) {
  const present = rows.filter(r => r[col] !== undefined && r[col] !== null && r[col] !== "");
  if (!present.length) return { col, n: 0 };

  const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const sumRows = present.reduce((a, r) => a + (num(r[col]) || 0), 0);

  /* Group by player-day and compare summing every row against taking one
     value per group. If those differ, the value repeats and must be de-duped. */
  const byPD = new Map();
  for (const r of present) {
    const k = `${r.transaction_date}|${r.player_id ?? ""}`;
    if (!byPD.has(k)) byPD.set(k, []);
    byPD.get(k).push(num(r[col]) || 0);
  }
  let sumOfFirst = 0, groupsWithVarying = 0;
  for (const vals of byPD.values()) {
    sumOfFirst += vals[0];
    if (vals.some(v => v !== vals[0])) groupsWithVarying++;
  }

  const vals = [...new Set(present.map(r => String(r[col])))];
  const co = {};
  for (const other of ["player_id", "game_product", "bet", "deposit", "sign_up", "ftd", "aff_username"]) {
    co[other] = present.filter(r => r[other] !== undefined && r[other] !== null && r[other] !== "").length;
  }
  return {
    col, n: present.length, sumRows, sumOfFirst,
    groups: byPD.size, groupsWithVarying,
    distinct: vals.length, sample: vals.slice(0, 8), co,
  };
}

(async () => {
  console.log(`\n  Asking Redash what these queries return, for ${d}.\n`);
  for (const qid of wanted) {
    const r = await columnsOf(qid);
    if (r.error) { console.log(`  ${qid}: ${r.error}\n`); continue; }
    console.log(`  Query ${qid} — ${r.cols.length} columns, ${r.nrows.toLocaleString()} sampled rows`);
    for (const c of r.cols) {
      const n = r.filled[c.name] || 0;
      const note = n === 0 ? "   (empty in every sampled row)" : "";
      console.log(`     ${String(n).padStart(7)} filled  ${c.name}${c.type ? "  [" + c.type + "]" : ""}${note}`);
    }
    const hits = r.cols.filter(c => /click|impress|visit|view|session|traffic/i.test(c.name));
    console.log(`\n     click-like columns: ${hits.length ? hits.map(c => c.name).join(", ") : "none"}`);

    for (const c of hits) {
      const p = profile(c.name, r.rows || []);
      console.log(`\n     --- ${p.col} ---`);
      if (!p.n) { console.log("     present in no sampled row"); continue; }
      console.log(`     present on ${p.n.toLocaleString()} rows, across ${p.groups.toLocaleString()} player-days`);
      console.log(`     distinct values: ${p.distinct}   e.g. ${p.sample.join(", ")}`);
      console.log(`     sum over rows        : ${p.sumRows.toLocaleString()}`);
      console.log(`     sum of one per group : ${p.sumOfFirst.toLocaleString()}`);
      console.log(`     player-days where the value varies between rows: ${p.groupsWithVarying}`);
      console.log(`     also carries a value for: ` +
        Object.entries(p.co).filter(([, v]) => v).map(([k, v]) => `${k} (${v})`).join(", ") || "     nothing else");
      const verdict = p.sumRows === p.sumOfFirst
        ? "one row per player-day — safe to SUM directly"
        : p.groupsWithVarying === 0
          ? "REPEATED across a player-day's rows — de-duplicate per player-day, do NOT sum every row"
          : "varies within a player-day — needs a closer look before aggregating";
      console.log(`     => ${verdict}`);
    }
    console.log("");
  }
})();
