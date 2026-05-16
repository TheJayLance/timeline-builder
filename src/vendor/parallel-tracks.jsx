// ============================================================================
// VENDORED from C:\jeff-data\jaylance\parallel-tracks\parallel-tracks.jsx
// Copy date: 2026-05-15 (Phase 4F: bullets resting on the separator line)
// Library version: 2026-05-15
//   Phase 4A: revert to 092469b (Phase C ship state)
//   Phase 4B: getTrackColumnX + buildLayoutMetrics unification
//   Phase 4C: name-above-bullet, count removed
//   Phase 4D: drop reflow gating; framePad measured at runtime
//   Phase 4E: fixed-height chips with bullet pinned to chip bottom
//   Phase 4F: chip anchored to legend-inner bottom and padding overridden
//             to 0 so the bullet bottom rests on the legend separator line.
//
// SURGERY APPLIED for ES-module build (Vite):
//   1. Top-of-file `const { useState, ... } = React;` replaced with
//      `import React, { useState, ... } from 'react';`
//   2. Bottom-of-file `Object.assign(window, {...})` removed; replaced with
//      `export { ... }`.
//
// When re-vendoring after upstream changes: re-apply these two patches.
// Everything else stays byte-for-byte identical.
// ============================================================================

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

// ---------- Date utilities ----------
// Duplicate of qParseDate in query-engine.jsx — primitive is independent of
// the query layer, so we keep our own copy here.
function ptParseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || /tbd/i.test(s.slice(0, 8))) return null;
  let m = s.match(/^~?(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) {
    if (m[3]) return { y: +m[1], m: +m[2], d: +m[3], precision: "day" };
    return { y: +m[1], m: +m[2], d: 15, precision: "month" };
  }
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return { y: +m[3], m: mi + 1, d: +m[2], precision: "day" };
  }
  m = s.match(/([A-Za-z]+)\s+(\d{4})/);
  if (m) {
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return { y: +m[2], m: mi + 1, d: 15, precision: "month" };
  }
  m = s.match(/^~?(\d{4})/);
  if (m) return { y: +m[1], m: 6, d: 15, precision: "year" };
  return null;
}

function ptDaysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.abs((b.y - a.y) * 365 + (b.m - a.m) * 30 + ((b.d || 15) - (a.d || 15)));
}

function ptFormatPeriod(parsed, periodDisplay) {
  if (!parsed) return periodDisplay || "—";
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (parsed.precision === "day")   return `${M[parsed.m - 1]} ${parsed.d}, ${parsed.y}`;
  if (parsed.precision === "month") return `${M[parsed.m - 1]} ${parsed.y}`;
  return periodDisplay || `${parsed.y}`;
}

// ---------- Time axis builder ----------
// Returns { yAt(date), canvasHeight, ticks, eras, hinges, direction }.
// All Y positions are in CSS pixels relative to the top of the routes panel.
function buildAxis(cfg) {
  const direction = cfg.direction || "newest-top";
  const start = cfg.start || { y: 1990, m: 1 };
  const end   = cfg.end   || { y: new Date().getFullYear() + 1, m: 1 };
  const pxPre  = cfg.pxPerYearPre  || 40;
  const pxPost = cfg.pxPerYearPost || pxPre;
  const topPad = cfg.topPad || 48;
  const botPad = cfg.botPad || 48;
  const hinges = cfg.hinges || [];
  // The "primary" hinge — where the timeline switches from compressed
  // (pre-hinge) to expanded (post-hinge) px-per-year. Defaults to first hinge.
  const primaryHinge = hinges.length > 0 ? hinges[hinges.length - 1] : null;

  function yAtRaw(date) {
    if (!date) return null;
    const { y, m, d } = date;
    const dayFrac = ((d || 15) - 1) / 31;
    const monthFrac = (m - 1 + dayFrac) / 12;
    if (!primaryHinge) {
      return (y - start.y + monthFrac) * pxPre + topPad;
    }
    const hy = primaryHinge.y;
    if (y < hy) return (y - start.y + monthFrac) * pxPre + topPad;
    const preH = (hy - start.y) * pxPre;
    return preH + ((y - hy) + monthFrac) * pxPost + topPad;
  }

  const naturalEndY = yAtRaw(end);
  const canvasHeight = naturalEndY + botPad;

  function yAt(date) {
    const raw = yAtRaw(date);
    if (raw == null) return null;
    if (direction === "newest-top") {
      return canvasHeight - botPad - (raw - topPad);
    }
    return raw;
  }

  return {
    yAt,
    canvasHeight,
    direction,
    start,
    end,
    hinges,
    eras: cfg.eras || [],
    pxPre,
    pxPost,
    primaryHinge,
  };
}

// ---------- Label collision packer ----------
function packLabelsTopDown(labels, minGap, startY = 0) {
  const out = new Array(labels.length);
  let prevBottom = startY;
  for (let i = 0; i < labels.length; i++) {
    const { preferredY, height } = labels[i];
    const top = Math.max(preferredY - height / 2, prevBottom + minGap);
    out[i] = top + height / 2;
    prevBottom = top + height;
  }
  return out;
}

// ---------- Per-track column X (canonical source of truth) ----------
// SINGLE source of truth for "where does a track live on the horizontal
// axis". Every per-track X in the renderer — SVG track lines, station
// dots, leader-line endpoints, track caps, AND legend chip bullets —
// flows from this one function. Identical inputs guarantee identical
// output, which is the only way bullet-on-chip and dot-on-line stay
// co-axial across every viewport. If you need a per-track X anywhere
// else, call this. Do not reinvent the formula.
//
// Inputs are deliberately explicit (no React state, no closure capture):
//   trackId         — id of the track whose X you want
//   visibleTrackIds — ordered list of currently-visible track ids; the
//                     track's position in this list is what determines
//                     its column slot
//   layoutMetrics   — snapshot produced by buildLayoutMetrics() with
//                     { width, lanePadding, labelOffset, effectiveLabelWidth }
//
// Returns the X (in the routes-panel coordinate system) for the
// requested track, or null if the track is not in visibleTrackIds
// (i.e. currently hidden by the legend toggle).
function getTrackColumnX(trackId, visibleTrackIds, layoutMetrics) {
  const idx = visibleTrackIds.indexOf(trackId);
  if (idx < 0) return null;
  const count = visibleTrackIds.length;
  const { width, lanePadding, labelOffset, effectiveLabelWidth } = layoutMetrics;
  const labelReserve = effectiveLabelWidth + labelOffset + 16;
  const usable = Math.max(0, width - lanePadding - labelReserve);
  if (count === 1) return lanePadding + usable / 2;
  if (count <= 0) return 0;
  return lanePadding + (idx * usable) / (count - 1);
}

// Snapshot of everything getTrackColumnX needs from the current viewport
// + visible-track count. One place that derives effectiveLabelWidth so
// every consumer sees the same value.
function buildLayoutMetrics({ width, visibleCount, cfg }) {
  const effectiveLabelWidth = Math.max(
    cfg.minLabelWidth,
    Math.min(
      cfg.labelWidth,
      (width - cfg.lanePadding) / Math.max(1, visibleCount) - cfg.labelOffset - 8
    )
  );
  return {
    width,
    lanePadding: cfg.lanePadding,
    labelOffset: cfg.labelOffset,
    effectiveLabelWidth,
  };
}

// ---------- Per-track segment computation ----------
function computeTrackSegments(track, axis, segmentGapDays) {
  const ongoingTail = 24;
  const segs = [];
  for (const item of (track.items || [])) {
    const start = ptParseDate(item.period_start);
    if (!start) continue;
    let end = ptParseDate(item.period_end);
    let isOngoing = false;
    if (!end || item.status === "ongoing" || item.period_end === "ongoing") {
      isOngoing = true;
      end = null;
    }
    const yStart = axis.yAt(start);
    const yEnd = end ? axis.yAt(end) : (axis.direction === "newest-top" ? -ongoingTail : axis.canvasHeight + ongoingTail);

    let yTop, yBot, headY;
    if (axis.direction === "newest-top") {
      yTop = Math.min(yStart, yEnd);
      yBot = Math.max(yStart, yEnd);
      headY = yStart;
    } else {
      yTop = Math.min(yStart, yEnd);
      yBot = Math.max(yStart, yEnd);
      headY = yStart;
    }

    const span = end ? ptDaysBetween(start, end) : Infinity;
    const isPoint = !isOngoing && span < segmentGapDays;

    segs.push({
      item,
      yStart,
      yEnd,
      yTop,
      yBot,
      headY,
      isOngoing,
      isPoint,
    });
  }
  segs.sort((a, b) => a.headY - b.headY);
  return segs;
}

// ---------- Main component ----------
function ParallelTracks({
  tracks: rawTracks,
  timeAxis: timeAxisCfg,
  config = {},
  onStationClick,
  renderStation,
  hiddenTracks: hiddenProp,
  className,
}) {
  const cfg = {
    lineWidth:       config.lineWidth       ?? 14,
    dotSize:         config.dotSize         ?? 18,
    lanePadding:     config.lanePadding     ?? 80,
    labelWidth:      config.labelWidth      ?? 200,
    labelOffset:     config.labelOffset     ?? 28,
    labelHeight:     config.labelHeight     ?? 56,
    labelInset:      config.labelInset      ?? 6,
    minLabelGap:     config.minLabelGap     ?? 8,
    segmentGapDays:  config.segmentGapDays  ?? 60,
    maxTracks:       config.maxTracks       ?? 6,
    cornerRadius:    config.cornerRadius    ?? 22,
    showRoleInLabel: config.showRoleInLabel ?? false,
    titleLines:      config.titleLines      ?? 2,
    minLabelWidth:   config.minLabelWidth   ?? 132,
  };

  if (rawTracks.length > cfg.maxTracks) {
    console.warn(`[ParallelTracks] ${rawTracks.length} tracks exceeds max of ${cfg.maxTracks}. Beyond 6 tracks, group or filter your data — visual readability degrades.`);
  }

  const [internalHidden, setInternalHidden] = useState(() => new Set());
  const hidden = hiddenProp ?? internalHidden;
  const toggleHidden = useCallback((id) => {
    setInternalHidden(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const tracks = rawTracks.filter(t => !hidden.has(t.id));
  const N = tracks.length;

  const axis = useMemo(() => buildAxis(timeAxisCfg), [timeAxisCfg]);

  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  // Frame's computed padding-left, measured at runtime. The library's CSS
  // shrinks .pt-frame padding from 32 px to 16 px at the 900 px media-query
  // breakpoint; the legend chip positioning has to follow that change so
  // bullet page-X equals track-line page-X at every viewport. The legend
  // and the frame share the same max-width and auto-margin, so their left
  // edges always coincide — the only responsive variable is the horizontal
  // padding on .pt-frame.
  const [framePadX, setFramePadX] = useState(32);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = el.closest('.pt-frame');
    const measure = () => {
      setWidth(el.offsetWidth);
      if (frame) {
        const pad = parseFloat(getComputedStyle(frame).paddingLeft);
        if (Number.isFinite(pad)) setFramePadX(pad);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visibleTrackIds = useMemo(() => tracks.map(t => t.id), [tracks]);
  const layoutMetrics = useMemo(
    () => buildLayoutMetrics({ width, visibleCount: N, cfg }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, N, cfg.minLabelWidth, cfg.labelWidth, cfg.lanePadding, cfg.labelOffset]
  );
  const effectiveLabelWidth = layoutMetrics.effectiveLabelWidth;

  const { trackData, canvasH } = useMemo(() => {
    const tracksOut = tracks.map((track, idx) => {
      const x = getTrackColumnX(track.id, visibleTrackIds, layoutMetrics);
      const segments = computeTrackSegments(track, axis, cfg.segmentGapDays);
      const labelInputs = segments.map(s => ({
        preferredY: s.headY,
        height: cfg.labelHeight,
      }));
      const labelYs = packLabelsTopDown(labelInputs, cfg.minLabelGap);
      return { ...track, x, segments, labelYs, idx, labelWidth: effectiveLabelWidth };
    });
    let maxLabelBottom = 0;
    for (const t of tracksOut) {
      for (const ly of t.labelYs) {
        maxLabelBottom = Math.max(maxLabelBottom, ly + cfg.labelHeight / 2);
      }
    }
    const canvasH = Math.max(axis.canvasHeight, maxLabelBottom + 24);
    return { trackData: tracksOut, canvasH };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, visibleTrackIds, layoutMetrics, axis, cfg.segmentGapDays, cfg.labelHeight, cfg.minLabelGap]);

  return (
    <div className={"pt-root " + (className || "")}>
      <PTLegend
        tracks={rawTracks}
        hidden={hidden}
        onToggle={toggleHidden}
        visibleTrackIds={visibleTrackIds}
        layoutMetrics={layoutMetrics}
        width={width}
        cfg={cfg}
        framePad={framePadX}
        yearsRailW={88}
      />
      <div className="pt-frame">
        <div
          className="pt-canvas"
          style={{
            "--pt-line-w": cfg.lineWidth + "px",
            "--pt-dot-w":  cfg.dotSize + "px",
            "--pt-years-w": "88px",
            "--pt-eras-w":  "200px",
            height: canvasH,
          }}
        >
          <PTYearsRail axis={axis} />
          <div ref={ref} className="pt-routes" style={{ height: canvasH }}>
            <PTEraTints axis={axis} />
            {width > 0 && (
              <svg
                className="pt-routes-svg"
                viewBox={`0 0 ${width} ${canvasH}`}
                preserveAspectRatio="none"
              >
                {trackData.map(t => (
                  <PTTrackLines key={t.id} track={t} />
                ))}
              </svg>
            )}
            {width > 0 && trackData.map(t => (
              <PTTrackCap key={"cap-" + t.id} track={t} />
            ))}
            {width > 0 && trackData.flatMap(t =>
              t.segments.map((seg, i) => (
                <PTStation
                  key={t.id + "-" + (seg.item.slug || i)}
                  track={t}
                  seg={seg}
                  labelY={t.labelYs[i]}
                  centerX={width / 2}
                  cfg={cfg}
                  onStationClick={onStationClick}
                  renderStation={renderStation}
                />
              ))
            )}
          </div>
          <PTErasRail axis={axis} />
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function PTLegend({ tracks, hidden, onToggle, visibleTrackIds, layoutMetrics, width, cfg, framePad = 32, yearsRailW = 88 }) {
  // BULLET ALIGNMENT IS THE INVARIANT. Every visible chip is column-locked
  // at its track's colX via getTrackColumnX() — the same function that
  // places the SVG track line, station dots, leader anchors, and track
  // cap. No conditional reflow, no flex-wrap fallback: the bullet is the
  // semantic anchor and must sit exactly above its track at every viewport.
  // Labels are secondary — they wrap (at spaces if possible, mid-word as
  // a last resort) inside the chip but never push the bullet off-axis.
  // Page-X of a track line = framePad + yearsRailW + getTrackColumnX(...).
  const ready = width > 0 && Array.isArray(visibleTrackIds) && layoutMetrics != null;

  let slotW = 160;
  if (ready && visibleTrackIds.length > 1) {
    const x0 = getTrackColumnX(visibleTrackIds[0], visibleTrackIds, layoutMetrics);
    const x1 = getTrackColumnX(visibleTrackIds[1], visibleTrackIds, layoutMetrics);
    slotW = Math.abs(x1 - x0);
  } else if (ready && visibleTrackIds.length === 1) {
    slotW = Math.max(160, width - cfg.lanePadding);
  }

  // Longest word width across every label, measured at the locked
  // legend typography (600 12.5 px Inter Tight). Floors the chip width
  // so no word ever has to break mid-character. Memoized on the labels.
  const labelKey = useMemo(
    () => tracks.map(t => t.label || "").join(""),
    [tracks]
  );
  const longestWordW = useMemo(() => {
    if (typeof document === "undefined") return 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "600 12.5px \"Inter Tight\", system-ui, sans-serif";
    let max = 0;
    for (const t of tracks) {
      const words = String(t.label || "").split(/\s+/).filter(Boolean);
      for (const w of words) {
        const m = ctx.measureText(w).width;
        if (m > max) max = m;
      }
    }
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey]);

  // Chip width has two floors: (1) the longest single word so labels
  // never need a mid-word break, (2) 40 px so the 28 px bullet still
  // fits if the labels somehow shrink to nothing. Chips happily extend
  // beyond their slot if minChipW > slotW - 8 — adjacent chips visually
  // crowd at very narrow viewports, but every bullet stays on its
  // track-X and no word ever breaks.
  const minChipW = Math.ceil(longestWordW + 16);
  const chipW = Math.max(40, minChipW, slotW - 8);

  // Fixed chip height so the BULLET sits at a constant Y across every
  // chip regardless of how many lines the label wraps to. The label is
  // pinned to the chip's bottom via justify-content: flex-end and grows
  // upward as it wraps. Single-line labels leave empty space above; the
  // bullet does not move.
  const chipH = 80;

  const hiddenList = tracks.filter(t => hidden.has(t.id));
  const hiddenIndexById = new Map(hiddenList.map((t, i) => [t.id, i]));

  return (
    <div className="pt-legend">
      <div
        className="pt-legend-inner"
        style={ready ? { position: "relative", display: "block", minHeight: chipH + 16 } : undefined}
      >
        <span className="pt-legend-title">Tracks</span>
        {tracks.map(t => {
          const isHidden = hidden.has(t.id);
          const colXRoutes = ready ? getTrackColumnX(t.id, visibleTrackIds, layoutMetrics) : null;
          const colX = (colXRoutes != null) ? framePad + yearsRailW + colXRoutes : null;
          let style;
          if (ready && !isHidden && colX != null) {
            style = {
              position: "absolute",
              left: colX,
              bottom: 0,
              transform: "translateX(-50%)",
              width: chipW,
              height: chipH,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 4,
              textAlign: "center",
            };
          } else if (ready && isHidden) {
            const hIdx = hiddenIndexById.get(t.id) ?? 0;
            style = {
              position: "absolute",
              right: 16 + hIdx * 132,
              top: 8,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            };
          } else {
            style = undefined;
          }
          return (
            <button
              key={t.id}
              className={"pt-legend-track pt-legend-track-locked" + (isHidden ? " is-hidden" : "")}
              type="button"
              onClick={() => onToggle(t.id)}
              aria-pressed={!isHidden}
              style={style}
            >
              <span className="pt-legend-caption">
                <span className="pt-legend-name">{t.label}</span>
              </span>
              <span
                className="pt-legend-bullet"
                style={{ background: isHidden ? "transparent" : t.color, borderColor: t.color }}
              >{t.code || ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PTYearsRail({ axis }) {
  // Year axis ticks only. Decade labels in bold, even-year minor ticks for
  // visual rhythm. Hinge annotations (era inflection points) render on the
  // right rail alongside the era labels — see PTErasRail.
  const ticks = [];
  const startY = axis.start.y;
  const endY = axis.end.y;
  for (let y = startY; y <= endY; y++) {
    const isDecade = y % 10 === 0;
    if (isDecade) {
      ticks.push(
        <div key={"d" + y} className="pt-yr-tick is-decade" style={{ top: axis.yAt({ y, m: 1, d: 1 }) }}>{y}</div>
      );
    } else if (y % 2 === 0) {
      ticks.push(
        <div key={"y" + y} className="pt-yr-tick" style={{ top: axis.yAt({ y, m: 6, d: 15 }) }}>{String(y).slice(2)}</div>
      );
    }
  }
  return <div className="pt-years-rail">{ticks}</div>;
}

function PTErasRail({ axis }) {
  return (
    <div className="pt-eras-rail">
      {axis.eras.map(z => {
        const a = axis.yAt(z.start);
        const b = axis.yAt(z.end);
        const top = Math.min(a, b);
        return (
          <div key={z.id} className="pt-zone-label" style={{ top: top + 14 }}>
            <span className="pt-zone-num">{z.num}</span>
            <span className="pt-zone-name">{z.name}</span>
          </div>
        );
      })}
      {axis.hinges.map((h, i) => (
        <div key={"hinge-" + i} className="pt-hinge-marker" style={{ top: axis.yAt(h) }}>
          <span className="pt-hinge-label">{h.label || h.y}</span>
          {h.note && <span className="pt-hinge-note">{h.note}</span>}
        </div>
      ))}
    </div>
  );
}

function PTEraTints({ axis }) {
  return (
    <>
      {axis.eras.map((z, i) => {
        const a = axis.yAt(z.start);
        const b = axis.yAt(z.end);
        const top = Math.min(a, b);
        const h = Math.abs(b - a);
        return (
          <div
            key={z.id}
            className={"pt-zone-tint " + (z.tintClass || `pt-zone-tint-${(i % 4) + 1}`)}
            style={{ top, height: h }}
          />
        );
      })}
      {axis.eras.slice(1).map(z => (
        <div key={"zr-" + z.id} className="pt-zone-rule" style={{ top: axis.yAt(z.start) }} />
      ))}
    </>
  );
}

function PTTrackLines({ track }) {
  return (
    <g>
      {track.segments.map((seg, i) => {
        if (seg.isPoint) return null;
        const y1 = seg.yTop;
        const y2 = seg.yBot;
        return (
          <line
            key={i}
            x1={track.x}
            x2={track.x}
            y1={y1}
            y2={y2}
            stroke={track.color}
            strokeLinecap="round"
            style={{ strokeWidth: "var(--pt-line-w, 14px)" }}
          />
        );
      })}
      {(() => {
        const tenured = track.segments.filter(s => !s.isPoint);
        const connectors = [];
        for (let i = 0; i < tenured.length - 1; i++) {
          const a = tenured[i], b = tenured[i + 1];
          const yA = Math.min(a.yBot, b.yTop);
          const yB = Math.max(a.yBot, b.yTop);
          if (yB - yA < 0.5) continue;
          connectors.push(
            <line
              key={"conn-" + i}
              x1={track.x}
              x2={track.x}
              y1={yA}
              y2={yB}
              stroke={track.color}
              strokeOpacity={0.35}
              strokeLinecap="round"
              strokeDasharray="4 6"
              style={{ strokeWidth: "calc(var(--pt-line-w, 14px) * 0.55)" }}
            />
          );
        }
        return connectors;
      })()}
    </g>
  );
}

function PTTrackCap({ track }) {
  if (track.segments.length === 0) return null;
  const top = Math.min(...track.segments.map(s => Math.min(s.yTop, s.yBot)));
  return (
    <div
      className="pt-track-cap"
      style={{
        background: track.color,
        left: track.x,
        top: top - 36,
      }}
    >{track.code || track.label?.slice(0, 1) || ""}</div>
  );
}

function PTStation({ track, seg, labelY, centerX, cfg, onStationClick, renderStation }) {
  const item = seg.item;
  const parsed = ptParseDate(item.period_start);
  const period = ptFormatPeriod(parsed, item.period_display);
  const side = "right";
  // DOT Y IS SACRED: dot stays at the item's true date on the line, always.
  // The packer may move the LABEL in dense clusters; the leader becomes a
  // visible elbow (h-stub -> v-run -> short h-in) that tethers label to dot.
  const dotY = seg.headY;

  const labelLeft = track.x + cfg.labelOffset;

  const leaderH = {
    left: track.x,
    top: dotY,
    width: cfg.labelOffset,
  };
  const leaderVNeeded = Math.abs(labelY - dotY) > 0.5;
  const leaderV = leaderVNeeded ? {
    left: track.x + cfg.labelOffset,
    top: Math.min(labelY, dotY),
    height: Math.abs(labelY - dotY),
  } : null;
  const leaderIn = leaderVNeeded ? {
    left: track.x + cfg.labelOffset,
    top: labelY,
    width: Math.max(0, cfg.labelInset != null ? cfg.labelInset : 6),
  } : null;

  return (
    <button
      type="button"
      className={"pt-station pt-side-" + side}
      style={{ color: track.color }}
      onClick={() => onStationClick && onStationClick(item, track)}
    >
      <span className="pt-leader pt-leader-h" style={leaderH}></span>
      {leaderV && (
        <span className="pt-leader pt-leader-v" style={leaderV}></span>
      )}
      {leaderIn && (
        <span className="pt-leader pt-leader-h pt-leader-in" style={leaderIn}></span>
      )}
      <span
        className="pt-dot"
        style={{ left: track.x, top: dotY, borderColor: track.color }}
      ></span>
      {renderStation ? (
        renderStation({ item, track, x: labelLeft, y: labelY, side, width: cfg.labelWidth })
      ) : (
        <span
          className={"pt-label pt-label-" + side}
          style={{
            left: labelLeft,
            top: labelY,
            width: track.labelWidth || cfg.labelWidth,
            "--pt-title-lines": cfg.titleLines,
            [side === "right" ? "borderLeftColor" : "borderRightColor"]: track.color,
          }}
        >
          <span className="pt-label-period">{period}</span>
          <span className="pt-label-title">{item.title}</span>
          {cfg.showRoleInLabel && item.role && <span className="pt-label-role">{item.role}</span>}
        </span>
      )}
    </button>
  );
}


export { ParallelTracks, ptParseDate, ptFormatPeriod };
