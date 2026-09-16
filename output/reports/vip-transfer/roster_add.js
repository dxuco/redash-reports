/*
 * Players a manager adds to their own book from the report page.
 *
 * The roster normally comes from the Google Sheet: fetch_vip.js overwrites
 * data/roster.json on every refresh. So additions made here cannot live in that
 * file — they would be wiped the next morning. They go in
 *
 *     data/roster-additions.json
 *
 * which the sheet never touches and build_vip_transfer.py merges on top of the
 * sheet roster. When the sheet catches up and lists the same player, the two
 * agree and nothing changes; the addition simply stops mattering.
 *
 * A player the warehouse already knows asked to transfer joins the tables
 * immediately. One it does not is still recorded, marked `pending`, and kept out
 * of the tables until a refresh finds their request — every figure here is
 * measured from a request date that only public.loyalty_transfer_request can
 * supply, and inventing one would stand made-up numbers beside real ones.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dataDir = root => path.join(root, "vip-transfer", "data");
const file = root => path.join(dataDir(root), "roster-additions.json");

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function additions(root) { return readJSON(file(root), []); }

/** Written temp-then-rename: a half-written file would break the next build. */
function save(root, rows) {
  const p = file(root), tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 1), "utf8");
  fs.renameSync(tmp, p);
}

const cohort = root => readJSON(path.join(dataDir(root), "cohort.json"), []);
const roster = root => readJSON(path.join(dataDir(root), "roster.json"), []);

/** Everything the page knows about who owns whom: sheet first, additions over it. */
function assignments(root) {
  const out = new Map();
  for (const r of roster(root)) out.set(Number(r.player_id), { ...r, from: "sheet" });
  for (const r of additions(root)) out.set(Number(r.player_id), { ...r, from: "added" });
  return out;
}

/** Accepts a player id or an exact username, case-insensitively. */
function find(root, query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const rows = cohort(root);
  if (/^\d+$/.test(q)) return rows.find(r => Number(r.player_id) === Number(q)) || null;
  const lower = q.toLowerCase();
  return rows.find(r => String(r.username || "").toLowerCase() === lower) || null;
}

/** Same query, but looser — used only to explain a miss. */
function suggest(root, query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 3) return [];
  return cohort(root)
    .filter(r => String(r.username || "").toLowerCase().includes(q))
    .slice(0, 5)
    .map(r => ({ id: r.player_id, username: r.username }));
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Attach a player to a VA's book.
 *
 * `by` is the account doing it and `va` the book it lands in — for a manager
 * those are their own; an admin can name any VA. Reassigning someone who
 * already belongs to another VA is refused rather than silently done: two
 * managers each thinking a player is theirs is worse than a rejected form.
 *
 * A player the warehouse has never seen ask to transfer is still recorded, and
 * marked `pending`. They cannot appear in the tables — every figure on this page
 * is measured from a request date that only public.loyalty_transfer_request can
 * supply, and inventing one would put made-up numbers next to real ones. They
 * are listed separately instead, and join the report on the first refresh that
 * finds their request.
 */
function claim(root, { query, id, username, va, by, casino = "", onboard = "", requested = "", force = false }) {
  if (!va) return { bad: true, flash: "No VA to add them to. An admin has to pick one." };

  const wanted = String(id || query || username || "").trim();
  if (!wanted) return { bad: true, flash: "A username or player ID is needed." };
  if (id && !/^\d+$/.test(String(id).trim())) {
    return { bad: true, flash: "A player ID is all digits." };
  }

  const player = find(root, id || query || username);
  const key = player ? Number(player.player_id) : (/^\d+$/.test(wanted) ? Number(wanted) : 0);
  if (!player && !key) {
    return { bad: true, flash:
      `<b>${esc(wanted)}</b> is not a transfer requester the warehouse knows about, and no `
      + `player ID was given. Add the ID and they can be recorded now and picked up on the `
      + `next refresh.` };
  }

  const owned = assignments(root).get(key);
  if (owned && owned.va && owned.va !== va && !force) {
    return { bad: true, flash:
      `<b>${esc(player ? player.username : wanted)}</b> is already on <b>${esc(owned.va)}</b>'s book`
      + `${owned.from === "sheet" ? " (from the tracker sheet)" : ""}. `
      + `Ask an admin if that is wrong.` };
  }
  if (owned && owned.va === va) {
    return { bad: true, flash: `<b>${esc(player ? player.username : wanted)}</b> is already on your book.` };
  }

  const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const rows = additions(root).filter(r => Number(r.player_id) !== key);
  const row = {
    player_id: key,
    username: (player && player.username) || String(username || query || "").trim(),
    va,
    // no date given means today: they are being onboarded now
    onboard: day(onboard) || new Date().toISOString().slice(0, 10),
    casino: String(casino || "").trim(),
    // only kept for players the warehouse cannot date yet; once it can, its own
    // request date is the one that counts
    requested: day(requested),
    pending: !player,
    added_by: by,
    added_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  };
  rows.push(row);
  save(root, rows);

  return player
    ? { flash: `Added <b>${esc(row.username)}</b> (${key}) to <b>${esc(va)}</b>'s book. `
             + `The page is rebuilding.`, rebuild: true }
    : { flash: `Recorded <b>${esc(row.username || key)}</b> (${key}) for <b>${esc(va)}</b>. `
             + `<span class="mut">The warehouse has no transfer request for them yet, so they `
             + `cannot be measured — they will join the tables on the first refresh that finds `
             + `one.</span>`, rebuild: true };
}

/** Only additions can be dropped here; sheet rows belong to the sheet. */
function unclaim(root, { id, va, by, isAdmin = false }) {
  const rows = additions(root);
  const row = rows.find(r => Number(r.player_id) === Number(id));
  if (!row) {
    return { bad: true, flash: "That player was not added here — they come from the "
                             + "tracker sheet, so they have to be changed there." };
  }
  if (!isAdmin && row.va !== va) return { bad: true, flash: "That player is not on your book." };
  save(root, rows.filter(r => Number(r.player_id) !== Number(id)));
  return { flash: `Removed <b>${esc(row.username || row.player_id)}</b> from `
                + `<b>${esc(row.va)}</b>'s book.`, rebuild: true };
}

module.exports = { claim, unclaim, additions, assignments, find, suggest, esc };
