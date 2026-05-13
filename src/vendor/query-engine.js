// ============================================================================
// VENDORED from C:\jeff-data\jaylance\parallel-tracks\query-engine.jsx
// Copy date: 2026-05-13
// Library version: 2026-05-12
//
// SURGERY APPLIED for ES-module build (Vite):
//   1. Bottom-of-file `Object.assign(window, ...)` replaced with `export`.
//
// When re-vendoring after upstream changes: re-apply that patch.
// Everything else stays byte-for-byte identical.
// ============================================================================

// ---------- Date parsing (shared util — must match parallel-tracks.jsx) ----------
function qParseDate(str) {
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

function dateToDays(d) {
  if (!d) return null;
  return d.y * 365 + (d.m - 1) * 30 + (d.d || 15);
}

// ---------- Predicate atoms ----------
const PREDICATES = {
  collection(item, value) {
    const list = Array.isArray(value) ? value : [value];
    return list.includes(item.collection);
  },

  tags(item, value) {
    const list = Array.isArray(value) ? value : [value];
    const itemTags = item.tags || [];
    return list.every(t => itemTags.includes(t));
  },

  anyTags(item, value) {
    const list = Array.isArray(value) ? value : [value];
    const itemTags = item.tags || [];
    return list.some(t => itemTags.includes(t));
  },

  excludeTags(item, value) {
    const list = Array.isArray(value) ? value : [value];
    const itemTags = item.tags || [];
    return !list.some(t => itemTags.includes(t));
  },

  role(item, value) {
    const list = Array.isArray(value) ? value : [value];
    return list.some(r => (item.role || "").toLowerCase() === r.toLowerCase());
  },

  roleMatches(item, value) {
    const re = value instanceof RegExp ? value : new RegExp(value, "i");
    return re.test(item.role || "");
  },

  status(item, value) {
    return item.status === value;
  },

  visibility(item, value) {
    return item.visibility === value;
  },

  surfaceKind(item, value) {
    const list = Array.isArray(value) ? value : [value];
    return list.includes(item.surface_kind);
  },

  slugs(item, value) {
    const list = Array.isArray(value) ? value : [value];
    return list.includes(item.slug);
  },

  excludeSlugs(item, value) {
    const list = Array.isArray(value) ? value : [value];
    return !list.includes(item.slug);
  },

  dateRange(item, value) {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const winStart = qParseDate(value[0]);
    const winEnd   = qParseDate(value[1]);
    const itemStart = qParseDate(item.period_start);
    const itemEnd   = qParseDate(item.period_end) || itemStart;
    if (!itemStart || !winStart || !winEnd) return false;
    const a1 = dateToDays(itemStart), a2 = dateToDays(itemEnd);
    const b1 = dateToDays(winStart),  b2 = dateToDays(winEnd);
    return a1 <= b2 && a2 >= b1;
  },

  titleMatches(item, value) {
    const re = value instanceof RegExp ? value : new RegExp(value, "i");
    return re.test(item.title || "");
  },

  textMatches(item, value) {
    const re = value instanceof RegExp ? value : new RegExp(value, "i");
    const blob = [item.title, item.role, item.curator_note_md].filter(Boolean).join(" ");
    return re.test(blob);
  },
};

// ---------- Boolean combinators ----------
function matchQuery(item, query) {
  if (!query) return true;
  if (typeof query === "function") return !!query(item);

  if (Array.isArray(query.and)) {
    return query.and.every(q => matchQuery(item, q));
  }
  if (Array.isArray(query.or)) {
    return query.or.some(q => matchQuery(item, q));
  }
  if (query.not) {
    return !matchQuery(item, query.not);
  }

  for (const [key, value] of Object.entries(query)) {
    if (key === "and" || key === "or" || key === "not") continue;
    const pred = PREDICATES[key];
    if (!pred) {
      console.warn(`[query-engine] Unknown predicate: "${key}". Item:`, item.slug);
      continue;
    }
    if (!pred(item, value)) return false;
  }
  return true;
}

// ---------- Public API ----------

function queryItems(corpus, query) {
  if (!corpus || !Array.isArray(corpus.items)) return [];
  const matched = corpus.items.filter(it => matchQuery(it, query));
  return matched.slice().sort((a, b) => {
    const da = dateToDays(qParseDate(a.period_start));
    const db = dateToDays(qParseDate(b.period_start));
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return db - da;
  });
}

function resolveTracks(corpus, trackDefs, options = {}) {
  const multiRender = options.multiRender !== false;
  const claimed = new Set();
  const out = [];

  for (const def of trackDefs) {
    let items = queryItems(corpus, def.query);

    if (!multiRender) {
      items = items.filter(it => !claimed.has(it.slug));
      items.forEach(it => claimed.add(it.slug));
    } else if (def.exclusive) {
      items = items.filter(it => !claimed.has(it.slug));
      items.forEach(it => claimed.add(it.slug));
    } else {
      items.forEach(it => claimed.add(it.slug));
    }

    out.push({ ...def, items });
  }
  return out;
}

export { queryItems, resolveTracks, qParseDate };
