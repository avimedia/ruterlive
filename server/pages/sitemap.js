// Sitemap og kartsti-sjekk.
import { escapeHtml } from './layout.js';

const BASE_URL = 'https://livetrafikk.no';

/** Sant bare for stiene som skal vise kartet (query er ikke del av stien). */
export function isMapPath(path) {
  return path === '/' || path === '/index.html';
}

function urlEntry(path, lastmod) {
  const mod = lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeHtml(BASE_URL + path)}</loc>${mod}\n  </url>`;
}

/** Bygger sitemap.xml. lastmod settes bare for guider (updated). */
export function buildSitemap({ lines, guides, stops = [] }) {
  const entries = [
    urlEntry('/'),
    urlEntry('/guider'),
    urlEntry('/om'),
    urlEntry('/personvern.html'),
    ...lines.map((l) => urlEntry(`/linje/${l.slug}`)),
    ...guides.map((g) => urlEntry(`/guider/${g.slug}`, g.updated)),
    ...(stops.length ? [urlEntry('/holdeplasser')] : []),
    ...stops.map((s) => urlEntry(`/holdeplass/${s.slug}`)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}
