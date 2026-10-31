/**
 * Sikkerhet uten å stenge noen ute: sikkerhetshoder, kanonisk vertsnavn, grense per IP på
 * endepunkter som kan gi nye kall mot Entur, og et felles budsjett for slike kall.
 */

/**
 * Hoder som ikke påvirker AdSense, kartfliser eller skript: ingen script-src i CSP
 * (AdSense laster fra mange skiftende domener), bare innramming, plugins og <base> låses.
 */
export function securityHeaders() {
  return (_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000',
      // «Finn meg» bruker posisjon på egen side; resten trengs ikke
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    });
    next();
  };
}

/**
 * Forespørsler til Render-adressen (*.onrender.com) sendes til livetrafikk.no, så alle går via
 * Cloudflare og søkemotorer ikke ser en kopi av siden. /health* svarer direkte (Renders helsesjekk).
 */
export function canonicalHost(canonical = 'livetrafikk.no') {
  return (req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    if (!host.endsWith('.onrender.com') || req.path.startsWith('/health')) return next();
    res.redirect(301, `https://${canonical}${req.originalUrl}`);
  };
}

/** Klientens IP: Cloudflare setter CF-Connecting-IP, ellers første X-Forwarded-For (Render), ellers socket. */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'ukjent';
}

/**
 * Fast vindu per IP. Vanlig bruk (søk, trykk på holdeplasser og kjøretøy) ligger langt under
 * grensen; et skript som spør om tusenvis av stopp får 429.
 */
export function createRateLimiter({ max = 120, windowMs = 60_000, now = Date.now, maxClients = 20_000 } = {}) {
  const hits = new Map(); // ip -> { start, count }
  return (req, res, next) => {
    const t = now();
    const ip = clientIp(req);
    let e = hits.get(ip);
    if (!e || t - e.start >= windowMs) {
      if (!e && hits.size >= maxClients) {
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxClients) hits.clear(); // minnetak ved mange IP-er
      }
      e = { start: t, count: 0 };
      hits.set(ip, e);
    }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.start + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'For mange forespørsler, prøv igjen om litt' });
    }
    next();
  };
}

/**
 * Felles budsjett for nye kall mot Entur utløst av brukere (cache-bom), uansett IP.
 * Beskytter kvoten til klientnavnet: blir den brukt opp, får hele siden 429 fra Entur.
 */
export function createUpstreamBudget({ perMinute = 180, burst = 60, now = Date.now } = {}) {
  let tokens = burst;
  let last = now();
  const ratePerMs = perMinute / 60_000;
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + (t - last) * ratePerMs);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** fetch som avvises lokalt når budsjettet er brukt opp (tjenestene behandler det som en vanlig feil). */
export function budgetedFetch(budget, fetchFn = (...a) => fetch(...a)) {
  return (url, opts) => (budget.take()
    ? fetchFn(url, opts)
    : Promise.reject(new Error('For mange oppslag mot Entur akkurat nå')));
}
