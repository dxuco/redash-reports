/**
 * test-login.mjs — exercises worker/worker.js without deploying it.
 *
 *   node test-login.mjs
 *
 * The Worker is the only thing standing between the open internet and a page
 * listing every player's username, country and deposits, and it is the one part
 * of this repo that cannot be checked by looking at the published site — by the
 * time a mistake is visible there, it is already live. So it gets tested here,
 * offline, against a stubbed asset store.
 *
 * Cloudflare's runtime and Node both implement fetch, Request, Response,
 * FormData and crypto.subtle, which is what makes this possible at all: the
 * module is imported unmodified and called exactly as Cloudflare calls it.
 */

import worker from "./worker/worker.js";

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "\n          " + detail : ""}`); }
};

const ENV = {
  AUTH_USERS: "Davit:DFgh1234, viewer:secondpass, Ani:Ani123",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ASSETS: {
    fetch: req => new Response(`<html>report body for ${new URL(req.url).pathname}</html>`,
      { headers: { "Content-Type": "text/html" } }),
  },
};

const BASE = "https://reports.wayzen.workers.dev";
const hit = (path, init = {}, env = ENV) =>
  worker.fetch(new Request(BASE + path, init), env);

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
const cookieFrom = res => (res.headers.get("Set-Cookie") || "").split(";")[0];

console.log("\n  Login flow\n");

/* ---------------------------------------------------------- nothing is open */

{
  const res = await hit("/");
  check("a stranger at / is sent to the login page",
    res.status === 302 && (res.headers.get("Location") || "").startsWith("/login"),
    `${res.status} -> ${res.headers.get("Location")}`);

  /* The old failure mode: a browser popping its own dialog. That happens only
     because of this header, so its absence is the thing worth asserting. */
  check("no WWW-Authenticate, so no browser dialog",
    !res.headers.get("WWW-Authenticate"),
    res.headers.get("WWW-Authenticate"));
}

for (const path of ["/index.html", "/robots.txt", "/ftd", "/ftd/index.html", "/august-2026"]) {
  const res = await hit(path);
  check(`${path} is not served without a session`, res.status === 302, String(res.status));
}

{
  const res = await hit("/?probe=1");
  const body = await res.text();
  check("the redirect body carries no report content", !/report body/.test(body), body.slice(0, 80));
}

/* --------------------------------------------------------------- the form */

{
  const res = await hit("/login");
  const body = await res.text();
  check("the login page is public and is a real form",
    res.status === 200 && /<form/.test(body) && /name="password"/.test(body),
    String(res.status));
  check("the login page says it is Wayzen", /Wayzen/.test(body));
  check("the login page is marked noindex", /noindex/.test(body));
}

{
  /* Where a stranger lands after being bounced from a deep link. */
  const res = await hit("/august-2026");
  const loc = res.headers.get("Location");
  const back = await hit(loc);
  const body = await back.text();
  check("the page they wanted is carried through the redirect",
    /name="next" value="\/august-2026"/.test(body), loc);
}

/* -------------------------------------------------------------- signing in */

const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return { method: "POST", body: f };
};

{
  const res = await hit("/login", form({ username: "Davit", password: "wrong", next: "/" }));
  const body = await res.text();
  check("a wrong password is refused", res.status === 401, String(res.status));
  check("and refused on the page, not in a dialog", /<form/.test(body));
  check("and the username is kept so only the password is retyped",
    /value="Davit"/.test(body));
  check("and it does not say whether the user exists",
    /Wrong username or password/.test(body) && !/no such user/i.test(body));
  check("a failed attempt sets no cookie", !res.headers.get("Set-Cookie"));
}

{
  const res = await hit("/login", form({ username: "nobody", password: "Ani123", next: "/" }));
  const body = await res.text();
  check("an unknown user gets the identical message",
    res.status === 401 && /Wrong username or password/.test(body));
}

{
  const res = await hit("/login", form({ username: "Davit", password: "DFgh1234", next: "/" }));
  check("the right password signs you in", res.status === 302, String(res.status));
  check("and lands you where you were going", res.headers.get("Location") === "/");

  const setCookie = res.headers.get("Set-Cookie") || "";
  check("the cookie is HttpOnly", /HttpOnly/.test(setCookie), setCookie);
  check("the cookie is Secure", /Secure/.test(setCookie), setCookie);
  check("the cookie is SameSite=Lax", /SameSite=Lax/.test(setCookie), setCookie);
  check("the cookie does not contain the password",
    !/DFgh1234/.test(setCookie), setCookie);

  const cookie = cookieFrom(res);

  const page = await hit("/", { headers: { Cookie: cookie } });
  const body = await page.text();
  check("the cookie then opens the report",
    page.status === 200 && /report body/.test(body), String(page.status));

  const ftd = await hit("/ftd", { headers: { Cookie: cookie } });
  check("and every other page too", ftd.status === 200, String(ftd.status));

  check("the served page is still no-store",
    page.headers.get("Cache-Control") === "no-store");
  check("and still refuses to be framed",
    page.headers.get("X-Frame-Options") === "DENY");

  /* ---- tampering ---- */
  const [u, exp, mac] = cookie.slice("wz_session=".length).split(".");

  const asOther = `wz_session=${Buffer.from("viewer").toString("base64url")}.${exp}.${mac}`;
  check("a cookie edited to name someone else is rejected",
    (await hit("/", { headers: { Cookie: asOther } })).status === 302);

  const extended = `wz_session=${u}.${Number(exp) + 8.64e7}.${mac}`;
  check("a cookie with its expiry pushed out is rejected",
    (await hit("/", { headers: { Cookie: extended } })).status === 302);

  const forged = `wz_session=${u}.${exp}.${"A".repeat(mac.length)}`;
  check("a cookie with a made-up signature is rejected",
    (await hit("/", { headers: { Cookie: forged } })).status === 302);

  const otherSecret = { ...ENV, AUTH_SECRET: "a different key entirely" };
  check("a cookie signed with another key is rejected",
    (await hit("/", { headers: { Cookie: cookie } }, otherSecret)).status === 302);

  /* ---- revocation ---- */
  const withoutDavit = { ...ENV, AUTH_USERS: "viewer:secondpass" };
  check("removing someone from AUTH_USERS locks them out at once",
    (await hit("/", { headers: { Cookie: cookie } }, withoutDavit)).status === 302);

  /* ---- signing out ---- */
  const out = await hit("/logout", { headers: { Cookie: cookie } });
  check("signing out redirects to the login page",
    out.status === 302 && out.headers.get("Location") === "/login");
  check("and clears the cookie",
    /Max-Age=0/.test(out.headers.get("Set-Cookie") || ""),
    out.headers.get("Set-Cookie"));

  /* ---- already signed in ---- */
  const revisit = await hit("/login?next=/ftd", { headers: { Cookie: cookie } });
  check("visiting /login while signed in just moves you along",
    revisit.status === 302 && revisit.headers.get("Location") === "/ftd");
}

{
  const res = await hit("/login",
    form({ username: "Ani", password: "Ani123", next: "/", remember: "1" }));
  const setCookie = res.headers.get("Set-Cookie") || "";
  const maxAge = Number((setCookie.match(/Max-Age=(\d+)/) || [])[1]);
  check("'keep me signed in' lasts 30 days", maxAge === 30 * 24 * 3600, String(maxAge));
}

{
  const res = await hit("/login", form({ username: "Ani", password: "Ani123", next: "/" }));
  const maxAge = Number(((res.headers.get("Set-Cookie") || "").match(/Max-Age=(\d+)/) || [])[1]);
  check("without it, the session lasts 12 hours", maxAge === 12 * 3600, String(maxAge));
}

/* --------------------------------------------------------- the open redirect */

for (const bad of ["//evil.example/", "https://evil.example/", "http:/evil"]) {
  const res = await hit("/login", form({ username: "Ani", password: "Ani123", next: bad }));
  check(`next=${bad} cannot bounce you off-site`,
    res.headers.get("Location") === "/", res.headers.get("Location"));
}

/* ------------------------------------------------- Basic auth, for the scripts */

{
  const good = await hit("/", { headers: { Authorization: basic("Davit", "DFgh1234") } });
  check("verify-public.js can still get in with Basic auth", good.status === 200,
    String(good.status));

  const bad = await hit("/", { headers: { Authorization: basic("Davit", "nope") } });
  check("a wrong Basic password is refused", bad.status === 401, String(bad.status));
  check("and even then no dialog is requested", !bad.headers.get("WWW-Authenticate"));

  const junk = await hit("/", { headers: { Authorization: "Basic !!!not-base64!!!" } });
  check("a malformed Basic header is refused", junk.status === 401, String(junk.status));
}

/* ---------------------------------------------------------- failing closed */

{
  const noUsers = await hit("/", {}, { ...ENV, AUTH_USERS: "" });
  check("with no accounts configured the site serves nothing",
    noUsers.status === 503, String(noUsers.status));

  const noSecret = await hit("/", {}, { ...ENV, AUTH_SECRET: "" });
  check("with no signing key the site serves nothing",
    noSecret.status === 503, String(noSecret.status));

  /* The dangerous version of that bug is failing OPEN — check the report body
     never leaks in either case. */
  check("and neither one leaks the report",
    !/report body/.test(await noUsers.text()) && !/report body/.test(await noSecret.text()));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
