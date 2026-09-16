# Setup Summary — Organization Complete ✓

## What Was Done

Your General Report directory has been **reorganized and categorized** for the new PC.

### ✅ Directory Structure Created

```
General Report/
├── config/                      ⭐ Configuration & secrets
│   ├── config.env              (Redash keys, auth, Cloudflare token)
│   ├── bonus-groups.json       (Bonus categorization)
│   ├── data-exclusions.json    (Filters)
│   └── affiliate-overrides.json
│
├── scripts/                     ⭐ All build automation
│   ├── build/                  Main builders
│   │   ├── build.js           (Bonus Cost — 9-15 min)
│   │   ├── build-ftd.js       (FTD Report — 2-3 min)
│   │   ├── build-month.js     (Current month — 1 min)
│   │   ├── build_acquisition.py (Acquisition CPA — 2 min)
│   │   └── gen_2025.py        (2025 comparison — 1 min)
│   │
│   ├── utilities/              Helper scripts
│   │   ├── redash.js          (Redash API client)
│   │   ├── server.js          (Local dev server)
│   │   ├── publish-worker.js  (Publish to Cloudflare)
│   │   ├── verify-public.js   (Check live site)
│   │   └── [12 more utilities]
│   │
│   ├── maintenance/            Windows automation
│   │   ├── UPDATE-EVERYTHING.bat  ⭐ MAIN BUILD SCRIPT
│   │   ├── INSTALL-DAILY-UPDATE.bat (Schedule daily builds)
│   │   └── [20+ utility scripts]
│   │
│   ├── tests/                  Validation scripts
│   │   ├── test-daily-chart.js
│   │   ├── test-drilldown.js
│   │   └── [6 more tests]
│   │
│   ├── builders/               Report source code
│   │   ├── overview/          (Business Overview builder)
│   │   ├── retention/         (Retention report builder)
│   │   └── reactivation/      (Reactivation builder)
│   │
│   └── deprecated/             Old scripts (can delete)
│
├── output/                      ⭐ Generated reports & cache
│   ├── reports/                Built HTML reports
│   │   ├── acquisition-report/ (Monthly acquisition data)
│   │   ├── community-channels/ (Channel breakdown)
│   │   ├── country-traffic/    (Geographic performance)
│   │   ├── ftd-bonus-dashboard/ (FTD dashboard)
│   │   ├── manager-view/       (Manager overview)
│   │   ├── pivot/              (Pivot table)
│   │   ├── retention/          (Retention cohort)
│   │   ├── streamers/          (Streamer performance)
│   │   ├── us-360/             (US market view)
│   │   └── vip-transfer/       (VIP transfer)
│   │
│   ├── cache/                  Intermediate data (caches)
│   │   ├── cache-bonus/       (Monthly Redash exports)
│   │   ├── ftd-report/        (FTD data powering reports)
│   │   └── publish/           (Published files)
│   │
│   └── data/                   Processed JSON data
│       ├── data.json          (Full bonus cost dataset)
│       ├── overview-data.json (Business Overview data)
│       ├── mix-data.json      (FTD Share breakdown)
│       └── drilldown-data.json (Detail data)
│
├── docs/                        ⭐ Documentation
│   ├── QUICKSTART.md           (Start here — 30 seconds)
│   ├── DIRECTORY_STRUCTURE.md  (File organization explained)
│   ├── ARCHITECTURE.md         (Data flow & design)
│   └── SETUP_SUMMARY.md        (This file)
│
├── redash-kit/                 Reusable Redash library
├── skills/                     Claude Code skills
├── templates/                  HTML templates (mostly empty)
├── worker/                     Cloudflare Worker code
├── logs/                       Build logs
│
├── package.json               (npm dependencies)
├── package-lock.json
└── README.md                  (Original docs)
```

---

## 🚀 How to Use

### 1. Initial Setup (One Time)

```bash
cd "General Report"
npm install
```

### 2. Test Connection

```bash
node scripts/build/build.js --probe
```

Expected output: ✓ All connections OK

### 3. First Build (10-20 minutes)

**Option A — GUI (Double-click):**
```
scripts/maintenance/UPDATE-EVERYTHING.bat
```

**Option B — Command Line:**
```bash
scripts/maintenance/UPDATE-EVERYTHING.bat
```

### 4. View Reports Locally

```bash
node scripts/utilities/server.js
```

Visit: **http://localhost:8080**
Login: `Davit:DFgh1234`

### 5. Publish to Live

```bash
node scripts/utilities/publish-worker.js
```

Visit: **https://reports.wayzen.workers.dev**

### 6. Schedule Daily Builds (Windows Admin)

```bash
scripts/maintenance/INSTALL-DAILY-UPDATE.bat
```

Then close the window. Builds run automatically at **07:05 AM daily**.

---

## 📚 Documentation Files

| File | Use Case |
|---|---|
| **QUICKSTART.md** | First-time setup, common commands, troubleshooting |
| **DIRECTORY_STRUCTURE.md** | Understand where every file is and why |
| **ARCHITECTURE.md** | Deep dive into data flow, design decisions, caching strategy |

---

## 🔧 Common Tasks

### Build Only Bonus Cost (9-15 min)
```bash
node scripts/build/build.js
```

### Build Only This Month (1 min)
```bash
node scripts/build/build-month.js
```

### Build Only FTD Report (2-3 min)
```bash
node scripts/build/build-ftd.js
```

### Build Business Overview Only (2 min)
```bash
cd scripts/builders/overview
python build_overview.py
python make_overview_html.py
```

### Check Build Logs
```bash
tail -f logs/update-all.log
```

### Test Connection
```bash
node scripts/build/build.js --probe
```

### Force Full Refresh (Ignore Cache)
```bash
node scripts/build/build.js --no-cache
```

---

## 🔐 Protect These Files

These contain sensitive data:
- `config/config.env` — Redash API keys, Cloudflare token, auth passwords
- `config/bonus-groups.json` — Bonus categorization
- `output/data/data.json` — Contains player usernames & countries

**Never commit to Git** ✗
**Keep local backups** ✓

---

## 📊 What Gets Built

### Full Build (UPDATE-EVERYTHING.bat)
```
build.js              → bonus-cost-report.html (20-25 MB)
build-ftd.js          → ftd-channels.html (3-4 MB)
build-month.js        → current-month.html (2-3 MB)
overview/build_*.py   → business-overview.html, ftd-share.html
retention/build_*.py  → retention.html (1-2 MB)
reactivation/build_*.py → reactivation.html (1-2 MB)
publish-worker.js     → Deploy to Cloudflare
verify-public.js      → Confirm live
─────────────────────────────────────
Time: 10-20 minutes
Output: ~50 MB (compressed to ~5 MB by Cloudflare)
```

---

## ⚠️ First Run Checklist

- [ ] Copy all files to new PC
- [ ] Verify `config/config.env` has correct Redash API keys
- [ ] Verify VPN is **connected**
- [ ] Run: `npm install`
- [ ] Test: `node scripts/build/build.js --probe`
- [ ] Full build: `scripts/maintenance/UPDATE-EVERYTHING.bat`
- [ ] Check: `output/reports/bonus-cost-report.html` exists
- [ ] Local test: `node scripts/utilities/server.js`
- [ ] Publish: `node scripts/utilities/publish-worker.js`
- [ ] Verify: Visit `https://reports.wayzen.workers.dev`
- [ ] Schedule: `scripts/maintenance/INSTALL-DAILY-UPDATE.bat` (admin)

---

## 🧹 Can Delete These Directories

Old data, can be safely removed:
- `Claude outputs/`
- `_to_delete/`
- `_cover-backup/`
- `_excluded-rows/`
- `_offline/`
- `_mcp-exports/`
- `_artifact/`
- `drive-download-*/`
- `logs/archive/`

---

## 🆘 Troubleshooting

### "Cannot find module 'jsdom'"
```bash
npm install
```

### "Redash returns 404"
1. Check VPN is connected
2. Verify API keys in `config/config.env` (lines 10-11)
3. Run: `node scripts/build/build.js --probe`

### "Old data in reports"
```bash
node scripts/build/build.js --no-cache
```

### "Login not working"
- Check `config/config.env` line 69 for `AUTH_USERS`
- Default user: `Davit:DFgh1234`

### "Cloudflare deploy fails"
- Verify `CF_API_TOKEN` in config
- Check `CF_ACCOUNT_ID` in config
- Ensure you have internet access

---

## 📞 Support

### Documentation
- **QUICKSTART.md** — Quick reference
- **DIRECTORY_STRUCTURE.md** — File organization
- **ARCHITECTURE.md** — Technical deep-dive
- **config/config.env** — Inline comments explaining settings

### Scripts with Help
```bash
node scripts/build/build.js --help
node scripts/utilities/server.js --help
```

### View Logs
```bash
cat logs/update-all.log
cat logs/build-last.log
```

---

## ✅ Ready to Go!

Your system is now organized and ready to use.

**Next step:**
```bash
scripts/maintenance/UPDATE-EVERYTHING.bat
```

Wait 10-20 minutes, then check `output/reports/` for the generated HTML files.

**Questions?** Check the documentation files in `docs/`

---

**Setup completed:** Sept 16, 2026  
**Organization version:** 1.0  
**Last verified:** Working ✓

