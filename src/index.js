// index.js — entry point. Registers the <jeff-timeline> custom element.
//
// On connect: creates a Shadow DOM root, injects CSS, mounts the React tree.
// On attribute change: re-renders.
// On disconnect: unmounts cleanly.
//
// Why hand-rolled instead of @r2wc/react-to-web-component:
//   One fewer dep, full control over Shadow DOM creation, full control over
//   CSS injection order, ~80 lines. The library would save us nothing.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { TimelineApp } from './timeline-app.jsx';
import { DEFAULT_CANON_BASE } from './loader.js';

// CSS is imported as raw strings so we can inject them into the Shadow DOM.
// Vite's `?inline` query returns the post-processed CSS as a string.
import componentStyles from './styles.css?inline';
import vendorStyles from './vendor/parallel-tracks.css?inline';

const COMBINED_STYLES = vendorStyles + '\n\n' + componentStyles;

class JeffTimeline extends HTMLElement {
  static get observedAttributes() {
    return ['chart', 'canon-base'];
  }

  constructor() {
    super();
    this._root = null;
    this._reactRoot = null;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });

      // Inject styles.
      const style = document.createElement('style');
      style.textContent = COMBINED_STYLES;
      shadow.appendChild(style);

      // Create mount point.
      const mount = document.createElement('div');
      mount.className = 'jt-mount';
      shadow.appendChild(mount);

      this._root = mount;
      this._reactRoot = ReactDOM.createRoot(mount);
    }
    this._render();
  }

  attributeChangedCallback() {
    if (this._reactRoot) this._render();
  }

  disconnectedCallback() {
    if (this._reactRoot) {
      this._reactRoot.unmount();
      this._reactRoot = null;
      this._root = null;
    }
  }

  _render() {
    const chart = this.getAttribute('chart');
    const canonBase = this.getAttribute('canon-base') || DEFAULT_CANON_BASE;

    if (!chart) {
      this._reactRoot.render(
        React.createElement(
          'div',
          { className: 'jt-error' },
          '<jeff-timeline> requires a "chart" attribute.'
        )
      );
      return;
    }

    this._reactRoot.render(
      React.createElement(TimelineApp, { chart, canonBase })
    );
  }
}

if (!customElements.get('jeff-timeline')) {
  customElements.define('jeff-timeline', JeffTimeline);
}

// Export for programmatic access / testing.
export { JeffTimeline };
