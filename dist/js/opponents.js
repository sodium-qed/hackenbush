import { cutEdge, legalMoves, otherSide } from './rules.js';
import { chooseMove } from './strategy.js?v=10';

export const COMPUTER_LEVELS = Object.freeze({ easy: 'Easy', standard: 'Standard', expert: 'Expert' });

export function normalizeComputerLevel(level) {
  return typeof level === 'string' && Object.hasOwn(COMPUTER_LEVELS, level) ? level : 'expert';
}

export function computerLevelLabel(level) {
  return COMPUTER_LEVELS[normalizeComputerLevel(level)];
}

function result(edgeId, winning = null) {
  return { edgeId, proven: winning !== null, winning };
}

function givesAwayWin(board, option, side, other, groundColors) {
  if (!option.own.length) return true;
  const anchors = option.own.filter(id => groundColors.has(id));
  // A cut cannot dislodge any other edge that directly touches ground.
  if (anchors.length > 1 || groundColors.get(anchors[0]) === side) return false;
  const threats = anchors.length ? anchors : option.replies;
  return threats.some(id => {
    const after = cutEdge(board, option.next, id, other);
    return !legalMoves(board, after.live, side).length;
  });
}

function tacticalMove(board, live, side, moves) {
  const other = otherSide(side);
  const options = [];
  for (const id of moves) {
    const next = cutEdge(board, live, id, side).live;
    const replies = legalMoves(board, next, other);
    if (!replies.length) return result(id, true);
    const own = legalMoves(board, next, side);
    const shared = own.length + replies.length - next.length;
    // Preserve our cuts and remove theirs. For equal material, leave an even
    // number of shared cuts, then prefer fewer replies for the opponent.
    const score = own.length - replies.length - (shared % 2) / 2;
    options.push({ id, next, own, replies, score });
  }
  options.sort((a, b) => b.score - a.score || a.replies.length - b.replies.length);
  const ground = new Set(board.nodes.filter(node => node.ground).map(node => node.id));
  const groundColors = new Map(board.edges
    .filter(edge => ground.has(edge.a) || ground.has(edge.b))
    .map(edge => [edge.id, edge.color]));
  const safe = options.find(option => !givesAwayWin(board, option, side, other, groundColors));
  return safe ? result(safe.id) : result(options[0].id, false);
}

/** Choose a cut for this seat. An omitted level retains the original expert strategy. */
export function chooseComputerMove(board, live, side, level, options = {}) {
  const strength = normalizeComputerLevel(level);
  if (strength === 'expert') return chooseMove(board, live, side, options);
  const moves = legalMoves(board, live, side);
  if (!moves.length) return result(null, false);
  if (strength === 'easy') {
    const random = options.random ?? Math.random;
    return result(moves[Math.floor(random() * moves.length)]);
  }
  return tacticalMove(board, live, side, moves);
}
