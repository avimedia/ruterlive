import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    proxy: {
      '/api/entur': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur/, '/realtime/v2/vehicles'),
      },
      '/api/entur-et': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur-et/, '/realtime/v1/rest'),
      },
      '/api/entur-geocoder': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur-geocoder/, '/geocoder/v1'),
      },
      '/api/entur-jp': {
        target: 'https://api.entur.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/entur-jp/, '/journey-planner/v3'),
      },
      // OSRM fjernet – 410 i prod
    },
  },
});
