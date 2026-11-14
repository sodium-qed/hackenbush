import { freshSeed, generateBoard } from './generator.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';

const variants = new Set(['green', 'redblue', 'mixed']);
const sizes = new Set(['small', 'standard', 'large']);
const opponents = new Set(['local', 'computer', 'link']);
const sides = ['blue', 'red'];
const matchIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\s\p{White_Space}]+/gu, ' ')
    .replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .replace(/\p{Cs}/gu, '\uFFFD')
    .replace(/ +/g, ' ').trim();
  return Array.from(text).slice(0, 24).join('').trimEnd();
}

export function normalizePlayers(players, firstSide = 'blue', opponent = 'local') {
  const seats = {};
  for (const side of sides) {
    const supplied = players?.[side];
    const defaultKind = opponent === 'computer' && side !== firstSide ? 'computer' : 'human';
    const kind = supplied?.kind === 'computer' || supplied?.kind === 'human' ? supplied.kind : defaultKind;
    seats[side] = { name: cleanName(supplied?.name), kind: opponent === 'link' ? 'human' : kind };
  }
  const bothComputers = seats.blue.kind === 'computer' && seats.red.kind === 'computer';
  for (const side of sides) {
    if (seats[side].name) continue;
    const number = side === firstSide ? 1 : 2;
    if (seats[side].kind === 'human') seats[side].name = `Player ${number}`;
    else seats[side].name = bothComputers ? `Computer ${number}` : 'Computer';
  }
  return seats;
}

function openingPosition(config, boardVersion, newMatch) {
  const { seed, variant = 'green', difficulty = 'standard', opponent = 'local', seat,
    firstSide = 'blue', players, matchId } = config;
  if (typeof seed !== 'string' || seed.length > 256 || !variants.has(variant) ||
      !sizes.has(difficulty) || !opponents.has(opponent) || !sides.includes(firstSide) ||
      (seat !== undefined && !sides.includes(seat)) || (boardVersion !== 1 && boardVersion !== 2) ||
      (matchId !== undefined && (typeof matchId !== 'string' || !matchIdPattern.test(matchId)))) {
    throw new Error('Invalid match configuration.');
  }
  let assignments = players;
  if (opponent === 'computer' && boardVersion === 2 && seat && seat !== firstSide) {
    const other = otherSide(seat);
    assignments = { [seat]: { kind: 'human', ...players?.[seat] }, [other]: { kind: 'computer', ...players?.[other] } };
  }
  const seats = normalizePlayers(assignments, firstSide, opponent);
  const humanSide = sides.find(side => seats[side].kind === 'human' && seats[otherSide(side)].kind === 'computer');
  const board = generateBoard(seed, variant, difficulty, boardVersion);
  const live = initialEdges(board);
  const game = {
    seed, variant, difficulty, opponent, seat: seat ?? humanSide ?? firstSide, firstSide,
    players: seats, boardVersion, board, live, side: firstSide, victor: winner(board, live, firstSide), moves: [], rows: [],
  };
  if (opponent === 'link') {
    if (matchId !== undefined) game.matchId = matchId;
    else if (newMatch && boardVersion === 2) {
      game.matchId = globalThis.crypto?.randomUUID?.() ?? (freshSeed() + freshSeed() + freshSeed());
    }
  }
  return game;
}

export function createGame({ boardVersion = 2, ...config }) {
  return openingPosition(config, boardVersion, true);
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

export function saveData({ seed, variant, difficulty, opponent, seat, firstSide, players, boardVersion, matchId, moves }) {
  const data = { seed, variant, difficulty, opponent, seat, firstSide, boardVersion,
    players: { blue: { ...players.blue }, red: { ...players.red } }, moves: [...moves] };
  if (matchId !== undefined) data.matchId = matchId;
  return data;
}

export function restoreGame(saved) {
  if (!saved || !Array.isArray(saved.moves) || saved.moves.length > 256) return null;
  try {
    const version = saved.boardVersion === undefined ? 1 : saved.boardVersion;
    let game = openingPosition(saved, version, false);
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
  if (game.opponent === 'link') return game.side === game.seat;
  return game.players[game.side].kind === 'human';
}

function latestHumanMove(game) {
  if (game.opponent === 'link') return -1;
  return game.rows.findLastIndex(row => game.players[row.side].kind === 'human');
}

export function canUndo(game) {
  return latestHumanMove(game) >= 0;
}

export function undoTurn(game) {
  const index = latestHumanMove(game);
  if (index < 0) return game;
  return restoreGame({ ...saveData(game), moves: game.moves.slice(0, index) }) || game;
}

export function matchKey({ seed, variant, difficulty, boardVersion = 1, firstSide = 'blue', players, opponent = 'local', matchId }) {
  const seats = normalizePlayers(players, firstSide, opponent);
  return JSON.stringify([variant, difficulty, seed, boardVersion, firstSide, seats.blue, seats.red, matchId ?? null]);
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((id, index) => id === longer[index]);
}

export function receiveLink(decoded, saved) {
  if (!decoded || !Array.isArray(decoded.moves)) return { game: null, note: '' };
  const firstSide = decoded.firstSide ?? 'blue';
  const nextSide = decoded.moves.length % 2 ? otherSide(firstSide) : firstSide;
  if (!sides.includes(firstSide) || decoded.side !== nextSide) return { game: null, note: '' };
  const previous = saved?.opponent === 'link' && matchKey(saved) === matchKey(decoded) ? restoreGame(saved) : null;
  if (previous && !isPrefix(previous.moves, decoded.moves)) {
    const note = isPrefix(decoded.moves, previous.moves)
      ? 'This link shows an earlier turn. Your latest position is open.'
      : 'This link follows a different sequence. Your saved position is open.';
    return { game: previous, note };
  }
  const game = restoreGame({ ...decoded, opponent: 'link', seat: previous?.seat ?? decoded.side });
  return { game, note: '' };
}
