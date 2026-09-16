#!/usr/bin/env python3
"""Run every report build, in parallel where the steps allow it.

WHY THIS EXISTS
    The pipeline used to be thirteen steps run strictly one after another in a
    .bat file, which took about ten minutes. Most of those steps only read the
    month caches and never touch each other's output, so most of that time was
    spent waiting for no reason.

    The dependency graph is small and almost flat:

        cache      build-ftd.js refreshes ftd-report/cache from Redash.
                   Everything that reads the cache waits for it.
        bonus      own cache, own Redash pull  -- independent
        acq        own Redash pull + Drive     -- independent
        vip        own Redash pull             -- independent
        cost2025   reads what acq wrote        -- waits for acq
        month, overview, retention, reactivation, streamers, ftdcountry
                   read the shared cache       -- wait for cache, not each other
        publish    needs every page built
        verify     needs publish

    So the three Redash pulls run alongside the cache refresh, and the six
    cache readers run together once it lands.

WHY PYTHON AND NOT THE .BAT
    Running six things at once from cmd means start /b, flag files and quoting
    that cannot be tested anywhere except Windows. This is the same logic in a
    form that can be read and tested, and the .bat just calls it.

WHAT IT GUARANTEES
    - A step that fails never stops the others. That is the whole point of the
      old file's design and it is kept: a broken VPN must not take the site
      down, it must publish yesterday's copy of whatever could not rebuild.
    - Every step's output goes to logs/<name>.log, never to the shared console.
      Six steps printing at once interleaves into something unreadable, and the
      one line that explains a failure is exactly what gets lost.
    - The publish step runs only after everything that could still be building
      has finished, whether it succeeded or not.
"""
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, "logs")
RUNLOG = os.path.join(HERE, "update-all.log")
PY = [sys.executable]
NODE = ["node", "--max-old-space-size=6000"]

MONTH = time.strftime("%Y-%m")


def step(name, label, cmds, needs=()):
    return {"name": name, "label": label, "cmds": cmds, "needs": set(needs)}


# cmds is a LIST of commands run in order; the step fails at the first one that
# does, and the rest are skipped -- the same "build the data, then bake the
# page, and do not bake from data that failed" rule the .bat had.
STEPS = [
    step("cache", "FTD Report (refreshes the shared cache)", [
        NODE + ["build-ftd.js"],
        NODE + ["make-ftd-html.js"],
    ]),
    step("bonus", "Bonus Cost", [NODE + ["build.js", "--verify"]]),
    step("acq", "Acquisition & CPA", [PY + ["acquisition-report/build_acquisition.py"]]),
    step("vip", "VIP Transfer", [
        ["node", "vip-transfer/fetch_vip.js"],
        PY + ["vip-transfer/build_vip_transfer.py"],
        PY + ["vip-transfer/make_vip_transfer_html.py"],
    ]),
    step("cost2025", "Cost 2025", [PY + ["acquisition-report/gen_2025.py"]], needs=["acq"]),

    step("month", "FTD %s" % MONTH, [
        NODE + ["build-month.js", "--month=" + MONTH, "--cached"],
        NODE + ["make-month-html.js", "--month=" + MONTH],
    ], needs=["cache"]),
    step("overview", "Business Overview & FTD Share", [
        PY + ["overview/build_overview.py"],
        PY + ["overview/make_overview_html.py"],
        PY + ["overview/build_drilldown.py"],
        PY + ["overview/build_mix.py"],
        PY + ["overview/make_mix_html.py"],
    ], needs=["cache"]),
    step("retention", "Retention", [
        PY + ["retention/build_retention.py"],
        PY + ["retention/make_retention_html.py"],
    ], needs=["cache"]),
    step("reactivation", "Reactivation", [
        PY + ["reactivation/build_reactivation.py"],
        PY + ["reactivation/make_reactivation_html.py"],
    ], needs=["cache"]),
    step("streamers", "Streamers", [
        PY + ["streamers/build_streamers.py"],
        PY + ["streamers/make_streamers_html.py"],
    ], needs=["cache"]),
    step("ftdcountry", "FTD (Country)", [
        PY + ["ftd-channels/build_ftd_channels.py"],
        PY + ["ftd-channels/make_ftd_channels_html.py"],
    ], needs=["cache"]),
    step("ftdbonus", "FTD Bonus Treatment", [
        PY + ["ftd-bonus-dashboard/build_cohorts.py"],
        PY + ["ftd-bonus-dashboard/merge_smartico.py"],
        PY + ["ftd-bonus-dashboard/build_final.py"],
        PY + ["ftd-bonus-dashboard/build_dashboard_data.py"],
        PY + ["ftd-bonus-dashboard/make_html.py"],
    ], needs=["cache"]),
]

# cache and month run from inside ftd-report; everything else from the root.
CWD = {"cache": os.path.join(HERE, "ftd-report"),
       "month": os.path.join(HERE, "ftd-report")}


def run_step(s):
    """Run one step's commands in order. Returns (name, ok, seconds)."""
    t0 = time.time()
    log = os.path.join(LOGS, s["name"] + ".log")
    with open(log, "w", encoding="utf-8") as fh:
        for cmd in s["cmds"]:
            fh.write("\n$ %s\n" % " ".join(cmd))
            fh.flush()
            rc = subprocess.call(cmd, cwd=CWD.get(s["name"], HERE),
                                 stdout=fh, stderr=subprocess.STDOUT)
            if rc != 0:
                fh.write("\n[exit %d]\n" % rc)
                return s["name"], False, time.time() - t0
    return s["name"], True, time.time() - t0


def main():
    os.makedirs(LOGS, exist_ok=True)
    started = time.strftime("%Y-%m-%d %H:%M")
    with open(RUNLOG, "a", encoding="utf-8") as fh:
        fh.write("\n===== run started %s  (month %s) =====\n" % (started, MONTH))

    print("\n  Building %d report steps, in parallel where they allow it." % len(STEPS))
    print("  Each step's output goes to logs\\<name>.log\n")

    done, failed, timings = set(), [], {}
    pending = {s["name"]: s for s in STEPS}
    t0 = time.time()

    # A step becomes runnable when everything it needs has FINISHED -- not when
    # everything it needs has SUCCEEDED. A failed cache still leaves yesterday's
    # copy on disk, and the readers should build from that rather than being
    # skipped, exactly as the sequential version did.
    with ThreadPoolExecutor(max_workers=8) as pool:
        running = {}
        while pending or running:
            for name, s in list(pending.items()):
                if s["needs"] <= done:
                    running[pool.submit(run_step, s)] = s
                    del pending[name]
                    print("  -> started  %s" % s["label"])
            if not running:
                break
            for fut in list(running):
                if fut.done():
                    s = running.pop(fut)
                    nm, ok, secs = fut.result()
                    done.add(nm)
                    timings[nm] = secs
                    if not ok:
                        failed.append(s["label"])
                    print("  %s %-38s %5.0fs" %
                          ("ok  " if ok else "FAIL", s["label"], secs))
            time.sleep(0.2)

    build_secs = time.time() - t0
    print("\n  All builds finished in %.0fs" % build_secs)
    for nm, secs in sorted(timings.items(), key=lambda kv: -kv[1]):
        print("     %-14s %5.0fs" % (nm, secs))

    # ---- publish, once nothing can still be writing a page ----
    print("\n  Publishing...")
    plog = os.path.join(HERE, "publish-last.log")
    with open(plog, "w", encoding="utf-8") as fh:
        rc = subprocess.call(["node", "publish-worker.js"], cwd=HERE,
                             stdout=fh, stderr=subprocess.STDOUT)
    published = rc == 0
    print("  %s" % ("Published." if published else
                    "PUBLISH FAILED - the live site still shows the previous version."
                    "  See publish-last.log"))
    if not published:
        failed.append("Publish")

    if published:
        subprocess.call(["node", "verify-public.js"], cwd=HERE)

    total = time.time() - t0
    with open(RUNLOG, "a", encoding="utf-8") as fh:
        fh.write("  builds %.0fs, total %.0fs\n" % (build_secs, total))
        fh.write("  %s\n" % ("published OK" if published else "PUBLISH FAILED"))
        fh.write("  finished: %d of %d steps OK%s\n"
                 % (len(STEPS) - len([f for f in failed if f != "Publish"]),
                    len(STEPS),
                    "" if not failed else ", FAILED: " + ", ".join(failed)))

    print("\n  " + "=" * 58)
    if failed:
        print("  Done, with problems. These went out as the previous copy:")
        for f in failed:
            print("     %s" % f)
    else:
        print("  Done. Every report rebuilt and the site is live.")
    print("  Total %.0fs (%.0f min)" % (total, total / 60))
    print("  " + "=" * 58 + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
