export const REACTIONS = [
  { kind: 'heart', label: 'Love', glyph: '♥' },
  { kind: 'spark', label: 'Inspiring', glyph: '✦' },
  { kind: 'laugh', label: 'Made me laugh', glyph: '☺' },
  { kind: 'sad', label: 'That is hard', glyph: '☂' },
];

export const EMPTY_REACTIONS = { counts: { heart: 0, spark: 0, laugh: 0, sad: 0 }, total: 0, myReaction: null };

// Optimistic local update used by both posts and messages. The server reply
// replaces it, but the UI should not wait for the round trip.
export function applyReaction(summary = EMPTY_REACTIONS, nextKind) {
  const counts = { ...EMPTY_REACTIONS.counts, ...(summary.counts || {}) };
  const current = summary.myReaction || null;
  if (current) counts[current] = Math.max((counts[current] || 0) - 1, 0);
  if (nextKind) counts[nextKind] = (counts[nextKind] || 0) + 1;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return { counts, total, myReaction: nextKind || null };
}

export function reactionRequest(baseUrl, summary, kind) {
  const removing = summary?.myReaction === kind;
  return removing ? { method: 'delete', url: `${baseUrl}/react` } : { method: 'put', url: `${baseUrl}/react`, data: { kind } };
}
