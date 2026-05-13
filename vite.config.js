// vite.config.js — single-file UMD bundle for the timeline-builder web component.
//
// Produces `dist/timeline.js`: a self-contained bundle including React,
// ReactDOM, the parallel-tracks library, and the custom element wrapper.
// Consumers load this with one <script> tag and use <jeff-timeline>.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Vite library mode does NOT auto-replace process.env.NODE_ENV the way
  // app mode does. React's bundle references `process.env.NODE_ENV` to
  // decide between dev and prod code paths; without this define, the
  // browser throws `process is not defined` the moment timeline.js loads.
  //
  // Setting NODE_ENV to "production" also lets Rollup tree-shake out
  // React's dev-only warnings/checks — the bundle shrinks by ~5x.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },

  build: {
    lib: {
      entry: 'src/index.js',
      formats: ['umd'],
      name: 'JeffTimeline',
      fileName: () => 'timeline.js',
    },
    outDir: 'dist',
    // Keep dist/index.html (the live demo page) — only the JS gets overwritten.
    emptyOutDir: false,
    // Use production minification.
    minify: 'esbuild',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    // We want a single-file bundle, so don't separate CSS.
    cssCodeSplit: false,
  },
});
