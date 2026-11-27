# robmitchum.com

Astro site, deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Work on it locally

```sh
npm install
npm run dev      # http://localhost:4321, live reload
npm run build    # static site in dist/
```

## Where things live

- `src/pages/` — one file per URL (`/`, `/bylines/`, `/blog/`, `/phishcrit/`, `/projects/`, `/about/`)
- `src/layouts/BaseLayout.astro` — main-site look (Montréal '76)
- `src/layouts/PhishCritLayout.astro` — PhishCrit look (Doniac Schvice, "Color panels")
- `src/styles/` — design tokens for each look
- `src/content/` — posts and bylines as Markdown/JSON
  - `phishcrit/` — one `.md` per essay, named with its Substack slug
  - `blog/` — non-Phish posts
  - `bylines/` — one `.json` per published piece
- `public/` — copied as-is: `CNAME`, favicon, and redirect files for old `.html` URLs

Feeds: `/phishcrit/rss.xml`, `/blog/rss.xml`.

## Albums of the Year (`/projects/aoty/`)

- `src/data/aoty/years.json` — one entry per year: sheet id and tab, list count, No. 1 (for the archive cards), extras.
- `src/data/aoty/publications/<year>.json` — the outlets for that year: sheet abbreviation, name, list URL
  (optional `short` for a shorter name on the site, and from 2026 an `added` date, YYYY-MM-DD, for "Last update").
- `src/data/aoty/<year>.json` — every album's placements, written by the export script. A year with this file gets a chart page.
- **LISTEN / BUY / COVER / LINK CHECK** columns in a year's sheet hold each album's links. `scripts/sheets/aoty-links.gs` (pasted into the sheet's Extensions → Apps Script) fills them from an "Albums" menu; you can also type or fix links by hand. When a sheet has these columns, `npm run aoty:links` only downloads covers.
- `src/data/aoty/links/<year>.json` — Listen, Buy and cover for each album, filled in by the links script.
- `src/data/aoty/hub.md` — the hub page text.

```sh
npm run aoty -- 2025 --download        # pull the sheet (shared "anyone with the link") into src/data/aoty/2025.json
npm run aoty -- 2025 path/to/file.csv  # or from a CSV you downloaded
npm run aoty:links -- 2025             # download covers (or, for a sheet without link columns, look links up)
```

## Homepage "Lately" boxes

Three boxes on `/`: what I'm listening to, reading and watching (`src/components/NowBoxes.astro`, data via `src/lib/now.ts`).

- **Listening:** the last 5 entries in the Listening Diary (`src/data/diary/<year>.json`, `npm run diary`).
- **Reading:** books with Status "Reading" in the Reading Diary's Log tab (`npm run reading -- --download` → `src/data/now/reading.json`). The download needs the sheet shared "anyone with the link can view".
- **Watching:** the 5 latest entries from the Letterboxd diary RSS feed (`npm run watching -- --download` → `src/data/now/watching.json`).

The nightly build refreshes all three; if a download fails, it keeps the saved file.
