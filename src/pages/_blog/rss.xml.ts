import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { blogPosts } from '../../lib/content';
export async function GET(context: APIContext) {
  const posts = await blogPosts();
  return rss({
    title: 'Rob Mitchum: Blog',
    description: 'Non-Phish writing by Rob Mitchum.',
    site: context.site!,
    items: posts.map((p) => ({ title: p.data.title, pubDate: p.data.published, description: p.data.summary, link: `/blog/${p.id}/` })),
  });
}
