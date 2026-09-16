#!/bin/bash
# Automated build script for redash reports

echo "🔨 Building reports..."

# Copy retention.html to publish folder (for backup)
mkdir -p publish/retention
cp retention.html publish/retention/index.html

# Encode HTML as base64 and embed in Worker script with improved structure
mkdir -p src

# Write base64 to temp file first (avoids argument list too long error)
base64 < retention.html | tr -d '\n' > /tmp/html_b64.txt

# Create Worker script with base64 embedded from file
cat > src/index.js << 'WORKER_EOF'
const htmlB64 = 'PLACEHOLDER';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Serve main report on / or /retention
      if (path === '/' || path === '/retention') {
        const html = atob(htmlB64);
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

      // Health check endpoint for monitoring
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

      // 404 for all other paths
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
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

# Replace placeholder with actual base64 from temp file
perl -i -pe 's/PLACEHOLDER/`cat \/tmp\/html_b64.txt`/e' src/index.js
rm /tmp/html_b64.txt

echo "✅ Build complete!"
echo "📦 File size: $(wc -c < src/index.js | numfmt --to=iec-i --suffix=B 2>/dev/null || wc -c < src/index.js)"
echo "📦 Ready to deploy with: wrangler deploy"
