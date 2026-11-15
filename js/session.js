import { freshSeed, generateBoard } from './generator.js';
import { CURRENT_BOARD_VERSION, normalizeMapSeed } from './map-seed.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';

const classicVariants = new Set(['green', 'redblue', 'mixed']);
const classicSizes = new Set(['small', 'standard', 'large']);
const opponents = new Set(['local', 'computer', 'link']);
const sides = ['blue', 'red'];
const matchIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
export const TURN_MS = 10_000;

export function cleanName(value) {
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

export function supportsBoard(version, variant, difficulty) {
  if (version === 3 || version === 4 || version === 5) return difficulty === 'expert' && (variant === 'green' || variant === 'redblue');
  return (version === 1 || version === 2) && classicVariants.has(variant) && classicSizes.has(difficulty);
}

function openingPosition(config, boardVersion, newMatch) {
  const { variant = 'green', difficulty = boardVersion >= 3 ? 'expert' : 'standard', opponent = 'local', seat,
    firstSide = 'blue', players, matchId, timed = boardVersion >= 3 } = config;
  const seed = boardVersion >= 4 ? normalizeMapSeed(config.seed) : config.seed;
  if (typeof seed !== 'string' || seed.length > 256 || !supportsBoard(boardVersion, variant, difficulty) ||
      !opponents.has(opponent) || !sides.includes(firstSide) || (seat !== undefined && !sides.includes(seat)) ||
      typeof timed !== 'boolean' || (boardVersion >= 3 && !timed) ||
      (matchId !== undefined && (typeof matchId !== 'string' || !matchIdPattern.test(matchId)))) {
    throw new Error('Invalid match configuration.');
  }
  let assignments = players;
  if (opponent === 'computer' && boardVersion >= 2 && seat && seat !== firstSide) {
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
    timed, deadline: null, timedOut: null,
  };
  if (matchId !== undefined) game.matchId = matchId;
  else if (newMatch && (timed || (opponent === 'link' && boardVersion >= 2))) {
    game.matchId = globalThis.crypto?.randomUUID?.() ?? (freshSeed() + freshSeed() + freshSeed());
  }
  if (opponent === 'link' && boardVersion === 1 && !timed &&
      (config.wireVersion === 1 || (!newMatch && config.boardVersion === undefined))) game.wireVersion = 1;
  return game;
}

export function createGame({ boardVersion = CURRENT_BOARD_VERSION, ...config }) {
  return openingPosition(config, boardVersion, true);
}

function ownsClock(game) {
  return game.opponent !== 'link' || game.side === game.seat;
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// A scheduled reveal can pass its end time as the first playable millisecond.
export function startTurnClock(game, now = Date.now()) {
  if (!game.timed || game.victor || game.deadline !== null || !ownsClock(game)) return game;
  if (!validTimestamp(now) || !validTimestamp(now + TURN_MS)) return game;
  return { ...game, deadline: now + TURN_MS };
}

export function expireTurn(game, now = Date.now()) {
  if (!game.timed || game.victor || game.deadline === null || !validTimestamp(now) || now < game.deadline) return game;
  return { ...game, victor: otherSide(game.side), timedOut: game.side, deadline: null };
}

function applyCut(game, edgeId) {
  if (game.victor) return null;
  const change = cutEdge(game.board, game.live, edgeId, game.side);
  if (!change) return null;
  const index = game.board.edges.findIndex(edge => edge.id === edgeId);
  const edge = game.board.edges[index];
  const row = { side: game.side, edgeId, branch: index + 1, color: edge.color, fallen: change.fallen };
  const side = otherSide(game.side);
  return {
    ...game, side, live: change.live, victor: winner(game.board, change.live, side), deadline: null,
    moves: [...game.moves, edgeId], rows: [...game.rows, row]
  };
}

export function playCut(game, edgeId, now = Date.now()) {
  if (game.timed && (!ownsClock(game) || game.deadline === null || !validTimestamp(now) ||
      now < game.deadline - TURN_MS || now >= game.deadline)) return null;
  return applyCut(game, edgeId);
}

export function saveData({
  seed, variant, difficulty, opponent, seat, firstSide, players, boardVersion, matchId, moves, timed, deadline, timedOut, wireVersion,
}) {
  const data = { seed, variant, difficulty, opponent, seat, firstSide, boardVersion,
    players: { blue: { ...players.blue }, red: { ...players.red } }, moves: [...moves], timed, deadline, timedOut };
  if (matchId !== undefined) data.matchId = matchId;
  if (wireVersion === 1) data.wireVersion = 1;
  return data;
}

export function restoreGame(saved, now = Date.now()) {
  if (!saved || !Array.isArray(saved.moves) || saved.moves.length > 256) return null;
  try {
    const version = saved.boardVersion === undefined ? 1 : saved.boardVersion;
    let game = openingPosition(saved, version, false);
    for (const id of saved.moves) {
      game = applyCut(game, id);
      if (!game) return null;
    }
    const deadline = saved.deadline ?? null;
    const timedOut = saved.timedOut ?? null;
    if (deadline === null && timedOut === null) return game;
    if (!game.timed || game.victor) return null;
    if (timedOut !== null) {
      if (timedOut !== game.side || deadline !== null) return null;
      return { ...game, victor: otherSide(timedOut), timedOut };
    }
    if (!ownsClock(game) || !validTimestamp(deadline) || deadline < TURN_MS || !validTimestamp(now)) return null;
    return expireTurn({ ...game, deadline }, now);
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
  if (game.timed || game.opponent === 'link') return -1;
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

export function matchKey({
  seed, variant, difficulty, boardVersion = 1, timed = boardVersion >= 3, firstSide = 'blue', players, opponent = 'local', matchId,
}) {
  const seats = normalizePlayers(players, firstSide, opponent);
  const map = boardVersion >= 4 ? normalizeMapSeed(seed) : seed;
  return JSON.stringify([variant, difficulty, map, boardVersion, timed, firstSide, seats.blue, seats.red, matchId ?? null]);
}

function isPrefix(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((id, index) => id === longer[index]);
}

export function receiveLink(decoded, saved, now = Date.now()) {
  if (!decoded || !Array.isArray(decoded.moves)) return { game: null, note: '' };
  const firstSide = decoded.firstSide ?? 'blue';
  const nextSide = decoded.moves.length % 2 ? otherSide(firstSide) : firstSide;
  if (!sides.includes(firstSide) || decoded.side !== nextSide) return { game: null, note: '' };
  let previous = null;
  if (saved?.opponent === 'link' && matchKey(saved) === matchKey(decoded)) {
    previous = restoreGame(decoded.wireVersion === 1 ? { ...saved, wireVersion: 1 } : saved, now);
  }
  const recipient = decoded.timedOut ? otherSide(decoded.side) : decoded.side;
  // A link transfers a position. The active clock belongs to its recipient's device.
  const game = restoreGame({ ...decoded, opponent: 'link', seat: previous?.seat ?? recipient, deadline: null }, now);
  if (!previous || !game) return { game, note: '' };
  const previousIsPrefix = isPrefix(previous.moves, game.moves);
  const incomingIsPrefix = isPrefix(game.moves, previous.moves);
  // A timeout ends its exact position, including competing cuts made from that position.
  if (game.timedOut && incomingIsPrefix) return { game, note: '' };
  if (previous.timedOut && previousIsPrefix) return { game: previous, note: '' };
  if (previousIsPrefix && incomingIsPrefix) return { game: previous, note: '' };
  if (!previousIsPrefix) {
    const note = incomingIsPrefix ? 'This link shows an earlier turn. Your latest position is open.'
      : 'This link follows a different sequence. Your saved position is open.';
    return { game: previous, note };
  }
  return { game, note: '' };
}
