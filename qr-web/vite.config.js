import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: 'recv.html',
    },
  },

  plugins: [
    viteStaticCopy({
      targets: [
        // Redirect index.html
        { src: 'index.html', dest: './' },
        // Main recv.html
        { src: 'recv.html', dest: './' },
        // All versioned JS — loaded via plain <script> tags (non-module IIFE)
        { src: 'recv.2026-05-09T0146.js', dest: './' },
        { src: 'zstd.2026-05-09T0146.js', dest: './' },
        // Workers — loaded via new Worker('rel-path')
        { src: 'recv-worker.2026-05-09T0146.js', dest: './' },
        // WASM glue + binary — loaded via importScripts inside recv-worker
        { src: 'cimbar_js.2026-05-09T0146.js', dest: './' },
        { src: 'cimbar_js.2026-05-09T0146.wasm', dest: './' },
        // Favicon
        { src: 'favicon.ico', dest: './' },
      ],
    }),
  ],

  server: {
    // HTTPS for mobile camera testing (iOS requires HTTPS for getUserMedia)
    https: {
      cert: './cert.pem',
      key: './key.pem',
    },
    host: '0.0.0.0',
    port: 8081,
    // Hot-reload when source files change
    watch: {
      usePolling: true,
    },
  },
})
