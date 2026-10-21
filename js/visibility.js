/** Hjelpere for å unngå nettverkskall mens fanen er skjult. */

export function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Returnerer en funksjon som kjører fn bare når fanen er synlig.
 * Hvis kallet ble hoppet over, kjøres fn én gang straks fanen blir synlig igjen.
 */
export function runWhenVisible(fn) {
  let missed = false;
  document.addEventListener('visibilitychange', () => {
    if (!isHidden() && missed) {
      missed = false;
      fn();
    }
  });
  return () => {
    if (isHidden()) {
      missed = true;
      return;
    }
    fn();
  };
}
