import { cutEdge, legalMoves, otherSide } from './rules.js';

// BigInt masks represent the complete network, including edges above bit 31.
// Bound recursion and memory for unusually large custom positions.
const MASK_LIMIT = 256;
const CYCLIC_NUMBER_LIMIT = 12;
const TIME_UP = Symbol('search deadline');

function count(bits) {
  let total = 0;
  for (; bits; bits &= bits - 1n) total++;
  return total;
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
// With at most 52 edges all of these dyadics are exact IEEE-754 numbers.
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
  const incident = [0n];
  const bitIndex = new Map();
  const parallel = new Map();
  const colors = { blue: 0n, red: 0n, green: 0n };
  const edges = [];

  function vertex(id) {
    if (ground.has(id)) return 0;
    if (!vertices.has(id)) {
      vertices.set(id, incident.length);
      incident.push(0n);
    }
    return vertices.get(id);
  }

  for (const edge of board.edges) {
    if (!active.has(edge.id)) continue;
    const bit = 1n << BigInt(edges.length);
    bitIndex.set(bit, edges.length);
    const a = vertex(edge.a);
    const b = vertex(edge.b);
    const endpoints = `${Math.min(a, b)}/${Math.max(a, b)}/${edge.color}`;
    if (!parallel.has(endpoints)) parallel.set(endpoints, parallel.size);
    incident[a] |= bit;
    incident[b] |= bit;
    colors[edge.color] |= bit;
    edges.push({ id: edge.id, a, b, color: edge.color, family: parallel.get(endpoints) });
  }

  const allowed = { blue: colors.blue | colors.green, red: colors.red | colors.green };
  return { edges, incident, colors, allowed, bitIndex, exactNumbers: edges.length <= 52,
    hasParallel: parallel.size < edges.length };
}

// One depth-first traversal finds every legal cut's falling edges. A bridge
// severs its entire descendant subgraph. Other cuts remove only their edge.
// Distinct attachments at the common ground also give independent summands.
function inspect(graph, mask, origin = 0) {
  const { incident, edges } = graph;
  const entry = new Uint32Array(incident.length);
  const low = new Uint32Array(incident.length);
  const drops = new Array(edges.length);
  const parts = [];
  let time = 0;
  let cycleRank = 0;
  let seen = 0n;

  function visit(v) {
    entry[v] = low[v] = ++time;
    let branchMask = 0n;
    let nim = 0;
    let number = 0;
    let estimate = 0;
    let cyclic = 0n;
    for (let remaining = incident[v] & mask; remaining; remaining &= remaining - 1n) {
      const bit = remaining & -remaining;
      if (seen & bit) continue;
      seen |= bit;
      const index = graph.bitIndex.get(bit);
      const edge = edges[index];
      const w = edge.a === v ? edge.b : edge.a;
      let part = bit;
      let partNim = 1;
      let partNumber = NaN;
      const sign = edge.color === 'blue' ? 1 : edge.color === 'red' ? -1 : 0;
      let partEstimate = sign;
      drops[index] = bit;

      if (!entry[w]) {
        const child = visit(w);
        part |= child.mask;
        cyclic |= child.cyclic;
        low[v] = Math.min(low[v], low[w]);
        if (low[w] > entry[v]) {
          drops[index] = part;
          partNim = child.nim + 1;
          partNumber = withSupport(edge.color, child.number);
          // A shared support lets either player erase the entire top.
          partEstimate = sign ? withSupport(edge.color, child.estimate)
            : child.estimate / (4 + 2 * Math.abs(child.estimate));
        } else {
          // In Green Hackenbush, fusing a cycle turns its edges into loops.
          // Each such loop contributes *1 in the same fused vertex.
          partNim = child.nim ^ 1;
          cyclic |= bit;
          partEstimate += child.estimate;
        }
      } else {
        low[v] = Math.min(low[v], entry[w]);
        if (v === w) partNumber = withSupport(edge.color, 0);
        else { cyclic |= bit; cycleRank++; }
      }

      branchMask |= part;
      nim ^= partNim;
      number += partNumber;
      estimate += partEstimate;
      if (v === origin) parts.push({ mask: part, nim: partNim, number: partNumber });
    }
    return { mask: branchMask, nim, number, estimate, cyclic };
  }

  const root = visit(origin);
  return { ...root, drops, parts, cycleRank };
}

export { prepare as prepareGraph, inspect as inspectGraph };

function rankedCuts(graph, mask, groups, side) {
  const other = otherSide(side);
  const options = [];
  const parity = count(mask & graph.colors.green) % 2;
  const interchangeable = graph.hasParallel ? new Set() : null;
  for (const group of groups) {
    for (let moves = group.mask & graph.allowed[side]; moves; moves &= moves - 1n) {
      const index = graph.bitIndex.get(moves & -moves);
      if (interchangeable) {
        const family = graph.edges[index].family;
        if (interchangeable.has(family)) continue;
        interchangeable.add(family);
      }
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

function redBluePart(graph, part) {
  const blue = part.mask & graph.colors.blue;
  const red = part.mask & graph.colors.red;
  if (!red) return count(blue);
  if (!blue) return -count(red);
  if (!(part.mask & ~graph.incident[0])) return count(blue) - count(red);
  return graph.exactNumbers ? part.number : NaN;
}

function makeSolver(graph, opening, deadline) {
  const { colors, allowed } = graph;
  const components = opening.parts.map(part => part.mask);
  const localGraphs = new Map();
  const numbers = new Map([[0n, 0]]);
  const outcomes = new Map();
  const equivalents = new Map();
  const horizons = new Map();
  const clockMask = graph.edges.length > 24 ? 3 : 15;
  let visits = 0;

  function checkTime() {
    if ((visits++ & clockMask) === 0 && performance.now() >= deadline) throw TIME_UP;
  }

  // A cut changes only its original grounded component. Reuse that component's
  // bridges and values across all combinations of moves in the other pieces.
  function localGraph(mask) {
    if (localGraphs.has(mask)) return localGraphs.get(mask);
    const position = inspect(graph, mask);
    if (localGraphs.size < 2048) localGraphs.set(mask, position);
    return position;
  }

  function groupsFor(mask) {
    const groups = [];
    for (const component of components) {
      const active = mask & component;
      if (active) groups.push(localGraph(active));
    }
    return groups;
  }

  // A short red-blue game is a number. Split independent summands first,
  // evaluate rooted trees directly, and recurse only inside small cyclic parts.
  function numberFor(mask) {
    if (numbers.has(mask)) return numbers.get(mask);
    checkTime();
    const position = localGraph(mask);
    let total = 0;
    for (const part of position.parts) {
      const direct = redBluePart(graph, part);
      if (!Number.isNaN(direct)) {
        total += direct;
      } else if (part.mask !== mask) {
        total += numberFor(part.mask);
      } else {
        let left = -Infinity;
        let right = Infinity;
        for (let moves = mask; moves; moves &= moves - 1n) {
          const bit = moves & -moves;
          const child = numberFor(mask & ~position.drops[graph.bitIndex.get(bit)]);
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
    let unresolved = 0n;
    for (const part of position.parts) {
      const green = part.mask & colors.green;
      if (!(part.mask & ~graph.incident[0])) {
        // Edges touching ground survive every cut except their own.
        number += count(part.mask & colors.blue) - count(part.mask & colors.red);
        nim ^= count(green) % 2;
      } else if (green === part.mask) {
        nim ^= part.nim;
      } else if (green) {
        unresolved |= part.mask;
      } else {
        const direct = redBluePart(graph, part);
        if (!Number.isNaN(direct)) number += direct;
        else if (graph.exactNumbers && count(part.mask) <= CYCLIC_NUMBER_LIMIT) number += numberFor(part.mask);
        else unresolved |= part.mask;
      }
    }
    position.value = { nim, number, unresolved };
    return position.value;
  }

  function sumOf(groups) {
    let nim = 0;
    let number = 0;
    let unresolved = 0n;
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
    const key = mask * 2n + BigInt(side === 'red');
    if (outcomes.has(key)) return outcomes.get(key);
    if ((horizons.get(key) ?? -1) >= depth) return null;

    const groups = groupsFor(mask);
    const sum = sumOf(groups);
    let outcome = algebraicOutcome(sum, side);
    // Two positions with the same unresolved graph, dyadic sum, and nim-sum
    // have the same outcome even when their remaining edge masks differ.
    const signature = sum.unresolved && sum.unresolved !== mask
      ? `${sum.unresolved * 2n + BigInt(side === 'red')}/${sum.number}/${sum.nim}` : null;
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

  return { solve, localGraph, openingOutcome: side => algebraicOutcome(valueFor(opening), side) };
}

// Screen every root move for an immediate opponent win. For harder colored
// networks, compare the resulting support structure against successive replies.
// The bridge estimate ranks unresolved moves and never supplies a proof.
function previewReplies(graph, options, side, solver, deadline, refuted) {
  const other = otherSide(side);
  const sign = side === 'blue' ? 1 : -1;
  const candidates = [];
  for (const move of options) {
    if (performance.now() >= deadline) break;
    const child = solver.localGraph(move.next);
    const replies = rankedCuts(graph, move.next, [child], other);
    if (replies[0]?.score === Infinity) {
      refuted.add(move.index);
      continue;
    }
    const score = sign * child.estimate + move.score / 128;
    candidates.push({ move, replies, score, worst: Infinity });
  }

  // Commit only complete rounds so a deadline cannot penalize the first few
  // candidates for receiving a deeper adversarial look than their peers.
  for (let rank = 0; rank < 8 && candidates.length; rank++) {
    let complete = true;
    let examined = false;
    for (const candidate of candidates) {
      if (performance.now() >= deadline) { complete = false; break; }
      const reply = candidate.replies[rank];
      if (!reply) continue;
      examined = true;
      const value = sign * solver.localGraph(reply.next).estimate;
      candidate.worst = Math.min(candidate.worst, value);
    }
    if (!complete || !examined) break;
    for (const candidate of candidates) {
      if (Number.isFinite(candidate.worst)) {
        candidate.score = candidate.worst + sign * solver.localGraph(candidate.move.next).estimate / 4;
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const reviewed = new Set(candidates.map(candidate => candidate.move.index));
  return [...candidates.map(candidate => candidate.move), ...options.filter(move => !reviewed.has(move.index))];
}

// Every Blue cut strictly lowers the value of a red-blue graph. Every Red cut
// strictly raises it. Removing just one color until the remaining branches can
// be valued gives a certified one-sided bound, including on large cyclic cores.
function provesAdvantage(graph, position, color, solver, deadline) {
  const sign = color === 'blue' ? 1 : -1;
  const opposing = graph.colors[otherSide(color)];
  let current = position;
  while (performance.now() < deadline) {
    let number = 0;
    let unresolved = 0n;
    for (const part of current.parts) {
      const direct = redBluePart(graph, part);
      if (Number.isNaN(direct)) unresolved |= part.mask;
      else number += direct;
    }
    if (!unresolved) return sign * number > 0 || (number === 0 && current !== position);
    const available = unresolved & graph.colors[color];
    const cycleCuts = available & current.cyclic;
    let best = 0n;
    let bestScore = -Infinity;
    for (let cuts = cycleCuts || available; cuts; cuts &= cuts - 1n) {
      const bit = cuts & -cuts;
      const removed = current.drops[graph.bitIndex.get(bit)];
      const score = count(removed & opposing) - count(removed & graph.colors[color]);
      if (score > bestScore) { best = removed; bestScore = score; }
      if (cycleCuts) break; // Every cycle cut removes precisely its own edge.
    }
    if (!best) return false;
    current = solver.localGraph(current.mask & ~best);
  }
  return false;
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
  const position = inspect(graph, (1n << BigInt(graph.edges.length)) - 1n);
  const { mask } = position;
  const options = rankedCuts(graph, mask, [position], side);
  if (!options.length) return result(null, false);
  const idFor = option => graph.edges[option.index].id;
  if (options[0].score === Infinity) return result(idFor(options[0]), true);

  // Green positions use a polynomial graph calculation at every supported
  // generated size. Looking for a zero nim-sum requires at most E traversals.
  if (mask === graph.colors.green) {
    if (!position.nim) return result(idFor(options[0]), false);
    const winning = options.find(move => inspect(graph, move.next).nim === 0);
    return result(idFor(winning), true);
  }

  const solver = makeSolver(graph, position, deadline);
  const other = otherSide(side);
  let candidates = options;
  let ranking = options;
  const refuted = new Set();
  try {
    const known = solver.openingOutcome(side);
    if (known === false) return result(idFor(options[0]), false);
    if (known === null && graph.edges.length > 20 && budget > 0) {
      const previewDeadline = Math.min(deadline, performance.now() + budget / 5);
      ranking = previewReplies(graph, options, side, solver, previewDeadline, refuted);
      candidates = ranking.filter(move => !refuted.has(move.index));
      if (!candidates.length) return result(idFor(ranking[0]), false);
      if (!graph.colors.green) {
        const boundDeadline = Math.min(deadline, performance.now() + budget / 5);
        if (provesAdvantage(graph, position, other, solver, boundDeadline)) {
          return result(idFor(ranking[0]), false);
        }
        for (const move of candidates) {
          if (performance.now() >= boundDeadline) break;
          const child = solver.localGraph(move.next);
          if (provesAdvantage(graph, child, side, solver, boundDeadline)) return result(idFor(move), true);
          if (provesAdvantage(graph, child, other, solver, boundDeadline)) refuted.add(move.index);
        }
        candidates = ranking.filter(move => !refuted.has(move.index));
        if (!candidates.length) return result(idFor(ranking[0]), false);
      }
    }
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
      if (!unresolved.length) return result(idFor(ranking[0]), false);
      candidates = unresolved;
    }
  } catch (error) {
    if (error !== TIME_UP) throw error;
  }
  const best = ranking.find(move => !refuted.has(move.index)) ?? ranking[0];
  return result(idFor(best), null);
}
