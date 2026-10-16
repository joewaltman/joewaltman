// Jaro-Winkler similarity between two strings, 0 to 1.
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function tokens(s: string): string[] {
  return [...new Set(s.split(" ").filter(Boolean))];
}

// Words that are nearly identical ("PLUMBNG", "PLUMBING") count as shared, each word used once.
function sharedWords(a: string[], b: string[]): number {
  const unused = new Set(b);
  let shared = 0;
  for (const word of a) {
    let best: string | null = null;
    let bestScore = 0;
    for (const other of unused) {
      const score = word === other ? 1 : jaroWinkler(word, other);
      if (score > bestScore) [best, bestScore] = [other, score];
    }
    if (best !== null && bestScore >= 0.92) {
      unused.delete(best);
      shared++;
    }
  }
  return shared;
}

// Score for two already-normalized business names. Blends character similarity with
// word overlap, so "PACIFIC COAST PLUMBING" vs "PACIFIC COAST PLUMBING AND HEATING" scores lower
// than a one-letter typo.
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = sharedWords(ta, tb);
  const jaccard = shared / (ta.length + tb.length - shared);
  return Math.round((0.6 * jaroWinkler(a, b) + 0.4 * jaccard) * 1000) / 1000;
}
