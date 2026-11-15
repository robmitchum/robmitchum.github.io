import { getCollection } from 'astro:content';

const live = ({ data }: { data: { draft?: boolean } }) => import.meta.env.DEV || !data.draft;

export async function phishcritPosts() {
  const posts = await getCollection('phishcrit', live);
  // Show order: chronological by show date (falls back to publish date).
  return posts.sort((a, b) => +(a.data.showDate ?? a.data.published) - +(b.data.showDate ?? b.data.published));
}

export async function blogPosts() {
  const posts = await getCollection('blog', live);
  return posts.sort((a, b) => +b.data.published - +a.data.published);
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

export const showDate = (d: Date) =>
  `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
