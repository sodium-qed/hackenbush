import { chooseMove, inspectGraph, prepareGraph } from './strategy.js?v=7';
import { otherSide } from './rules.js';

function count(mask) {
  let size = 0;
  for (; mask; mask &= mask - 1n) size++;
  return size;
}

function fraction(value, denominator) {
  if (!value) return '0';
  while (denominator > 1n && !(value & 1n)) {
    value /= 2n;
    denominator /= 2n;
  }
  return denominator === 1n ? String(value) : value + '/' + denominator;
}

function sign(value) {
  return value === 0n ? 0 : value > 0n ? 1 : -1;
}

export function dyadicChange(before, after) {
  const [a, b = 1n] = before.split('/').map(BigInt);
  const [c, d = 1n] = after.split('/').map(BigInt);
  const common = b > d ? b : d;
  const difference = c * (common / d) - a * (common / b);
  return (difference > 0n ? '+' : '') + fraction(difference, common);
}

// The birthday of any position is at most the number of live edges. Scaling
// every value by 2^E therefore represents every option in this search exactly,
// including tiny fractions added to large integers on a different component.
function numericAnalysis(graph, opening, exactDeadline) {
  const unit = 1n << BigInt(graph.edges.length);
  const stride = BigInt(graph.incident.length);
  const keyFor = (mask, root) => mask * stride + BigInt(root);
  const shapes = new Map([[keyFor(opening.mask, 0), opening]]);
  const values = new Map();
  const structuralMisses = new Set();
  const { blue, red } = graph.colors;

  function shapeFor(mask, root) {
    const key = keyFor(mask, root);
    if (shapes.has(key)) return shapes.get(key);
    const shape = inspectGraph(graph, mask, root);
    if (shapes.size < 1000) shapes.set(key, shape);
    return shape;
  }

  // A Blue edge under a number makes the ordinal sum 1:x. A Red edge
  // reflects both the argument and the result through zero.
  function supported(color, value) {
    if (color === 'red') return -supported('blue', -value);
    if (value >= 0n) return unit + value;
    return (2n * unit + value % unit) >> (1n - value / unit);
  }

  function simplest(left, right) {
    if ((left === null || left < 0n) && (right === null || right > 0n)) return 0n;
    if (right !== null && right <= 0n) return -simplest(-right, left === null ? null : -left);
    for (let step = unit; step; step >>= 1n) {
      const candidate = (left / step + 1n) * step;
      if (right === null || candidate < right) return candidate;
    }
    throw new RangeError('Red–Blue options exceed the position’s dyadic resolution.');
  }

  function edgeFor(bit) { return graph.edges[graph.bitIndex.get(bit)]; }
  function neighbor(edge, vertex) { return edge.a === vertex ? edge.b : edge.a; }

  function treeValue(mask, root, parent = 0n) {
    let sum = 0n;
    for (let bits = graph.incident[root] & mask & ~parent; bits; bits &= bits - 1n) {
      const bit = bits & -bits;
      const edge = edgeFor(bit);
      const next = neighbor(edge, root);
      const above = next === root ? 0n : treeValue(mask, next, bit);
      sum += supported(edge.color, above);
    }
    return sum;
  }

  function singleSupport(mask, root) {
    const attached = mask & graph.incident[root];
    return attached && !(attached & (attached - 1n)) ? attached : 0n;
  }

  function exact(mask, root, search) {
    if (!mask) return 0n;
    const key = keyFor(mask, root);
    if (values.has(key)) return values.get(key);
    if (!search && structuralMisses.has(key)) return null;

    let value = null;
    if (!(mask & red) || !(mask & blue) || !(mask & ~graph.incident[root])) {
      value = BigInt(count(mask & blue) - count(mask & red)) * unit;
    } else {
      const shape = shapeFor(mask, root);
      if (!shape.cyclic) {
        value = treeValue(mask, root);
      } else if (shape.parts.length > 1) {
        value = 0n;
        for (const part of shape.parts) {
          const summand = exact(part.mask, root, search);
          if (summand === null) { value = null; break; }
          value += summand;
        }
      } else {
        const stem = singleSupport(mask, root);
        if (stem) {
          const edge = edgeFor(stem);
          const above = exact(mask & ~stem, neighbor(edge, root), search);
          if (above !== null) value = supported(edge.color, above);
        } else if (search && (shape.cycleRank <= 2 || count(mask) <= 20) && performance.now() < exactDeadline) {
          let left = null, right = null, complete = true;
          for (let cuts = mask; cuts; cuts &= cuts - 1n) {
            if (performance.now() >= exactDeadline) { complete = false; break; }
            const bit = cuts & -cuts;
            const child = exact(mask & ~shape.drops[graph.bitIndex.get(bit)], root, true);
            if (child === null) { complete = false; break; }
            if (bit & blue) {
              if (left === null || child > left) left = child;
            } else if (right === null || child < right) right = child;
          }
          if (complete) value = simplest(left, right);
        }
      }
    }
    if (value !== null) values.set(key, value);
    else if (!search) structuralMisses.add(key);
    return value;
  }

  function fixed(value) {
    return { lo: value, hi: value, loOpen: false, hiOpen: false };
  }

  function add(total, part) {
    total.lo += part.lo;
    total.hi += part.hi;
    total.loOpen ||= part.loOpen;
    total.hiOpen ||= part.hiOpen;
  }

  function structuralBounds(mask, root) {
    const known = exact(mask, root, false);
    if (known !== null) return fixed(known);
    const shape = shapeFor(mask, root);
    if (shape.parts.length > 1) {
      const total = fixed(0n);
      for (const part of shape.parts) add(total, structuralBounds(part.mask, root));
      return total;
    }
    const stem = singleSupport(mask, root);
    if (stem) {
      const edge = edgeFor(stem);
      const above = structuralBounds(mask & ~stem, neighbor(edge, root));
      return { ...above, lo: supported(edge.color, above.lo), hi: supported(edge.color, above.hi) };
    }
    // At least one Blue cut lowers the number strictly; cutting Blue until
    // none remain leaves at most the original number of Red branches. The
    // upper bound follows by exchanging colors.
    return { lo: -BigInt(count(mask & red)) * unit, hi: BigInt(count(mask & blue)) * unit,
      loOpen: true, hiOpen: true };
  }

  function certify(mask, color, bounds, deadline) {
    const lower = color === 'blue';
    const own = graph.colors[color];
    const opposing = graph.colors[otherSide(color)];
    let current = mask;
    while (current && performance.now() < deadline) {
      const shape = shapeFor(current, 0);
      let unresolved = 0n;
      for (const part of shape.parts) {
        if (exact(part.mask, 0, false) === null) unresolved |= part.mask;
      }
      const available = unresolved & own;
      if (!available) break;

      // A cycle cut keeps every other branch standing. When only bridges of
      // this color remain, prefer one that sheds the most opposing branches.
      const cyclic = shape.cyclic & available;
      let drop = 0n;
      if (cyclic) drop = cyclic & -cyclic;
      else {
        let best = -Infinity;
        for (let cuts = available; cuts; cuts &= cuts - 1n) {
          const removed = shape.drops[graph.bitIndex.get(cuts & -cuts)];
          const score = count(removed & opposing) - count(removed & own);
          if (score > best) { best = score; drop = removed; }
        }
      }
      current &= ~drop;
      const next = structuralBounds(current, 0);
      // Every actual move in this sequence was by the same color. Its final
      // lower/upper endpoint is therefore a strict bound on the original.
      if (lower && next.lo >= bounds.lo) { bounds.lo = next.lo; bounds.loOpen = true; }
      if (!lower && next.hi <= bounds.hi) { bounds.hi = next.hi; bounds.hiOpen = true; }
    }
  }

  function evaluate(mask, deadline) {
    const known = exact(mask, 0, true);
    if (known !== null) return { number: fraction(known, unit), sign: sign(known) };
    // Some independent pieces may follow an unresolved component in the DFS.
    // Price those too, even when the whole sum could not be evaluated.
    const parts = shapeFor(mask, 0).parts;
    if (parts.length > 1) for (const part of parts) exact(part.mask, 0, true);
    const bounds = structuralBounds(mask, 0);
    if (bounds.lo === bounds.hi) return { number: fraction(bounds.lo, unit), sign: sign(bounds.lo) };
    const now = performance.now();
    certify(mask, 'blue', bounds, now + Math.max(0, deadline - now) / 2);
    certify(mask, 'red', bounds, deadline);
    return { lower: fraction(bounds.lo, unit), upper: fraction(bounds.hi, unit),
      lowerOpen: bounds.loOpen, upperOpen: bounds.hiOpen,
      lowerSign: sign(bounds.lo), upperSign: sign(bounds.hi) };
  }

  return evaluate;
}

/** Analyze the standing position under untimed normal play. A winner is either
 * certified by graph arithmetic / search or explicitly null. */
export function analyzePosition(board, live, side, variant = 'redblue', { budgetMs = 220 } = {}) {
  const start = performance.now();
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 220;
  const graph = prepareGraph(board, live);
  const mask = (1n << BigInt(graph.edges.length)) - 1n;
  const opening = inspectGraph(graph, mask);
  const { green } = graph.colors;
  const greenOnly = mask ? green === mask : variant === 'green';
  const kind = greenOnly ? 'green' : green ? 'mixed' : 'redblue';
  if (greenOnly) return { kind, exact: true, nimber: opening.nim, winner: opening.nim ? side : otherSide(side) };

  let nimber = 0, numeric = 0n, interwoven = false;
  for (const part of opening.parts) {
    const shared = part.mask & green;
    if (!shared) numeric |= part.mask;
    else if (shared === part.mask) nimber ^= part.nim;
    else if (!(part.mask & ~graph.incident[0])) {
      nimber ^= count(shared) % 2;
      numeric |= part.mask & ~green;
    } else interwoven = true;
  }

  let result = { kind, exact: false, winner: null };
  if (!interwoven) {
    const evaluate = numericAnalysis(graph, opening, start + budget * .52);
    const value = evaluate(numeric, start + budget * .82);
    const zeroWinner = nimber ? side : otherSide(side);
    if (value.number !== undefined) {
      return { kind, exact: true, number: value.number, nimber,
        winner: value.sign ? (value.sign > 0 ? 'blue' : 'red') : zeroWinner };
    }
    result = { ...result, nimber, lower: value.lower, upper: value.upper,
      lowerOpen: value.lowerOpen, upperOpen: value.upperOpen };
    if (value.lowerSign > 0 || (value.lowerSign === 0 && (value.lowerOpen || zeroWinner === 'blue'))) result.winner = 'blue';
    if (value.upperSign < 0 || (value.upperSign === 0 && (value.upperOpen || zeroWinner === 'red'))) result.winner = 'red';
  }

  if (!result.winner) {
    if (!(graph.allowed[side] & mask)) result.winner = otherSide(side);
    else if (!(graph.allowed[otherSide(side)] & mask)) result.winner = side;
    else {
      const remaining = start + budget - performance.now();
      if (remaining > 0) {
        const proof = chooseMove(board, live, side, { budgetMs: remaining });
        if (proof.proven) result.winner = proof.winning ? side : otherSide(side);
      }
    }
  }
  return result;
}
