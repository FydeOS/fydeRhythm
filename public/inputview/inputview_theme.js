// Drives the virtual keyboard's light/dark from the options-page theme setting.
// The input view is a same-origin extension page, so it reads the very key the
// options toggle persists ('mui-mode') and toggles a `.dark` / `.light` class on
// <html>; inputview.css keys its dark rules off `html.dark`. Loaded first in
// <head> (external, since the CSP blocks inline scripts) so the class is set
// before first paint — no flash when the keyboard pops up.
(function () {
  function apply() {
    try {
      var mode = localStorage.getItem('mui-mode') || 'system';
      var dark = mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : mode === 'dark';
      var el = document.documentElement;
      el.classList.toggle('dark', dark);
      el.classList.toggle('light', !dark);
    } catch (e) { /* storage/matchMedia unavailable — leave as-is */ }
  }

  apply();

  try {
    // React live: the toggle flipped in the options tab (storage event fires in
    // other same-origin documents), or the OS scheme changed while in System.
    window.addEventListener('storage', function (e) {
      if (!e || e.key === null || e.key === 'mui-mode') apply();
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  } catch (e) { /* no live updates available */ }
})();
