import { generateBoard } from './generator.js';
import { normalizeMapSeed } from './map-seed.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';
import { normalizePlayers, supportsBoard } from './session.js';

const PREFIX = '#turn=';
const SIDES = ['blue', 'red'];
const MAX_SEED_BYTES = 256;
const MAX_NAME_BYTES = 24 * 4; // A Unicode scalar needs at most four UTF-8 bytes.
const MATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MOVES = 256;
const MAX_HASH_LENGTH = 2048;
const utf8 = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeText(value, maxBytes) {
  if (typeof value !== 'string' || value.length > maxBytes) {
    throw new RangeError('A turn link text field exceeds its size limit or is not a string.');
  }
  const bytes = utf8.encode(value);
  if (bytes.length > maxBytes || textDecoder.decode(bytes) !== value) {
    throw new RangeError('A turn link text field exceeds its byte limit or contains invalid Unicode.');
  }
  return base64url(bytes);
}

function decodeText(token, maxBytes) {
  if (token.length > Math.ceil(maxBytes * 4 / 3) || !/^[A-Za-z0-9_-]*$/.test(token)) {
    return null;
  }
  const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Reject redundant encodings that set unused bits in the last character.
  if (bytes.length > maxBytes || base64url(bytes) !== token) return null;
  return textDecoder.decode(bytes);
}

// CRC-32 detects damaged links. Legal play is checked separately on the regenerated board.
function checksum(payload) {
  let crc = 0xffffffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function replay(board, moves, firstSide, timedOut) {
  if (moves.length > board.edges.length) return null;
  let live = initialEdges(board);
  let side = firstSide;
  let victor = winner(board, live, side);
  for (const edgeId of moves) {
    if (victor !== null) return null;
    const result = cutEdge(board, live, edgeId, side);
    if (result === null) return null;
    live = result.live;
    side = otherSide(side);
    victor = winner(board, live, side);
  }
  if (timedOut !== null) {
    if (victor !== null || timedOut !== side) return null;
    victor = otherSide(side);
  }
  return { live, side, winner: victor };
}

function linkPlayers(players, firstSide) {
  if (players !== undefined) {
    if (!players || typeof players !== 'object' || Array.isArray(players)) {
      throw new TypeError('Invalid players for a turn link.');
    }
    for (const side of SIDES) {
      const seat = players[side];
      if (seat === undefined) continue;
      if (!seat || typeof seat !== 'object' || Array.isArray(seat) ||
          (seat.kind !== undefined && seat.kind !== 'human') ||
          (seat.name !== undefined && (typeof seat.name !== 'string' || seat.name.length > 256))) {
        throw new TypeError('A turn link requires two human players with valid names.');
      }
    }
  }
  return normalizePlayers(players, firstSide, 'link');
}

/** Share the resolved draw, deliberate cuts, and any terminal timeout. An invitation may have zero cuts.
 * Expert boards use ten-second turns. Generation 4 map codes are six hexadecimal digits.
 * An active deadline belongs to the receiving device and never goes into the URL.
 * Throws on unsupported settings, an invalid identity, or an illegal/oversized history.
 */
export function encodeTurn({
  seed: inputSeed, boardVersion = 4, variant = 'green', difficulty = boardVersion >= 3 ? 'expert' : 'standard',
  moves, firstSide = 'blue', players, matchId, timed = boardVersion >= 3, timedOut = null, wireVersion,
}) {
  if (!supportsBoard(boardVersion, variant, difficulty)) {
    throw new RangeError('Unknown board version, variant, or difficulty.');
  }
  if (!SIDES.includes(firstSide)) {
    throw new RangeError('Unknown opening side.');
  }
  if (typeof timed !== 'boolean' || (boardVersion >= 3 && !timed) ||
      (timedOut !== null && (!timed || !SIDES.includes(timedOut)))) {
    throw new RangeError('Invalid turn clock or timeout.');
  }
  if (matchId !== undefined && (typeof matchId !== 'string' || !MATCH_ID.test(matchId))) {
    throw new RangeError('Invalid match identifier.');
  }
  if (!Array.isArray(moves) || moves.length > MAX_MOVES) {
    throw new RangeError('The move list must contain at most 256 cuts.');
  }
  const seed = boardVersion === 4 ? normalizeMapSeed(inputSeed) : inputSeed;
  if (boardVersion === 4 && seed === null) throw new RangeError('A map code must contain six hexadecimal digits.');
  const seedToken = encodeText(seed, MAX_SEED_BYTES);
  const seats = linkPlayers(players, firstSide);
  const blue = encodeText(seats.blue.name, MAX_NAME_BYTES);
  const red = encodeText(seats.red.name, MAX_NAME_BYTES);
  const board = generateBoard(seed, variant, difficulty, boardVersion);
  if (!replay(board, moves, firstSide, timedOut)) throw new RangeError('The move history or timeout is illegal.');

  // Indices identify edges in the original board, so falling edges never shift later moves.
  const indexById = new Map(board.edges.map((edge, index) => [edge.id, index]));
  const cuts = moves.map(id => indexById.get(id).toString(36)).join('-');
  const fields = [timed ? '3' : '2', firstSide, variant, difficulty, seedToken, cuts];
  // A v1 original can be shared with the original clients while its settings still fit that format.
  const defaults = wireVersion === 1 && normalizePlayers(undefined, 'blue', 'link');
  if (defaults && !timed && boardVersion === 1 && firstSide === 'blue' && matchId === undefined &&
      SIDES.every(side => seats[side].name === defaults[side].name)) {
    fields[0] = '1';
  } else {
    fields.push(boardVersion, blue, red, matchId ?? '');
    if (timed) fields.push(timedOut ?? '');
  }
  const payload = fields.join('.');
  const hash = `${PREFIX}${payload}.${checksum(payload)}`;
  if (hash.length > MAX_HASH_LENGTH) throw new RangeError('The turn link is too long.');
  return hash;
}

function decodeMetadata(fields) {
  const [version, firstSide] = fields;
  // Published v1 links always started with Blue on the original generator.
  if (version === '1') {
    if (fields.length !== 6 || firstSide !== 'blue') return null;
    return { wireVersion: 1, firstSide, boardVersion: 1, players: normalizePlayers(undefined, firstSide, 'link'),
      matchId: undefined, timed: false, timedOut: null };
  }
  const timed = version === '3';
  if ((!timed && version !== '2') || fields.length !== (timed ? 11 : 10) || !SIDES.includes(firstSide)) return null;
  const [versionToken, blueToken, redToken, idToken, timeoutToken] = fields.slice(6);
  const boardVersions = timed ? ['1', '2', '3', '4'] : ['1', '2'];
  if (!boardVersions.includes(versionToken)) return null;
  if (idToken !== '' && !MATCH_ID.test(idToken)) return null;
  const timedOut = timeoutToken || null;
  if (timedOut !== null && !SIDES.includes(timedOut)) return null;
  const blue = decodeText(blueToken, MAX_NAME_BYTES);
  const red = decodeText(redToken, MAX_NAME_BYTES);
  if (blue === null || red === null) return null;
  const players = normalizePlayers({ blue: { name: blue }, red: { name: red } }, firstSide, 'link');
  // The wire stores normalized names. Reject hidden controls, excessive length, and blank seats.
  if (players.blue.name !== blue || players.red.name !== red) return null;
  return { wireVersion: Number(version), firstSide, boardVersion: Number(versionToken), players,
    matchId: idToken || undefined, timed, timedOut };
}

/** Decode location.hash and replay every cut. Returns null for any invalid link.
 * On a timeout, side identifies the player who ran out of time and winner identifies the opponent.
 * On a live turn, winner and timedOut are null.
 */
export function decodeTurn(hash) {
  if (typeof hash !== 'string' || hash.length > MAX_HASH_LENGTH || !hash.startsWith(PREFIX)) {
    return null;
  }
  const fields = hash.slice(PREFIX.length).split('.');
  const check = fields.pop();
  if (check !== checksum(fields.join('.'))) return null;
  const [, , variant, difficulty, seedToken, cuts] = fields;
  if (typeof cuts !== 'string') return null;

  const indices = cuts === '' ? [] : cuts.split('-');
  if (indices.length > MAX_MOVES || indices.some(token => !/^(?:0|[1-9a-z][0-9a-z]{0,6})$/.test(token))) {
    return null;
  }
  try {
    const metadata = decodeMetadata(fields);
    if (!metadata || !supportsBoard(metadata.boardVersion, variant, difficulty)) return null;
    const storedSeed = decodeText(seedToken, MAX_SEED_BYTES);
    if (metadata.boardVersion === 4 && storedSeed?.length !== 6) return null;
    const seed = metadata.boardVersion === 4 ? normalizeMapSeed(storedSeed) : storedSeed;
    if (seed === null) return null;
    const board = generateBoard(seed, variant, difficulty, metadata.boardVersion);
    if (indices.length > board.edges.length) return null;
    const moves = [];
    for (const token of indices) {
      const edge = board.edges[Number.parseInt(token, 36)];
      if (!edge) return null;
      moves.push(edge.id);
    }
    const state = replay(board, moves, metadata.firstSide, metadata.timedOut);
    return state && { seed, variant, difficulty, moves, board, ...state, ...metadata };
  } catch {
    // A fragment may contain malformed base64 or invalid UTF-8 in a seed or player name.
    return null;
  }
}

/** Copy text on a user gesture. Resolves to false when both browser methods fail. */
export async function copyText(text) {
  if (typeof text !== 'string') return false;
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard permissions can differ from the browser's selection-based copy permission.
  }

  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const previousFocus = doc.activeElement;
  const selection = doc.getSelection?.();
  const ranges = [];
  let input;
  try {
    for (let i = 0; i < (selection?.rangeCount ?? 0); i++) {
      ranges.push(selection.getRangeAt(i).cloneRange());
    }
    input = doc.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    input.tabIndex = -1;
    input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
    const container = previousFocus?.closest?.('dialog[open]') || doc.body;
    container.appendChild(input);
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    return Boolean(doc.execCommand('copy'));
  } catch {
    return false;
  } finally {
    input?.remove();
    previousFocus?.focus?.({ preventScroll: true });
    if (selection && ranges.length) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
