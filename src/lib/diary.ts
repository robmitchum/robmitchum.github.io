// Listening Diary data and stats. Source: src/data/diary/<year>.json (npm run diary).
import years from '../data/diary/years.json';

export interface Entry { date: string; artist: string; album: string; year: number | null; type: string }
export interface DiaryYear { year: number; fetched: string; entries: Entry[] }

const files = import.meta.glob<{ default: DiaryYear }>('../data/diary/2*.json', { eager: true });
export const diaryYears = years.map((y) => y.year).filter((y) => files[`../data/diary/${y}.json`]).sort((a, b) => b - a);
export const loadDiary = (year: number) => files[`../data/diary/${year}.json`].default;
export const sheetUrl = (year: number) => {
  const m = years.find((y) => y.year === year)!;
  return `https://docs.google.com/spreadsheets/d/${m.sheetId}/edit?usp=sharing`;
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDate = (iso: string, long = false) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${d}`;
};
export const num = (n: number) => n.toLocaleString('en-US');

// Type groups used for the log filter and the counts.
export const typeGroup = (t: string) =>
  t === 'Album' ? 'album' : t === 'Live Show' ? 'live' : 'other'; // Playlist, Radio, DJ Mix …

export function stats(d: DiaryYear) {
  const e = d.entries;
  const last = e.at(-1)!.date;
  const isNew = (x: Entry) => x.year === d.year;
  const withYear = e.filter((x) => x.year);

  const byMonth = MONTHS.map(() => ({ total: 0, fresh: 0 }));
  const byDay = new Map<string, number>();
  for (const x of e) {
    const m = Number(x.date.slice(5, 7)) - 1;
    byMonth[m].total++;
    if (isNew(x)) byMonth[m].fresh++;
    byDay.set(x.date, (byDay.get(x.date) ?? 0) + 1);
  }
  const lastMonth = Number(last.slice(5, 7)) - 1;

  const decades = new Map<number, number>();
  for (const x of withYear) decades.set(Math.floor(x.year! / 10) * 10, (decades.get(Math.floor(x.year! / 10) * 10) ?? 0) + 1);
  const decadeList = [...decades].sort((a, b) => a[0] - b[0]);

  const artists = new Map<string, number>();
  for (const x of e) if (x.artist !== 'Various Artists') artists.set(x.artist, (artists.get(x.artist) ?? 0) + 1);
  const topArtists = [...artists].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);

  // Longest run of consecutive days with at least one entry.
  const days = [...byDay.keys()].sort();
  let streak = 0, run = 0, prev = 0;
  for (const s of days) {
    const t = Date.parse(s) / 864e5;
    run = t - prev === 1 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = t;
  }
  const oldest = withYear.reduce((a, b) => (b.year! < a.year! ? b : a));

  return {
    last,
    lastMonth,
    total: e.length,
    albums: e.filter((x) => x.type === 'Album').length,
    live: e.filter((x) => x.type === 'Live Show').length,
    artists: new Set(e.map((x) => x.artist)).size,
    fresh: e.filter(isNew).length,
    avgYear: Math.round(withYear.reduce((s, x) => s + x.year!, 0) / withYear.length),
    oldest,
    activeDays: byDay.size,
    streak,
    byMonth,
    byDay,
    decadeList,
    topArtists,
  };
}
