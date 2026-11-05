// Region-kjøretid: aktiv (besøk siste 10 min eller alwaysActive), hvilende (10–60 min)
// og avlastet (> 60 min uten besøk). Selve avlastingen gjøres av lyttere via onUnload.

export function createRegionRuntime({
  regions,
  now = Date.now,
  restAfterMs = 600_000,
  unloadAfterMs = 3_600_000,
} = {}) {
  const startedAt = now();
  const byId = new Map((regions || []).map((r) => [r.id, r]));
  const lastTouch = new Map();
  const notified = new Set();
  const listeners = [];

  function stateOf(id) {
    const region = byId.get(id);
    if (!region) return 'unloaded';
    if (region.alwaysActive) return 'active';
    const age = now() - (lastTouch.get(id) ?? startedAt);
    if (age < restAfterMs) return lastTouch.has(id) ? 'active' : 'resting';
    if (age < unloadAfterMs) return 'resting';
    return 'unloaded';
  }

  function touch(id) {
    if (!byId.has(id)) return;
    lastTouch.set(id, now());
    notified.delete(id);
  }

  /** Regionen har fått ny data (ET-henting): kan avlastes på nytt ved neste tick. */
  function loaded(id) {
    notified.delete(id);
  }

  function onUnload(fn) {
    listeners.push(fn);
  }

  function tick() {
    for (const id of byId.keys()) {
      if (stateOf(id) !== 'unloaded' || notified.has(id)) continue;
      notified.add(id);
      for (const fn of listeners) {
        try {
          fn(id);
        } catch (err) {
          console.warn(`Region ${id}: avlasting feilet: ${err?.message || err}`);
        }
      }
    }
  }

  let queue = Promise.resolve();
  function runExclusive(fn) {
    const result = queue.then(() => fn());
    queue = result.catch(() => {});
    return result;
  }

  return { touch, stateOf, onUnload, tick, runExclusive, loaded };
}
