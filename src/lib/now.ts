// Homepage "Lately" boxes: what Rob is listening to, reading and watching.
// Listening comes from the Listening Diary (src/data/diary/<year>.json, npm run diary);
// reading from the Reading Diary (src/data/now/reading.json, npm run reading);
// watching from Letterboxd (src/data/now/watching.json, npm run watching);
// album and book covers from src/data/now/covers.json (npm run covers).
// The nightly build refreshes all of them.
import reading from '../data/now/reading.json';
import watching from '../data/now/watching.json';
import covers from '../data/now/covers.json';
import { diaryYears, loadDiary } from './diary';

export const SHOWN = 3; // items per box; keep in step with scripts/now-covers.mjs

export interface Book { title: string; author: string; started: string | null; isbn: string | null }
export interface Film { title: string; year: number | null; watched: string; rewatch: boolean; liked: boolean; rating: number | null; url: string | null; poster?: string | null }

const coverMap = covers as Record<string, { url?: string } | null>;
// Same keys as scripts/now-covers.mjs
const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const albumCover = (artist: string, album: string) => coverMap[`album:${norm(artist)}|${norm(album)}`]?.url ?? null;
const bookCover = (b: Book) => coverMap[`book:${b.isbn || `${norm(b.title)}|${norm(b.author)}`}`]?.url ?? null;

// Newest first. Within a day the sheet is in listening order, so the last row is the latest.
export function recentListening(n = SHOWN) {
  const d = loadDiary(diaryYears[0]);
  return d.entries.slice(-n).reverse().map((e) => ({ ...e, cover: albumCover(e.artist, e.album) }));
}

export const currentBooks = (n = SHOWN) => (reading.books as Book[]).slice(0, n).map((b) => ({ ...b, cover: bookCover(b) }));
export const recentFilms = (n = SHOWN) => (watching.films as Film[]).slice(0, n);
export const letterboxdDiary = watching.profile;
