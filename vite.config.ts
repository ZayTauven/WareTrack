import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Content Security Policy for production builds (the dev server needs inline scripts for HMR).
 * Only same-origin scripts and connections (API and WebSocket are same-origin), styles from our
 * files and Google Fonts, and inline style *attributes* (React and the WebGL canvas set them) but no
 * inline <style> or <script>. frame-ancestors cannot be set from a meta tag: send it as a header
 * (Content-Security-Policy: frame-ancestors 'none') from the host serving the app.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'waretrack:csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  server: {
    // Same origin as the API in development, so the refresh cookie (SameSite=Strict, path
    // /api/v1/auth/) and the WebSocket origin check work exactly as they will in production.
    proxy: {
      '/api': 'http://127.0.0.1:8001',
      '/ws': { target: 'ws://127.0.0.1:8001', ws: true },
    },
  },
  // `vite preview` serves the production build (with its CSP) through the same proxy.
  preview: {
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
