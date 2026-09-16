"""Builds country-funnel-data.json from PostHog query results.

SOURCE
------
PostHog project "Production" (id 4163, eu.posthog.com), pulled 2026-09-03 via
the PostHog MCP. Unlike the other reports in this folder, the input is NOT the
Redash month caches -- PostHog is the only system that records the pre-
registration steps (pageview, registration modal, deposit modal). Redash knows
deposits and affiliate attribution; it does not know what a visitor clicked.

The two result sets below are pasted from those queries verbatim so the build
is reproducible without a live connection. To refresh, re-run the SQL in
QUERY_FUNNEL / QUERY_SELFREF against PostHog and replace the blocks.

WINDOW
------
2026-05-01 to 2026-09-02 inclusive. It starts in May because
`registration_success` was only instrumented from 2026-05, and the funnel needs
it. It ends on 2 September because 3 September was still in progress at the pull
date -- a partial day would read as a collapse.

FUNNEL DEFINITION
-----------------
Person-level and strictly cumulative: a person counts at step N only if they
also reached every earlier step. Steps are:

  1 visitors    $pageview
  2 reg_modal   registration_modal_open OR "Registration Modal Opened"
  3 registered  registration_success
  4 dep_modal   deposit_modal_opened
  5 deposited   Deposit

Country is taken from the geoip on the person's FIRST pageview, never from the
Deposit event -- deposits are emitted server-side and every one of them
geolocates to France (the backend's host country), which is why a naive
country split of deposits returns nonsense.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

QUERY_FUNNEL = """
SELECT country,
       count()                          AS s1_visitors,
       countIf(a)                       AS s2_reg_modal,
       countIf(a AND b)                 AS s3_registered,
       countIf(a AND b AND c)           AS s4_dep_modal,
       countIf(a AND b AND c AND d)     AS s5_deposited
FROM (
  SELECT person_id,
         argMinIf(properties.$geoip_country_name, timestamp, event = '$pageview') AS country,
         max(event = '$pageview')                                                 AS saw_page,
         max(event IN ('registration_modal_open','Registration Modal Opened'))    AS a,
         max(event = 'registration_success')                                      AS b,
         max(event = 'deposit_modal_opened')                                      AS c,
         max(event = 'Deposit')                                                   AS d
  FROM events
  WHERE event IN ('$pageview','registration_modal_open','Registration Modal Opened',
                  'registration_success','deposit_modal_opened','Deposit')
    AND timestamp >= toDateTime('2026-05-01 00:00:00')
    AND timestamp <  toDateTime('2026-09-03 00:00:00')
  GROUP BY person_id
  HAVING saw_page AND country != ''
)
GROUP BY country HAVING s1_visitors >= 300 ORDER BY s1_visitors DESC
"""

QUERY_SELFREF = """
SELECT properties.$geoip_country_name AS country,
       uniq(person_id)                                                          AS persons,
       uniqIf(person_id, properties.$referring_domain = 'fortunejack.com')      AS selfref_persons
FROM events
WHERE event = '$pageview'
  AND timestamp >= toDateTime('2026-05-01 00:00:00')
  AND timestamp <  toDateTime('2026-09-03 00:00:00')
  AND properties.$geoip_country_name != ''
GROUP BY country HAVING persons >= 300 ORDER BY persons DESC
"""

# country, visitors, reg_modal, registered, dep_modal, deposited
QUERY_MONTHLY = """
Same funnel, grouped by (person, month) instead of (person). A person who came
back in three months counts in all three; the cumulative rule is applied WITHIN
each month, so a person who registered in June and deposited in July is a
registrant in June and does not appear as a June depositor.

Only months with at least 40 visitors are returned, so a country's monthly rows
can add up to less than its total row. That is deliberate -- a 6-visitor month
produces rates that are pure noise.
"""

# country|month|visitors|reg_modal|registered|dep_modal|deposited


QUERY_MTD = """
Identical to QUERY_MONTHLY with one extra predicate:

    AND toDayOfMonth(timestamp) <= 29

29 is the day count of the current month at the pull date (August 1-29). Trimming
every month to the same number of days is what makes a month-to-date figure
comparable with complete months -- without it, August is being judged against
Julys that had two extra days to accumulate. This is the same MTD convention the
other reports in this folder use.

August is identical in both sets, because the window already ends on the 29th.
That is the point, not a bug: MTD changes the months you are comparing AGAINST.
"""

# country|month|visitors|reg_modal|registered|dep_modal|deposited, days 1-29 only


MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]

# ---------------------------------------------------------------------------
# These five blocks used to be transcribed query output pasted straight into
# this file -- roughly 770 lines of it. Re-typing them each refresh is how
# eight country rows got invented earlier in this project, so they are read
# from raw/country-periods.txt now instead. Same shapes, no typing.
#
#   raw/country-periods.txt   country | <period>~v,rm,r,dm,dp  ... plus
#                             sr~pageviews,selfreferred and
#                             se~sessions,avg,median,bounce,pageviews
# ---------------------------------------------------------------------------
_RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")


def _country_periods():
    out = {}
    path = os.path.join(_RAW, "country-periods.txt")
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("c|"):
                continue
            c, _, packed = line.partition("|")
            per = {}
            for tok in packed.split(" "):
                k, _, v = tok.partition("~")
                if v:
                    per[k] = v.split(",")
            if per:
                out[c] = per
    return out


_CP = _country_periods()

# Countries are ranked by registrants and cut to the same size the page has
# always shown, so a refresh does not silently change how many markets appear.
_RANKED = sorted(_CP, key=lambda c: -int(_CP[c].get("all", ["0"] * 5)[2]))
COUNTRY_LIMIT = 60
_KEEP = [c for c in _RANKED if c and c != "(null)"][:COUNTRY_LIMIT]

FUNNEL = [tuple([c] + [int(x) for x in _CP[c]["all"]]) for c in _KEEP]
SELFREF = [(c, int(_CP[c]["sr"][0]), int(_CP[c]["sr"][1]))
           for c in _KEEP if "sr" in _CP[c]]

MONTHLY_TSV = "\n".join(
    "|".join([c, k] + _CP[c][k])
    for c in _KEEP for k in sorted(_CP[c])
    if len(k) == 7 and k.startswith("2026-"))

MTD_TSV = "\n".join(
    "|".join([c, k[:-1]] + _CP[c][k])
    for c in _KEEP for k in sorted(_CP[c])
    if k.endswith("M") and len(k) == 8)

SESSIONS_TSV = "\n".join(
    "|".join([c] + _CP[c]["se"]) for c in _KEEP if "se" in _CP[c])


def _country_sources():
    """raw/country-sources.txt -> the window rows SOURCES_TSV used to hold."""
    rows = []
    path = os.path.join(_RAW, "country-sources.txt")
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("c|"):
                continue
            c, _, packed = line.partition("|")
            if c not in _KEEP:
                continue
            for tok in packed.split(" "):
                bits = tok.split("~")
                if len(bits) == 3 and bits[1] == "all":
                    rows.append("|".join([c, bits[0]] + bits[2].split(",")))
    return "\n".join(rows)


SOURCES_TSV = _country_sources()

# September is only two complete days old at the pull date, so MTD trims every
# month to days 1-2. That makes September comparable, at the cost of comparing
# very small slices -- 2026-09M and 2026-09 are necessarily identical.
MTD_DAY = 2

# Tracking changed on 29 August 2026: daily uniques fell from ~100,000 to ~3,500
# and stayed there, while registrations and deposits did not move. Sessions and
# devices fell with people, so this is not person-ID stitching -- it is roughly
# 95,000 junk sessions a day (about 1.8 pageviews each, converting at nil) that
# stopped being recorded. Pageviews-per-session went from 1.8 to 8.
#
# Consequence: step 1 is NOT comparable across this date, so every ratio built
# on visitors jumps about 25x on 29 August for reasons that have nothing to do
# with the product. Absolute counts (registered, deposited) stay comparable.
# The page draws a break here and warns on any ratio spanning it.
BREAK_DAY = "2026-08-29"

QUERY_SOURCES = """
Same window funnel, additionally grouped by first-touch referring domain:

  coalesce(nullIf(argMinIf(properties.$referring_domain, timestamp,
                           event='$pageview'), ''), '(none)') AS src

Source is the referrer on the person's FIRST pageview, so a person belongs to
exactly one source and the source rows are disjoint. They still do not add up to
the country row -- everything below the s2 >= 15 cut is missing -- so the page
computes an "Other" remainder from the country total rather than pretending the
listed sources are everything.

Restricted to the 30 countries with enough registrants for a source split to
mean anything, and to sources with at least 15 people reaching the registration
modal.
"""

# country|source|visitors|reg_modal|registered|dep_modal|deposited


QUERY_SESSIONS = """
SELECT country, count() AS sessions, round(avg(dur)) AS avg_sec,
       round(quantile(0.5)(dur)) AS median_sec,
       round(100*countIf(pv<=1 AND dur<1)/count(),1) AS bounce_pct,
       round(avg(pv),2) AS avg_pageviews
FROM (
  SELECT properties.$session_id AS sid,
         argMin(properties.$geoip_country_name, timestamp) AS country,
         dateDiff('second', min(timestamp), max(timestamp)) AS dur,
         countIf(event='$pageview') AS pv
  FROM events
  WHERE timestamp >= toDateTime('2026-05-01 00:00:00')
    AND timestamp <  toDateTime('2026-09-03 00:00:00')
    AND notEmpty(properties.$session_id)
  GROUP BY sid HAVING country != ''
)
GROUP BY country HAVING sessions >= 200 ORDER BY sessions DESC

These are ALL sessions in the window, not only registrants' sessions -- it is a
market-level engagement figure sitting beside funnel rates, and the two have
different denominators on purpose.
"""

# country|sessions|avg_sec|median_sec|bounce_pct|avg_pageviews


# The five the page opens on: the largest registrant pools, which is where any
# absolute gain lives. Deliberately mixes healthy (Germany, Canada, Argentina)
# with broken (United States, Mexico) so the contrast is visible on load.
DEFAULTS = ["United States", "Germany", "Argentina", "Mexico", "Canada"]

STEPS = ["Visitors", "Registration modal", "Registered", "Deposit modal", "Deposited"]


def main():
    sr = {c: (s / p * 100.0 if p else 0.0) for c, p, s in SELFREF}

    # --- session engagement ------------------------------------------------
    sess = {}
    for line in SESSIONS_TSV.strip().splitlines():
        c, n_s, avg_s, med_s, bounce, avg_pv = line.split("|")
        sess[c] = {
            "sessions": int(n_s),
            "avg": int(avg_s),
            "med": int(med_s),
            "bounce": float(bounce),
            "pv": float(avg_pv),
        }

    # Two different distortions hit these numbers, and conflating them flags
    # half the table for no reason:
    #
    #  - the MEAN is wrecked by a few sessions with thousands of pageviews.
    #    Italy averages 63 pageviews per session and 45 minutes, Bulgaria 55 and
    #    49, Greece 25 and 22. Everywhere else is under 9. That is what `skewed`
    #    marks, and `avg > 10x median` does NOT isolate it -- it fires on any
    #    market with a low median, which is most of them.
    #
    #  - the MEDIAN is dragged down by the flood of near-zero self-referred
    #    sessions. That is already carried per country by `sr`, so the page
    #    reuses that flag rather than inventing a second one.
    for c, s in sess.items():
        s["skewed"] = s["pv"] > 10

    # --- monthly series, full months and MTD-trimmed ------------------------
    known = {c for c, *_ in FUNNEL}

    def parse_months(tsv, label):
        out = {}
        for line in tsv.strip().splitlines():
            parts = line.split("|")
            c, m = parts[0], parts[1]
            if c not in known:      # keep the picker and the totals in step
                continue
            vals = [int(v) for v in parts[2:]]
            assert vals == sorted(vals, reverse=True), \
                f"{label} {c} {m}: month is not monotonic"
            assert m in MONTHS, f"{label} {c}: unexpected month {m}"
            out.setdefault(c, {})[m] = vals
        return out

    monthly = parse_months(MONTHLY_TSV, "full")
    mtd = parse_months(MTD_TSV, "mtd")

    # --- player lists -------------------------------------------------------
    # raw/*.txt are verbatim PostHog result files (country|src|n|packed). Each
    # player is packed as  username~MM-DD~<modal><deposit>~minutes  so ten
    # thousand of them fit in a handful of query results instead of twenty-odd
    # paginated ones. A username of "-" means the person fired
    # registration_success but no Username was ever set on the person record --
    # that is a finding, not a gap, so it is kept.
    #
    # The pull deliberately excludes fortunejack.com: those are the
    # attribution-lost bucket, not a source anyone can act on.
    raw_dir = os.path.join(HERE, "raw")
    # raw/country-src-players.txt is one row per country, with the source folded
    # into each token:
    #   country | src~username~MM-DD~<modal><deposit>~minutes  ...
    #
    # This used to glob EVERY .txt in raw/ and accept any line with four or more
    # pipe fields. That silently kept loading superseded pull files months after
    # they were replaced -- the page was still serving 29 August player lists
    # while every other section had moved on. It reads exactly one file now, so
    # a stale file left in raw/ is inert rather than authoritative.
    players = {}
    pl_path = os.path.join(raw_dir, "country-src-players.txt")
    if os.path.isfile(pl_path):
        with open(pl_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("c|"):
                    continue
                c, _, packed = line.partition("|")
                if c not in known or not packed:
                    continue
                for tok in packed.split(" "):
                    if not tok:
                        continue
                    bits = tok.split("~")
                    if len(bits) != 5:
                        continue
                    src, name, day, flags, mins = bits
                    players.setdefault((c, src), {"rows": [], "n": 0})["rows"].append({
                        "u": name,
                        "d": day,
                        "m": flags[0] == "1",   # reached the deposit modal
                        "f": flags[1] == "1",   # first deposit
                        "t": int(mins) if mins.lstrip("-").isdigit() else 0,
                    })
        for _v in players.values():
            _v["n"] = len(_v["rows"])

    # --- source split -------------------------------------------------------
    sources = {}
    for line in SOURCES_TSV.strip().splitlines():
        parts = line.split("|")
        c, s = parts[0], parts[1]
        if c not in known:
            continue
        vals = [int(v) for v in parts[2:]]
        assert vals == sorted(vals, reverse=True), f"{c} / {s}: not monotonic"
        entry = {"s": s, "f": vals}
        pl = players.get((c, s))
        if pl:
            # The player pull ran later than the aggregate pull, so its counts
            # are a few higher on live days. Take the player list as truth for
            # registrants and FTDs -- otherwise the drilldown would not add up
            # to the row it sits under, which is the one thing a drilldown must
            # do. Visits stays from the aggregate; it is not in the player list.
            entry["f"] = [vals[0], vals[1], len(pl["rows"]), vals[3],
                          sum(1 for r in pl["rows"] if r["f"])]
            entry["p"] = pl["rows"]
            if pl["n"] > len(pl["rows"]):
                entry["cap"] = pl["n"]      # list truncated at the query cap
        sources.setdefault(c, []).append(entry)

    # Sources are disjoint -- first touch, so a person has exactly one -- but
    # they do not cover the country, because everything under the query's
    # cut-off is missing. Emit the remainder explicitly rather than letting the
    # rows quietly fail to add up. Pro-rating it across the listed sources would
    # make the columns tie and every figure invented.
    totals = {c: f for c, f, *_ in [(r[0], list(r[1:])) for r in FUNNEL]}

    # Registrants and FTDs per source come from the player pull, which ran later
    # than the country pull, so on live days the sources add up to slightly MORE
    # than the country row. Clamping the remainder at zero hid that but left a
    # nonsense row ("4,373 visits, 0 registrants") and columns that visibly did
    # not add up. Adopt the higher figure at country level instead: the country
    # row moves up by the drift, the remainder is non-negative by construction,
    # and every column sums exactly.
    bumped = []
    for c, lst in sources.items():
        for i in (2, 4):
            s = sum(x["f"][i] for x in lst)
            if s > totals[c][i]:
                bumped.append(f"{c} step {i+1}: {totals[c][i]} -> {s}")
                totals[c][i] = s
        # the bump must not break the funnel it sits in
        assert totals[c][2] <= totals[c][1], f"{c}: registrants now exceed reg modal"
        assert totals[c][4] <= totals[c][3], f"{c}: FTDs now exceed deposit modal"
    if bumped:
        print("note: country totals raised to match the later source pull: "
              + ", ".join(bumped))

    drift = []
    for c, lst in sources.items():
        lst.sort(key=lambda x: -x["f"][2])
        rest = [totals[c][i] - sum(x["f"][i] for x in lst) for i in range(5)]
        # A small negative remainder is live-data drift: the source query ran
        # after the country query and PostHog kept ingesting between them
        # (Poland gained 3 depositors). Clamp it and record it. A LARGE negative
        # would mean the two queries are not measuring the same thing, which is
        # a real bug, so that still fails the build.
        for i, v in enumerate(rest):
            if v < 0:
                lim = totals[c][i] * 0.05 + 3
                assert -v <= lim, (f"{c} step {i+1}: sources exceed the country "
                                   f"total by {-v}, beyond ingestion drift")
                drift.append(f"{c} step {i+1}: +{-v}")
                rest[i] = 0
        # Clamping each step independently can leave the remainder row
        # non-monotonic -- step 3 clamped to zero while step 4 still holds four
        # real first deposits -- and a funnel row that goes up is a bug on
        # sight. Repair it BACKWARDS, raising the earlier steps to cover the
        # later ones, rather than forwards. Forwards would clamp those four
        # deposits away to keep the shape, which loses real people to make the
        # arithmetic tidy. Backwards keeps them and lifts the country total by
        # the same amount, which is where the drift belongs anyway.
        for i in range(3, -1, -1):
            rest[i] = max(rest[i], rest[i + 1])
        # totals are now listed + remainder by construction, so every column on
        # the page adds up exactly
        for i in range(5):
            totals[c][i] = sum(x["f"][i] for x in lst) + rest[i]
        if rest[0] > 0:
            lst.append({"s": "Other / below cut-off", "f": rest, "rest": True})
    if drift:
        print("note: source rows slightly exceed the country total where the "
              "later pull caught new events: " + ", ".join(drift))

    # --- per-day series -----------------------------------------------------
    # raw/day-funnel.txt and raw/day-rail.txt are verbatim PostHog results,
    # packed one row per country as  MM-DD:a,b,c,d,e  so 121 days x 60 markets
    # fit inside the 500-row result cap. Only days with at least 10 visitors are
    # in the funnel file: below that a day's rates are noise, and the day picker
    # should not offer a date it cannot say anything about.
    def read_packed_days(fn, width):
        out = {}
        path = os.path.join(raw_dir, fn)
        if not os.path.isfile(path):
            return out
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("country|"):
                    continue
                c, _, packed = line.partition("|")
                if c not in known or not packed:
                    continue
                days = {}
                for tok in packed.split(" "):
                    if ":" not in tok:
                        continue
                    md, _, nums = tok.partition(":")
                    vals = [int(v) for v in nums.split(",")]
                    if len(vals) != width:
                        continue
                    days["2026-" + md] = vals
                if days:
                    out[c] = days
        return out

    # Days come from the same refreshed file as every other period. They used to
    # be read from raw/day-funnel.txt, which is a separate older pull -- so a
    # refresh moved the window, the months and the MTD label to 30 August while
    # the day list quietly still ended on the 29th.
    day_funnel = {c: {"2026-" + k: [int(x) for x in v]
                      for k, v in per.items()
                      if len(k) == 5 and k[2] == "-"}
                  for c, per in _CP.items() if c in _KEEP}
    day_funnel = {c: d for c, d in day_funnel.items() if d}

    def _country_day_rails():
        out = {}
        path = os.path.join(_RAW, "country-rails.txt")
        if not os.path.isfile(path):
            return out
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("c|"):
                    continue
                c, _, packed = line.partition("|")
                if c not in _KEEP:
                    continue
                days = {}
                for tok in packed.split(" "):
                    k, _, v = tok.partition("~")
                    if len(k) == 5 and k[2] == "-" and v:
                        days["2026-" + k] = [int(x) for x in v.split(",")]
                if days:
                    out[c] = days
        return out

    day_rail = _country_day_rails()

    # Country comes from the person's first pageview WITHIN the period being
    # measured, so someone whose first view that day was Bulgarian and whose
    # first view that month was Spanish is Bulgarian on the day and Spanish in
    # the month. That makes a day legitimately exceed its month occasionally.
    # It is rare; a systemic break -- a shifted column, a bad date -- would put
    # most days over, so assert on the rate and print the exceptions.
    day_over = []
    day_checked = 0
    for c, days in day_funnel.items():
        for d, vals in days.items():
            assert vals == sorted(vals, reverse=True), f"{c} {d}: day is not monotonic"
            mon = monthly.get(c, {}).get(d[:7])
            if not mon:
                continue
            for i in range(5):
                day_checked += 1
                if vals[i] > mon[i]:
                    day_over.append(f"{c} {d} step {i+1}: {vals[i]} vs month {mon[i]}")
    assert len(day_over) <= day_checked * 0.02, \
        f"{len(day_over)} of {day_checked} day-steps exceed their month:\n" \
        + "\n".join(day_over[:20])
    if day_over:
        print(f"note: {len(day_over)} of {day_checked} day-steps exceed their "
              f"month (country attribution differs per period): "
              + ", ".join(day_over[:6]) + (" ..." if len(day_over) > 6 else ""))
    for c, days in day_rail.items():
        for d, v in days.items():
            assert v[1] <= v[0] and v[3] <= v[2], f"{c} {d}: rail deposits exceed starts"

    all_days = sorted({d for days in day_funnel.values() for d in days})
    print(f"days: {len(all_days)} dates, {len(day_funnel)} countries")

    rows = []
    for c, v, rm, rg, dm, dp in FUNNEL:
        # the window figures, after any upward bump from the source pull above
        v, rm, rg, dm, dp = totals[c]
        # every step must be a subset of the one before it, or the cumulative
        # AND in the query was wrong and every rate below is meaningless
        assert v >= rm >= rg >= dm >= dp, f"{c}: funnel is not monotonic"
        rows.append({
            "c": c,
            "f": [v, rm, rg, dm, dp],
            "sr": round(sr.get(c, 0.0), 1),
            # the two rates that actually decide the market
            "regToDep": round(dp / rg * 100.0, 1) if rg else None,
            "modalToDep": round(dp / dm * 100.0, 1) if dm else None,
            "visToReg": round(rg / v * 100.0, 2) if v else None,
            "sess": sess.get(c),
            # per-period counts the page switches between; the window figure
            # above stays the default
            "m": monthly.get(c, {}),
            "mtd": mtd.get(c, {}),
            "d": day_funnel.get(c, {}),
            "src": sources.get(c),
        })

    # benchmark = pooled reg -> deposit across every market with >= 200
    # registrants, so a single tiny market cannot move it
    big = [r for r in rows if r["f"][2] >= 200]
    bench = sum(r["f"][4] for r in big) / sum(r["f"][2] for r in big) * 100.0

    # gap = depositors this market would have produced at the benchmark rate.
    # Only meaningful where the funnel is wide enough to be worth fixing.
    for r in rows:
        reg = r["f"][2]
        r["gap"] = round(reg * bench / 100.0 - r["f"][4]) if reg >= 200 else None

    # A trimmed month can never hold more people than the whole month -- for a
    # month that has finished. The CURRENT month is still accumulating: the two
    # result sets were pulled minutes apart on 2026-08-29 and August kept moving
    # between them, which is why Algeria reads 147 trimmed against 146 full.
    # Assert strictly on closed months and allow live drift on the open one.
    CURRENT = MONTHS[-1]

    # The window already ends on the 29th, so for the current month "trimmed to
    # 29 days" and "the whole month so far" are the SAME measurement. Rather
    # than tolerate the gap between two pulls, take the later one for both --
    # otherwise switching the MTD toggle appears to change August, which it must
    # not, and the apparent change is only ingestion drift.
    for c, byMonth in mtd.items():
        if CURRENT in byMonth and c in monthly:
            monthly[c][CURRENT] = byMonth[CURRENT]

    for c, byMonth in mtd.items():
        for m, vals in byMonth.items():
            full = monthly.get(c, {}).get(m)
            if not full:
                continue
            for s in range(5):
                assert vals[s] <= full[s], \
                    f"{c} {m} step {s+1}: MTD {vals[s]} > full month {full[s]}"

    series = {}
    for c, byMonth in monthly.items():
        series[c] = [[byMonth[m][s] if m in byMonth else None for m in MONTHS]
                     for s in range(5)]
    # Distinct never sums: someone who visited in June and July is one person
    # in the window total and two in the monthly rows, so the months legitimately
    # add up to MORE than the total.
    #
    # A single month can also exceed its window figure, for a subtler reason:
    # country comes from the person's FIRST pageview in the period being
    # measured. Someone who first appeared from Spain in May and from India in
    # June is Spanish over the window and Indian in June. India has one June
    # depositor and zero over the window for exactly that reason.
    #
    # That is real and small. A systemic break -- a shifted column, a bad join --
    # would put most country-steps over, so assert on the rate rather than on
    # each one, and print them so a growing number gets noticed.
    totals = {r["c"]: r["f"] for r in rows}
    over = []
    for c, arr in series.items():
        for s in range(5):
            worst = max((v for v in arr[s] if v is not None), default=0)
            if worst > totals[c][s]:
                over.append(f"{c} step {s+1}: month {worst} vs window {totals[c][s]}")
    checked = len(series) * 5
    assert len(over) <= checked * 0.02, \
        f"{len(over)} of {checked} country-steps exceed their window figure:\n" \
        + "\n".join(over[:20])
    if over:
        print(f"note: {len(over)} of {checked} country-steps exceed the window "
              f"figure (visitors who changed country between months):")
        for line in over:
            print("      " + line)

    # --- payment rails ------------------------------------------------------
    # Steps 4 and 5 are the only ones a rail applies to; nobody has a payment
    # method when they land on a page. So a rail view keeps steps 1-3 and swaps
    # the last two:
    #
    #   fiat    started = manage-balance-fiat-iframe-loaded
    #           deposited = Deposit with Currency in EUR/BRL/CAD/PLN/ARS
    #   crypto  started = "Copy address clicked"
    #           deposited = Deposit with any other Currency
    #
    # Both "started" signals UNDERCOUNT: a saved wallet deposits without copying
    # an address, which is why crypto deposits can exceed copy-address clicks in
    # some markets. Treat a rail view as "of the people who visibly entered this
    # rail", not "of everyone who used it".
    #
    # Only rows at or above the query's small-count cut-off are here, so a
    # country or source with no row shows a dash rather than a fabricated zero.
    def read_rail(fn, keyed_by_month):
        out = {}
        path = os.path.join(raw_dir, fn)
        if not os.path.isfile(path):
            return out
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line:
                    continue
                parts = line.split("|")
                c = parts[0]
                if c not in known:
                    continue
                if keyed_by_month:
                    k, vals = parts[1], [int(v) for v in parts[2:]]
                    out.setdefault(c, {})[k] = {"f": vals[0:2], "c": vals[2:4]}
                else:
                    vals = [int(v) for v in parts[1:]]
                    out[c] = {"f": vals[0:2], "c": vals[2:4]}
        return out

    # --- source detail per month --------------------------------------------
    # raw/src-months.txt and raw/src-mtd.txt are verbatim PostHog results,
    # packed one row per country as  source~YYYY-MM~v,rm,rg,dm,dp,fs,fd,cs,cd
    # so every country x source x month fits inside the 500-row result cap.
    #
    # Without these, section 03 showed window figures under a month heading:
    # the United States read 58 first depositors in August and 233 in the source
    # table below it. A number that looks right is worse than one that looks
    # wrong, which is why this is here.
    def read_src_periods(fn):
        out = {}
        path = os.path.join(raw_dir, fn)
        if not os.path.isfile(path):
            return out
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("country|"):
                    continue
                c, _, packed = line.partition("|")
                if c not in known or not packed:
                    continue
                for tok in packed.split(" "):
                    parts = tok.split("~")
                    if len(parts) != 3:
                        continue
                    src, month, nums = parts
                    if len(month) == 5:          # MM-DD from the day pull
                        month = "2026-" + month
                    vals = [int(v) for v in nums.split(",")]
                    if len(vals) != 9:
                        continue
                    assert vals[0] >= vals[1] >= vals[2] >= vals[3] >= vals[4], \
                        f"{c}/{src} {month}: funnel is not monotonic"
                    out.setdefault(c, {}).setdefault(src, {})[month] = {
                        "f": vals[0:5],
                        "rail": {"f": vals[5:7], "c": vals[7:9]},
                    }
        return out

    src_m = read_src_periods("src-months.txt")
    src_mtd = read_src_periods("src-mtd.txt")
    src_d = read_src_periods("src-days.txt")
    print(f"source months: {len(src_m)} countries, "
          f"{sum(len(v) for v in src_m.values())} sources")

    rail_w = read_rail("rail-window.txt", False)
    rail_m = read_rail("rail-months.txt", True)
    rail_mtd = read_rail("rail-mtd.txt", True)
    rail_src = read_rail("rail-sources.txt", True)   # keyed by source, not month

    # A rail can never carry more people than the deposit-modal step it sits
    # under, nor more deposits than starts. Catches a mistyped transcription.
    for r in rows:
        w = rail_w.get(r["c"])
        if not w:
            continue
        for k in ("f", "c"):
            assert w[k][0] <= r["f"][3], \
                f"{r['c']} {k}: {w[k][0]} starts exceed deposit modal {r['f'][3]}"
            assert w[k][1] <= w[k][0], \
                f"{r['c']} {k}: {w[k][1]} deposits exceed {w[k][0]} starts"
        r["rail"] = {"w": w,
                     "m": rail_m.get(r["c"], {}),
                     "mtd": rail_mtd.get(r["c"], {}),
                     # per-day rail arrives as [fiat start, fiat dep, crypto
                     # start, crypto dep]; reshape to the {f:[],c:[]} the page
                     # already understands
                     "d": {d: {"f": v[0:2], "c": v[2:4]}
                           for d, v in day_rail.get(r["c"], {}).items()}}
        for s in (r.get("src") or []):
            got = rail_src.get(r["c"], {}).get(s["s"])
            if got:
                for k in ("f", "c"):
                    assert got[k][1] <= got[k][0], f"{r['c']}/{s['s']} {k}"
                s["rail"] = got
    print(f"rails: {len(rail_w)} countries, "
          f"{sum(len(v) for v in rail_src.values())} source rows")
    # Attach the per-month source detail, and build the same "Other" remainder
    # row for each month: country month total minus the sources listed in it.
    # Clamped at zero and repaired backwards, exactly as the window remainder is,
    # so a month's source rows add up to the month's country row.

    for r in rows:
        by_src = src_m.get(r["c"], {})
        by_src_mtd = src_mtd.get(r["c"], {})
        if not by_src and not by_src_mtd:
            continue
        for s in (r.get("src") or []):
            if s.get("rest"):
                continue
            if s["s"] in by_src:
                s["m"] = by_src[s["s"]]
            if s["s"] in by_src_mtd:
                s["mtd"] = by_src_mtd[s["s"]]
        by_src_day = src_d.get(r["c"], {})
        for s in (r.get("src") or []):
            if not s.get("rest") and s["s"] in by_src_day:
                s["d"] = by_src_day[s["s"]]
        for key, monthly_src in (("m", by_src), ("mtd", by_src_mtd),
                                 ("d", by_src_day)):
            country_months = (r["m"] if key == "m"
                              else r["mtd"] if key == "mtd" else r["d"])
            for month, ctot in country_months.items():
                listed = [s for s in (r.get("src") or [])
                          if not s.get("rest") and month in s.get(key, {})]
                # The source pull ran after the country pull, so on live days a
                # month's sources can add up to slightly more than its country
                # row -- Finland August was 103 against 102. Adopt the higher
                # figure, exactly as the window totals do, so section 03 and
                # section 02 reconcile exactly instead of nearly.
                for i in range(5):
                    tot_i = sum(s[key][month]["f"][i] for s in listed)
                    if tot_i > ctot[i]:
                        ctot[i] = tot_i
                # Repair the shape BACKWARDS, raising earlier steps to cover
                # later ones. Forwards would clamp the bumped figure straight
                # back down -- Finland's 103 registrants against 102 at the
                # registration modal -- and the mismatch would survive.
                for i in range(3, -1, -1):
                    ctot[i] = max(ctot[i], ctot[i + 1])
                rest = [ctot[i] - sum(s[key][month]["f"][i] for s in listed)
                        for i in range(5)]
                rest = [max(0, v) for v in rest]
                for i in range(3, -1, -1):
                    rest[i] = max(rest[i], rest[i + 1])
                # Repairing the remainder backwards can raise a step above what
                # the country row said -- Finland August needed 12 residual
                # registrants where the country had room for 11. The country
                # total is listed + remainder by construction, so recompute it
                # rather than leave the two disagreeing by one person.
                for i in range(5):
                    ctot[i] = sum(s[key][month]["f"][i] for s in listed) + rest[i]
                for s in (r.get("src") or []):
                    if s.get("rest"):
                        s.setdefault(key, {})[month] = {
                            "f": rest, "rail": {"f": [0, 0], "c": [0, 0]}}

    # MTD is the same month trimmed to a day count, so it is a SUBSET of that
    # month and can never exceed it. The reconciliation above raises month and
    # MTD independently against their own source pulls, which left Bolivia July
    # at 24 MTD registrants against 23 for the whole month. The month is the
    # understated one, so raise it -- and put the same person into that month's
    # source remainder, or section 02 and section 03 stop reconciling. Running
    # this BEFORE the reconciliation does not work: it simply re-raises MTD.
    lifted = []
    for r in rows:
        for month, mv in (r.get("mtd") or {}).items():
            full = (r.get("m") or {}).get(month)
            if not full:
                continue
            delta = [0] * 5
            for i in range(5):
                if mv[i] > full[i]:
                    delta[i] = mv[i] - full[i]
                    lifted.append(f"{r['c']} {month} step{i+1}: {full[i]} -> {mv[i]}")
                    full[i] = mv[i]
            if any(delta):
                for src in (r.get("src") or []):
                    if src.get("rest") and month in src.get("m", {}):
                        for i in range(5):
                            src["m"][month]["f"][i] += delta[i]
                        break
            for i in range(3, -1, -1):
                full[i] = max(full[i], full[i + 1])
    if lifted:
        print(f"note: {len(lifted)} month-steps raised to cover their own MTD: "
              + ", ".join(lifted[:6]))

    # --- affiliate campaigns -------------------------------------------------
    # raw/btag-periods.txt is one row per campaign, every period packed into a
    # single field:  <period>~visits,reg_modal,registered,dep_modal,deposited
    # Periods are 'all', '2026-06', '2026-06M' (month-to-date) and '06-14'.
    #
    # The btag in the URL is affiliate_campaign-clickid, and the click id is
    # unique per click -- 3.7M distinct values across 4M visitors. Rows are
    # keyed on the part before the hyphen, which is the campaign.
    #
    # One trap worth recording: extractURLParameter returns NULL, not '', for a
    # visitor with no btag, and NULL != '' passes the filter in this dialect. An
    # early count of these campaigns therefore included 8,120 registrants who
    # carried no affiliate tag at all. The pull filters isNotNull explicitly.
    def read_packed_periods(filename, id_key, header):
        """Rows from a <id>|<period~a,b,c,d,e ...> file, plus a remainder row.

        Both the campaign pull and the site-wide source pull have this shape,
        including the __ALL__ row that lets the remainder be computed as
        "everything the pull saw, minus everything the table lists" rather than
        guessed. Written once so the two cannot drift apart.
        """
        rows = []
        path = os.path.join(raw_dir, filename)
        if not os.path.isfile(path):
            return rows

        packed_rows = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith(header):
                    continue
                ident, _, packed = line.partition("|")
                if not packed:
                    continue
                per = {}
                for tok in packed.split(" "):
                    if "~" not in tok:
                        continue
                    p, _, nums = tok.partition("~")
                    vals = [int(v) for v in nums.split(",")]
                    if len(vals) == 5:
                        per[p] = vals
                packed_rows[ident] = per

        overall = packed_rows.pop("__ALL__", {})

        def where(p):
            """Which bucket on a row does raw period `p` live in?"""
            if p == "all":
                return None, None                      # the window sits on "f"
            if p.endswith("M"):
                return "mtd", p[:-1]
            if len(p) == 7:                            # 2026-06
                return "m", p
            return "d", "2026-" + p                    # 06-14

        for ident in sorted(packed_rows,
                            key=lambda t: -packed_rows[t].get("all", [0] * 5)[2]):
            per = packed_rows[ident]
            entry = {id_key: ident, "f": per.get("all") or [0] * 5,
                     "m": {}, "mtd": {}, "d": {}}
            for p, vals in per.items():
                bucket, key = where(p)
                if bucket:
                    entry[bucket][key] = vals
            rows.append(entry)

        # Whatever the pull saw but the table does not list becomes one row, so
        # the table foots to the real total instead of quietly dropping a tail.
        if overall:
            rest = {id_key: "__rest__", "rest": True,
                    "f": [0] * 5, "m": {}, "mtd": {}, "d": {}}
            for p, tot in overall.items():
                bucket, key = where(p)
                listed = [0] * 5
                for row in rows:
                    vals = row["f"] if bucket is None else row[bucket].get(key)
                    if not vals:
                        continue
                    for i in range(5):
                        listed[i] += vals[i]
                diff = [max(0, tot[i] - listed[i]) for i in range(5)]
                # Backwards, for the reason recorded above the country version:
                # forwards would delete real people to tidy the arithmetic.
                for i in range(3, -1, -1):
                    diff[i] = max(diff[i], diff[i + 1])
                if bucket is None:
                    rest["f"] = diff
                else:
                    rest[bucket][key] = diff
            rows.append(rest)
        return rows

    def attach_rails(rows, id_key, kind):
        """Hang the fiat/crypto rail on each row, in the shape basis() expects.

        raw/rails-src-btag.txt is one file for both tables, keyed
        "S|<referring domain>" or "B|<campaign>". Note the key itself contains a
        pipe in a pipe-delimited file, so it must be split with maxsplit=2 --
        splitting on the first separator silently yields nothing at all.

        Each packed value is fiat_start,fiat_deposit,crypto_start,crypto_deposit
        for that period, cumulative in the same way as the country rails: the
        deposit requires the start, and the start requires the deposit modal.
        """
        path = os.path.join(raw_dir, "rails-src-btag.txt")
        if not os.path.isfile(path):
            return
        found = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("k|"):
                    continue
                parts = line.split("|", 2)
                if len(parts) != 3 or parts[0] != kind:
                    continue
                _, name, packed = parts
                per = {}
                for tok in packed.split(" "):
                    if "~" not in tok:
                        continue
                    p, _, nums = tok.partition("~")
                    v = [int(x) for x in nums.split(",")]
                    if len(v) == 4:
                        per[p] = {"f": [v[0], v[1]], "c": [v[2], v[3]]}
                found[name] = per

        hit = 0
        for row in rows:
            per = found.get(row.get(id_key))
            if not per:
                continue
            hit += 1
            rail = {"w": per.get("all"), "m": {}, "mtd": {}, "d": {}}
            for p, vals in per.items():
                if p == "all":
                    continue
                if p.endswith("M"):
                    rail["mtd"][p[:-1]] = vals
                elif len(p) == 7:
                    rail["m"][p] = vals
                else:
                    rail["d"]["2026-" + p] = vals
            row["rail"] = rail
        print(f"rails: {hit} of {len(rows)} {kind} rows carry a fiat/crypto split")

    def attach_players(rows, id_key, filename, header, prefix=None):
        """Hang a registrant list on each row, in the shape section 04 reads.

        Same packing as the per-country lists: username~MM-DD~<modal><deposit>
        ~minutes. A username of "-" means registration_success fired but no
        Username was ever set on the person -- kept, because that is a finding.

        The source pull excludes fortunejack.com deliberately: that bucket is
        the Cloudflare challenge eating the referrer, not a site anyone can act
        on, and it would be by far the largest list on the page.
        """
        path = os.path.join(raw_dir, filename)
        if not os.path.isfile(path):
            return
        found = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith(header):
                    continue
                parts = line.split("|", 2)
                if len(parts) != 3:
                    continue
                if prefix is None:
                    key, _n, packed = parts
                else:
                    # raw/players-src-btag.txt keys BOTH tables in one file:
                    #   B|<campaign>|packed   and   S|<referring domain>|packed
                    # Without splitting the prefix off, every key parses as the
                    # literal "B" or "S" and not a single row attaches.
                    if parts[0] != prefix:
                        continue
                    key, packed = parts[1], parts[2]
                lst = []
                for tok in packed.split(" "):
                    if not tok:
                        continue
                    bits = tok.split("~")
                    if len(bits) != 4:
                        continue
                    name, day, flags, mins = bits
                    lst.append({"u": name, "d": day,
                                "m": flags[0] == "1", "f": flags[1] == "1",
                                "t": int(mins) if mins.lstrip("-").isdigit() else None})
                if lst:
                    found[key] = lst

        hit = 0
        for row in rows:
            got = found.get(row.get(id_key))
            if got:
                row["p"] = got
                hit += 1
                # The list is the registrants; the row's own step 3 is the same
                # measure over the window, so they should agree closely. They
                # will not match exactly -- the list has a >=3 cut-off and the
                # row does not -- but a wild gap means the keys are misaligned.
                want = row["f"][2]
                if want and abs(len(got) - want) > max(5, want * 0.15):
                    print(f"  note: {row[id_key]} lists {len(got)} players "
                          f"against {want} registrants")
        print(f"players: {hit} of {len(rows)} {id_key} rows carry a list")

    def attach_click_errors(rows, id_key, filename, header):
        """Clicks followed by a $exception within five seconds, per period.

        Correlation, not cause. Measured per CLICK rather than per person on
        purpose: the share of a campaign's people who ever saw an error tracks
        engagement, not quality -- registration is HIGHER among error-hitters in
        every campaign measured (85% against 23% on the largest), because you
        have to stay on the site to encounter one. Clicks normalise that away.
        """
        path = os.path.join(raw_dir, filename)
        if not os.path.isfile(path):
            return
        found = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith(header):
                    continue
                ident, _, packed = line.partition("|")
                per = {}
                for tok in packed.split(" "):
                    k, _, v = tok.partition("~")
                    vals = [int(x) for x in v.split(",")] if v else []
                    if len(vals) == 2:
                        per[k] = vals
                if per:
                    found[ident] = per

        hit = 0
        for row in rows:
            per = found.get(row.get(id_key))
            if not per:
                continue
            hit += 1
            e = {"f": per.get("all"), "m": {}, "mtd": {}, "d": {}}
            for k, vals in per.items():
                if k == "all":
                    continue
                if k.endswith("M"):
                    e["mtd"][k[:-1]] = vals
                elif len(k) == 7:
                    e["m"][k] = vals
                else:
                    e["d"]["2026-" + k] = vals
            row["ce"] = e
        clicks = sum(v.get("all", [0, 0])[0] for v in found.values())
        errs = sum(v.get("all", [0, 0])[1] for v in found.values())
        print(f"click errors on {id_key}: {hit} of {len(rows)} rows, "
              f"{clicks:,} clicks, {100.0*errs/clicks:.1f}% followed by an error")

    btag_rows = read_packed_periods("btag-periods.txt", "t", "btag|")
    for entry in btag_rows:
        # A campaign id is affiliate_campaign. Anything without an underscore is
        # a malformed or test tag ('123', 'test123') rather than a real
        # placement. It is left in the table -- the traffic is real and removing
        # it would stop the rows adding up -- but flagged.
        entry["bad"] = not entry.get("rest") and "_" not in entry["t"]

    # Site-wide referring domains: the same table as the campaigns, but for
    # every country at once. Section 03 shows this until a country is clicked,
    # then switches to that country's own source rows.
    global_src = read_packed_periods("global-sources.txt", "s", "ref|")
    attach_rails(btag_rows, "t", "B")
    attach_rails(global_src, "s", "S")
    attach_players(btag_rows, "t", "players-src-btag.txt", "k|", "B")
    attach_click_errors(btag_rows, "t", "btag-errors.txt", "btag|")
    attach_players(global_src, "s", "players-src-btag.txt", "k|", "S")

    # --- which campaigns ran under which source ------------------------------
    # raw/src-btag.txt is one row per referring domain, packed as
    #   <campaign>~<period>~visits,reg_modal,registered,dep_modal,deposited
    # These are the pair's OWN figures, not the campaign's totals: a campaign
    # that also ran elsewhere contributes only its share here. Filtering the
    # campaign table on membership alone and showing each campaign's full
    # numbers would overstate every source it touches.
    xtab_path = os.path.join(raw_dir, "src-btag.txt")
    if os.path.isfile(xtab_path):
        by_ref = {}
        with open(xtab_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("ref|"):
                    continue
                ref, _, packed = line.partition("|")
                # NOT `rows` -- that name holds the country list in this
                # function, and shadowing it here replaced 60 countries with a
                # dict of campaigns. The build died on the next line rather
                # than writing a broken file, which is the only reason it was
                # cheap to find.
                per_tag = {}
                for tok in packed.split(" "):
                    bits = tok.split("~")
                    if len(bits) != 3:
                        continue
                    tag, p, nums = bits
                    vals = [int(v) for v in nums.split(",")]
                    if len(vals) != 5:
                        continue
                    entry = per_tag.setdefault(
                        tag, {"t": tag, "f": [0] * 5, "m": {}, "mtd": {}, "d": {}})
                    if p == "all":
                        entry["f"] = vals
                    elif p.endswith("M"):
                        entry["mtd"][p[:-1]] = vals
                    elif len(p) == 7:
                        entry["m"][p] = vals
                    else:
                        entry["d"]["2026-" + p] = vals
                if per_tag:
                    by_ref[ref] = sorted(per_tag.values(), key=lambda e: -e["f"][2])

        hit = 0
        for row in global_src:
            got = by_ref.get(row.get("s"))
            if got:
                row["bt"] = got
                hit += 1
        pairs = sum(len(v) for v in by_ref.values())
        print(f"source x campaign: {hit} sources carry {pairs} campaign rows")

    # --- clicks followed by an error ----------------------------------------
    # Two files, both keyed on the button label with the page inside the packed
    # field, because 883 qualifying pairs exceed the query row cap but 241
    # distinct buttons do not:
    #
    #   click-errors-periods.txt   btn | <path>~<period>~clicks,errors,people ...
    #   click-error-sessions.txt   btn | <path>~<session>~MM-DD~country ...
    #
    # "errors" means a $exception fired in the same session within five seconds
    # of the click. Correlation, not cause -- a page erroring continuously
    # scores high whatever is clicked -- so nothing here is named "caused".
    #
    # The 60-click / 20-error threshold is applied HERE rather than trusted from
    # the pull. An earlier version took the top 300 pairs by error count in one
    # query and the first 400 alphabetically in another, so the two files
    # described different pairs and the table silently mixed them.
    errs = []
    per_path = os.path.join(raw_dir, "click-errors-periods.txt")
    ses_path = os.path.join(raw_dir, "click-error-sessions.txt")
    if os.path.isfile(per_path):
        pairs = {}
        with open(per_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line or line.startswith("btn|"):
                    continue
                btn, _, packed = line.partition("|")
                if not btn:                      # unlabelled control, not a button
                    continue
                for tok in packed.split(" "):
                    bits = tok.split("~")
                    if len(bits) != 3:
                        continue
                    path, p, nums = bits
                    vals = [int(v) for v in nums.split(",")]
                    if len(vals) == 3:
                        pairs.setdefault((btn, path), {})[p] = vals

        sess = {}
        if os.path.isfile(ses_path):
            with open(ses_path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.rstrip("\n")
                    if not line or line.startswith("btn|"):
                        continue
                    btn, _, packed = line.partition("|")
                    for tok in packed.split(" "):
                        bits = tok.split("~")
                        if len(bits) != 4:
                            continue
                        path, sid, day, country = bits
                        sess.setdefault((btn, path), []).append(
                            {"s": sid, "d": day, "c": country.replace("_", " ")})

        for (btn, path), per in pairs.items():
            win = per.get("all")
            if not win or win[0] < 60 or win[1] < 20:
                continue
            entry = {"b": btn.replace("_", " "), "p": path,
                     "f": win, "m": {}, "mtd": {}, "d": {},
                     "ss": sess.get((btn, path), [])}
            for pk, vals in per.items():
                if pk == "all":
                    continue
                if pk.endswith("M"):
                    entry["mtd"][pk[:-1]] = vals
                elif len(pk) == 7:
                    entry["m"][pk] = vals
                else:
                    entry["d"]["2026-" + pk] = vals
            errs.append(entry)

        errs.sort(key=lambda e: -e["f"][1])
        missing = [e for e in errs if not e["ss"]]
        print(f"click errors: {len(errs)} button/page pairs, "
              f"{sum(len(e['ss']) for e in errs)} sampled sessions"
              + (f", {len(missing)} pairs with no sample" if missing else ""))

    # --- first deposits by acquisition channel -------------------------------
    # Channel is derived from the ENTRY referring domain -- the $referring_domain
    # on the person's first pageview -- because that is the only channel signal
    # PostHog carries. There is no $channel_type property on this project.
    #
    # This is deliberately NOT the four-band rule in ../ftd-channels (Streamer /
    # SEO / Direct / Other). That one classifies the AFFILIATE behind a first
    # deposit, out of Redash, and it can see things PostHog cannot. Naming these
    # bands the same would invite two different numbers under one word, so they
    # are named for what they actually are: where the visitor came in from.
    #
    # Sources are first-touch and disjoint -- one per person -- so a person lands
    # in exactly one band and the bands add up to the site total.
    CHANNEL_RULES = [
        ("Self-referred", lambda h: h == "fortunejack.com"
                                    or h.endswith(".fortunejack.com")),
        ("Direct", lambda h: h in ("$direct", "(none)", "")),
        ("Search", lambda h: any(t in h for t in (
            "google.", "bing.", "duckduckgo", "search.brave", "yandex",
            "yahoo.", "ecosia", "startpage", "qwant", "chatgpt", "perplexity",
            "googlequicksearchbox"))),
        ("Social", lambda h: h in ("t.co", "beacons.ai", "linktr.ee")
                             or any(t in h for t in (
            "facebook", "instagram", "twitter", "youtube", "tiktok", "reddit",
            "t.me", "telegram", "vk.com", "pinterest", "x.com"))),
    ]

    def channel_of(host):
        if host == "__rest__":
            return "Below the cut"
        for name, test in CHANNEL_RULES:
            if test(host):
                return name
        return "Affiliate & referral"

    CHANNEL_ORDER = ["Self-referred", "Direct", "Affiliate & referral",
                     "Search", "Social", "Below the cut"]
    chan = {}
    chan_refs = {}
    for row in global_src:
        if row.get("s") == "__ALL__":
            continue
        band = channel_of(row.get("s", ""))
        ent = chan.setdefault(band, {"c": band, "f": [0] * 5, "m": {}, "mtd": {}})
        for i in range(5):
            ent["f"][i] += row["f"][i]
        # Whole months AND the MTD trim, so the table can follow the page's own
        # month-span toggle. Without the MTD copy, a 2-day September sits beside
        # full months and reads as a collapse rather than a partial month.
        for key in ("m", "mtd"):
            for mo, vals in (row.get(key) or {}).items():
                tgt = ent[key].setdefault(mo, [0] * 5)
                for i in range(5):
                    tgt[i] += vals[i]
        chan_refs.setdefault(band, []).append(
            (row.get("s"), row["f"][4]))
    channels = [chan[b] for b in CHANNEL_ORDER if b in chan]
    for ent in channels:
        ent["refs"] = [r for r, _ in
                       sorted(chan_refs[ent["c"]], key=lambda x: -x[1])[:12]]

    # The bands must foot to the site total. global_src has already had __ALL__
    # turned into the __rest__ remainder, so checking against it would compare
    # the bands with themselves. Read the untouched site row back off the pull
    # instead -- that makes this a real check on the remainder arithmetic, not a
    # tautology that passes however wrong the bands are.
    _site = None
    with open(os.path.join(raw_dir, "global-sources.txt"), encoding="utf-8") as fh:
        for line in fh:
            ref, _, packed = line.rstrip("\n").partition("|")
            if ref != "__ALL__":
                continue
            for tok in packed.split(" "):
                k, _, v = tok.partition("~")
                if k == "all":
                    _site = [int(x) for x in v.split(",")]
    assert _site, "global-sources.txt carries no __ALL__ row"
    for i, step in enumerate(("visits", "reg modal", "registered",
                              "dep modal", "deposited")):
        got = sum(e["f"][i] for e in channels)
        assert got == _site[i], \
            f"channels {step}: bands total {got} vs site {_site[i]}"
    # Print the classification so a new referrer gets banded on purpose rather
    # than defaulting into Affiliate & referral unnoticed -- the same reason
    # ../ftd-channels prints every (aff_type, aff_source) pair it saw.
    print("channels: " + ", ".join(
        f"{e['c']} {e['f'][4]}" for e in channels)
        + f"  (site {_site[4]})")
    for e in channels:
        if e["c"] == "Affiliate & referral":
            print("  referral top: " + ", ".join(e["refs"][:8]))

    data = {
        "source": ("PostHog project Production (4163, eu.posthog.com), pulled "
                   "2026-09-03. Person-level cumulative funnel."),
        "window": {"start": "2026-05-01", "end": "2026-09-02"},
        "breakDay": BREAK_DAY,
        "breakNote": ("Tracking changed on 29 August: about 95,000 junk sessions "
                      "a day stopped being recorded. Visitor counts before and "
                      "after are not comparable, so any rate spanning this date "
                      "jumps for reasons unrelated to the product. Registrations "
                      "and deposits are unaffected."),
        "steps": STEPS,
        "defaults": DEFAULTS,
        "benchmark": round(bench, 1),
        "months": MONTHS,
        "days": all_days,
        "mtdDay": MTD_DAY,
        "monthly": series,
        "monthlyDefault": "United States",
        "countries": sorted(rows, key=lambda r: -r["f"][2]),
        "btags": btag_rows,
        "sources": global_src,
        "channels": channels,
        "clickErrors": errs,
        # every click in the pull, so the page can state the baseline
        # rather than leaving 91% to be read without a reference point
        "replayBase": "https://eu.posthog.com/project/4163/replay/",
        "caveats": [
            ("Step 1 is inflated wherever the self-referred share is high. A "
             "redirect on fortunejack.com is stripping the original referrer, "
             "so one returning visitor can be recorded as several new people. "
             "Brazil is 98.8% self-referred and its 2.4M visitors are not 2.4M "
             "people. Read steps 2-5, which are behavioural and unaffected."),
            ("registration_success was instrumented in 2026-05, so the window "
             "cannot start earlier. Deposits are server-side and geolocate to "
             "France; country comes from the person's first pageview instead."),
            ("Step 5 counts any deposit in the window by someone who also "
             "registered in it, so it is a new-player figure. Existing players "
             "depositing are excluded by the cumulative rule."),
            ("The monthly view applies the same cumulative rule within each "
             "month, so someone who registered in June and deposited in July "
             "is a June registrant and not a June depositor. Months with fewer "
             "than 40 visitors are omitted and the line breaks there."),
            ("Session times cover every session in the window, not only "
             "registrants' sessions, so they sit beside the funnel rates rather "
             "than inside them. The median is the figure to read: the mean is "
             "pulled by a small number of sessions with thousands of pageviews "
             "(Italy averages 63 pageviews per session, Bulgaria 55) and by the "
             "flood of near-zero self-referred sessions at the other end. Where "
             "the mean is more than ten times the median it is marked."),
            ("Monthly figures do not add up to the window total, and are not "
             "meant to: a person who visited in June and July is one person "
             "over the window and one in each of those two months. Add the "
             "months and you count returning people twice."),
        ],
    }

    dest = os.path.join(HERE, "country-funnel-data.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {dest}  ({os.path.getsize(dest):,} bytes, "
          f"{len(rows)} countries, benchmark {bench:.1f}%)")


if __name__ == "__main__":
    main()
