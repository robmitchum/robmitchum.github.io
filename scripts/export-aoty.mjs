#!/usr/bin/env node
// Albums of the Year: turn one year's Google Sheet into src/data/aoty/<year>.json.
//
//   npm run aoty -- 2025 --download        fetch the sheet tab as CSV (the sheet must be
//                                          shared "anyone with the link can view")
//   npm run aoty -- 2025 path/to/file.csv  use a CSV you downloaded (File → Download → CSV)
//
// The tab is read by header name: the first column is "Artist - Title", every column
// whose header matches an abbreviation in src/data/aoty/publications/<year>.json is a
// list, and the stats columns on the right (AVG, CONS SCORE, # Lists, …) are ignored —
// the site recomputes them. A header the script doesn't recognize stops it, so a new
// list can't be dropped by accident: add the outlet to the publications file first.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'src/data/aoty');

const [yearArg, source] = process.argv.slice(2);
const year = Number(yearArg);
if (!year || !source) {
  console.error('Usage: npm run aoty -- <year> --download | <file.csv>');
  process.exit(1);
}

const years = JSON.parse(readFileSync(resolve(dataDir, 'years.json'), 'utf8'));
const meta = years.find((y) => y.year === year);
if (!meta) fail(`${year} isn't in src/data/aoty/years.json. Add it (sheetId, tab) first.`);
const pubs = JSON.parse(readFileSync(resolve(dataDir, `publications/${year}.json`), 'utf8'));
const byAbbr = new Map(pubs.map((p) => [norm(p.abbr), p]));

// Columns that hold stats, ids or notes rather than a publication's list.
const IGNORE = new Set(['AVG', 'AVERAGE', 'WT-AVG', 'WTAVG', 'WT AVG', 'CONS SCORE', 'CONS', 'CONSENSUS',
  '# LISTS', '#LISTS', 'LISTS', 'TOP 10S', 'TOP10S', 'TOP 10', '#1S', '# 1S', 'NO. 1S', 'ID', 'GENRE', 'NOTES', '']);

let rows;
if (source === '--download') {
  const url = `https://docs.google.com/spreadsheets/d/${meta.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(meta.tab)}`;
  console.log(`Downloading ${meta.tab} tab of the ${year} sheet…`);
  const res = await fetch(url);
  if (!res.ok) fail(`Download failed (${res.status}). Is the sheet shared "anyone with the link"?`);
  rows = parseCsv(await res.text());
} else {
  const text = readFileSync(source, 'utf8');
  // A Sheets API values response ({ "values": [[…]] }), as saved by the Sheets connector,
  // or a plain CSV.
  rows = text.trimStart().startsWith('{') ? JSON.parse(text).values : parseCsv(text);
}

const header = rows[0].map((h) => String(h ?? '').trim());
const cols = []; // [columnIndex, publication]
const unknown = [];
header.forEach((h, i) => {
  if (i === 0) return;
  // CONS is both Consequence's abbreviation and a stats heading in some years: a known
  // publication wins.
  const p = byAbbr.get(norm(h));
  if (p) cols.push([i, p]);
  else if (!IGNORE.has(h.toUpperCase())) unknown.push(h);
});
if (unknown.length) {
  fail(`Unrecognized column header(s): ${unknown.join(', ')}.\n` +
    `Add them to src/data/aoty/publications/${year}.json (abbr, name, url), or to IGNORE in this script if they aren't lists.`);
}
const missing = pubs.filter((p) => !cols.some(([, c]) => c === p));
if (missing.length) fail(`No column for: ${missing.map((p) => p.abbr).join(', ')} (in publications/${year}.json but not the sheet).`);

const albums = [];
const seen = new Map();
const problems = [];
for (let r = 1; r < rows.length; r++) {
  const cell = String(rows[r][0] ?? '').trim();
  if (!cell) continue;
  const split = splitAlbum(cell);
  if (!split) { problems.push(`row ${r + 1}: "${cell}" has no " - " between artist and title`); continue; }
  const ranks = cols.map(([i]) => {
    const v = String(rows[r][i] ?? '').trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1) { problems.push(`row ${r + 1} (${cell}), ${header[i]}: "${v}" isn't a rank`); return null; }
    return n;
  });
  if (!ranks.some((x) => x !== null)) continue; // a row with no list placements
  const key = cell.toLowerCase();
  if (seen.has(key)) problems.push(`row ${r + 1}: "${cell}" repeats row ${seen.get(key)}`);
  seen.set(key, r + 1);
  albums.push({ artist: split[0], title: split[1], ranks });
}
if (problems.length) fail(`Fix these in the sheet (or the CSV) and run again:\n  ${problems.join('\n  ')}`);

const out = { year, pubs: cols.map(([, p]) => p.abbr), albums };
const path = resolve(dataDir, `${year}.json`);
writeFileSync(path, JSON.stringify(out, null, 0).replace(/\},\{"artist"/g, '},\n{"artist"') + '\n');
console.log(`Wrote ${path}: ${albums.length} albums on ${cols.length} lists.`);

// ---------------------------------------------------------------------------

function fail(msg) { console.error(msg); process.exit(1); }
function norm(s) { return String(s).trim().toUpperCase(); }

// "Artist - Title". Splits at the first " - "; an artist with " - " in the name would need
// an override, but none so far. Also accepts en/em dashes.
function splitAlbum(s) {
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

function parseCsv(text) {
  const out = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); out.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out;
}
