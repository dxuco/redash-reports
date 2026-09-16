/**
 * The sign-in page, shared by the Worker and the local dev server.
 *
 * It lives in its own module so that `node vip-transfer/dev.js` shows exactly
 * the page people see in production. When the two drifted apart, a login flow
 * could be "finished" locally and still be wrong once deployed.
 *
 * ESM on purpose: wrangler bundles this into the Worker, and dev.js reaches it
 * with a dynamic import() from CommonJS.
 */

/* Session lengths, quoted on the form itself, so they live beside the page that
   promises them. worker.js imports these rather than keeping its own copy. */
export const COOKIE = "wz_session";
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;

/* ------------------------------------------------------------- the login page */

export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * The Wayzen wordmark, inlined.
 *
 * It has to be inline. The login page is the one page an unauthenticated
 * visitor sees, and every static file on this Worker sits behind the session
 * check — so <img src="/logo.png"> would be redirected to /login and render as
 * a broken image. worker/build-login-page.py regenerates this constant from a
 * source PNG; do not hand-edit it.
 */
const LOGO = "data:image/png;base64,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";

export function loginPage({ next = "/", error = "", user = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#b3e580">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23213916'/%3E%3Cpath d='M6 9.5 L11 23 L16 13.5 L21 23 L26 9.5' fill='none' stroke='%23b3e580' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<title>Sign in — Wayzen Reports</title>
<style>
  :root {
    --leaf:#b3e580;      /* Wayzen green            */
    --forest:#213916;    /* the wordmark's dark     */
    --grass:#72c87b;     /* buttons                 */
    --field:#eaf0fd;     /* input wells             */
    --card:#fbfef8;
    --muted:#6b7d63;
  }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body {
    margin:0; display:flex; align-items:center; justify-content:center; padding:1.5rem;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    color:var(--forest);
  }
  /**
   * The brand pattern: light circles tiled edge to edge, so the dark ground
   * shows through only at the corners as four-pointed stars.
   *
   * It lives on its own fixed layer rather than on <body>. Anything that embeds
   * this markup — a preview pane, an iframe wrapper, a "save page as" — drops
   * the page's own <body> and with it any background painted there, and the
   * design collapses to white. An element inside the document cannot be lost
   * that way. The <html>/<body> rules below are kept as a second coat so the
   * colour is right during the first paint, before layout.
   */
  html { background:var(--forest); }
  body { background:var(--forest); }
  .bg {
    position:fixed; inset:0; z-index:0; pointer-events:none;
    background-color:var(--forest);
    background-image:radial-gradient(circle 205px at 50% 50%,
      #d2f2b1 0%, var(--leaf) 58%, #9ad665 100%);
    background-size:410px 410px;
  }
  .card {
    position:relative; z-index:1;   /* above .bg */
    width:100%; max-width:392px; background:var(--card);
    border-radius:26px; padding:2.4rem 2.1rem 1.8rem;
    box-shadow:0 26px 64px rgba(23,48,12,.30);
    text-align:center;
  }
  .logo { width:186px; max-width:70%; height:auto; display:block; margin:0 auto .5rem; }
  .sub { margin:0 0 1.7rem; font-size:.8rem; color:var(--muted); }
  h1 { margin:0 0 1.3rem; font-size:1.06rem; font-weight:800; letter-spacing:-.01em; }
  .field { position:relative; margin-bottom:.85rem; }
  input[type=text], input[type=password] {
    width:100%; padding:.82rem 2.6rem .82rem 1rem; font-size:.94rem; font-family:inherit;
    text-align:center; border:1px solid transparent; border-radius:11px;
    background:var(--field); color:var(--forest);
  }
  input::placeholder { color:#93a3b8; }
  input[type=text]:focus, input[type=password]:focus {
    outline:none; border-color:var(--grass); box-shadow:0 0 0 3px rgba(114,200,123,.28);
  }
  .peek {
    position:absolute; right:.55rem; top:50%; transform:translateY(-50%);
    width:2rem; height:2rem; display:flex; align-items:center; justify-content:center;
    border:0; background:none; padding:0; cursor:pointer; color:#7c8ba0; border-radius:50%;
  }
  .peek:hover { color:var(--forest); }
  .remember {
    display:flex; align-items:center; justify-content:center; gap:.45rem;
    font-size:.79rem; color:var(--muted); margin:.55rem 0 1.15rem;
  }
  .remember input { accent-color:var(--grass); width:15px; height:15px; }
  button[type=submit] {
    width:100%; padding:.85rem; font-size:.95rem; font-weight:700; font-family:inherit;
    color:#fff; background:var(--grass); border:0; border-radius:11px; cursor:pointer;
  }
  button[type=submit]:hover { background:#5eb869; }
  .error {
    padding:.65rem .8rem; margin-bottom:1.05rem; border-radius:11px;
    background:#fdeceb; border:1px solid #f4c4c1; font-size:.82rem; color:#8f2020;
  }
  .foot {
    margin:1.5rem 0 0; padding-top:1.05rem; border-top:1px solid #e7ebe3;
    font-size:.71rem; color:var(--muted); line-height:1.55;
  }
  @media (max-width:420px) { .card { padding:2rem 1.4rem 1.5rem; border-radius:20px; } }
</style>
</head>
<body>
  <div class="bg" aria-hidden="true"></div>
  <form class="card" method="POST" action="/login" autocomplete="on">
    <img class="logo" src="${LOGO}" alt="Wayzen" width="186">
    <p class="sub">Reporting</p>

    <h1>Sign in</h1>

    ${error ? `<div class="error">${esc(error)}</div>` : ""}

    <input type="hidden" name="next" value="${esc(next)}">

    <div class="field">
      <input name="username" type="text" value="${esc(user)}" placeholder="Username"
             aria-label="Username" autocomplete="username" autocapitalize="none"
             autocorrect="off" spellcheck="false" required autofocus>
    </div>

    <div class="field">
      <input id="p" name="password" type="password" placeholder="Password"
             aria-label="Password" autocomplete="current-password" required>
      <button class="peek" type="button" aria-label="Show password" title="Show password">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
    </div>

    <label class="remember">
      <input type="checkbox" name="remember" value="1">
      Keep me signed in for ${REMEMBER_DAYS} days
    </label>

    <button type="submit">Sign in</button>

    <p class="foot">
      These pages contain player-level data. Do not share your login, and do not
      forward pages or exports outside the company.
    </p>
  </form>
<script>
  /* Progressive: without JS the button simply does nothing and the field still
     works as a normal password box. */
  (function () {
    var peek = document.querySelector(".peek"), pw = document.getElementById("p");
    if (!peek || !pw) return;
    peek.addEventListener("click", function () {
      var shown = pw.type === "text";
      pw.type = shown ? "password" : "text";
      peek.setAttribute("aria-label", shown ? "Show password" : "Hide password");
      peek.title = shown ? "Show password" : "Hide password";
      pw.focus();
    });
  })();
</script>
</body>
</html>`;
}
