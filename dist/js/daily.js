import { analyzePosition } from './analysis-values.js';
import { generateBoard } from './generator.js';
import { isDailySeed, TEXT_BOARD_VERSION } from './map-seed.js';
import { initialEdges, otherSide } from './rules.js';
import { createGame } from './session.js';
import { inspectGraph, prepareGraph } from './strategy.js';

export function dailySeed(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).padStart(4, '0');
  const seed = `DAILY-${month}-${day}-${year}`;
  if (!isDailySeed(seed)) throw new RangeError('Invalid daily challenge date.');
  return seed;
}

// A zero search budget uses only exact graph arithmetic and structural bounds.
// Opening selection therefore never depends on processor speed or AI strength.
function structuralValue(board, live, firstSide, variant) {
  return analyzePosition(board, live, firstSide, variant, { budgetMs: 0 });
}

function supportsSide(value, side, afterOwnCut = false) {
  const blue = side === 'blue';
  const endpoint = value.exact ? value.number : blue ? value.lower : value.upper;
  if (endpoint === '0') return afterOwnCut || (blue ? value.lowerOpen : value.upperOpen);
  return endpoint !== undefined && endpoint.startsWith('-') === !blue;
}

function count(mask) {
  let total = 0;
  for (; mask; mask &= mask - 1n) total++;
  return total;
}

// Each Blue move strictly lowers a Red–Blue number. A sequence of Blue-only
// cuts ending at a certified nonnegative position thus proves a positive
// opening. Red-only cuts give the reflected proof. The cuts are hypothetical.
function provesSide(board, graph, side) {
  const own = graph.colors[side], opposing = graph.colors[otherSide(side)];
  const secured = inspectGraph(graph, own).mask;
  let mask = own | opposing;
  for (let step = 0; mask; step++) {
    const shape = inspectGraph(graph, mask);
    let unresolved = 0n;
    for (const part of shape.parts) {
      if ((part.mask & shape.cyclic) && (part.mask & own) && (part.mask & opposing)) unresolved |= part.mask;
    }
    const available = unresolved & own;
    if (step && (!available || step % 8 === 0)) {
      const live = graph.edges.filter((_, i) => mask & (1n << BigInt(i))).map(edge => edge.id);
      if (supportsSide(structuralValue(board, live, side, 'redblue'), side, true)) return true;
    }
    if (!available) break;

    // Retain grounded friendly branches when possible. An edge on a cycle
    // falls alone. A bridge can remove a whole opposing canopy in one cut.
    let cycles = available & shape.cyclic;
    if (cycles & ~secured) cycles &= ~secured;
    if (cycles & ~graph.incident[0]) cycles &= ~graph.incident[0];
    let drop = cycles & -cycles;
    let best = drop ? 0 : -Infinity;
    for (let cuts = available; cuts; cuts &= cuts - 1n) {
      const removed = shape.drops[graph.bitIndex.get(cuts & -cuts)];
      const score = count(removed & opposing) - count(removed & own) - 2 * count(removed & secured);
      if (score > best) { best = score; drop = removed; }
    }
    mask &= ~drop;
  }
  return false;
}

function redBlueWinner(board, firstSide) {
  const live = initialEdges(board);
  const value = structuralValue(board, live, firstSide, 'redblue');
  if (value.exact) return value.winner;
  const graph = prepareGraph(board, live);
  for (const side of ['blue', 'red']) {
    if (supportsSide(value, side) || provesSide(board, graph, side)) return side;
  }
  return null;
}

let lastSeed, lastOpening, lastBoard;

// Reuse the daily generator's proof only for the very same mathematical
// position. This lookup never regenerates or searches a board on the UI thread.
export function cachedDailyWinner(seed, board, variant, firstSide) {
  if (!lastBoard || seed !== lastSeed || variant !== lastOpening.variant || firstSide !== lastOpening.firstSide ||
      board.nodes.length !== lastBoard.nodes.length || board.edges.length !== lastBoard.edges.length) return null;
  const nodesMatch = board.nodes.every((node, i) => node.id === lastBoard.nodes[i].id &&
    Boolean(node.ground) === Boolean(lastBoard.nodes[i].ground));
  const edgesMatch = board.edges.every((edge, i) => {
    const other = lastBoard.edges[i];
    return edge.id === other.id && edge.a === other.a && edge.b === other.b && edge.color === other.color;
  });
  return nodesMatch && edgesMatch ? lastOpening.humanSide : null;
}

export function dailyOpening(seed) {
  if (!isDailySeed(seed)) throw new RangeError('Invalid daily challenge seed.');
  if (seed === lastSeed) return lastOpening;
  const day = Number(seed.slice(9, 11));
  const firstSide = day % 2 ? 'blue' : 'red';
  let variant = 'redblue';
  let board = day % 5 ? generateBoard(seed, variant, 'expert', TEXT_BOARD_VERSION) : null;
  let humanSide = board ? redBlueWinner(board, firstSide) : null;
  if (!humanSide) {
    variant = 'green';
    board = generateBoard(seed, variant, 'expert', TEXT_BOARD_VERSION);
    const value = structuralValue(board, initialEdges(board), firstSide, variant);
    humanSide = value.nimber ? firstSide : otherSide(firstSide);
  }
  lastSeed = seed;
  lastBoard = board;
  lastOpening = Object.freeze({ variant, firstSide, humanSide });
  return lastOpening;
}

export function createDailyGame(seed, level = 'expert', name = 'You') {
  const { variant, firstSide, humanSide } = dailyOpening(seed);
  return createGame({
    seed, boardVersion: TEXT_BOARD_VERSION, variant, difficulty: 'expert', opponent: 'computer',
    firstSide, seat: humanSide, players: {
      [humanSide]: { kind: 'human', name },
      [otherSide(humanSide)]: { kind: 'computer', level },
    },
  });
}
