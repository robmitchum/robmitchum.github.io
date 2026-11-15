// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://robmitchum.com',
  trailingSlash: 'always',
  // Old .html URLs are forwarded by small files in public/ (see public/*.html).
});
