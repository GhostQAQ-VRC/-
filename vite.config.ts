import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base keeps the same build usable on plain static hosting, under a
  // sub-path, and inside the Electron client's app:// protocol.
  base: './',
  plugins: [react()],
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
