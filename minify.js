#!/usr/bin/env node
/**
 * Simple HTML minifier
 * Removes comments, unnecessary whitespace, and optimizes the HTML
 */

import fs from 'fs';
import path from 'path';

function minifyHTML(html) {
  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove multiple spaces (but preserve single spaces between elements)
  html = html.replace(/\s+/g, ' ');

  // Remove spaces around tags
  html = html.replace(/>\s+</g, '><');
  html = html.replace(/\s+>/g, '>');
  html = html.replace(/>\s+/g, '>');

  // Remove spaces before closing tags
  html = html.replace(/\s+<\//g, '</');

  // Trim leading/trailing whitespace
  html = html.trim();

  return html;
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

if (!inputFile || !outputFile) {
  console.error('Usage: node minify.js <input.html> <output.html>');
  process.exit(1);
}

try {
  const html = fs.readFileSync(inputFile, 'utf-8');
  const minified = minifyHTML(html);
  fs.writeFileSync(outputFile, minified, 'utf-8');

  const originalSize = Buffer.byteLength(html);
  const minifiedSize = Buffer.byteLength(minified);
  const savings = Math.round((1 - minifiedSize / originalSize) * 100 * 10) / 10;

  console.log(`✅ Minified: ${originalSize} → ${minifiedSize} bytes (${savings}% saved)`);
} catch (error) {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
}
