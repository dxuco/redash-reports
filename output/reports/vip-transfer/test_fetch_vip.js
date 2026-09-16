/* Exercises fetch_vip.js without a network: global.fetch is stubbed with a
   fixture sheet and canned Redash responses. Proves the CSV parsing, the
   blank-ID username fallback, the date-typo repair and the SQL templating
   before any of it touches the real endpoints. */
const fs = require("fs"), path = require("path"), assert = require("assert");
const DATA = path.join(__dirname, "data");

const SHEET_CSV = [
 '"Request Received","Username","User ID","Source Casino","VA Name","Assignment","SLA","Onboarding Date","x","y"',
 '"7/1/2026","hasid","3111111","bitstarz","Lizi Utiashvili","","","8/9/2026","",""',
 '"7/2/2026","blankid","","punkz.com","Sophi Matchavariani","","","8/10/2026","",""',
 '"7/3/2026","typoyear","3333333","Stake","Ani Sulakveridze","","","8/11/2016","",""',
 '"7/4/2026","dupe","3111111","Stake","Lizi Utiashvili","","","8/12/2026","",""',
 '"7/5/2026","noVA","3555555","Stake","","","","8/13/2026","",""',
 '"7/6/2026","ambiguous","","Stake","Sophi Matchavariani","","","8/14/2026","",""',
].join("\n");

let sqlSeen = [];
global.fetch = async (url, opts) => {
  if (String(url).includes("docs.google.com"))
    return { ok: true, text: async () => SHEET_CSV };
  const body = JSON.parse(opts.body);
  sqlSeen.push(body.query);
  if (/lower\(p\.username\)/.test(body.query))
    return { ok: true, text: async () => JSON.stringify({ query_result: { data: { rows: [
      { sheet_username: "blankid",   matches: 1, player_id: 3222222 },
      { sheet_username: "ambiguous", matches: 2, player_id: 3999999 },
    ]}}})};
  return { ok: true, text: async () => JSON.stringify({ query_result: { data: { rows:
    [{ player_id: 3111111 }, { player_id: 3222222 }, { player_id: 3333333 }] }}})};
};

const keep = ["roster.json", "cohort.json", "depsize.json", "bonus.json",
              "daily.json", "contact.json", "tbfam.json", "tbonus.json",
              "tier.json"].map(f => [f, fs.readFileSync(path.join(DATA, f))]);
process.on("exit", () => keep.forEach(([f, buf]) => fs.writeFileSync(path.join(DATA, f), buf)));

require("./fetch_vip.js");
setTimeout(() => {
  const roster = JSON.parse(fs.readFileSync(path.join(DATA, "roster.json"), "utf8"));
  const by = Object.fromEntries(roster.map(r => [r.player_id, r]));
  const ok = (c, m) => { console.log((c ? "ok  : " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

  ok(roster.length === 3, `3 usable rows, got ${roster.length}`);
  ok(!!by[3111111], "row with a real User ID is kept");
  ok(by[3222222] && by[3222222].id_from === "username:blankid", "blank ID resolved by username and stamped");
  ok(by[3333333] && by[3333333].onboard === "2026-08-11", `year typo 2016 repaired, got ${by[3333333] && by[3333333].onboard}`);
  ok(!roster.some(r => r.player_id === 3999999), "ambiguous username (2 matches) is skipped, not guessed");
  ok(!roster.some(r => r.va === ""), "row with no VA is ignored");
  ok(by[3111111].casino === "BitStarz", `casino spelling normalised, got ${by[3111111].casino}`);
  ok(by[3222222].casino === "Punkz", "second casino spelling normalised");
  const cohort = sqlSeen.find(s => s.includes("loyalty_transfer_request"));
  ok(!!cohort, "cohort query was issued");
  ok(cohort && !cohort.includes("__SHEET_VALUES__"), "template placeholder was substituted");
  ok(cohort && cohort.includes("(3222222,'2026-08-10')"), "username-resolved player made it into the SQL");
  ok(JSON.parse(fs.readFileSync(path.join(DATA, "cohort.json"), "utf8")).length === 3, "cohort.json written");
  console.log(process.exitCode ? "\nFAILURES" : "\nall assertions passed");
}, 300);
