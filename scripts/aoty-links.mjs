#!/usr/bin/env node
// Albums of the Year: find Listen / Buy links and covers for one year's albums.
//
//   npm run aoty:links -- 2025              every album not looked up yet (slow: ~45 min for 600)
//   npm run aoty:links -- 2025 --top 200    only the Consensus top 200
//   npm run aoty:links -- 2025 --redo       look everything up again (except locked entries)
//
// For each album:
//   - Apple's iTunes Search API finds the album → Listen goes to its album.link page
//     (album.link/i/<Apple id>, which lists every streaming service), and the cover art
//     is saved to public/aoty/covers/<year>/<slug>.jpg.
//   - Bandcamp's site search is checked for the same artist and title → Buy. A best guess.
// Results go to src/data/aoty/links/<year>.json, keyed by "artist - title" in lower case.
// Correct anything by hand there and add "locked": true so later runs leave it alone.
// Set "bandcamp": "" (empty) to hide a wrong Buy button. The file is saved after every
// album, so you can stop with Ctrl-C and run it again to pick up where it left off.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const year = Number(args[0]);
if (!year) { console.error('Usage: npm run aoty:links -- <year> [--top N] [--redo]'); process.exit(1); }
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : Infinity;
const redo = args.includes('--redo');

const data = JSON.parse(readFileSync(resolve(root, `src/data/aoty/${year}.json`), 'utf8'));
const linksPath = resolve(root, `src/data/aoty/links/${year}.json`);
const links = existsSync(linksPath) ? JSON.parse(readFileSync(linksPath, 'utf8')) : {};
const coverDir = resolve(root, `public/aoty/covers/${year}`);
mkdirSync(coverDir, { recursive: true });

// Consensus order (same rule as src/lib/aoty.ts), so --top takes the chart's top N.
const n = data.pubs.length;
const albums = data.albums.map((a) => {
  const placed = a.ranks.filter((r) => r !== null);
  return { ...a, score: a.ranks.reduce((s, r) => s + (r ?? 75), 0) / n, lists: placed.length, top10s: placed.filter((r) => r <= 10).length };
}).sort((a, b) => a.score - b.score || b.lists - a.lists || b.top10s - a.top10s || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
  .slice(0, top);

const save = () => writeFileSync(linksPath, JSON.stringify(sortKeys(links), null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0; let found = 0; let buy = 0;

for (const a of albums) {
  const key = `${a.artist} - ${a.title}`.toLowerCase();
  const old = links[key];
  if (old?.locked || (old && !redo)) continue;
  const entry = {};
  try {
    const apple = await itunes(a.artist, a.title);
    if (apple) {
      entry.apple = apple.collectionViewUrl.replace(/\?.*$/, '');
      entry.listen = `https://album.link/i/${apple.collectionId}`;
      const art = apple.artworkUrl100?.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.jpg');
      if (art) {
        const file = `${slugify(`${a.artist} ${a.title}`)}.jpg`;
        const res = await fetch(art);
        if (res.ok) {
          writeFileSync(resolve(coverDir, file), Buffer.from(await res.arrayBuffer()));
          entry.cover = `/aoty/covers/${year}/${file}`;
        }
      }
      found++;
    }
  } catch (e) { console.warn(`  Apple lookup failed for ${key}: ${e.message}`); }
  try {
    const bc = await bandcamp(a.artist, a.title);
    if (bc) { entry.bandcamp = bc; buy++; }
  } catch (e) { console.warn(`  Bandcamp lookup failed for ${key}: ${e.message}`); }
  links[key] = entry;
  save();
  done++;
  console.log(`${String(done).padStart(3)}  ${a.artist} – ${a.title}: ${entry.listen ? 'Listen' : 'no Apple match'}${entry.bandcamp ? ' + Buy' : ''}`);
  await sleep(3200); // iTunes allows about 20 requests a minute
}
save();
console.log(`\nLooked up ${done} albums: ${found} found on Apple Music, ${buy} on Bandcamp. Saved ${linksPath}`);

// ---------------------------------------------------------------------------

async function itunes(artist, title) {
  const term = `${artist} ${title.replace(/^S\/T$/i, '')}`.trim();
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'album', country: 'US', limit: '10' })}`;
  let res = await fetch(url);
  if (res.status === 403 || res.status === 429) { await sleep(60000); res = await fetch(url); }
  if (!res.ok) throw new Error(`iTunes ${res.status}`);
  const { results = [] } = await res.json();
  const want = { a: norm(artist), t: norm(title) };
  const scored = results.map((r) => ({ r, s: matchScore(want, norm(r.artistName), norm(r.collectionName)) }))
    .filter((x) => x.s >= 1.4)
    .sort((x, y) => y.s - x.s);
  return scored[0]?.r ?? null;
}

async function bandcamp(artist, title) {
  const q = `${artist} ${title.replace(/^S\/T$/i, '')}`.trim();
  const res = await fetch(`https://bandcamp.com/search?${new URLSearchParams({ q, item_type: 'a' })}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (robmitchum.com album-link lookup)' },
  });
  if (!res.ok) throw new Error(`Bandcamp ${res.status}`);
  const html = await res.text();
  const want = { a: norm(artist), t: norm(title) };
  // Each result: <div class="heading"><a href="…">Title</a></div> … <div class="subhead"> by Artist </div>
  const items = html.split(/<li class="searchresult/).slice(1);
  for (const item of items) {
    const head = item.match(/class="heading">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const sub = item.match(/class="subhead">([\s\S]*?)<\/div>/);
    if (!head || !sub) continue;
    const t = norm(decode(strip(head[2])));
    const by = norm(decode(strip(sub[1])).replace(/^\s*by\s+/i, ''));
    if (matchScore(want, by, t) >= 1.6) return head[1].replace(/\?.*$/, '').replace(/&amp;/g, '&');
  }
  return null;
}

// 2 = artist and title both match. Titles may carry "(Deluxe)" etc., so containment counts.
function matchScore(want, a, t) {
  const sa = a === want.a ? 1 : (a.includes(want.a) || want.a.includes(a)) && a && want.a ? 0.8 : overlap(a, want.a);
  const st = t === want.t ? 1 : (want.t && (t.startsWith(want.t) || want.t.startsWith(t)) && t) ? 0.8 : overlap(t, want.t);
  return sa + st;
}
function overlap(x, y) {
  const a = new Set(x.split(' ')); const b = new Set(y.split(' '));
  const common = [...a].filter((w) => b.has(w)).length;
  return common / Math.max(a.size, b.size, 1) * 0.7;
}
function norm(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([](deluxe|expanded|remaster|bonus|explicit)[^)\]]*[)\]]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}
function strip(s) { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function slugify(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function sortKeys(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }
