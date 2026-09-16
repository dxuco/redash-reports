#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function createTableHTML(rows, columns) {
  if (!rows || rows.length === 0) {
    return '<p style="text-align: center; color: var(--slate);">No data available</p>';
  }

  let html = '<table style="margin-top: 1rem;"><thead><tr>';
  columns.forEach(col => {
    html += `<th>${col}</th>`;
  });
  html += '</tr></thead><tbody>';

  rows.slice(0, 10).forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      const value = row[col];
      const displayValue = value === null ? '—' : value === undefined ? '—' : value;
      html += `<td>${displayValue}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  if (rows.length > 10) {
    html += `<p style="color: var(--slate); font-size: 11px; margin-top: 0.5rem;">Showing 10 of ${rows.length} rows</p>`;
  }

  return html;
}

function generateBonusHTML(jsonFile) {
  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const q1758 = data.queries['1758'];

  const tableHTML = q1758 && q1758.summary
    ? createTableHTML(q1758.summary.sampleRows, q1758.summary.columns)
    : '<p>No data available</p>';

  const totalRows = q1758 ? q1758.rowCount : 0;

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23213916'/%3E%3Cpath d='M6 9.5 L11 23 L16 13.5 L21 23 L26 9.5' fill='none' stroke='%23b3e580' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bonus Cost Analysis</title>
<style>
* { box-sizing: border-box; }
:root {
  --dark-green: #0B6E3A;
  --green-hi: #0d7f43;
  --green-dk: #0a5a30;
  --sage: #4E9D5C;
  --navy: #0F2A43;
  --slate: #5B7285;
  --light-green: #C0DD97;
  --surface-1: #FFFFFF;
  --plane: #F4F6F5;
  --row-alt: #F3F7F3;
  --band: #E3F3E8;
  --text-primary: #0F2A43;
  --text-secondary: #5B7285;
  --muted: #677181;
  --grid: #E5E5E5;
  --axis: #C3CCD4;
  --border: #E5E5E5;
  --grey: #B7C3CF;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color-scheme: light;
}
body {
  margin: 0;
  background: var(--plane);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.45;
}
.wrap {
  max-width: 1800px;
  margin: 0 auto;
  padding: 20px;
}
.cover {
  background: linear-gradient(135deg, var(--dark-green) 0%, var(--green-dk) 100%);
  color: #fff;
  padding: 1.6rem 20px 1.4rem;
  line-height: 1.45;
  margin: -20px -20px 20px -20px;
}
.cover-inner {
  max-width: 1800px;
  margin: 0 auto;
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-start;
  justify-content: space-between;
}
h1 {
  font-size: 1.55rem;
  font-weight: 700;
  margin: 0 0 .25rem;
  letter-spacing: -0.01em;
}
.sub {
  color: var(--light-green);
  font-size: .86rem;
  margin: 0;
}
h2 {
  font-size: .95rem;
  font-weight: 700;
  margin: 1.5rem 0 1rem;
  letter-spacing: .01em;
  color: var(--navy);
}
.card {
  background: var(--surface-1);
  border-radius: 8px;
  margin-top: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  padding: 1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  overflow-x: auto;
}
th {
  background: var(--band);
  padding: 0.5rem;
  text-align: left;
  font-weight: 600;
  color: var(--navy);
  border-bottom: 2px solid var(--border);
}
td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
tr:nth-child(even) {
  background: var(--row-alt);
}
.stat {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--dark-green);
}
.stat-label {
  font-size: 0.8rem;
  color: var(--slate);
  margin-top: 0.25rem;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin: 1.5rem 0;
}
.stat-card {
  background: var(--surface-1);
  padding: 1rem;
  border-radius: 8px;
  border-left: 4px solid var(--dark-green);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.tbl { padding: 0.3rem 0.9rem 1rem; overflow-x: auto; }
</style>
</head>
<body>
<div class="cover">
  <div class="cover-inner">
    <header>
      <div>
        <h1>Bonus Cost Analysis</h1>
        <p class="sub">Comprehensive bonus cost and retention metrics</p>
      </div>
    </header>
  </div>
</div>

<div class="wrap">
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat">${totalRows.toLocaleString()}</div>
      <div class="stat-label">Total Depositors</div>
    </div>
  </div>

  <h2>Bonus Cost By Categories</h2>
  <div class="card">
    <p style="text-align: center; color: var(--slate);">No data available for this metric</p>
  </div>

  <h2>Depositors Monthly Retention</h2>
  <div class="card">
    <p style="text-align: center; color: var(--slate);">No data available for this metric</p>
  </div>

  <h2>Deposit Retention - Whole Base</h2>
  <div class="card">
    ${q1758 ? `<p style="margin: 0 0 1rem 0; color: var(--slate); font-size: 11px;">Sample data from ${totalRows.toLocaleString()} records</p>
    <div class="tbl">${tableHTML}</div>` : '<p>No data available</p>'}
  </div>

  <p style="text-align: center; color: var(--muted); font-size: 11px; margin-top: 2rem;">
    Generated: ${new Date().toLocaleString()}
  </p>
</div>
</body>
</html>`;
}

// Generate bonus.html from the latest JSON
const bonusJsonPath = '/Users/davitkhutsishvili/Documents/Projects/General Report /reports/cache-bonus/output/cache-bonus-2026-09-16.json';
const outputPath = '/Users/davitkhutsishvili/Downloads/redash-reports/bonus.html';

if (fs.existsSync(bonusJsonPath)) {
  const html = generateBonusHTML(bonusJsonPath);
  fs.writeFileSync(outputPath, html);
  console.log(`✓ Generated bonus.html from JSON data`);
} else {
  console.error(`✗ Bonus JSON not found at ${bonusJsonPath}`);
  process.exit(1);
}
