import { estimateDifficulty } from './difficulty.js';
import { ratedBotMove, ratedOpeningWinner } from './rated-deal.js';
import { cutEdge, legalMoves, otherSide } from './rules.js';

const HUMAN_WIN = 1, BOT_WIN = 2;

/** A fixed deal and policy form a finite decision tree for the human. Two
 * terminal witnesses prove the result can vary. Exhausting every reachable
 * state proves constancy. A node cutoff certifies neither conclusion. */
export function assessOutcomeChoice(game, winner, nodeLimit = 600) {
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

/** Worker entry point. The caller supplies a pristine, generated rated game. */
export function prepareRatedOpening(game) {
  const winner = ratedOpeningWinner(game.board, game.live, game.firstSide);
  const d = estimateDifficulty(game.board, game.live, game.firstSide, game.variant,
    { analysis: { winner }, budgetMs: Infinity, nodeLimit: 256, maxMoves: 24 });
  const { model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves } = d;
  return { winner, model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves,
    edges: game.live.length, ...assessOutcomeChoice(game, winner) };
}
