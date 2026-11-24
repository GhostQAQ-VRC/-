/*
 * Runs before the React bundle so a light theme never flashes a dark shell.
 * Kept as a tiny classic script (no modules) so it works on web and in the
 * Electron client without an inline script CSP exception.
 */
(() => {
  try {
    // The Electron preload runs before page scripts; reserve title bar space
    // before first paint so the layout never jumps.
    if (window.hoshikuzu && window.hoshikuzu.desktop) {
      document.documentElement.dataset.desktop = 'true';
    }
    const themes = ['twilight', 'dawn', 'daylight', 'sakura', 'moon', 'amber', 'forest'];
    const layouts = ['starlight', 'gallery', 'ledger', 'sheet'];
    const backgrounds = ['stars', 'rain', 'acrylic', 'blackhole', 'sakura', 'aurora', 'fireflies', 'custom', 'video'];
    let theme = null;
    let layout = null;
    let background = null;
    let experimental = false;
    try {
      const cache = JSON.parse(localStorage.getItem('hoshikuzu-appearance-v1') || 'null');
      if (cache && themes.includes(cache.theme)) theme = cache.theme;
      if (cache && layouts.includes(cache.layout)) layout = cache.layout;
      if (cache && backgrounds.includes(cache.background)) background = cache.background;
      if (cache && cache.experimental === true) experimental = true;
    } catch {
      // Ignore a malformed light cache and fall back to the album record.
    }
    if (!theme || !layout || !background) {
      try {
        const raw = localStorage.getItem('hoshikuzu-album-v2');
        const data = raw ? JSON.parse(raw) : null;
        const settings = data && data.settings;
        if (!theme && settings && themes.includes(settings.theme)) theme = settings.theme;
        if (!layout && settings && layouts.includes(settings.layout)) layout = settings.layout;
        if (!background && settings && backgrounds.includes(settings.backgroundEffect)) {
          background = settings.backgroundEffect;
        }
        if (settings && settings.experimentalEffects === true) experimental = true;
      } catch {
        // Keep whatever the light cache already provided.
      }
    }
    // The black hole is experimental: never paint it without the setting.
    if (background === 'blackhole' && !experimental) background = 'stars';
    if (theme) document.documentElement.dataset.theme = theme;
    if (layout) document.documentElement.dataset.layout = layout;
    document.documentElement.dataset.background = background || 'stars';
    const light = theme === 'dawn' || theme === 'daylight';
    document.documentElement.dataset.tone = light ? 'light' : 'dark';
    document.documentElement.style.colorScheme = light ? 'light' : 'dark';
    if (light) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'daylight' ? '#f5f9ff' : '#fbf4e9');
    }
  } catch {
    // Private mode / malformed storage: the app will apply defaults after mount.
  }
})();
