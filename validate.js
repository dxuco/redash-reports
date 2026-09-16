#!/usr/bin/env node
/**
 * HTML validation script
 * Checks that HTML is well-formed before deployment
 */

import fs from 'fs';

function validateHTML(html) {
  const errors = [];

  // Check for basic HTML structure (critical checks only)
  if (!html.includes('<!DOCTYPE')) {
    errors.push('Missing DOCTYPE declaration');
  }
  if (!html.includes('<html')) {
    errors.push('Missing <html> tag');
  }
  if (!html.includes('<body')) {
    errors.push('Missing <body> tag');
  }

  // Check file size is reasonable
  const sizeKB = Buffer.byteLength(html) / 1024;
  if (sizeKB > 5000) {
    errors.push(`HTML file is very large: ${sizeKB.toFixed(0)}KB (expected <2000KB)`);
  }

  // Check for critical meta tags
  if (!html.includes('<meta charset')) {
    errors.push('Missing charset meta tag');
  }
  if (!html.includes('<title>')) {
    errors.push('Missing <title> tag');
  }

  // Check for severely malformed HTML (unclosed doctype, missing closing >)
  if (html.match(/<!DOCTYPE[^>]*$/m)) {
    errors.push('DOCTYPE declaration appears unclosed at end of file');
  }

  return errors;
}

const inputFile = process.argv[2];

if (!inputFile) {
  console.error('Usage: node validate.js <input.html>');
  process.exit(1);
}

try {
  const html = fs.readFileSync(inputFile, 'utf-8');
  const errors = validateHTML(html);

  if (errors.length === 0) {
    console.log(`✅ HTML validation passed`);
    console.log(`   File: ${inputFile}`);
    console.log(`   Size: ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`);
    process.exit(0);
  } else {
    console.error(`❌ HTML validation failed with ${errors.length} error(s):`);
    errors.forEach((err, i) => {
      console.error(`   ${i + 1}. ${err}`);
    });
    process.exit(1);
  }
} catch (error) {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
}
