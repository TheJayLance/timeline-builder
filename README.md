# timeline-builder

Embeddable web component that renders a parallel-tracks timeline against the [Digital Jeff canon](https://github.com/TheJayLance/canon-public).

The deliverable is a single JS file (`timeline.js`) published to GitHub Pages. Consumers drop two lines into any modern browser-capable page and have a working timeline.

## Embed

```html
<script src="https://thejaylance.github.io/timeline-builder/v1/timeline.js"></script>
<jeff-timeline chart="career-map"></jeff-timeline>
```

### Attributes

| Attribute | Required | Default | Notes |
|---|---|---|---|
| `chart` | yes | — | Chart ID. Resolves to `<canon-base>/charts/<chart>.json`. |
| `canon-base` | no | `https://thejaylance.github.io/canon-public/v1` | Override the canon URL base. Useful for local dev or self-hosted mirrors. |

If `chart` is missing the component renders a visible error.

### Theming

The component renders inside a Shadow DOM (mode `open`). Theme it by setting CSS custom properties on the host element:

```html
<jeff-timeline
  chart="career-map"
  style="
    --jt-bg: #ffffff;
    --jt-ink: #111111;
    --jt-accent: #d72a2a;
  "
></jeff-timeline>
```

Available custom properties:

```
--jt-bg              background of the component
--jt-bg-card         card / panel background
--jt-ink             primary text color
--jt-ink-2           secondary text color
--jt-ink-3           tertiary text color (meta, captions)
--jt-divider         divider/border color
--jt-divider-strong  emphasized divider color
--jt-accent          accent color
--jt-overlay         reader overlay scrim color
--jt-zone-1..4       era zone tint colors
--jt-font-display    display font stack
--jt-font-mono       mono font stack
```

Track colors and primitive geometry are owned by the chart config in the canon, not by host CSS.

### Browser support

Modern browsers only. Custom elements, Shadow DOM, fetch, ResizeObserver. No IE.

---

## Architecture

This repo is **the wrapper**. It does not own the chart data.

```
canon-public (other repo)  →  publishes  →  corpus.json + chart configs
                                                       │
                                                       │ fetched at runtime
                                                       ▼
            timeline-builder (this repo)  →  timeline.js  →  consumers embed
```

Three layers inside the bundle:

1. **Custom element wrapper** (`src/index.js`) — registers `<jeff-timeline>`, creates Shadow DOM, mounts React.
2. **React tree** (`src/timeline-app.jsx`) — fetches data, resolves tracks, renders the primitive, owns the reader overlay.
3. **parallel-tracks library** (`src/vendor/`) — the timeline renderer + query engine. Vendored from `C:\jeff-data\jaylance\parallel-tracks\` upstream.

### What's NOT in this repo

- The corpus and chart configs. Those live in `canon-public`. Adding a new chart = commit a new JSON file there, NOT a code change here.
- The upstream parallel-tracks library source. Lives at `C:\jeff-data\jaylance\parallel-tracks\` on Falken. We vendor it (copy + minimal patches) and document the patches in headers.
- The dev-mode tweaks panel. That's a Falken-local tool, not an embed feature.

---

## Develop

```bash
npm install
npm run dev      # vite dev server, hot reload
npm run build    # produces dist/timeline.js
npm run preview  # serve dist/ locally
```

The dev server loads `dist/index.html` and the component. Edit source, hot reload picks it up.

### Re-vendor the library

When `parallel-tracks` upstream gets meaningful changes, re-copy the files and re-apply the patches documented in each file's header:

```
C:\jeff-data\jaylance\parallel-tracks\parallel-tracks.jsx  →  src/vendor/parallel-tracks.jsx
C:\jeff-data\jaylance\parallel-tracks\query-engine.jsx     →  src/vendor/query-engine.js
C:\jeff-data\jaylance\parallel-tracks\parallel-tracks.css  →  src/vendor/parallel-tracks.css
```

Patches are minimal (top of file: replace global React access with `import`; bottom: replace `Object.assign(window, ...)` with `export`). Each vendored file has a comment block at the top showing exactly what was changed.

### Add a new chart

You don't. Charts live in `canon-public`. Add a JSON config there, commit, and `<jeff-timeline chart="new-chart">` works immediately — no rebuild of `timeline.js` required.

The wrapper is chart-agnostic. The chart config tells it everything it needs.

---

## Versioning

The Pages URL includes a major version (`/v1/`). Breaking changes to attributes, removed CSS variables, or anything that would break an existing consumer ship at `/v2/` alongside `/v1/`, never on top of it.

v1 stays at `https://thejaylance.github.io/timeline-builder/v1/timeline.js` forever.

---

## Why a web component instead of a React component or an iframe

- **Not React** because consumers shouldn't have to load React, match versions, or know they're hosting a React tree. The outer interface is a plain HTML custom element.
- **Not an iframe** because iframes don't reflow with the host page, don't inherit fonts naturally, and create a sandboxed window that's hostile to host-page styling.
- **Web component** gives us the right boundary: style isolation via Shadow DOM (host CSS can't bleed in, component CSS can't bleed out), opt-in theming via CSS custom properties, and a one-element embed.

---

## License

Private. Personal canon project. The corpus is Jeff's life. The wrapper is just plumbing for it.
