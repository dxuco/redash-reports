#!/usr/bin/env python3
"""Build retention-full-data.json -- deposit retention across the WHOLE base.

The sister of retention\\build_retention.py. Same question, same payload shape,
same template: of the players who first deposited in period P, what share funded
the account again by day N. The difference is where the answer comes from.

    retention\\      reads ftd-report\\cache\\*.json   ->  2025-01 on,  ~19k players
    retention-full\\ runs Redash query 1758           ->  2019-01 on,  ~89k players

WHY 2019 AND NOT 2014
---------------------
reports.player_ftd records first deposits back to 2014-12, but public.transactions
only holds deposit rows from 2018-05-23 -- everything older was archived out. So
the FIRST deposit date exists for an old player while their RETURN deposits do
not, and a cohort built on them reads as though almost nobody came back:

    FTD year   players   have deposit rows
    2015        17,680        2.2%
    2016        29,437        3.4%
    2017        16,999        9.9%
    2018        16,189       64.3%
    2019+       89,171        100%

Those first three lines would draw a beautiful, entirely fictional collapse in
retention. COHORT_FROM is 2019-01 for that reason and no other; moving it earlier
without restoring the archived transactions puts fiction on the page.

VALIDATION
----------
Over the months both builds cover, the DB path and the cache path agree:

                    this build      the cached page
    Super Qualified   62.8%             62.7%
    Qualified         53.1%             53.1%
    Non Qualified     26.8%             27.7%

Two independent implementations reading two different sources. That agreement is
the reason to trust the 2019-2024 cohorts, which only this build can see.

BLOCKED IS TWO DIFFERENT THINGS
-------------------------------
public.player_restriction_requests carries 499,424 players under
`dormant_account`, applied in two bulk sweeps -- housekeeping, not a compliance
block. Folded in with bonus_abuse and multi_accounting it would swamp them and
make the filter useless, so the dimension separates them. Restrictions only start
2024-05, so cohorts before then carry no block data and say so rather than
reading as "not blocked".
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..")
# The players every report carves out by default. This page needs no toggle
# for them -- see the note it emits -- but it must still name whoever is on
# the list rather than one player somebody pinned here years ago.
sys.path.insert(0, BASE)
from carveout import CARVED, CARVE_NAMES  # noqa: E402

QUERY_ID = 1758
HORIZON = 90                 # days of return history kept per player
MILESTONES = [1, 3, 7, 14, 30, 60, 90]
MIN_ELIGIBLE = 30            # below this a rate is noise; the page shows a dash
COHORT_FROM = "2019-01"      # see the module docstring -- not a preference


def _flag(name, default):
    pre = "--%s=" % name
    for a in sys.argv[1:]:
        if a.startswith(pre):
            return a[len(pre):]
    return default


OUT = _flag("out", os.path.join(HERE, "retention-full-data.json"))
# A saved export, so the page can be rebuilt without Redash or the VPN.
ROWS_CACHE = _flag("rows", os.path.join(BASE, "_mcp-exports", "retention-full-rows.json"))
USE_CACHE = _flag("use-cache", "") == "1"


# ------------------------------------------------------------------ config

def cfg(key, default=None):
    path = os.path.join(BASE, "config.env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == key:
                    return v.strip()
    return default


# ------------------------------------------------------------------- fetch

def fetch_rows():
    """Run query 1758 and return its rows.

    Falls back to the saved export when Redash cannot be reached, so a VPN drop
    republishes yesterday's page rather than failing the whole nightly run.
    """
    if USE_CACHE:
        print("  --use-cache=1, reading the saved export")
        return json.load(open(ROWS_CACHE, encoding="utf-8"))

    host = (cfg("REDASH_HOST") or "").rstrip("/")
    key = cfg("REDASH_USER_API_KEY")
    if not host or not key:
        raise SystemExit("REDASH_HOST or REDASH_USER_API_KEY missing from config.env")

    def call(path, payload=None):
        req = urllib.request.Request(
            host + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Authorization": "Key " + key,
                     "Content-Type": "application/json"},
            method="POST" if payload is not None else "GET")
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())

    print("  running Redash query %d ..." % QUERY_ID)
    job = call("/api/queries/%d/results" % QUERY_ID, {"max_age": 0}).get("job", {})
    jid = job.get("id")
    if not jid:
        raise SystemExit("Redash did not start a job for query %d" % QUERY_ID)

    result_id = None
    for _ in range(240):                       # up to ~8 minutes
        time.sleep(2)
        j = call("/api/jobs/%s" % jid).get("job", {})
        if j.get("status") == 3:
            result_id = j.get("query_result_id")
            break
        if j.get("status") == 4:
            raise SystemExit("Redash job failed: %s" % j.get("error"))
    if not result_id:
        raise SystemExit("Redash job did not finish in time")

    data = call("/api/query_results/%d" % result_id)
    rows = data["query_result"]["data"]["rows"]
    print("  %d rows" % len(rows))

    os.makedirs(os.path.dirname(ROWS_CACHE), exist_ok=True)
    with open(ROWS_CACHE, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, separators=(",", ":"))
    return rows


# -------------------------------------------------------------- dimensions

DIMENSIONS = [
    {"key": "ftdt", "label": "FTD type", "field": "ftd_type",
     "codes": ["Super Qualified", "Qualified", "Non Qualified", ""],
     "labels": ["Super qualified", "Qualified", "Non qualified", "Type unknown"],
     "all_label": "Any FTD type", "missing": ""},
    {"key": "rail", "label": "First deposit rail", "field": "rail",
     "codes": ["crypto", "fiat"],
     "labels": ["Crypto", "Fiat"],
     "all_label": "All rails", "missing": "crypto"},
    {"key": "kyc", "label": "KYC", "field": "kyc",
     "codes": ["y", "n"],
     "labels": ["KYC accepted", "KYC not accepted"],
     "all_label": "Any KYC", "missing": "n"},
    {"key": "email", "label": "Email", "field": "email",
     "codes": ["y", "n"],
     "labels": ["Email verified", "Email not verified"],
     "all_label": "Any email state", "missing": "n"},
    {"key": "phone", "label": "Phone", "field": "phone",
     "codes": ["y", "n"],
     "labels": ["Phone verified", "Phone not verified"],
     "all_label": "Any phone state", "missing": "n"},
    # Account RESTRICTIONS, split so the bulk dormant sweep cannot swamp the
    # deliberate ones.
    #
    # This is not the same thing as the Active/Blocked flag the from-2025 page
    # filters on, and the labels say "restriction" rather than "blocked" so the
    # two are not read as interchangeable. Query 1758 derives it from
    # public.player_restriction_requests (type='account', status='processed'),
    # i.e. a restriction someone filed. `player_status` in query 1732 is the
    # account's own state. They disagree by an order of magnitude: over the 2026
    # cohorts this dimension flags 9 players of 7,503, while player_status calls
    # 1,170 of 7,544 Blocked.
    #
    # So "No restriction" here does NOT mean "not blocked". Closing that gap
    # needs one more column in query 1758 -- p.status is already available on
    # the players join -- which is a change to a shared query and therefore not
    # one to make without asking.
    {"key": "blk", "label": "Account restriction", "field": "_blk",
     "codes": ["none", "dormant", "real"],
     "labels": ["No restriction", "Dormant sweep", "Restricted (deliberate)"],
     "all_label": "Any restriction state", "missing": "none",
     # Opens on the unblocked population: a blocked account cannot come back, so
     # counting it as churn measures the block rather than the retention. Note
     # the block state is TODAY's, not the cohort's -- someone blocked last week
     # drops out of their 2019 cohort too, which biases old cohorts towards
     # survivors. The header strip always names the filter for that reason.
     "dflt": "0"},
    {"key": "blkr", "label": "Block reason", "field": "block_reason",
     "codes": ["", "dormant_account", "bonus_abuse", "multi_accounting",
               "email_pattern_bot", "failed_kyc", "bug_abuse", "unknown"],
     "labels": ["No restriction", "Dormant account", "Bonus abuse",
                "Multi accounting", "Email pattern bot", "Failed KYC",
                "Bug abuse", "Reason unknown"],
     "all_label": "Any reason", "missing": ""},
]

UNSEEN = defaultdict(set)


def blk_state(reason):
    if not reason:
        return "none"
    return "dormant" if reason == "dormant_account" else "real"


# ------------------------------------------------------------------ shape

def d(s):
    return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def iso_week(day):
    y, w, _ = day.isocalendar()
    return "%d-W%02d" % (y, w)


GRAINS = [("month", lambda day: day.isoformat()[:7]),
          ("week", iso_week)]


def build(rows, cutoff):
    """One record per player: days observed, lag to first return, packed attrs."""
    members, obs, lag, attrs = [], [], [], []
    cut = d(cutoff)
    for r in rows:
        fd = str(r["first_deposit_date"])[:10]
        if fd[:7] < COHORT_FROM or fd > cutoff:
            continue
        observed = min(HORIZON, (cut - d(fd)).days)
        if observed < 1:
            continue                       # no chance to return yet
        lg = r.get("lag")
        lg = int(lg) if lg is not None and lg != "" else 0
        if lg > HORIZON:
            lg = 0                         # came back, but outside the window
        members.append(fd)
        obs.append(observed)
        lag.append(lg)
        a = dict(r)
        a["_blk"] = blk_state(r.get("block_reason") or "")
        attrs.append(a)
    return members, obs, lag, attrs


def pack(attrs):
    """Every attribute as one mixed-radix integer, so the page can tally any
    combination of filters without a key per combination."""
    dims, stride, mult = [], {}, 1
    for dim in DIMENSIONS:
        idx = {c: i for i, c in enumerate(dim["codes"])}
        stride[dim["key"]] = (mult, idx, dim)
        dims.append({"key": dim["key"], "label": dim["label"],
                     "card": len(dim["codes"]), "stride": mult,
                     "opts": [["all", dim["all_label"]]] +
                             [[str(i), l] for i, l in enumerate(dim["labels"])],
                     # What the page opens on. "all" unless the spec says so.
                     "dflt": dim.get("dflt", "all")})
        mult *= len(dim["codes"])

    packed = []
    for a in attrs:
        v = 0
        for dim in DIMENSIONS:
            m, idx, dd = stride[dim["key"]]
            raw = a.get(dim["field"])
            raw = "" if raw is None else str(raw)
            if raw not in idx:
                if raw:
                    UNSEEN[dim["key"]].add(raw)
                raw = dd["missing"]
            v += idx[raw] * m
        packed.append(v)
    return dims, mult, packed


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def label_of(ck, start):
    if "-W" in ck:
        return "week of %d %s %d" % (start.day, MONTHS[start.month - 1], start.year)
    return "%s %d" % (MONTHS[start.month - 1], start.year)


def short_of(ck, start):
    if "-W" in ck:
        return "%d %s '%02d" % (start.day, MONTHS[start.month - 1], start.year % 100)
    return "%s '%02d" % (MONTHS[start.month - 1], start.year % 100)


def period_span(ck):
    """First and last calendar day of a cohort key."""
    if "-W" in ck:
        y, w = int(ck[:4]), int(ck[6:])
        start = date.fromisocalendar(y, w, 1)
        return start, start + timedelta(days=6)
    y, m = int(ck[:4]), int(ck[5:7])
    start = date(y, m, 1)
    nxt = date(y + (m == 12), (m % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


def build_grain(members, cohort_of, cutoff):
    """`partial` means the cohort's own calendar period is not over yet -- the
    first period if COHORT_FROM lands inside it, the last because today does.
    It is NOT about maturity: a complete period whose members have not been
    observed for 90 days still shows every column it has earned, and the
    maturity toggle is what governs that. Conflating the two flagged the last
    thirteen weeks as partial, which is a different and much less useful claim.
    """
    cut = d(cutoff)
    first_possible = d(COHORT_FROM + "-01")
    meta, ci = {}, []
    for fd in members:
        ck = cohort_of(d(fd))
        ci.append(ck)
        if ck not in meta:
            start, end = period_span(ck)
            # label/short/start/end are not decoration -- the template reads
            # them to draw the row. Its fallback only fires when the whole meta
            # entry is missing, so an entry present but short of these keys
            # renders every cohort as "undefined" and still passes any check
            # that only counts rows.
            meta[ck] = {
                "label": label_of(ck, start),
                "short": short_of(ck, start),
                "start": start.isoformat(),
                "end": end.isoformat(),
                "partial": 1 if (start < first_possible or end > cut) else 0,
            }
    cohorts = sorted(meta)
    order = {c: i for i, c in enumerate(cohorts)}
    return cohorts, meta, [order[c] for c in ci]


def summarise(cohorts, ci, obs, lag, label):
    """Pooled over complete cohorts. Sum numerators and denominators; never
    average the cohort rates -- that weights a 30-player month like a 3,000."""
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
        keep = [c for c in range(len(cohorts))
                if elig[c][j] == n[c] and elig[c][j] >= MIN_ELIGIBLE]
        num_ = sum(ret[c][j] for c in keep)
        den = sum(elig[c][j] for c in keep)
        cells.append("D%d %.1f%% (%d)" % (m, num_ / den * 100 if den else 0, len(keep)))
    print("  %-6s pooled over complete cohorts: %s" % (label, "  ".join(cells)))


def main():
    rows = fetch_rows()
    cutoff = (date.today() - timedelta(days=1)).isoformat()

    members, obs, lag, attrs = build(rows, cutoff)
    print("  %d players in scope (cohorts from %s)" % (len(members), COHORT_FROM))

    dims, combos, packed = pack(attrs)

    grains = {}
    for name, cohort_of in GRAINS:
        cohorts, meta, ci = build_grain(members, cohort_of, cutoff)
        grains[name] = {"cohorts": cohorts, "meta": meta, "ci": ci}
        print("  %-6s %3d cohorts" % (name, len(cohorts)))

    for k, vals in UNSEEN.items():
        print("  ! %s values not in the dimension (folded into the missing "
              "code -- add them on purpose): %s" % (k, ", ".join(sorted(vals))))

    payload = {
        "cutoff": cutoff,
        "horizon": HORIZON,
        "milestones": MILESTONES,
        "minEligible": MIN_ELIGIBLE,
        "dims": dims,
        "combos": combos,
        "players": {"obs": obs, "lag": lag, "attr": packed},
        "grains": grains,
        "grainNames": [["month", "Months"], ["week", "Weeks"]],
        "built": date.today().isoformat(),
        "totalMembers": len(members),
        "cohortFrom": COHORT_FROM,
        "source": "Redash query %d, data source 20 (core-prod)" % QUERY_ID,
        "whaleNote": ("the carved-out players (%s) are %d member(s) of the "
                      "cohorts here; this page counts players, not dollars, "
                      "and they cannot move a rate built on %d of them"
                      % (", ".join(CARVE_NAMES.get(i) or i for i in sorted(CARVED)),
                         len(CARVED), len(members))),
        "truncationNote": ("public.transactions holds deposits from 2018-05-23 "
                           "only, so cohorts start at %s -- earlier first "
                           "deposits exist but their return deposits do not, "
                           "and would read as a collapse in retention that "
                           "never happened" % COHORT_FROM),
    }

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))

    mg = grains["month"]
    summarise(mg["cohorts"], mg["ci"], obs, lag, "month")


if __name__ == "__main__":
    main()
