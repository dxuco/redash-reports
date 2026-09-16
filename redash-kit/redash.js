/**
 * redash.js — a small reusable client for this Redash instance.
 *
 * Extracted so new projects don't have to rediscover the awkward parts:
 *
 *   1. A per-query API key cannot poll /api/jobs/<id>. The job endpoint has to
 *      be the query-scoped one, /api/queries/<id>/jobs/<job_id>.
 *   2. A per-query API key cannot GET a query_result by id at all. To collect a
 *      finished run you re-POST the same parameters with a cache window, and
 *      Redash returns the rows inline.
 *   3. Query 1731 filters by whole month, so asking it for part of a month
 *      returns the entire month. Only 1732 can answer day-level questions.
 *
 * Usage:
 *   const { runQuery, loadConfig } = require("./redash");
 *   const rows = await runQuery({ queryId: 1732, apiKey: "...",
 *     parameters: { date_range: { start: "2026-08-01", end: "2026-08-31" },
 *                   "Current Segment": "All" } });
 */

const fs = require("fs");
const path = require("path");

function loadConfig(dir = __dirname) {
  const file = path.join(dir, "config.env");
  const out = {};
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

const CACHE_WINDOW = 900;      // seconds a just-computed result stays acceptable
let JOB_PATH_STYLE = null;     // remembered between calls

async function waitForJob({ host, queryId, key, jobId, label, timeoutMs, onTick }) {
  const deadline = Date.now() + timeoutMs;
  const styles = JOB_PATH_STYLE ? [JOB_PATH_STYLE] : ["scoped", "global"];

  while (Date.now() < deadline) {
    await new Promise(s => setTimeout(s, 2000));

    let job = null, lastStatus = null, lastBody = "";
    for (const style of styles) {
      const url = style === "scoped"
        ? `${host}/api/queries/${queryId}/jobs/${jobId}?api_key=${key}`
        : `${host}/api/jobs/${jobId}?api_key=${key}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) { const b = await res.json(); job = b.job || b; JOB_PATH_STYLE = style; break; }
      lastStatus = res.status;
      lastBody = (await res.text()).slice(0, 200);
    }
    if (!job) throw new Error(`${label}: job poll failed ${lastStatus} — ${lastBody}`);

    if (job.status === 3) return job.query_result_id;
    if (job.status === 4) throw new Error(`${label}: query failed — ${job.error}`);
    if (onTick) onTick();
  }
  throw new Error(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`);
}

/**
 * Runs a query and returns { rows, columns }.
 * columns preserves Redash's own order, which matters for CSV output.
 */
async function runQuery({ queryId, apiKey, parameters = {}, host, timeoutMs = 600000, label, onTick }) {
  const cfg = loadConfig();
  host = (host || cfg.REDASH_HOST || "").replace(/\/+$/, "");
  if (!host) throw new Error("No REDASH_HOST configured.");
  if (!apiKey) throw new Error(`No API key given for query ${queryId}.`);

  label = label || `query ${queryId}`;
  const key = encodeURIComponent(apiKey);
  const url = `${host}/api/queries/${queryId}/results?api_key=${key}`;

  const post = async maxAge => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ id: queryId, max_age: maxAge, parameters }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${label}: POST failed ${res.status} — ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { throw new Error(`${label}: unparseable response`); }
  };

  const shape = qr => ({
    rows: (qr.data && qr.data.rows) || [],
    columns: ((qr.data && qr.data.columns) || []).map(c => c.name),
  });

  let payload = await post(0);                     // force a fresh run
  if (payload.query_result) return shape(payload.query_result);
  if (!payload.job) throw new Error(`${label}: no job in response`);
  await waitForJob({ host, queryId, key, jobId: payload.job.id, label, timeoutMs, onTick });

  for (let attempt = 1; attempt <= 3; attempt++) {
    payload = await post(CACHE_WINDOW);            // collect it
    if (payload.query_result) return shape(payload.query_result);
    if (payload.job) { await waitForJob({ host, queryId, key, jobId: payload.job.id, label, timeoutMs, onTick }); continue; }
    throw new Error(`${label}: unexpected result shape`);
  }
  throw new Error(`${label}: could not collect results`);
}

/** Rows of objects -> CSV text, using Redash's column order. */
function toCsv(rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {});
  const cell = v => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.map(cell).join(",")];
  for (const r of rows) lines.push(cols.map(c => cell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

module.exports = { runQuery, toCsv, loadConfig };
