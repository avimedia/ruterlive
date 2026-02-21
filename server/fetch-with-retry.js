/**
 * Resilient fetch for server – håndterer ECONNREFUSED/ETIMEDOUT på Render.
 * Retry med exponential backoff, timeout per request.
 */

const DEFAULT_TIMEOUT_MS = 30000; // 30s for trege API-er (Entur)
const DEFAULT_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ timeout?: number; retries?: number }} [config]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, config = {}) {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const retries = config.retries ?? DEFAULT_RETRIES;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      lastErr = err;
      const codes = [err?.code, err?.cause?.code, ...(err?.errors ?? []).map((e) => e?.code)].filter(Boolean);
      const isRetryable =
        codes.includes('ECONNREFUSED') ||
        codes.includes('ETIMEDOUT') ||
        err?.name === 'AbortError';
      if (attempt < retries && isRetryable) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(delay);
      } else {
        throw lastErr;
      }
    }
  }
  throw lastErr;
}
