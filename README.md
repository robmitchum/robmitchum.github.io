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
