"use strict";
/**
 * data-exclusions.js — the one place that decides whether a cached row is real.
 *
 *   const { reasonToDrop, filterRows } = require("./data-exclusions");
 *
 * The rules themselves live in data-exclusions.json; this only applies them.
 * Both the cache writers and scrub-data.js use it, so a row cannot be judged
 * one way on the way into the cache and another way on the way out.
 *
 * A missing or unreadable rules file is not fatal — nothing is dropped, and
 * the caller is told once. Failing a nightly build over a config file would
 * be a worse outcome than one more run carrying a row somebody wanted gone.
 */

const fs = require("fs");
const path = require("path");

let RULES = { row_ceiling: Infinity, ceiling_fields: [], players: [] };
let PROBLEM = null;
try {
  RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "data-exclusions.json"), "utf8"));
} catch (e) {
  PROBLEM = e.message;
}

const CEILING = Number(RULES.row_ceiling) || Infinity;
const CEIL_FIELDS = RULES.ceiling_fields || [];
/* player_id, never username: ids here have changed username mid-year, and a
   name-based rule stops matching silently the day one does. */
const IDS = new Set((RULES.players || []).map(p => String(p.player_id).trim()).filter(Boolean));

/** Why this row should not reach a report, or null to keep it. */
function reasonToDrop(row) {
  if (!row || typeof row !== "object") return null;
  const id = row.player_id !== undefined ? String(row.player_id).trim() : "";
  if (id && IDS.has(id)) return "excluded player " + id;
  for (const k of CEIL_FIELDS) {
    const raw = row[k];
    if (raw === undefined || raw === null || raw === "") continue;
    const v = Math.abs(Number(raw));
    /* NaN is not over the ceiling and is not this rule's problem — a builder's
       num() maps it to zero. Only a real number above the ceiling counts. */
    if (v > CEILING) return `${k} = ${Math.round(v).toLocaleString()}`;
  }
  return null;
}

/**
 * Drops what should not be there and says what went.
 * Returns { rows, dropped } — dropped carries a _why on each row.
 */
function filterRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return { rows: rows || [], dropped: [] };
  const kept = [], dropped = [];
  for (const r of rows) {
    const why = reasonToDrop(r);
    if (why) dropped.push(Object.assign({}, r, { _why: why }));
    else kept.push(r);
  }
  return { rows: kept, dropped };
}

/* ------------------------------------------------------------- carve-outs */

/* Players every report holds out of its DEFAULT view, with a toggle to put
   them back — a different thing from `players` above, which are removed from
   the caches entirely. Carving out never deletes: both views are built.
   The Python builders read the same list through carveout.py. */
const CARVE = RULES.carve_out || [];
const CARVED = new Set(CARVE.map(p => String(p.player_id).trim()).filter(Boolean));
const CARVE_NAMES = {};
for (const p of CARVE) {
  const id = String(p.player_id || "").trim();
  if (id) CARVE_NAMES[id] = (p.username || "").trim();
}
/* One name reads as a name; several read as a list. A page should say which
   players it is holding out rather than leaving "ex-whale" to mean something
   it no longer means. */
const CARVE_LABEL = Object.keys(CARVE_NAMES).sort()
  .map(id => CARVE_NAMES[id]).filter(Boolean).join(" + ") || "nobody";

const carved = pid => CARVED.has(String(pid));

module.exports = { rules: RULES, problem: PROBLEM, CEILING, CEIL_FIELDS,
                   reasonToDrop, filterRows,
                   CARVED, CARVE_NAMES, CARVE_LABEL, carved };
