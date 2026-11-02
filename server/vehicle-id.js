/**
 * Korte kjøretøy-id-er til nettleseren. ET-id-er som «et-RUT:ServiceJourney:<32 hex>» er ~50 tegn
 * tilfeldig hex og komprimeres dårlig (~10 % av /api/vehicles-live). Nettleseren bruker id-en bare
 * som nøkkel, så en stabil hash holder: samme kjøretøy får samme korte id ved hver polling.
 * 8 tegn base64url = 48 bit; sjansen for kollisjon blant ~2000 kjøretøy er neglisjerbar.
 */
import crypto from 'node:crypto';

const KEEP_MAX_LEN = 10; // korte id-er (f.eks. «533-2026-11-02» er lengre, «1234» ikke) beholdes

export function shortVehicleId(id) {
  if (typeof id !== 'string' || id.length <= KEEP_MAX_LEN) return id;
  return crypto.createHash('sha1').update(id).digest('base64url').slice(0, 8);
}
