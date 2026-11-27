#!/usr/bin/env node
// Letterboxd diary: Rob's latest watches → src/data/now/watching.json (homepage "What I'm watching").
//
//   npm run watching -- --download        fetch https://letterboxd.com/robmitchum/rss/
//   npm run watching -- path/to/feed.xml  use a saved copy of the feed
//   add --soft                            on a failed download, keep the saved file and exit 0
//
// Keeps diary entries only (items with a watched date), newest first, up to KEEP.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = 'robmitchum';
const KEEP = 10;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/data/now');
const args = process.argv.slice(2);
const soft = args.includes('--soft');
const source = args.find((a) => a !== '--soft');
if (!source) fail('Usage: npm run watching -- --download | <feed.xml> [--soft]', true);

let xml;
if (source === '--download') {
  console.log('Downloading the Letterboxd feed…');
  try {
    const res = await fetch(`https://letterboxd.com/${USER}/rss/`, { headers: { 'User-Agent': 'robmitchum.com site build' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
    if (!xml.includes('<rss')) throw new Error('got something other than an RSS feed');
  } catch (e) {
    fail(`Download failed: ${e.message}`);
  }
} else {
  xml = readFileSync(source, 'utf8');
}

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? decode(m[1].trim()) : null;
};
const films = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
  .map(([, b]) => ({
    title: tag(b, 'letterboxd:filmTitle'),
    year: Number(tag(b, 'letterboxd:filmYear')) || null,
    watched: tag(b, 'letterboxd:watchedDate'),
    rewatch: tag(b, 'letterboxd:rewatch') === 'Yes',
    liked: tag(b, 'letterboxd:memberLike') === 'Yes',
    rating: Number(tag(b, 'letterboxd:memberRating')) || null,
    url: tag(b, 'link'),
  }))
  .filter((f) => f.title && /^\d{4}-\d{2}-\d{2}$/.test(f.watched ?? ''))
  .sort((a, b) => b.watched.localeCompare(a.watched))
  .slice(0, KEEP);
if (!films.length) fail('No diary entries found in the feed.');

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'watching.json'), JSON.stringify({ fetched: new Date().toISOString(), profile: `https://letterboxd.com/${USER}/diary/`, films }, null, 2) + '\n');
console.log(`Wrote ${films.length} films (latest ${films[0].watched}) to src/data/now/watching.json`);

function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function fail(msg, hard = false) {
  console.error(msg);
  if (soft && !hard) {
    console.warn('Keeping the saved watching data.');
    process.exit(0);
  }
  process.exit(1);
}
