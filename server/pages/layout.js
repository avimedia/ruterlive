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
 * Linjekoden som farget brikke. Med `link` blir den en lenke til linjesiden
 * (med fullt linjenavn som tilgjengelig navn); ellers en dekorativ brikke.
 */
export function lineBadge(line, { link = false, size = '' } = {}) {
  const cls = `line-badge${size ? ` line-badge--${size}` : ''}`;
  const code = escapeHtml(line.code);
  return link
    ? `<a class="${cls}" data-mode="${escapeHtml(line.mode)}" href="/linje/${escapeHtml(line.slug)}" aria-label="${escapeHtml(line.title)}">${code}</a>`
    : `<span class="${cls}" data-mode="${escapeHtml(line.mode)}" aria-hidden="true">${code}</span>`;
}

/**
 * Bygger et komplett HTML-dokument.
 * `body` er ferdig HTML (kallerens ansvar å escape dynamiske strenger).
 */
export function renderPage({ title, description, path, body, ads = true, noindex = false, mode = '', bodyClass = '' }) {
  const url = `${BASE_URL}${path}`;
  const navLink = (href, label) => {
    const current = !noindex && (
      path === href
      || (href !== '/' && path.startsWith(`${href}/`))
      || (href === '/guider' && path.startsWith('/linje/'))
    );
    return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
  };
  const bodyAttrs = `${mode ? ` data-mode="${escapeHtml(mode)}"` : ''}${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ''}`;
  return `<!DOCTYPE html>
<html lang="nb">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
${noindex ? '' : `  <link rel="canonical" href="${escapeHtml(url)}">\n`}${noindex ? '  <meta name="robots" content="noindex">\n' : ''}  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
${noindex ? '' : `  <meta property="og:url" content="${escapeHtml(url)}">\n`}  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script>
    (function(){
      var s = localStorage.getItem('ruterlive-theme') || 'system';
      var d = s === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s;
      document.documentElement.dataset.theme = d;
    })();
  </script>
  <link rel="stylesheet" href="/content.css">
${ads ? `  ${ADSENSE_SCRIPT}\n` : ''}</head>
<body${bodyAttrs}>
  <header class="site-header">
    <div class="site-header-inner">
      <a class="site-name" href="/"><span class="site-logo" aria-hidden="true"></span>livetrafikk.no</a>
      <nav aria-label="Hovedmeny">
        <a href="/">Kart</a>
        ${navLink('/guider', 'Guider og linjer')}
        ${navLink('/om', 'Om')}
      </nav>
    </div>
  </header>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <a href="/personvern.html">Personvern</a>
      <a href="https://apptastic.no/pages/contact/" rel="noopener">Kontakt</a>
      <span>Sanntidsdata fra Entur</span>
    </div>
  </footer>
</body>
</html>
`;
}
