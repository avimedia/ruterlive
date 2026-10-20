// 404-side: ingen annonser, ikke indeksert.
import { renderPage } from './layout.js';

export function renderNotFound() {
  return renderPage({
    title: 'Siden finnes ikke – livetrafikk.no',
    description: 'Siden du leter etter finnes ikke.',
    path: '/',
    ads: false,
    noindex: true,
    bodyClass: 'page-not-found',
    body: `    <div class="not-found">
      <p class="not-found-code" aria-hidden="true">404</p>
      <h1>Siden finnes ikke</h1>
      <p>Adressen stemmer ikke med noen side hos oss.</p>
      <p class="line-actions"><a class="button button--primary" href="/">Gå til kartet</a> <a class="button" href="/guider">Guider og linjer</a></p>
    </div>`,
  });
}
