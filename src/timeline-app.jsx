// timeline-app.jsx — the React tree inside <jeff-timeline>.
//
// Responsibilities:
//   - Fetch corpus + chart config via loader.js
//   - Apply chart config's preFilter, resolve tracks via query-engine
//   - Render <ParallelTracks> with the resolved tracks + chart's time axis
//   - Reader overlay: clicked station opens item detail
//   - Visible loading/error states
//
// Explicitly NOT included (compared to the original career-map.jsx):
//   - Page header / branding (host page concern, not the embed's)
//   - Dev-mode tweaks panel (Falken-local tool)
//   - Hash-based deep links (host page concern)
//
// All className refs are flat (no Tailwind, no module CSS) because this tree
// renders inside a Shadow DOM with styles injected as a <style> tag.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ParallelTracks, ptParseDate, ptFormatPeriod } from './vendor/parallel-tracks.jsx';
import { queryItems, resolveTracks } from './vendor/query-engine.js';
import { loadTimelineData } from './loader.js';

export function TimelineApp({ chart, canonBase }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null);
  const [corpus, setCorpus] = useState(null);
  const [chartConfig, setChartConfig] = useState(null);
  const [openSlug, setOpenSlug] = useState(null);

  // Load corpus + chart config. Re-fires when chart/canonBase change.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    loadTimelineData({ chart, canonBase })
      .then(({ corpus, chartConfig }) => {
        if (cancelled) return;
        setCorpus(corpus);
        setChartConfig(chartConfig);
        setStatus('ready');
      })
      .catch(e => {
        if (cancelled) return;
        setError(e);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [chart, canonBase]);

  // Resolve tracks against the loaded corpus + chart config.
  const resolved = useMemo(() => {
    if (!corpus || !chartConfig) return null;
    const preFiltered = chartConfig.preFilter
      ? { ...corpus, items: queryItems(corpus, chartConfig.preFilter) }
      : corpus;
    return resolveTracks(preFiltered, chartConfig.tracks, { multiRender: true });
  }, [corpus, chartConfig]);

  const itemsBySlug = useMemo(() => {
    if (!corpus) return new Map();
    return new Map(corpus.items.map(it => [it.slug, it]));
  }, [corpus]);

  const closeReader = useCallback(() => setOpenSlug(null), []);
  const openItem = useCallback((slug) => setOpenSlug(slug), []);

  // Escape closes reader. Listen on the document because the shadow root
  // doesn't get keyboard events naturally.
  useEffect(() => {
    if (!openSlug) return;
    const onKey = (e) => { if (e.key === 'Escape') closeReader(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openSlug, closeReader]);

  if (status === 'loading') {
    return <div className="jt-loading">Loading…</div>;
  }

  if (status === 'error') {
    return <div className="jt-error">{error?.message || 'Couldn\u2019t load timeline data.'}</div>;
  }

  if (!resolved || !chartConfig) {
    return <div className="jt-error">Unexpected: data ready but resolution failed.</div>;
  }

  const openItem_ = openSlug ? itemsBySlug.get(openSlug) : null;

  return (
    <>
      <ParallelTracks
        tracks={resolved}
        timeAxis={chartConfig.timeAxis}
        config={chartConfig.primitive || {}}
        onStationClick={(item) => openItem(item.slug)}
      />
      {openItem_ && (
        <TimelineReader
          item={openItem_}
          resolved={resolved}
          onClose={closeReader}
        />
      )}
    </>
  );
}

// ---------- Reader overlay ----------
function TimelineReader({ item, resolved, onClose }) {
  const track = resolved.find(t => t.items.some(it => it.slug === item.slug));
  const parsed = ptParseDate(item.period_start);
  const period = ptFormatPeriod(parsed, item.period_display);
  const paragraphs = (item.curator_note_md || '').split(/\n\n+/).filter(Boolean);

  return (
    <div
      className="jt-reader-overlay is-open"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <article className="jt-reader-pane">
        <button className="jt-reader-close" onClick={onClose} type="button">Close · esc</button>
        {track && (
          <span className="jt-reader-stripe">
            <span className="jt-reader-bullet" style={{ background: track.color }}>
              {track.code}
            </span>
            {track.label}
          </span>
        )}
        <div className="jt-reader-period">
          {period}
          {item.period_end && item.period_end !== item.period_start && item.period_end !== period
            ? ` \u2192 ${item.period_end}`
            : ''}
        </div>
        <h1 className="jt-reader-title">{item.title}</h1>
        {item.role && <p className="jt-reader-role">{item.role}</p>}
        <div className="jt-reader-body">
          {paragraphs.length > 0
            ? paragraphs.map((p, i) => <p key={i}>{p}</p>)
            : <p className="jt-reader-empty">No notes yet for this item.</p>}
        </div>
      </article>
    </div>
  );
}
