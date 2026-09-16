/**
 * publish.js — puts the report on Cloudflare Pages at a fixed address.
 *
 *   node publish.js
 *
 * Reads CF_API_TOKEN / CF_ACCOUNT_ID / CF_PROJECT from config.env, makes sure
 * the Pages project exists, refreshes publish/index.html from the latest build,
 * and uploads it. Safe to run as often as you like.
 *
 * The token is never printed.
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
const PROJECT = cfg("CF_PROJECT", "bonus-reports");
const API = "https://api.cloudflare.com/client/v4";

/* Who may open the published page. Anyone not listed is refused by Cloudflare
   before the page is ever served. */
const ALLOWED_EMAILS = cfg("CF_ALLOWED_EMAILS", "")
  .split(",").map(s => s.trim()).filter(Boolean);

const log = (...a) => console.log(...a);
const die = msg => { console.error("\n  " + msg + "\n"); process.exit(1); };

async function cf(pathname, options = {}) {
  let res;
  try {
    res = await fetch(API + pathname, {
      ...options,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (e) {
    die("Could not reach api.cloudflare.com.\n" +
      "  Check your internet connection, and any VPN or firewall that might\n" +
      "  be blocking it.  (" + e.message + ")");
  }
  let body;
  try { body = await res.json(); } catch { body = { success: false, errors: [{ message: `HTTP ${res.status}` }] }; }
  return { status: res.status, body };
}

const firstError = body =>
  (body && body.errors && body.errors[0] && (body.errors[0].message || JSON.stringify(body.errors[0]))) || "unknown error";

/* Prints exactly what Cloudflare said, so a failure is diagnosable instead of
   guessed at. */
function reportApiError(what, status, body) {
  log("");
  log(`  ${what} failed.`);
  log(`     HTTP status : ${status}`);
  const errs = (body && body.errors) || [];
  if (!errs.length) {
    log(`     response    : ${JSON.stringify(body).slice(0, 300)}`);
  }
  for (const e of errs) {
    log(`     error code  : ${e.code ?? "?"}`);
    log(`     message     : ${e.message ?? JSON.stringify(e)}`);
  }
  log("");
}

/* ---------- steps ---------- */

async function checkToken() {
  log("  Checking the API token...");

  /* Cloudflare prefixes its credentials so they can be told apart:
       cfk_   Global API Key  - full control of the whole account
       cfut_  User API Token
       cfat_  Account API Token
     Only the last two are tokens, and only they can be scoped safely. */
  if (TOKEN.startsWith("cfk_")) {
    die("That value is your Global API Key, not an API token.\n\n" +
      "  The Global API Key controls your entire Cloudflare account - billing,\n" +
      "  DNS, everything - and it cannot be limited to just this report. Please\n" +
      "  don't keep it in a file.\n\n" +
      "  Instead:  My Profile -> API Tokens -> Create Token -> Create Custom Token\n" +
      "  Give it only:\n" +
      "     Account | Cloudflare Pages           | Edit\n" +
      "     Account | Access: Apps and Policies  | Edit\n\n" +
      "  The new value will start with cfut_ or cfat_. Put that in config.env,\n" +
      "  and roll the Global API Key in the dashboard since it has been in a file.");
  }

  const { status, body } = await cf("/user/tokens/verify");
  if (status === 401 || status === 403) {
    die("The token was rejected by Cloudflare.\n" +
      "  Create a new one (My Profile -> API Tokens) with:\n" +
      "     Account | Cloudflare Pages | Edit\n" +
      "  and paste it into config.env as CF_API_TOKEN.");
  }
  if (!body.success) die("Token check failed: " + firstError(body));
  log("     token is valid");
}

async function ensureProject() {
  log(`  Looking for the site "${PROJECT}"...`);
  const got = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`);

  if (got.status === 200 && got.body.success) {
    log("     already exists");
    return got.body.result;
  }

  if (got.status === 403) {
    die("The token is not allowed to manage Pages, or the account ID is wrong.\n" +
      "  Check CF_ACCOUNT_ID in config.env, and that the token has\n" +
      "     Account | Cloudflare Pages | Edit");
  }

  log("     not there yet, creating it");
  const made = await cf(`/accounts/${ACCOUNT}/pages/projects`, {
    method: "POST",
    body: JSON.stringify({ name: PROJECT, production_branch: "main" }),
  });
  if (!made.body.success) die("Could not create the site: " + firstError(made.body));
  log("     created");
  return made.body.result;
}

/* ---------- the login in front of the site ---------- */

async function ensureOrganisation() {
  const got = await cf(`/accounts/${ACCOUNT}/access/organizations`);
  if (got.status === 200 && got.body.success && got.body.result && got.body.result.auth_domain) {
    return got.body.result.auth_domain;
  }

  if (got.status === 403 || got.status === 400) {
    reportApiError("Reading your Access settings", got.status, got.body);
    die("Two things cause this, and the code above tells us which:\n\n" +
      "  1. Zero Trust has never been switched on for this account.\n" +
      "     Fix: open dash.cloudflare.com -> Zero Trust in the left menu,\n" +
      "     pick any team name, choose the FREE plan. Then run this again.\n\n" +
      "  2. The token is missing Access permissions.\n" +
      "     Fix: create a token with all three of:\n" +
      "        Account | Cloudflare Pages                                  | Edit\n" +
      "        Account | Access: Apps and Policies                         | Edit\n" +
      "        Account | Access: Organizations, Identity Providers, Groups | Edit\n\n" +
      "  If you would rather not fight this, set the login up by hand in the\n" +
      "  dashboard and put  CF_SKIP_ACCESS=yes  in config.env - see README.");
  }

  const authDomain = `${PROJECT}-${Math.random().toString(36).slice(2, 8)}`;
  log(`     setting up Access for this account (${authDomain}.cloudflareaccess.com)`);
  const made = await cf(`/accounts/${ACCOUNT}/access/organizations`, {
    method: "POST",
    body: JSON.stringify({ name: `${PROJECT} reports`, auth_domain: authDomain }),
  });
  if (!made.body.success) die("Could not set up Access: " + firstError(made.body));
  return made.body.result.auth_domain;
}

async function ensureAccessPolicy() {
  /* Escape hatch: the login was configured by hand in the dashboard, so the
     token only needs Pages permission. */
  if (/^(yes|true|1)$/i.test(cfg("CF_SKIP_ACCESS", ""))) {
    log("  Skipping login setup (CF_SKIP_ACCESS is set).");
    log("     Make sure you created the Access application by hand, or the");
    log("     published page will be open to anyone with the link.");
    return;
  }

  if (!ALLOWED_EMAILS.length) {
    die("CF_ALLOWED_EMAILS is empty in config.env.\n" +
      "  List the email addresses allowed to open the report, comma separated.\n" +
      "  Without it the page would be published with no login at all.");
  }

  log("  Setting up the login...");
  await ensureOrganisation();

  const domain = `${PROJECT}.pages.dev`;

  const list = await cf(`/accounts/${ACCOUNT}/access/apps`);
  if (list.status === 403 || list.status === 400) {
    reportApiError("Listing Access applications", list.status, list.body);
    die("Add  Account | Access: Apps and Policies | Edit  to the token,\n" +
      "  or set the login up by hand and put CF_SKIP_ACCESS=yes in config.env.");
  }
  let app = (list.body.result || []).find(a => a.domain === domain);

  if (!app) {
    const made = await cf(`/accounts/${ACCOUNT}/access/apps`, {
      method: "POST",
      body: JSON.stringify({
        name: `${PROJECT} bonus cost report`,
        domain,
        type: "self_hosted",
        session_duration: "24h",
        app_launcher_visible: false,
      }),
    });
    if (!made.body.success) die("Could not create the login rule: " + firstError(made.body));
    app = made.body.result;
    log(`     created for ${domain}`);
  } else {
    log(`     already covering ${domain}`);
  }

  const policies = await cf(`/accounts/${ACCOUNT}/access/apps/${app.id}/policies`);
  const existing = (policies.body.result || []).find(p => p.name === "Allowed people");

  const payload = {
    name: "Allowed people",
    decision: "allow",
    include: ALLOWED_EMAILS.map(email => ({ email: { email } })),
  };

  const saved = existing
    ? await cf(`/accounts/${ACCOUNT}/access/apps/${app.id}/policies/${existing.id}`, {
        method: "PUT", body: JSON.stringify(payload),
      })
    : await cf(`/accounts/${ACCOUNT}/access/apps/${app.id}/policies`, {
        method: "POST", body: JSON.stringify(payload),
      });

  if (!saved.body.success) die("Could not save who is allowed in: " + firstError(saved.body));
  log(`     allowed: ${ALLOWED_EMAILS.join(", ")}`);
}

function refreshSnapshot() {
  const src = path.join(__dirname, "bonus-cost-report.html");
  if (!fs.existsSync(src)) {
    log("  ! bonus-cost-report.html missing — run build.js first. Publishing whatever is in publish/.");
    return;
  }
  const dir = path.join(__dirname, "publish");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, "index.html"));
  const mb = (fs.statSync(path.join(dir, "index.html")).size / 1048576).toFixed(1);
  log(`  Staged the latest report (${mb} MB)`);
}

function upload() {
  log("  Uploading to Cloudflare (first run downloads wrangler, please wait)...\n");
  /* Node cannot spawn .cmd directly on Windows any more — go via cmd.exe. */
  const isWindows = process.platform === "win32";
  const wrangler = ["--yes", "wrangler@latest", "pages", "deploy", "publish",
    "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"];

  execFileSync(
    isWindows ? (process.env.COMSPEC || "cmd.exe") : "npx",
    isWindows ? ["/d", "/s", "/c", "npx", ...wrangler] : wrangler,
    {
      cwd: __dirname,
      stdio: "inherit",
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: TOKEN,
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        WRANGLER_SEND_METRICS: "false",
      },
    }
  );
}

/* ---------- main ---------- */

(async () => {
  if (!TOKEN || !ACCOUNT) {
    die("CF_API_TOKEN and CF_ACCOUNT_ID must both be filled in inside config.env.");
  }

  log("");
  await checkToken();
  await ensureProject();

  /* Login first, upload second — so the report is never briefly public. */
  await ensureAccessPolicy();

  refreshSnapshot();
  upload();

  log("");
  log("  ============================================================");
  log(`    Live at:  https://${PROJECT}.pages.dev`);
  log("");
  log("    The address never changes, and it stays up when this");
  log("    machine is off.");
  log("");
  log("    Opening it asks for an email code. Only these addresses");
  log("    are accepted:");
  for (const e of ALLOWED_EMAILS) log("       " + e);
  log("");
  log("    To add or remove someone, edit CF_ALLOWED_EMAILS in");
  log("    config.env and run this again.");
  log("  ============================================================");
  log("");
})().catch(e => die(e.message));
