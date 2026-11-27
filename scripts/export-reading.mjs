#!/usr/bin/env node
// Reading Diary: the books Rob is reading now → src/data/now/reading.json (homepage "What I'm reading").
//
//   npm run reading -- --download        fetch the Log tab as CSV (needs the sheet shared
//                                        "anyone with the link can view")
//   npm run reading -- path/to/file.csv  use a CSV you downloaded, or a Sheets API values
//                                        response ({ "values": [[…]] })
//   add --soft                           on a failed download, keep the saved file and exit 0
//
// Reads the Log tab by header name: Started, Author, Title, Status, ISBN.
// Keeps rows whose Status is "Reading", newest start first. Nothing else leaves the sheet.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHEET_ID = '1mPipxSXpTHItcShm_aomAq4kXh93XSGVzY3vJJJDEwM';
const LOG_GID = 1697250800;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/data/now');
const args = process.argv.slice(2);
const soft = args.includes('--soft');
const source = args.find((a) => a !== '--soft');
if (!source) fail('Usage: npm run reading -- --download | <file.csv> [--soft]', true);

let rows;
if (source === '--download') {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${LOG_GID}`;
  console.log('Downloading the Reading Diary…');
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (text.trimStart().startsWith('<')) throw new Error('got a web page, not CSV (is the sheet shared by link?)');
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
const [cStarted, cAuthor, cTitle, cStatus] = ['started', 'author', 'title', 'status'].map(col);
const cIsbn = header.indexOf('isbn');

const books = rows.slice(1)
  .map((r) => (c) => String(r[c] ?? '').trim())
  .filter((cell) => cell(cStatus).toLowerCase() === 'reading' && cell(cTitle))
  .map((cell) => ({
    title: cell(cTitle),
    author: cell(cAuthor),
    started: isoDate(cell(cStarted)),
    isbn: cIsbn >= 0 ? cell(cIsbn) || null : null,
  }))
  .sort((a, b) => (b.started ?? '').localeCompare(a.started ?? ''));

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'reading.json'), JSON.stringify({ fetched: new Date().toISOString(), books }, null, 2) + '\n');
console.log(`Wrote ${books.length} books in progress to src/data/now/reading.json`);

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
    console.warn('Keeping the saved reading data.');
    process.exit(0);
  }
  process.exit(1);
}
