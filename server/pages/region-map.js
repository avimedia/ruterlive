// Kartsiden for en region: samme index.html som Oslo, men med regionens navn i tittel, beskrivelse,
// og:/twitter:-tekster og canonical. Kartsider laster aldri AdSense.

const BASE_URL = 'https://livetrafikk.no';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Tittel og beskrivelse for regionens kartside. */
export function regionMapMeta(region) {
  return {
    title: `Sanntidskart for kollektivtrafikken i ${region.name} | livetrafikk.no`,
    description: `Se buss, bane og båt i ${region.name} i sanntid på kartet. Følg linjer, søk holdeplasser og se avganger. Data fra Entur.`,
    url: `${BASE_URL}${region.path || '/'}`,
  };
}

const warned = new Set();

/**
 * Bytter ut Oslo-teksten i index.html med regionens, og fjerner språkalternativene (hreflang) som
 * peker til Oslo-sidene. Rører ikke resten av siden. Advarer én gang per region hvis et mønster ikke traff.
 */
export function regionMapHtml(html, region) {
  const { title, description, url } = regionMapMeta(region);
  let missed = 0;
  const sub = (re, fn) => {
    html = html.replace(re, (...m) => { missed--; return fn(...m); });
  };
  const attr = (name, value) => sub(new RegExp(`(<meta ${name} content=")[^"]*(")`), (_m, a, b) => `${a}${value}${b}`);
  const total = 9;
  missed = total;
  sub(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`);
  attr('name="description"', esc(description));
  attr('property="og:title"', esc(title));
  attr('property="og:description"', esc(description));
  attr('name="twitter:title"', esc(title));
  attr('name="twitter:description"', esc(description));
  sub(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`);
  attr('property="og:url"', url);
  // Ingen språkversjoner av regionkartet: alternates til / og /en ville stride mot canonical
  sub(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/, () => '');
  html = html.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?/g, '');
  if (missed > 0 && !warned.has(region.id)) {
    warned.add(region.id);
    console.warn(`[RuterLive] Kartsiden for ${region.id}: ${missed} av ${total} tekstbytter traff ikke i index.html`);
  }
  return html;
}
