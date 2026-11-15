import { initialEdges } from './rules.js';

export const CUSTOM_BOARD_VERSION = 6;
export const COLUMNS = 9;
export const ROWS = 7;
export const MAX_BRANCHES = 60;
export const MAX_TITLE = 28;

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const variants = { G: 'green', R: 'redblue' };
const groundY = 314;

export function pointName(point) {
  return String.fromCharCode(65 + point % COLUMNS) + (Math.floor(point / COLUMNS) + 1);
}

function isPoint(point) {
  return Number.isInteger(point) && point >= 0 && point < COLUMNS * ROWS;
}

function turn(a, b, c) {
  const x = a % COLUMNS, y = Math.floor(a / COLUMNS);
  return (b % COLUMNS - x) * (Math.floor(c / COLUMNS) - y)
    - (Math.floor(b / COLUMNS) - y) * (c % COLUMNS - x);
}

function interior(a, b, p) {
  // A collinear grid point lies strictly between two endpoints exactly when
  // its row-major index does. Horizontal and vertical lines work the same way.
  return p > Math.min(a, b) && p < Math.max(a, b) && turn(a, b, p) === 0;
}

export function branchIssue(edges, a, b) {
  if (!isPoint(a) || !isPoint(b) || a === b) return 'Choose two different dots.';
  if (a < COLUMNS && b < COLUMNS) return 'Give this branch an endpoint above the ground.';
  for (const edge of edges) {
    const { a: c, b: d } = edge;
    if ((a === c && b === d) || (a === d && b === c)) return 'A branch already joins those dots.';
    if (interior(a, b, c) || interior(a, b, d) || interior(c, d, a) || interior(c, d, b)) {
      return 'Branches meet at their end dots. Use shorter branches to make a joint there.';
    }
    if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) {
      return 'Those branches would cross. Choose a shared end dot or draw around it.';
    }
  }
  if (edges.length >= MAX_BRANCHES) return `This board holds up to ${MAX_BRANCHES} branches.`;
  return '';
}

export function isDrawing(variant, edges) {
  if (!Object.values(variants).includes(variant) || !Array.isArray(edges) || edges.length > MAX_BRANCHES) return false;
  const checked = [];
  for (const edge of edges) {
    if (!edge || (variant === 'green' ? edge.color !== 'green' : !['blue', 'red'].includes(edge.color)) ||
        branchIssue(checked, edge.a, edge.b)) return false;
    checked.push(edge);
  }
  return true;
}

function boardFor(title, edges) {
  const points = [...new Set(edges.flatMap(({ a, b }) => [a, b]))].sort((a, b) => a - b);
  return {
    family: title || 'Custom garden', height: 340, groundY,
    nodes: points.map(point => ({
      id: 'n' + point, x: 62 + 97 * (point % COLUMNS), y: groundY - 47 * Math.floor(point / COLUMNS),
      ground: point < COLUMNS,
    })),
    edges: edges.map(({ a, b, color }, index) => ({
      id: 'e' + index, a: 'n' + a, b: 'n' + b, color,
      part: a < COLUMNS || b < COLUMNS ? 'root' : 'branch',
    })),
  };
}

export function floatingBranches(edges) {
  const board = boardFor('', edges);
  const standing = new Set(initialEdges(board));
  return new Set(edges.flatMap((_, index) => standing.has('e' + index) ? [] : [index]));
}

function cleanTitle(value) {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Bidi_Control}]/gu, '')
    .replace(/\p{Cs}/gu, '\uFFFD').trim();
  let title = '';
  for (const letter of text) {
    if (title.length + letter.length > MAX_TITLE) break;
    title += letter;
  }
  return title.trimEnd();
}

function titleToken(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Each endpoint fits one base64url digit. A descending pair means red, an
// ascending pair means blue (or green). Sorted pairs fix the replay indices
// independently of the order or direction in which the user drew them.
function encode(variant, title, edges) {
  const bytes = new TextEncoder().encode(title);
  const pairs = edges.map(({ a, b, color }) => ({ a: Math.min(a, b), b: Math.max(a, b), color }))
    .sort((left, right) => left.a - right.a || left.b - right.b);
  const ink = pairs.map(({ a, b, color }) => color === 'red' ? alphabet[b] + alphabet[a] : alphabet[a] + alphabet[b]).join('');
  return 'H6' + (variant === 'green' ? 'G' : 'R') + bytes.length.toString(36).padStart(2, '0') + titleToken(bytes) + ink;
}

export function writeCustomBoard(variant, title, edges) {
  if (!isDrawing(variant, edges) || !edges.length || floatingBranches(edges).size) return null;
  return encode(variant, cleanTitle(title), edges);
}

export function readCustomDrawing(code) {
  if (typeof code !== 'string' || code.length > 256 || !/^H6[GR][0-9a-z]{2}[A-Za-z0-9_-]+$/.test(code)) return null;
  const variant = variants[code[2]];
  const byteCount = parseInt(code.slice(3, 5), 36);
  if (byteCount > MAX_TITLE * 3) return null;
  const end = 5 + Math.ceil(byteCount * 4 / 3);
  const ink = code.slice(end);
  if (!ink.length || ink.length % 2 || ink.length > 2 * MAX_BRANCHES) return null;
  let title;
  try {
    const binary = atob(code.slice(5, end).replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(binary, letter => letter.charCodeAt(0));
    title = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
  const edges = [];
  for (let i = 0; i < ink.length; i += 2) {
    const a = alphabet.indexOf(ink[i]), b = alphabet.indexOf(ink[i + 1]);
    const color = variant === 'green' ? 'green' : a > b ? 'red' : 'blue';
    edges.push({ a: Math.min(a, b), b: Math.max(a, b), color });
  }
  // A canonical round trip also rejects nonzero padding bits, reordered or
  // duplicated pairs, control characters, invalid endpoints and floating ink.
  return writeCustomBoard(variant, title, edges) === code ? { variant, title, edges } : null;
}

export function readCustomBoard(code) {
  const drawing = readCustomDrawing(code);
  return drawing ? { variant: drawing.variant, board: boardFor(drawing.title, drawing.edges) } : null;
}
