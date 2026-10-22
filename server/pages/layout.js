// Felles sidemal for server-rendrede innholdssider.

const BASE_URL = 'https://livetrafikk.no';
// Samme logo som favicon.svg og kartsiden (index.html).
const LOGO_SVG = '<svg class="site-logo" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="14" fill="#14213d"/><path d="M13 51 C13 36 29 40 32 32 S51 28 51 13" fill="none" stroke="#2a9d8f" stroke-width="8" stroke-linecap="round"/><circle cx="32" cy="32" r="9.5" fill="#e63946" stroke="#fff" stroke-width="4"/></svg>';
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

// Faste tekster i rammen per språk ('nb' er standard, 'en' for de engelske sidene).
const CHROME_TEXT = {
  nb: { nav: 'Hovedmeny', map: 'Kart', guides: 'Guider og linjer', about: 'Om', privacy: 'Personvern', contact: 'Kontakt', source: 'Sanntidsdata fra Entur' },
  en: { nav: 'Main menu', map: 'Map', guides: 'Guides', about: 'About', privacy: 'Privacy', contact: 'Contact', source: 'Real-time data from Entur' },
};

/** <link rel="alternate" hreflang> per språkversjon. `href` er en sti på livetrafikk.no. */
function alternateLinks(alternates) {
  return alternates
    .map((a) => `  <link rel="alternate" hreflang="${escapeHtml(a.hreflang)}" href="${escapeHtml(BASE_URL + a.href)}">\n`)
    .join('');
}

/**
 * Bygger et komplett HTML-dokument.
 * `body` er ferdig HTML (kallerens ansvar å escape dynamiske strenger).
 * `lang`: 'nb' (standard) eller 'en'. `alternates`: [{ hreflang, href }] for språkversjoner.
 */
export function renderPage({ title, description, path, body, ads = true, noindex = false, mode = '', bodyClass = '', lang = 'nb', alternates = [] }) {
  const htmlLang = lang === 'en' ? 'en' : 'nb';
  const t = CHROME_TEXT[htmlLang];
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
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
${noindex ? '' : `  <link rel="canonical" href="${escapeHtml(url)}">\n${alternateLinks(alternates)}`}${noindex ? '  <meta name="robots" content="noindex">\n' : ''}  <meta property="og:title" content="${escapeHtml(title)}">
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
      <a class="site-name" href="/">${LOGO_SVG}<span>livetrafikk<span class="site-tld">.no</span></span></a>
      <nav aria-label="${t.nav}">
        <a href="/">${t.map}</a>
        ${navLink('/guider', t.guides)}
        ${navLink('/om', t.about)}
      </nav>
    </div>
  </header>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <a href="/personvern.html">${t.privacy}</a>
      <a href="https://apptastic.no/pages/contact/" rel="noopener">${t.contact}</a>
      <span>${t.source}</span>
    </div>
  </footer>
</body>
</html>
`;
}
