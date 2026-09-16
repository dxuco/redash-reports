# General Report — Setup Checklist

Use this checklist to set up the system on your new PC.

---

## ✅ Pre-Setup (5 min)

- [ ] Copy all files to new PC
- [ ] Verify `config.env` is in root (with API keys)
- [ ] Verify VPN is **connected** (required for Redash)
- [ ] Check Node.js is installed: `node --version` (need 18+)
- [ ] Check Python is installed: `python --version` (need 3.9+)

---

## ✅ Dependencies (1 min)

- [ ] Run: `npm install`
- [ ] Wait for completion (should see "added XX packages")

---

## ✅ Test Connection (30 sec)

- [ ] Run: `node build.js --probe`
- [ ] Look for: ✓ All connections OK
- [ ] If failed: Check VPN, verify API keys in `config.env`

---

## ✅ First Build (10-20 min)

- [ ] Run: `UPDATE-EVERYTHING.bat`
- [ ] Or double-click the .bat file
- [ ] Wait for completion (takes 10-20 minutes)
- [ ] Watch for: "✓ All reports built"

---

## ✅ Check Output

- [ ] Open: `output/reports/` folder
- [ ] Look for these files:
  - [ ] `bonus-cost-report.html` (largest, 20-25 MB)
  - [ ] `ftd-channels.html`
  - [ ] `business-overview.html`
  - [ ] `ftd-share.html`
  - [ ] `retention.html`
  - [ ] `reactivation.html`

---

## ✅ Test Locally (5 min)

- [ ] Run: `node server.js`
- [ ] Open: `http://localhost:8080` in browser
- [ ] Login with: `Davit:DFgh1234`
- [ ] Click around, verify reports load
- [ ] Stop server: `Ctrl+C`

---

## ✅ Publish to Live (1 min)

- [ ] Run: `node publish-worker.js`
- [ ] Wait for: "✓ Published successfully"
- [ ] Visit: `https://reports.wayzen.workers.dev`
- [ ] Login and verify

---

## ✅ Schedule Daily Builds (1 min)

- [ ] Run: `INSTALL-DAILY-UPDATE.bat` (as administrator)
- [ ] Click through the Windows dialog
- [ ] Done! Builds will run automatically at 07:05 AM

---

## ✅ Verify Daily Automation

- [ ] Check: `logs/update-all.log` exists
- [ ] Check: `output/data/data.json` has today's date
- [ ] Confirm: System runs on schedule

---

## 📋 Troubleshooting

### "Cannot find module 'jsdom'"
```bash
npm install
```

### "Redash returns 403"
- [ ] Verify VPN is connected
- [ ] Check API keys in `config.env` (lines 10-11)
- [ ] Keys might be expired — get new ones from Redash admin

### "Old data in reports"
```bash
node build.js --no-cache
```

### "Login not working locally"
- [ ] Check `config.env` line 69 for `AUTH_USERS`
- [ ] Default: `Davit:DFgh1234`

### "Cloudflare publish fails"
- [ ] Verify `CF_API_TOKEN` in `config.env` line 79
- [ ] Verify `CF_ACCOUNT_ID` in `config.env` line 80
- [ ] Check internet connection

---

## 🎓 Learning Resources

| File | What to Read |
|---|---|
| `START_HERE.md` | Quick overview |
| `QUICKSTART.md` | Common commands |
| `ARCHITECTURE.md` | How data flows |
| `config.env` | Settings (has inline comments) |

---

## 🔒 Protect These Files

These contain secrets — don't commit to Git:

- [ ] `config.env`
- [ ] `bonus-groups.json`
- [ ] `output/data/data.json`

---

## 📞 Status Indicators

### System Working
✓ `node build.js --probe` returns all ✓  
✓ `UPDATE-EVERYTHING.bat` completes in 10-20 min  
✓ `output/reports/` has HTML files (20+ MB)  
✓ `node server.js` starts without errors  
✓ `node publish-worker.js` completes successfully  

### Daily Schedule Working
✓ `logs/update-all.log` has entries from today  
✓ `output/data/data.json` has today's timestamp  
✓ Windows Task shows in Task Scheduler  

---

## 🎯 Final Checklist

When everything is done, you should have:

- [x] System set up on new PC
- [x] All scripts copied
- [x] Dependencies installed
- [x] Redash connection verified
- [x] First build completed
- [x] Reports generated
- [x] Local testing done
- [x] Published to live
- [x] Daily builds scheduled
- [x] Logs verified
- [x] Ready for production! 🎉

---

**Setup Date:** ________________

**Completed By:** ________________

**Live Site URL:** https://reports.wayzen.workers.dev

---

## 📅 Daily Maintenance

### Every Morning
- Check: Does `logs/update-all.log` have today's entry?
- Verify: Are reports showing today's data?
- Action: If failed, check VPN and logs

### Weekly
- Backup: Copy `output/data/data.json`
- Check: Are all report builders working?

### Monthly
- Review: Check for any error patterns in logs
- Cleanup: Archive old logs to `logs/archive/`

---

**You're all set! 🚀**

Start with: `npm install && UPDATE-EVERYTHING.bat`

