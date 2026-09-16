#!/bin/bash
# Automated build script for redash reports

echo "🔨 Building reports..."

# Copy retention.html to publish folder
mkdir -p publish/retention
cp retention.html publish/retention/index.html

echo "✅ Build complete!"
echo "📦 Ready to deploy with: wrangler deploy"
