#!/usr/bin/env python3
"""
Deposit retention — cohort table.

Reads the query-1732 month caches in ../ftd-report/cache/*.json (player x day
rows, 2025-01 onward) and emits retention-data.json. Makes no Redash calls: the
data is already on disk, and step 2 of UPDATE-EVERYTHING refreshes it.

WHAT A RETENTION EVENT IS HERE
------------------------------
A player is *retained* by day N if they made a **deposit** on some day 1..N
after their first. Betting is not retention on this page -- the question it
answers is whether first depositors come back and fund the account again, which
is the one the whole acquisition spend is judged on.

  day 0 = the player's first_deposit_date
  day N = a deposit dated exactly N days later

Deposits on day 0 are top-ups of the first deposit, not a return, so day 0 is
always zero and is not a column.

THE COHORT
----------
Calendar month, or ISO week, of `first_deposit_date`. Every player carries that
column on every one of their rows and it never disagrees with itself across
2.04M rows, so it is taken at face value rather than re-derived from `ftd`.

It agrees exactly with the `ftd > 0` count the Business Overview publishes in 18
of the 20 months. The two that differ (2025-05 and 2026-07) each carry one extra
player who has a first_deposit_date in the month and no row where ftd is
positive. They are kept -- a first deposit date is a first deposit.

August 2026 looked like a third such month and is not. Player 3951181 carries a
first_deposit_date of 2026-08-23, one day *after* the last date any cache
covers: their first deposit has not been loaded yet. The `obs < 0` guard drops
them, and August then reconciles to the published 1,020 on the nose.

Cohorts before 2025-01 are dropped for the mirror-image reason. Their day-0 sits
outside the cache, so their return history would be measured from a date whose
deposits were never loaded -- which reads as total churn rather than as missing
data.

WHY THIS EMITS PLAYERS AND NOT PRE-AGGREGATED CELLS
---------------------------------------------------
It used to emit one pre-computed set of arrays per `cohort|channel|rail`, and
the page picked a key. That works for two filter dimensions and collapses at
six: channel x rail x FTD type x KYC x email x phone is 216 combinations per
cohort, times 86 weekly cohorts, times a value per milestone -- tens of
thousands of keys, most of them never looked at.

So the unit of the payload is now the **player**: how many days they have been
observed, when they first came back, and a packed code for their attributes.
The page loops 18,817 of those on every filter change, which is well under a
millisecond, and any combination of dimensions works -- including ones nobody
has thought of yet. Adding a dimension costs one entry in DIMENSIONS and no
change to the page at all.

The cost is that the page can only answer questions these three numbers
support. Cumulative return by day N is one of them (`lag <= N`). "Deposited on
day N exactly" is not, and would need the day list back.

THE WHALE IS NOT AN ISSUE ON THIS PAGE
--------------------------------------
The carved-out players (see ../data-exclusions.json) -- karolik777 carries
60-72% of deposited dollars and forces
a toggle onto every other report here, first deposited on 2021-04-09 -- before
the earliest cohort. He is structurally out of scope, so there is no toggle:
this page counts players, not dollars, and one player cannot move a rate built
on 18,817 of them.
"""

import json
import glob
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))


def _flag(name, default):
    """--name=value, so the build can be pointed at a throwaway cache. Used by
    test_verification_dims.py to exercise the self-enabling filters against a
    synthetic month, which is the only way to test them until the real columns
    are backfilled."""
    pre = "--%s=" % name
    for a in sys.argv[1:]:
        if a.startswith(pre):
            return a[len(pre):]
    return default


CACHE = _flag("cache", os.path.join(HERE, "..", "ftd-report", "cache"))
OUT = _flag("out", os.path.join(HERE, "retention-data.json"))

HORIZON = 90                 # days of return history kept per player
MILESTONES = [1, 3, 7, 14, 30, 60, 90]
MIN_ELIGIBLE = 30            # below this a rate is noise; the page shows a dash
COHORT_FROM = "2025-01"      # the cache starts here; earlier cohorts are blind
MONEY_FROM = COHORT_FROM + "-01"   # only cohort members need their money tracked

# How many calendar months after the first deposit the monthly table can reach.
# 24 fits in one small integer per player and covers the whole cache; the page
# draws the first twelve.
#
# The monthly table is a DIFFERENT measure from the day table above it, not a
# coarser one. The day columns are cumulative -- "had come back by day N", which
# only rises. These are point-in-time -- "deposited in calendar month N" -- which
# falls, and is the classic cohort triangle. A player who returns in month 1,
# goes quiet in month 2 and comes back in month 3 is counted in M1 and M3 and not
# in M2. That is the whole point of the shape, and it is why this cannot be
# derived from the first-return lag the day table uses.
MONTH_HORIZON = 24

# The value table's metrics, in the order the page's switch shows them.
#
# ADPU is deposits per cohort member and ARPU is revenue per cohort member, both
# counted from day 0 -- the first deposit itself is part of what an acquired
# player is worth, unlike retention, where a same-day top-up is not a return.
#
# Two revenue definitions are offered rather than one being picked for you:
# NGR and adjusted GGR are computed upstream over different scopes and are NOT
# each other plus or minus bonus cost (see the note in the FTD report). Whichever
# the reader means, they can have it, and the header strip says which is on.
MONEY_METRICS = [
    # key,  button,            what the header strip and tooltips say,      column
    ("dep", "ADPU",            "ADPU — deposits per player",                "deposit"),
    ("ngr", "ARPU (NGR)",      "ARPU — net gaming revenue per player",      "ngr"),
    ("adj", "ARPU (adj GGR)",  "ARPU — adjusted GGR per player",            "adjusted_ggr"),
]

# The players every report carves out by default, shared so a tenth report
# cannot quietly disagree about who is in the list. See ../carveout.py. This
# page needs no toggle only because none of them first deposited inside its
# cohort range -- asserted below rather than assumed.
import sys
sys.path.insert(0, os.path.join(HERE, ".."))
from carveout import CARVED, CARVE_NAMES

# --------------------------------------------------------------- rails ------
# Copied verbatim from ../overview/build_overview.py, which took them from
# ftd-report/month-aggregate.js, so this page and the FTD report split
# crypto/fiat the same way. Two pages that classify rails differently is a worse
# bug than either being slightly wrong, because nobody can tell which is which.
# `mercado` stays out of FIAT_RAILS deliberately -- see the note there.
FIAT_RAILS = {
    "apple pay", "google pay", "interac", "mastercard", "mbway", "neteller",
    "paysafecard", "pix", "revolut", "sepa", "skrill", "visa", "wise",
    "astropay", "bancontact", "blik", "boleto", "bunq", "eps", "giropay",
    "ideal", "jeton", "klarna", "mifinity", "muchbetter", "n26", "open banking",
    "sofort", "trustly", "upi",
    # Multibanco: a Portuguese bank/ATM rail, so fiat. Added 2026-08 after the
    # cache backfill turned up exactly one deposit row using it -- immaterial
    # either way, but UNSEEN_RAILS exists so a new rail gets classified on
    # purpose rather than defaulting into crypto. Added to month-aggregate.js
    # in the same change: two pages that split rails differently is a worse
    # bug than either being slightly wrong.
    "multibanco",
}
KNOWN_RAILS = FIAT_RAILS | {
    "bnb", "btc", "btc-2", "bitcoin", "doge", "dogecoin", "ethereum", "eth",
    "litecoin", "ltc", "mercado", "polygon", "matic", "solana", "sol", "tron",
    "trx", "usdt", "usdc", "ton", "xrp", "ripple", "cardano", "ada", "dash",
    "avalanche", "avax", "bch", "monero", "xmr", "stellar", "xlm", "arbitrum",
    "optimism", "base", "shib",
}
UNSEEN_RAILS = set()

# --------------------------------------------------------------- channel ----
# From aff_source and NOT from aff_type -- mirrors chOf() in
# ftd-report/month-aggregate.js. A player who arrived through an SEO partner is
# tagged Direct in aff_type and belongs in Affiliate. "Uncategorized" is the
# query saying it does not know, so it falls back to the type column rather than
# being read as a real source.
SOURCE_CH = {"": "d", "Metamedia": "d", "Community": "d",
             "Influence": "s", "KOl": "s"}
VAGUE_SOURCES = {"", "Uncategorized"}

# KYC statuses that mean the check passed. Anything else non-empty is a real
# "no": the player is not verified today, whatever the reason.
#
# The four values this data actually uses, on the first month to carry the
# column (2026-08):
#
#     Accepted        48,934   passed
#     Not Requested   36,755   never asked for — the largest single group
#     Pending          3,324   asked for, not yet decided
#     Declined           827   asked for, refused
#
# "Not Requested" is the one worth pausing on. It is not a failed check, it is
# no check, and it is the majority of the non-accepted population — so "KYC not
# verified" on this page means "does not hold a passed KYC today", not "tried
# and failed". Splitting it into its own bucket is a one-line change here if
# that distinction ever matters.
#
# Unrecognised values are printed at the end of a build so a new one gets
# classified on purpose rather than defaulting into "no" unnoticed -- the same
# pattern the payment rails use.
KYC_PASSED = {"verified", "approved", "passed", "completed", "accepted",
              "success", "successful", "confirmed", "done", "ok", "valid"}
KYC_FAILED = {"pending", "rejected", "declined", "expired", "failed",
              "not_verified", "not requested", "in_progress", "review", "none"}
UNSEEN_KYC = set()


def num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def d(s):
    return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def chan_of(row):
    src = (row.get("aff_source") or "").strip()
    if src not in VAGUE_SOURCES:
        return SOURCE_CH.get(src, "a")
    typ = (row.get("aff_type") or row.get("is_affiliate") or "").strip()
    return "s" if typ == "Streamer" else "a" if typ == "Affiliate" else "d"


def rail_of(value):
    v = str(value or "").strip().lower()
    if not v:
        return ""
    if v not in KNOWN_RAILS:
        UNSEEN_RAILS.add(value)
    return "fiat" if v in FIAT_RAILS else "crypto"


# ------------------------------------------------------------- dimensions ---
#
# Everything the page can filter by. Each dimension names the cache column it
# needs, how to turn a raw value into a code, and the labels the page shows.
#
# `column` is what makes a dimension self-enabling. The read pass records which
# columns each cache month actually carries; a dimension whose column appears in
# no month at all is dropped from the payload and the page simply has one fewer
# control.
#
# Why any of this is needed: `KEEP` in ftd-report/build-ftd.js is an allowlist,
# and `trim()` drops every column not on it before a month is written. Query
# 1732 has selected kyc_status, email_verified_at and phone_verified_at from
# bi.players_info_mv for a while and all three were being thrown away here --
# which looked exactly like the query not returning them. They are on KEEP now,
# but **a closed month is never refetched**, so they arrive one month at a time
# unless someone runs `node build-ftd.js --no-cache` to backfill.
#
# That partial rollout is the reason coverage is tracked per month rather than
# as a single union. A player seen only in months written before the column
# existed is **unknown**, not unverified. Folding the two together would report
# every 2025 cohort as 100% un-verified and look completely ordinary doing it.
#
# `missing` is therefore always the unknown code: it is what a player gets when
# no month that covers the column has a row for them. Within a covered month an
# absent value IS a real "no" -- a verified-at timestamp is set or it is not --
# and the read pass records that explicitly.

DIMENSIONS = [
    {
        # Current account status. `player_status` is a snapshot of TODAY, not of
        # the cohort's own period, which is the thing to keep in mind when
        # reading old cohorts: a player blocked last week is filtered out of
        # their 2025 cohort even though they were perfectly active in it. That
        # biases history towards survivors and it is why the page says which
        # status it is showing rather than filtering quietly.
        #
        # It defaults to Active because that is the population worth judging
        # acquisition on -- a blocked account cannot come back, so counting it
        # as churn measures the block, not the retention.
        "key": "status", "label": "Account status", "column": "player_status",
        "codes": ["Active", "Blocked", ""],
        "labels": ["Active", "Blocked", "Status unknown"],
        "all_label": "Any status",
        "missing": "",
        "dflt": "0",
    },
    {
        "key": "chan", "label": "Channel", "column": None,
        "codes": ["d", "s", "a"],
        "labels": ["Direct", "Streamer", "Affiliate"],
        "all_label": "All channels",
        "missing": "d",
    },
    {
        "key": "rail", "label": "Payment rail", "column": None,
        "codes": ["crypto", "fiat", ""],
        "labels": ["Crypto", "Fiat", "Rail unknown"],
        "all_label": "All rails",
        "missing": "",
    },
    {
        "key": "ftdt", "label": "FTD type", "column": "ftd_type",
        "codes": ["Super Qualified", "Qualified", "Non Qualified", ""],
        "labels": ["Super qualified", "Qualified", "Non qualified", "Type unknown"],
        "all_label": "Any FTD type",
        "missing": "",
    },
    {
        "key": "kyc", "label": "KYC", "column": "kyc_status",
        "codes": ["y", "n", "u"],
        "labels": ["KYC verified", "KYC not verified", "KYC unknown"],
        "all_label": "Any KYC",
        "missing": "u",
    },
    {
        "key": "email", "label": "Email", "column": "email_verified_at",
        "codes": ["y", "n", "u"],
        "labels": ["Email verified", "Email not verified", "Email unknown"],
        "all_label": "Any email state",
        "missing": "u",
    },
    {
        "key": "phone", "label": "Phone", "column": "phone_verified_at",
        "codes": ["y", "n", "u"],
        "labels": ["Phone verified", "Phone not verified", "Phone unknown"],
        "all_label": "Any phone state",
        "missing": "u",
    },
]

# The three that arrive one cached month at a time, and how a raw value becomes
# a code inside a month that carries the column.
VERIFIED_DIMS = {
    "kyc": ("kyc_status", lambda v: kyc_code(v)),
    "email": ("email_verified_at", lambda v: stamp_code(v)),
    "phone": ("phone_verified_at", lambda v: stamp_code(v)),
}


def kyc_code(raw):
    """Inside a month that carries kyc_status, an absent value means no KYC
    record at all, which is a real "not verified" rather than an unknown."""
    v = str(raw or "").strip().lower()
    if not v:
        return "n"
    if v not in KYC_PASSED and v not in KYC_FAILED:
        UNSEEN_KYC.add(raw)
    return "y" if v in KYC_PASSED else "n"


def stamp_code(raw):
    """A *_verified_at timestamp: present means verified, absent means not."""
    return "y" if str(raw or "").strip() else "n"


# --------------------------------------------------------------------- read

def read_cache():
    """One pass over every month. Returns per-player first deposit date, the set
    of days they deposited on, their attributes, and which columns the cache
    actually carries."""
    files = sorted(glob.glob(os.path.join(CACHE, "*.json")))
    if not files:
        raise SystemExit("no cache files in %s -- run the FTD build first" % CACHE)

    fdd = {}                        # player -> first_deposit_date 'YYYY-MM-DD'
    dep = defaultdict(set)          # player -> {deposit dates}
    # player -> date -> [deposits, ngr, adjusted ggr], for the value table.
    # Only for players whose first deposit is in range; the rest is thrown away
    # as it is read, which keeps this to a few hundred thousand entries rather
    # than one per row of a 2.2M-row cache.
    money = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
    attrs = defaultdict(dict)       # player -> {dim key -> code}
    rail_on = {}                    # player -> date the rail was read from
    ftd_by_month = defaultdict(set)  # ym -> players with a positive ftd
    seen_columns = set()
    cutoff = ""
    rows_seen = 0

    coverage = {k: [] for k in VERIFIED_DIMS}   # dim -> months carrying it

    for path in files:
        with open(path, encoding="utf-8") as fh:
            rows = json.load(fh)
        rows_seen += len(rows)
        ym_file = os.path.basename(path)[:7]

        # Does *this month* carry each verification column? The cache omits a
        # key entirely when its value is empty, so presence has to be looked for
        # across the whole file rather than on any one row. Short-circuits on
        # the first hit, so a covered month costs almost nothing.
        covers = {}
        for dim, (col, _fn) in VERIFIED_DIMS.items():
            covers[dim] = any(col in r for r in rows)
            if covers[dim]:
                coverage[dim].append(ym_file)

        for r in rows:
            seen_columns.update(r.keys())
            day = (r.get("transaction_date") or "")[:10]
            if day > cutoff:
                cutoff = day
            pid = r.get("player_id")
            if not pid:
                continue
            pid = str(pid)
            a = attrs[pid]

            fd = (r.get("first_deposit_date") or "")[:10]
            if fd and (pid not in fdd or fd < fdd[pid]):
                fdd[pid] = fd

            # Money is tracked for EVERY player, not only rows that carry a
            # first_deposit_date. Gating on the row's own `fd` looked like a
            # cheap way to skip pre-2025 players and silently dropped 14% of
            # rows: `first_deposit_date` is absent on most bet rows, which is
            # where NGR lives. Deposits were unaffected, so ADPU looked right
            # while ARPU was short by thousands a cohort. Non-members are
            # discarded after the pass, once their fdd is actually known.
            dv, nv, av = (num(r.get("deposit")), num(r.get("ngr")),
                          num(r.get("adjusted_ggr")))
            if dv or nv or av:
                m = money[pid][day]
                m[0] += dv
                m[1] += nv
                m[2] += av

            if num(r.get("deposit")) > 0:
                dep[pid].add(day)
                # The rail of the *earliest* deposit day seen for this player.
                # Redash does not promise a stable row order, so someone who
                # used two rails within one day can land either side -- the FTD
                # report documents the same wobble. Pinning it to the earliest
                # day at least makes it deterministic across builds.
                if pid not in rail_on or day < rail_on[pid]:
                    rl = rail_of(r.get("blockchain"))
                    if rl:
                        a["rail"] = rl
                        rail_on[pid] = day

            # `ftd` is a dollar amount, not a flag -- the count is distinct
            # players with ftd > 0. Kept only to reconcile the cohort against
            # what the Business Overview and FTD reports publish.
            if num(r.get("ftd")) > 0:
                ftd_by_month[day[:7]].add(pid)

            if "chan" not in a and (r.get("aff_source") or r.get("aff_type")):
                a["chan"] = chan_of(r)
            if "ftdt" not in a and r.get("ftd_type"):
                a["ftdt"] = str(r["ftd_type"]).strip()
            if "status" not in a and r.get("player_status"):
                a["status"] = str(r["player_status"]).strip()

            # Verification state is a current-state snapshot repeated on every
            # row, so "verified in any covered month" reads as "verified by
            # now" -- which is why a y is never overwritten by a later n. Inside
            # a covered month an absent value is a real no; outside one the
            # player simply stays unknown.
            for dim, (col, fn) in VERIFIED_DIMS.items():
                if not covers[dim] or a.get(dim) == "y":
                    continue
                a[dim] = fn(r.get(col))

        print("  read %-12s %7d rows%s" % (os.path.basename(path), len(rows),
              "" if all(covers.values()) else
              "   (no %s)" % "/".join(k for k in VERIFIED_DIMS if not covers[k])))

    # Now fdd is complete, so non-members can go. Doing it here rather than
    # during the read is the whole point of the fix above.
    keep = {p for p, f in fdd.items() if f >= MONEY_FROM and f <= cutoff}
    for pid in [p for p in money if p not in keep]:
        del money[pid]

    print("  %s rows, %s players with a first deposit date, cutoff %s"
          % (f"{rows_seen:,}", f"{len(fdd):,}", cutoff))
    print("  money kept for %s of them" % f"{len(money):,}")
    for dim, months in coverage.items():
        if months and len(months) < len(files):
            print("  %-6s carried by %d of %d cached months (%s -> %s) -- players seen only "
                  "outside those are 'unknown', not 'not verified'"
                  % (dim, len(months), len(files), months[0], months[-1]))
    return fdd, dep, attrs, money, ftd_by_month, seen_columns, coverage, cutoff


# -------------------------------------------------------------------- grains

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def month_cohort(f):
    """(key, start, end, label, short) for the calendar month containing f."""
    start = date(f.year, f.month, 1)
    end = date(f.year + (f.month == 12), f.month % 12 + 1, 1) - timedelta(days=1)
    nm = MONTH_NAMES[f.month - 1]
    return ("%04d-%02d" % (f.year, f.month), start, end,
            "%s %d" % (nm, f.year), "%s '%02d" % (nm, f.year % 100))


def week_cohort(f):
    """(key, start, end, label, short) for the ISO week containing f.

    ISO weeks run Monday to Sunday and the key carries the ISO year, which is
    not always the calendar year. Sorting the key string still orders the weeks
    correctly, which is what the page relies on.

    Weeks are the page's default because they mature faster. A cohort is fully
    observed at day N once its *last* member has lived N days, so a monthly
    cohort waits out the whole month before its clock starts; a weekly one waits
    seven days. On this data that moves the newest complete day-30 figure from
    the month ending 30 June to the week ending 19 July."""
    mon = f - timedelta(days=f.weekday())
    sun = mon + timedelta(days=6)
    iso_y, iso_w, _ = f.isocalendar()
    label = "week of %d %s %d" % (mon.day, MONTH_NAMES[mon.month - 1], mon.year)
    short = "%d %s '%02d" % (mon.day, MONTH_NAMES[mon.month - 1], mon.year % 100)
    return ("%04d-W%02d" % (iso_y, iso_w), mon, sun, label, short)


GRAINS = [("month", month_cohort), ("week", week_cohort)]


# ------------------------------------------------------------------ measure

def bucket_of(lag):
    """Which milestone bucket a day belongs to, or None if it is out of scope.

    Bucket j holds the days after MILESTONES[j-1] and up to MILESTONES[j], with
    day 0 in bucket 0, so the cumulative sum of buckets 0..j is the total up to
    milestone j.

    The `lag < 0` guard is not defensive tidiness. Players bet before they first
    deposit -- a no-deposit bonus, or simply registering and playing first -- and
    those rows carry NGR with a negative lag. Without the guard the loop's first
    comparison (`lag <= 1`) is true and every dollar of it lands in bucket 0, so
    day-0 ARPU silently includes revenue earned before the player was acquired.
    It cost about $2,100 on one 2025-02 cohort and nothing at all on ADPU, since
    deposits cannot precede the first deposit. Value on this page is measured
    from acquisition; earlier play is a different question."""
    if lag < 0:
        return None
    for j, m in enumerate(MILESTONES):
        if lag <= m:
            return j
    return None                      # past the horizon, dropped


def eligible_members(fdd, dep, cutoff):
    """Every player who can be measured at all, with their observation window
    and the day they first came back. Shared by both grains -- the grouping
    changes, the per-player facts do not, so they are computed once."""
    cut = d(cutoff)
    members = []
    dropped_early = 0
    dropped_future = []

    for pid, fd in fdd.items():
        if fd[:7] < COHORT_FROM:
            dropped_early += 1
            continue
        f = d(fd)
        obs = (cut - f).days
        if obs < 0:
            # A first deposit dated after the last day any cache covers. Their
            # day 0 has not been loaded, so every day-N figure for them would
            # measure nothing. See the header note on player 3951181.
            dropped_future.append((pid, fd))
            continue
        lags = [(d(x) - f).days for x in dep.get(pid, ())]
        lags = [g for g in lags if 1 <= g <= HORIZON]

        # One bit per calendar month offset: bit k is set if the player made a
        # deposit in the month k months after their first-deposit month, on a
        # day strictly after the first deposit. Bit 0 is therefore "came back
        # again within their own acquisition month", not "was acquired".
        mmask = 0
        for x in dep.get(pid, ()):
            xd = d(x)
            if xd <= f:
                continue
            k = (xd.year - f.year) * 12 + (xd.month - f.month)
            if 0 <= k < MONTH_HORIZON:
                mmask |= 1 << k

        # FIRST and LAST return, both inside the horizon, 0 for neither.
        #
        # The first answers "did they come back by day N" -- cumulative, rises.
        # The last answers "were they still depositing after day N" -- survival,
        # falls. A player whose only return was day 3 counts as retained BY day
        # 7 and not as retained AFTER it, and no amount of arithmetic on the
        # first return alone can tell you that. Two numbers, two questions.
        members.append((pid, f, min(obs, HORIZON + 1),
                        min(lags) if lags else 0,
                        max(lags) if lags else 0,
                        mmask))

    print("  %s cohort members, %s dropped for a pre-%s first deposit"
          % (f"{len(members):,}", f"{dropped_early:,}", COHORT_FROM))
    if dropped_future:
        print("  %d dropped for a first deposit dated after the %s cutoff: %s"
              % (len(dropped_future), cutoff,
                 ", ".join("%s (%s)" % t for t in sorted(dropped_future)[:5])))
    return members


def build_money(members, money):
    """Per player, the money that landed in each milestone bucket.

    Emitted as deltas rather than running totals: the page sums them, and a
    player who deposits once and never returns is then six zeros instead of six
    repeats of the same figure -- which is most players, and most of the size.

    Rounded to whole dollars. The page divides by player counts in the hundreds,
    so a cent of rounding per player cannot reach the second decimal of an
    average, and carrying it would cost more than it says.

    Amounts past day 90 are dropped, matching the horizon the rest of the page
    uses. That makes the last column "value by day 90", not "value to date".
    """
    J = len(MILESTONES)
    out = {k: [] for k, _s, _l, _f in MONEY_METRICS}
    order = [k for k, _s, _l, _f in MONEY_METRICS]
    dropped_late = 0.0
    pre = [0.0, 0.0, 0.0]

    for pid, f, _obs, _lag, _lst, _mm in members:
        rows = money.get(pid)
        buckets = [[0.0] * J for _ in order]
        if rows:
            for day, vals in rows.items():
                lag = (d(day) - f).days
                j = bucket_of(lag)
                if j is None:
                    if lag < 0:
                        pre[0] += vals[0]; pre[1] += vals[1]; pre[2] += vals[2]
                    else:
                        dropped_late += vals[0]
                    continue
                for mi in range(len(order)):
                    buckets[mi][j] += vals[mi]
        for mi, k in enumerate(order):
            out[k].extend(int(round(v)) for v in buckets[mi])

    print("  money bucketed for %s players; $%s of deposits fell past day %d, and "
          "$%s of NGR / $%s of adjusted GGR was earned BEFORE the first deposit -- both "
          "out of scope" % (f"{len(members):,}", f"{dropped_late:,.0f}", HORIZON,
                            f"{pre[1]:,.0f}", f"{pre[2]:,.0f}"))
    return out


def build_dims(seen_columns, attrs, members):
    """Keep the dimensions whose column the cache actually carries, and work out
    the packing. Returns (dims, stride_by_key)."""
    dims, strides, stride = [], {}, 1
    for spec in DIMENSIONS:
        col = spec["column"]
        if col and col not in seen_columns:
            # Almost always because the column is not on KEEP in
            # ftd-report/build-ftd.js, which is an allowlist -- not because
            # query 1732 fails to return it. Say so, since the two look
            # identical from here and only one of them is fixable.
            print("  - %-12s dropped: no cached month carries %s"
                  " (on KEEP in ftd-report/build-ftd.js? closed months are never refetched --"
                  " `node build-ftd.js --no-cache` backfills)" % (spec["key"], col))
            continue
        card = len(spec["codes"])
        dims.append({
            "key": spec["key"],
            "label": spec["label"],
            "card": card,
            "stride": stride,
            # The page renders one control per dimension straight from this:
            # "all" means no constraint, the rest are the codes' positions.
            "opts": [["all", spec["all_label"]]] +
                    [[str(i), spec["labels"][i]] for i in range(card)],
            # What the page opens on. "all" unless the spec says otherwise.
            "dflt": spec.get("dflt", "all"),
        })
        strides[spec["key"]] = stride
        stride *= card
    print("  %d dimensions, %d attribute combinations" % (len(dims), stride))
    return dims, strides, stride


def pack_attrs(dims, strides, attrs, members):
    """One integer per player carrying every dimension, mixed-radix. The page
    decodes it with floor(attr / stride) % card, which is why the strides are
    emitted alongside rather than recomputed there."""
    spec_by_key = {s["key"]: s for s in DIMENSIONS}
    index = {}
    for dim in dims:
        s = spec_by_key[dim["key"]]
        index[dim["key"]] = ({c: i for i, c in enumerate(s["codes"])},
                             s["codes"].index(s["missing"]))

    out = []
    for pid, _f, _obs, _lag, _lst, _mm in members:
        a = attrs.get(pid, {})
        code = 0
        for dim in dims:
            lookup, fallback = index[dim["key"]]
            code += lookup.get(a.get(dim["key"]), fallback) * dim["stride"]
        out.append(code)
    return out


def build_grain(members, cohort_of, cutoff):
    """Cohort keys, their metadata, and each player's cohort index."""
    cache_start = COHORT_FROM + "-01"
    meta, order = {}, {}
    ci = []

    for _pid, f, _obs, _lag, _lst, _mm in members:
        ck, start, end, label, short = cohort_of(f)
        if ck not in meta:
            # A cohort period is `partial` when the cache does not cover all of
            # it: the first is clipped by where the data begins, the last by
            # where it ends. Their *rates* are as sound as any other -- a rate
            # is over whoever is in the cohort -- but their *sizes* are not
            # comparable to a full period, so the page marks them rather than
            # dropping them. Dropping the leading week would also make the two
            # grains disagree about how many first depositors exist, and two
            # views of one page contradicting each other is worse than a flag.
            meta[ck] = {"label": label, "short": short,
                        "start": start.isoformat(), "end": end.isoformat(),
                        "partial": 1 if (start.isoformat() < cache_start
                                         or end.isoformat() > cutoff) else 0}
        ci.append(ck)

    cohorts = sorted(meta)
    order = {c: i for i, c in enumerate(cohorts)}
    return cohorts, meta, [order[c] for c in ci]


# ------------------------------------------------------------------- report

def summarise(cohorts, meta, ci, obs, lag, label):
    """The unfiltered table, printed the way the page draws it, plus the pooled
    row. Sum numerators and denominators; never average the cohort rates."""
    n = [0] * len(cohorts)
    elig = [[0] * len(MILESTONES) for _ in cohorts]
    ret = [[0] * len(MILESTONES) for _ in cohorts]
    for i, c in enumerate(ci):
        n[c] += 1
        for j, m in enumerate(MILESTONES):
            if obs[i] >= m:
                elig[c][j] += 1
                if lag[i] and lag[i] <= m:
                    ret[c][j] += 1

    cells = []
    for j, m in enumerate(MILESTONES):
        num_ = sum(ret[c][j] for c in range(len(cohorts))
                   if elig[c][j] == n[c] and elig[c][j] >= MIN_ELIGIBLE)
        den = sum(elig[c][j] for c in range(len(cohorts))
                  if elig[c][j] == n[c] and elig[c][j] >= MIN_ELIGIBLE)
        k = sum(1 for c in range(len(cohorts))
                if elig[c][j] == n[c] and elig[c][j] >= MIN_ELIGIBLE)
        cells.append("D%d %.1f%% (%d)" % (m, num_ / den * 100 if den else 0, k))
    print(" %-6s pooled over complete cohorts: %s" % (label, "  ".join(cells)))
    return n, elig, ret


def reconcile(fdd, ftd_by_month, cutoff, cohorts):
    """Cohort membership against the ftd > 0 count the other reports publish.

    Two definitions of the same thing that agree everywhere except where the
    data says something interesting. Printed on every build so a new divergence
    gets noticed on the day it appears rather than six months later."""
    by_fdd = defaultdict(set)
    for pid, fd in fdd.items():
        if fd[:7] >= COHORT_FROM and fd <= cutoff:
            by_fdd[fd[:7]].add(pid)

    gaps = []
    for ym in cohorts:
        a, b = by_fdd.get(ym, set()), ftd_by_month.get(ym, set())
        if a != b:
            gaps.append((ym, len(a), len(b), len(a - b), len(b - a)))

    print("\n  cohort vs the published ftd>0 count: %d of %d months agree exactly"
          % (len(cohorts) - len(gaps), len(cohorts)))
    for ym, na, nb, only_a, only_b in gaps:
        print("    %s  first_deposit_date %d vs ftd>0 %d  (+%d with a date but no positive "
              "ftd row, +%d the other way)" % (ym, na, nb, only_a, only_b))


def main():
    print("reading caches...")
    fdd, dep, attrs, money, ftd_by_month, seen_columns, coverage, cutoff = read_cache()

    print("measuring...")
    members = eligible_members(fdd, dep, cutoff)
    # The note below claims the carved-out players are out of scope. If one of
    # them ever first deposits inside the cohort range that stops being true,
    # and this page would carry them with no toggle to take them out.
    _carved_in = sorted(CARVED & {m[0] if isinstance(m, (list, tuple)) else m
                                  for m in members})
    assert not _carved_in, (
        "carved-out player(s) %s are in a retention cohort — this page has no "
        "toggle to take them out. Add one before shipping."
        % ", ".join("%s (%s)" % (i, CARVE_NAMES.get(i, "?")) for i in _carved_in))
    obs = [m[2] for m in members]
    lag = [m[3] for m in members]
    last = [m[4] for m in members]
    mmask = [m[5] for m in members]

    dims, strides, combos = build_dims(seen_columns, attrs, members)
    attr = pack_attrs(dims, strides, attrs, members)
    buckets = build_money(members, money)

    grains = {}
    for name, cohort_of in GRAINS:
        cohorts, meta, ci = build_grain(members, cohort_of, cutoff)
        grains[name] = {"cohorts": cohorts, "meta": meta, "ci": ci}
        print("  %-6s %3d cohorts" % (name, len(cohorts)))

    if UNSEEN_RAILS:
        print("  ! payment rails not in KNOWN_RAILS (classified as crypto by "
              "default -- add them on purpose): %s"
              % ", ".join(sorted(str(x) for x in UNSEEN_RAILS)))
    if UNSEEN_KYC:
        print("  ! kyc_status values not recognised (treated as not verified -- "
              "add them to KYC_PASSED on purpose): %s"
              % ", ".join(sorted(str(x) for x in UNSEEN_KYC)))

    payload = {
        "cutoff": cutoff,
        "horizon": HORIZON,
        "milestones": MILESTONES,
        "minEligible": MIN_ELIGIBLE,
        "dims": dims,
        "combos": combos,
        "players": {"obs": obs, "lag": lag, "last": last, "attr": attr, "mmask": mmask},
        "monthHorizon": MONTH_HORIZON,
        # One flat array per metric, len = players x milestones, deltas.
        "money": buckets,
        "moneyMetrics": [[k, short, l] for k, short, l, _f in MONEY_METRICS],
        "grains": grains,
        "grainNames": [["month", "Months"], ["week", "Weeks"]],
        "built": date.today().isoformat(),
        "totalMembers": len(members),
        "whaleNote": ("the carved-out players (%s) all first deposited before "
                      "the earliest cohort, so they are out of scope here"
                      % ", ".join(CARVE_NAMES.get(i) or i for i in sorted(CARVED))),
    }

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))

    # ---- a readable summary, and the reconciliation worth eyeballing --------
    mg = grains["month"]
    n, elig, ret = summarise(mg["cohorts"], mg["meta"], mg["ci"], obs, lag, "month")
    print("\n cohort   size   " + "".join("%7s" % ("D%d" % m) for m in MILESTONES))
    for c, ym in enumerate(mg["cohorts"]):
        cells = []
        for j, m in enumerate(MILESTONES):
            e = elig[c][j]
            cells.append("      -" if e < MIN_ELIGIBLE
                         else "%6.1f%%" % (ret[c][j] / e * 100))
        mature = "" if elig[c][-1] == n[c] else "  (immature)"
        print(" %s %6d   %s%s" % (ym, n[c], "".join(cells), mature))

    print()
    wg = grains["week"]
    summarise(wg["cohorts"], wg["meta"], wg["ci"], obs, lag, "week")
    print(" total cohort players: %s   observation cutoff %s"
          % (f"{len(members):,}", cutoff))

    print("\n dimensions on the page:")
    for dim in dims:
        counts = defaultdict(int)
        for a in attr:
            counts[(a // dim["stride"]) % dim["card"]] += 1
        print("   %-6s %s" % (dim["key"], "  ".join(
            "%s %s" % (dim["opts"][i + 1][1], f"{counts[i]:,}")
            for i in range(dim["card"]))))

    reconcile(fdd, ftd_by_month, cutoff, mg["cohorts"])


if __name__ == "__main__":
    main()
