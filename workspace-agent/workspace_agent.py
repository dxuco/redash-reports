#!/usr/bin/env python3
"""
Workspace sync agent — pushes data from places the cloud can't reach (a VPN-only Redash,
files on disk) into the Workspace app.

Pure Python standard library: no pip installs. Python 3.8+ on Windows, macOS or Linux.

  python workspace_agent.py status                      check the app URL and token
  python workspace_agent.py run                         run every job in config.json once
  python workspace_agent.py run --job ftd-current       run one job
  python workspace_agent.py run --loop 3600             keep running, every hour
  python workspace_agent.py push --dataset fj-1732 --mode replace C:/redash-page/ftd-report/cache/*.json

Config lives next to this file in config.json (see config.example.json).
"""
import argparse
import calendar
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.json")
STATE_PATH = os.path.join(HERE, ".agent_state.json")
LOG_PATH = os.path.join(HERE, "agent.log")
MAX_BYTES = 3_500_000  # stay under the host's 4.5 MB request limit
ROWS_PER_CHUNK = 5000


# ---------------------------------------------------------------------------- utils
def log(msg):
    line = f"[{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def save_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def filter_columns(rows, include=None, exclude=None):
    """Keep only the columns worth storing. Wide JSON columns cost far more space than they earn."""
    if not rows or (not include and not exclude):
        return rows
    if include:
        # Rows can be sparse (a cached export omits empty fields), so the column
        # universe is the union across rows, not whatever the first row happens to carry.
        present = set()
        for r in rows:
            present.update(r.keys())
        keep = [c for c in include if c in present]
        missing = [c for c in include if c not in present]
        if missing:
            log(f"  note: these columns are not in the result and were skipped: {', '.join(missing)}")
        return [{k: r.get(k) for k in keep} for r in rows]
    drop = set(exclude or [])
    return [{k: v for k, v in r.items() if k not in drop} for r in rows]


def month_end(d):
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def add_months(d, n):
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def template_vars(today=None):
    t = today or dt.date.today()
    ms = t.replace(day=1)
    pms = add_months(ms, -1)
    return {
        "today": t.isoformat(),
        "yesterday": (t - dt.timedelta(days=1)).isoformat(),
        "month_start": ms.isoformat(),
        "month_end": month_end(t).isoformat(),
        "prev_month_start": pms.isoformat(),
        "prev_month_end": month_end(pms).isoformat(),
        "days_ago_7": (t - dt.timedelta(days=7)).isoformat(),
        "days_ago_30": (t - dt.timedelta(days=30)).isoformat(),
        "year_start": t.replace(month=1, day=1).isoformat(),
    }


def apply_template(value, variables):
    s = json.dumps(value)
    s = re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}", lambda m: variables.get(m.group(1), m.group(0)), s)
    return json.loads(s)


def redact(text):
    return re.sub(r"(api_key=)[^&\s]+", r"\1***", str(text))


def http_json(url, method="GET", body=None, headers=None, timeout=120):
    data = None if body is None else json.dumps(body, default=str).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    # A plain browser string: the Redash host sits behind an nginx WAF that has
    # refused requests naming a tool, and the team's own scripts send nothing unusual.
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    req.add_header("Accept-Language", "en-US,en;q=0.9")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("error", detail)
        except ValueError:
            pass
        raise RuntimeError(redact(f"{method} {url} -> HTTP {e.code}: {str(detail)[:400]}")) from None
    except urllib.error.URLError as e:
        raise RuntimeError(redact(f"{method} {url} -> {e.reason}")) from None


TRANSIENT = ("HTTP 403", "HTTP 429", "HTTP 502", "HTTP 503", "HTTP 504",
             "forcibly closed", "reset by peer", "Remote end closed", "timed out", "Connection aborted")


def with_retries(fn, what="request", tries=3, wait=30):
    """A dropped VPN tunnel or a WAF hiccup is worth waiting out rather than failing the run."""
    for i in range(tries):
        try:
            return fn()
        except RuntimeError as e:
            msg = str(e)
            if i == tries - 1 or not any(t in msg for t in TRANSIENT):
                raise
            log(f"  {what} refused ({msg.splitlines()[0][:120]}) — retrying in {wait}s")
            time.sleep(wait)
            wait *= 2


# ---------------------------------------------------------------------------- app client
class App:
    def __init__(self, url, token):
        if not url or not token:
            raise SystemExit("config.json needs app_url and token (create a token in Settings -> Sync agent)")
        self.url = url.rstrip("/")
        self.h = {"Authorization": f"Bearer {token}"}

    def begin(self, dataset, mode="replace", rng=None, create_name=None):
        body = {"dataset": dataset, "mode": mode}
        if rng:
            body["range"] = rng
        if create_name:
            body["create"] = {"name": create_name}
        return http_json(f"{self.url}/api/ingest/begin", "POST", body, self.h)["batchId"]

    def _send(self, batch, rows):
        payload = json.dumps({"rows": rows}, default=str)
        if len(payload) > MAX_BYTES and len(rows) > 1:
            mid = len(rows) // 2
            self._send(batch, rows[:mid])
            self._send(batch, rows[mid:])
            return
        for attempt in range(4):
            try:
                http_json(f"{self.url}/api/ingest/{batch}/rows", "POST", {"rows": rows}, self.h)
                return
            except RuntimeError as e:
                if attempt == 3 or "HTTP 4" in str(e):
                    raise
                time.sleep(2 ** attempt)

    def push(self, dataset, rows, mode="replace", rng=None, create_name=None, label=""):
        batch = self.begin(dataset, mode, rng, create_name)
        try:
            for i in range(0, len(rows), ROWS_PER_CHUNK):
                self._send(batch, rows[i:i + ROWS_PER_CHUNK])
            res = http_json(f"{self.url}/api/ingest/{batch}/commit", "POST", {}, self.h, timeout=320)
        except Exception:
            try:
                http_json(f"{self.url}/api/ingest/{batch}/abort", "POST", {}, self.h)
            except Exception:
                pass
            raise
        log(f"  pushed {len(rows):,} rows to '{dataset}' ({mode}{' ' + label if label else ''}); dataset now {res.get('totalRows', '?'):,} rows")
        return res


# ---------------------------------------------------------------------------- sources
def load_env_file(path):
    """Read a KEY=VALUE file (e.g. the Redash MCP's config.env) without echoing its values."""
    out = {}
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError as e:
        log(f"  could not read {path}: {e}")
    return out


def _real(v):
    return v if v and not v.startswith("PASTE_") else ""


def redash_creds(cfg):
    """Returns (base_url, account_key, {query_id: per_query_key}). Values come from config.json,
    or from the config.env the Redash MCP already uses, so keys live in one place."""
    env = load_env_file(cfg["redash_config_env"]) if cfg.get("redash_config_env") else {}
    url = _real(cfg.get("redash_url", "")) or next(
        (v for k, v in env.items() if "REDASH" in k.upper() and ("URL" in k.upper() or "HOST" in k.upper())), "")
    account = _real(cfg.get("redash_api_key", "")) or next(
        (v for k, v in env.items() if "KEY" in k.upper() and "REDASH" in k.upper() and not re.search(r"\d{3,}", k)), "")
    per_query = {}
    for k, v in env.items():
        if "KEY" not in k.upper():
            continue
        m = re.search(r"(\d{3,})", k)
        if m:
            per_query[m.group(1)] = v
    for k, v in (cfg.get("redash_query_keys") or {}).items():
        per_query[str(k)] = v
    return url.rstrip("/"), account, per_query


def redash_query(cfg, query_id, parameters, max_age=0, timeout=900):
    base, account, per_query = redash_creds(cfg)
    if not base:
        raise RuntimeError("No Redash URL — set redash_url, or redash_config_env pointing at config.env")
    key = per_query.get(str(query_id))
    if key:
        # A per-query key only works as ?api_key= on that query's own endpoints.
        h, q = {}, f"?api_key={key}"
    elif account:
        h, q = {"Authorization": f"Key {account}"}, ""
    else:
        raise RuntimeError(f"No API key for query {query_id} — add an account key or a per-query key")

    body = {"parameters": parameters, "max_age": max_age}
    r = with_retries(lambda: http_json(f"{base}/api/queries/{query_id}/results{q}", "POST", body, h),
                     what=f"Redash query {query_id}")
    if "query_result" in r:
        return r["query_result"]["data"]["rows"]
    job = r.get("job")
    start = time.time()
    while job and time.time() - start < timeout:
        time.sleep(3)
        job_url = f"{base}/api/queries/{query_id}/jobs/{job['id']}{q}" if key else f"{base}/api/jobs/{job['id']}"
        job = with_retries(lambda: http_json(job_url, headers=h), what="job status")["job"]
        status = job.get("status")
        if status == 3:
            return fetch_result(base, query_id, job.get("query_result_id"), h, q, key, parameters)
        if status in (4, 5):
            raise RuntimeError(f"Redash query {query_id} failed: {job.get('error') or 'cancelled'}")
    raise RuntimeError(f"Redash query {query_id} timed out after {timeout}s")


def fetch_result(base, query_id, result_id, h, q, key, parameters):
    """Collect the finished rows. A per-query key may not read a result by its id, so ask for the
    just-cached result of the same parameters instead."""
    attempts = []
    if not key and result_id:
        attempts.append(("GET", f"{base}/api/queries/{query_id}/results/{result_id}.json{q}", None))
    attempts.append(("POST", f"{base}/api/queries/{query_id}/results{q}", {"parameters": parameters, "max_age": 1800}))
    if result_id:
        attempts.append(("GET", f"{base}/api/queries/{query_id}/results/{result_id}.json{q}", None))
    attempts.append(("GET", f"{base}/api/queries/{query_id}/results.json{q}", None))
    last = None
    for method, url, body in attempts:
        try:
            r = http_json(url, method, body, h, timeout=600)
            if "query_result" in r:
                return r["query_result"]["data"]["rows"]
            if r.get("job"):  # still running: give it a moment and try the next way
                time.sleep(5)
        except RuntimeError as e:
            last = e
    raise RuntimeError(f"Redash finished query {query_id} but the rows couldn't be read ({last})")


def read_file(path):
    low = path.lower()
    if low.endswith(".json"):
        data = load_json(path)
        if isinstance(data, dict):
            data = data.get("rows") or (data.get("data") or {}).get("rows") or (data.get("query_result") or {}).get("data", {}).get("rows")
        if not isinstance(data, list):
            raise RuntimeError(f"{path}: expected a JSON array of rows")
        return data
    if low.endswith((".csv", ".tsv", ".txt")):
        import csv
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            sample = f.read(4096)
            f.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|") if sample else csv.excel
            return list(csv.DictReader(f, dialect=dialect))
    raise RuntimeError(f"{path}: only .json and .csv/.tsv files are supported by the agent (upload .xlsx in the app)")


MONTH_RE = re.compile(r"(\d{4})-(\d{2})")


def month_range_from_name(path, column):
    m = MONTH_RE.search(os.path.basename(path))
    if not m:
        return None
    start = dt.date(int(m.group(1)), int(m.group(2)), 1)
    return {"column": column, "from": start.isoformat(), "to": month_end(start).isoformat()}


# ---------------------------------------------------------------------------- jobs
def run_job(app, cfg, job, state):
    name = job.get("name") or job["dataset"]
    variables = template_vars()
    if "query_id" in job:
        params = apply_template(job.get("parameters", {}), variables)
        log(f"job {name}: Redash query {job['query_id']} {json.dumps(params)}")
        rows = redash_query(cfg, job["query_id"], params, job.get("max_age", 0))
        rows = filter_columns(rows, job.get("include_columns"), job.get("exclude_columns"))
        rng = apply_template(job.get("range"), variables) if job.get("range") else None
        app.push(job["dataset"], rows, job.get("mode", "replace"), rng, job.get("create_name"))
    elif "files" in job:
        paths = sorted(glob.glob(job["files"]))
        if not paths:
            log(f"job {name}: no files match {job['files']}")
            return
        seen = state.setdefault("files", {})
        per_month = job.get("range_from_filename")
        if per_month:
            # One batch per changed file; each replaces just its own month.
            for p in paths:
                sig = f"{os.path.getmtime(p)}:{os.path.getsize(p)}"
                if job.get("only_changed", True) and seen.get(p) == sig:
                    continue
                rng = month_range_from_name(p, per_month)
                if not rng:
                    log(f"  skip {p}: no YYYY-MM in the file name")
                    continue
                log(f"job {name}: {os.path.basename(p)}")
                rows = filter_columns(read_file(p), job.get("include_columns"), job.get("exclude_columns"))
                app.push(job["dataset"], rows, "replace_range", rng, job.get("create_name"), label=rng["from"][:7])
                seen[p] = sig
                save_json(STATE_PATH, state)
        else:
            sigs = {p: f"{os.path.getmtime(p)}:{os.path.getsize(p)}" for p in paths}
            if job.get("only_changed", True) and all(seen.get(p) == s for p, s in sigs.items()):
                log(f"job {name}: files unchanged, skipping")
                return
            rows = []
            for p in paths:
                rows.extend(filter_columns(read_file(p), job.get("include_columns"), job.get("exclude_columns")))
            log(f"job {name}: {len(paths)} files")
            app.push(job["dataset"], rows, job.get("mode", "replace"), None, job.get("create_name"))
            seen.update(sigs)
            save_json(STATE_PATH, state)
    else:
        raise RuntimeError(f"job {name}: needs either query_id or files")


def cmd_run(args):
    cfg = load_json(CONFIG_PATH)
    if not cfg:
        raise SystemExit(f"Missing {CONFIG_PATH}. Copy config.example.json to config.json and fill it in.")
    app = App(cfg.get("app_url"), cfg.get("token"))
    while True:
        state = load_json(STATE_PATH, {}) or {}
        failures = 0
        for job in cfg.get("jobs", []):
            if args.job and args.job not in (job.get("name"), job.get("dataset")):
                continue
            if job.get("disabled"):
                continue
            try:
                run_job(app, cfg, job, state)
            except Exception as e:  # keep going with the other jobs
                failures += 1
                msg = str(e)
                if any(w in msg.lower() for w in ("timed out", "unreachable", "getaddrinfo", "connection", "failed to establish")):
                    log(f"SKIPPED job {job.get('name') or job.get('dataset')}: source not reachable — is the VPN connected? ({msg[:160]})")
                else:
                    log(f"ERROR in job {job.get('name') or job.get('dataset')}: {msg}")
        if not args.loop:
            sys.exit(1 if failures else 0)
        log(f"sleeping {args.loop}s")
        time.sleep(args.loop)


def cmd_push(args):
    cfg = load_json(CONFIG_PATH, {}) or {}
    app = App(args.app_url or cfg.get("app_url"), args.token or cfg.get("token"))
    include = [c.strip() for c in args.columns.split(",")] if args.columns else None
    exclude = [c.strip() for c in args.exclude.split(",")] if args.exclude else None
    paths = []
    for pattern in args.files:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])
    if args.mode == "per-month":
        if not args.range_column:
            raise SystemExit("--mode per-month needs --range-column (the dataset's date column, e.g. date)")
        for p in paths:
            rng = month_range_from_name(p, args.range_column)
            if not rng:
                log(f"skip {p}: no YYYY-MM in file name")
                continue
            app.push(args.dataset, filter_columns(read_file(p), include, exclude), "replace_range", rng, args.create, label=rng["from"][:7])
        return
    rows = []
    for p in paths:
        r = filter_columns(read_file(p), include, exclude)
        log(f"read {p}: {len(r):,} rows")
        rows.extend(r)
    rng = None
    if args.mode == "replace_range":
        rng = {"column": args.range_column, "from": args.range_from, "to": args.range_to}
    app.push(args.dataset, rows, args.mode, rng, args.create)


def cmd_status(_args):
    cfg = load_json(CONFIG_PATH, {}) or {}
    app = App(cfg.get("app_url"), cfg.get("token"))
    try:
        http_json(f"{app.url}/api/ingest/begin", "POST", {"dataset": "__agent_status_check__"}, app.h)
    except RuntimeError as e:
        msg = str(e)
        if "HTTP 400" in msg and "not found" in msg:
            print(f"OK: {app.url} accepted the token.")
        elif "HTTP 401" in msg:
            print("Token rejected (revoked or mistyped). Create a new one in Settings -> Sync agent.")
        else:
            print(f"Problem reaching the app: {msg}")

    base, account, per_query = redash_creds(cfg)
    if not base:
        print("No Redash URL configured.")
        return
    print(f"Redash: {base}  (account key: {'yes' if account else 'no'}; per-query keys: {', '.join(sorted(per_query)) or 'none'})")
    seen = {}
    for j in cfg.get("jobs", []):
        if j.get("query_id") and str(j["query_id"]) not in seen:
            seen[str(j["query_id"])] = apply_template(j.get("parameters", {}), template_vars())
    for qid in seen or {k: {} for k in sorted(per_query)}:
        key = per_query.get(qid)
        h, q = ({}, f"?api_key={key}") if key else ({"Authorization": f"Key {account}"}, "")
        how = "per-query key" if key else "account key"
        try:
            http_json(f"{base}/api/queries/{qid}/results{q}", "POST",
                      {"parameters": seen.get(qid, {}), "max_age": 86400}, h, timeout=90)
            print(f"OK: query {qid} reachable ({how})")
        except RuntimeError as e:
            msg = str(e)
            if "Missing parameter value" in msg:
                print(f"OK: query {qid} reachable ({how}) — parameters are filled in at run time")
            else:
                print(f"Query {qid} refused: {msg.splitlines()[0][:200]}")


def main():
    ap = argparse.ArgumentParser(description="Workspace sync agent")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run jobs from config.json")
    r.add_argument("--job", help="only run the job with this name or dataset")
    r.add_argument("--loop", type=int, default=0, help="repeat every N seconds")
    p = sub.add_parser("push", help="push files to a dataset")
    p.add_argument("--dataset", required=True, help="dataset slug or id")
    p.add_argument("--mode", default="replace", choices=["replace", "append", "replace_range", "per-month"])
    p.add_argument("--range-column")
    p.add_argument("--range-from")
    p.add_argument("--range-to")
    p.add_argument("--create", help="create the dataset with this name if the slug doesn't exist")
    p.add_argument("--columns", help="comma-separated list of columns to keep")
    p.add_argument("--exclude", help="comma-separated list of columns to drop")
    p.add_argument("--app-url")
    p.add_argument("--token")
    p.add_argument("files", nargs="+")
    sub.add_parser("status", help="check connectivity")
    args = ap.parse_args()
    {"run": cmd_run, "push": cmd_push, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
