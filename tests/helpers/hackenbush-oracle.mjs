// Exhaustive small-board reference. This file deliberately imports no game code.
// Keep ground vertices separate and discover the frontier by rescanning edges.
export function makeBoard(connections, grounds = [0]) {
  const ids = new Set([...grounds, ...connections.flatMap(([a, b]) => [a, b])]);
  return {
    nodes: [...ids].map(id => ({ id, ground: grounds.includes(id) })),
    edges: connections.map(([a, b, color], i) => ({ id: 'e' + i, a, b, color }))
  };
}

function rational(p, q = 1n) {
  let a = p < 0n ? -p : p;
  let b = q;
  while (b !== 0n) [a, b] = [b, a % b];
  return { p: p / a, q: q / a };
}

export function parseRational(text) {
  const [p, q = 1n] = String(text).split('/').map(BigInt);
  if (q <= 0n) throw new RangeError('Expected a positive denominator');
  return rational(p, q);
}

export function compare(a, b) {
  const difference = a.p * b.q - b.p * a.q;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function formatRational({ p, q }) {
  return q === 1n ? String(p) : p + '/' + q;
}

// Descend the Conway sign-expansion tree, starting at zero. Unbounded
// children extend the integers; bounded children bisect two ancestors. The
// first candidate inside the open option interval has least birthday.
function simplest(left, right) {
  if (left && right && compare(left, right) >= 0) {
    throw new RangeError('The options do not define a number');
  }
  let lower = null;
  let upper = null;
  let candidate = rational(0n);
  for (;;) {
    if (left && compare(candidate, left) <= 0) lower = candidate;
    else if (right && compare(candidate, right) >= 0) upper = candidate;
    else return candidate;

    if (!upper) candidate = rational(lower.p + lower.q, lower.q);
    else if (!lower) candidate = rational(upper.p - upper.q, upper.q);
    else candidate = rational(lower.p * upper.q + upper.p * lower.q, 2n * lower.q * upper.q);
  }
}

export function createOracle(board, { interchangeableParallels = false } = {}) {
  const ground = board.nodes.filter(node => node.ground).map(node => node.id);
  const edges = new Map(board.edges.map(edge => [edge.id, edge]));

  function grounded(ids) {
    const reached = new Set(ground);
    const remaining = ids.map(id => edges.get(id));
    let before;
    do {
      before = reached.size;
      for (const { a, b } of remaining) {
        if (reached.has(a) || reached.has(b)) {
          reached.add(a);
          reached.add(b);
        }
      }
    } while (reached.size !== before);
    return remaining.filter(edge => reached.has(edge.a)).map(edge => edge.id);
  }

  const transitions = new Map();
  const numbers = new Map();
  const nimbers = new Map();
  const outcomes = { blue: new Map(), red: new Map() };
  const opening = grounded(board.edges.map(edge => edge.id));
  const keyOf = live => JSON.stringify(live);
  // One benchmark has 22 labelled edges but only seven endpoint/color types.
  // Permuting identical parallel edges is an isomorphism. Only memoized
  // numeric answers use this optional quotient; the rules enumerate each cut.
  let numberKey = keyOf;
  if (interchangeableParallels) {
    const vertex = new Map(board.nodes.map((node, i) => [node.id, i]));
    const family = new Map(board.edges.map(({ id, a, b, color }) => {
      const u = vertex.get(a), v = vertex.get(b);
      return [id, [Math.min(u, v), Math.max(u, v), color].join('/')];
    }));
    numberKey = live => JSON.stringify(live.map(id => family.get(id)).sort());
  }
  function options(live) {
    const key = keyOf(live);
    if (!transitions.has(key)) {
      transitions.set(key, live.map(id => ({
        id, color: edges.get(id).color, live: grounded(live.filter(other => other !== id))
      })));
    }
    return transitions.get(key);
  }

  function number(live = opening) {
    const key = numberKey(live);
    if (numbers.has(key)) return numbers.get(key);
    let left = null;
    let right = null;
    for (const move of options(live)) {
      if (move.color === 'green') throw new Error('Number oracle requires Red–Blue edges');
      const child = number(move.live);
      if (move.color === 'blue' && (!left || compare(child, left) > 0)) left = child;
      if (move.color === 'red' && (!right || compare(child, right) < 0)) right = child;
    }
    const value = simplest(left, right);
    numbers.set(key, value);
    return value;
  }

  function nimber(live = opening) {
    const key = keyOf(live);
    if (nimbers.has(key)) return nimbers.get(key);
    const reachable = new Set();
    for (const move of options(live)) {
      if (move.color !== 'green') throw new Error('Nimber oracle requires green edges');
      reachable.add(nimber(move.live));
    }
    let mex = 0;
    while (reachable.has(mex)) mex++;
    nimbers.set(key, mex);
    return mex;
  }

  // This independent question never asks for a number, nimber, or heuristic.
  function winner(live, side) {
    const cache = outcomes[side];
    const key = keyOf(live);
    if (cache.has(key)) return cache.get(key);
    const opponent = side === 'blue' ? 'red' : 'blue';
    const canWin = options(live).some(move =>
      (move.color === side || move.color === 'green') && winner(move.live, opponent) === side);
    const winningSide = canWin ? side : opponent;
    cache.set(key, winningSide);
    return winningSide;
  }

  function* positions() {
    const seen = new Set();
    const pending = [opening];
    while (pending.length) {
      const live = pending.pop();
      const key = keyOf(live);
      if (seen.has(key)) continue;
      seen.add(key);
      yield live;
      for (const move of options(live)) pending.push(move.live);
    }
  }
  return { opening, options, number, nimber, winner, positions };
}
