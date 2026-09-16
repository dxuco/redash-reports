# Redash Reports

Automated deployment of Redash reports to Cloudflare Workers with GitHub Actions CI/CD.

## Features

- 🚀 **Automatic Deployment** — Every push to `main` deploys to production
- ⚡ **Fast** — Served via Cloudflare Workers global network
- 🔒 **Secure** — API token stored as GitHub secret
- 📊 **Reports** — Deposit Retention reporting dashboard

## Setup

### Prerequisites
- Node.js 18+
- GitHub account
- Cloudflare account

### Local Development

1. **Clone & Install**
   ```bash
   git clone https://github.com/dxuco/redash-reports.git
   cd redash-reports
   npm install
   ```

2. **Build**
   ```bash
   bash build.sh
   ```

3. **Deploy Locally** (requires `wrangler` login)
   ```bash
   npx wrangler deploy src/index.js
   ```

## CI/CD Pipeline

Automated workflow:
1. Push to `main` branch
2. GitHub Actions runs `build.sh`
3. Wrangler deploys to Cloudflare
4. Live at https://reports.wayzen.workers.dev/

## File Structure

```
├── README.md                 # This file
├── retention.html           # Source HTML (1.4MB)
├── build.sh                 # Build script
├── src/
│   └── index.js            # Cloudflare Worker script
├── publish/
│   └── retention/
│       └── index.html      # Built output
├── wrangler.toml           # Cloudflare config
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions workflow
└── .gitignore
```

## Configuration

### Cloudflare
- **Project**: `reports`
- **Domain**: `reports.wayzen.workers.dev`
- **Type**: Cloudflare Workers

### GitHub Secrets
Required secret for deployment:
- `CLOUDFLARE_API_TOKEN` — Get from Cloudflare dashboard

## Deployment

### Manual Deploy
```bash
bash build.sh
npx wrangler deploy src/index.js
```

### Automatic Deploy (Recommended)
Just push to `main`:
```bash
git add .
git commit -m "Update reports"
git push origin main
```

## Monitoring

Check deployment status:
- GitHub Actions: https://github.com/dxuco/redash-reports/actions
- Live Site: https://reports.wayzen.workers.dev/

## Troubleshooting

**Deployment fails?**
- Check GitHub Actions logs
- Verify `CLOUDFLARE_API_TOKEN` is set
- Run `bash build.sh` locally to test

**Page shows blank?**
- Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
- Check if HTML file exists
- Verify Worker deployed: `wrangler deployments list`

## Performance

- **Size**: 1.4MB HTML
- **Cache**: Browser cache enabled (30 min)
- **Compression**: Gzip enabled on Cloudflare
- **CDN**: Global via Cloudflare network

## License

Private project
