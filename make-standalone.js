/**
 * make-standalone.js — bakes data.json + app.js into one self-contained HTML file.
 *
 *   node make-standalone.js
 *
 * Produces bonus-cost-report.html, which you can double-click, email, or drop
 * on a shared drive. No server needed, because nothing is fetched at runtime.
 *
 * Trade-off: it's a snapshot. It shows the data as of the moment it was made.
 * The served version at http://localhost:8080 always reflects the latest build.
 */

const fs = require("fs");
const path = require("path");

const dir = __dirname;
const OUT = "bonus-cost-report.html";

function main() {
  for (const f of ["report.html", "app.js", "data.json"]) {
    if (!fs.existsSync(path.join(dir, f))) {
      console.error(`  Missing ${f} — run build.js first.`);
      process.exit(1);
    }
  }

  const shell = fs.readFileSync(path.join(dir, "report.html"), "utf8");
  const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");
  const data = fs.readFileSync(path.join(dir, "data.json"), "utf8");

  /* Keep everything above the runtime loader, drop the loader itself. */
  const cut = shell.indexOf("<script>");
  if (cut === -1) { console.error("  Could not find the loader script in report.html"); process.exit(1); }
  const head = shell.slice(0, cut);

  /* The app reads window.__DATA__ when served; inline it reads the JSON block. */
  const appInline = app.replace(
    "const D=window.__DATA__;",
    "const D=JSON.parse(document.getElementById('d').textContent);"
  );
  if (appInline === app) {
    console.error("  Could not repoint app.js at the inline data block.");
    process.exit(1);
  }

  /* </script> inside JSON would end the block early. Can't occur in this data,
     but escape it anyway so a future bonus name can't break the file. */
  const safeData = data.replace(/<\/script>/gi, "<\\/script>");

  let built = "";
  try { built = new Date(JSON.parse(data).generated_at).toLocaleString(); } catch {}

  const html =
    head +
    `<script id="d" type="application/json">${safeData}</script>\n` +
    `<script>\n${appInline}\n` +
    (built ? `document.querySelector('.sub')?.insertAdjacentHTML('beforeend',' &middot; data built ${built}');\n` : "") +
    `</script></body></html>\n`;

  fs.writeFileSync(path.join(dir, OUT), html);

  const mb = (fs.statSync(path.join(dir, OUT)).size / 1048576).toFixed(1);
  console.log(`\n  Wrote ${OUT} — ${mb} MB${built ? `, data built ${built}` : ""}`);
  console.log(`  Double-click it, or send it to anyone. No server needed.\n`);
}

main();
