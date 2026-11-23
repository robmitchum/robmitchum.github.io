#!/usr/bin/env node
// Albums of the Year: cover art for each year's No. 1 (the hub's "Every year" cards).
//
//   npm run aoty:no1            every year that doesn't have a No. 1 cover yet
//   npm run aoty:no1 -- --redo  all years again
//
// For each year in src/data/aoty/years.json: Apple's lookup by "no1Apple" (an Apple Music
// album id, for albums the searches get wrong), else Deezer's search, else Apple's search.
// The cover is saved at 300×300 to public/aoty/covers/no1/<year>.jpg and recorded in
// years.json as "no1Cover". To fix a wrong cover, add "no1Apple" for that year (the number
// at the end of the album's Apple Music address) and run with --redo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const redo = process.argv.includes('--redo');
const yearsPath = resolve(root, 'src/data/aoty/years.json');
const years = JSON.parse(readFileSync(yearsPath, 'utf8'));
const dir = resolve(root, 'public/aoty/covers/no1');
mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'robmitchum.com-aoty/1.0 ( https://robmitchum.com )';

const missed = [];
for (const y of years) {
  if (y.no1Cover && !redo) continue;
  const [artist, title] = y.no1;
  let art = null; let from = '';
  try {
    if (y.no1Apple) {
      const r = (await getJson(`https://itunes.apple.com/lookup?id=${y.no1Apple}&entity=album&country=US`, 3200))?.results?.[0];
      if (r?.artworkUrl100) { art = r.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg'); from = `Apple: ${r.artistName} – ${r.collectionName}`; }
    }
    if (!art) {
      const want = wanted(artist, title);
      for (const q of [`artist:"${artist}" album:"${title}"`, `${artist} ${title}`]) {
        const results = (await getJson(`https://api.deezer.com/search/album?${new URLSearchParams({ q, limit: '25' })}`, 250))?.data ?? [];
        const best = pickBest(want, results.map((r) => ({ r, a: r.artist?.name ?? '', t: r.title ?? '' })));
        if (best && best.s >= 1.5) {
          art = best.r.md5_image ? `https://e-cdns-images.dzcdn.net/images/cover/${best.r.md5_image}/300x300-000000-80-0-0.jpg` : best.r.cover_medium;
          from = `Deezer: ${best.r.artist?.name} – ${best.r.title}`;
          break;
        }
      }
    }
    if (!art) {
      const want = wanted(artist, title);
      const results = (await getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term: `${artist} ${title}`, media: 'music', entity: 'album', country: 'US', limit: '25' })}`, 3200))?.results ?? [];
      const best = pickBest(want, results.map((r) => ({ r, a: r.artistName, t: r.collectionName })));
      if (best && best.s >= 1.5) { art = best.r.artworkUrl100?.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg'); from = `Apple: ${best.r.artistName} – ${best.r.collectionName}`; }
    }
  } catch (e) { console.warn(`  ${y.year}: lookup failed (${e.message})`); }

  if (art) {
    const res = await fetch(art);
    if (res.ok) {
      writeFileSync(resolve(dir, `${y.year}.jpg`), Buffer.from(await res.arrayBuffer()));
      y.no1Cover = `/aoty/covers/no1/${y.year}.jpg`;
      console.log(`${y.year}  ${artist} – ${title}: saved (${from})`);
      continue;
    }
  }
  missed.push(y.year);
  console.log(`${y.year}  ${artist} – ${title}: not found`);
}
writeFileSync(yearsPath, JSON.stringify(years, null, 2) + '\n');
console.log(missed.length
  ? `\nNo cover for ${missed.join(', ')}. Add "no1Apple" (the album's Apple Music id) for those years in years.json and run again.`
  : '\nDone. Covers are in public/aoty/covers/no1/.');

async function getJson(url, pause) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(pause);
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.status === 403 || res.status === 429 || res.status >= 500) { await sleep(20000 * (attempt + 1)); continue; }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

// Matching (same rules as the links scripts): up to 1 point for the artist, 1 for the title.
function wanted(artist, title) { return { a: norm(artist), t: normTitle(title), artists: splitArtists(artist) }; }
function pickBest(want, cands) {
  let best = null;
  for (const c of cands) {
    const s = artistScore(want, c.a) + titleScore(want.t, normTitle(c.t));
    if (!best || s > best.s) best = { r: c.r, s };
  }
  return best;
}
function artistScore(want, name) {
  const got = norm(name);
  if (!got) return 0;
  if (got === want.a) return 1;
  if (want.artists.some((x) => splitArtists(name).includes(x))) return 0.9;
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
function normTitle(s) {
  let t = String(s).replace(/\s+-\s+(ep|single)$/i, '');
  for (let i = 0; i < 2; i++) t = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
  return norm(t || s);
}
function splitArtists(s) {
  return String(s).split(/\s*(?:,|&|\band\b|\bwith\b|\bx\b|\bfeat\.?|\bft\.?|\+)\s*/i).map(norm).filter(Boolean);
}
