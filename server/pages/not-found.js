// 404-side: ingen annonser, ikke indeksert.
import { renderPage } from './layout.js';

export function renderNotFound() {
  return renderPage({
    title: 'Siden finnes ikke – livetrafikk.no',
    description: 'Siden du leter etter finnes ikke.',
    path: '/',
    ads: false,
    noindex: true,
    body: `    <h1>Siden finnes ikke</h1>
    <p>Adressen stemmer ikke med noen side hos oss.</p>
    <p><a href="/">Gå til kartet</a> eller se <a href="/guider">guider og linjer</a>.</p>`,
  });
}
