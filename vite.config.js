// vite.config.js — single-file UMD bundle for the timeline-builder web component.
//
// Produces `dist/timeline.js`: a self-contained bundle including React,
// ReactDOM, the parallel-tracks library, and the custom element wrapper.
// Consumers load this with one <script> tag and use <jeff-timeline>.
//
// Why UMD instead of ES modules:
//   The embed needs to work via a plain <script src="..."> tag on any
//   website — WordPress, Substack, plain HTML, anywhere. UMD is the format
//   that registers globals and works without type="module". For v1 the
//   surface is small enough that a single bundle is fine; if it ever needs
//   code-splitting we'll revisit (probably v2).
//
// Why inlineDynamicImports:
//   We refuse code-splitting on purpose. The deliverable is ONE file.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    // We want a single-file bundle, so don't separate CSS.
    cssCodeSplit: false,
  },
});
