# General Report — Quick Start

**Live at:** https://reports.wayzen.workers.dev

---

## ⚡ 3-Step Setup

### 1. Install Dependencies (1 min)
```bash
npm install
```

### 2. Test Connection (30 sec)
```bash
node build.js --probe
```

### 3. Build All Reports (10-20 min)
```bash
UPDATE-EVERYTHING.bat
```

---

## 📊 What Gets Built

✓ Bonus Cost Report (20-25 MB)  
✓ FTD Report (3-4 MB)  
✓ Business Overview  
✓ Retention Analysis  
✓ Acquisition & CPA  
✓ Reactivation Targeting  

**Output:** `output/reports/` directory

---

## 🌐 Publish Live

```bash
node publish-worker.js
```

Then visit: **https://reports.wayzen.workers.dev**

---

## ⏰ Schedule Daily Builds

```bash
INSTALL-DAILY-UPDATE.bat
```

*(Run as administrator. Then builds run automatically at 07:05 AM)*

---

## 📁 File Structure

```
General Report/
├── build.js, build-ftd.js, build-month.js    ← Main builders
├── build_acquisition.py, gen_2025.py         ← Python processors
├── publish-worker.js, server.js              ← Publish & serve
├── *.bat files                                ← Windows automation
├── config.env                                 ← Settings (PROTECT THIS)
├── bonus-groups.json, data-exclusions.json   ← Data config
├── output/                                    ← Reports & cache
│   ├── reports/        (built HTML files)
│   ├── cache/          (Redash data cache)
│   └── data/           (JSON data files)
└── [report-builders]/  (overview/, retention/, etc)
```

---

## 🔧 Common Commands

```bash
# Test Redash connection
node build.js --probe

# Build only Bonus Cost (9-15 min)
node build.js

# Build only this month (1 min)
node build-month.js

# Build only FTD (2-3 min)
node build-ftd.js

# Start local dev server
node server.js

# Force full refresh (ignore cache)
node build.js --no-cache

# Publish to Cloudflare
node publish-worker.js

# Check live site
node verify-public.js
```

---

## ⚠️ Protect These Files

- `config.env` — Redash API keys, Cloudflare token
- `bonus-groups.json` — Bonus data
- `output/data/data.json` — Player data

**Never commit to Git** ✗

---

## 🧪 First Time Checklist

- [ ] `npm install`
- [ ] `node build.js --probe` (should see ✓ All OK)
- [ ] `UPDATE-EVERYTHING.bat` (wait 10-20 min)
- [ ] Check `output/reports/bonus-cost-report.html`
- [ ] `node server.js` + visit `http://localhost:8080`
- [ ] `node publish-worker.js`
- [ ] Visit `https://reports.wayzen.workers.dev`
- [ ] `INSTALL-DAILY-UPDATE.bat` (admin)

---

## 🆘 If Something Fails

| Problem | Fix |
|---|---|
| "Cannot find module 'jsdom'" | `npm install` |
| "Redash returns 404" | Check VPN, verify API keys in `config.env` |
| "Old data in reports" | `node build.js --no-cache` |
| "Login not working" | Check `AUTH_USERS` in `config.env` |
| "Cloudflare deploy fails" | Verify `CF_API_TOKEN` and `CF_ACCOUNT_ID` in `config.env` |

---

## 📞 Need Help?

- **Settings:** Check `config.env` (has inline comments)
- **Logs:** `tail -f logs/update-all.log`
- **Source:** Each `.js`/`.py` file has comments explaining what it does

---

**Ready?** Run this now:

```bash
npm install && UPDATE-EVERYTHING.bat
```

Then wait 10-20 minutes. Reports will be in `output/reports/` 🎉

