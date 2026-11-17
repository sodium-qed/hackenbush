import { MAP_COUNT, normalizeMapSeed, permuteMapNumber } from './map-seed.js';
import { otherSide } from './rules.js';
import { inspectGraph, prepareGraph } from './strategy.js?v=11';
import { analyzePosition } from './analysis-values.js?v=11';

// Chess.com publishes the names and ratings. The move policies here play
// Hackenbush, and each game's seeded choices can be reproduced in a worker.
const profiles = [
  ['Martin', 250, 'Tries a different legal cut each turn.'],
  ['Aron', 700, 'Spots a few easy falls.'],
  ['Emir', 1000, 'Looks for profitable exchanges.'],
  ['Nelson', 1300, 'Attacks exposed groups and checks the immediate reply.'],
  ['Isabel', 1600, 'Protects her supports and reads short endgames.'],
  ['Wally', 1800, 'Weighs follow-up cuts and vulnerable branches.'],
  ['Li', 2000, 'Reads counterattacks and solves small endgames.'],
  ['Noam', 2200, 'Solves Green and searches for proven Red–Blue cuts.'],
];
export const RATED_BOTS = Object.freeze(profiles.map(([name, elo, style]) => Object.freeze({
  id: name.toLowerCase(), name, elo, style, source: 'https://www.chess.com/play/computer/' + name + '-Bot',
})));
export const RATED_BOT_BY_ID = Object.freeze(Object.fromEntries(RATED_BOTS.map(bot => [bot.id, bot])));
export const DEFAULT_RATED_BOT = 'nelson';

const policies = {
  // sample = number of distinct, seeded root cuts considered. The beam
  // holds promising roots, replies and (at the top) counter-replies.
  martin: { sample: 1, green: 0,    miss: 1,    beam: [],        endgame: 0  },
  aron:   { sample: 3, green: 0.08, miss: 0.47, beam: [],        endgame: 0  },
  emir:   { sample: 8, green: 0.23, miss: 0.30, beam: [],        endgame: 0  },
  nelson: { sample: 16, green: 0.46, miss: 0.19, beam: [3, 2],    endgame: 4  },
  isabel: { sample: 28, green: 0.69, miss: 0.11, beam: [4, 3],    endgame: 6  },
  wally:  { sample: 42, green: 0.85, miss: 0.05, beam: [5, 5],    endgame: 8  },
  li:     { sample: 72, green: 0.96, miss: 0.02, beam: [6, 5, 2], endgame: 10 },
  noam:   { sample: Infinity, green: 1, miss: 0, beam: [8, 6, 3], endgame: 12 },
};

const compiled = new WeakMap();
function graphFor(board) {
  if (compiled.has(board)) return compiled.get(board);
  const graph = prepareGraph(board, board.edges.map(edge => edge.id));
  graph.bitsById = new Map(graph.edges.map((edge, index) => [edge.id, 1n << BigInt(index)]));
  graph.positions = new Map();
  graph.endings = new Map();
  compiled.set(board, graph);
  return graph;
}

function popcount(mask) {
  let size = 0;
  for (; mask; mask &= mask - 1n) size++;
  return size;
}

function choice(edgeId, winning = null) {
  return { edgeId, proven: winning !== null, winning };
}

// An edge mask always denotes the same position on this immutable board.
// Caches only memoize completed calculations, so eviction cannot affect play.
function remember(cache, key, value) {
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function shapeFor(graph, mask) {
  return graph.positions.get(mask) ?? remember(graph.positions, mask, inspectGraph(graph, mask));
}

// Safe waiting moves have a path all the way to ground in their own color.
// This discounts a large crown which the other side can drop at its support.
function secured(graph, available) {
  let reached = 0n;
  let frontier = graph.incident[0] & available;
  while (frontier) {
    const bit = frontier & -frontier;
    const edge = graph.edges[graph.bitIndex.get(bit)];
    reached |= bit;
    frontier = (frontier | ((graph.incident[edge.a] | graph.incident[edge.b]) & available)) & ~reached;
  }
  return reached;
}

function assess(graph, position) {
  if (position.assessment) return position.assessment;
  const blue = position.mask & graph.colors.blue;
  const red = position.mask & graph.colors.red;
  const secureBlue = secured(graph, blue);
  const secureRed = secured(graph, red);
  const blueCount = popcount(blue), redCount = popcount(red);
  const safeBlue = popcount(secureBlue), safeRed = popcount(secureRed);
  let winner = null;
  // Exact tree numbers fit in a double up through 52 standing edges. Above
  // that, only use the float for ordering. Every cut in Red–Blue strictly
  // moves the number, so cutting away an entire color proves a strict bound.
  if (blueCount + redCount <= 52 && Number.isFinite(position.number)) {
    winner = position.number > 0 ? 'blue' : position.number < 0 ? 'red' : 'second';
  } else if (safeBlue === blueCount && safeRed === redCount) {
    // Both players can spend each secured edge individually (cycle edges or
    // leaves first), and cannot strand a single opposing edge.
    winner = blueCount > redCount ? 'blue' : redCount > blueCount ? 'red' : 'second';
  } else if (!safeRed || safeBlue > redCount) winner = 'blue';
  else if (!safeBlue || safeRed > blueCount) winner = 'red';
  const estimate = Number.isFinite(position.number) ? position.number
    : 0.55 * position.estimate + 0.45 * (safeBlue - safeRed);
  position.assessment = { secureBlue, secureRed, estimate, winner };
  return position.assessment;
}

function optionsFor(graph, position, side, stream) {
  const options = [];
  for (let bits = position.mask & graph.allowed[side]; bits; bits &= bits - 1n) {
    const bit = bits & -bits;
    const index = graph.bitIndex.get(bit);
    const removed = position.drops[index];
    const next = position.mask & ~removed;
    const gain = popcount(removed & graph.colors[otherSide(side)]) - popcount(removed & graph.colors[side]);
    const tie = permuteMapNumber(stream ^ permuteMapNumber(index + 1));
    options.push({ id: graph.edges[index].id, bit, next, gain, tie });
  }
  return options;
}

function greenMove(graph, position, sample, policy, stream) {
  const seesNim = permuteMapNumber(stream ^ 0x79802f) / MAP_COUNT < policy.green;
  if (seesNim && position.nim) {
    const winning = sample.find(move => shapeFor(graph, move.next).nim === 0);
    if (winning) return choice(winning.id, true);
  }
  sample.sort((a, b) => (popcount(a.next) % 2) - (popcount(b.next) % 2) || a.tie - b.tie);
  return choice(sample[0].id, position.nim === 0 ? false : null);
}

function strongestFirst(a, b) { return b.score - a.score || a.tie - b.tie; }

function winnerForTurn(assessment, side) {
  return assessment.winner === 'second' ? otherSide(side) : assessment.winner;
}

// Exact certificates outrank every heuristic. The second player wins a
// zero-valued number, so the side to move matters even in a static leaf.
function leafScore(graph, mask, nextSide, perspective) {
  const state = assess(graph, shapeFor(graph, mask));
  const winner = winnerForTurn(state, nextSide);
  const estimate = perspective === 'blue' ? state.estimate : -state.estimate;
  const certainty = 4 * graph.edges.length + 1;
  return estimate + (winner ? (winner === perspective ? certainty : -certainty) : 0);
}

function orderedReplies(graph, shape, side, stream) {
  const state = assess(graph, shape);
  const safe = side === 'blue' ? state.secureBlue : state.secureRed;
  const other = otherSide(side);
  const options = optionsFor(graph, shape, side, stream);
  for (const move of options) {
    move.score = move.next & graph.allowed[other]
      ? move.gain - (move.bit & safe ? 0.4 : 0) : Infinity;
  }
  return options.sort(strongestFirst);
}

// Complete minimax in a small endgame. There are at most 2^12 subsets at
// the top tier; the direct tree/ground proofs often settle a node instantly.
function endgameWinner(graph, mask, side, stream, memo) {
  const key = mask * 2n + BigInt(side === 'red');
  if (memo.has(key)) return memo.get(key);
  if (graph.endings.has(key)) return graph.endings.get(key);
  const shape = shapeFor(graph, mask);
  let winner = winnerForTurn(assess(graph, shape), side);
  const other = otherSide(side);
  if (!winner) {
    winner = other;
    for (const move of orderedReplies(graph, shape, side, stream)) {
      if (endgameWinner(graph, move.next, other, stream, memo) === side) { winner = side; break; }
    }
  }
  memo.set(key, winner);
  return remember(graph.endings, key, winner);
}

function searchReplies(graph, mask, side, stream, widths, depth, alpha, beta) {
  if (depth === widths.length) return leafScore(graph, mask, side, side);
  const shape = shapeFor(graph, mask);
  if (assess(graph, shape).winner) return leafScore(graph, mask, side, side);
  const other = otherSide(side);
  const replies = orderedReplies(graph, shape, side, stream).slice(0, widths[depth]);
  let best = -Infinity;
  for (const reply of replies) {
    const score = -searchReplies(graph, reply.next, other, stream, widths, depth + 1, -beta, -alpha);
    best = Math.max(best, score);
    alpha = Math.max(alpha, best);
    if (alpha >= beta) break;
  }
  return best;
}

function coloredMove(board, graph, position, options, sample, side, policy, stream, size) {
  const other = otherSide(side);
  const misses = permuteMapNumber(stream ^ 0xd4217b) / MAP_COUNT < policy.miss;
  if (misses || !policy.beam.length) {
    const move = misses ? sample[0] : sample.sort((a, b) => b.gain - a.gain || a.tie - b.tie)[0];
    return choice(move.id, move.next & graph.allowed[other] ? null : true);
  }
  // In a solved endgame every legal move is eligible, even when the usual
  // midgame sampling window is smaller.
  if (size <= policy.endgame) {
    const memo = new Map();
    const winning = options.find(move => endgameWinner(graph, move.next, other, stream, memo) === side);
    if (winning) return choice(winning.id, true);
    for (const move of options) move.score = leafScore(graph, move.next, other, side);
    return choice(options.sort(strongestFirst)[0].id, false);
  }
  for (const move of sample) {
    move.winner = winnerForTurn(assess(graph, shapeFor(graph, move.next)), other);
    if (move.winner === side) return choice(move.id, true);
    move.score = leafScore(graph, move.next, other, side);
  }
  const roots = sample.sort(strongestFirst).slice(0, policy.beam[0]);
  // Large unknown cyclic cores rarely yield exact numbers. Search concrete
  // threats with a fixed beam, widening and deepening for stronger opponents.
  let best, bestScore = -Infinity;
  for (const move of roots) {
    const replyScore = -searchReplies(graph, move.next, other, stream, policy.beam, 1, -Infinity, Infinity);
    // Static order breaks equal minimax scores in favor of a healthier
    // follow-up position. It never outweighs a certified result.
    move.searched = replyScore + Math.max(-32, Math.min(32, move.score)) / 128;
    if (move.searched > bestScore) { best = move; bestScore = move.searched; }
  }
  // The master also asks the exact-number/interval analyzer about the most
  // promising followers. Every run uses the same number of proof steps.
  if (policy === policies.noam) {
    const shortlist = roots.sort((a, b) => b.searched - a.searched || strongestFirst(a, b)).slice(0, 3);
    let unrefuted;
    for (const move of shortlist) {
      const ids = graph.edges.filter((edge, i) => move.next & (1n << BigInt(i))).map(edge => edge.id);
      const proof = analyzePosition(board, ids, other, 'redblue', { budgetMs: Infinity,
        nodeLimit: size <= 36 ? 60 : 8, maxEntries: 128 });
      if (proof.winner === side) return choice(move.id, true);
      if (!proof.winner && !unrefuted) unrefuted = move;
    }
    // If all examined moves lose, retain any additional candidate whose
    // outcome is still open. A forced loss needs a proof covering every cut.
    best = unrefuted ?? roots.find(move => !shortlist.includes(move) && !move.winner) ?? best;
  }
  const known = winnerForTurn(assess(graph, position), side);
  return choice(best.id, known === other ? false : null);
}

/** Choose a move on a full garden. Decisions depend only on immutable board
 * content, the active edges, the seat, the named policy, the deal and the ply. */
export function chooseRatedBotMove(board, live, side, botId, seed, ply) {
  if (!Object.hasOwn(policies, botId)) throw new RangeError('Unknown rated bot.');
  const normalized = normalizeMapSeed(seed);
  if (!normalized || !['red', 'blue'].includes(side) || !Number.isInteger(ply) || ply < 0 || ply > board.edges.length) {
    throw new RangeError('Invalid rated bot position.');
  }
  const stream = permuteMapNumber(parseInt(normalized, 16) ^ permuteMapNumber(2 * ply + Number(side === 'red')));
  const graph = graphFor(board);
  let mask = 0n;
  for (const id of live) mask |= graph.bitsById.get(id);
  if ((mask & graph.colors.green) && (mask & ~graph.colors.green)) throw new RangeError('Rated gardens use Green or Red–Blue.');
  const position = shapeFor(graph, mask);
  const policy = policies[botId];
  const options = optionsFor(graph, position, side, stream).sort((a, b) => a.tie - b.tie);
  if (!options.length) return choice(null, false);
  const sample = options.slice(0, policy.sample);
  if (mask === (mask & graph.colors.green)) return greenMove(graph, position, sample, policy, stream);
  return coloredMove(board, graph, position, options, sample, side, policy, stream, live.length);
}
