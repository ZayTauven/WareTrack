import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
