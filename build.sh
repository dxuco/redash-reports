#!/bin/bash
# Automated build script for redash reports

echo "🔨 Building reports..."

# Copy retention.html to publish folder
mkdir -p publish/retention
cp retention.html publish/retention/index.html

# Embed HTML into Worker script
mkdir -p src
cat > src/index.js << 'EOF'
const html = `
EOF

cat retention.html >> src/index.js

cat >> src/index.js << 'EOF'
`;

export default {
  async fetch(request) {
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
