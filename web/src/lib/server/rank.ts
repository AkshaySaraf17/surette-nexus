/**
 * Reciprocal-rank fusion (RRF): merge ranked lists (e.g. meaning-based and keyword search) so items
 * ranked well by either list rise to the top. k = 60 is the usual constant from the original paper.
 */
export function fuse<T extends { id: string }>(lists: T[][], top: number, k = 60): T[] {
  const scores = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    list.forEach((item, i) => {
      const entry = scores.get(item.id) ?? { item, score: 0 };
      entry.score += 1 / (k + i + 1);
      scores.set(item.id, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, top).map((e) => e.item);
}
