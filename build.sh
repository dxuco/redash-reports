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
node minify.js bonus.html build/bonus.min.html

# Encode minified HTML files as base64 and embed in Worker script
mkdir -p src

# Write base64 to temp files
base64 < build/retention.min.html | tr -d '\n' > /tmp/retention_b64.txt
base64 < build/bonus.min.html | tr -d '\n' > /tmp/bonus_b64.txt

# Create Worker script with base64 embedded from files
cat > src/index.js << 'WORKER_EOF'
const retentionB64 = 'RETENTION_PLACEHOLDER';
const bonusB64 = 'BONUS_PLACEHOLDER';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

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

      // Serve bonus report on /bonus route
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

      // Serve retention report for ALL other routes (including all navigation tabs)
      // This way clicking any tab works - reactivation, ftd-countries, etc.
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

# Replace placeholders with actual base64 from temp files
perl -i -pe 's/RETENTION_PLACEHOLDER/`cat \/tmp\/retention_b64.txt`/e' src/index.js
perl -i -pe 's/BONUS_PLACEHOLDER/`cat \/tmp\/bonus_b64.txt`/e' src/index.js
rm /tmp/retention_b64.txt /tmp/bonus_b64.txt

RETENTION_SIZE=$(wc -c < retention.html)
BONUS_SIZE=$(wc -c < bonus.html)
RETENTION_MIN=$(wc -c < build/retention.min.html)
BONUS_MIN=$(wc -c < build/bonus.min.html)
WORKER_SIZE=$(wc -c < src/index.js)

echo "✅ Build complete!"
echo "📊 Files:"
echo "   Retention:  $(numfmt --to=iec-i --suffix=B $RETENTION_SIZE 2>/dev/null || echo "$RETENTION_SIZE bytes")"
echo "   Bonus:      $(numfmt --to=iec-i --suffix=B $BONUS_SIZE 2>/dev/null || echo "$BONUS_SIZE bytes")"
echo "   Minified:   $(numfmt --to=iec-i --suffix=B $RETENTION_MIN 2>/dev/null || echo "$RETENTION_MIN bytes") + $(numfmt --to=iec-i --suffix=B $BONUS_MIN 2>/dev/null || echo "$BONUS_MIN bytes")"
echo "📦 Worker file: $(numfmt --to=iec-i --suffix=B $WORKER_SIZE 2>/dev/null || echo "$WORKER_SIZE bytes")"
echo ""
echo "📁 Cleanup: build/ and src/ are temporary, not committed to git"
echo "🚀 Ready to deploy with: npm run deploy"
