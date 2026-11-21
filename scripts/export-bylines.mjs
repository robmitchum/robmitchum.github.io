#!/usr/bin/env node
// Bylines export: the "Rob Mitchum clips" Sheet → src/data/bylines/<section>.json
//
// Usage:
//   1. In the Sheet's page, download the "Clips" sheet as a CSV file.
//   2. npm run bylines -- path/to/Clips.csv
//
// Re-runnable: it rewrites the four data files from scratch every time, so the
// Sheet stays the one place where clips are edited. Columns are matched by
// header name, so adding or moving columns in the Sheet is fine.
//
// What it does besides copying cells:
//   - Podcast show-header rows (Headline equals Show, or Notes contain
//     "Show-level entry") become `shows` entries, not episodes.
//   - Notes stay out of the site (they're research notes), except a header
//     row's Notes that start with "Intro:", which become the show's intro.
//   - scripts/bylines-fixes.json corrects headlines the Sheet can't hold as
//     typed (a leading ' is eaten as the "keep as text" mark).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/data/bylines');
const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run bylines -- path/to/Clips.csv');
  process.exit(1);
}

// --- CSV (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) ---
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
function toIsoDate(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo >= 0) return `${m[3]}-${pad(mo + 1)}-${pad(m[2])}`;
  }
  throw new Error(`Can't read date "${s}"`);
}

const SECTIONS = { Music: 'music', Science: 'science', News: 'news', Podcasts: 'podcasts' };

const [header, ...body] = parseCsv(readFileSync(input, 'utf8'));
const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]));
for (const need of ['date', 'headline', 'outlet', 'format', 'section', 'url']) {
  if (!(need in col)) throw new Error(`Missing column "${need}" in ${input}`);
}
const get = (r, name) => (col[name] === undefined ? '' : (r[col[name]] ?? '').trim());

const fixes = JSON.parse(readFileSync(join(root, 'scripts/bylines-fixes.json'), 'utf8')).headlines;
let fixed = 0;

const out = { music: [], science: [], news: [], podcasts: [] };
const shows = [];
const problems = [];

body.forEach((r, i) => {
  const line = i + 2;
  const sectionLabel = get(r, 'section');
  const section = SECTIONS[sectionLabel];
  if (!section) { problems.push(`row ${line}: unknown Section "${sectionLabel}"`); return; }
  let title = get(r, 'headline');
  if (fixes[title]) { title = fixes[title]; fixed++; }
  const url = get(r, 'url') || null;
  if (url && !/^https?:\/\//.test(url)) problems.push(`row ${line}: URL doesn't start with http: ${url}`);
  const entry = {
    title,
    outlet: get(r, 'outlet'),
    date: toIsoDate(get(r, 'date')),
    format: get(r, 'format'),
    url,
  };
  const accolade = get(r, 'accolade');
  if (accolade) entry.accolade = accolade;
  if (get(r, 'featured').toUpperCase() === 'TRUE') entry.featured = true;
  const artist = get(r, 'artist');
  if (artist) entry.artist = artist;
  const work = get(r, 'work');
  if (work) entry.work = work;

  if (section === 'podcasts') {
    const show = get(r, 'show');
    const role = get(r, 'role');
    if (!show) problems.push(`row ${line}: podcast with no Show`);
    if (!role) problems.push(`row ${line}: podcast with no Role`);
    entry.show = show;
    entry.role = role;
    const notes = get(r, 'notes');
    if (title === show || /Show-level entry/i.test(notes)) {
      const intro = notes.match(/^Intro:\s*([\s\S]+)/i);
      shows.push({ show, title, url, role, outlet: entry.outlet, since: entry.date, ...(intro ? { intro: intro[1].trim() } : {}) });
      return;
    }
  }
  out[section].push(entry);
});

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title));
mkdirSync(outDir, { recursive: true });
for (const [section, items] of Object.entries(out)) {
  items.sort(byDateDesc);
  const data = section === 'podcasts' ? { shows, episodes: items } : items;
  writeFileSync(join(outDir, `${section}.json`), JSON.stringify(data, null, 1) + '\n');
}

const total = Object.values(out).reduce((n, a) => n + a.length, 0);
console.log(`Wrote ${total} bylines to src/data/bylines/: ` +
  Object.entries(out).map(([s, a]) => `${s} ${a.length}`).join(', ') +
  `; ${shows.length} podcast show headers; ${fixed} headline fixes applied.`);
const unused = Object.keys(fixes).length - fixed;
if (unused) console.log(`Note: ${unused} entries in bylines-fixes.json matched nothing (fixed in the Sheet already?).`);
