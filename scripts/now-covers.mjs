#!/usr/bin/env node
// Homepage "Lately" boxes: find cover images for what's showing → src/data/now/covers.json.
//
//   npm run covers           look up covers for the items the boxes show right now
//   add --soft               never fail the build (the nightly build uses this)
//
// Run it after npm run diary / reading / watching. It stores image links, not files:
//   - albums: Apple Music (iTunes Search), then Deezer; artist and title must match.
//     Playlists, radio and DJ mixes are skipped (they get a plain tile on the site).
//   - books: Open Library, by ISBN, then by title + author.
//   - films: Letterboxd's poster is already in watching.json (npm run watching).
// Found covers are kept in covers.json, so each item is looked up once. To fix a wrong or
// missing cover, set its entry in covers.json by hand to any image link ("manual": true
// keeps the script from touching it), or to null to show the plain tile.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOWN = 3; // items per box; keep in step with src/lib/now.ts
const UA = 'robmitchum.com-now/1.0 ( https://robmitchum.com )';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nowDir = resolve(root, 'src/data/now');
const soft = process.argv.includes('--soft');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const coversPath = resolve(nowDir, 'covers.json');
const covers = existsSync(coversPath) ? readJson(coversPath) : {};

try {
  // The newest Listening Diary year
  const years = readJson(resolve(root, 'src/data/diary/years.json'));
  const year = Math.max(...years.map((y) => y.year));
  const entries = readJson(resolve(root, `src/data/diary/${year}.json`)).entries.slice(-SHOWN).reverse();
  const books = readJson(resolve(nowDir, 'reading.json')).books.slice(0, SHOWN);

  let found = 0, missing = [];
  for (const e of entries) {
    if (!/^(album|live show)$/i.test(e.type)) continue;
    const key = albumKey(e.artist, e.album);
    if (key in covers && (covers[key]?.url || covers[key]?.manual)) continue;
    const url = await albumCover(e.artist, e.album).catch(() => null);
    if (url) { covers[key] = { url }; found++; } else missing.push(`${e.artist} – ${e.album}`);
  }
  for (const b of books) {
    const key = bookKey(b);
    if (key in covers && (covers[key]?.url || covers[key]?.manual)) continue;
    const url = await bookCover(b).catch(() => null);
    if (url) { covers[key] = { url }; found++; } else missing.push(`${b.title} (${b.author})`);
  }

  writeFileSync(coversPath, JSON.stringify(sortKeys(covers), null, 2) + '\n');
  console.log(`Covers: ${found} new.` + (missing.length ? ` None found for: ${missing.join('; ')}` : ''));
  for (const [k, v] of Object.entries(covers)) if (v?.url) console.log(`  ${k} → ${v.url}`);
} catch (e) {
  console.error(`Cover lookup failed: ${e.message}`);
  process.exit(soft ? 0 : 1);
}

// Keys shared with src/lib/now.ts
function albumKey(artist, album) { return `album:${norm(artist)}|${norm(album)}`; }
function bookKey(b) { return `book:${b.isbn || `${norm(b.title)}|${norm(b.author)}`}`; }
function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}
// "Led Zeppelin II (Remaster)" ~ "Led Zeppelin II"; "The Rolling Thunder Revue 1976: …" matches with or without "The"
function sameTitle(a, b) {
  const clean = (s) => norm(String(s).replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+(single|ep|deluxe.*|remaster.*)$/i, '')).replace(/^the /, '');
  const x = clean(a), y = clean(b);
  return x === y || (x.length > 8 && y.length > 8 && (x.startsWith(y) || y.startsWith(x)));
}
function sameArtist(a, b) {
  const x = norm(a).replace(/^the /, ''), y = norm(b).replace(/^the /, '');
  return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ');
}

async function albumCover(artist, album) {
  const it = await getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${album.replace(/\s*\(.*?\)/g, '')}`, entity: 'album', country: 'US', limit: '25' })}`);
  const hit = it?.results?.find((r) => sameArtist(r.artistName, artist) && sameTitle(r.collectionName, album));
  if (hit?.artworkUrl100) return hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.');
  const dz = await getJson(`https://api.deezer.com/search/album?${new URLSearchParams({ q: `artist:"${artist}" album:"${album.replace(/\s*\(.*?\)/g, '')}"`, limit: '25' })}`);
  const d = dz?.data?.find((r) => sameArtist(r.artist?.name, artist) && sameTitle(r.title, album));
  return d?.cover_medium ?? null;
}

async function bookCover(b) {
  if (b.isbn) {
    const url = `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg`;
    const res = await fetch(`${url}?default=false`, { method: 'HEAD', headers: { 'user-agent': UA } }).catch(() => null);
    if (res?.ok) return url;
  }
  const q = new URLSearchParams({ title: b.title.replace(/:.*$/, ''), author: b.author.split(/ & | and /)[0], fields: 'title,cover_i', limit: '10' });
  const ol = await getJson(`https://openlibrary.org/search.json?${q}`);
  const hit = ol?.docs?.find((d) => d.cover_i && sameTitle(d.title, b.title.replace(/:.*$/, '')));
  return hit ? `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg` : null;
}

async function getJson(url) {
  await new Promise((r) => setTimeout(r, 400));
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}
function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }
