import { analyzePosition } from './analysis-values.js?v=10';
import { estimateDifficulty } from './difficulty.js?v=10';
import { ratedBotMove, ratedOpeningWinner } from './rated-deal.js?v=10';
import { cutEdge, legalMoves, otherSide } from './rules.js';
import { inspectGraph, prepareGraph } from './strategy.js?v=10';

const HUMAN_WIN = 1, BOT_WIN = 2;

/** A fixed deal and policy form a finite decision tree for the human. Two
 * terminal witnesses prove the result can vary. Exhausting every reachable
 * state proves constancy. A node cutoff certifies neither conclusion. */
function assessLegacyChoice(game, winner, nodeLimit) {
  const { board, seed, seat, firstSide } = game;
  const bot = otherSide(seat), level = game.players[bot].level;
  if (level === 'expert' && winner === bot) {
    return { information: 'forced', forcedWinner: bot, certificate: 'expert-policy', searchNodes: 0 };
  }
  const botMoves = new Map();
  const keyOf = (live, ply) => `${ply}|${live.join(',')}`;
  function botMove(live, ply) {
    const key = keyOf(live, ply);
    if (!botMoves.has(key)) botMoves.set(key, ratedBotMove(board, live, bot, level, seed, ply).edgeId);
    return botMoves.get(key);
  }
  let observed = 0;
  function terminal(side) { observed |= side === bot ? HUMAN_WIN : BOT_WIN; }

  // Cheap constructive probes usually find both witnesses. The first human
  // policy plays perfectly. Other probes use reproducible exploratory cuts.
  let random = (parseInt(seed, 16) ^ 0x85ebca6b) >>> 0;
  for (let trial = 0; trial < 12 && observed !== 3; trial++) {
    let live = game.live, side = firstSide, ply = 0;
    while (true) {
      const legal = legalMoves(board, live, side);
      if (!legal.length) { terminal(side); break; }
      let move;
      if (side === bot) move = botMove(live, ply);
      else if (trial === 0) move = ratedBotMove(board, live, side, 'expert', seed, ply).edgeId;
      else {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        move = legal[Math.floor(random / 2 ** 32 * legal.length)];
      }
      live = cutEdge(board, live, move, side).live;
      side = otherSide(side);
      ply++;
    }
  }
  const seen = new Set();
  let capped = false;
  function visit(live, side, ply) {
    if (observed === 3 || capped) return;
    const key = keyOf(live, ply);
    if (seen.has(key)) return;
    if (seen.size >= nodeLimit) { capped = true; return; }
    seen.add(key);
    const legal = legalMoves(board, live, side);
    if (!legal.length) { terminal(side); return; }
    const candidates = side === bot ? [botMove(live, ply)] : legal;
    for (const id of candidates) {
      visit(cutEdge(board, live, id, side).live, otherSide(side), ply + 1);
      if (observed === 3 || capped) break;
    }
  }
  visit(game.live, firstSide, 0);
  if (observed === 3) {
    return { information: 'skill', forcedWinner: null, certificate: 'two-witnesses', searchNodes: seen.size };
  }
  if (capped) return { information: 'unresolved', forcedWinner: null, certificate: 'node-limit', searchNodes: seen.size };
  return { information: 'forced', forcedWinner: observed === HUMAN_WIN ? seat : bot,
    certificate: 'policy-tree', searchNodes: seen.size };
}

function count(mask) {
  let total = 0;
  for (; mask; mask &= mask - 1n) total++;
  return total;
}

// These moves belong to the simulated human. Deliberately giving the opponent
// a good cut is a valid way to witness a loss. The bot always plays its actual
// assigned policy, with its original seed and ply.
function probeCut(graph, mask, side, green, seekWin, random) {
  const other = otherSide(side);
  const shape = inspectGraph(graph, mask);
  const options = [];
  for (let bits = mask & graph.allowed[side]; bits; bits &= bits - 1n) {
    const i = graph.bitIndex.get(bits & -bits);
    const removed = shape.drops[i], next = mask & ~removed;
    let score = 0;
    if (!green) {
      const gain = count(removed & graph.colors[other]) - count(removed & graph.colors[side]);
      const anchors = removed & graph.incident[0];
      const anchorGain = count(anchors & graph.colors[other]) - count(anchors & graph.colors[side]);
      score = 4 * gain + 3 * anchorGain;
      if (!(next & graph.allowed[other])) score = Infinity;
      else if (!(next & graph.allowed[side])) score = -Infinity;
      if (!seekWin) score = -score;
    }
    options.push({ id: graph.edges[i].id, next, score: score + count(removed) / 8 + random() });
  }
  options.sort((a, b) => b.score - a.score);
  // The Green nimber lets us search for a winning cut, or intentionally
  // offer one. A losing seat may still win if the fixed opponent errs.
  if (green && (shape.nim || !seekWin)) {
    const preferred = options.find(({ next }) => (inspectGraph(graph, next).nim === 0) === seekWin);
    if (preferred) return preferred.id;
  }
  return options[0].id;
}

const WORLD_PROBE_LIMIT = 480;

function assessWorldChoice(game, winner, nodeLimit) {
  const { board, seed, seat, firstSide } = game;
  const opponent = otherSide(seat), level = game.players[opponent].level;
  const green = game.variant === 'green';
  if (green && level === 'noam' && winner === opponent) {
    return { information: 'forced', forcedWinner: opponent, certificate: 'perfect-green-policy', searchNodes: 0, witnesses: {} };
  }
  const graph = prepareGraph(board, game.live);
  const bits = new Map(graph.edges.map((edge, i) => [edge.id, 1n << BigInt(i)]));
  const openingMask = (1n << BigInt(graph.edges.length)) - 1n;
  if (!(openingMask & graph.allowed[firstSide]) || !(openingMask & graph.allowed[otherSide(firstSide)])) {
    const forcedWinner = openingMask & graph.allowed[firstSide] ? firstSide : otherSide(firstSide);
    return { information: 'forced', forcedWinner, certificate: 'no-legal-reply', searchNodes: 0, witnesses: {} };
  }
  if (winner && !(openingMask & ~graph.incident[0])) {
    // Every cut removes exactly its own edge. Remaining move counts fix the result.
    return { information: 'forced', forcedWinner: winner, certificate: 'grounded-moves', searchNodes: 0, witnesses: {} };
  }

  const opponentMoves = new Map();
  function fixedMove(live, ply) {
    const key = ply + '|' + live.join(',');
    if (!opponentMoves.has(key)) {
      opponentMoves.set(key, ratedBotMove(board, live, opponent, level, seed, ply).edgeId);
    }
    return opponentMoves.get(key);
  }
  let nodes = 0, randomState = Number.parseInt(seed, 16) ^ 0x85ebca6b;
  function random() {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  }
  const witnesses = {};
  for (let probe = 0; probe < 6 && nodes < nodeLimit && !(witnesses.blue && witnesses.red); probe++) {
    let live = game.live, side = firstSide, mask = openingMask;
    const line = [];
    const seekWin = !witnesses[seat];
    // Alternate strong viewpoints if the quick material probe only found a
    // loss. Changing the simulated human's tie breaks leaves the opponent's
    // recorded decisions and ply numbering intact.
    const humanPolicy = seekWin && !green ? [null, 'noam', null, 'li'][probe] : null;
    const humanSeed = humanPolicy === 'li' ? Math.floor(random() * 2 ** 24).toString(16).padStart(6, '0') : seed;
    while (mask & graph.allowed[side]) {
      if (nodes >= nodeLimit) break;
      nodes++;
      let move;
      if (side === opponent) move = fixedMove(live, line.length);
      else if (humanPolicy) move = ratedBotMove(board, live, seat, humanPolicy, humanSeed, line.length).edgeId;
      else move = probeCut(graph, mask, seat, green, seekWin, random);
      const cut = cutEdge(board, live, move, side);
      live = cut.live;
      mask &= ~bits.get(move);
      for (const id of cut.fallen) mask &= ~bits.get(id);
      line.push(move);
      side = otherSide(side);
    }
    if (!(mask & graph.allowed[side])) witnesses[otherSide(side)] ??= line;
  }
  const both = Boolean(witnesses.blue && witnesses.red);
  return { information: both ? 'skill' : 'unresolved', forcedWinner: null,
    certificate: both ? 'two-witnesses' : 'probe-limit', searchNodes: nodes, witnesses };
}

/** Perfect play and attainable results against one fixed opponent are distinct.
 * Legacy assignments retain their original, bounded exhaustive search. */
export function assessOutcomeChoice(game, winner, nodeLimit) {
  return game.boardVersion === 5 ? assessWorldChoice(game, winner, nodeLimit ?? WORLD_PROBE_LIMIT)
    : assessLegacyChoice(game, winner, nodeLimit ?? 600);
}

/** Worker entry point. The caller supplies a pristine, generated rated game. */
export function prepareRatedOpening(game) {
  const { board, live, firstSide, variant } = game;
  const world = game.boardVersion === 5;
  const proof = world ? analyzePosition(board, live, firstSide, variant, { budgetMs: Infinity, nodeLimit: 256 })
    : { winner: ratedOpeningWinner(board, live, firstSide) };
  // Survey every Green cut using its polynomial nimber calculation. Limit both
  // the number of Red–Blue child proofs and their shared allowance on full worlds.
  const worldSurvey = variant === 'green' ? live.length : 8;
  const d = estimateDifficulty(board, live, firstSide, variant,
    { analysis: proof, budgetMs: Infinity, nodeLimit: world && variant === 'redblue' ? 48 : 256,
      maxMoves: world ? worldSurvey : 24 });
  const { winner, model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves } = d;
  return { winner, model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves,
    edges: live.length, ...(world ? { perfectPlay: { ...proof, winner } } : {}), ...assessOutcomeChoice(game, winner) };
}
