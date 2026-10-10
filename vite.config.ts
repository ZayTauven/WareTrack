import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin as the API in development, so the refresh cookie (SameSite=Strict, path
    // /api/v1/auth/) and the WebSocket origin check work exactly as they will in production.
    proxy: {
      '/api': 'http://127.0.0.1:8001',
      '/ws': { target: 'ws://127.0.0.1:8001', ws: true },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // The 3D stack changes rarely and is only needed by the lazily loaded scene:
          // keep it in its own long-cacheable chunk, away from the app code.
          // React and zustand are captured first (higher priority): groups pull in their dependencies,
          // and the app shares those two with R3F, so the 'three' chunk would absorb them and load eagerly.
          groups: [
            { name: 'react', priority: 2, test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/ },
            { name: 'three', priority: 1, test: /node_modules[\\/](three|three-[^\\/]+|postprocessing|@react-three|react-reconciler|its-fine|suspend-react|troika-[^\\/]+|camera-controls|maath|@monogrid|meshline|stats-gl|detect-gpu|hls\.js|@use-gesture|tunnel-rat|react-use-measure)[\\/]/ },
          ],
        },
      },
    },
    // three.js alone is ~700 kB minified and cannot be split further; it loads lazily, after the HUD.
    chunkSizeWarningLimit: 1100,
  },
})
