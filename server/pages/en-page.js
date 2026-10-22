// Server-rendrede engelske sider (/en og /en/:slug).

import { EN_PAGES, alternatesFor } from '../en-catalog.js';
import { escapeHtml, renderPage } from './layout.js';

/** `body` er klarert HTML fra content/en/ og escapes ikke. */
export function renderEnPage(page, body) {
  const date = page.updated && page.updated !== page.published
    ? `published ${escapeHtml(page.published)} · updated ${escapeHtml(page.updated)}`
    : `published ${escapeHtml(page.published)}`;
  const nbHref = page.nb || page.nbLink || '/';
  const crumbs = page.path === '/en'
    ? `<a href="${escapeHtml(nbHref)}" hreflang="nb" lang="nb">Norsk</a>`
    : `<a href="/en">In English</a> · <a href="${escapeHtml(nbHref)}" hreflang="nb" lang="nb">Norsk</a>`;
  const others = EN_PAGES.filter((p) => p.path !== page.path)
    .map((p) => `<li><a class="card" href="${escapeHtml(p.path)}"><span class="card-title">${escapeHtml(p.title)}</span><span class="card-text">${escapeHtml(p.description)}</span></a></li>`)
    .join('');

  const html = `    <article class="prose">
    <p class="eyebrow">${crumbs}</p>
    <h1>${escapeHtml(page.title)}</h1>
    <p class="byline">livetrafikk.no · ${date}</p>
${body}
    </article>
    <aside class="related" aria-labelledby="more-in-english">
      <h2 id="more-in-english">More in English</h2>
      <ul class="card-list">${others}</ul>
    </aside>`;

  return renderPage({
    title: `${page.title} | livetrafikk.no`,
    description: page.description,
    path: page.path,
    body: html,
    lang: 'en',
    alternates: page.nb ? alternatesFor(page.nb, page.path) : [],
  });
}
