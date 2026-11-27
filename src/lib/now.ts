// Homepage "Lately" boxes: what Rob is listening to, reading and watching.
// Listening comes from the Listening Diary (src/data/diary/<year>.json, npm run diary);
// reading from the Reading Diary (src/data/now/reading.json, npm run reading);
// watching from Letterboxd (src/data/now/watching.json, npm run watching).
// The nightly build refreshes all three.
import reading from '../data/now/reading.json';
import watching from '../data/now/watching.json';
import { diaryYears, loadDiary, FORMAT_NAMES } from './diary';

export const LISTENING_COUNT = 5;
export const WATCHING_COUNT = 5;

export interface Book { title: string; author: string; started: string | null; isbn: string | null }
export interface Film { title: string; year: number | null; watched: string; rewatch: boolean; liked: boolean; rating: number | null; url: string | null }

// Newest first. Within a day the sheet is in listening order, so the last row is the latest.
export function recentListening(n = LISTENING_COUNT) {
  const d = loadDiary(diaryYears[0]);
  return d.entries.slice(-n).reverse().map((e) => ({
    ...e,
    format: e.format ? FORMAT_NAMES[e.format] ?? e.format : null,
  }));
}

export const currentBooks = (): Book[] => reading.books;
export const recentFilms = (n = WATCHING_COUNT): Film[] => (watching.films as Film[]).slice(0, n);
export const letterboxdDiary = watching.profile;
