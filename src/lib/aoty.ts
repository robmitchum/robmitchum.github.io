// Albums of the Year: everything the chart pages show is computed here from the raw
// placements in src/data/aoty/<year>.json (written by scripts/export-aoty.mjs).
// Methodology (old aotysheets.html): Consensus Score = average position over every list,
// counting 75 for each list an album missed. Lower is better.
import { z } from 'astro/zod';

const yearFiles = import.meta.glob('../data/aoty/[0-9][0-9][0-9][0-9].json', { eager: true, import: 'default' });
const pubFiles = import.meta.glob('../data/aoty/publications/*.json', { eager: true, import: 'default' });
const linkFiles = import.meta.glob('../data/aoty/links/*.json', { eager: true, import: 'default' });
import yearsIndex from '../data/aoty/years.json';

export const MISS = 75;
export const CHART_SIZE = 200;
export const SLEEPER_MIN = 3;
export const SLEEPER_MAX = 8;
export const SLEEPERS_SHOWN = 25;
export const SLEEPER_TAGGED = 10;

const YearMeta = z.object({
  year: z.number(),
  sheetId: z.string(),
  tab: z.string(),
  lists: z.number(),
  no1: z.tuple([z.string(), z.string()]),
  no1Apple: z.string().optional(), // Apple Music id, for scripts/aoty-no1-covers.mjs
  no1Cover: z.string().optional(), // saved by that script
  status: z.enum(['final', 'live']).optional(),
  // 2025 only: the "Last update" column replays the lists in sheet order and shows the
  // standings before the last N were added. Years with real dates per list don't need it.
  replayLast: z.number().optional(),
  extras: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
});
export type YearMeta = z.infer<typeof YearMeta>;

const Pub = z.object({ abbr: z.string(), name: z.string(), url: z.string().url().optional(), short: z.string().optional(), added: z.string().optional() });
const YearData = z.object({
  year: z.number(),
  pubs: z.array(z.string()),
  linkColumns: z.boolean().optional(),
  albums: z.array(z.object({ artist: z.string(), title: z.string(), ranks: z.array(z.number().nullable()),
    listen: z.string().url().optional(), buy: z.string().url().optional(), cover: z.string().url().optional() })),
});
const Link = z.object({
  apple: z.string().optional(),
  listen: z.string().optional(),
  bandcamp: z.string().optional(),
  cover: z.string().optional(),
  locked: z.boolean().optional(),
});
export type Links = z.infer<typeof Link>;

export const years: YearMeta[] = z.array(YearMeta).parse(yearsIndex).sort((a, b) => b.year - a.year);

export function sheetUrl(y: YearMeta) {
  return `https://docs.google.com/spreadsheets/d/${y.sheetId}/edit?usp=sharing`;
}

export interface Placement { pub: number; rank: number }
export interface Album {
  key: string; // "artist - title", lower case: the links file's key
  slug: string;
  artist: string;
  title: string;
  placements: Placement[]; // in sheet (list) order
  lists: number;
  top10s: number;
  no1s: number;
  score: number;
  avg: number; // average position on the lists that picked it
  pos: number; // Consensus position, 1 = best, among every album that year
  prev: number | null; // position at the last update (null = not charted then)
  best: Placement;
  sleeper: number; // Sleepers position, 0 if not a sleeper
  solo: boolean;
  links: Links;
}
export interface Publication {
  abbr: string;
  name: string;
  url?: string;
  idx: number;
  size: number; // albums on the list
  avgPos: number; // average Consensus position of its albums (higher = more unique)
  solo: number;
  outlier: number; // Outliers position
  top: { rank: number; album: Album }[];
}
export interface Year {
  meta: YearMeta;
  pubs: Publication[];
  albums: Album[]; // Consensus order
  sleepers: Album[];
  outliers: Publication[];
  gainer: Album | null;
  prevLabel: string | null;
}

export function slugify(s: string) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function scoreOf(ranks: (number | null)[], upto = ranks.length) {
  let sum = 0;
  for (let i = 0; i < upto; i++) sum += ranks[i] ?? MISS;
  return sum / upto;
}

// Consensus order: score, then more lists, then more top 10s, then alphabetical.
function rankOrder<T extends { score: number; lists: number; top10s: number; artist: string; title: string }>(a: T, b: T) {
  return a.score - b.score || b.lists - a.lists || b.top10s - a.top10s
    || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title);
}

const cache = new Map<number, Year>();

export function hasChart(year: number) {
  return !!yearFiles[`../data/aoty/${year}.json`];
}

export function loadYear(year: number): Year {
  const hit = cache.get(year);
  if (hit) return hit;
  const meta = years.find((y) => y.year === year);
  if (!meta) throw new Error(`AOTY: ${year} is not in years.json`);
  const data = YearData.parse(yearFiles[`../data/aoty/${year}.json`]);
  const pubList = z.array(Pub).parse(pubFiles[`../data/aoty/publications/${year}.json`]);
  const links = z.record(z.string(), Link).parse(linkFiles[`../data/aoty/links/${year}.json`] ?? {});
  const pubMeta = data.pubs.map((abbr) => {
    const p = pubList.find((x) => x.abbr === abbr);
    if (!p) throw new Error(`AOTY ${year}: no publication entry for ${abbr}`);
    return p;
  });
  const n = data.pubs.length;
  for (const a of data.albums) {
    if (a.ranks.length !== n) throw new Error(`AOTY ${year}: ${a.artist} - ${a.title} has ${a.ranks.length} ranks, expected ${n}`);
  }

  const slugs = new Set<string>();
  const albums: Album[] = data.albums.map((a) => {
    const placements = a.ranks.flatMap((rank, pub) => (rank === null ? [] : [{ pub, rank }]));
    const key = `${a.artist} - ${a.title}`.toLowerCase();
    let slug = slugify(`${a.artist} ${a.title}`);
    while (slugs.has(slug)) slug += '-2';
    slugs.add(slug);
    const best = placements.reduce((m, p) => (p.rank < m.rank ? p : m), placements[0]);
    return {
      key, slug, artist: a.artist, title: a.title, placements,
      lists: placements.length,
      top10s: placements.filter((p) => p.rank <= 10).length,
      no1s: placements.filter((p) => p.rank === 1).length,
      score: scoreOf(a.ranks),
      avg: placements.reduce((s, p) => s + p.rank, 0) / placements.length,
      pos: 0, prev: null, best, sleeper: 0, solo: placements.length === 1,
      // Links typed into the sheet's LISTEN / BUY columns win over the links file.
      links: { ...(links[key] ?? {}), ...(a.listen ? { listen: a.listen } : {}), ...(a.buy ? { bandcamp: a.buy } : {}) },
    };
  });
  albums.sort(rankOrder);
  albums.forEach((a, i) => { a.pos = i + 1; });

  // Last update. Lists with an "added" date: standings before the newest date. Otherwise
  // (2025) replay the sheet order and hold back the last `replayLast` lists.
  let upto = 0;
  let prevLabel: string | null = null;
  const dates = pubMeta.map((p) => p.added).filter(Boolean) as string[];
  if (dates.length === n) {
    const latest = dates.sort().at(-1)!;
    const keep = pubMeta.map((p) => p.added! < latest);
    if (keep.some(Boolean)) {
      const idx = keep.flatMap((k, i) => (k ? [i] : []));
      const prevRows = data.albums.map((a, i) => ({ i, ranks: idx.map((j) => a.ranks[j]) }));
      applyPrev(albums, data, prevRows.map((r) => r.ranks), idx.length);
      prevLabel = `before ${latest}`;
    }
  } else if (meta.replayLast && meta.replayLast < n) {
    upto = n - meta.replayLast;
    applyPrev(albums, data, data.albums.map((a) => a.ranks.slice(0, upto)), upto);
    prevLabel = `after ${upto} of ${n} lists`;
  }

  const gainer = albums.slice(0, CHART_SIZE)
    .filter((a) => a.prev !== null && a.prev <= CHART_SIZE && a.prev - a.pos > 0)
    .sort((a, b) => (b.prev! - b.pos) - (a.prev! - a.pos) || a.pos - b.pos)[0] ?? null;

  const sleepers = albums
    .filter((a) => a.lists >= SLEEPER_MIN && a.lists <= SLEEPER_MAX)
    .sort((a, b) => a.avg - b.avg || b.lists - a.lists || a.pos - b.pos)
    .slice(0, SLEEPERS_SHOWN);
  sleepers.forEach((a, i) => { a.sleeper = i + 1; });

  const pubs: Publication[] = pubMeta.map((p, idx) => {
    const on = albums.filter((a) => a.placements.some((x) => x.pub === idx));
    const top = on.map((album) => ({ rank: album.placements.find((x) => x.pub === idx)!.rank, album }))
      .sort((a, b) => a.rank - b.rank || a.album.pos - b.album.pos);
    return {
      abbr: p.abbr, name: p.short ?? p.name, url: p.url, idx,
      size: on.length,
      avgPos: on.reduce((s, a) => s + a.pos, 0) / on.length,
      solo: on.filter((a) => a.solo).length,
      outlier: 0,
      top: top.slice(0, 10),
    };
  });
  const outliers = [...pubs].sort((a, b) => b.avgPos - a.avgPos);
  outliers.forEach((p, i) => { p.outlier = i + 1; });

  const y: Year = { meta, pubs, albums, sleepers, outliers, gainer, prevLabel };
  cache.set(year, y);
  return y;
}

function applyPrev(albums: Album[], data: z.infer<typeof YearData>, prevRanks: (number | null)[][], m: number) {
  const byKey = new Map(albums.map((a) => [`${a.artist} - ${a.title}`.toLowerCase(), a]));
  const prev = data.albums.map((a, i) => {
    const ranks = prevRanks[i];
    const placed = ranks.filter((r) => r !== null);
    return {
      album: byKey.get(`${a.artist} - ${a.title}`.toLowerCase())!,
      artist: a.artist, title: a.title,
      score: scoreOf(ranks, m), lists: placed.length,
      top10s: placed.filter((r) => r! <= 10).length,
    };
  }).filter((p) => p.lists > 0);
  prev.sort(rankOrder);
  prev.forEach((p, i) => { p.album.prev = i + 1; });
}

// Listen: an album.link page (every streaming service) when we know the Apple Music album,
// any other link as given, else an Apple Music search.
export function listenUrl(a: Album) {
  const link = a.links.listen || a.links.apple;
  const appleId = link?.match(/music\.apple\.com\/.*?\/(\d{6,})(?:[?#]|$)/)?.[1];
  if (appleId) return `https://album.link/i/${appleId}`;
  return link || `https://music.apple.com/us/search?term=${encodeURIComponent(`${a.artist} ${a.title}`)}`;
}
// Buy: the sheet's BUY link (usually Bandcamp); otherwise a search at Amoeba Music,
// an independent record store, so every album has somewhere to buy it.
export function buyUrl(a: Album) {
  return a.links.bandcamp || `https://www.amoeba.com/search/all/?s=${encodeURIComponent(`${a.artist} ${a.title}`).replace(/%20/g, '+')}`;
}
// The store's name, for screen-reader labels ("Buy X on Bandcamp").
export function buyStore(url: string) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (host.endsWith('bandcamp.com')) return 'Bandcamp';
  if (host.endsWith('amoeba.com')) return 'Amoeba Music';
  return host || 'the store';
}

export const fmt1 = (x: number) => x.toFixed(1);

// Hub page text from src/data/aoty/hub.md ("## Heading" sections). Blank → placeholder.
import hubMd from '../data/aoty/hub.md?raw';
export type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] };
const hub = new Map<string, Block[]>();
for (const part of hubMd.replace(/<!--[\s\S]*?-->/g, '').split(/^## +/m).slice(1)) {
  const nl = part.indexOf('\n');
  const head = (nl < 0 ? part : part.slice(0, nl)).trim().toLowerCase();
  const body = nl < 0 ? '' : part.slice(nl + 1).trim();
  if (!body) continue;
  hub.set(head, body.split(/\n\s*\n/).map((chunk): Block => {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.every((l) => l.startsWith('- '))
      ? { kind: 'ul', items: lines.map((l) => l.slice(2)) }
      : { kind: 'p', text: lines.join(' ') };
  }));
}
export const hubText = (key: string) => hub.get(key.toLowerCase());

// Inline formatting for hub.md text: [label](https://…) links and *italics*. Returns HTML;
// everything else is escaped.
export function inline(text: string) {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, (_, label, url) => {
      const external = /^https?:/.test(url);
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
    })
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
}
