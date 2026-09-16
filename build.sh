#!/bin/bash
# Automated build script for redash reports

echo "🔨 Building reports..."

# Validate HTML before building
echo "🔍 Validating HTML..."
node validate.js retention.html || exit 1

# Minify HTML using Node.js minifier
echo "📦 Minifying HTML..."
mkdir -p build
node minify.js retention.html build/retention.min.html

# Encode minified HTML as base64 and embed in Worker script
mkdir -p src

# Write base64 to temp file first (avoids argument list too long error)
base64 < build/retention.min.html | tr -d '\n' > /tmp/html_b64.txt

# Create Worker script with base64 embedded from file
cat > src/index.js << 'WORKER_EOF'
const htmlB64 = 'PLACEHOLDER';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Serve HTML for all report pages
      if (path === '/' || path === '/retention' || path === '/bonus' || path === '/pivot' ||
          path === '/ftd-share' || path === '/september-2026' || path === '/ftd' ||
          path === '/ftd-bonus' || path === '/ftd-countries' || path === '/vip-transfer' ||
          path === '/acquisition-2026' || path === '/acquisition-2025' || path === '/community' ||
          path === '/ux-funnel' || path === '/logout') {
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

ORIGINAL_SIZE=$(wc -c < retention.html)
MINIFIED_SIZE=$(wc -c < build/retention.min.html)
COMPRESSION=$(echo "scale=1; (($ORIGINAL_SIZE - $MINIFIED_SIZE) * 100) / $ORIGINAL_SIZE" | bc)
WORKER_SIZE=$(wc -c < src/index.js)

echo "✅ Build complete!"
echo "📊 Compression:"
echo "   Original:  $(numfmt --to=iec-i --suffix=B $ORIGINAL_SIZE 2>/dev/null || echo "$ORIGINAL_SIZE bytes")"
echo "   Minified:  $(numfmt --to=iec-i --suffix=B $MINIFIED_SIZE 2>/dev/null || echo "$MINIFIED_SIZE bytes")"
echo "   Saved:     $COMPRESSION%"
echo "📦 Worker file: $(numfmt --to=iec-i --suffix=B $WORKER_SIZE 2>/dev/null || echo "$WORKER_SIZE bytes")"
echo ""
echo "📁 Cleanup: build/ and src/ are temporary, not committed to git"
echo "🚀 Ready to deploy with: npm run deploy"
