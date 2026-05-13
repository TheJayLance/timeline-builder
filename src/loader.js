// loader.js — fetches corpus + chart config from the canon URL.
//
// Two parallel HTTP requests. Returns { corpus, chartConfig } or throws.
// Browser HTTP cache is sufficient; no in-memory dedup needed for v1.

export const DEFAULT_CANON_BASE = 'https://thejaylance.github.io/canon-public/v1';

export async function loadTimelineData({ chart, canonBase }) {
  if (!chart) {
    throw new Error(`<jeff-timeline> requires a "chart" attribute.`);
  }
  const base = (canonBase || DEFAULT_CANON_BASE).replace(/\/+$/, '');

  const corpusUrl = `${base}/corpus.json`;
  const chartUrl = `${base}/charts/${encodeURIComponent(chart)}.json`;

  const [corpusRes, chartRes] = await Promise.all([
    fetch(corpusUrl),
    fetch(chartUrl),
  ]);

  if (!corpusRes.ok) {
    throw new Error(`Couldn't load timeline data (corpus fetch ${corpusRes.status}).`);
  }
  if (!chartRes.ok) {
    if (chartRes.status === 404) {
      throw new Error(`Chart "${chart}" not found.`);
    }
    throw new Error(`Couldn't load timeline data (chart fetch ${chartRes.status}).`);
  }

  const [corpus, chartConfig] = await Promise.all([
    corpusRes.json(),
    chartRes.json(),
  ]);

  return { corpus, chartConfig };
}
