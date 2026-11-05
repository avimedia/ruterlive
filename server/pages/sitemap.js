// Sitemap og kartsti-sjekk.
import { escapeHtml } from './layout.js';
import { findRegion, regionPath } from '../../shared/regions.js';
import { serverVisibleRegions } from '../region-preview.js';

const BASE_URL = 'https://livetrafikk.no';

/**
 * Sant bare for stiene som skal vise kartet (query er ikke del av stien): `/`, `/index.html`
 * og kartstien til hver synlig region (`/bergen`, også med skråstrek på slutten).
 */
export function isMapPath(path, visible = serverVisibleRegions()) {
  if (path === '/' || path === '/index.html') return true;
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return visible.some((r) => r.path && r.path === p);
}

function urlEntry(path, lastmod) {
  const mod = lastmod ? `\n    <lastmod>${escapeHtml(lastmod)}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeHtml(BASE_URL + path)}</loc>${mod}\n  </url>`;
}

const inRegion = (regionId, sub) => regionPath(findRegion(regionId) ?? findRegion('oslo'), sub);

/**
 * Bygger sitemap.xml. lastmod settes bare for guider og engelske sider (updated).
 * `regions`: synlige regioner utenom Oslo får kartsiden med. Regionale linjer tas bare med når de er
 * indeksert (egen tekst); holdeplasser og guider ligger under regionens sti.
 */
export function buildSitemap({ lines, guides, enPages = [], stops = [], regions = [] }) {
  const entries = [
    urlEntry('/'),
    ...regions.filter((r) => r.path).map((r) => urlEntry(regionPath(r))),
    urlEntry('/guider'),
    urlEntry('/om'),
    urlEntry('/personvern.html'),
    ...lines.filter((l) => l.indexed !== false).map((l) => urlEntry(inRegion(l.regionId, `/linje/${l.slug}`))),
    ...guides.map((g) => urlEntry(inRegion(g.region, `/guider/${g.slug}`), g.updated)),
    ...enPages.map((p) => urlEntry(p.path, p.updated)),
    ...(stops.length ? [urlEntry('/holdeplasser')] : []),
    ...stops.map((s) => urlEntry(inRegion(s.region, `/holdeplass/${s.slug}`))),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}
