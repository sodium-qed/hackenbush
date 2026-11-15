import { makeBoard } from './hackenbush-oracle.mjs';

// Two copies of K5 share their ground. Reflecting the wings reverses every
// edge color, including both cross-connections. Thus this connected game is 0.
export function mirroredKnot() {
  const edges = [];
  const mirror = vertex => vertex ? vertex + 4 : 0;
  for (let a = 0; a < 5; a++) {
    for (let b = a + 1; b < 5; b++) {
      const blue = (a * 7 + b * 3) % 5 < 2;
      edges.push([a, b, blue ? 'blue' : 'red']);
      edges.push([mirror(a), mirror(b), blue ? 'red' : 'blue']);
    }
  }
  edges.push([1, 6, 'red'], [5, 2, 'blue']);
  return makeBoard(edges);
}

export function smallKnot() {
  return makeBoard([
    [0, 1, 'blue'], [0, 2, 'red'], [1, 2, 'blue'], [2, 3, 'blue'],
    [3, 4, 'red'], [4, 1, 'red'], [1, 3, 'red'], [2, 4, 'blue'],
    [3, 5, 'red'], [5, 4, 'blue'], [1, 5, 'red']
  ]);
}

export function parallelKnot() {
  const edges = [];
  for (const [a, b, blue, red] of [[0, 1, 6, 3], [1, 2, 2, 5], [2, 0, 3, 2]]) {
    for (let i = 0; i < blue; i++) edges.push([a, b, 'blue']);
    for (let i = 0; i < red; i++) edges.push([a, b, 'red']);
  }
  edges.push([2, 2, 'red']);
  return makeBoard(edges);
}

// The six stalks attached above ground sum to three pairs (+1/2, -1/2).
// Losing their shared attachment drops them together with the same zero top.
export function hangingKnot() {
  const edges = smallKnot().edges.map(({ a, b, color }) => [a, b, color]);
  for (let i = 0; i < 3; i++) {
    const v = 6 + 4 * i;
    edges.push([3, v, 'blue'], [v, v + 1, 'red'], [3, v + 2, 'red'], [v + 2, v + 3, 'blue']);
  }
  return makeBoard(edges);
}
