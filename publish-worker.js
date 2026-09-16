/**
 * publish-worker.js — publishes the report as a Cloudflare Worker.
 *
 *   node publish-worker.js
 *
 * Why a Worker rather than Pages: the Worker checks the password itself, so it
 * needs no Cloudflare Access and therefore no Zero Trust onboarding and no card
 * on file. Free tier, permanent address, page stays up when this machine is off.
 *
 * Reads CF_API_TOKEN / CF_ACCOUNT_ID / CF_PROJECT / AUTH_USERS from config.env.
 * The token and passwords are never printed.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

const CFG = loadConfig();
const cfg = (k, d = "") => process.env[k] ?? CFG[k] ?? d;

const TOKEN = cfg("CF_API_TOKEN");
const ACCOUNT = cfg("CF_ACCOUNT_ID");
const NAME = cfg("CF_PROJECT", "bonus-reports");
const ACCOUNTS = cfg("AUTH_USERS");
const API = "https://api.cloudflare.com/client/v4";

/**
 * The key the session cookie is signed with.
 *
 * It has to survive deploys — regenerate it each publish and every open browser
 * is silently signed out on the next daily run, which reads as the site being
 * broken. So it is written into config.env once, the first time, and read from
 * there afterwards.
 */
function sessionSecret() {
  const existing = cfg("AUTH_SECRET");
  if (existing) return existing;

  const secret = require("crypto").randomBytes(32).toString("hex");
  const file = path.join(__dirname, "config.env");
  const note = [
    "",
    "# Signs the login session cookie. Generated once, automatically.",
    "# Changing it signs everyone out; that is the only thing it does, so it is",
    "# a safe way to force that if a laptop goes missing. Keep it out of git,",
    "# like everything else in this file.",
    `AUTH_SECRET=${secret}`,
    "",
  ].join("\n");
  fs.appendFileSync(file, note);
  log("  Generated a session signing key and saved it to config.env");
  return secret;
}

/**
 * The Cloudflare KV namespace backing the pivot report's saved layouts
 * (worker/worker.js binds it as PIVOT_LAYOUTS). A namespace has to exist
 * before `wrangler deploy` can bind a Worker to it, so it is created once,
 * automatically, the same way the session secret above is: written into
 * config.env the first time this runs with none set, read from there on
 * every run after that.
 *
 * Deleting the PIVOT_KV_ID line does not delete the namespace in
 * Cloudflare — it just makes the next publish create a second one and start
 * writing to that instead, orphaning whatever was saved under the old id.
 */
async function ensureKvNamespace() {
  const existing = cfg("PIVOT_KV_ID");
  if (existing) return existing;

  log("  No PIVOT_KV_ID yet — creating the KV namespace for saved layouts...");
  let res;
  try {
    res = await fetch(`${API}/accounts/${ACCOUNT}/storage/kv/namespaces`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: `${NAME}-pivot-layouts` }),
    });
  } catch (e) {
    die("Could not reach api.cloudflare.com to create the KV namespace.\n  (" + e.message + ")");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    const messages = (body.errors || []).map(e => e.message).join("; ");
    die("Could not create the KV namespace for saved layouts.\n" +
      "  " + (messages || `HTTP ${res.status}`) + "\n" +
      "  The token needs:  Account | Workers KV Storage | Edit\n" +
      "  (in addition to the Workers Scripts permission it already has)");
  }

  const id = body.result.id;
  const file = path.join(__dirname, "config.env");
  const note = [
    "",
    "# The Cloudflare KV namespace backing the pivot report's saved layouts.",
    "# Created once, automatically, the first time this script ran with none",
    "# set. Deleting this line does not delete the namespace in Cloudflare --",
    "# it just makes the next publish create a second one and start writing",
    "# to that instead, orphaning whatever was saved under the old id.",
    `PIVOT_KV_ID=${id}`,
    "",
  ].join("\n");
  fs.appendFileSync(file, note);
  log("  Created the KV namespace and saved its id to config.env");
  return id;
}

const log = (...a) => console.log(...a);
const die = msg => { console.error("\n  " + msg + "\n"); process.exit(1); };

async function cf(pathname) {
  try {
    const res = await fetch(API + pathname, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    die("Could not reach api.cloudflare.com — check your connection or VPN.\n  (" + e.message + ")");
  }
}

/* ---------- checks ---------- */

function countAccounts() {
  let n = 0;
  for (const entry of String(ACCOUNTS).split(",")) {
    const p = entry.trim();
    if (p && p.indexOf(":") > 0) n++;
  }
  return n;
}

async function preflight() {
  if (!TOKEN || !ACCOUNT) die("CF_API_TOKEN and CF_ACCOUNT_ID must be set in config.env.");

  if (TOKEN.startsWith("cfk_")) {
    die("That is the Global API Key, not an API token.\n" +
      "  Create a token instead: My Profile -> API Tokens -> Create Custom Token.");
  }

  const n = countAccounts();
  if (n === 0) {
    die("AUTH_USERS is empty in config.env.\n" +
      "  Without accounts the report would be published unprotected, so this stops here.\n" +
      "  Expected form:  name:password, name2:password2");
  }
  log(`  ${n} login account(s) will be required to open the page.`);

  log("  Checking the API token...");
  const v = await cf("/user/tokens/verify");
  if (v.status === 401 || v.status === 403 || !v.body.success) {
    die("The token was rejected by Cloudflare.\n" +
      "  It needs:  Account | Workers Scripts | Edit");
  }
  log("     token is valid");
}


/* ---------- the switcher ---------- */

/**
 * Both reports live on one Worker, so they can link to each other. The bar is
 * injected here, at publish time, rather than written into either report:
 * neither source file has to know the other exists, and the two links cannot
 * drift apart because they are generated from one list.
 *
 * It sits at the very top of the page, in the normal flow, so it scrolls away
 * with everything else. Nothing is pinned over the content.
 */
/* Monthly FTD Performance reports.
 *
 * These used to be listed by hand, which meant every new month needed an edit
 * here before it could go live — and a month that was built but not listed
 * simply never appeared, silently. They are discovered instead: anything
 * named <month>-<year>-ftd.html in this folder is picked up, newest first.
 *
 * MONTHLY_KEEP in config.env caps how many appear in the switcher, so the bar
 * does not grow a new tab every month. Older files stay on disk and stay
 * reachable at their own URL; they just drop out of the navigation.
 */
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
                     "july", "august", "september", "october", "november", "december"];
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LABEL = ["January", "February", "March", "April", "May", "June", "July",
                     "August", "September", "October", "November", "December"];

function discoverMonthly() {
  let files;
  try { files = fs.readdirSync(__dirname); } catch { return []; }
  const found = [];
  for (const file of files) {
    const m = /^([a-z]+)-(\d{4})-ftd\.html$/.exec(file);
    if (!m) continue;
    const idx = MONTH_NAMES.indexOf(m[1]);
    if (idx === -1) continue;
    const year = Number(m[2]);
    found.push({
      file,
      href: `/${m[1]}-${year}`,
      month: idx, year,
      label: `FTD ${MONTH_LABEL[idx]}`,
      key: `${SHORT_MONTH[idx].toLowerCase()}${year}`,
      sort: year * 12 + idx,
    });
  }
  found.sort((a, b) => b.sort - a.sort);
  const keep = Number(cfg("MONTHLY_KEEP", "3")) || 3;
  const kept = found.slice(0, keep);
  /* Two Augusts on the bar would give two tabs reading "FTD August". Only then
     does the year earn its place, and only on the ones that clash. */
  const perMonth = new Map();
  for (const m of kept) perMonth.set(m.month, (perMonth.get(m.month) || 0) + 1);
  for (const m of kept) if (perMonth.get(m.month) > 1) m.label += ` ${m.year}`;
  return kept;
}

const MONTHLY = [
  ...discoverMonthly(),
  /* Not month-stamped, so still listed explicitly. */
  { file: "business-overview.html", href: "/overview", label: "Business Overview", key: "overview" },
  /* Drag-and-drop pivot over the query-1732 caches -- rows/columns/values,
     any of ten dimensions, active-depositor headcounts unioned rather than
     summed. Built in pivot/, baked by pivot/make_pivot_html.py. See
     pivot/README (if one exists) or the build script's own comments. */
  { file: "pivot.html", href: "/pivot", label: "Marketing Report", key: "pivot" },
  { file: "ftd-share.html", href: "/ftd-share", label: "FTD Share", key: "ftdshare" },
  /* FTD bonus treatment dashboard — highest-value first-time depositors and
     bonus delivery. Day-by-day matrix of deposits, GGR, and bonus events by template,
     showing grant status and cost. Built from Redash query 1732 and Smartico BigQuery.
     See ftd-dashboard/README.md. */
  { file: "ftd-bonus-dashboard.html", href: "/ftd-bonus", label: "FTD Bonus Treatment", key: "ftdbonus" },
  /* Deposit retention. There were two builds of this — the whole base from
     Redash query 1758, and this cache-only one from 2025 — and the all-base page
     is no longer built. This one is the retention page now, so it takes the
     `/retention` route people already have bookmarked rather than leaving them
     on a URL that no longer resolves.
     `retention-full/` keeps its builder, template and tests on disk; nothing
     bakes them, so there is no retention-full.html to publish. */
  { file: "retention.html", href: "/retention", label: "Retention", key: "retention" },
  { file: "reactivation.html", href: "/reactivation", label: "Reactivation", key: "reactivation" },
  { file: "acquisition-2026.html", href: "/acquisition-2026", label: "CPA 2026", key: "acq2026" },
  { file: "acquisition-2025.html", href: "/acquisition-2025", label: "CPA 2025", key: "acq2025" },
  /* VIP transfer onboarding — players moved to us from a competitor, measured
     before and after their onboarding date. Built by hand from snapshots in
     vip-transfer/data rather than nightly: the onboarding date, source casino
     and assigned VA live only in the Google Sheet, so there is nothing in the
     warehouse to rebuild the roster from. See vip-transfer/data/SOURCES.md. */
  { file: "vip-transfer.html", href: "/vip-transfer", label: "VIP Transfer", key: "viptransfer" },
  /* manager-view.html -- the same cohort scoped to one VA -- is deliberately NOT
     published here. It stays a local page (DEV-VIP-TRANSFER.bat, http://localhost:8899/)
     until it gets its own domain. Its scoping is presentational: the file still
     carries all 583 players, so serving it publicly would hand every manager the
     whole book behind a nav tab that says otherwise. */
  /* Community bonus programme — Discord/Twitter/Telegram reach into the
     depositor base, and what those players are worth. Built from the query-1732
     caches plus two exports the caches cannot supply: reward_tickets_data for
     the issued side of a bonus, and current_segment for the segment table.
     See community-channels/README-channels.md. */
  { file: "community-channels.html", href: "/community", label: "Community", key: "community" },
  /* First deposits by player country and acquisition channel, 2025 against
     2026, built from the query-1732 caches. Route is /ftd-countries, not /ftd:
     /ftd is the FTD YTD report and people have it bookmarked.
     See ftd-channels/README-ftd-channels.md. */
  { file: "ftd-channels.html", href: "/ftd-countries", label: "FTD (Country)", key: "ftdcountries" },
  /* The streamer programme, measured as a cohort: every player whose first
     deposit landed in 2026 through a streamer, and what those players went on
     to deposit and lose. Built from the query-1732 caches.
     See streamers/README-streamers.md.

     Taken off the site on 2026-09-14 — streamers.html is still in this folder
     and streamers/ still builds it, it is just not published. The sweep below
     deletes the staged /streamers folder on the next run, which is deliberate:
     an unlinked page would stay live at its old URL, never updated, and still
     full of player data. Put the line below back to return it.

  { file: "streamers.html", href: "/streamers", label: "Streamers", key: "streamers" },
  */
  /* The on-site journey, pageview to first deposit, for 60 markets. The only
     page here built from PostHog rather than Redash: it measures what people do
     ON the site -- reach the registration modal, register, open the deposit
     modal, copy a deposit address, deposit -- which the warehouse cannot see.
     Where the FTD pages count deposits, this one shows where the other 99% of
     visitors stopped, split by referring domain, payment rail, month and day.
     See country-funnel/README.md. */
  { file: "country-funnel.html", href: "/ux-funnel", label: "UX Funnel", key: "uxfunnel" },
  /* Keyword demand tracker. Taken off the site on 2026-08-22 — kw-radar.html is
     still in this folder and still rebuilt, it is just not published. Put the
     line below back to return it.

  { file: "kw-radar.html", href: "/kw-radar", label: "KW Radar", key: "kwradar" },
  */
];

/* The order of the nav bar, set deliberately rather than falling out of how the
   pages happen to be defined above. It runs widest-to-narrowest: the whole
   business, then the money, then acquisition, then the two lifecycle pages, then
   cost. The month-stamped FTD pages are spliced in beside the other FTD ones
   instead of leading the bar, which is where discovery order used to put them.

   Keys are matched against MONTHLY/REPORTS entries, so a page that is renamed
   here keeps its route and its bookmark. Anything not named is appended rather
   than dropped -- a new page shows up at the end instead of vanishing. */
/* "streamers" left in deliberately: a key naming a page that is not published
   is ignored, and leaving it here means putting the entry above back is a
   one-line change that restores its position on the bar rather than appending
   it to the end. */
const NAV_ORDER = ["overview", "pivot", "bonus", "ftdshare", "__months", "ftd", "ftdbonus", "ftdcountries",
                   "retention", "reactivation", "viptransfer", "myplayers", "acq2026", "acq2025",
                   "community", "streamers", "uxfunnel"];

const REPORTS = (() => {
  /* Month pages carry a numeric month/year from discoverMonthly. Matching on
     the key shape instead looked fine until "acq2026" turned out to be three
     letters and four digits too, and the CPA tabs appeared twice. */
  const months = MONTHLY.filter(m => typeof m.month === "number");
  const named = new Map([
    ["bonus", { href: "/bonus", label: "Bonus Cost", key: "bonus" }],
    ["ftd",   { href: "/ftd", label: "FTD (Monthly)", key: "ftd" }],
    ...MONTHLY.map(m => [m.key, { href: m.href, label: m.label, key: m.key }]),
  ]);
  /* The overview is staged twice — once as the front page, once at /overview so
     existing links keep resolving — but the bar must point at the root, or the
     home page would show a tab that looks unvisited while you are on it. */
  named.set("overview", { href: "/", label: "Business Overview", key: "overview" });
  const out = [];
  for (const k of NAV_ORDER) {
    if (k === "__months") { for (const m of months) out.push(named.get(m.key)); continue; }
    if (named.has(k)) out.push(named.get(k));
  }
  for (const [k, v] of named) if (!out.includes(v)) out.push(v);
  return out;
})();

/**
 * The tab icon: a dark green tile with the Wayzen W.
 *
 * Injected here, at publish time, for the same reason the switcher bar is —
 * the six reports are built by four different scripts (two of them Python), and
 * putting the tag in each template means four places to keep in step and a new
 * report that quietly ships with the default globe. One place, every page.
 *
 * SVG rather than .ico so it stays sharp at any size, and inline rather than a
 * file because every asset on this Worker sits behind the session check — a
 * /favicon.svg would 302 to the login page and the browser would fall back to
 * the globe anyway.
 */
/* Single quotes inside, and the angle brackets and # percent-encoded. A double
   quote here would close the href attribute early and the tag would break in a
   way that looks like nothing happened — the browser just keeps the globe. */
const FAVICON =
  "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
  "%3Crect width='32' height='32' rx='7' fill='%23213916'/%3E" +
  "%3Cpath d='M6 9.5 L11 23 L16 13.5 L21 23 L26 9.5' fill='none' stroke='%23b3e580' " +
  "stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

const FAVICON_TAG = `<link rel="icon" href="data:image/svg+xml,${FAVICON}">`;

function withFavicon(html) {
  if (/<link[^>]+rel=["']?icon/i.test(html)) return html;   // never inject twice
  /* After <head> rather than before </head>: a report that somehow lacks a
     closing tag still gets its icon, and the browser sees it sooner. */
  const m = /<head[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + FAVICON_TAG + html.slice(m.index + m[0].length)
           : html;
}

function withSwitcher(html, current) {
  html = withFavicon(html);
  if (html.includes("data-report-switcher")) return html;   // never inject twice

  /* Wayzen palette, the same three colours the login page uses:
     #213916 the wordmark's dark green, #72c87b the button green, #b3e580 the
     brand green. Kept in step deliberately — the bar is the first thing you see
     after signing in, and it looked like a different product in navy. */
  const links = REPORTS.map(r => {
    const active = r.key === current;
    return `<a href="${r.href}"${active ? ' aria-current="page"' : ""}` +
      ` style="display:inline-block;padding:0.3rem 0.85rem;border-radius:14px;` +
      `text-decoration:none;font-weight:700;font-size:0.74rem;letter-spacing:0.01em;` +
      (active
        ? "background:#72c87b;color:#12250b;cursor:default;"
        : "background:transparent;color:#d9f0c4;border:1px solid #4a6b3c;") +
      `">${r.label}</a>`;
  }).join("");

  /* Pushed to the far right by margin-left:auto. Basic auth had no way out at
     all short of closing the browser; this is the whole point of moving to a
     cookie, so it needs to be visible on every page. */
  const signOut =
    `<a href="/logout" style="margin-left:auto;display:inline-block;padding:0.3rem 0.85rem;` +
    `border-radius:14px;text-decoration:none;font-weight:700;font-size:0.74rem;` +
    `letter-spacing:0.01em;background:transparent;color:#a9c496;border:1px solid #3c5730;">` +
    `Sign out</a>`;

  const bar =
    `<div data-report-switcher style="display:flex;gap:0.32rem;align-items:center;` +
    `padding:0.45rem 1.5rem;background:#213916;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    links + signOut + `</div>`;

  /* Straight after the opening <body>, before whatever wrapper the report uses,
     so it cannot land inside a centred column or a styled container. */
  const m = /<body[^>]*>/i.exec(html);
  if (!m) {
    die("Could not find <body> in one of the reports, so the switcher could not be added.");
  }
  return html.slice(0, m.index + m[0].length) + bar + html.slice(m.index + m[0].length);
}

/* ---------- staging ---------- */

function stage() {
  /* The landing page is the Business Overview: it is the page that answers
     "how is the business doing", and it is what everyone sees after signing in.
     The bonus cost report held this slot historically and now sits at /bonus. */
  const src = path.join(__dirname, "business-overview.html");
  if (!fs.existsSync(src)) {
    die("business-overview.html is missing, and it is the site's front page.\n" +
        "  Build it with overview\\build_overview.py then overview\\make_overview_html.py\n" +
        "  (or just run UPDATE-EVERYTHING.bat, which does both at step 6).");
  }
  const dir = path.join(__dirname, "publish");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"),
    withSwitcher(fs.readFileSync(src, "utf8"), "overview"));

  const mb = f => (fs.statSync(f).size / 1048576).toFixed(1);
  log(`  Staged the Business Overview at /   (${mb(path.join(dir, "index.html"))} MB)`);

  /* Bonus cost, at its own route now. Staged like /ftd below — if it has not
     been built, that must not stop the rest of the site going out. Anyone
     holding the old root bookmark lands on the Business Overview and finds
     Bonus Cost one tab along. */
  const bonus = path.join(__dirname, "bonus-cost-report.html");
  const bonusDir = path.join(dir, "bonus");
  if (fs.existsSync(bonus)) {
    fs.mkdirSync(bonusDir, { recursive: true });
    fs.writeFileSync(path.join(bonusDir, "index.html"),
      withSwitcher(fs.readFileSync(bonus, "utf8"), "bonus"));
    log(`  Staged the bonus cost report at /bonus  (${mb(path.join(bonusDir, "index.html"))} MB)`);
  } else {
    log("  bonus-cost-report.html not found - skipping /bonus");
  }

  /* The FTD report rides along on the same Worker, at /ftd, behind the same
     login. It is staged only if it has been built — a missing or half-built FTD
     report must not stop the bonus cost report from being published. */
  const ftd = path.join(__dirname, "ftd-report", "ftd-report.html");
  const ftdDir = path.join(dir, "ftd");
  if (fs.existsSync(ftd)) {
    fs.mkdirSync(ftdDir, { recursive: true });
    fs.writeFileSync(path.join(ftdDir, "index.html"),
      withSwitcher(fs.readFileSync(ftd, "utf8"), "ftd"));
    log(`  Staged the FTD report at /ftd       (${mb(path.join(ftdDir, "index.html"))} MB)`);
  } else {
    log("  No FTD report built yet — publishing the bonus cost report only.");
    log("  (build it with ftd-report\\2-build-report.bat, then run this again)");
  }

  /* Monthly FTD Performance reports. Same rule as /ftd above: a month whose
     file is not present is skipped rather than failing the whole publish, so
     one missing month never takes the live site down. */
  for (const m of MONTHLY) {
    const monthSrc = path.join(__dirname, m.file);
    if (!fs.existsSync(monthSrc)) {
      log(`  ${m.file} not found - skipping ${m.href}`);
      continue;
    }
    const monthDir = path.join(dir, m.href.replace(/^\//, ""));
    fs.mkdirSync(monthDir, { recursive: true });
    fs.writeFileSync(path.join(monthDir, "index.html"),
      withSwitcher(fs.readFileSync(monthSrc, "utf8"), m.key));
    log(`  Staged ${m.label} at ${m.href}  (${mb(path.join(monthDir, "index.html"))} MB)`);
  }

  /* Assets are only reachable through the Worker, but leave nothing helpful
     lying around for a crawler that somehow gets a URL. */
  fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n");

  /**
   * Anything left in publish\ from a previous run is uploaded again, because
   * the whole folder is the asset bundle. So dropping a report from the lists
   * above removes its link from the switcher and nothing else — the page itself
   * stays live at its old URL, unlinked, never updated, and still full of
   * player data. "Removed from the site" has to mean removed.
   *
   * Everything here is regenerated from the .html files in the parent folder on
   * every run, so deleting what no longer belongs costs nothing and is undone
   * by putting the entry back and publishing again.
   */
  const expected = new Set(["index.html", "robots.txt", "_headers", "ftd", "bonus"]);
  for (const m of MONTHLY) expected.add(m.href.replace(/^\//, ""));

  for (const entry of fs.readdirSync(dir)) {
    if (expected.has(entry)) continue;

    /* One deliberate exception. MONTHLY_KEEP caps how many months appear in the
       switcher so the bar does not grow a tab a month, but an older month is
       only meant to drop out of the *navigation* — its URL is supposed to keep
       working for anyone holding a link. So a month whose source page is still
       in the parent folder is left alone even though it is not listed. */
    if (/^[a-z]+-\d{4}$/.test(entry) &&
        fs.existsSync(path.join(__dirname, `${entry}-ftd.html`))) continue;

    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    log(`  Removed /${entry} — no longer listed, so it will not be published`);
  }
}

function writeWranglerConfig(kvNamespaceId) {
  /* Generated fresh each run so config.env stays the single source of truth. */
  const config = {
    name: NAME,
    main: "worker.js",
    compatibility_date: "2026-01-01",
    account_id: ACCOUNT,
    workers_dev: true,
    assets: {
      directory: "../publish",
      binding: "ASSETS",
      // Critical: without this the static files are served BEFORE the Worker
      // runs, and the password would be bypassed entirely.
      run_worker_first: true,
    },
    vars: { AUTH_USERS: ACCOUNTS, AUTH_SECRET: sessionSecret(),
            // who sees whose book, and who may see the whole one
            AUTH_SCOPES: cfg("AUTH_SCOPES"), ADMIN_USERS: cfg("ADMIN_USERS", "Davit"),
            /* AUTH_PAGES limits a person to certain routes: "name:/vip-transfer".
               Anyone not listed sees the whole site, which is the default.
               AUTH_HIDE hides named sections for a person once they are on a
               page: "name:mbonus". That one is cosmetic -- the data is still in
               the file -- so never use it to keep a figure secret. */
            AUTH_PAGES: cfg("AUTH_PAGES"), AUTH_HIDE: cfg("AUTH_HIDE") },
    /* Saved layouts for the pivot report -- see worker.js's /api/pivot-layouts
       route and ensureKvNamespace() above, which creates this namespace the
       first time there is no id on file for it. */
    kv_namespaces: [{ binding: "PIVOT_LAYOUTS", id: kvNamespaceId }],
    observability: { enabled: true },
  };
  const file = path.join(__dirname, "worker", "wrangler.json");
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  log("  Wrote the Worker config (password check runs before any file is served)");
}

function deploy() {
  log("\n  Deploying to Cloudflare (first run downloads wrangler)...\n");

  /* Node refuses to spawn .cmd files directly since the 2024 security change,
     which is why npx.cmd fails with EINVAL on Windows. Go through the command
     interpreter instead. */
  const isWindows = process.platform === "win32";

  /* Prefer a wrangler installed in this folder. `npx --yes wrangler@latest`
     re-downloads it from npm on EVERY run, so a proxy, an offline moment, or a
     VPN that routes npm away turns a working publish into a failed one while
     Cloudflare itself is perfectly reachable. Installed locally it is fetched
     once and the deploy stops depending on npm being up.

     Install it with:  npm install wrangler        (in this folder)
     Without it, the npx path below still works exactly as before. */
  const localBin = path.join(
    __dirname, "node_modules", ".bin", isWindows ? "wrangler.cmd" : "wrangler");
  const useLocal = fs.existsSync(localBin);
  log(useLocal
    ? "  Using the wrangler installed in this folder."
    : "  No local wrangler — fetching it from npm for this run.\n" +
      "  (run  npm install wrangler  here to stop depending on npm being reachable)");

  const command = isWindows ? (process.env.COMSPEC || "cmd.exe") : (useLocal ? localBin : "npx");
  const args = isWindows
    ? (useLocal
        ? ["/d", "/s", "/c", localBin, "deploy"]
        : ["/d", "/s", "/c", "npx", "--yes", "wrangler@latest", "deploy"])
    : (useLocal ? ["deploy"] : ["--yes", "wrangler@latest", "deploy"]);

  execFileSync(command, args, {
    cwd: path.join(__dirname, "worker"),
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      WRANGLER_SEND_METRICS: "false",
    },
  });
}

/* ---------- main ---------- */

(async () => {
  log("");
  await preflight();
  const kvNamespaceId = await ensureKvNamespace();
  stage();
  writeWranglerConfig(kvNamespaceId);
  deploy();

  log("");
  log("  ============================================================");
  log("    Published.");
  log("");
  log("    The address is the workers.dev line printed just above.");
  for (const r of REPORTS) log("      " + r.href.padEnd(14) + r.label);
  log("");
  log("    A switcher sits at the top of both pages, so you can move");
  log("    between them without going back to the address bar.");
  log("    It never changes, and it stays up when this machine is off.");
  log("");
  log("    Opening it asks for one of the logins in AUTH_USERS.");
  log("");
  log("    To change who can get in: edit AUTH_USERS in config.env");
  log("    and run this again.");
  log("  ============================================================");
  log("");
})().catch(e => die(e.message));
