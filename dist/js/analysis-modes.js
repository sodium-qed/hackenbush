export const analysisModes = {
  quick: { label: 'Quick', rank: 1, budgetMs: 220, nodeLimit: 3000,
    cuts: { budgetMs: 15, nodeLimit: 160, maxMoves: 12 } },
  deep: { label: 'Deep', rank: 2, budgetMs: 2500, nodeLimit: 50000,
    cuts: { budgetMs: 60, nodeLimit: 1000, maxMoves: 32 } },
  research: { label: 'Research', rank: 3, budgetMs: 15000, nodeLimit: 300000,
    cuts: { budgetMs: 150, nodeLimit: 4000, maxMoves: 96 } },
  indefinite: { label: 'Indefinite', rank: 4, budgetMs: Infinity, nodeLimit: Infinity,
    cuts: { budgetMs: Infinity, nodeLimit: Infinity, maxMoves: Infinity } },
};

// Reading an entry keeps a frequently revisited replay position in the cache.
export function recentCache(capacity) {
  const entries = new Map();
  function set(key, value) {
    entries.delete(key);
    entries.set(key, value);
    if (entries.size > capacity) entries.delete(entries.keys().next().value);
    return value;
  }
  function get(key) {
    return entries.has(key) ? set(key, entries.get(key)) : undefined;
  }
  return { get, set };
}

export function proofLimit(result, mode) {
  if (!result) return null;
  if (result.exact) return 'exact';
  if (result.status === 'search-complete') return 'search-complete';
  if (result.nodes >= mode.nodeLimit) return 'node-limit';
  if (result.durationMs >= mode.budgetMs) return 'time-limit';
  return null;
}

export function certificateKey(result) {
  if (!result) return '';
  return JSON.stringify([result.kind, result.number, result.nimber, result.lower,
    result.lowerOpen, result.upper, result.upperOpen, result.winner]);
}

function compare(a, b) {
  const [p, q = 1n] = a.split('/').map(BigInt);
  const [r, s = 1n] = b.split('/').map(BigInt);
  const difference = p * s - r * q;
  return difference > 0n ? 1 : difference < 0n ? -1 : 0;
}

// A bounded worker may evict its search tree while the page still holds a
// certificate. Only intersect certificates for the same topology, live edges
// and side. Preserve strictness, even for dyadics below binary64 resolution.
export function intersectProof(previous, fresh, side) {
  if (!previous) return fresh;
  if (previous.kind !== fresh.kind || (previous.winner && fresh.winner && previous.winner !== fresh.winner) ||
      (previous.nimber !== undefined && fresh.nimber !== undefined && previous.nimber !== fresh.nimber)) {
    throw new Error('Inconsistent position certificates.');
  }
  if (previous.exact || fresh.exact) {
    const value = previous.exact ? previous : fresh;
    const other = previous.exact ? fresh : previous;
    if (other.exact && value.number !== other.number) throw new Error('Inconsistent exact values.');
    if (other.lower !== undefined) {
      const lo = compare(value.number, other.lower), hi = compare(value.number, other.upper);
      if (lo < 0 || hi > 0 || (!lo && other.lowerOpen) || (!hi && other.upperOpen)) {
        throw new Error('Exact value outside its certified interval.');
      }
    }
    return { ...value, nodes: fresh.nodes, durationMs: fresh.durationMs, cacheHits: fresh.cacheHits, status: 'exact' };
  }
  const result = { ...fresh, winner: fresh.winner || previous.winner };
  if (previous.lower === undefined) return result;
  if (result.lower === undefined) {
    Object.assign(result, { lower: previous.lower, lowerOpen: previous.lowerOpen,
      upper: previous.upper, upperOpen: previous.upperOpen, nimber: previous.nimber });
    return result;
  }
  for (const endpoint of ['lower', 'upper']) {
    const direction = compare(previous[endpoint], fresh[endpoint]);
    const open = endpoint + 'Open';
    if (endpoint === 'lower' ? direction > 0 : direction < 0) {
      result[endpoint] = previous[endpoint];
      result[open] = previous[open];
    } else if (direction === 0) result[open] ||= previous[open];
  }
  const gap = compare(result.lower, result.upper);
  if (gap > 0 || (gap === 0 && (result.lowerOpen || result.upperOpen))) {
    throw new Error('Disjoint position certificates.');
  }
  if (!gap) {
    const number = result.lower;
    const winner = number === '0' ? (result.nimber ? side : side === 'blue' ? 'red' : 'blue')
      : number.startsWith('-') ? 'red' : 'blue';
    return { kind: result.kind, exact: true, number, nimber: result.nimber, winner,
      nodes: result.nodes, durationMs: result.durationMs, cacheHits: result.cacheHits, status: 'exact' };
  }
  return result;
}
