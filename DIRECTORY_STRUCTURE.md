# General Report — Directory Structure

Organized for clarity and maintainability on the new PC.

---

## 📁 Root Level (Quick Reference)

```
General Report/
├── config/                   # All configuration & data definitions
├── scripts/                  # Build automation & utilities
├── output/                   # Generated reports & cache
├── docs/                     # Documentation
├── {report-builders}/        # Individual report source code
└── node_modules/             # Dependencies (npm install)
```

---

## 🔧 config/ — Settings & Credentials

**PROTECT THIS FOLDER** — contains API keys and passwords.

```
config/
├── config.env               ⭐ MAIN CONFIG (Redash keys, Cloudflare token, auth users)
├── config.yml               
├── bonus-groups.json        # Bonus categorization lookup table
├── data-exclusions.json     # Player/country filters
├── affiliate-overrides.json # Channel/affiliate mapping
└── .vercel/
    └── .vercelignore
```

### Key Files:
- **config.env** — Edit this to change Redash keys, build times, login users, Cloudflare settings
- **bonus-groups.json** — Bonus cost category mapping (synced from Google Sheets in config.env)
- **data-exclusions.json** — Countries/players to exclude from reports

---

## 🏗️ scripts/ — Build Automation

### scripts/build/ — Main Builders
Run these to generate reports.

```
scripts/build/
├── build.js                 # Bonus Cost report from Redash 1731 + 1732 (9-15 min)
├── build-ftd.js             # FTD Report (2-3 min)
├── build-month.js           # Current month report (1 min)
├── build_acquisition.py     # Acquisition & CPA (2 min)
├── gen_2025.py              # 2025 cost comparison (1 min)
└── builders/
    ├── overview/            # Business Overview builder
    │   ├── build_overview.py
    │   ├── make_overview_html.py
    │   ├── build_drilldown.py
    │   ├── build_mix.py
    │   ├── make_mix_html.py
    │   └── overview-template.html
    ├── retention/           # Retention report builder
    │   ├── build_retention.py
    │   ├── make_retention_html.py
    │   └── retention-template.html
    └── reactivation/        # Reactivation report builder
        ├── build_reactivation.py
        └── make_reactivation_html.py
```

### scripts/utilities/ — Helper Scripts
Used by main builders.

```
scripts/utilities/
├── redash.js                # Redash API client (handles 3 quirks)
├── export-csv.js            # CSV exporter
├── publish-worker.js        # Deploy to Cloudflare Workers
├── server.js                # Local dev server (http://localhost:8080)
├── verify-public.js         # Check if live site is reachable
├── make-standalone.js       # Bake data into HTML
├── check-theme.js           # Validate theme colors
├── app.js                   # Interactive report frontend
├── publish.js               # Publishing utilities
└── pipeline.py              # Data pipeline coordinator
```

### scripts/maintenance/ — Automation & Setup
Windows batch files for daily builds and setup.

```
scripts/maintenance/
├── UPDATE-EVERYTHING.bat    # ⭐ MAIN SCRIPT - Full build & publish (10-20 min)
├── INSTALL-DAILY-UPDATE.bat # Setup Windows Task for daily 07:05 AM builds
├── START-DAILY-UPDATE.bat   # Manual timer (for dev)
├── 1-test-connection.bat    # Verify Redash connection
├── 2-test-one-month.bat     # Test single month build
├── 3-build-everything.bat   # Full build (legacy)
├── 4-check-segments.bat     # Validate segments
├── 5-web-access.bat         # Start local server
├── 6-publish.bat            # Publish to Cloudflare
├── 7-verify-public.bat      # Check live site
├── 8-check-bonus-sheet.bat  # Validate bonus data
├── 9-check-theme.bat        # Check theme colors
├── 9-refresh-ftd-cache.bat  # Refresh FTD cache only
├── 10-build-acquisition.bat # Build acquisition only
├── 10-list-columns.bat      # List Redash columns
├── 11-update-and-publish.bat # Build + publish
├── 12-build-month.bat       # Build this month only
├── 13-build-vip-transfer.bat # Build VIP report
└── check-schedule.bat       # Verify Windows Task exists
```

**Quick Commands:**
```bash
# In General Report root directory:
scripts/maintenance/UPDATE-EVERYTHING.bat      # Full build (double-click)
node scripts/build/build.js --probe             # Test Redash connection
node scripts/utilities/server.js                # Start local dev server
```

### scripts/tests/ — Validation & Verification

```
scripts/tests/
├── test-build-smoke.js      # Quick smoke test
├── test-daily-chart.js      # Verify daily aggregates
├── test-drilldown.js        # Check drill-down data
├── test-month-cache.js      # Validate month caching
├── test-user-type-render.js # UI rendering tests
├── test-user-type-table.js  # Table generation tests
├── test-win-loss.js         # Win/loss analysis
├── test-login.mjs           # Login flow test
└── overview/test_*.js       # Overview-specific tests
```

---

## 📊 output/ — Generated Reports & Cache

### output/reports/ — Built HTML Reports

```
output/reports/
├── acquisition-report/      # Acquisition data (monthly)
├── community-channels/      # Community channel breakdown
├── country-funnel/          # Country-level funnel
├── country-traffic/         # Traffic by country
├── deposit-frequency/       # Deposit patterns
├── fiat-affiliate/          # Fiat deposit affiliate analysis
├── ftd-bonus-dashboard/     # FTD bonus dashboard
├── ftd-channels/            # FTD by channel
├── manager-view/            # Manager overview
├── pivot/                   # Pivot table report
├── retention/               # Retention analysis
├── retention-full/          # Full retention data
├── streamers/               # Streamer performance
├── us-360/                  # US market 360 view
└── vip-transfer/            # VIP transfer analysis
```

### output/cache/ — Cached Data (Speeds Up Rebuilds)

```
output/cache/
├── cache-bonus/             # Monthly Redash exports (7-day TTL)
│   ├── 2026-01/
│   ├── 2026-02/
│   └── ...
├── ftd-report/
│   ├── cache/               # Player-day-game rows
│   └── _stage/              # Staging area
└── publish/                 # Published site files
    ├── acquisition-2025/
    ├── acquisition-2026/
    ├── august-2026/
    ├── bonus/
    ├── ftd/
    ├── ftd-share/
    ├── overview/
    ├── retention/
    └── ...
```

### output/data/ — Processed Data Files

```
output/data/
├── data.json                # Full bonus cost dataset (15-20 MB)
├── overview-data.json       # Business Overview aggregates
├── mix-data.json            # FTD Share breakdown
├── drilldown-data.json      # Drill-down detail
└── bonus-cost-report.json   # Report structure
```

---

## 👥 Report Builders — Individual Report Source Code

Each report has its own directory with builder scripts and templates:

```
overview/                     # Business Overview & FTD Share
├── build_overview.py
├── make_overview_html.py
├── build_drilldown.py
├── build_mix.py
├── make_mix_html.py
├── overview-template.html
├── mix-template.html
└── test_overview.js

retention/                    # Retention Analysis
├── build_retention.py
├── make_retention_html.py
└── retention-template.html

reactivation/                 # Reactivation Targeting
├── build_reactivation.py
├── make_reactivation_html.py
└── reactivation-template.html

vip-transfer/                 # VIP Transfer Analysis
├── build_vip_transfer.py
└── vip-transfer-template.html

ftd-report/                   # Core FTD Data (cache, not a builder)
├── cache/                   # Month caches
├── _stage/                  # Staging area
└── month-aggregate.js       # Month aggregation

worker/                       # Cloudflare Worker Code
├── worker.js                # Worker entrypoint
├── wrangler.toml            # Worker config
└── .wrangler/               # Build output
```

---

## 📚 docs/ — Documentation

```
docs/
├── DIRECTORY_STRUCTURE.md   # This file
├── BUILD_GUIDE.md           # Step-by-step build instructions
├── CONFIG_REFERENCE.md      # config.env settings explained
├── ARCHITECTURE.md          # Data flow & design
├── TROUBLESHOOTING.md       # Common issues & fixes
└── API_REFERENCE.md         # Redash API quirks
```

---

## 🔄 Supporting Directories (Keep As-Is)

```
redash-kit/                   # Reusable Redash client library
├── redash.js
├── export-csv.js
├── config.env.example
└── README.md

skills/                       # Claude Code skills
├── redash-report-builder/
└── redash-report-builder-workspace/

node_modules/                 # NPM dependencies (run: npm install)
└── ...

logs/                         # Build logs
├── update-all.log
├── build-last.log
└── archive/

_template/                    # Template assets (brand, CSS, etc)
├── BRAND.md
└── assets/
```

---

## 🧹 Cleanup Directories (Can Delete)

```
_to_delete/                  # Marked for deletion
_cover-backup/               # Backup data (old)
_excluded-rows/              # Excluded row data
_offline/                    # Offline mode data
_mcp-exports/                # MCP exports (deprecated)
_artifact/                   # Old artifacts
Claude outputs/              # Claude exploration output
```

---

## 📋 How to Use This Structure

### Running a Full Build
```bash
# In General Report root:
scripts/maintenance/UPDATE-EVERYTHING.bat
```

### Testing Redash Connection
```bash
node scripts/build/build.js --probe
```

### Starting Local Dev Server
```bash
node scripts/utilities/server.js
# Then visit: http://localhost:8080
```

### Building Individual Reports
```bash
# Bonus Cost only:
node scripts/build/build.js

# Business Overview only:
cd overview && python build_overview.py && python make_overview_html.py

# Retention only:
cd retention && python build_retention.py && python make_retention_html.py
```

### Publishing to Live
```bash
node scripts/utilities/publish-worker.js
```

### Scheduling Daily Builds (Windows)
```bash
# Run once as administrator:
scripts/maintenance/INSTALL-DAILY-UPDATE.bat
# Then builds run automatically at 07:05 AM daily
```

---

## 🔐 Important Files to Protect

- **config/config.env** — Contains all secrets (Redash API keys, Cloudflare token)
- **config/bonus-groups.json** — Bonus data (sensitive)
- **output/data/data.json** — Contains player usernames & countries

**Never commit these to Git** — they're in `.gitignore` already.

---

## 📊 Typical File Sizes

| File | Size | Frequency |
|---|---|---|
| data.json | 15-20 MB | Daily |
| bonus-cost-report.html | 20-25 MB | Daily |
| ftd-share.html | 3-4 MB | Daily |
| overview-data.json | 12-15 MB | Daily |
| cache-bonus/*.json | 8-12 MB | Per month |

**Total space needed: ~100 MB for caches + 50 MB for output**

---

## 🚀 First Run Checklist

- [ ] Copy all files from old PC
- [ ] Verify `config/config.env` has correct Redash keys
- [ ] Run `npm install` in root directory
- [ ] Test: `node scripts/build/build.js --probe`
- [ ] Full build: `scripts/maintenance/UPDATE-EVERYTHING.bat`
- [ ] Check output in `output/reports/`
- [ ] Start dev server: `node scripts/utilities/server.js`
- [ ] Test login locally (http://localhost:8080)
- [ ] Publish: `node scripts/utilities/publish-worker.js`
- [ ] Verify live: https://reports.wayzen.workers.dev
- [ ] Schedule: `scripts/maintenance/INSTALL-DAILY-UPDATE.bat` (as admin)

---

**Last Updated:** Sept 16, 2026  
**Structure Version:** 1.0

