/* Runs before the stylesheet paints, so a light-mode panel never flashes dark.
   It is a file and not an inline <script> on purpose: keeping every script
   external is what lets the panel's CSP drop 'unsafe-inline' from script-src. */
try {
  if (localStorage.getItem('panel_theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
} catch (e) { /* storage blocked — dark is the default anyway */ }
