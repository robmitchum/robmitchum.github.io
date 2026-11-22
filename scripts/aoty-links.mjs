#!/usr/bin/env node
// Albums of the Year: find Listen / Buy links and covers for one year's albums.
//
//   npm run aoty:links -- 2025 --top 200     the Consensus top 200
//   npm run aoty:links -- 2025               every album
//   npm run aoty:links -- 2025 --redo        look up found albums again too (except locked ones)
//   npm run aoty:links -- 2025 --skip-buy    skip the Bandcamp lookup (much faster)
//   npm run aoty:links -- 2025 --debug "Geese - Getting Killed"
//                                            show what each service returns for one album
//
// For each album:
//   1. Deezer's search API finds the album (Apple's own search API misses too much).
//      Its cover is saved at 300×300 to public/aoty/covers/<year>/<slug>.jpg.
//   2. Deezer's record of the album has its UPC (barcode); Apple's lookup finds the same
//      release by UPC → the Apple Music link, and Listen = album.link/i/<Apple id>, a page
//      linking every streaming service. (Odesli's API needs a key now; this doesn't.)
//   3. MusicBrainz finds the Bandcamp page, when its entry for the album lists one → Buy.
//      (Bandcamp blocks scripts from its own search.)
//   If Deezer or the barcode misses, Apple's search is tried as a fallback.
//
// Results go to src/data/aoty/links/<year>.json, keyed by "artist - title" in lower case.
// Albums already found are skipped; misses are tried again on every run and listed in
// src/data/aoty/links/<year>-missing.txt. Saved after every album: Ctrl-C and rerun is safe.
//
// Fixing by hand: the best place is the year's sheet. Its LISTEN and BUY columns (any link)
// beat everything here; run `npm run aoty -- <year> --download` first to pull them in.
// Or, in the links file:
//   - Paste an Apple Music album URL as "apple" (and remove "listen") for a miss or a wrong
//     match: the next run fills in Listen and the cover from it.
//   - Any other Listen link (Bandcamp, YouTube, Spotify…) goes in "listen". The script keeps
//     it and only looks for a cover.
//   - Paste a Bandcamp album URL as "bandcamp"; "bandcamp": "" hides a wrong Buy button.
//   - A cover you saved yourself: put the image in public/aoty/covers/<year>/ and set
//     "cover": "/aoty/covers/<year>/<file name>".
//   - Add "locked": true to keep the script from touching an album again.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const year = Number(args[0]);
if (!year) { console.error('Usage: npm run aoty:links -- <year> [--top N] [--redo] [--debug "Artist - Title"]'); process.exit(1); }
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const top = opt('--top') ? Number(opt('--top')) : Infinity;
const redo = args.includes('--redo');
const skipBuy = args.includes('--skip-buy'); // leave Bandcamp to the sheet's BUY column
const debug = opt('--debug');

const UA = 'robmitchum.com-aoty/1.0 ( https://robmitchum.com )'; // MusicBrainz asks for an identifying user agent
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let links = {};
let save = () => {};

if (debug) {
  const [artist, title] = debug.split(/\s+[-–—]\s+/);
  if (!title) { console.error('Give the album as "Artist - Title"'); process.exit(1); }
  await runDebug(artist, title);
  process.exit(0);
}

const data = JSON.parse(readFileSync(resolve(root, `src/data/aoty/${year}.json`), 'utf8'));
const linksPath = resolve(root, `src/data/aoty/links/${year}.json`);
const missingPath = resolve(root, `src/data/aoty/links/${year}-missing.txt`);
links = existsSync(linksPath) ? JSON.parse(readFileSync(linksPath, 'utf8')) : {};
save = () => writeFileSync(linksPath, JSON.stringify(sortKeys(links), null, 2) + '\n');
const coverDir = resolve(root, `public/aoty/covers/${year}`);
mkdirSync(coverDir, { recursive: true });

// Consensus order (same rule as src/lib/aoty.ts), so --top takes the chart's top N.
const n = data.pubs.length;
const albums = data.albums.map((a) => {
  const placed = a.ranks.filter((r) => r !== null);
  return { ...a, score: a.ranks.reduce((s, r) => s + (r ?? 75), 0) / n, lists: placed.length, top10s: placed.filter((r) => r <= 10).length };
}).sort((a, b) => a.score - b.score || b.lists - a.lists || b.top10s - a.top10s || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
  .slice(0, top);

let looked = 0;

// The sheet manages links (LISTEN / BUY / COVER columns, filled by scripts/sheets/aoty-links.gs):
// just download each COVER that isn't saved yet. No searching.
if (data.linkColumns && !redo) {
  let saved = 0; let missingCover = 0;
  for (const a of albums) {
    const key = `${a.artist} - ${a.title}`.toLowerCase();
    const entry = links[key] ?? {};
    if (entry.locked) continue;
    if (!a.cover) { if (!entry.cover) missingCover++; continue; }
    if (entry.cover && entry.coverFrom === a.cover) continue;
    const file = `${slugify(`${a.artist} ${a.title}`)}.jpg`;
    await saveCover(entry, a.cover, file);
    if (entry.cover) { entry.coverFrom = a.cover; saved++; }
    links[key] = entry;
  }
  save();
  console.log(`Downloaded ${saved} covers from the sheet's COVER column.` +
    (missingCover ? ` ${missingCover} albums have no cover yet (run "Find links" in the sheet).` : ''));
  process.exit(0);
}

// Control-C: save, and still write the missing list.
process.on('SIGINT', () => { save(); summarize(); process.exit(130); });

function summarize() {
  const all = albums.map((a) => {
    const e = { ...(links[`${a.artist} - ${a.title}`.toLowerCase()] ?? {}) };
    if (a.listen) e.listen = a.listen;
    if (a.buy) e.bandcamp = a.buy;
    return e;
  });
  const missing = albums.filter((a, i) => !all[i].listen).map((a) => `${a.artist} - ${a.title}`);
  writeFileSync(missingPath, missing.join('\n') + (missing.length ? '\n' : ''));
  console.log(`\nLooked up ${looked} albums this run.`);
  console.log(`Of these ${albums.length}: ${all.filter((e) => e.listen).length} have Listen links, ${all.filter((e) => e.cover).length} have covers, ${all.filter((e) => e.bandcamp).length} have Buy links.`);
  if (missing.length) console.log(`The ${missing.length} without a Listen link are listed in ${missingPath}`);
}

for (const [i, a] of albums.entries()) {
  const key = `${a.artist} - ${a.title}`.toLowerCase();
  const entry = links[key] ?? {};
  if (entry.locked) continue;
  // Links in the sheet's LISTEN / BUY columns are final: only the cover is still looked for.
  const sheetListen = a.listen; const sheetBuy = a.buy;
  const needListen = sheetListen ? !entry.cover || redo
    : redo || !entry.listen || !entry.cover || !!entry.retryOdesli || entry.listen.includes('deezer.com');
  const needBuy = !skipBuy && !sheetBuy && (redo || entry.bandcamp === undefined);
  if (!needListen && !needBuy) continue;
  const notes = [];
  const file = `${slugify(`${a.artist} ${a.title}`)}.jpg`;

  if (needListen && sheetListen) {
    try { notes.push(await coverFor(a, sheetListen, entry, file)); }
    catch (e) { notes.push(`Cover: error (${e.message})`); }
  } else if (needListen) {
    try { notes.push(await fillListen(a, entry, file)); }
    catch (e) { notes.push(`Listen: error (${e.message})`); }
  }
  if (needBuy) {
    try {
      const { url, why } = await findBandcamp(a.artist, a.title);
      if (url) { entry.bandcamp = url; notes.push('Buy: Bandcamp found (MusicBrainz)'); }
      else notes.push(`Buy: none (${why})`);
    } catch (e) { notes.push(`Buy: error (${e.message})`); }
  }

  links[key] = entry;
  save();
  looked++;
  console.log(`${String(i + 1).padStart(3)}  ${a.artist} – ${a.title}\n       ${notes.join(' · ')}`);
}
save();

summarize();

// ---------------------------------------------------------------------------
// Listen + cover

async function fillListen(a, entry, file) {
  // Left over from the album.link-API version: a Deezer page standing in for Listen.
  if (entry.retryOdesli || entry.listen?.includes('deezer.com')) { delete entry.retryOdesli; delete entry.listen; }
  // A Listen link typed in by hand (Bandcamp, YouTube, Spotify…): never replaced. Only the
  // cover is looked for, on Deezer.
  if (entry.listen && !/album\.link|song\.link|deezer\.com/.test(entry.listen)) {
    if (entry.cover) return 'Listen: your link (kept)';
    const dz = await findDeezer(a.artist, a.title);
    const m = dz.match;
    const cover = m && (m.md5_image ? `https://e-cdns-images.dzcdn.net/images/cover/${m.md5_image}/300x300-000000-80-0-0.jpg` : m.cover_medium || m.cover_big);
    if (cover) await saveCover(entry, cover, file);
    return `Listen: your link (kept)${entry.cover ? ' + cover from Deezer' : '; no cover found'}`;
  }

  // A pasted Apple Music URL wins: fill in from it.
  const pastedId = entry.apple?.match(/\/(\d{6,})(?:\?|$)/)?.[1];
  if (pastedId && (!entry.listen || !entry.cover)) {
    entry.listen ||= `https://album.link/i/${pastedId}`;
    if (!entry.cover) {
      const r = (await itunesLookup(pastedId))[0];
      if (r?.artworkUrl100) await saveCover(entry, r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg'), file);
    }
    return `Listen: from the Apple link in the file${entry.cover ? ' + cover' : ''}`;
  }

  const dz = await findDeezer(a.artist, a.title);
  if (dz.match) {
    const m = dz.match;
    entry.deezer = m.link;
    delete entry.retryOdesli;
    const cover = m.md5_image
      ? `https://e-cdns-images.dzcdn.net/images/cover/${m.md5_image}/300x300-000000-80-0-0.jpg`
      : m.cover_medium || m.cover_big;
    if (cover && (!entry.cover || redo)) await saveCover(entry, cover, file);
    // Deezer's album record has the UPC (barcode); Apple's lookup finds the same release by it.
    const apple = await appleByUpc(m.id);
    if (apple) {
      entry.apple = apple.collectionViewUrl.replace(/\?.*$/, '');
      entry.listen = `https://album.link/i/${apple.collectionId}`;
      return `Listen: Deezer “${m.artist?.name} – ${m.title}” → Apple by barcode → album.link`;
    }
    const ap = await findApple(a.artist, a.title);
    if (ap.match) {
      entry.apple = ap.match.collectionViewUrl.replace(/\?.*$/, '');
      entry.listen = `https://album.link/i/${ap.match.collectionId}`;
      return `Listen: Deezer “${m.artist?.name} – ${m.title}” (cover); Apple search → album.link`;
    }
    delete entry.listen;
    return `Listen: cover from Deezer, but no Apple Music match (paste the Apple link by hand)`;
  }

  // Fallback: Apple's search API.
  const ap = await findApple(a.artist, a.title);
  if (ap.match) {
    entry.apple = ap.match.collectionViewUrl.replace(/\?.*$/, '');
    entry.listen = `https://album.link/i/${ap.match.collectionId}`;
    if (ap.match.artworkUrl100 && !entry.cover) await saveCover(entry, ap.match.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg'), file);
    return `Listen: Apple “${ap.match.artistName} – ${ap.match.collectionName}”`;
  }
  return `Listen: not found (Deezer: ${dz.why}; Apple: ${ap.why})`;
}

// Cover for an album whose Listen link came from the sheet: from Apple if it's an Apple
// Music link, otherwise from Deezer.
async function coverFor(a, listen, entry, file) {
  const id = /music\.apple\.com/.test(listen) ? listen.match(/\/(\d{6,})(?:\?|$)/)?.[1] : null;
  if (id) {
    const r = (await itunesLookup(id))[0];
    if (r?.artworkUrl100) await saveCover(entry, r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg'), file);
    if (entry.cover) return 'Listen: from the sheet · cover from Apple';
  }
  const dz = await findDeezer(a.artist, a.title);
  const m = dz.match;
  const cover = m && (m.md5_image ? `https://e-cdns-images.dzcdn.net/images/cover/${m.md5_image}/300x300-000000-80-0-0.jpg` : m.cover_medium || m.cover_big);
  if (cover) await saveCover(entry, cover, file);
  return `Listen: from the sheet · ${entry.cover ? 'cover from Deezer' : 'no cover found'}`;
}

async function saveCover(entry, url, file) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    writeFileSync(resolve(coverDir, file), Buffer.from(await res.arrayBuffer()));
    entry.cover = `/aoty/covers/${year}/${file}`;
  } catch { /* the cover is optional */ }
}

// Retry on rate limits and server errors; give up (and save) after a few tries.
async function getJson(url, { pause = 0, init = {}, name = 'request', tries = 4, backoff = 30000, quiet = false } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (pause) await sleep(pause);
    let res;
    try { res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...(init.headers ?? {}) } }); }
    catch { await sleep(5000); continue; }
    if (res.status === 403 || res.status === 429 || res.status === 503 || res.status >= 500) {
      const wait = backoff * (attempt + 1);
      if (!quiet || attempt > 0) console.warn(`       ${name} is busy or rate-limiting (HTTP ${res.status}); waiting ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error(`${name} sent a web page instead of data`); }
  }
  throw new Error(`${name} kept refusing`);
}

async function findDeezer(artist, title) {
  const selfTitled = /^(s\/t|self[- ]titled)$/i.test(title.trim());
  const want = wanted(artist, selfTitled ? artist : title);
  const qs = [
    selfTitled ? `artist:"${artist}"` : `artist:"${artist}" album:"${title}"`,
    `${artist} ${selfTitled ? '' : title}`.trim(),
    ...(selfTitled ? [] : [`album:"${title}"`]),
  ];
  let closest = null; let seen = 0;
  for (const q of qs) {
    const json = await getJson(`https://api.deezer.com/search/album?${new URLSearchParams({ q, limit: '25' })}`, { pause: 250, name: 'Deezer', backoff: 5000 });
    if (json?.error) throw new Error(`Deezer: ${json.error.message ?? 'error'}`);
    const results = json?.data ?? [];
    seen += results.length;
    const best = pickBest(want, results.map((r) => ({ r, a: r.artist?.name ?? '', t: r.title ?? '' })));
    if (best && best.s >= 1.5) return { match: best.r };
    if (best && (!closest || best.s > closest.s)) closest = best;
  }
  return { match: null, why: seen ? `closest “${closest.r.artist?.name} – ${closest.r.title}”` : 'no results' };
}

// Deezer album → its UPC → Apple's lookup by UPC.
async function appleByUpc(deezerId) {
  const album = await getJson(`https://api.deezer.com/album/${deezerId}`, { pause: 250, name: 'Deezer', backoff: 5000 });
  const upc = album?.upc;
  if (!upc) return null;
  for (const code of [upc, upc.replace(/^0+/, ''), upc.padStart(13, '0')]) {
    const json = await getJson(`https://itunes.apple.com/lookup?${new URLSearchParams({ upc: code, entity: 'album', country: 'US' })}`, { pause: 3200, name: 'Apple', backoff: 60000 });
    const hit = (json?.results ?? []).find((r) => r.collectionId && r.collectionViewUrl);
    if (hit) return hit;
  }
  return null;
}

async function findApple(artist, title) {
  const want = wanted(artist, title);
  const json = await getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, media: 'music', entity: 'album', country: 'US', limit: '25' })}`, { pause: 3200, name: 'Apple', backoff: 60000 });
  const results = json?.results ?? [];
  const best = pickBest(want, results.map((r) => ({ r, a: r.artistName, t: r.collectionName })));
  if (best && best.s >= 1.5) return { match: best.r };
  return { match: null, why: results.length ? `closest “${best.r.artistName} – ${best.r.collectionName}”` : 'no results' };
}

async function itunesLookup(id) {
  const json = await getJson(`https://itunes.apple.com/lookup?${new URLSearchParams({ id, entity: 'album', country: 'US' })}`, { pause: 3200, name: 'Apple', backoff: 60000 });
  return json?.results ?? [];
}

// ---------------------------------------------------------------------------
// Buy: Bandcamp links recorded in MusicBrainz (one request every 2 seconds; it turns away faster ones)

async function findBandcamp(artist, title) {
  const selfTitled = /^(s\/t|self[- ]titled)$/i.test(title.trim());
  const want = wanted(artist, selfTitled ? artist : title);
  const esc = (s) => s.replace(/(["\\])/g, '\\$1');
  const query = `releasegroup:"${esc(selfTitled ? artist : title)}" AND artist:"${esc(artist)}"`;
  const json = await getJson(`https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query, fmt: 'json', limit: '5' })}`, { pause: 2000, name: 'MusicBrainz', tries: 5, backoff: 3000, quiet: true });
  const groups = json?.['release-groups'] ?? [];
  const best = pickBest(want, groups.map((g) => ({ r: g, a: credit(g['artist-credit']), t: g.title })));
  if (!best || best.s < 1.5) return { url: null, why: groups.length ? 'no matching MusicBrainz entry' : 'not in MusicBrainz' };
  // Bandcamp links usually sit on a release, sometimes on the release group.
  const rg = await getJson(`https://musicbrainz.org/ws/2/release-group/${best.r.id}?${new URLSearchParams({ inc: 'url-rels+releases', fmt: 'json' })}`, { pause: 2000, name: 'MusicBrainz', tries: 5, backoff: 3000, quiet: true });
  let url = bandcampIn(rg?.relations);
  for (const rel of (rg?.releases ?? []).slice(0, 4)) {
    if (url) break;
    const r = await getJson(`https://musicbrainz.org/ws/2/release/${rel.id}?${new URLSearchParams({ inc: 'url-rels', fmt: 'json' })}`, { pause: 2000, name: 'MusicBrainz', tries: 5, backoff: 3000, quiet: true });
    url = bandcampIn(r?.relations);
  }
  return url ? { url } : { url: null, why: 'MusicBrainz lists no Bandcamp page' };
}
function bandcampIn(relations = []) {
  const hit = relations.find((r) => /bandcamp\.com\/album\//.test(r.url?.resource ?? ''));
  return hit ? hit.url.resource.replace(/\?.*$/, '') : null;
}
function credit(ac = []) { return ac.map((c) => (c.name ?? c.artist?.name ?? '') + (c.joinphrase ?? '')).join(''); }

// ---------------------------------------------------------------------------
// Matching: up to 1 point for the artist, up to 1 for the title.

function wanted(artist, title) {
  return { a: norm(artist), t: normTitle(title), artists: splitArtists(artist) };
}
function pickBest(want, cands) {
  let best = null;
  for (const c of cands) {
    const s = artistScore(want, c.a) + titleScore(want.t, normTitle(c.t));
    if (!best || s > best.s) best = { r: c.r ?? c, s };
  }
  return best;
}
function artistScore(want, name) {
  const got = norm(name);
  if (!got) return 0;
  if (got === want.a) return 1;
  // "Clipse" vs "Clipse, Pusha T & Malice"; "Julien Baker & Torres" vs "Julien Baker"
  const gotParts = splitArtists(name);
  if (want.artists.some((x) => gotParts.includes(x))) return 0.9;
  if (got.includes(want.a) || want.a.includes(got)) return 0.8;
  return overlap(got, want.a);
}
function titleScore(want, got) {
  if (!got) return 0;
  if (got === want) return 1;
  if (got.replace(/ /g, '') === want.replace(/ /g, '')) return 0.95;
  if (got.startsWith(want) || want.startsWith(got)) return 0.8;
  return overlap(got, want);
}
function overlap(x, y) {
  const a = new Set(x.split(' ')); const b = new Set(y.split(' '));
  return [...a].filter((w) => b.has(w)).length / Math.max(a.size, b.size, 1) * 0.75;
}
function norm(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\$/g, 's').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}
// Titles also drop " - EP", " - Single", and trailing (…) or […], e.g. "(Deluxe Edition)".
function normTitle(s) {
  let t = String(s).replace(/\s+-\s+(ep|single)$/i, '');
  for (let i = 0; i < 2; i++) t = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
  return norm(t || s);
}
function splitArtists(s) {
  return String(s).split(/\s*(?:,|&|\band\b|\bwith\b|\bx\b|\bfeat\.?|\bft\.?|\+)\s*/i).map(norm).filter(Boolean);
}
function slugify(s) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

// ---------------------------------------------------------------------------

async function runDebug(artist, title) {
  console.log(`Album: ${artist} – ${title}\n`);
  try {
    const dz = await findDeezer(artist, title);
    console.log(dz.match ? `Deezer: found “${dz.match.artist?.name} – ${dz.match.title}” ${dz.match.link}` : `Deezer: ${dz.why}`);
    if (dz.match) {
      const ap = await appleByUpc(dz.match.id);
      console.log(ap ? `Apple by barcode: “${ap.artistName} – ${ap.collectionName}” ${ap.collectionViewUrl.replace(/\?.*$/, '')}\n  Listen: https://album.link/i/${ap.collectionId}` : 'Apple by barcode: no match');
    }
  } catch (e) { console.log(`Deezer: failed (${e.message})`); }
  try {
    const ap = await findApple(artist, title);
    console.log(ap.match ? `Apple search: found “${ap.match.artistName} – ${ap.match.collectionName}”` : `Apple search: ${ap.why}`);
  } catch (e) { console.log(`Apple search: failed (${e.message})`); }
  try {
    const bc = await findBandcamp(artist, title);
    console.log(bc.url ? `Bandcamp (via MusicBrainz): ${bc.url}` : `Bandcamp (via MusicBrainz): ${bc.why}`);
  } catch (e) { console.log(`MusicBrainz: failed (${e.message})`); }
}
