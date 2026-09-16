# Redash kit — drop this into another project

Reusable pieces from the Bonus Cost report, so a new project doesn't have to
rediscover how this Redash instance behaves.

**Read this first if you are an assistant picking up a new project.** The three
facts below cost several hours to work out. They are not in Redash's docs.

---

## What's in here

| File | What it does |
|---|---|
| `redash.js` | Runs a Redash query with parameters and returns rows + column order. |
| `export-csv.js` | Writes a CSV identical to a manual Redash export. |
| `config.env.example` | Copy to `config.env`, add the query API key. |

Requires Node 18+. No npm install, no dependencies.

---

## The three things that will otherwise waste your time

**1. A per-query API key cannot poll `/api/jobs/<id>`.** It returns 404 with
"Couldn't find resource. Please login and try again." Use the query-scoped path
instead: `/api/queries/<queryId>/jobs/<jobId>`.

**2. A per-query API key cannot GET a `query_result` by id at all.** Every
variant 404s. To collect a finished run, re-POST the *same parameters* with a
non-zero `max_age`; Redash then returns the rows inline. `redash.js` does this.

**3. Query 1731 filters by whole month.** Asking it for the 1st–16th returns the
entire month. Only 1732 is dated to the day. If you need month-to-date anything,
it has to come from 1732.

Also worth knowing: Redash is only reachable over the company VPN, so this cannot
run on a cloud runner. And the account's credentials are prefixed — `cfk_` is the
Global API Key (never use it), `cfut_`/`cfat_` are real scoped tokens.

---

## Usage

### Just refresh the CSV the project already reads

This is usually the whole job. Point `CSV_OUT` at the file the project expects,
and its existing code keeps working untouched.

```
node export-csv.js                                  current month so far
node export-csv.js --month=2026-07                  a specific month
node export-csv.js --from=2026-08-01 --to=2026-08-17
node export-csv.js --days=30
node export-csv.js --query=1731 --out="C:\proj\bonus.csv"
```

It writes to a temp file and renames, so a program reading the CSV never sees a
half-written file.

### Or use the rows directly

```js
const { runQuery, toCsv } = require("./redash");

const { rows, columns } = await runQuery({
  queryId: 1732,
  apiKey: process.env.REDASH_KEY_1732,
  parameters: {
    date_range: { start: "2026-08-01", end: "2026-08-31" },
    "Current Segment": "All",
  },
});
```

`columns` preserves Redash's own ordering, which matters if anything downstream
depends on column positions.

---

## Scale, so you plan for it

Query 1732 returns roughly **80,000–130,000 rows per month**, about 42 columns.
A full year is over a million rows and takes several minutes. Pull month by month
rather than in one request.

Query 1732's useful columns: `transaction_date`, `player_id`, `username`,
`player_country`, `current_segment`, `player_segment`, `financial_segment`,
`first_deposit_date`, `game_product`, `bet`, `ggr`, `ngr`, `adjusted_ggr`,
`deposit`, `withdraw`, `bonus_cost`, `bonus_id`, `bonus_name`, `bonus_group`.

Note there are three segment columns. `current_segment` is the one matching the
Vip / Elit / Regular / Mass / Risk / One Timer / Pre Elit / Free Rider / Churn
taxonomy. `financial_segment` uses a different one ("Old Regular", "Old Vip").

---

## Publishing, if the project also needs a live URL

The Bonus Cost project at `C:\redash-page` already has this working and the same
files can be copied:

- `make-standalone.js` — bakes a data file into one self-contained HTML
- `worker/worker.js` + `publish-worker.js` — publishes to Cloudflare behind a
  password, free tier, permanent address
- `install-schedule.bat` — a Windows task that wakes the PC and runs daily

That path avoids Cloudflare Access entirely, which matters because Zero Trust
onboarding asks for a card even on the free plan.
