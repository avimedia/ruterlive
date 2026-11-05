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

/** Bytter ut Oslo-teksten i index.html med regionens. Rører ikke resten av siden. */
export function regionMapHtml(html, region) {
  const { title, description, url } = regionMapMeta(region);
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(description)}${b}`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(title)}${b}`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(description)}${b}`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(title)}${b}`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, (_m, a, b) => `${a}${esc(description)}${b}`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, (_m, a, b) => `${a}${url}${b}`);
}
