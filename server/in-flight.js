/**
 * Slår sammen samtidige kall: mens en henting pågår deler alle kallere samme promise.
 * Nullstilles når den er ferdig (også ved feil).
 */
export function dedupeInFlight(fn) {
  let pending = null;
  return (...args) => {
    if (pending) return pending;
    const p = Promise.resolve().then(() => fn(...args)).finally(() => {
      if (pending === p) pending = null;
    });
    pending = p;
    return p;
  };
}
