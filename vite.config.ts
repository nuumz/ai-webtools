import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Only the Side Panel (React app) is built by Vite.
// The background service worker and the two content scripts are bundled as
// standalone IIFE files by scripts/build-scripts.mjs, because MV3 content
// scripts cannot be ES modules.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
