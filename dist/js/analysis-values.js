import { inspectGraph, prepareGraph } from './strategy.js?v=9';
import { otherSide } from './rules.js';
import { fixed, fraction, intersect, numberOption, onlyLatticePoint, simplest, sumOf, supported } from './analysis-dyadics.js';
import { oppositeGraphs } from './analysis-symmetry.js';
import { compressHangingTrees } from './analysis-reductions.js';

export { dyadicChange } from './analysis-dyadics.js';

function count(mask) {
  let size = 0;
  for (; mask; mask &= mask - 1n) size++;
  return size;
}

function boundedTable(limit, counters) {
  const entries = new Map();
  return {
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        counters.cacheHits++;
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key, value) {
      entries.delete(key);
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      entries.set(key, value);
      return value;
    },
  };
}

function singleBit(mask) {
  return mask && !(mask & (mask - 1n)) ? mask : 0n;
}

function isExact(bounds) { return bounds.lo === bounds.hi; }

// Return true/false only when every number in the interval answers alike.
function knownOrder(bounds, q, atLeast) {
  if (atLeast) {
    if (bounds.lo >= q) return true;
    if (bounds.hi < q || (bounds.hi === q && bounds.hiOpen)) return false;
  } else {
    if (bounds.hi <= q) return true;
    if (bounds.lo > q || (bounds.lo === q && bounds.loOpen)) return false;
  }
  return null;
}

function numericSolver(graph, mask, shapeFor, cuts, maxEntries, counters) {
  const unit = 1n << BigInt(graph.edges.length);
  const stride = BigInt(graph.incident.length);
  const { red, blue } = graph.colors;
  const values = boundedTable(maxEntries, counters);
  const cancellations = boundedTable(Math.max(4, Math.floor(maxEntries / 16)), counters);
  const keyFor = (m, root) => m * stride + BigInt(root);
  const edgeFor = bit => graph.edges[graph.bitIndex.get(bit)];
  const neighbor = (edge, root) => edge.a === root ? edge.b : edge.a;
  // Pin the public certificate independently of cache eviction.
  let openingBounds;

  function treeValue(m, root, parent = 0n) {
    let sum = 0n;
    for (let bits = graph.incident[root] & m & ~parent; bits; bits &= bits - 1n) {
      const bit = bits & -bits;
      const edge = edgeFor(bit);
      const next = neighbor(edge, root);
      const above = next === root ? 0n : treeValue(m, next, bit);
      sum += supported(edge.color, fixed(above), unit).lo;
    }
    return sum;
  }

  function store(m, root, bounds) {
    if (m === mask && !root) openingBounds = bounds;
    return values.set(keyFor(m, root), bounds);
  }

  // Count edges still connected to the base after deleting the other color.
  function secureCount(own, root) {
    let reached = 0n, frontier = own & graph.incident[root], total = 0;
    while (frontier) {
      const bit = frontier & -frontier;
      reached |= bit;
      const edge = edgeFor(bit);
      frontier = (frontier | ((graph.incident[edge.a] | graph.incident[edge.b]) & own)) & ~reached;
      total++;
    }
    return total;
  }

  function materialBounds(m, root, b, r) {
    const safeBlue = secureCount(m & blue, root);
    const safeRed = secureCount(m & red, root);
    // Cutting only Blue until none remains leaves exactly -safeRed; exchange
    // colors for the upper endpoint. Both sequences are nonempty here.
    const cutAll = { lo: -BigInt(safeRed) * unit, hi: BigInt(safeBlue) * unit, loOpen: true, hiOpen: true };
    // Blue can spend each secured edge without losing another secured edge
    // (cycle edges first, then tree leaves), while Red has at most r moves.
    // Add integer waiting moves to compare with safeBlue - r. Reflect for Red.
    return intersect(cutAll, { lo: BigInt(safeBlue - r) * unit, hi: BigInt(b - safeRed) * unit,
      loOpen: false, hiOpen: false });
  }

  // Each structural fact is eager and independent of the search budget. A
  // zero-budget reader always gets exact trees or a valid opening enclosure.
  function boundsFor(m, root) {
    if (!m) return fixed(0n);
    if (m === mask && !root && openingBounds) return openingBounds;
    const cached = values.get(keyFor(m, root));
    if (cached) return cached;
    const b = count(m & blue), r = count(m & red);
    let bounds;
    if (!r || !b || !(m & ~graph.incident[root])) {
      bounds = fixed(BigInt(b - r) * unit);
    } else {
      const shape = shapeFor(m, root);
      if (!shape.cyclic) bounds = fixed(treeValue(m, root));
      else if (shape.parts.length > 1) {
        bounds = shape.parts.reduce((total, part) => sumOf(total, boundsFor(part.mask, root)), fixed(0n));
      } else {
        const stem = singleBit(m & graph.incident[root]);
        if (stem) {
          const edge = edgeFor(stem);
          bounds = supported(edge.color, boundsFor(m & ~stem, neighbor(edge, root)), unit);
        } else {
          bounds = materialBounds(m, root, b, r);
        }
      }
    }
    return store(m, root, bounds);
  }

  function publish(m, root, bounds) {
    const tighter = intersect(boundsFor(m, root), bounds);
    return store(m, root, onlyLatticePoint(tighter, count(m), unit));
  }

  function endpoint(m, root, lower, q, open) {
    const previous = boundsFor(m, root);
    const warranted = lower ? { ...previous, lo: q, loOpen: open } : { ...previous, hi: q, hiOpen: open };
    return publish(m, root, warranted);
  }

  // Propagate stronger child facts even when the search of a sibling paused.
  function refresh(m, root) {
    const previous = boundsFor(m, root);
    if (isExact(previous)) return previous;
    const residual = cancellations.get(keyFor(m, root));
    if (residual !== undefined) return publish(m, root, refresh(residual, root));
    const shape = shapeFor(m, root);
    if (shape.parts.length > 1) {
      const sum = shape.parts.reduce((total, part) => sumOf(total, refresh(part.mask, root)), fixed(0n));
      return publish(m, root, sum);
    }
    const stem = singleBit(m & graph.incident[root]);
    if (stem) {
      const edge = edgeFor(stem);
      return publish(m, root, supported(edge.color, refresh(m & ~stem, neighbor(edge, root)), unit));
    }
    return previous;
  }

  // Ignore shape drawings and vertex labels. A match must verify a rooted,
  // color-reversed multigraph bijection before claiming V + (-V) = 0.
  function* symmetry(m, root) {
    if (isExact(boundsFor(m, root))) return;
    yield;
    const shape = shapeFor(m, root);
    if (shape.parts.length > 1) {
      let residual = m;
      const unknown = shape.parts.filter(part => !isExact(boundsFor(part.mask, root)));
      for (let i = 0; i < unknown.length; i++) {
        const a = unknown[i].mask;
        if (!(residual & a)) continue;
        for (let j = i + 1; j < unknown.length; j++) {
          const b = unknown[j].mask;
          if (!(residual & b) || count(a & blue) !== count(b & red) || count(a & red) !== count(b & blue)) continue;
          if (yield* oppositeGraphs(graph, a, b, root)) {
            residual &= ~(a | b);
            cancellations.set(keyFor(m, root), residual);
            publish(m, root, boundsFor(residual, root));
            break;
          }
        }
      }
      for (const { mask: part } of unknown) if (part & residual) yield* symmetry(part, root);
    } else {
      const stem = singleBit(m & graph.incident[root]);
      if (stem) {
        yield* symmetry(m & ~stem, neighbor(edgeFor(stem), root));
      } else if (count(m & blue) === count(m & red) && (yield* oppositeGraphs(graph, m, m, root))) {
        publish(m, root, fixed(0n));
      }
    }
    refresh(m, root);
  }

  // Every actual Blue move is strictly downward in a number, and every Red
  // move strictly upward. Even a nonalternating path gives a valid endpoint.
  function* cutWitness(side, cycleFirst = false) {
    const lower = side === 'blue';
    let current = mask;
    while (current && !isExact(boundsFor(current, 0)) && !isExact(openingBounds)) {
      yield;
      const shape = shapeFor(current, 0);
      let unknown = 0n;
      for (const part of shape.parts) {
        if (!isExact(boundsFor(part.mask, 0))) unknown |= part.mask;
      }
      const available = unknown & graph.colors[side];
      if (!available) break;
      const cyclic = available & shape.cyclic;
      if (cycleFirst && cyclic) current &= ~(cyclic & -cyclic);
      else current = cuts(current, 0, available, side)[0].next;
      const child = boundsFor(current, 0);
      endpoint(mask, 0, lower, lower ? child.lo : child.hi, true);
    }
  }

  // Simplicity is monotone in both option extrema on its valid domain:
  // if two shifted intervals gave oppositely ordered simplest numbers, both
  // numbers would lie inside both intervals, contradicting uniqueness.
  function* optionEnvelope(m, root, depth) {
    if (isExact(boundsFor(m, root))) return;
    yield;
    const shape = shapeFor(m, root);
    if (shape.parts.length > 1) {
      for (const part of shape.parts) {
        yield* optionEnvelope(part.mask, root, depth);
        refresh(m, root);
      }
      return;
    }
    const stem = singleBit(m & graph.incident[root]);
    if (stem) {
      yield* optionEnvelope(m & ~stem, neighbor(edgeFor(stem), root), depth);
      refresh(m, root);
      return;
    }
    let leftLo = null, leftHi = null, rightLo = null, rightHi = null;
    for (const { next, side } of cuts(m, root, m)) {
      if (isExact(boundsFor(m, root))) return;
      yield;
      if (depth > 1) yield* optionEnvelope(next, root, depth - 1);
      const b = boundsFor(next, root);
      if (side === 'blue') {
        if (leftLo === null || b.lo > leftLo) leftLo = b.lo;
        if (leftHi === null || b.hi > leftHi) leftHi = b.hi;
        endpoint(m, root, true, b.lo, true);
      } else {
        if (rightLo === null || b.lo < rightLo) rightLo = b.lo;
        if (rightHi === null || b.hi < rightHi) rightHi = b.hi;
        endpoint(m, root, false, b.hi, true);
      }
    }
    // Endpoint approximants may overlap, or be consecutive on the working
    // grid. Use simplicity only when a representable interior point exists.
    if (leftLo === null || rightLo === null || leftLo + 1n < rightLo) {
      endpoint(m, root, true, simplest(leftLo, rightLo, unit), false);
    }
    if (leftHi === null || rightHi === null || leftHi + 1n < rightHi) {
      endpoint(m, root, false, simplest(leftHi, rightHi, unit), false);
    }
  }

  function* lookahead() {
    for (const depth of [1, 2, 3]) yield* optionEnvelope(mask, 0, depth);
  }

  // Conway comparison. G >= q iff no Red option is <= q and no canonical
  // Left option of q is >= G. The reversed test exchanges both colors/roles.
  // Failure of a weak comparison is a *strict* opposite inequality for numbers.
  function* compare(m, root, q, atLeast) {
    let bounds = boundsFor(m, root);
    let known = knownOrder(bounds, q, atLeast);
    if (known !== null) return known;
    yield;
    const residual = cancellations.get(keyFor(m, root));
    const shape = shapeFor(m, root);
    let answer;
    if (residual !== undefined) {
      answer = yield* compare(residual, root, q, atLeast);
    } else if (shape.parts.length > 1) {
      let offset = 0n, unknown = 0n;
      for (const part of shape.parts) {
        bounds = boundsFor(part.mask, root);
        if (isExact(bounds)) offset += bounds.lo;
        else unknown |= part.mask;
      }
      if (unknown !== m) answer = yield* compare(unknown, root, q - offset, atLeast);
    }
    if (answer === undefined) {
      const qOption = numberOption(q, atLeast, unit);
      answer = qOption === null || !(yield* compare(m, root, qOption, !atLeast));
      if (answer) {
        const side = atLeast ? 'red' : 'blue';
        for (const { next } of cuts(m, root, m & graph.colors[side], side)) {
          known = knownOrder(boundsFor(m, root), q, atLeast);
          if (known !== null) return known;
          yield;
          if (yield* compare(next, root, q, !atLeast)) { answer = false; break; }
        }
      }
    }
    endpoint(m, root, answer === atLeast, q, !answer);
    return answer;
  }

  function* thresholdSearch(zeroWinner) {
    const atLeast = zeroWinner === 'blue';
    while (!isExact(openingBounds)) {
      const b = refresh(mask, 0);
      if (isExact(b)) return;
      // Include a closed endpoint when picking the oldest admissible dyadic.
      const q = simplest(b.lo - (b.loOpen ? 0n : 1n), b.hi + (b.hiOpen ? 0n : 1n), unit);
      if (yield* compare(mask, 0, q, atLeast)) yield* compare(mask, 0, q, !atLeast);
    }
  }

  // A second route to the full value. At a knot it needs only extrema. An
  // option proved dominated by an already priced option can be skipped.
  function* exactValue(m, root) {
    let bounds = boundsFor(m, root);
    if (isExact(bounds)) return bounds.lo;
    yield;
    const residual = cancellations.get(keyFor(m, root));
    const shape = shapeFor(m, root);
    let value;
    if (residual !== undefined) value = yield* exactValue(residual, root);
    else if (shape.parts.length > 1) {
      value = 0n;
      for (const part of shape.parts) {
        value += yield* exactValue(part.mask, root);
        refresh(m, root);
      }
    } else {
      const stem = singleBit(m & graph.incident[root]);
      if (stem) {
        const edge = edgeFor(stem);
        const above = yield* exactValue(m & ~stem, neighbor(edge, root));
        value = supported(edge.color, fixed(above), unit).lo;
      } else {
        let left = null, right = null;
        for (const { next, side } of cuts(m, root, m)) {
          bounds = boundsFor(m, root);
          if (isExact(bounds)) return bounds.lo;
          yield;
          const child = boundsFor(next, root);
          const isBlue = side === 'blue';
          if (isBlue ? left !== null && child.hi <= left : right !== null && child.lo >= right) continue;
          // In a number all Left options lie strictly below every Right option.
          endpoint(m, root, isBlue, isBlue ? child.lo : child.hi, true);
          const option = yield* exactValue(next, root);
          if (isBlue && (left === null || option > left)) left = option;
          if (!isBlue && (right === null || option < right)) right = option;
          endpoint(m, root, isBlue, option, true);
        }
        value = simplest(left, right, unit);
      }
    }
    publish(m, root, fixed(value));
    return value;
  }

  openingBounds = boundsFor(mask, 0);
  return {
    done: () => isExact(openingBounds),
    tasks(zeroWinner) {
      return [cutWitness('blue', true), cutWitness('red', true), symmetry(mask, 0), thresholdSearch(zeroWinner),
        compare(mask, 0, 0n, zeroWinner !== 'blue'), exactValue(mask, 0), lookahead(),
        cutWitness('blue'), cutWitness('red')];
    },
    result(kind, nimber, zeroWinner) {
      const b = refresh(mask, 0);
      if (isExact(b)) return { kind, exact: true, number: fraction(b.lo, unit), nimber,
        winner: b.lo > 0n ? 'blue' : b.lo < 0n ? 'red' : zeroWinner };
      let winner = null;
      if (b.lo > 0n || (b.lo === 0n && (b.loOpen || zeroWinner === 'blue'))) winner = 'blue';
      if (b.hi < 0n || (b.hi === 0n && (b.hiOpen || zeroWinner === 'red'))) winner = 'red';
      return { kind, exact: false, nimber, lower: fraction(b.lo, unit), upper: fraction(b.hi, unit),
        lowerOpen: b.loOpen, upperOpen: b.hiOpen, winner };
    },
  };
}

function cap(value, fallback, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.floor(value))) : fallback;
}

function proofGraph(board, live, retained, counters) {
  const graph = prepareGraph(board, live);
  const mask = (1n << BigInt(graph.edges.length)) - 1n;
  const opening = inspectGraph(graph, mask);
  const stride = BigInt(graph.incident.length);
  const shapeCapacity = Math.max(2, Math.min(256, Math.floor(retained / 4),
    Math.floor(24000 / Math.max(1, graph.edges.length))));
  const shapes = boundedTable(shapeCapacity, counters);

  function shapeFor(m, root) {
    if (m === mask && !root) return opening;
    const key = m * stride + BigInt(root);
    return shapes.get(key) || shapes.set(key, inspectGraph(graph, m, root));
  }

  function cuts(m, root, available, player) {
    const shape = shapeFor(m, root);
    const families = graph.hasParallel ? new Set() : null;
    const moves = [];
    for (let bits = available; bits; bits &= bits - 1n) {
      const bit = bits & -bits;
      const index = graph.bitIndex.get(bit);
      const edge = graph.edges[index];
      if (families?.has(edge.family)) continue;
      families?.add(edge.family);
      const mover = player || edge.color;
      const removed = shape.drops[index];
      const gain = count(removed & graph.colors[otherSide(mover)]) - count(removed & graph.colors[mover]);
      moves.push({ next: m & ~removed, side: mover, score: 4 * gain + (bit & shape.cyclic ? 1 : 0) });
    }
    return moves.sort((a, b) => b.score - a.score);
  }

  return { graph, mask, opening, shapeFor, cuts };
}

/** A resumable proof for one immutable board, standing position and mover.
 * The mandatory structural pass is always available. Slices share exact
 * certificates, bounded transposition tables and suspended search frontiers. */
export function createAnalysisSession(board, live, side, variant = 'redblue', { maxEntries = 4096 } = {}) {
  const started = performance.now();
  const counters = { nodes: 0, cacheHits: 0 };
  const retained = Math.max(16, cap(maxEntries, 4096, 16384));
  const position = proofGraph(board, live, retained, counters);
  const { graph, opening, cuts, mask } = position;
  let searchEdges = graph.edges.length;
  const { green } = graph.colors;
  const greenOnly = mask ? green === mask : variant === 'green';
  const kind = greenOnly ? 'green' : green ? 'mixed' : 'redblue';
  let completed, numeric, nimber = 0, zeroWinner;
  const tasks = [];
  if (greenOnly) completed = { kind, exact: true, nimber: opening.nim, winner: opening.nim ? side : otherSide(side) };
  else {
    let colored = 0n, interwoven = false;
    for (const part of opening.parts) {
      const shared = part.mask & green;
      if (!shared) colored |= part.mask;
      else if (shared === part.mask) nimber ^= part.nim;
      else if (!(part.mask & ~graph.incident[0])) {
        nimber ^= count(shared) % 2;
        colored |= part.mask & ~green;
      } else interwoven = true;
    }

    if (interwoven) {
      const outcomes = boundedTable(retained, counters);
      function* wins(m, mover) {
        if (!(m & graph.allowed[mover])) return false;
        const opponent = otherSide(mover);
        if (!(m & graph.allowed[opponent])) return true;
        const key = m * 2n + BigInt(mover === 'red');
        const cached = outcomes.get(key);
        if (cached !== undefined) return cached;
        yield;
        for (const { next } of cuts(m, 0, m & graph.allowed[mover], mover)) {
          yield;
          if (!(yield* wins(next, opponent))) return outcomes.set(key, true);
        }
        return outcomes.set(key, false);
      }
      const immediate = !(mask & graph.allowed[side]) ? otherSide(side)
        : !(mask & graph.allowed[otherSide(side)]) ? side : null;
      if (immediate) completed = { kind, exact: false, winner: immediate };
      else tasks.push((function* () {
        const winning = yield* wins(mask, side);
        completed = { kind, exact: false, winner: winning ? side : otherSide(side) };
      })());
    } else {
      zeroWinner = nimber ? side : otherSide(side);
      let prepared = position;
      const compact = opening.cyclic && compressHangingTrees(graph, colored);
      if (compact) {
        prepared = proofGraph(compact, compact.edges.map(edge => edge.id), retained, counters);
        colored = prepared.mask;
      }
      searchEdges = count(colored);
      numeric = numericSolver(prepared.graph, colored, prepared.shapeFor, prepared.cuts, retained, counters);
      if (!numeric.done()) tasks.push(...numeric.tasks(zeroWinner));
    }
  }

  let durationMs = performance.now() - started;
  let first = true;
  return {
    refine({ budgetMs = 220, nodeLimit = 12000 } = {}) {
      const start = performance.now();
      const deadline = budgetMs === Infinity ? Infinity
        : start + Math.max(0, (Number.isFinite(budgetMs) ? budgetMs : 220) - (first ? durationMs : 0));
      first = false;
      const allowance = cap(nodeLimit, 12000, 1000000);
      const stopAt = counters.nodes + allowance;
      while (!completed && !numeric?.done() && tasks.length && counters.nodes < stopAt && performance.now() < deadline) {
        const task = tasks.shift();
        if (!task.next().done) {
          counters.nodes++;
          tasks.push(task);
        }
      }
      const result = completed || (numeric ? numeric.result(kind, nimber, zeroWinner) : { kind, exact: false, winner: null });
      if (result.exact) completed = result;
      const status = result.exact ? 'exact' : completed || !tasks.length ? 'search-complete'
        : counters.nodes >= stopAt ? 'node-limit' : 'time-limit';
      if (completed) tasks.length = 0;
      durationMs += performance.now() - start;
      return { ...result, ...counters, durationMs, searchEdges, status };
    },
  };
}

/** Existing one-shot callers keep their original wire format. */
export function analyzePosition(board, live, side, variant = 'redblue', options = {}) {
  const result = createAnalysisSession(board, live, side, variant, options).refine(options);
  if (options.stats) return result;
  const { nodes, cacheHits, durationMs, status, searchEdges, ...game } = result;
  return game;
}
