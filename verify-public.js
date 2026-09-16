/**
 * verify-public.js — proves whether the published site is actually protected.
 *
 *   node verify-public.js
 *
 * Makes real requests to the live URL from this machine: with no credentials,
 * with a wrong password, and with a correct one. A browser can mislead you here
 * because it caches logins; this does not.
 */

const fs = require("fs");
const path = require("path");

function loadConfig() {
  const file = path.join(__dirname, "config.env");
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const CFG = loadConfig();
const NAME = CFG.CF_PROJECT || "bonus-reports";
const SUBDOMAIN = process.argv[2] || CFG.CF_SUBDOMAIN || "veisreports";
const BASE = `https://${NAME}.${SUBDOMAIN}.workers.dev`;

const firstAccount = String(CFG.AUTH_USERS || "").split(",")[0].trim();
const [USER, PASS] = (() => {
  const i = firstAccount.indexOf(":");
  return i > 0 ? [firstAccount.slice(0, i), firstAccount.slice(i + 1)] : ["", ""];
})();

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

async function hit(label, urlPath, headers) {
  try {
    const res = await fetch(BASE + urlPath, { headers, redirect: "manual" });
    const body = await res.text();
    return { label, status: res.status, bytes: body.length, auth: res.headers.get("www-authenticate"), body };
  } catch (e) {
    return { label, error: e.message };
  }
}

(async () => {
  console.log(`\n  Testing ${BASE}\n`);

  const results = [
    await hit("no credentials at all", "/?probe=" + Date.now(), {}),
    await hit("the raw HTML file", "/index.html", {}),
    await hit("robots.txt", "/robots.txt", {}),
    /* The FTD report sits on the same Worker at /ftd, so it has to be probed
       separately — a sub-path is exactly the sort of thing that gets left
       unprotected when auth is bolted on per-route. */
    await hit("the FTD report, no credentials", "/ftd?probe=" + Date.now(), {}),
    await hit("the FTD report's raw file", "/ftd/index.html", {}),
    await hit("a wrong password", "/", { Authorization: basic(USER, "definitely-wrong") }),
    await hit("the correct password", "/", { Authorization: basic(USER, PASS) }),
    await hit("the FTD report, correct password", "/ftd", { Authorization: basic(USER, PASS) }),
    /* The login page itself is the one thing that MUST be public. If it 404s or
       503s, everyone is locked out and the site looks dead — a different
       failure from a leak, and one nothing else here would catch. */
    await hit("the login page", "/login", {}),
  ];

  for (const r of results) {
    if (r.error) { console.log(`  ??   ${r.label.padEnd(24)} could not connect: ${r.error}`); continue; }
    console.log(`  ${String(r.status).padEnd(4)} ${r.label.padEnd(24)} ${r.bytes.toLocaleString()} bytes`);
  }

  const [noCreds, rawFile, robots, ftdNoCreds, ftdRaw, wrong, right, ftdRight, login] = results;

  /* The whole point of the form is that people sign in with it, so prove that
     end to end rather than assuming: post the credentials, take the cookie it
     hands back, and open the report with it. */
  let cookieWorks = null, cookieDetail = "";
  if (!login.error && login.status === 200) {
    try {
      const body = new URLSearchParams({ username: USER, password: PASS, next: "/" });
      const post = await fetch(BASE + "/login", {
        method: "POST", body, redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const setCookie = post.headers.get("set-cookie") || "";
      const cookie = setCookie.split(";")[0];
      if (post.status !== 302 || !cookie.startsWith("wz_session=")) {
        cookieWorks = false;
        cookieDetail = `sign-in answered ${post.status}${setCookie ? "" : " and set no cookie"}`;
      } else {
        const page = await fetch(BASE + "/", { headers: { Cookie: cookie }, redirect: "manual" });
        cookieWorks = page.status === 200;
        if (!cookieWorks) cookieDetail = `the cookie then got ${page.status} on /`;
      }
    } catch (e) {
      cookieWorks = false;
      cookieDetail = e.message;
    }
    console.log(`  ${cookieWorks ? "ok  " : "FAIL"} signing in through the form` +
                `${cookieDetail ? "   " + cookieDetail : ""}`);
  }

  const leaks = [];
  if (noCreds.status === 200) leaks.push("the page loads with no credentials");
  if (rawFile.status === 200) leaks.push("/index.html is served directly, bypassing the login");
  if (robots.status === 200) leaks.push("/robots.txt is served without a login");
  if (ftdNoCreds.status === 200) leaks.push("/ftd loads with no credentials");
  if (ftdRaw.status === 200) leaks.push("/ftd/index.html is served directly, bypassing the login");
  if (wrong.status === 200) leaks.push("a wrong password is accepted");

  /* Not a leak — the opposite. Reported separately so a locked-out site is not
     announced as "PROTECTED" and left alone. */
  const lockouts = [];
  if (!login.error && login.status !== 200) {
    lockouts.push(`/login answered ${login.status} — nobody can sign in`);
  }
  if (cookieWorks === false) {
    lockouts.push(`the form does not sign you in${cookieDetail ? " (" + cookieDetail + ")" : ""}`);
  }

  console.log("");
  /* Nothing answered at all. Left to the checks below, this reads as "the
     correct password did not work" and sends you to AUTH_USERS, which is the
     wrong place entirely — after a rename the usual cause is that CF_PROJECT
     or CF_SUBDOMAIN here no longer matches what is actually deployed, so the
     address being probed does not exist. Say that instead. */
  if (results.every(r => r.error)) {
    console.log("  ############################################################");
    console.log(`    Nothing answered at ${BASE}`);
    console.log("");
    console.log("    This is about the address, not the login. Check that");
    console.log("    CF_PROJECT and CF_SUBDOMAIN in config.env match what is");
    console.log("    deployed: Cloudflare dashboard -> Workers & Pages. The");
    console.log("    subdomain is shown at the top of that page; the Worker");
    console.log("    name is in the list below it.");
    console.log("");
    console.log("    Nothing is exposed by this - an address that does not");
    console.log("    resolve is not serving anything.");
    console.log("  ############################################################");
    console.log("");
    process.exitCode = 1;
    return;
  }

  if (leaks.length) {
    console.log("  ############################################################");
    console.log("    NOT PROTECTED. Do not share this link.");
    for (const l of leaks) console.log("      - " + l);
    console.log("  ############################################################");
    process.exitCode = 1;
  } else if (lockouts.length) {
    console.log("  ############################################################");
    console.log("    Protected, but nobody can get in either.");
    for (const l of lockouts) console.log("      - " + l);
    console.log("");
    console.log("    Nothing is exposed. The reports are simply unreachable");
    console.log("    until this is fixed - check worker/worker.js and that");
    console.log("    AUTH_SECRET is present in config.env.");
    console.log("  ############################################################");
    process.exitCode = 1;
  } else if (right.status !== 200) {
    console.log("  Protected, but the correct password did not work either");
    console.log(`  (got ${right.status}). Check AUTH_USERS in config.env.`);
    process.exitCode = 1;
  } else {
    console.log("  ============================================================");
    console.log("    PROTECTED - verified from this machine.");
    console.log("      no credentials      -> sent to the login page");
    console.log("      raw file requests   -> refused  (both / and /ftd)");
    console.log("      wrong password      -> refused, on the page");
    console.log("      the sign-in form    -> works, and its cookie opens /");
    console.log("      correct password    -> the bonus cost report");
    if (ftdRight.status === 200) {
      console.log("      correct password    -> the FTD report at /ftd");
    } else if (ftdRight.status === 404) {
      console.log("");
      console.log("    /ftd is not published yet - build the FTD report, then publish again.");
    } else {
      console.log("");
      console.log(`    /ftd answered ${ftdRight.status} to a correct password, which is not expected.`);
    }
    console.log("  ============================================================");
  }
  console.log("");
})();
