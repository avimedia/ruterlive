/**
 * Slår sammen samtidige kall: mens en henting pågår deler alle kallere samme promise.
 * Nullstilles når den er ferdig (også ved feil) – eller etter `timeoutMs`, slik at en henting
 * som aldri blir ferdig (f.eks. en body som stopper opp) ikke låser alle senere kall.
 */
export function dedupeInFlight(fn, { timeoutMs } = {}) {
  let pending = null;
  return (...args) => {
    if (pending) return pending;
    let timer;
    const work = Promise.resolve().then(() => fn(...args));
    const limited = timeoutMs
      ? Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`tidsavbrudd etter ${timeoutMs} ms`)), timeoutMs);
          }),
        ])
      : work;
    const p = limited.finally(() => {
      clearTimeout(timer);
      if (pending === p) pending = null;
    });
    pending = p;
    return p;
  };
}
