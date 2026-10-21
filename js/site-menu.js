/**
 * Flytende logo/søk/meny øverst til venstre på kartet.
 * «⋯» (☰ på mobil) åpner en liten meny (skjult ≥ 1100 px der alle lenker ligger i pillen) som lukkes med Escape, klikk utenfor og klikk på lenke.
 */

import L from 'leaflet';

export function initSiteMenu() {
  const chrome = document.getElementById('map-chrome');
  const btn = document.getElementById('map-menu-btn');
  const menu = document.getElementById('map-menu');
  if (!chrome || !btn || !menu) return;

  // Klikk, scroll og dra i logo/søk/meny skal ikke nå kartet
  L.DomEvent.disableClickPropagation(chrome);
  L.DomEvent.disableScrollPropagation(chrome);

  const isOpen = () => !menu.hidden;
  const visibleLinks = () => [...menu.querySelectorAll('a')].filter((a) => a.offsetParent !== null);

  function open() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKeydown);
  }

  function close({ focusButton = false } = {}) {
    if (!isOpen()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKeydown);
    if (focusButton) btn.focus();
  }

  function onOutside(e) {
    if (!menu.contains(e.target) && !btn.contains(e.target)) close();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close({ focusButton: true });
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = visibleLinks();
    if (!links.length) return;
    e.preventDefault();
    const i = links.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i <= 0 ? links.length - 1 : i - 1);
    links[next].focus();
  }

  // Ved bred skjerm er lenkene innebygd og menyen skjult: lukk den
  window.matchMedia('(min-width: 1100px)').addEventListener('change', (e) => {
    if (e.matches) close();
  });

  btn.addEventListener('click', () => {
    if (isOpen()) {
      close();
    } else {
      open();
      visibleLinks()[0]?.focus();
    }
  });

  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) close();
  });

  // Lukk når fokus forlater menyen (Tab ut)
  menu.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== btn) close();
  });
}
