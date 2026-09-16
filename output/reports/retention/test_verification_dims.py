#!/usr/bin/env python3
"""
Prove the KYC / email / phone filters work, before the real columns exist.

    python test_verification_dims.py

Those three dimensions are defined in build_retention.py but dropped from every
build today, because `KEEP` in ftd-report/build-ftd.js filtered the columns out
of the cache and a closed month is never refetched. Everything about them is
therefore unexercised: the self-enabling, the per-month coverage rule, the
y/n/unknown classification. A feature nobody can run is a feature nobody can
trust, and this is the failure mode that ships broken the day the data lands.

So build a throwaway cache with the columns present in one month and absent in
another, run the real builder against it, and read the answers back.

The case that matters most is the third one. When the columns arrive they will
arrive **one month at a time** -- the current month first, older months only if
someone runs `node build-ftd.js --no-cache`. A player seen only in the older
months must come out *unknown*, not *not verified*. Folding those together
would report every 2025 cohort as 100% un-verified and look entirely ordinary
doing it.
"""

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

fails = 0


def check(cond, msg):
    global fails
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails += 1


def row(pid, day, **kw):
    r = {"transaction_date": day, "player_id": str(pid), "aff_type": "Direct",
         "ftd_type": "Qualified"}
    r.update({k: v for k, v in kw.items() if v not in (None, "")})
    return r


def player(pid, fdd_day, first_day, **verif):
    """A first depositor with one deposit on day 0 and one on day 5, so they are
    retained at every milestone from D7 up."""
    out = [row(pid, first_day, first_deposit_date=fdd_day, ftd="50",
               deposit="50", blockchain="btc", **verif)]
    d5 = first_day[:8] + "%02d" % (int(first_day[8:10]) + 5)
    out.append(row(pid, d5, first_deposit_date=fdd_day, deposit="20",
                   blockchain="btc", **verif))
    return out


def build(cache_dir, out_file):
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_retention.py"),
                        "--cache=" + cache_dir, "--out=" + out_file],
                       capture_output=True, text=True)
    if r.returncode:
        print(r.stdout[-2000:])
        print(r.stderr[-2000:])
        raise SystemExit("builder failed")
    return json.load(open(out_file, encoding="utf-8")), r.stdout


def codes_of(data, key):
    """player index -> code index, for one dimension."""
    dim = next((d for d in data["dims"] if d["key"] == key), None)
    if dim is None:
        return None, None
    attr = data["players"]["attr"]
    return dim, [(a // dim["stride"]) % dim["card"] for a in attr]


with tempfile.TemporaryDirectory() as tmp:
    cache = os.path.join(tmp, "cache")
    os.makedirs(cache)

    # ---- 2025-01: written before the columns existed. No verification keys.
    jan = []
    jan += player(101, "2025-01-05", "2025-01-05")
    jan += player(102, "2025-01-06", "2025-01-06")
    # padding so the cohort clears MIN_ELIGIBLE and is reportable
    for i in range(200, 260):
        jan += player(i, "2025-01-07", "2025-01-07")

    # ---- 2025-03: written after. Every row carries all three columns, and an
    #      empty value inside a covered month is a real "not verified".
    mar = []
    mar += player(301, "2025-03-05", "2025-03-05",
                  kyc_status="verified", email_verified_at="2025-03-05T10:00:00Z",
                  phone_verified_at="2025-03-05T10:00:00Z")
    mar += player(302, "2025-03-06", "2025-03-06",
                  kyc_status="pending")          # covered, so email/phone are "no"
    for i in range(400, 460):
        mar += player(i, "2025-03-07", "2025-03-07", kyc_status="verified",
                      email_verified_at="2025-03-07T10:00:00Z")

    # A row in the covered month that carries no verification value at all, for
    # a player who also appears in the uncovered month. Covered wins.
    mar += [row(101, "2025-03-20", first_deposit_date="2025-01-05",
                kyc_status="approved")]

    json.dump(jan, open(os.path.join(cache, "2025-01.json"), "w"))
    json.dump(mar, open(os.path.join(cache, "2025-03.json"), "w"))

    data, log = build(cache, os.path.join(tmp, "out.json"))

    print("\nthe dimensions appear by themselves")
    keys = [d["key"] for d in data["dims"]]
    for k in ("kyc", "email", "phone"):
        check(k in keys, "%s is on the page once the column is in the cache" % k)
    check("ftdt" in keys and "chan" in keys and "rail" in keys,
          "alongside the three that were already there — %s" % ", ".join(keys))

    print("\nthe coverage line names the partial rollout")
    for k in ("kyc", "email", "phone"):
        check("%-6s carried by 1 of 2 cached months" % k in log or
              ("%s " % k) in log and "carried by 1 of 2 cached months" in log,
              "%s is reported as carried by 1 of 2 months" % k)

    print("\nclassification inside a covered month")
    dim, kyc = codes_of(data, "kyc")
    labels = [o[1] for o in dim["opts"][1:]]
    check(labels == ["KYC verified", "KYC not verified", "KYC unknown"],
          "kyc codes are %s" % ", ".join(labels))

    counts = {}
    for k in ("kyc", "email", "phone"):
        dm, cs = codes_of(data, k)
        counts[k] = {dm["opts"][i + 1][1]: cs.count(i) for i in range(dm["card"])}
    print("   " + json.dumps(counts, indent=None)[:400])

    check(counts["kyc"]["KYC verified"] == 62,
          "62 players verified (301 + the 60 padding + 101, who was covered in March)")
    check(counts["kyc"]["KYC not verified"] == 1,
          "302 is 'pending', which is a real not-verified rather than an unknown")
    check(counts["email"]["Email verified"] == 61,
          "61 email-verified — a timestamp is present or it is not")
    check(counts["email"]["Email not verified"] == 2,
          "302 and 101 sit in a covered month with no timestamp, so they are a real no")
    check(counts["phone"]["Phone verified"] == 1,
          "only 301 has a phone timestamp")

    print("\nthe case that would otherwise ship broken")
    unknown = counts["kyc"]["KYC unknown"]
    check(unknown == 61,
          "the 61 players seen only in the month written before the column existed are "
          "UNKNOWN, not 'not verified' — %d of them" % unknown)
    check(counts["email"]["Email unknown"] == 61 and counts["phone"]["Phone unknown"] == 61,
          "and the same for email and phone")
    check(counts["kyc"]["KYC unknown"] + counts["kyc"]["KYC verified"] +
          counts["kyc"]["KYC not verified"] == data["totalMembers"],
          "the three buckets partition all %d players exactly" % data["totalMembers"])

    print("\nand the filters still compose")
    check(data["combos"] == 3 * 3 * 4 * 3 * 3 * 3,
          "six dimensions pack into %d combinations" % data["combos"])
    check(max(data["players"]["attr"]) < data["combos"],
          "every packed code is inside that range")

print("\n" + ("%d FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
