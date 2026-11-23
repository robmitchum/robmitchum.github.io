// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://robmitchum.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  // Old .html URLs are forwarded by small files in public/ (see public/*.html).
});
