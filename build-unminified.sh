#!/bin/bash
# Build without minification to test if minification breaks rendering

mkdir -p src

# Encode original HTML (no minification)
base64 < retention.html | tr -d '\n' > /tmp/retention_b64.txt
base64 < bonus.html | tr -d '\n' > /tmp/bonus_b64.txt

# Create Worker script
cat > src/index.js << 'WORKER_EOF'
const retentionB64 = 'RETENTION_PLACEHOLDER';
const bonusB64 = 'BONUS_PLACEHOLDER';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'redash-reports'
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        });
      }

      if (path === '/bonus' || path === '/bonus/') {
        const html = atob(bonusB64);
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=1800, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
          },
        });
      }

      const html = atob(retentionB64);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=1800, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    } catch (error) {
      console.error('Worker error:', error.message);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
WORKER_EOF

# Replace placeholders
perl -i -pe 's/RETENTION_PLACEHOLDER/`cat \/tmp\/retention_b64.txt`/e' src/index.js
perl -i -pe 's/BONUS_PLACEHOLDER/`cat \/tmp\/bonus_b64.txt`/e' src/index.js
rm /tmp/retention_b64.txt /tmp/bonus_b64.txt

echo "✅ Build complete (unminified)"
