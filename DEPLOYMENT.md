# Deployment Guide

## Automatic Deployment (GitHub Actions)

### Setup (One-time)

1. **Generate Cloudflare API Token**
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Create token with permissions: `Workers Scripts` (Edit)
   - Copy the token

2. **Add GitHub Secret**
   - Go to https://github.com/dxuco/redash-reports/settings/secrets/actions
   - Click "New repository secret"
   - Name: `CLOUDFLARE_API_TOKEN`
   - Value: Paste the token from step 1
   - Click "Add secret"

### Deploy

Just push to `main`:
```bash
git add .
git commit -m "Update content"
git push origin main
```

GitHub Actions will:
1. ✅ Check out code
2. ✅ Run build script
3. ✅ Deploy to Cloudflare
4. ✅ Verify deployment

View status: https://github.com/dxuco/redash-reports/actions

---

## Manual Deployment (Local)

### Prerequisites
```bash
npm install
```

### Build
```bash
npm run build
```

This creates `src/index.js` with embedded HTML.

### Deploy
```bash
npm run deploy
```

Or manually:
```bash
npx wrangler deploy src/index.js
```

### View Deployments
```bash
npm run deployments
```

---

## Testing

### Local Development
```bash
npm run dev
```

Then visit: http://localhost:8787

### Health Check
```bash
curl https://reports.wayzen.workers.dev/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-09-16T15:30:00.000Z",
  "service": "redash-reports"
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Deployment fails | Check GitHub Actions logs |
| Token invalid | Regenerate and update GitHub secret |
| Page shows blank | Hard refresh (Cmd+Shift+R) |
| 404 errors | Check URL is `/` or `/retention` |

---

## Performance Metrics

- **Build time**: ~5 seconds
- **Deploy time**: ~15 seconds
- **File size**: ~1.4MB (before base64)
- **Cache**: 30 minutes browser cache
- **Compression**: Gzip (automatic via Cloudflare)

---

## Rollback

If deployment breaks production:

```bash
# Revert last commit
git revert HEAD
git push origin main

# GitHub Actions will auto-deploy the previous version
```

Or manually deploy a specific version:
```bash
git checkout <commit-hash>
npm run build
npm run deploy
```
