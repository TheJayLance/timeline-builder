// parallel-tracks.jsx — Layer 3 of the stack: the dumb renderer.
//
// <ParallelTracks
//   tracks={[
//     { id, label, color, code, items: [...] },
//     ...                                       // 1 to 6 tracks
//   ]}
//   timeAxis={{
//     start: { y: 1990, m: 1 },
//     end:   { y: 2027, m: 6 },
//     direction: "newest-top",                  // or "newest-bottom"
//     hinges:  [{ y: 2012, m: 1, label, note }],
//     eras:    [{ id, num, name, start, end }],
//     pxPerYearPre:  40,
//     pxPerYearPost: 130,
//   }}
//   config={{ lineWidth, dotSize, lanePadding, labelWidth, labelOffset, minLabelGap }}
//   onStationClick={(item, track) => …}
//   renderStation={(item, track) => …}        // optional override
// />
//
// The primitive does NOT load data. It does NOT know about jaylance, careers,
// coaching, or any subject matter. Hand it a tracks array; it draws. Same
// component renders a 5-track career map, a 2-track "poetry × software" view,
// or a 1-track filtered slice. The contract is the tracks array.

import React from 'react';
const { useState, useEffect, useMemo, useRef, useCallback } = React;

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
// Given an ordered list of labels each with a preferredY and a height, walk
// the list and snap each one to max(preferredY, prevBottom + minGap). Returns
// each label's resolved Y. Newest-top friendly: smaller Y is higher up.
// `startY` is the minimum Y allowed for the FIRST label's top edge — usually
// 0 or a small positive number so labels don't bleed above the canvas top.
function packLabelsTopDown(labels, minGap, startY = 0) {
  const out = new Array(labels.length);
  let prevBottom = startY;
  for (let i = 0; i < labels.length; i++) {
    const { preferredY, height } = labels[i];
    const top = Math.max(preferredY - height / 2, prevBottom + minGap);
    out[i] = top + height / 2;          // resolved center Y
    prevBottom = top + height;
  }
  return out;
}

// ---------- Orthogonal path (Beck-style) for future v2 dynamic columns ----------
// Currently unused — fixed-column v1 draws straight vertical segments. Kept
// here so a v2 layout that bends lines between columns can plug straight in.
function orthogonalPathD(points, radius = 0) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (radius <= 0) {
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
    return d;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], curr = points[i], next = points[i + 1];
    const d1x = prev.x - curr.x, d1y = prev.y - curr.y;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const len1 = Math.hypot(d1x, d1y);
    const len2 = Math.hypot(d2x, d2y);
    if (len1 < 0.5 || len2 < 0.5) { d += ` L ${curr.x} ${curr.y}`; continue; }
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const p1x = curr.x + (d1x / len1) * r;
    const p1y = curr.y + (d1y / len1) * r;
    const p2x = curr.x + (d2x / len2) * r;
    const p2y = curr.y + (d2y / len2) * r;
    d += ` L ${p1x} ${p1y} Q ${curr.x} ${curr.y}, ${p2x} ${p2y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// ---------- Per-track segment computation ----------
// Items become a list of segments [yTop, yBot, item, isOngoing]. Stations sit
// at the segment's "head" — which is the period_start side, regardless of
// axis direction.
function computeTrackSegments(track, axis, segmentGapDays) {
  const ongoingTail = 24; // px past the canvas end for "ongoing" segments
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

    // Head = period_start side. With newest-top, that's the LARGER Y (further
    // down the canvas, which is older… wait no: newest-top means small Y is
    // recent. period_start of a tenure is older than period_end. So with
    // newest-top, period_start sits at LARGER Y than period_end. Head = larger Y.)
    let yTop, yBot, headY;
    if (axis.direction === "newest-top") {
      yTop = Math.min(yStart, yEnd);
      yBot = Math.max(yStart, yEnd);
      headY = yStart; // period_start (older) is lower on the canvas
    } else {
      yTop = Math.min(yStart, yEnd);
      yBot = Math.max(yStart, yEnd);
      headY = yStart;
    }

    // Tenure detection: if start and end are within `segmentGapDays`, render
    // as a point (no segment line drawn beyond the dot).
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
  // Sort by yTop ascending (small Y = newest-end on newest-top axis)
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
  // Geometry config — every value falls back to tokens.json defaults.
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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function columnX(idx, count = N) {
    // Reserve gutter space to the right of the last column for that column's
    // labels — every track labels rightward, each track owns its own gutter,
    // no cross-track label collisions are possible.
    const labelReserve = effectiveLabelWidth + cfg.labelOffset + 16;
    const usable = Math.max(0, width - cfg.lanePadding - labelReserve);
    if (count === 1) return cfg.lanePadding + usable / 2;
    if (count <= 0) return 0;
    return cfg.lanePadding + (idx * usable) / (count - 1);
  }

  // Adaptive label width: shrink to fit when the canvas is narrow. Floor at
  // minLabelWidth so titles remain at least somewhat legible. Bounded above
  // by the configured labelWidth.
  const effectiveLabelWidth = Math.max(
    cfg.minLabelWidth,
    Math.min(
      cfg.labelWidth,
      (width - cfg.lanePadding) / Math.max(1, N) - cfg.labelOffset - 8
    )
  );

  // Per-track data: x, segments, label positions. Canvas height grows if
  // dense label packing would push labels past the natural axis-derived
  // height (real data won't trigger this; stress-test corpora often will).
  const { trackData, canvasH } = useMemo(() => {
    const tracksOut = tracks.map((track, idx) => {
      const x = columnX(idx);
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
  }, [tracks, axis, width, cfg.segmentGapDays, cfg.labelHeight, cfg.minLabelGap, cfg.lanePadding, effectiveLabelWidth]);

  return (
    <div className={"pt-root " + (className || "")}>
      <PTLegend
        tracks={rawTracks}
        hidden={hidden}
        onToggle={toggleHidden}
        columnX={columnX}
        width={width}
        cfg={cfg}
        framePad={32}
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

function PTLegend({ tracks, hidden, onToggle, columnX, width, cfg, framePad = 32, yearsRailW = 88 }) {
  // The legend used to be a flex row: chip left-edges spaced by text width,
  // so a bullet never reliably sat over its track. Now every chip's BULLET
  // is locked to its track's column X (the same columnX() the track line
  // uses), sharing one coordinate system — they move together when tracks
  // hide/show. The label/count detach from the bullet's horizontal position
  // and center beneath it within the column slot. Bullet alignment is the
  // hard constraint; label placement yields to it.
  //
  // Column-lock vs reflow: at viewports where the column slot is narrower
  // than the longest single word in any label, squeezing the chip would
  // force a mid-word break (e.g. "Photogra/phy"). When that would happen,
  // the legend reflows to a flex-wrap row where chips are content-sized
  // and column-lock is dropped — full single-line labels in (possibly two)
  // rows beats mid-word breaks in one row.
  const visible = tracks.filter(t => !hidden.has(t.id));
  const visibleIndexById = new Map(visible.map((t, i) => [t.id, i]));
  const ready = width > 0 && typeof columnX === "function";

  // Column slot width = the spacing between adjacent columns; the label gets
  // this much room centered under the bullet before it wraps/truncates.
  let slotW = 160;
  if (ready && visible.length > 1) {
    slotW = Math.abs(columnX(1, visible.length) - columnX(0, visible.length));
  } else if (ready && visible.length === 1) {
    slotW = Math.max(160, width - cfg.lanePadding);
  }

  // Hidden tracks have no column to point at. Park them in a compact row at
  // the far right of the bar, dimmed, so they're still toggle-back-on-able
  // without pretending to align to a track.
  const hiddenList = tracks.filter(t => hidden.has(t.id));
  const hiddenIndexById = new Map(hiddenList.map((t, i) => [t.id, i]));

  // Measure the chart canvas position relative to the legend's inner box so
  // chip-X aligns with track-X at every viewport — including responsive
  // breakpoints where .pt-frame padding shrinks below the legend's default
  // 32px. Without this, at vp <= 900 the legend uses 32px while the chart
  // uses 16px, and bullets sit 16px right of their track lines.
  const innerRef = useRef(null);
  const [routesOffset, setRoutesOffset] = useState(null);
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const root = inner.closest(".pt-root");
    if (!root) return;
    const routes = root.querySelector(".pt-routes");
    if (!routes) return;
    const compute = () => {
      const r = routes.getBoundingClientRect();
      const i = inner.getBoundingClientRect();
      setRoutesOffset(r.left - i.left);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(routes);
    ro.observe(inner);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, []);

  // Measure the longest SINGLE WORD across all labels at the legend's font
  // metrics. This is the column-lock floor: as long as the slot is wide
  // enough to hold the longest word, the chip can wrap multi-word labels at
  // spaces (text-wrap: balance keeps the wrap balanced, word-break: keep-all
  // forbids mid-word breaks). If the slot is narrower than even the longest
  // word, column-lock would force a mid-word break, so the legend reflows.
  // Multi-word labels wrap at spaces above this threshold; below it, all
  // chips become content-sized in a flex-wrap row.
  const longestWordPx = useMemo(() => {
    if (typeof document === "undefined") return 80;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = '600 12.5px "Inter Tight", system-ui, sans-serif';
      let max = 0;
      for (const t of tracks) {
        if (!t.label) continue;
        for (const word of String(t.label).split(/\s+/)) {
          if (!word) continue;
          const w = ctx.measureText(word).width;
          if (w > max) max = w;
        }
      }
      return max;
    } catch { return 80; }
  }, [tracks]);

  const chipMinForLock = Math.max(72, Math.ceil(longestWordPx) + 24);
  const canColumnLock = ready && (visible.length === 0 || slotW >= chipMinForLock);

  const innerStyle = !ready
    ? undefined
    : (canColumnLock
        ? { position: "relative", display: "block", minHeight: 56 }
        : { position: "relative", display: "flex", flexWrap: "wrap", gap: "8px 20px", alignItems: "center", justifyContent: "flex-start" });

  return (
    <div className="pt-legend">
      <div
        ref={innerRef}
        className={"pt-legend-inner" + (canColumnLock ? "" : " pt-legend-inner-flow")}
        style={innerStyle}
      >
        <span className="pt-legend-title">Tracks</span>
        {tracks.map(t => {
          const isHidden = hidden.has(t.id);
          const vIdx = visibleIndexById.get(t.id);
          // Page-X for this track's column center, relative to .pt-legend-inner.
          const colX = (canColumnLock && vIdx != null)
            ? (routesOffset != null ? routesOffset : framePad + yearsRailW) + columnX(vIdx, visible.length)
            : null;
          let style;
          if (canColumnLock && colX != null) {
            style = {
              position: "absolute",
              left: colX,
              top: 8,
              transform: "translateX(-50%)",
              width: Math.max(72, slotW - 8),
              display: "flex",
              // column-reverse so name renders above bullet without disturbing
              // the bullet's horizontal centering (Phase C column-lock).
              flexDirection: "column-reverse",
              alignItems: "center",
              gap: 4,
              textAlign: "center",
            };
          } else if (canColumnLock && isHidden) {
            // Parked: compact row hugging the right edge of the bar.
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
          } else if (!canColumnLock) {
            // Reflow mode: chip is a flex-wrap item, content-sized. Column-lock
            // is intentionally dropped here because honoring it would force a
            // mid-word break. Hidden chips just dim inline with the rest.
            style = {
              position: "static",
              display: "flex",
              flexDirection: "column-reverse",
              alignItems: "center",
              gap: 4,
              textAlign: "center",
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
              <span
                className="pt-legend-bullet"
                style={{ background: isHidden ? "transparent" : t.color, borderColor: t.color }}
              >{t.code || ""}</span>
              <span className="pt-legend-caption">
                <span className="pt-legend-name">{t.label}</span>
              </span>
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
  // For each non-point segment, draw a vertical capsule (rounded line).
  // For point segments, the station dot is drawn separately; no line needed.
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
      {/* Connector lines BETWEEN segments — same color but slightly thinner
          so the track reads as continuous when items don't quite touch. */}
      {(() => {
        const tenured = track.segments.filter(s => !s.isPoint);
        const connectors = [];
        for (let i = 0; i < tenured.length - 1; i++) {
          const a = tenured[i], b = tenured[i + 1];
          // Connector between yBot of `a` and yTop of `b` (in canvas Y, regardless of axis direction).
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
  // Cap = a labeled tab at the newest end of the track. Uses the smallest-Y
  // segment's headY (newest-top axis assumption).
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
  // Labels always go RIGHT — each track owns the gutter immediately right of
  // its column. This eliminates cross-track label collision entirely.
  const side = "right";

  // DOT Y IS SACRED. The dot sits at the item's true date on the track line,
  // ALWAYS. The collision packer (packLabelsTopDown) is allowed to relocate
  // the LABEL to avoid overlap in time-dense clusters, but it must never move
  // the dot. When labels fan out below their dots, the leader becomes a
  // visible elbow (horizontal stub from the dot, then a vertical run down to
  // the packed label's row, then a short horizontal into the card) so every
  // label stays unambiguously tethered to its real point on the line.
  const dotY = seg.headY;

  const labelLeft = track.x + cfg.labelOffset;

  // Horizontal stub leaving the dot, at the dot's TRUE y.
  const leaderH = {
    left: track.x,
    top: dotY,
    width: cfg.labelOffset,
  };
  // Vertical run bridging the gap between the dot's true y and the packed
  // label's y. Drawn whenever the packer displaced the label at all. This is
  // the tether that makes dense clusters readable instead of collapsing.
  const leaderVNeeded = Math.abs(labelY - dotY) > 0.5;
  const leaderV = leaderVNeeded ? {
    left: track.x + cfg.labelOffset,
    top: Math.min(labelY, dotY),
    height: Math.abs(labelY - dotY),
  } : null;
  // Short horizontal entering the label card at the label's y, only needed
  // when there was a vertical run (otherwise leaderH already reaches it).
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

// ---------- Exports (vendored ES-module form) ----------
export { ParallelTracks, ptParseDate, ptFormatPeriod };
