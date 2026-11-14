import { generateBoard } from './generator.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';

const variants = new Set(['green', 'redblue', 'mixed']);
const sizes = new Set(['small', 'standard', 'large']);
const opponents = new Set(['local', 'computer', 'link']);

export function createGame({ seed, variant = 'green', difficulty = 'standard', opponent = 'local', seat = 'blue' }) {
  if (typeof seed !== 'string' || seed.length > 256 || !variants.has(variant) ||
      !sizes.has(difficulty) || !opponents.has(opponent) || !['blue', 'red'].includes(seat)) {
    throw new Error('Invalid match configuration.');
  }
  const board = generateBoard(seed, variant, difficulty);
  const live = initialEdges(board);
  return { seed, variant, difficulty, opponent, seat, board, live, side: 'blue', victor: winner(board, live, 'blue'), moves: [], rows: [] };
}

export function playCut(game, edgeId) {
  if (game.victor) return null;
  const change = cutEdge(game.board, game.live, edgeId, game.side);
  if (!change) return null;
  const index = game.board.edges.findIndex(edge => edge.id === edgeId);
  const edge = game.board.edges[index];
  const row = { side: game.side, edgeId, branch: index + 1, color: edge.color, fallen: change.fallen };
  const side = otherSide(game.side);
  return {
    ...game, side, live: change.live, victor: winner(game.board, change.live, side),
    moves: [...game.moves, edgeId], rows: [...game.rows, row]
  };
}

export function saveData({ seed, variant, difficulty, opponent, seat, moves }) {
  return { seed, variant, difficulty, opponent, seat, moves };
}

export function restoreGame(saved) {
  if (!saved || !Array.isArray(saved.moves) || saved.moves.length > 256) return null;
  try {
    let game = createGame(saved);
    for (const id of saved.moves) {
      game = playCut(game, id);
      if (!game) return null;
    }
    return game;
  } catch {
    return null;
  }
}

export function isHumanTurn(game) {
  if (game.victor) return false;
  if (game.opponent === 'computer') return game.side === 'blue';
  if (game.opponent === 'link') return game.side === game.seat;
  return true;
}

export function undoTurn(game) {
  if (!game.moves.length || game.opponent === 'link') return game;
  const count = game.opponent === 'computer' && game.side === 'blue' ? 2 : 1;
  return restoreGame({ ...saveData(game), moves: game.moves.slice(0, -count) }) || game;
}

export function matchKey({ seed, variant, difficulty }) {
  return JSON.stringify([variant, difficulty, seed]);
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((id, index) => id === longer[index]);
}

export function receiveLink(decoded, saved) {
  const previous = saved && matchKey(saved) === matchKey(decoded) && saved.opponent === 'link' ? restoreGame(saved) : null;
  if (previous && !isPrefix(previous.moves, decoded.moves)) {
    const note = isPrefix(decoded.moves, previous.moves)
      ? 'This link shows an earlier turn. Your latest position is open.'
      : 'This link follows a different sequence. Your saved position is open.';
    return { game: previous, note };
  }
  const game = restoreGame({ ...decoded, opponent: 'link', seat: previous?.seat ?? decoded.side });
  return { game, note: '' };
}
