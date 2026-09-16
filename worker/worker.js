/**
 * Cloudflare Worker — serves the reports behind a login.
 *
 * Every request hits this code first (run_worker_first is set in the generated
 * wrangler.json). Only after the session checks out do we hand the request to
 * the static asset store. Without that ordering the HTML would be served before
 * this ever ran.
 *
 * Two ways in, deliberately:
 *
 *   a session cookie   what people use. A real form at /login, a signed cookie,
 *                      a logout link, and an error message that appears on the
 *                      page instead of the browser re-showing a blank dialog.
 *
 *   HTTP Basic         what scripts use. verify-public.js proves the site is
 *                      protected by making real requests, and it cannot fill in
 *                      a form. Accepted when the header is present, but never
 *                      *requested* — no WWW-Authenticate is sent on the normal
 *                      path, so browsers never show the native dialog.
 *
 * Accounts come from the AUTH_USERS variable: "name:password, name2:password2"
 * The cookie is signed with AUTH_SECRET. Both are set by publish-worker.js.
 */

import { loginPage, esc, COOKIE, SESSION_HOURS, REMEMBER_DAYS } from "./login-page.mjs";



/* ------------------------------------------------------------------ helpers */

/* Compare without leaking length or position through timing. */
function sameString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseAccounts(raw) {
  const map = new Map();
  for (const entry of String(raw || "").split(",")) {
    const pair = entry.trim();
    if (!pair) continue;
    const i = pair.indexOf(":");
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const pass = pair.slice(i + 1).trim();
    if (name && pass) map.set(name, pass);
  }
  return map;
}

/* Which routes a person may reach.
 *
 * AUTH_PAGES is "name:/route /other-route, name2:/route". A name that appears
 * here can reach ONLY those routes; a name that does not appear is unrestricted
 * and sees the whole site, which is how everyone worked before this existed.
 *
 * Restricting by route rather than by page content is deliberate: the check
 * happens before the asset store is touched, so a restricted person cannot
 * fetch a page they are not allowed to by typing its URL, and cannot reach it
 * through a stale link either.
 */
function parsePages(raw) {
  const map = new Map();
  for (const entry of String(raw || "").split(",")) {
    const pair = entry.trim();
    if (!pair) continue;
    const i = pair.indexOf(":");
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const routes = pair.slice(i + 1).trim().split(/\s+/).filter(Boolean);
    if (name && routes.length) map.set(name, routes);
  }
  return map;
}

/* Does this path sit inside one of the allowed routes? "/vip-transfer" allows
   /vip-transfer and anything under it, but not /vip-transfer-extra. */
function allowedPath(pathname, routes) {
  return routes.some(r =>
    pathname === r || pathname === r + "/" || pathname.startsWith(r + "/"));
}

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

/**
 * The cookie is  <user>.<expiry-ms>.<hmac>  — readable, but not forgeable
 * without AUTH_SECRET. Nothing secret is stored in it: the password never
 * leaves the login POST.
 */
async function mint(user, secret, maxAgeSeconds) {
  const body = `${b64url(enc.encode(user))}.${Date.now() + maxAgeSeconds * 1000}`;
  return `${body}.${await sign(body, secret)}`;
}

async function readSession(cookieHeader, secret, accounts) {
  const raw = String(cookieHeader || "")
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;

  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 3) return null;
  const [userB64, expiry, mac] = parts;

  if (!sameString(mac, await sign(`${userB64}.${expiry}`, secret))) return null;
  if (!(Number(expiry) > Date.now())) return null;

  let user;
  try {
    user = atob(userB64.replace(/-/g, "+").replace(/_/g, "/"));
  } catch { return null; }

  /* Removing someone from AUTH_USERS has to lock them out immediately, even if
     their cookie has not expired yet. */
  return accounts.has(user) ? user : null;
}

/* Only ever redirect back into this site. A next= of "//evil.example" or
   "https://evil.example" would otherwise turn the login into an open redirect
   that a phishing link could point at. */
function safeNext(value) {
  const next = String(value || "/");
  return /^\/(?!\/)/.test(next) ? next : "/";
}

function cookieHeader(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

/* ------------------------------------------------------------------- routing */

export default {
  async fetch(request, env) {
    const accounts = parseAccounts(env.AUTH_USERS);
    const url = new URL(request.url);

    /* Fail closed. If the variable is missing, serve nothing rather than
       serving player data to the world. */
    if (accounts.size === 0) {
      return new Response(
        "This report is not configured yet (no accounts set). Nothing is being served.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
    /* Same rule for the signing key: without it a cookie cannot be trusted, and
       trusting one anyway would be worse than being down. */
    const secret = env.AUTH_SECRET;
    if (!secret) {
      return new Response(
        "This report is not configured yet (no session key set). Nothing is being served.",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    /* ---- log out ---- */
    if (url.pathname === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login",
          "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
          ...SECURITY_HEADERS,
        },
      });
    }

    /* ---- the login form ---- */
    if (url.pathname === "/login") {
      if (request.method === "GET") {
        /* Already signed in and someone hits /login — send them onward rather
           than showing a form they do not need. */
        if (await readSession(request.headers.get("Cookie"), secret, accounts)) {
          return new Response(null, {
            status: 302,
            headers: { Location: safeNext(url.searchParams.get("next")), ...SECURITY_HEADERS },
          });
        }
        return html(loginPage({ next: safeNext(url.searchParams.get("next")) }));
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
      }

      const form = await request.formData();
      const user = String(form.get("username") || "").trim();
      const pass = String(form.get("password") || "");
      const next = safeNext(form.get("next"));
      const remember = form.get("remember") === "1";

      const expected = accounts.get(user);
      if (expected === undefined || !sameString(pass, expected)) {
        /* One message for both cases, so a wrong guess cannot be used to work
           out which usernames exist. The username is echoed back so a typo in
           the password does not mean retyping both. */
        return html(loginPage({
          next, user,
          error: "Wrong username or password.",
        }), 401);
      }

      const maxAge = (remember ? REMEMBER_DAYS * 24 : SESSION_HOURS) * 3600;
      return new Response(null, {
        status: 302,
        headers: {
          Location: next,
          "Set-Cookie": cookieHeader(await mint(user, secret, maxAge), maxAge),
          ...SECURITY_HEADERS,
        },
      });
    }

    /* ---- everything else needs a session ---- */
    let user = await readSession(request.headers.get("Cookie"), secret, accounts);

    /* Basic auth still opens the door for scripts (verify-public.js), but it is
       never advertised — no WWW-Authenticate goes out on this path, so no
       browser will pop its native dialog. */
    if (!user) {
      const header = request.headers.get("Authorization") || "";
      if (header.startsWith("Basic ")) {
        try {
          const decoded = atob(header.slice(6));
          const i = decoded.indexOf(":");
          const name = decoded.slice(0, i), pass = decoded.slice(i + 1);
          const expected = accounts.get(name);
          if (expected !== undefined && sameString(pass, expected)) user = name;
        } catch { /* malformed header — treated as no credentials */ }
        if (!user) {
          return new Response("Wrong username or password", {
            status: 401,
            headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS },
          });
        }
      }
    }

    if (!user) {
      const next = url.pathname + url.search;
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login?next=" + encodeURIComponent(safeNext(next)),
          ...SECURITY_HEADERS,
        },
      });
    }

    /* Authenticated. Before anything is served, check this person is allowed
       to be on this route at all. */
    const pageRules = parsePages(env.AUTH_PAGES);
    const myRoutes = pageRules.get(user);
    if (myRoutes && !allowedPath(url.pathname, myRoutes)) {
      /* Send them to their own page rather than showing a 403: for someone who
         only ever has one page, a redirect IS the right answer to "/" and to
         any link they were sent. */
      return new Response(null, {
        status: 302,
        headers: { Location: myRoutes[0], ...SECURITY_HEADERS },
      });
    }

    /* ---- pivot report: saved layouts, shared across everyone on the site ----
     * A small JSON blob in Cloudflare KV, replacing what used to be each
     * browser's own localStorage. One document, one key ("shared") — there
     * is no per-person split here, same as the built-in presets already
     * baked into the page: anyone signed in sees the same saved list and can
     * add to it. Reached only after `user` is known and the route check
     * above has already let this person through, so it inherits the same
     * session and AUTH_PAGES restrictions as every page on this Worker.
     */
    if (url.pathname === "/api/pivot-layouts") {
      if (!env.PIVOT_LAYOUTS) {
        return new Response(JSON.stringify({ error: "not configured" }), {
          status: 501,
          headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
        });
      }
      if (request.method === "GET") {
        const stored = await env.PIVOT_LAYOUTS.get("shared", { type: "json" });
        return new Response(JSON.stringify(stored || { items: [], updated: null, by: null }), {
          headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
        });
      }
      if (request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { body = null; }
        if (!body || !Array.isArray(body.items)) {
          return new Response(JSON.stringify({ error: "expected {items: [...]}" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
          });
        }
        /* Cap what one write can hold — these are small layout definitions
           (rows/cols/values/filters), not a place to store anything large,
           and KV values are billed and capped by size. 500 is far past
           anything a real saved-layout list would ever reach. */
        if (body.items.length > 500) {
          return new Response(JSON.stringify({ error: "too many layouts" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
          });
        }
        const doc = { items: body.items, updated: Date.now(), by: user };
        await env.PIVOT_LAYOUTS.put("shared", JSON.stringify(doc));
        return new Response(JSON.stringify(doc), {
          headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
        });
      }
      return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
    }

    /* Authenticated — now let the static assets answer. */
    const res = await env.ASSETS.fetch(request);
    let out = new Response(res.body, res);

    /* Tell the page who is looking. Pages that care (the manager view) read
       window.__VIEWER and show that person their own book; pages that do not
       simply ignore it. Injected here rather than baked in at build time
       because one file is served to everyone. */
    if ((out.headers.get("Content-Type") || "").includes("text/html")) {
      const scopes = parseAccounts(env.AUTH_SCOPES);
      const admins = new Set(String(env.ADMIN_USERS || "")
                               .split(",").map(s => s.trim()).filter(Boolean));
      /* __CAN_EDIT is deliberately absent here. Adding players and managing
         accounts writes files, which a static asset store cannot do — the
         buttons exist only on the local dev server, and the page hides them
         when this flag is missing rather than offering an action that would
         404. */
      /* AUTH_HIDE is "name:section section2" — section names a page knows how
         to hide. Cosmetic only: the data is still in the file, so this is for
         decluttering a view, never for keeping a number secret. */
      const hides = parsePages(env.AUTH_HIDE);
      const stamp =
          `<script>window.__VIEWER=${JSON.stringify(String(user))};`
        + `window.__VIEWER_SCOPE=${JSON.stringify(scopes.get(user) || "")};`
        + `window.__HIDE=${JSON.stringify(hides.get(user) || [])};`
        + `window.__IS_ADMIN=${admins.has(user)};</script>`;
      let rw = new HTMLRewriter()
        .on("head", { element(el) { el.append(stamp, { html: true }); } });

      /* A restricted person must not be shown tabs that would bounce them
         straight back here. The switcher is baked into every page at build
         time, so it is pruned on the way out instead. */
      if (myRoutes) {
        rw = rw.on("div[data-report-switcher] a", {
          element(el) {
            const href = el.getAttribute("href") || "";
            if (href !== "/logout" && !allowedPath(href, myRoutes)) el.remove();
          },
        });
      }
      out = rw.transform(out);
    }

    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
