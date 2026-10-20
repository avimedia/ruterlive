// Felles sidemal for server-rendrede innholdssider.

const BASE_URL = 'https://livetrafikk.no';
const ADSENSE_SCRIPT = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1298230222793785" crossorigin="anonymous"></script>';

/** Escaper tekst til trygg bruk i HTML (innhold og attributter). */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Bygger et komplett HTML-dokument.
 * `body` er ferdig HTML (kallerens ansvar å escape dynamiske strenger).
 */
export function renderPage({ title, description, path, body, ads = true, noindex = false }) {
  const url = `${BASE_URL}${path}`;
  return `<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(url)}">
${noindex ? '  <meta name="robots" content="noindex">\n' : ''}  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(url)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/favicon.svg">
  <script>
    (function(){
      var s = localStorage.getItem('ruterlive-theme') || 'system';
      var d = s === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s;
      document.documentElement.dataset.theme = d;
    })();
  </script>
  <link rel="stylesheet" href="/content.css">
${ads ? `  ${ADSENSE_SCRIPT}\n` : ''}</head>
<body>
  <header class="site-header">
    <a class="site-name" href="/">livetrafikk.no</a>
    <nav aria-label="Hovedmeny">
      <a href="/">Kart</a>
      <a href="/guider">Guider og linjer</a>
      <a href="/om">Om</a>
    </nav>
  </header>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <a href="/personvern.html">Personvern</a>
    <a href="https://apptastic.no/pages/contact/" rel="noopener">Kontakt</a>
    <span>Data fra Entur</span>
  </footer>
</body>
</html>
`;
}
