import { generateBoard } from './generator.js';
import { cutEdge, initialEdges, otherSide, winner } from './rules.js';

const PREFIX = '#turn=';
// Advance this version if the seeded generator or the replay rules change.
const VERSION = '1';
const OPENING_SIDE = 'blue';
const VARIANTS = new Set(['green', 'redblue', 'mixed']);
const DIFFICULTIES = new Set(['small', 'standard', 'large']);
const MAX_SEED_BYTES = 256;
const MAX_MOVES = 256;
const MAX_HASH_LENGTH = 2048;
const utf8 = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSeed(seed) {
  if (typeof seed !== 'string' || seed.length > MAX_SEED_BYTES) {
    throw new RangeError('The seed must be a string of at most 256 UTF-8 bytes.');
  }
  const bytes = utf8.encode(seed);
  if (bytes.length > MAX_SEED_BYTES || textDecoder.decode(bytes) !== seed) {
    throw new RangeError('The seed must contain at most 256 valid UTF-8 bytes.');
  }
  return base64url(bytes);
}

function decodeSeed(token) {
  if (token.length > Math.ceil(MAX_SEED_BYTES * 4 / 3) || !/^[A-Za-z0-9_-]*$/.test(token)) {
    return null;
  }
  const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Reject redundant encodings that set unused bits in the last character.
  if (bytes.length > MAX_SEED_BYTES || base64url(bytes) !== token) return null;
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

function replay(board, moves) {
  if (moves.length > board.edges.length) return null;
  let live = initialEdges(board);
  let side = OPENING_SIDE;
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

/** Create a URL fragment from a seed and the deliberately cut edge IDs, in order.
 * Throws on unsupported settings, an invalid seed, or an illegal/oversized history.
 */
export function encodeTurn({ seed, variant, difficulty, moves }) {
  if (!VARIANTS.has(variant) || !DIFFICULTIES.has(difficulty)) {
    throw new RangeError('Unknown variant or difficulty.');
  }
  if (!Array.isArray(moves) || moves.length > MAX_MOVES) {
    throw new RangeError('The move list must contain at most 256 cuts.');
  }
  const seedToken = encodeSeed(seed);
  const board = generateBoard(seed, variant, difficulty);
  if (!replay(board, moves)) throw new RangeError('The move history is illegal.');

  // Indices identify edges in the original board, so falling edges never shift later moves.
  const indexById = new Map(board.edges.map((edge, index) => [edge.id, index]));
  const cuts = moves.map(id => indexById.get(id).toString(36)).join('-');
  const payload = [VERSION, OPENING_SIDE, variant, difficulty, seedToken, cuts].join('.');
  const hash = `${PREFIX}${payload}.${checksum(payload)}`;
  if (hash.length > MAX_HASH_LENGTH) throw new RangeError('The turn link is too long.');
  return hash;
}

/** Decode location.hash and replay every cut. Returns null for any invalid link.
 * On success, side is the next side to move; winner is null until the game is over.
 */
export function decodeTurn(hash) {
  if (typeof hash !== 'string' || hash.length > MAX_HASH_LENGTH || !hash.startsWith(PREFIX)) {
    return null;
  }
  const fields = hash.slice(PREFIX.length).split('.');
  if (fields.length !== 7) return null;
  const [version, openingSide, variant, difficulty, seedToken, cuts, check] = fields;
  if (version !== VERSION || openingSide !== OPENING_SIDE ||
      !VARIANTS.has(variant) || !DIFFICULTIES.has(difficulty)) return null;
  const payload = fields.slice(0, -1).join('.');
  if (check !== checksum(payload)) return null;

  const indices = cuts === '' ? [] : cuts.split('-');
  if (indices.length > MAX_MOVES || indices.some(token => !/^(?:0|[1-9a-z][0-9a-z]{0,6})$/.test(token))) {
    return null;
  }
  try {
    const seed = decodeSeed(seedToken);
    if (seed === null) return null;
    const board = generateBoard(seed, variant, difficulty);
    if (indices.length > board.edges.length) return null;
    const moves = [];
    for (const token of indices) {
      const edge = board.edges[Number.parseInt(token, 36)];
      if (!edge) return null;
      moves.push(edge.id);
    }
    const state = replay(board, moves);
    return state && { seed, variant, difficulty, moves, board, ...state };
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
