# General Report Architecture

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          REDASH (Cloud)                             │
│                    https://redash.veis.tech                         │
│  ┌──────────────────────────┐      ┌──────────────────────────┐    │
│  │ Query 1731               │      │ Query 1732               │    │
│  │ Bonus Cost By Categories │      │ Marketing General Report │    │
│  │ (monthly bonus costs)    │      │ (daily metrics)          │    │
│  └──────────────────────────┘      └──────────────────────────┘    │
└──────────────────┬───────────────────────────┬──────────────────────┘
                   │                           │
                   │ (API keys in config.env)  │
                   ▼                           ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │ build.js             │    │ build-ftd.js         │
        │ (9-15 min)           │    │ (2-3 min)            │
        └──────────────────────┘    └──────────────────────┘
                   │                           │
                   ├──────────────┬────────────┤
                   ▼              ▼            ▼
         ┌──────────────────┐    ┌────────────────────────────┐
         │ output/cache/    │    │ output/data/               │
         │ cache-bonus/     │    │ - data.json (15-20 MB)     │
         │ (month caches)   │    │ - bonus-groups.json        │
         └──────────────────┘    └────────────────────────────┘
                   │                           │
                   ├───────────────┬───────────┤
                   ▼               ▼           ▼
         ┌─────────────────┐  ┌──────────────────────────────────┐
         │ build-month.js  │  │ make-ftd-html.js                 │
         │ (1 min)         │  │ (bake data into HTML)            │
         └─────────────────┘  └──────────────────────────────────┘
                   │                           │
                   ├─────────────────────┬─────┤
                   ▼                     ▼     ▼
         ┌──────────────────────────────────────────────────┐
         │ output/cache/ftd-report/cache/ (FTD data)        │
         │ Player-day-game rows (80k-130k per month)        │
         └──────────────────────────────────────────────────┘
                   │
    ┌──────────────┼──────────────┬──────────────┐
    ▼              ▼              ▼              ▼
 ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐
 │overview/  │ │retention/│ │reactiva- │ │vip-transfer/  │
 │build_     │ │build_    │ │tion/     │ │build_         │
 │overview.py│ │retention │ │build_    │ │vip_transfer.py│
 │           │ │.py       │ │reactiv.py│ │               │
 └────┬──────┘ └────┬─────┘ └────┬─────┘ └────┬──────────┘
      │             │             │            │
      ▼             ▼             ▼            ▼
 ┌──────────────────────────────────────────────────────┐
 │ output/reports/ — Generated HTML reports            │
 │ - bonus-cost-report.html (20-25 MB)                 │
 │ - ftd-channels.html (3-4 MB)                        │
 │ - business-overview.html                            │
 │ - ftd-share.html                                    │
 │ - retention.html                                    │
 │ - acquisition-2026.html                             │
 │ - reactivation.html                                 │
 │ - vip-transfer.html                                 │
 └──────────────────────────────────────────────────────┘
                   │
                   ▼
      ┌────────────────────────────────┐
      │ publish-worker.js              │
      │ Bake HTML into Worker code     │
      │ Add password protection        │
      │ (1 min)                        │
      └────────────────────────────────┘
                   │
                   ▼
      ┌────────────────────────────────┐
      │ CLOUDFLARE WORKERS (Live)      │
      │ https://reports.wayzen.workers │
      │ .dev                           │
      └────────────────────────────────┘
```

---

## Data Processing Pipeline

### Stage 1: Fetch from Redash (9-15 minutes)

```
build.js starts
  │
  ├─→ Check config/config.env for API keys
  │
  ├─→ Call Redash 1731: Bonus Cost By Categories
  │   └─→ Cache in: output/cache/cache-bonus/
  │
  ├─→ Call Redash 1732: Marketing General Report
  │   └─→ Cache in: output/cache/cache-bonus/
  │
  ├─→ Combine both queries
  │
  └─→ Output: output/data/data.json (15-20 MB)
```

**Why it takes 9-15 minutes:**
- Query 1732 returns 80k-130k rows per month
- Full year = 1M+ rows
- Cloudflare parsing + compression takes time

### Stage 2: Extract FTD Data (2-3 minutes)

```
build-ftd.js starts
  │
  ├─→ Read: output/data/data.json
  │
  ├─→ Filter to FTD players (first deposit)
  │
  ├─→ Break down by day, country, channel
  │
  ├─→ Save daily aggregates
  │
  └─→ Output: output/cache/ftd-report/cache/
      ├─→ 2026-01.json
      ├─→ 2026-02.json
      └─→ ...
```

These cached files power all other reports (no Redash calls needed).

### Stage 3: Build All Reports

**Bonus Cost Report**
```
build.js output
  └─→ make-standalone.js
  │   └─→ Bake data.json + template into HTML
  └─→ output/reports/bonus-cost-report.html (self-contained)
```

**Business Overview (no Redash calls!)**
```
output/cache/ftd-report/cache/ (from stage 2)
  └─→ overview/build_overview.py
  │   └─→ Aggregate daily, by cohort
  │   └─→ output/data/overview-data.json
  │
  └─→ overview/make_overview_html.py
      └─→ output/reports/business-overview.html
```

**FTD Share (uses Overview data!)**
```
output/data/overview-data.json (from above)
  └─→ overview/build_mix.py
  │   └─→ Split into 5 cohorts
  │   └─→ output/data/mix-data.json
  │
  └─→ overview/make_mix_html.py
      └─→ output/reports/ftd-share.html
```

**Retention** (same pattern)
```
output/cache/ftd-report/cache/
  └─→ retention/build_retention.py
  │   └─→ Calculate cohort retention
  │   └─→ output/data/retention-data.json
  │
  └─→ retention/make_retention_html.py
      └─→ output/reports/retention.html
```

**Reactivation** (same pattern)
```
output/cache/ftd-report/cache/
  └─→ reactivation/build_reactivation.py
      └─→ output/reports/reactivation.html
```

### Stage 4: Publish to Web (1 minute)

```
publish-worker.js starts
  │
  ├─→ Read all HTML files from output/reports/
  │
  ├─→ Compress + embed data into Worker code
  │
  ├─→ Add password login middleware
  │
  ├─→ Deploy to Cloudflare Workers
  │
  └─→ Live at: https://reports.wayzen.workers.dev
```

---

## Caching Strategy

### Why Cache?
- Query 1732 takes 2-3 min to run
- A full year of data takes 20+ minutes
- Closed months don't change, so cache them

### How It Works

```
build.js logic:
  ├─ Check if month exists in output/cache/cache-bonus/
  ├─ If yes AND age < 7 days
  │ └─ Use cached file (instant)
  ├─ If no OR age > 7 days
  │ └─ Query Redash (2-3 min)
  │   └─ Save to output/cache/cache-bonus/
  └─ Current month always refetched (money changes daily)
```

### Cache Lifetimes

| Cache | Lifetime | Refresh |
|---|---|---|
| `cache-bonus/` | 7 days | Refetch if older |
| `ftd-report/cache/` | Until next full run | Always fresh |
| `data.json` | Until next `build.js` | Daily |
| `overview-data.json` | Until next `build_overview.py` | Daily |

### Force Refresh Everything
```bash
node scripts/build/build.js --no-cache
```

---

## Report Dependencies

```
Bonus Cost Report (build.js)
  ├─ Data: Redash 1731 + 1732
  ├─ Output: bonus-cost-report.html
  └─ Cache: cache-bonus/, data.json

FTD Report (build-ftd.js)
  ├─ Data: data.json (from Bonus Cost)
  ├─ Output: ftd-channels.html
  └─ Cache: ftd-report/cache/ (used by all others)

Business Overview (overview/build_overview.py)
  ├─ Data: ftd-report/cache/ (no Redash calls!)
  ├─ Output: business-overview.html
  └─ Data: overview-data.json

FTD Share (overview/build_mix.py)
  ├─ Data: overview-data.json (from Business Overview)
  ├─ Output: ftd-share.html
  └─ Constraint: Must match Overview numbers exactly!

Retention (retention/build_retention.py)
  ├─ Data: ftd-report/cache/
  ├─ Output: retention.html
  └─ Independent from others

Reactivation (reactivation/build_reactivation.py)
  ├─ Data: ftd-report/cache/
  ├─ Output: reactivation.html
  └─ Independent from others
```

---

## Build Order (From UPDATE-EVERYTHING.bat)

```
1. build.js                  → data.json + cache-bonus
2. build-ftd.js              → ftd-report/cache (used by all)
3. build-month.js            → current month version
4. overview/build_overview.py → overview-data.json
5. overview/build_mix.py     → mix-data.json (must be after 4!)
6. overview/make_mix_html.py → ftd-share.html
7. retention/build_retention.py → retention-data.json
8. reactivation/build_reactivation.py → reactivation.html
9. publish-worker.js         → Deploy to Cloudflare
10. verify-public.js         → Confirm live
```

**Why this order?**
- Step 1 feeds 2, which feeds 3-8
- Step 4 must finish before 5 (FTD Share depends on Overview data)
- Step 9-10 are deployment

---

## File Sizes & Timing

### Input Data
- Redash 1732: ~80k-130k rows/month
- Full year: 1M+ rows
- Uncompressed JSON: 8-12 MB/month

### Intermediate Caches
- `cache-bonus/`: 8-12 MB/month
- `ftd-report/cache/`: 500 KB-2 MB/month
- `overview-data.json`: 12-15 MB
- `mix-data.json`: 3-4 MB

### Output Reports
- `bonus-cost-report.html`: 20-25 MB (self-contained)
- `ftd-channels.html`: 3-4 MB
- `business-overview.html`: 2-3 MB
- `ftd-share.html`: 2-3 MB
- `retention.html`: 1-2 MB
- `reactivation.html`: 1-2 MB
- Total: ~50 MB (compressed by Cloudflare to ~5 MB)

### Timing Breakdown
```
build.js (Query Redash)     9-15 min  (Redash slowness)
build-ftd.js                2-3 min   (Data processing)
build-month.js              1 min     (Quick subset)
overview/* builders         2-3 min   (Aggregation)
retention/* builders        2-3 min   (Aggregation)
reactivation/* builders     1-2 min   (Aggregation)
publish-worker.js           1 min     (Deploy)
verify-public.js            1 min     (Check)
─────────────────────────────────────
TOTAL                       10-20 min (mostly step 1)
```

---

## Key Design Decisions

### 1. Multi-Stage Pipeline
- ✅ Each report can rebuild independently
- ✅ Cache shared data (ftd-report/cache)
- ✅ Parallel stages (retention + reactivation don't depend on each other)

### 2. Cache Strategy
- ✅ Monthly cache (7 days) saves ~70% of rebuild time
- ✅ Current month always fresh (daily money changes)
- ✅ Closed months are immutable (safe to cache)

### 3. No Real-Time
- ✓ Data updated once per day at 07:05 AM
- ✓ Reports are static HTML (fast, no server)
- ✓ No database (all in JSON)

### 4. Cloudflare Workers (Not Pages)
- ✅ Free tier
- ✅ Can add password login at Worker level
- ✅ No Zero Trust onboarding needed
- ✅ Persistent address, works offline

### 5. Local-Only Build
- ✅ Redash is internal-only (VPN required)
- ✅ Build runs on your PC, not cloud
- ✅ No deployment credentials needed
- ✅ Automatic retry if VPN drops

---

## Failure Modes & Resilience

### If a Step Fails
```
UPDATE-EVERYTHING.bat
  └─ Each step runs independently
  │  └─ Failed step outputs last known version
  │  └─ Build doesn't stop
  └─ At the end, lists what failed to rebuild
     └─ Safe to re-run anytime
```

### If Redash is Down
- `build.js` retries every 30 min (8 attempts)
- If all retries fail, uses last cached month
- Current month gets older but site stays up

### If VPN is Down
- Build fails immediately
- Manual retry when VPN restored
- Windows Task retry feature helps

---

## Configuration Flows

### config.env → Scripts

```
config.env (source of truth)
  │
  ├─→ REDASH_HOST, REDASH_KEY_*
  │   └─→ scripts/build/build.js (Redash queries)
  │   └─→ scripts/build/build-ftd.js
  │
  ├─→ BONUS_GROUPS_URL
  │   └─→ Pulls from Google Sheets
  │   └─→ Used in bonus categorization
  │
  ├─→ CF_API_TOKEN, CF_ACCOUNT_ID
  │   └─→ scripts/utilities/publish-worker.js (Cloudflare)
  │
  ├─→ AUTH_USERS, AUTH_SECRET
  │   └─→ scripts/utilities/server.js (local login)
  │   └─→ worker/worker.js (live login)
  │
  └─→ BUILD_HOUR, BUILD_MINUTE
      └─→ scripts/maintenance/INSTALL-DAILY-UPDATE.bat
          └─→ Windows Task Scheduler
```

---

**Last Updated:** Sept 16, 2026

