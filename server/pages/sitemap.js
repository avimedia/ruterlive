// Sitemap og kartsti-sjekk.
import { escapeHtml } from './layout.js';

const BASE_URL = 'https://livetrafikk.no';

/** Sant bare for stiene som skal vise kartet (query er ikke del av stien). */
export function isMapPath(path) {
  return path === '/' || path === '/index.html';
}

function urlEntry(path, lastmod) {
  return `  <url>\n    <loc>${escapeHtml(BASE_URL + path)}</loc>\n    <lastmod>${escapeHtml(lastmod)}</lastmod>\n  </url>`;
}

/** Bygger sitemap.xml. `today` brukes som lastmod for sider uten egen dato. */
export function buildSitemap({ lines, guides, today }) {
  const entries = [
    urlEntry('/', today),
    urlEntry('/guider', today),
    urlEntry('/om', today),
    urlEntry('/personvern.html', today),
    ...lines.map((l) => urlEntry(`/linje/${l.slug}`, today)),
    ...guides.map((g) => urlEntry(`/guider/${g.slug}`, g.updated || today)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}
