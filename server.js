/**
 * server.js — serves the Bonus Cost report and keeps its data fresh.
 *
 *   node server.js
 *
 * Serves report.html at / and runs build.js on a nightly schedule.
 * No API keys are handled here — build.js is the only thing that talks to
 * Redash, and it writes data.json which this server just hands out.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

/* ---------- config ---------- */

function loadConfig() {
  const file = path.join(__dirname, "config.env");
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
const FILE_CFG = loadConfig();
const cfg = (k, d = "") => process.env[k] ?? FILE_CFG[k] ?? d;

const PORT = Number(cfg("PORT", 8080));
const BUILD_HOUR = Number(cfg("BUILD_HOUR", 7));          // local hour, 0-23
const BUILD_MINUTE = Number(cfg("BUILD_MINUTE", 0));      // local minute, 0-59
const BUILD_ON_START = cfg("BUILD_ON_START", "if-missing"); // always | never | if-missing

/* Listening only on loopback by default. A tunnel connects from this machine,
   so it still works, while nothing on the local network can reach the port. */
const BIND = cfg("BIND", "127.0.0.1");
/* Accounts come from AUTH_USERS ("name:password, name2:password2") and/or the
   single AUTH_USER / AUTH_PASSWORD pair. Separate logins per person means you
   can revoke one without disturbing anyone else, and the log shows who looked. */
const ACCOUNTS = new Map();
for (const entry of cfg("AUTH_USERS", "").split(",")) {
  const pair = entry.trim();
  if (!pair) continue;
  const i = pair.indexOf(":");
  if (i < 1) continue;
  const name = pair.slice(0, i).trim();
  const pass = pair.slice(i + 1).trim();
  if (name && pass) ACCOUNTS.set(name, pass);
}
const AUTH_USER = cfg("AUTH_USER", "");
const AUTH_PASSWORD = cfg("AUTH_PASSWORD", "");
if (AUTH_USER && AUTH_PASSWORD) ACCOUNTS.set(AUTH_USER, AUTH_PASSWORD);

const AUTH_ON = ACCOUNTS.size > 0;

/* Constant-time compare, so a wrong password can't be guessed by timing. */
function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

const failures = new Map();   // ip -> {count, until}

/* Behind a tunnel every request arrives from 127.0.0.1, so the real client
   address has to come from the proxy's header or throttling punishes everyone
   at once. */
function clientIp(req) {
  return req.headers["cf-connecting-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress || "?";
}

/* A request with no Authorization header is not a failed attempt — it is how
   every Basic Auth conversation starts. Only a *wrong* credential counts. */
function attemptedCredentials(req) {
  return (req.headers.authorization || "").startsWith("Basic ");
}

/* Returns the account name on success, null on failure. */
function authorised(req) {
  if (!AUTH_ON) return "anonymous";

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return null;

  let user = "", pass = "";
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    user = decoded.slice(0, i);
    pass = decoded.slice(i + 1);
  } catch { return null; }

  const expected = ACCOUNTS.get(user);
  if (expected === undefined) return null;
  return sameString(pass, expected) ? user : null;
}

const MAX_BAD_PASSWORDS = 20;

function throttled(ip) {
  const f = failures.get(ip);
  return !!(f && f.count >= MAX_BAD_PASSWORDS && Date.now() < f.until);
}

function noteFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= MAX_BAD_PASSWORDS) f.until = Date.now() + 60_000;
  failures.set(ip, f);
}

const DATA = path.join(__dirname, "data.json");
const SECRET_FILES = new Set(["config.env", "build.js", "server.js", "bonus-groups.json"]);

/* ---------- build runner ---------- */

let building = false;
let lastBuild = null;
let lastError = null;

/* Redash is only reachable over the VPN. If that is down at 08:00 the build
   fails through no fault of the data, so retry for a few hours rather than
   silently serving yesterday's numbers all day. */
const RETRY_EVERY_MS = Number(cfg("RETRY_EVERY_MINUTES", 30)) * 60_000;
const RETRY_LIMIT = Number(cfg("RETRY_ATTEMPTS", 8));
let retriesLeft = 0;

function runBuild(reason) {
  if (building) { console.log("  build already running, skipping"); return; }
  building = true;
  const started = new Date();
  console.log(`\n[${started.toLocaleString()}] build started (${reason})`);

  const child = spawn(process.execPath, [path.join(__dirname, "build.js")], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", d => process.stdout.write("  " + d.toString().replace(/\n(?!$)/g, "\n  ")));
  child.stderr.on("data", d => process.stderr.write("  " + d.toString()));

  child.on("close", code => {
    building = false;
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    if (code === 0) {
      lastBuild = new Date();
      lastError = null;
      retriesLeft = 0;
      console.log(`[${lastBuild.toLocaleString()}] build finished in ${mins} min`);
    } else {
      lastError = `build.js exited with code ${code}`;
      console.error(`[${new Date().toLocaleString()}] BUILD FAILED after ${mins} min — the site keeps serving the previous copy`);

      if (retriesLeft > 0) {
        retriesLeft--;
        const at = new Date(Date.now() + RETRY_EVERY_MS);
        console.error(`  Most likely the VPN was down. Retrying at ${at.toLocaleTimeString()}` +
          ` (${retriesLeft} attempt${retriesLeft === 1 ? "" : "s"} left after that).`);
        setTimeout(() => runBuild("retry after failure"), RETRY_EVERY_MS);
      } else {
        console.error("  Out of retries. Check the VPN, then run 3-build-everything.bat by hand.");
      }
    }
  });
}

function msUntilNextBuild() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(BUILD_HOUR, BUILD_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleBuilds() {
  const wait = msUntilNextBuild();
  const at = new Date(Date.now() + wait);
  console.log(`  Next rebuild: ${at.toLocaleString()}`);
  setTimeout(() => {
    retriesLeft = RETRY_LIMIT;   // fresh allowance for today
    runBuild("scheduled");
    scheduleBuilds();
  }, wait);
}

/* ---------- static serving ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serve(res, urlPath) {
  const rel = urlPath === "/" ? "report.html" : urlPath.replace(/^\/+/, "");
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const base = path.basename(safe).toLowerCase();

  if (SECRET_FILES.has(base)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  const full = path.join(__dirname, safe);
  fs.readFile(full, (err, buf) => {
    if (err) {
      if (base === "data.json") {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "data.json has not been built yet. Run: node build.js" }));
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Cache-Control": base === "data.json" ? "no-store" : "no-cache",
    });
    res.end(buf);
  });
}

/* ---------- server ---------- */

http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    return res.end("Method not allowed");
  }

  const ip = clientIp(req);

  if (throttled(ip)) {
    res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
    return res.end("Too many wrong passwords. Wait a minute.");
  }

  const account = authorised(req);

  if (!account) {
    // Only a wrong password counts against the limit; an empty first request
    // is just the browser asking what kind of login is needed.
    if (attemptedCredentials(req)) {
      noteFailure(ip);
      console.log(`  [${new Date().toLocaleTimeString()}] WRONG PASSWORD from ${ip} ${req.url}`);
    }
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Bonus Cost Report", charset="UTF-8"',
      "Content-Type": "text/plain",
    });
    return res.end("Authentication required");
  }
  failures.delete(ip);

  const url = new URL(req.url, `http://${req.headers.host}`);

  /* Log page opens only, so the window shows who is looking without drowning
     in one line per asset. This data is player-level; knowing that is useful. */
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    console.log(`  [${new Date().toLocaleTimeString()}] ${account} opened ${url.pathname} from ${ip}`);
  }

  if (url.pathname === "/status") {
    const exists = fs.existsSync(DATA);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      building,
      dataExists: exists,
      dataModified: exists ? fs.statSync(DATA).mtime : null,
      lastBuild, lastError,
      nextBuild: new Date(Date.now() + msUntilNextBuild()),
    }, null, 1));
  }

  serve(res, url.pathname);

}).listen(PORT, BIND, () => {
  console.log("");
  console.log("  Bonus Cost report");
  console.log("");
  console.log("      http://localhost:" + PORT);
  console.log("");
  if (AUTH_ON) {
    console.log(`  Login required — ${ACCOUNTS.size} account(s): ${[...ACCOUNTS.keys()].join(", ")}`);
  } else {
    console.log("  NO PASSWORD SET. Anyone who reaches this port sees the report.");
    console.log("  Set AUTH_USER and AUTH_PASSWORD in config.env before exposing it.");
  }
  console.log(`  Listening on ${BIND}${BIND === "127.0.0.1" ? " (this machine only — a tunnel can still reach it)" : " (reachable from the network)"}`);
  console.log("");
  if (!fs.existsSync(DATA)) {
    console.log("  data.json not found yet.");
  } else {
    console.log(`  data.json last written ${fs.statSync(DATA).mtime.toLocaleString()}`);
  }
  console.log(`  Rebuild at: ${String(BUILD_HOUR).padStart(2, "0")}:${String(BUILD_MINUTE).padStart(2, "0")} daily`);
  scheduleBuilds();

  const need = BUILD_ON_START === "always" || (BUILD_ON_START === "if-missing" && !fs.existsSync(DATA));
  if (need) {
    /* Starting up is when the VPN is least likely to be connected yet, so this
       build gets the same retry allowance as the scheduled one. */
    retriesLeft = RETRY_LIMIT;
    runBuild(BUILD_ON_START === "always" ? "startup" : "data.json missing");
  }

  console.log("\n  Keep this window open. Closing it stops the page.\n");
});
