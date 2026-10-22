// Ruter for de engelske sidene. Registreres i server.js før express.static og catch-all.

import { getEnPageBySlug, loadEnBody } from './en-catalog.js';
import { renderEnPage } from './pages/en-page.js';

export function registerEnRoutes(app, { sendNotFound }) {
  const handle = (getSlug) => async (req, res) => {
    const page = getEnPageBySlug(getSlug(req));
    if (!page) return sendNotFound(res);
    try {
      const body = await loadEnBody(page.slug);
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('html').send(renderEnPage(page, body));
    } catch (err) {
      console.warn('[RuterLive] Engelsk side:', err.message);
      res.set('Cache-Control', 'no-store');
      res.status(503).type('text').send('Page temporarily unavailable');
    }
  };
  // Forsiden har tom slug i katalogen og nås bare via /en.
  app.get('/en', handle(() => ''));
  app.get('/en/:slug', handle((req) => req.params.slug));
}
