# Quick Start Guide

## ⚡ Start Here (30 seconds)

### 1️⃣ First Time Setup
```bash
npm install
```

### 2️⃣ Test Connection (30 seconds)
```bash
node scripts/build/build.js --probe
```

Expected: ✓ All connections OK

### 3️⃣ Full Build (10-20 minutes)
```bash
scripts/maintenance/UPDATE-EVERYTHING.bat
```

Or use the GUI: **Double-click `UPDATE-EVERYTHING.bat`**

### 4️⃣ View Reports Locally
```bash
node scripts/utilities/server.js
```

Then visit: **http://localhost:8080**

Login: `Davit:DFgh1234`

### 5️⃣ Publish Live (1 minute)
```bash
node scripts/utilities/publish-worker.js
```

Then visit: **https://reports.wayzen.workers.dev**

---

## 🔧 Common Commands

```bash
# Test Redash connection
node scripts/build/build.js --probe

# Build only bonus cost (9-15 min)
node scripts/build/build.js

# Build only this month (1 min)
node scripts/build/build-month.js

# Build only FTD report (2-3 min)
node scripts/build/build-ftd.js

# Build all reports (10-20 min)
scripts/maintenance/UPDATE-EVERYTHING.bat

# Start local dev server
node scripts/utilities/server.js

# Publish to Cloudflare
node scripts/utilities/publish-worker.js

# Verify live site works
node scripts/utilities/verify-public.js

# Setup daily automatic builds (admin required)
scripts/maintenance/INSTALL-DAILY-UPDATE.bat

# View build logs
tail -f logs/update-all.log
```

---

## 🎯 Before First Build

1. ✅ Verify VPN is **connected** (Redash requires it)
2. ✅ Check `config/config.env` has correct keys (lines 10-11)
3. ✅ Run `npm install` if not done yet
4. ✅ Run `--probe` test first

---

## 📊 What Gets Built

| Build | Time | Output |
|---|---|---|
| Bonus Cost | 9-15m | `bonus-cost-report.html` |
| FTD Report | 2-3m | `ftd-channels.html` |
| Business Overview | 2m | `business-overview.html` |
| FTD Share | 1m | `ftd-share.html` |
| Retention | 2m | `retention.html` |
| Acquisition | 2m | `acquisition-2026.html` |
| **Total** | **10-20m** | **9 reports + cache** |

All outputs go to: `output/reports/`

---

## 🚨 If Something Fails

### "Cannot find module 'jsdom'"
```bash
npm install
```

### "Redash returns 404"
- ✓ Check VPN is connected
- ✓ Verify API keys in `config/config.env`
- ✓ Test: `node scripts/build/build.js --probe`

### "Cannot find Python"
```bash
# Windows: Add Python to PATH, or use full path:
C:\Python39\python.exe scripts/build/gen_2025.py
```

### "Old data still showing"
```bash
# Clear cache and rebuild:
node scripts/build/build.js --no-cache
```

### "Login not working locally"
- Check `config/config.env` line 69 for `AUTH_USERS`
- Default: `Davit:DFgh1234`

### "Cloudflare publish fails"
- Verify `CF_API_TOKEN` and `CF_ACCOUNT_ID` in config
- Check you have internet access

---

## 📁 Key Files

| File | Purpose |
|---|---|
| `config/config.env` | **All settings** (API keys, usernames, etc) |
| `scripts/maintenance/UPDATE-EVERYTHING.bat` | Master build script |
| `scripts/build/build.js` | Bonus cost builder |
| `scripts/utilities/server.js` | Local dev server |
| `output/reports/` | Built HTML reports |
| `output/data/` | JSON data files |

---

## 🔐 Protect These

- `config/config.env` — Contains all secrets
- `config/bonus-groups.json` — Contains bonus categorization
- `output/data/data.json` — Contains player data

**Never commit to Git** ✗

---

## 📚 Learn More

- `DIRECTORY_STRUCTURE.md` — Full file organization
- `CONFIG_REFERENCE.md` — Settings explained (coming soon)
- `ARCHITECTURE.md` — How data flows (coming soon)

---

## ✅ You're Ready!

Run this first:
```bash
scripts/maintenance/UPDATE-EVERYTHING.bat
```

Then wait 10-20 minutes and check `output/reports/bonus-cost-report.html` 🎉

