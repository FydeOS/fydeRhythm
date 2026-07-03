// Applies the persisted color scheme to <html> before first paint so a
// dark/system preference doesn't flash light on load. External (not inline)
// because the extension CSP is `script-src 'self'` and blocks inline scripts.
//
// Reads the same key MUI's useColorScheme persists on the options page
// ('mui-mode'); MUI reconciles the class once it mounts. Keep in sync with
// @mui/material's default storage key and the theme's colorSchemeSelector.
(function () {
  try {
    var mode = localStorage.getItem('mui-mode') || 'system';
    var dark = mode === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : mode === 'dark';
    document.documentElement.classList.add(dark ? 'dark' : 'light');
  } catch (e) { /* storage/matchMedia unavailable — fall back to light */ }
})();
