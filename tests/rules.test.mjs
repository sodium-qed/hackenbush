import assert from 'node:assert/strict';
import test from 'node:test';
import { cutEdge, initialEdges, legalMoves, otherSide, winner } from '../dist/js/rules.js';

function makeBoard(roots, definitions) {
  const nodeIds = new Set(roots);
  const edges = definitions.map(([id, a, b, color]) => {
    nodeIds.add(a);
    nodeIds.add(b);
    return Object.freeze({ id, a, b, color });
  });
  const nodes = [...nodeIds].map((id, x) => Object.freeze({ id, x, y: 0, ground: roots.includes(id) }));
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

test('green is available to both sides and each side owns its color', () => {
  const board = makeBoard(['ground'], [
    ['leaf', 'ground', 'a', 'green'],
    ['blue-stick', 'ground', 'b', 'blue'],
    ['red-stick', 'ground', 'c', 'red'],
  ]);
  const live = Object.freeze(initialEdges(board));
  assert.equal(otherSide('blue'), 'red');
  assert.equal(otherSide('red'), 'blue');
  assert.deepEqual(legalMoves(board, live, 'blue'), ['leaf', 'blue-stick']);
  assert.deepEqual(legalMoves(board, live, 'red'), ['leaf', 'red-stick']);
  for (const side of ['blue', 'red']) {
    assert.deepEqual(cutEdge(board, live, 'leaf', side), { live: ['blue-stick', 'red-stick'], fallen: [] });
  }
  assert.equal(cutEdge(board, live, 'red-stick', 'blue'), null);
  assert.equal(cutEdge(board, live, 'blue-stick', 'red'), null);
  assert.equal(cutEdge(board, live, 'unknown', 'blue'), null);
  assert.equal(cutEdge(board, ['red-stick'], 'leaf', 'red'), null);
});

test('the initial position retains exactly the edges connected to explicit ground nodes', () => {
  const board = makeBoard(['root'], [
    ['backward-stem', 'branch', 'root', 'green'],
    ['twig', 'leaf', 'branch', 'red'],
    ['floating', 'u', 'v', 'blue'],
  ]);
  assert.deepEqual(initialEdges(board), ['backward-stem', 'twig']);
  assert.deepEqual(initialEdges(makeBoard([], [['floating', 'u', 'v', 'green']])), []);
});

test('cutting a supporting edge drops a whole branch, including a cycle of mixed colors', () => {
  const board = makeBoard(['ground'], [
    ['stem', 'ground', 'a', 'blue'],
    ['ab', 'a', 'b', 'green'],
    ['bc', 'b', 'c', 'red'],
    ['ca', 'c', 'a', 'blue'],
    ['leaf', 'a', 'd', 'green'],
    ['other', 'ground', 'e', 'red'],
  ]);
  const original = Object.freeze(initialEdges(board));
  assert.deepEqual(cutEdge(board, original, 'stem', 'blue'), {
    live: ['other'], fallen: ['ab', 'bc', 'ca', 'leaf'],
  });
  assert.deepEqual(initialEdges(board), original);
  assert.deepEqual(cutEdge(board, original, 'bc', 'red'), {
    live: ['stem', 'ab', 'ca', 'leaf', 'other'], fallen: [],
  });
});

test('one ground path continues to support a branch after an alternate path is cut', () => {
  const board = makeBoard(['ground'], [
    ['left', 'ground', 'fork', 'green'],
    ['right', 'ground', 'joint', 'green'],
    ['bridge', 'joint', 'fork', 'blue'],
    ['twig', 'fork', 'top', 'red'],
  ]);
  const first = cutEdge(board, initialEdges(board), 'left', 'blue');
  assert.deepEqual(first, { live: ['right', 'bridge', 'twig'], fallen: [] });
  assert.deepEqual(cutEdge(board, first.live, 'right', 'red'), { live: [], fallen: ['bridge', 'twig'] });
});

test('both roots support the same branch independently', () => {
  const board = makeBoard(['west', 'east'], [
    ['west-stem', 'peak', 'west', 'blue'],
    ['east-stem', 'peak', 'east', 'red'],
    ['peak-leaf', 'peak', 'leaf', 'green'],
  ]);
  const first = cutEdge(board, initialEdges(board), 'west-stem', 'blue');
  assert.deepEqual(first, { live: ['east-stem', 'peak-leaf'], fallen: [] });
  assert.deepEqual(cutEdge(board, first.live, 'east-stem', 'red'), { live: [], fallen: ['peak-leaf'] });
});

test('parallel supports and loops have independent identities', () => {
  const board = makeBoard(['g'], [
    ['stem-1', 'g', 'a', 'green'],
    ['stem-2', 'g', 'a', 'green'],
    ['loop', 'a', 'a', 'green'],
    ['ground-loop', 'g', 'g', 'green'],
  ]);
  const first = cutEdge(board, initialEdges(board), 'stem-1', 'red');
  assert.deepEqual(first, { live: ['stem-2', 'loop', 'ground-loop'], fallen: [] });
  assert.deepEqual(cutEdge(board, first.live, 'stem-2', 'blue'), { live: ['ground-loop'], fallen: ['loop'] });
});

test('the side to move loses when only its opponent has standing edges', () => {
  const board = makeBoard(['g'], [
    ['green', 'g', 'left', 'green'],
    ['red-support', 'g', 'right', 'red'],
    ['blue', 'right', 'top', 'blue'],
    ['red-spare', 'g', 'side', 'red'],
  ]);
  const live = initialEdges(board);
  assert.equal(winner(board, live, 'blue'), null);
  const blueCut = cutEdge(board, live, 'green', 'blue');
  assert.equal(winner(board, blueCut.live, 'red'), null);
  const redCut = cutEdge(board, blueCut.live, 'red-support', 'red');
  assert.deepEqual(redCut, { live: ['red-spare'], fallen: ['blue'] });
  assert.equal(winner(board, redCut.live, 'blue'), 'red');
  assert.equal(winner(board, redCut.live, 'red'), null);
  assert.equal(winner(board, [], 'red'), 'blue');
  assert.equal(winner(board, [], 'blue'), 'red');
});
