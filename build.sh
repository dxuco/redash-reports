#!/bin/bash
# Automated build script for redash reports

echo "🔨 Building reports..."

# Copy retention.html to publish folder
mkdir -p publish/retention
cp retention.html publish/retention/index.html

# Encode HTML as base64 and embed in Worker script
mkdir -p src
HTML_B64=$(base64 < retention.html | tr -d '\n')

cat > src/index.js << EOF
const htmlB64 = '${HTML_B64}';

export default {
  async fetch(request) {
    const html = atob(htmlB64);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  },
};
EOF

echo "✅ Build complete!"
echo "📦 Ready to deploy with: wrangler deploy"
