/*
 * Account admin for the reports — list, add, reset and remove logins.
 *
 * Accounts live in config.env as AUTH_USERS ("name:password, name2:password2"),
 * which is what publish-worker.js hands to the Worker. This module edits that
 * one line and leaves the rest of the file untouched, so nothing else in the
 * pipeline needs to know the list can change.
 *
 * Two variables, not one:
 *
 *   AUTH_USERS   name:password pairs. The credential check.
 *   AUTH_SCOPES  name:VA full name. Which book that account may see.
 *
 * The scope used to be guessed from the first name ("Lizi" -> "Lizi
 * Utiashvili"). That breaks the moment two VAs share a first name — there are
 * already two Giorgis — so the mapping is now written down. First-name matching
 * survives only as a fallback for accounts created before this existed.
 *
 * Passwords are stored in plain text because that is what the Worker compares
 * against; this module does not make that better or worse. What it does do is
 * generate strong ones by default, so "name123" stops being the house style.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------- config.env */

function configPath(root) { return path.join(root, "config.env"); }

function readVar(root, key) {
  const file = configPath(root);
  if (!fs.existsSync(file)) return "";
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(key + "=")) continue;
    let v = line.slice(key.length + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return "";
}

/**
 * Replace one variable, keeping every other line byte for byte.
 *
 * Written to a temp file and renamed, so an interrupted write cannot leave
 * config.env half-finished — losing that file means losing the Cloudflare token
 * and the session secret as well as the accounts.
 */
function writeVar(root, key, value) {
  const file = configPath(root);
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(key + "=")) { lines[i] = `${key}=${value}`; found = true; break; }
  }
  if (!found) lines.push(`${key}=${value}`);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n"), "utf8");
  fs.renameSync(tmp, file);
}

const parsePairs = raw => {
  const out = new Map();
  for (const pair of String(raw || "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) out.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return out;
};
const formatPairs = map => [...map].map(([k, v]) => `${k}:${v}`).join(", ");

/* -------------------------------------------------------------------- model */

function load(root) {
  const accounts = parsePairs(readVar(root, "AUTH_USERS"));
  const scopes   = parsePairs(readVar(root, "AUTH_SCOPES"));
  const admins   = new Set(String(readVar(root, "ADMIN_USERS") || "Davit")
                             .split(",").map(s => s.trim()).filter(Boolean));
  return { accounts, scopes, admins };
}

/** VA names as the reports know them, for the scope picker. */
function vaNames(root) {
  try {
    const roster = JSON.parse(fs.readFileSync(
      path.join(root, "vip-transfer", "data", "roster.json"), "utf8"));
    return [...new Set(roster.map(r => r.va).filter(Boolean))].sort();
  } catch { return []; }
}

/** What a given account will actually see. Explicit scope wins; else the old
 *  first-name guess; else the whole book. */
function resolveScope(name, scopes, vas) {
  if (scopes.has(name)) return { va: scopes.get(name), how: "set" };
  const first = String(name).toLowerCase().split(/[\s_]+/)[0];
  const hit = vas.filter(v => v.toLowerCase().split(/\s+/)[0] === first);
  if (hit.length === 1) return { va: hit[0], how: "guessed" };
  if (hit.length > 1)  return { va: "", how: "ambiguous" };
  return { va: "", how: "full" };
}

/** Readable but not guessable: no name, no year, no ambiguous glyphs. */
function makePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ346789";
  const bytes = crypto.randomBytes(14);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join("");
}

/* --------------------------------------------------------------------- page */

const STYLE = `
:root{color-scheme:light dark;
  --bg:#f4f8f5;--panel:#fff;--ink:#12211a;--muted:#5a6f63;--line:#dce8e0;--accent:#1f6f4a;--neg:#b3352c}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e1512;--panel:#141d18;--ink:#e4efe8;--muted:#8fa79a;--line:#213029;--accent:#5fc99a;--neg:#e0685c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:22px;margin:0 0 4px;color:var(--accent)}
h2{font-size:15px;margin:30px 0 10px;color:var(--accent)}
p.note{color:var(--muted);margin:0 0 18px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 8px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
thead th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--accent)}
td.mut,span.mut{color:var(--muted)}
form.inline{display:inline}
input,select{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:7px;
  background:var(--bg);color:var(--ink);min-width:180px}
button{font:inherit;padding:7px 13px;border:0;border-radius:7px;background:var(--accent);color:#fff;cursor:pointer}
button.link{background:none;color:var(--muted);padding:4px 6px;text-decoration:underline}
button.link:hover{color:var(--neg)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px}
.flash{border:1px solid var(--accent);border-radius:9px;padding:12px 14px;margin:0 0 18px;background:var(--panel)}
.flash.bad{border-color:var(--neg)}
code.pw{font:13px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--bg);
  border:1px solid var(--line);border-radius:6px;padding:3px 7px}
.pill{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
a{color:var(--accent)}`;

function page({ root, me, flash = "", bad = false }) {
  const { accounts, scopes, admins } = load(root);
  const vas = vaNames(root);
  const rows = [...accounts.keys()].sort((a, b) => a.localeCompare(b)).map(name => {
    const s = resolveScope(name, scopes, vas);
    const sees = s.va
      ? `${esc(s.va)}${s.how === "guessed" ? ' <span class="pill">guessed from the name</span>' : ""}`
      : (s.how === "ambiguous"
          ? '<span class="mut">nothing — the first name matches two VAs</span>'
          : '<span class="mut">everything</span>');
    return `<tr>
      <td><b>${esc(name)}</b>${admins.has(name) ? ' <span class="pill">admin</span>' : ""}</td>
      <td>${sees}</td>
      <td>
        <form class="inline" method="post" action="/admin/scope">
          <input type="hidden" name="name" value="${esc(name)}">
          <select name="va" onchange="this.form.submit()" style="min-width:210px">
            <option value="">— full book —</option>
            ${vas.map(v => `<option value="${esc(v)}"${s.va === v && s.how === "set" ? " selected" : ""}>${esc(v)}</option>`).join("")}
          </select>
        </form>
      </td>
      <td style="text-align:right">
        <form class="inline" method="post" action="/admin/reset"
              onsubmit="return confirm('Give ${esc(name)} a new password?')">
          <input type="hidden" name="name" value="${esc(name)}">
          <button class="link">new password</button>
        </form>
        <form class="inline" method="post" action="/admin/remove"
              onsubmit="return confirm('Remove ${esc(name)}? They will not be able to sign in.')">
          <input type="hidden" name="name" value="${esc(name)}">
          <button class="link"${name === me ? " disabled title='You cannot remove your own account'" : ""}>remove</button>
        </form>
      </td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Accounts</title><style>${STYLE}</style></head><body>
<div class="wrap">
  <h1>Accounts</h1>
  <p class="note">Signed in as <b>${esc(me)}</b> ·
     <a href="/">back to the report</a> · <a href="/logout">sign out</a></p>
  ${flash ? `<div class="flash${bad ? " bad" : ""}">${flash}</div>` : ""}

  <div class="panel">
    <table>
      <thead><tr><th>Account</th><th>Sees</th><th>Change what they see</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <h2>Add someone</h2>
  <div class="panel">
    <form method="post" action="/admin/add">
      <div class="row">
        <input name="name" placeholder="Username" autocomplete="off" required>
        <select name="va" style="min-width:230px">
          <option value="">— full book, every VA —</option>
          ${vas.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}
        </select>
        <input name="password" placeholder="Password (leave blank to generate)" autocomplete="off">
        <button>Add</button>
      </div>
    </form>
    <p class="note" style="margin:14px 0 0">
      Leave the password blank and a strong one is generated and shown here once.
      Changes reach the live site on the next <b>6-publish.bat</b>; they work on
      this dev server straight away.
    </p>
  </div>
</div></body></html>`;
}

/* ------------------------------------------------------------------ actions */

function add(root, { name, password, va }) {
  name = String(name || "").trim();
  if (!name) return { bad: true, flash: "A username is needed." };
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(name)) {
    return { bad: true, flash: "Usernames can use letters, digits, dot, dash and underscore, 2–32 characters." };
  }
  // the list is comma and colon separated, so neither can appear in a value
  if (/[,:]/.test(password || "")) return { bad: true, flash: "A password cannot contain a comma or a colon." };

  const { accounts, scopes } = load(root);
  if (accounts.has(name)) return { bad: true, flash: `<b>${esc(name)}</b> already exists.` };

  const pw = String(password || "").trim() || makePassword();
  accounts.set(name, pw);
  writeVar(root, "AUTH_USERS", formatPairs(accounts));
  if (va) { scopes.set(name, String(va)); writeVar(root, "AUTH_SCOPES", formatPairs(scopes)); }

  return { flash: `Added <b>${esc(name)}</b> — password <code class="pw">${esc(pw)}</code>` +
                  `<br><span class="mut">Shown once. Send it to them now; it is not displayed again.</span>` };
}

function reset(root, { name }) {
  const { accounts } = load(root);
  if (!accounts.has(name)) return { bad: true, flash: "No such account." };
  const pw = makePassword();
  accounts.set(name, pw);
  writeVar(root, "AUTH_USERS", formatPairs(accounts));
  return { flash: `New password for <b>${esc(name)}</b> — <code class="pw">${esc(pw)}</code>` +
                  `<br><span class="mut">Their old one stops working on the next publish.</span>` };
}

function remove(root, { name, me }) {
  if (name === me) return { bad: true, flash: "You cannot remove the account you are signed in with." };
  const { accounts, scopes } = load(root);
  if (!accounts.delete(name)) return { bad: true, flash: "No such account." };
  writeVar(root, "AUTH_USERS", formatPairs(accounts));
  if (scopes.delete(name)) writeVar(root, "AUTH_SCOPES", formatPairs(scopes));
  return { flash: `Removed <b>${esc(name)}</b>.` };
}

function scope(root, { name, va }) {
  const { accounts, scopes } = load(root);
  if (!accounts.has(name)) return { bad: true, flash: "No such account." };
  if (va) scopes.set(name, String(va)); else scopes.delete(name);
  writeVar(root, "AUTH_SCOPES", formatPairs(scopes));
  return { flash: va ? `<b>${esc(name)}</b> now sees <b>${esc(va)}</b>'s players only.`
                     : `<b>${esc(name)}</b> now sees the full book.` };
}

module.exports = { page, add, reset, remove, scope, load, vaNames, resolveScope, makePassword, esc };
