#!/usr/bin/env node
// Turns readCells results from the "Rob Mitchum clips" Claude Sheet into the
// Clips.csv that export-bylines.mjs reads, for when Claude does the export
// (the Sheet can't be downloaded through the Claude Docs connector).
//
// Usage:
//   node scripts/clips-to-csv.mjs out.csv part1.json part2.json ...
//
// Each part is a readCells result for the Clips sheet (e.g. A1:M650,
// A651:M1400), either the bare {"value":{"rows":…}} JSON or the saved tool
// output (a JSON array of {type, text} blocks). Row 1 must be in the first part.

import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...parts] = process.argv.slice(2);
if (!out || !parts.length) {
  console.error('Usage: node scripts/clips-to-csv.mjs out.csv part1.json [part2.json …]');
  process.exit(1);
}

function readRows(file) {
  let data = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(data)) {
    const block = data.map((b) => b.text ?? '').find((t) => t.trim().startsWith('{'));
    if (!block) throw new Error(`No JSON block in ${file}`);
    data = JSON.parse(block);
  }
  const rows = (data.value ?? data).rows;
  if (!rows) throw new Error(`No rows in ${file}`);
  return rows;
}

function cellText(c) {
  if (c === null || c === undefined) return '';
  if (typeof c === 'boolean') return c ? 'TRUE' : 'FALSE';
  if (typeof c !== 'object') return String(c);
  if ('date' in c) return c.date;
  if ('dateTime' in c) return c.dateTime.slice(0, 10);
  if ('markdown' in c) return c.markdown;
  if ('formula' in c) return cellText(c.value);
  if ('number' in c) return String(c.number);
  if ('error' in c) throw new Error(`Cell holds an error: ${JSON.stringify(c)}`);
  throw new Error(`Unknown cell value: ${JSON.stringify(c)}`);
}

const all = {};
for (const p of parts) Object.assign(all, readRows(p));
const nums = Object.keys(all).map(Number).sort((a, b) => a - b);
if (nums[0] !== 1) throw new Error('Row 1 (headers) is missing; read A1 in the first part.');

const width = all[1].length;
const esc = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const lines = nums.map((n) => {
  const r = all[n];
  return Array.from({ length: width }, (_, i) => esc(cellText(r[i]))).join(',');
});
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Wrote ${nums.length - 1} data rows (rows 2–${nums.at(-1)}) to ${out}`);
