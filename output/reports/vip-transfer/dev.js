/*
 * Local dev server for the VIP Transfer pages.
 *
 *   node dev.js            ->  http://localhost:8899
 *
 * Serves the built pages from memory, watches their sources, rebuilds on save
 * and reloads the browser. No data is fetched: it reads whatever is already in
 * vip-transfer/data, so it works off the VPN. Run 13-build-vip-transfer.bat
 * when you want fresh numbers.
 *
 *   /login         the real Wayzen sign-in page, same module the Worker uses
 *   /              manager-view   (the one under construction)
 *   /vip-transfer  vip-transfer   (the published page, for comparison)
 *   /admin         add, remove and scope accounts (admins only)
 *   /player/add    a manager attaches a player to their own book
 *   /player/remove and detaches one they added
 *   /logout        drop the session
 *
 * Accounts come from AUTH_USERS in config.env -- the same list the deployed
 * Worker checks -- so signing in here signs you in as that person and the page
 * receives window.__VIEWER exactly as it will in production. ?as=Lizi still
 * works for a quick look without signing in.
 *
 * What triggers what:
 *   <page>-template.html        ->  that page's make script      (fast, ~4s)
 *   build_vip_transfer.py       ->  build + make both pages      (~15s)
 *   data/*.json                 ->  build + make both pages
 *
 * The pages are ~10 MB each, so they are held in memory and served with
 * no-cache headers; a browser that cached one would show yesterday's edit and
 * waste an afternoon.
 */
"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const admin = require("./admin.js");
const rosterAdd = require("./roster_add.js");

const HERE = __dirname;                       // vip-transfer/
const ROOT = path.join(HERE, "..");           // redash-page/
const PORT = Number(process.env.PORT) || 8899;

// python is "python" on this box (see 13-build-vip-transfer.bat), but allow an
// override rather than failing with a confusing ENOENT
const PY = process.env.PYTHON || "python";

const PAGES = [
  { route: "/",             name: "manager-view",
    dir: path.join(ROOT, "manager-view"), make: "make_manager_view.py",
    tpl: "manager-view-template.html",   out: path.join(ROOT, "manager-view.html") },
  { route: "/vip-transfer", name: "vip-transfer",
    dir: HERE,                            make: "make_vip_transfer_html.py",
    tpl: "vip-transfer-template.html",   out: path.join(ROOT, "vip-transfer.html") },
];

/* ---------- accounts, read from the same config.env the Worker publishes ---- */

function loadAccounts() {
  const file = path.join(ROOT, "config.env");
  const out = new Map();
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("AUTH_USERS=")) continue;
    let v = line.slice("AUTH_USERS=".length).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    for (const pair of v.split(",")) {
      const i = pair.indexOf(":");
      if (i > 0) out.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  return out;
}
/* Re-read on every check. The admin page rewrites config.env while the server
   is running, and a cached copy would mean a new account could not sign in
   until a restart -- the exact thing that makes people distrust the tool. */
const accountsNow = () => loadAccounts();

/* Sessions live in memory: restart the server and everyone signs in again,
   which is the right trade for a dev box. Nothing is written to disk. */
const SESSIONS = new Map();          // token -> username
const COOKIE = "wz_dev";
let loginPage = null;                // filled by the dynamic import at the foot

function cookies(req) {
  const out = {};
  for (const c of (req.headers.cookie || "").split(";")) {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  return out;
}
const viewerOf = req => SESSIONS.get(cookies(req)[COOKIE] || "") || "";

/* One-shot messages, held per user across the redirect that follows a POST, so
   a refresh cannot repeat "password is X" after it has been read once. */
const FLASH = new Map(), FLASH_BAD = new Set();
function clearFlash(user) { FLASH.delete(user); FLASH_BAD.delete(user); return {}; }

let building = false, queued = null;
let version = Date.now();
const clients = new Set();

const RELOAD = `
<script>
/* dev only -- injected by dev.js, never present in the published file */
(function(){
  var es = new EventSource('/__reload');
  es.onmessage = function(e){ if(e.data !== String(window.__devVersion)) location.reload(); };
  es.onerror   = function(){ /* server restarting; EventSource retries on its own */ };
})();
</script>`;

function run(cwd, cmd, args, label) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.error) { console.log(`  ! ${label}: ${r.error.message}`); return false; }
  if (r.status !== 0) {
    console.log(`  ! ${label} failed:\n${(r.stderr || r.stdout || "").trim().split("\n").slice(-12).join("\n")}`);
    return false;
  }
  console.log(`  ${label} ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return true;
}

function load(p) {
  try {
    const html = fs.readFileSync(p.out, "utf8");
    p.html = html.replace(/<\/body>/i,
      `<script>window.__devVersion=${version};</script>${RELOAD}</body>`);
    if (p.html === html) p.html = html + `<script>window.__devVersion=${version};</script>` + RELOAD;
    console.log(`  ${p.name}: ${(p.html.length / 1048576).toFixed(1)} MB  ->  http://localhost:${PORT}${p.route}`);
  } catch (e) {
    console.log(`  ! could not read ${p.name}: ${e.message}`);
  }
}

/** full = rerun the data builder; only = rebuild just this one page. */
function build(full, only) {
  if (building) { queued = { full: (queued && queued.full) || full, only: null }; return; }
  building = true;
  const targets = only ? [only] : PAGES;
  console.log(full ? "\nrebuilding (data + pages)" : `\nrebuilding (${targets.map(p => p.name).join(", ")})`);
  let ok = true;
  if (full) ok = run(HERE, PY, ["build_vip_transfer.py"], "build_vip_transfer.py");
  if (ok) {
    version = Date.now();
    for (const p of targets) if (run(p.dir, PY, [p.make], p.make)) load(p);
    for (const res of clients) res.write(`data: ${version}\n\n`);
  }
  building = false;
  const q = queued; queued = null;
  if (q) build(q.full, q.only);
}

// fs.watch fires two or three times for one save on Windows, so coalesce
let timer = null, pendingFull = false, pendingOnly = null, pendingWhat = "";
function touched(full, only, what) {
  pendingFull = pendingFull || full;
  // two different templates saved inside the debounce window: rebuild both
  pendingOnly = pendingOnly && only && pendingOnly !== only ? null : (pendingOnly || only);
  pendingWhat = what;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const f = pendingFull, o = pendingFull ? null : pendingOnly;
    pendingFull = false; pendingOnly = null;
    console.log(`\n${pendingWhat} changed`);
    build(f, o);
  }, 180);
}

build(false, null);

for (const p of PAGES) {
  try { fs.watch(path.join(p.dir, p.tpl), () => touched(false, p, p.tpl)); }
  catch (e) { console.log(`  ! not watching ${p.tpl}: ${e.message}`); }
}
fs.watch(path.join(HERE, "build_vip_transfer.py"), () => touched(true, null, "builder"));
try {
  fs.watch(path.join(HERE, "data"), (_e, f) => { if (f && f.endsWith(".json")) touched(true, null, "data/" + f); });
} catch (e) { /* no data dir yet */ }

function send(res, status, body, extra) {
  res.writeHead(status, Object.assign({ "Content-Type": "text/html; charset=utf-8",
                                        "Cache-Control": "no-store, must-revalidate" }, extra || {}));
  res.end(body);
}

/* The same rule the Worker uses: a "next" that is not a plain path on this site
   is dropped, so a crafted link cannot bounce someone to another host. */
const safeNext = v => (typeof v === "string" && /^\/[^/\\]/.test(v) ? v : "/");

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const url = u.pathname.replace(/\/+$/, "") || "/";

  if (url === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                         "Connection": "keep-alive" });
    res.write(`data: ${version}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url === "/logout") {
    SESSIONS.delete(cookies(req)[COOKIE] || "");
    res.writeHead(302, { Location: "/login",
                         "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    return res.end();
  }

  if (url === "/login") {
    if (!loginPage) return send(res, 503, "login page module still loading");
    if (req.method === "GET") {
      if (viewerOf(req)) { res.writeHead(302, { Location: safeNext(u.searchParams.get("next")) }); return res.end(); }
      return send(res, 200, loginPage({ next: safeNext(u.searchParams.get("next")) }));
    }
    if (req.method !== "POST") return send(res, 405, "Method not allowed");
    let body = "";
    req.on("data", c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      const f = new URLSearchParams(body);
      const user = String(f.get("username") || "").trim();
      const pass = String(f.get("password") || "");
      const next = safeNext(f.get("next"));
      // one message for both cases, so a wrong guess reveals no usernames
      const accounts = accountsNow();
      if (!accounts.has(user) || accounts.get(user) !== pass) {
        return send(res, 401, loginPage({ next, user, error: "Wrong username or password." }));
      }
      const token = crypto.randomBytes(24).toString("hex");
      SESSIONS.set(token, user);
      console.log(`  signed in: ${user}`);
      res.writeHead(302, { Location: next,
                           "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` });
      res.end();
    });
    return;
  }

  const viewer = viewerOf(req);

  if (url === "/admin" || url.startsWith("/admin/")) {
    if (!viewer) {
      res.writeHead(302, { Location: "/login?next=" + encodeURIComponent("/admin") });
      return res.end();
    }
    if (!admin.load(ROOT).admins.has(viewer)) {
      return send(res, 403, `<p style="font:14px system-ui;padding:40px">`
        + `Account admin is limited to the accounts named in ADMIN_USERS. `
        + `<a href="/">Back to the report</a>.</p>`);
    }
    if (req.method === "GET" && url === "/admin") {
      return send(res, 200, admin.page({ root: ROOT, me: viewer, flash: FLASH.get(viewer) || "",
                                         bad: FLASH_BAD.has(viewer) }),
                  clearFlash(viewer));
    }
    if (req.method !== "POST") return send(res, 405, "Method not allowed");
    let body = "";
    req.on("data", c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", () => {
      const f = new URLSearchParams(body);
      const arg = { name: (f.get("name") || "").trim(), password: f.get("password") || "",
                    va: f.get("va") || "", me: viewer };
      const action = url.slice("/admin/".length);
      const fn = { add: admin.add, reset: admin.reset, remove: admin.remove, scope: admin.scope }[action];
      if (!fn) return send(res, 404, "No such action");
      const r = fn(ROOT, arg);
      console.log(`  admin(${viewer}): ${action} ${arg.name}${r.bad ? " — refused" : ""}`);
      FLASH.set(viewer, r.flash || "");
      if (r.bad) FLASH_BAD.add(viewer); else FLASH_BAD.delete(viewer);
      res.writeHead(302, { Location: "/admin" });
      res.end();
    });
    return;
  }

  if (url === "/player/add" || url === "/player/remove") {
    if (!viewer) { res.writeHead(302, { Location: "/login?next=%2F" }); return res.end(); }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", () => {
      const f = new URLSearchParams(body);
      const cfg = admin.load(ROOT);
      const isAdmin = cfg.admins.has(viewer);
      const own = admin.resolveScope(viewer, cfg.scopes, admin.vaNames(ROOT)).va;
      // a manager can only ever act on their own book; an admin names the VA
      const va = isAdmin ? (f.get("va") || own) : own;
      const r = url === "/player/add"
        ? rosterAdd.claim(ROOT, { query: f.get("query"), id: f.get("id"),
                                  username: f.get("username"), va, by: viewer,
                                  casino: f.get("casino"), onboard: f.get("onboard"),
                                  requested: f.get("requested"),
                                  force: isAdmin && f.get("force") === "1" })
        : rosterAdd.unclaim(ROOT, { id: f.get("id"), va, by: viewer, isAdmin });
      console.log(`  roster(${viewer}): ${url.slice(8)} `
                  + `${f.get("username") || f.get("query") || f.get("id")}`
                  + `${r.bad ? " — refused" : ""}`);
      FLASH.set(viewer, r.flash || "");
      if (r.bad) FLASH_BAD.add(viewer); else FLASH_BAD.delete(viewer);
      // the roster file is not watched (it is written, not edited), so ask for
      // the rebuild directly rather than waiting for a file event
      if (r.rebuild) build(true, null);
      res.writeHead(302, { Location: "/" });
      res.end();
    });
    return;
  }

  if (!viewer && !u.searchParams.has("as")) {
    res.writeHead(302, { Location: "/login?next=" + encodeURIComponent(safeNext(req.url)) });
    return res.end();
  }

  const p = PAGES.find(x => x.route.replace(/\/+$/, "") === (url === "/" ? "" : url)) || PAGES[0];
  if (!p.html) return send(res, 503, "still building");
  // stamped per request, the same way the Worker's HTMLRewriter does it
  const cfg = admin.load(ROOT);
  const scope = viewer
    ? admin.resolveScope(viewer, cfg.scopes, admin.vaNames(ROOT)).va
    : "";
  const flash = FLASH.get(viewer) || "";
  const bad = FLASH_BAD.has(viewer);
  clearFlash(viewer);                       // one-shot: a refresh must not repeat it
  const added = rosterAdd.additions(ROOT)
    .filter(r => !scope || r.va === scope)
    .map(r => ({ id: r.player_id, username: r.username, by: r.added_by,
                 at: r.added_at, pending: !!r.pending }));
  send(res, 200, p.html.replace(/<\/head>/i,
    `<script>window.__VIEWER=${JSON.stringify(viewer)};`
    + `window.__VIEWER_SCOPE=${JSON.stringify(scope)};`
    + `window.__IS_ADMIN=${cfg.admins.has(viewer)};`
    // only the dev server can write, so only it offers the write actions
    + `window.__CAN_EDIT=true;`
    + `window.__VAS=${JSON.stringify(admin.vaNames(ROOT))};`
    + `window.__ADDED=${JSON.stringify(added)};`
    + `window.__FLASH=${JSON.stringify(flash)};`
    + `window.__FLASH_BAD=${JSON.stringify(bad)};</script></head>`));
}).listen(PORT, () => {
  console.log(`\n  VIP Transfer dev server\n  http://localhost:${PORT}            manager view (under construction)`);
  console.log(`  http://localhost:${PORT}/vip-transfer   published page`);
  console.log(`  http://localhost:${PORT}/?as=Lizi       quick look, no sign-in`);
  console.log(`  ${accountsNow().size} accounts from config.env \u00b7 /admin to manage \u00b7 /logout to switch user`);
  console.log("  saving a template reloads the page automatically · Ctrl+C to stop\n");
});

// the login page is an ES module shared with the Worker; CommonJS reaches it
// with a dynamic import
import(require("url").pathToFileURL(path.join(ROOT, "worker", "login-page.mjs")).href)
  .then(m => { loginPage = m.loginPage; })
  .catch(e => console.log("  ! could not load the login page module: " + e.message));
