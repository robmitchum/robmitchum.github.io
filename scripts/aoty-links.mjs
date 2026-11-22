#!/usr/bin/env node
// Albums of the Year: find Listen / Buy links and covers for one year's albums.
//
//   npm run aoty:links -- 2025 --top 200     the Consensus top 200
//   npm run aoty:links -- 2025               every album
//   npm run aoty:links -- 2025 --redo        look up found albums again too (except locked ones)
//   npm run aoty:links -- 2025 --debug "Clipse - Let God Sort Em Out"
//                                            show what Apple and Bandcamp return for one album
//
// For each album:
//   - Apple (iTunes Search API) → Listen goes to its album.link page (album.link/i/<Apple id>,
//     which lists every streaming service), and the cover is saved at 300×300 to
//     public/aoty/covers/<year>/<slug>.jpg. Three searches, stopping at the first match:
//     artist + title; the title alone; the artist's albums.
//   - Bandcamp → Buy. Bandcamp's own search-box API first, then its search page. A best guess.
// Results go to src/data/aoty/links/<year>.json, keyed by "artist - title" in lower case.
// An album already found is skipped; one not found is tried again on the next run.
// Fix anything by hand there and add "locked": true so runs leave it alone; set
// "bandcamp": "" to hide a wrong Buy button. Albums still missing at the end are listed in
// src/data/aoty/links/<year>-missing.txt. Saved after every album: Ctrl-C and rerun is safe.
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
const debug = opt('--debug');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
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
let bandcampDown = 0;

for (const [i, a] of albums.entries()) {
  const key = `${a.artist} - ${a.title}`.toLowerCase();
  const entry = links[key] ?? {};
  if (entry.locked) continue;
  const needApple = redo || !entry.listen;
  const needBandcamp = redo || entry.bandcamp === undefined;
  if (!needApple && !needBandcamp) continue;
  const notes = [];

  if (needApple) {
    const { match, why } = await findApple(a.artist, a.title);
    if (match) {
      entry.apple = match.collectionViewUrl.replace(/\?.*$/, '');
      entry.listen = `https://album.link/i/${match.collectionId}`;
      const art = match.artworkUrl100?.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg');
      if (art) {
        const file = `${slugify(`${a.artist} ${a.title}`)}.jpg`;
        try {
          const res = await fetch(art);
          if (res.ok) { writeFileSync(resolve(coverDir, file), Buffer.from(await res.arrayBuffer())); entry.cover = `/aoty/covers/${year}/${file}`; }
        } catch { /* the cover is optional */ }
      }
      notes.push(`Apple: ${match.artistName} – ${match.collectionName}`);
    } else {
      notes.push(`Apple: not found (${why})`);
    }
  }

  if (needBandcamp && bandcampDown < 5) {
    const { url, why, down } = await findBandcamp(a.artist, a.title);
    if (url) { entry.bandcamp = url; notes.push('Bandcamp: found'); bandcampDown = 0; }
    else { notes.push(`Bandcamp: not found (${why})`); bandcampDown = down ? bandcampDown + 1 : 0; }
    if (bandcampDown === 5) console.warn('\n  Bandcamp failed 5 times in a row, so the rest of this run skips it. Run again later.\n');
  }

  links[key] = entry;
  save();
  looked++;
  console.log(`${String(i + 1).padStart(3)}  ${a.artist} – ${a.title}\n       ${notes.join(' · ')}`);
}
save();

const all = albums.map((a) => links[`${a.artist} - ${a.title}`.toLowerCase()] ?? {});
const missing = albums.filter((a, i) => !all[i].listen).map((a) => `${a.artist} - ${a.title}`);
writeFileSync(missingPath, missing.join('\n') + (missing.length ? '\n' : ''));
console.log(`\nLooked up ${looked} albums this run.`);
console.log(`Of these ${albums.length}: ${all.filter((e) => e.listen).length} have Listen links (Apple), ${all.filter((e) => e.bandcamp).length} have Buy links (Bandcamp).`);
if (missing.length) console.log(`The ${missing.length} without a Listen link are listed in ${missingPath}`);

// ---------------------------------------------------------------------------
// Apple

async function itunes(params) {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ media: 'music', entity: 'album', country: 'US', limit: '50', ...params })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(3200); // Apple allows about 20 searches a minute
    let res;
    try { res = await fetch(url, { headers: { 'user-agent': UA } }); } catch { await sleep(5000); continue; }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      const wait = 60000 * (attempt + 1);
      console.warn(`       Apple is rate-limiting (HTTP ${res.status}); waiting ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { return JSON.parse(await res.text()).results ?? []; } catch { return []; }
  }
  console.error('\nApple kept refusing searches. Progress is saved: wait 10 minutes and run the same command again.');
  save();
  process.exit(1);
}

async function findApple(artist, title) {
  const selfTitled = /^(s\/t|self[- ]titled)$/i.test(title.trim());
  const want = wanted(artist, selfTitled ? artist : title);
  const tries = [
    { term: `${artist} ${selfTitled ? '' : title}`.trim() },
    ...(selfTitled ? [] : [{ term: title, attribute: 'albumTerm' }]),
    { term: artist, attribute: 'artistTerm', limit: '200' },
  ];
  let seen = 0; let closest = null;
  for (const t of tries) {
    const results = await itunes(t);
    seen += results.length;
    const best = pickBest(want, results.map((r) => ({ r, a: r.artistName, t: r.collectionName })));
    if (best && best.s >= 1.5) return { match: best.r };
    if (best && (!closest || best.s > closest.s)) closest = best;
  }
  return { match: null, why: seen ? `closest: ${closest.r.artistName} – ${closest.r.collectionName}` : 'no results' };
}

// ---------------------------------------------------------------------------
// Bandcamp

async function findBandcamp(artist, title) {
  const selfTitled = /^(s\/t|self[- ]titled)$/i.test(title.trim());
  const want = wanted(artist, selfTitled ? artist : title);
  const q = `${artist} ${selfTitled ? '' : title}`.trim();
  let down = false; let why = 'no results';
  for (const search of [bandcampApi, bandcampPage]) {
    try {
      const results = await search(q);
      const best = pickBest(want, results);
      if (best && best.s >= 1.6) return { url: best.r.url };
      if (best) why = `closest: ${best.r.a} – ${best.r.t}`;
      down = false;
    } catch (e) { why = e.message; down = true; }
  }
  return { url: null, why, down };
}

// The JSON search Bandcamp's own search box uses.
async function bandcampApi(q) {
  await sleep(1200);
  const res = await fetch('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, origin: 'https://bandcamp.com', referer: 'https://bandcamp.com/' },
    body: JSON.stringify({ search_text: q, search_filter: 'a', full_page: false, fan_id: null }),
  });
  if (!res.ok) throw new Error(`Bandcamp API HTTP ${res.status}`);
  const json = await res.json();
  const results = json?.auto?.results ?? json?.results ?? [];
  return results.filter((r) => !r.type || r.type === 'a').map((r) => ({
    a: r.band_name ?? r.artist_name ?? '',
    t: r.name ?? r.title ?? '',
    url: String(r.item_url_path ?? r.url ?? '').replace(/\?.*$/, ''),
  })).filter((r) => r.url.startsWith('http'));
}

// Fallback: the search results page.
async function bandcampPage(q) {
  await sleep(1200);
  const res = await fetch(`https://bandcamp.com/search?${new URLSearchParams({ q, item_type: 'a' })}`, { headers: { 'user-agent': UA, 'accept-language': 'en-US' } });
  if (!res.ok) throw new Error(`Bandcamp page HTTP ${res.status}`);
  const html = await res.text();
  const out = [];
  for (const item of html.split(/<li class="searchresult/).slice(1)) {
    const head = item.match(/class="heading">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const sub = item.match(/class="subhead">([\s\S]*?)<\/div>/);
    if (head && sub) out.push({ url: decode(head[1]).replace(/\?.*$/, ''), t: decode(strip(head[2])), a: decode(strip(sub[1])).replace(/^\s*by\s+/i, '') });
  }
  return out;
}

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
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
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
function strip(s) { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function slugify(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

// ---------------------------------------------------------------------------

async function runDebug(artist, title) {
  console.log(`Album: ${artist} – ${title}\n`);
  const want = wanted(artist, title);
  for (const t of [{ term: `${artist} ${title}` }, { term: title, attribute: 'albumTerm' }, { term: artist, attribute: 'artistTerm', limit: '200' }]) {
    const results = await itunes(t);
    console.log(`Apple search ${JSON.stringify(t)}: ${results.length} results`);
    for (const r of results.slice(0, 8)) {
      const s = artistScore(want, r.artistName) + titleScore(want.t, normTitle(r.collectionName));
      console.log(`   ${s.toFixed(2)}  ${r.artistName} – ${r.collectionName}  (${r.collectionId})`);
    }
  }
  for (const [name, fn] of [['Bandcamp API', bandcampApi], ['Bandcamp page', bandcampPage]]) {
    try {
      const results = await fn(`${artist} ${title}`);
      console.log(`${name}: ${results.length} results`);
      for (const r of results.slice(0, 8)) {
        const s = artistScore(want, r.a) + titleScore(want.t, normTitle(r.t));
        console.log(`   ${s.toFixed(2)}  ${r.a} – ${r.t}  ${r.url}`);
      }
    } catch (e) { console.log(`${name}: failed (${e.message})`); }
  }
  console.log('\nA score of 1.5 or more counts as a match for Apple, 1.6 for Bandcamp.');
}
