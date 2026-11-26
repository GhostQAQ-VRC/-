import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base keeps the same build usable on plain static hosting, under a
  // sub-path, and inside the Electron client's app:// protocol.
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // mobile.html is the standalone phone album bundled into the Android APK.
      // The desktop LAN /m page still uses the main index.html entry.
      input: {
        main: resolve(__dirname, 'index.html'),
        mobileClient: resolve(__dirname, 'mobile-client.html'),
      },
    },
  },
  html: {
    // Dev-only inline refresh preamble needs this nonce; the CSP in index.html
    // allows exactly this value instead of 'unsafe-inline'.
    cspNonce: 'hoshikuzu-stardust',
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    watch: {
      // Electron packaging writes large, sometimes locked DLLs into release/.
      // Watching them can crash Vite with EBUSY while the desktop app is running.
      ignored: ['**/release/**'],
    },
  },
});
