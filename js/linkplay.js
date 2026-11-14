import { generateBoard } from './generator.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';
import { normalizePlayers } from './session.js';

const PREFIX = '#turn=';
const SIDES = ['blue', 'red'];
const VARIANTS = new Set(['green', 'redblue', 'mixed']);
const DIFFICULTIES = new Set(['small', 'standard', 'large']);
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

function replay(board, moves, firstSide) {
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

/** Encode two human players and their deliberately cut edge IDs, in order.
 * New links default to generator 2 with Blue first. A zero-cut link invites the first mover.
 * Throws on unsupported settings, an invalid identity, or an illegal/oversized history.
 */
export function encodeTurn({ seed, variant, difficulty, moves, firstSide = 'blue', boardVersion = 2, players, matchId }) {
  if (!VARIANTS.has(variant) || !DIFFICULTIES.has(difficulty)) {
    throw new RangeError('Unknown variant or difficulty.');
  }
  if (!SIDES.includes(firstSide) || ![1, 2].includes(boardVersion)) {
    throw new RangeError('Unknown opening side or board version.');
  }
  if (matchId !== undefined && (typeof matchId !== 'string' || !MATCH_ID.test(matchId))) {
    throw new RangeError('Invalid match identifier.');
  }
  if (!Array.isArray(moves) || moves.length > MAX_MOVES) {
    throw new RangeError('The move list must contain at most 256 cuts.');
  }
  const seedToken = encodeText(seed, MAX_SEED_BYTES);
  const seats = linkPlayers(players, firstSide);
  const blue = encodeText(seats.blue.name, MAX_NAME_BYTES);
  const red = encodeText(seats.red.name, MAX_NAME_BYTES);
  const board = generateBoard(seed, variant, difficulty, boardVersion);
  if (!replay(board, moves, firstSide)) throw new RangeError('The move history is illegal.');

  // Indices identify edges in the original board, so falling edges never shift later moves.
  const indexById = new Map(board.edges.map((edge, index) => [edge.id, index]));
  const cuts = moves.map(id => indexById.get(id).toString(36)).join('-');
  const payload = ['2', firstSide, variant, difficulty, seedToken, cuts, boardVersion, blue, red, matchId ?? ''].join('.');
  const hash = `${PREFIX}${payload}.${checksum(payload)}`;
  if (hash.length > MAX_HASH_LENGTH) throw new RangeError('The turn link is too long.');
  return hash;
}

function decodeMetadata(fields) {
  const [version, firstSide] = fields;
  // Published v1 links always started with Blue on the original generator.
  if (version === '1') {
    if (fields.length !== 6 || firstSide !== 'blue') return null;
    return { firstSide, boardVersion: 1, players: normalizePlayers(undefined, firstSide, 'link'), matchId: undefined };
  }
  if (version !== '2' || fields.length !== 10 || !SIDES.includes(firstSide)) return null;
  const [versionToken, blueToken, redToken, idToken] = fields.slice(6);
  if ((versionToken !== '1' && versionToken !== '2') || (idToken !== '' && !MATCH_ID.test(idToken))) return null;
  const blue = decodeText(blueToken, MAX_NAME_BYTES);
  const red = decodeText(redToken, MAX_NAME_BYTES);
  if (blue === null || red === null) return null;
  const players = normalizePlayers({ blue: { name: blue }, red: { name: red } }, firstSide, 'link');
  // The wire stores normalized names. Reject hidden controls, excessive length, and blank seats.
  if (players.blue.name !== blue || players.red.name !== red) return null;
  return { firstSide, boardVersion: Number(versionToken), players, matchId: idToken || undefined };
}

/** Decode location.hash and replay every cut. Returns null for any invalid link.
 * On success, side is the next side to move; winner is null until the game is over.
 */
export function decodeTurn(hash) {
  if (typeof hash !== 'string' || hash.length > MAX_HASH_LENGTH || !hash.startsWith(PREFIX)) {
    return null;
  }
  const fields = hash.slice(PREFIX.length).split('.');
  const check = fields.pop();
  if (check !== checksum(fields.join('.'))) return null;
  const [, , variant, difficulty, seedToken, cuts] = fields;
  if (!VARIANTS.has(variant) || !DIFFICULTIES.has(difficulty) || typeof cuts !== 'string') return null;

  const indices = cuts === '' ? [] : cuts.split('-');
  if (indices.length > MAX_MOVES || indices.some(token => !/^(?:0|[1-9a-z][0-9a-z]{0,6})$/.test(token))) {
    return null;
  }
  try {
    const metadata = decodeMetadata(fields);
    if (!metadata) return null;
    const seed = decodeText(seedToken, MAX_SEED_BYTES);
    if (seed === null) return null;
    const board = generateBoard(seed, variant, difficulty, metadata.boardVersion);
    if (indices.length > board.edges.length) return null;
    const moves = [];
    for (const token of indices) {
      const edge = board.edges[Number.parseInt(token, 36)];
      if (!edge) return null;
      moves.push(edge.id);
    }
    const state = replay(board, moves, metadata.firstSide);
    return state && { seed, variant, difficulty, moves, board, ...state, ...metadata };
  } catch {
    // A fragment is untrusted input, including any malformed base64 or UTF-8 seed.
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
