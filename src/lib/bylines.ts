// Bylines data: written by `npm run bylines` from the clips Sheet (see scripts/export-bylines.mjs).
// Validated here so a bad export fails the build instead of shipping.
import { z } from 'astro/zod';
import musicJson from '../data/bylines/music.json';
import scienceJson from '../data/bylines/science.json';
import newsJson from '../data/bylines/news.json';
import podcastsJson from '../data/bylines/podcasts.json';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const byline = z.object({
  title: z.string().min(1),
  outlet: z.string().min(1),
  date: isoDate,
  format: z.string().min(1),
  url: z.string().url().nullable(),
  accolade: z.string().optional(),
  featured: z.boolean().optional(),
  artist: z.string().optional(),
  work: z.string().optional(),
  show: z.string().optional(),
  role: z.enum(['Co-host', 'Editor', 'Guest']).optional(),
});
const show = z.object({
  show: z.string(),
  title: z.string(),
  url: z.string().url().nullable(),
  role: z.enum(['Co-host', 'Editor', 'Guest']),
  outlet: z.string(),
  since: isoDate,
  intro: z.string().optional(),
});

export type Byline = z.infer<typeof byline> & { section: SectionId };
export type Show = z.infer<typeof show>;
export type SectionId = 'music' | 'science' | 'news' | 'podcasts';

const tag = (section: SectionId) => (b: z.infer<typeof byline>): Byline => ({ ...b, section });
const podcastData = z.object({ shows: z.array(show), episodes: z.array(byline) }).parse(podcastsJson);

export const bylines: Record<SectionId, Byline[]> = {
  music: z.array(byline).parse(musicJson).map(tag('music')),
  science: z.array(byline).parse(scienceJson).map(tag('science')),
  news: z.array(byline).parse(newsJson).map(tag('news')),
  podcasts: podcastData.episodes.map(tag('podcasts')),
};
export const showHeaders = podcastData.shows;

export const allBylines = (): Byline[] =>
  Object.values(bylines).flat().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export interface SectionInfo {
  id: SectionId;
  label: string;
  color: string;      // fills, lanes, pods
  text: string;       // headings and text on paper
  light: string;      // second shade for Lanes icons
  podText: string;    // text color on a pod of this color
}

export const SECTIONS: SectionInfo[] = [
  { id: 'music', label: 'Music', color: 'var(--music)', text: 'var(--music)', light: 'var(--music-light)', podText: '#fff' },
  { id: 'science', label: 'Science', color: 'var(--science)', text: 'var(--science-text)', light: 'var(--science-light)', podText: 'var(--ink)' },
  { id: 'news', label: 'News', color: 'var(--news)', text: 'var(--news-text)', light: 'var(--news-light)', podText: '#fff' },
  { id: 'podcasts', label: 'Podcasts', color: 'var(--podcasts)', text: 'var(--podcasts-text)', light: 'var(--podcasts-light)', podText: 'var(--ink)' },
];
export const sectionInfo = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const fmtIso = (iso: string) =>
  d(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const year = (iso: string) => iso.slice(0, 4);

// "36 From the Vault: Dick's Picks Vol. 1 — …" → "Dick's Picks Vol. 1 — …" inside its own show's list.
export const episodeTitle = (b: Byline) =>
  b.show && b.title.startsWith(`${b.show}: `) ? b.title.slice(b.show.length + 2) : b.title;

export function countBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function yearSpan(items: Byline[]) {
  const ys = items.map((b) => year(b.date)).sort();
  return ys.length ? (ys[0] === ys.at(-1) ? ys[0] : `${ys[0]}–${ys.at(-1)}`) : '';
}

// Rob's own shows, in his order (2026-11-21): co-hosted first, then edited.
const SHOW_ORDER = ['36 From the Vault', '36FTVQ', 'Insight Unpacked', 'The Insightful Leader'];
const ROLE_RANK = { 'Co-host': 0, Editor: 1, Guest: 2 } as const;
const showRank = (s: string) => (SHOW_ORDER.includes(s) ? SHOW_ORDER.indexOf(s) : SHOW_ORDER.length);
export const ownShows = (): Show[] => [...showHeaders].sort((a, b) =>
  ROLE_RANK[a.role] - ROLE_RANK[b.role] || showRank(a.show) - showRank(b.show) || a.since.localeCompare(b.since));
