/**
 * Produksjonsserver med API-proxy til Entur.
 * Proxier alle API-kall server-side slik at:
 * - Ingen CORS-problemer
 * - Brukerens dårlige båndbredde påvirker mindre (server har ofte bedre linje)
 * - Enkelt å deploye til Railway, Render, Fly.io m.m.
 */

import express from 'express';
import proxy from 'express-http-proxy';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();

app.use(
  '/api/entur',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v2/vehicles' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(
  '/api/entur-et',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v1/rest' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
    timeout: 60000, // ET returnerer stor XML; gi tid for full overføring
  })
);

app.use(
  '/api/entur-geocoder',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/geocoder/v1' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(
  '/api/osrm',
  proxy('https://router.project-osrm.org', {
    proxyReqPathResolver: (req) => (req.url || '').replace(/^\/api\/osrm/, '') || '/',
    proxyReqOptDecorator: (opt) => opt,
  })
);

app.use(
  '/api/entur-jp',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/journey-planner/v3' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`RuterLive kjører på http://localhost:${PORT}`);
});
