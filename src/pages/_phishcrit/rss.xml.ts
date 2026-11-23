import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { phishcritPosts } from '../../lib/content';
export async function GET(context: APIContext) {
  const posts = (await phishcritPosts()).sort((a, b) => +b.data.published - +a.data.published);
  return rss({
    title: 'PhishCrit',
    description: 'Essays on Phish, show by show.',
    site: context.site!,
    items: posts.map((p) => ({ title: p.data.title, pubDate: p.data.published, description: p.data.summary, link: `/phishcrit/${p.id}/` })),
  });
}
