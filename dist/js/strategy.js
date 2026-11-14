import { cutEdge, legalMoves, otherSide } from './rules.js';

// A 31-edge position fits in a positive JavaScript bit mask. The generator's
// boards are smaller. Larger custom boards still get a time-bounded legal move.
const MASK_LIMIT = 31;
const CYCLIC_NUMBER_LIMIT = 12;
const TIME_UP = Symbol('search deadline');

function count(bits) {
  let total = 0;
  for (; bits; bits &= bits - 1) total++;
  return total;
}

function indexOfBit(bit) {
  return 31 - Math.clz32(bit);
}

function result(edgeId, winning) {
  return { edgeId, proven: winning !== null, winning };
}

// Adding a blue support underneath a red-blue tree gives the ordinal sum 1:x.
// Between consecutive negative integers this function is linear. Reflection
// in zero gives the corresponding formula for a red support.
function blueSupport(value) {
  if (value >= 0) return 1 + value;
  const whole = Math.floor(-value);
  return (1 + (value + whole) / 2) / 2 ** whole;
}

function withSupport(color, value) {
  if (color === 'blue') return blueSupport(value);
  if (color === 'red') return -blueSupport(-value);
  return NaN;
}

// The simplest dyadic strictly between the best Blue and Red options.
// With at most 31 edges all of these dyadics are exact IEEE-754 numbers.
function simplestBetween(left, right) {
  if (left < 0 && right > 0) return 0;
  if (right <= 0) return -simplestBetween(-right, -left);
  for (let unit = 1; ; unit /= 2) {
    const candidate = (Math.floor(left / unit) + 1) * unit;
    if (candidate < right) return candidate;
  }
}

function prepare(board, ids) {
  const active = new Set(ids);
  const ground = new Set(board.nodes.filter(node => node.ground).map(node => node.id));
  const vertices = new Map();
  const incident = [0];
  const colors = { blue: 0, red: 0, green: 0 };
  const edges = [];

  function vertex(id) {
    if (ground.has(id)) return 0;
    if (!vertices.has(id)) {
      vertices.set(id, incident.length);
      incident.push(0);
    }
    return vertices.get(id);
  }

  for (const edge of board.edges) {
    if (!active.has(edge.id)) continue;
    const bit = 1 << edges.length;
    const a = vertex(edge.a);
    const b = vertex(edge.b);
    incident[a] |= bit;
    incident[b] |= bit;
    colors[edge.color] |= bit;
    edges.push({ id: edge.id, a, b, color: edge.color });
  }

  const allowed = { blue: colors.blue | colors.green, red: colors.red | colors.green };
  return { edges, incident, colors, allowed };
}

// One depth-first traversal finds every legal cut's falling edges. A bridge
// severs its entire descendant subgraph. Other cuts remove only their edge.
// Distinct attachments at the common ground also give independent summands.
function inspect(graph, mask) {
  const { incident, edges } = graph;
  const entry = new Uint8Array(incident.length);
  const low = new Uint8Array(incident.length);
  const drops = new Int32Array(edges.length);
  const parts = [];
  let time = 0;
  let seen = 0;

  function visit(v) {
    entry[v] = low[v] = ++time;
    let branchMask = 0;
    let nim = 0;
    let number = 0;
    for (let remaining = incident[v] & mask; remaining; remaining &= remaining - 1) {
      const bit = remaining & -remaining;
      if (seen & bit) continue;
      seen |= bit;
      const index = indexOfBit(bit);
      const edge = edges[index];
      const w = edge.a === v ? edge.b : edge.a;
      let part = bit;
      let partNim = 1;
      let partNumber = NaN;
      drops[index] = bit;

      if (!entry[w]) {
        const child = visit(w);
        part |= child.mask;
        low[v] = Math.min(low[v], low[w]);
        if (low[w] > entry[v]) {
          drops[index] = part;
          partNim = child.nim + 1;
          partNumber = withSupport(edge.color, child.number);
        } else {
          // In Green Hackenbush, fusing a cycle turns its edges into loops.
          // Each such loop contributes *1 in the same fused vertex.
          partNim = child.nim ^ 1;
        }
      } else {
        low[v] = Math.min(low[v], entry[w]);
        if (v === w) partNumber = withSupport(edge.color, 0);
      }

      branchMask |= part;
      nim ^= partNim;
      number += partNumber;
      if (v === 0) parts.push({ mask: part, nim: partNim, number: partNumber });
    }
    return { mask: branchMask, nim, number };
  }

  const { mask: standing } = visit(0);
  return { mask: standing, drops, parts };
}

function rankedCuts(graph, mask, groups, side) {
  const other = otherSide(side);
  const options = [];
  const parity = count(mask & graph.colors.green) % 2;
  for (const group of groups) {
    for (let moves = group.mask & graph.allowed[side]; moves; moves &= moves - 1) {
      const index = indexOfBit(moves & -moves);
      const removed = group.drops[index];
      const next = mask & ~removed;
      const material = count(removed & graph.colors[other]) - count(removed & graph.colors[side]);
      const nextParity = parity ^ (count(removed & graph.colors.green) % 2);
      const score = next & graph.allowed[other]
        ? 8 * material - nextParity + count(removed & graph.allowed[other]) / 32
        : Infinity;
      options.push({ index, next, score });
    }
  }
  return options.sort((a, b) => b.score - a.score);
}

function makeSolver(graph, opening, deadline) {
  const { colors, allowed } = graph;
  const components = opening.parts.map(part => part.mask);
  const localGraphs = new Map();
  const numbers = new Map([[0, 0]]);
  const outcomes = new Map();
  const equivalents = new Map();
  const horizons = new Map();
  let visits = 0;

  function checkTime() {
    if ((visits++ & 15) === 0 && performance.now() >= deadline) throw TIME_UP;
  }

  // A cut changes only its original grounded component. Reuse that component's
  // bridges and values across all combinations of moves in the other pieces.
  function localGraph(mask) {
    if (!localGraphs.has(mask)) localGraphs.set(mask, inspect(graph, mask));
    return localGraphs.get(mask);
  }

  function groupsFor(mask) {
    const groups = [];
    for (const component of components) {
      const active = mask & component;
      if (active) groups.push(localGraph(active));
    }
    return groups;
  }

  function simplePart(part) {
    if (!(part.mask & colors.red)) return count(part.mask);
    if (!(part.mask & colors.blue)) return -count(part.mask);
    return part.number;
  }

  // A short red-blue game is a number. Split independent summands first,
  // evaluate rooted trees directly, and recurse only inside small cyclic parts.
  function numberFor(mask) {
    if (numbers.has(mask)) return numbers.get(mask);
    checkTime();
    const position = localGraph(mask);
    let total = 0;
    for (const part of position.parts) {
      const direct = simplePart(part);
      if (!Number.isNaN(direct)) {
        total += direct;
      } else if (part.mask !== mask) {
        total += numberFor(part.mask);
      } else {
        let left = -Infinity;
        let right = Infinity;
        for (let moves = mask; moves; moves &= moves - 1) {
          const bit = moves & -moves;
          const child = numberFor(mask & ~position.drops[indexOfBit(bit)]);
          if (bit & colors.blue) left = Math.max(left, child);
          else right = Math.min(right, child);
        }
        total = simplestBetween(left, right);
      }
    }
    numbers.set(mask, total);
    return total;
  }

  function valueFor(position) {
    if (position.value) return position.value;
    let nim = 0;
    let number = 0;
    let unresolved = 0;
    for (const part of position.parts) {
      const green = part.mask & colors.green;
      if (green === part.mask) {
        nim ^= part.nim;
      } else if (green) {
        unresolved |= part.mask;
      } else {
        const direct = simplePart(part);
        if (!Number.isNaN(direct)) number += direct;
        else if (count(part.mask) <= CYCLIC_NUMBER_LIMIT) number += numberFor(part.mask);
        else unresolved |= part.mask;
      }
    }
    position.value = { nim, number, unresolved };
    return position.value;
  }

  function sumOf(groups) {
    let nim = 0;
    let number = 0;
    let unresolved = 0;
    for (const group of groups) {
      const value = valueFor(group);
      nim ^= value.nim;
      number += value.number;
      unresolved |= value.unresolved;
    }
    return { nim, number, unresolved };
  }

  function algebraicOutcome({ nim, number, unresolved }, side) {
    if (unresolved) return null;
    // A nonzero number dominates every nimber. When its sum is zero,
    // the xor of the independent green components decides the outcome.
    if (number === 0) return nim !== 0;
    return side === 'blue' ? number > 0 : number < 0;
  }

  function solve(mask, side, depth) {
    checkTime();
    if (!(mask & allowed[side])) return false;
    const other = otherSide(side);
    if (!(mask & allowed[other])) return true;
    const key = mask * 2 + Number(side === 'red');
    if (outcomes.has(key)) return outcomes.get(key);
    if ((horizons.get(key) ?? -1) >= depth) return null;

    const groups = groupsFor(mask);
    const sum = sumOf(groups);
    let outcome = algebraicOutcome(sum, side);
    // Two positions with the same unresolved graph, dyadic sum, and nim-sum
    // have the same outcome even when their remaining edge masks differ.
    const signature = sum.unresolved && sum.unresolved !== mask
      ? `${sum.unresolved * 2 + Number(side === 'red')}/${sum.number}/${sum.nim}` : null;
    if (signature && equivalents.has(signature)) return equivalents.get(signature);
    if (outcome === null && depth > 0) {
      outcome = false;
      for (const move of rankedCuts(graph, mask, groups, side)) {
        const reply = solve(move.next, other, depth - 1);
        if (reply === false) {
          outcome = true;
          break;
        }
        if (reply === null) outcome = null;
      }
    }

    if (outcome === null) horizons.set(key, depth);
    else {
      outcomes.set(key, outcome);
      if (signature) equivalents.set(signature, outcome);
    }
    return outcome;
  }

  return { solve, openingOutcome: side => algebraicOutcome(valueFor(opening), side) };
}

function largeBoardMove(board, live, side, deadline) {
  const moves = legalMoves(board, live, side);
  if (!moves.length) return result(null, false);
  const other = otherSide(side);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const id of moves) {
    if (performance.now() >= deadline) break;
    const next = cutEdge(board, live, id, side).live;
    const replies = legalMoves(board, next, other).length;
    if (!replies) return result(id, true);
    const score = legalMoves(board, next, side).length - replies;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return result(best, null);
}

/** Return a legal cut, and a normal-play proof when the search establishes it. */
export function chooseMove(board, live, side, { budgetMs = 110 } = {}) {
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 110;
  const deadline = performance.now() + budget;
  if (live.length > MASK_LIMIT) return largeBoardMove(board, live, side, deadline);
  const graph = prepare(board, live);
  const position = inspect(graph, 2 ** graph.edges.length - 1);
  const { mask } = position;
  const options = rankedCuts(graph, mask, [position], side);
  if (!options.length) return result(null, false);
  const idFor = option => graph.edges[option.index].id;
  if (options[0].score === Infinity) return result(idFor(options[0]), true);

  const solver = makeSolver(graph, position, deadline);
  const other = otherSide(side);
  let candidates = options;
  const refuted = new Set();
  try {
    if (solver.openingOutcome(side) === false) return result(idFor(options[0]), false);
    // Check cheap exact replies across the entire board before spending time
    // on deeper tactics. Keep every proven losing move out of the fallback.
    for (const depth of [0, 2, graph.edges.length]) {
      const unresolved = [];
      for (const move of candidates) {
        const reply = solver.solve(move.next, other, depth);
        if (reply === false) return result(idFor(move), true);
        if (reply === true) refuted.add(move.index);
        else unresolved.push(move);
      }
      if (!unresolved.length) return result(idFor(options[0]), false);
      candidates = unresolved;
    }
  } catch (error) {
    if (error !== TIME_UP) throw error;
  }
  const best = options.find(move => !refuted.has(move.index)) ?? options[0];
  return result(idFor(best), null);
}
