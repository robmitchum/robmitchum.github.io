import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// PhishCrit essays. Filled in Phase 6 by the Substack migration script.
// One Markdown file per post, named with the Substack slug so URLs carry over.
const phishcrit = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/phishcrit' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    published: z.coerce.date(),
    showDate: z.coerce.date().optional(), // the show the essay covers
    venue: z.string().optional(),
    city: z.string().optional(),
    tour: z.string().optional(), // e.g. "Fall 1998", "Island Tour", "Side Projects"
    summary: z.string().optional(),
    setlist: z.array(z.object({ set: z.string(), songs: z.array(z.string()) })).optional(),
    image: z.string().optional(),
    substackUrl: z.string().url().optional(),
    draft: z.boolean().default(false),
  }),
});

// The second, non-Phish blog (Phase 7).
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().optional(),
    published: z.coerce.date(),
    draft: z.boolean().default(false),
  }),
});

// Bylines are not a content collection: they live in src/data/bylines/*.json,
// written from the clips Sheet by `npm run bylines` (see src/lib/bylines.ts).

export const collections = { phishcrit, blog };
