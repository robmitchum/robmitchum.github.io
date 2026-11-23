#!/usr/bin/env node
// Listening Diary: turn the year's Google Sheet (Log tab) into src/data/diary/<year>.json.
//
//   npm run diary -- 2026 --download        fetch the Log tab as CSV (the sheet is shared
//                                           "anyone with the link can view")
//   npm run diary -- 2026 path/to/file.csv  use a CSV you downloaded, or a Sheets API
//                                           values response ({ "values": [[…]] })
//   leave out the year to use the newest one in src/data/diary/years.json
//   add --soft                              on a failed download, keep the saved file and
//                                           exit 0 (the nightly build uses this)
//
// Columns are read by header name: Date, Artist, Album, Release Year, Type, Format.
// Location is left out on purpose: the public page doesn't show where Rob listens.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'src/data/diary');

const args = process.argv.slice(2);
const soft = args.includes('--soft');
const rest = args.filter((a) => a !== '--soft');
const years = JSON.parse(readFileSync(resolve(dataDir, 'years.json'), 'utf8'));
if (!/^\d{4}$/.test(rest[0] ?? '')) rest.unshift(String(Math.max(...years.map((y) => y.year))));
const [yearArg, source] = rest;
const year = Number(yearArg);
if (!source) fail('Usage: npm run diary -- [year] --download | <file.csv> [--soft]', true);

const meta = years.find((y) => y.year === year);
if (!meta) fail(`${year} isn't in src/data/diary/years.json. Add it (sheetId, gid) first.`, true);

let rows;
if (source === '--download') {
  const url = `https://docs.google.com/spreadsheets/d/${meta.sheetId}/export?format=csv&gid=${meta.gid}`;
  console.log(`Downloading the ${year} Listening Diary…`);
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('got a web page, not CSV (is the sheet still shared by link?)');
  } catch (e) {
    fail(`Download failed: ${e.message}`);
  }
  rows = parseCsv(text);
} else {
  const text = readFileSync(source, 'utf8');
  rows = text.trimStart().startsWith('{') ? JSON.parse(text).values : parseCsv(text);
}

const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) fail(`No "${name}" column in the Log tab header.`, true);
  return i;
};
const [cDate, cArtist, cAlbum, cYear, cType, cFormat] = ['date', 'artist', 'album', 'release year', 'type', 'format'].map(col);

const entries = [];
const skipped = [];
rows.slice(1).forEach((r, i) => {
  const cell = (c) => String(r[c] ?? '').trim();
  if (!cell(cDate) && !cell(cArtist) && !cell(cAlbum)) return; // blank row
  const date = isoDate(cell(cDate));
  if (!date) { skipped.push(`row ${i + 2}: date "${cell(cDate)}"`); return; }
  const ry = Number(cell(cYear));
  entries.push({
    date,
    artist: cell(cArtist),
    album: cell(cAlbum),
    year: Number.isInteger(ry) && ry > 1000 ? ry : null,
    type: cell(cType) || 'Album',
    format: cell(cFormat) || null,
  });
});
if (!entries.length) fail('No entries found.');
// Sheet order within a day is listening order; keep it, sorted by date.
entries.forEach((e, i) => (e.n = i));
entries.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
entries.forEach((e) => delete e.n);

mkdirSync(dataDir, { recursive: true });
const out = resolve(dataDir, `${year}.json`);
const fetched = new Date().toISOString();
writeFileSync(out, JSON.stringify({ year, fetched, entries }, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`Wrote ${entries.length} entries (through ${entries.at(-1).date}) to src/data/diary/${year}.json`);
if (skipped.length) console.warn(`Skipped ${skipped.length} rows with an unreadable date:\n  ${skipped.join('\n  ')}`);

// "1-2-26", "01/02/2026", "2026-01-02" → "2026-01-02"
function isoDate(s) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return fmt(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function fmt(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCsv(text) {
  const out = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); out.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

function fail(msg, hard = false) {
  console.error(msg);
  if (soft && !hard) {
    console.warn('Keeping the saved diary data.');
    process.exit(0);
  }
  process.exit(1);
}
