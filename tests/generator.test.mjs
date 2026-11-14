import assert from 'node:assert/strict';
import test from 'node:test';
import { freshSeed, generateBoard } from '../dist/js/generator.js';

const settings = [
  { size: 'small', edges: [6, 9], pieces: [2, 3] },
  { size: 'standard', edges: [11, 16], pieces: [3, 5] },
  { size: 'large', edges: [17, 22], pieces: [4, 5] },
];
const seeds = [
  'GROVE7', '', 'S', 'grove7', '  arbitrary / # ? % =  ', '🌿',
  ...Array.from({ length: 180 }, (_, index) => 'field-' + index),
];

function reachable(start, edges) {
  const neighbors = new Map();
  for (const { a, b } of edges) {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  const found = new Set(start);
  const pending = [...start];
  while (pending.length > 0) {
    for (const next of neighbors.get(pending.pop()) ?? []) {
      if (found.has(next)) continue;
      found.add(next);
      pending.push(next);
    }
  }
  return found;
}

function components(board) {
  const result = [];
  const seen = new Set();
  for (const node of board.nodes) {
    if (seen.has(node.id)) continue;
    const ids = reachable([node.id], board.edges);
    for (const id of ids) seen.add(id);
    result.push({
      nodes: board.nodes.filter(vertex => ids.has(vertex.id)),
      edges: board.edges.filter(edge => ids.has(edge.a)),
    });
  }
  return result;
}

function pointToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const along = ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy);
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function turn(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentGap(a, b, c, d) {
  if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) return 0;
  return Math.min(
    pointToSegment(a, c, d), pointToSegment(b, c, d),
    pointToSegment(c, a, b), pointToSegment(d, a, b)
  );
}

function topologySignature(piece) {
  const degrees = piece.nodes.map(node => {
    const neighbors = piece.edges.filter(edge => edge.a === node.id || edge.b === node.id);
    return (node.ground ? 'g' : 'v') + neighbors.length;
  });
  return degrees.sort().join(',');
}

test('same seed and settings reproduce identifiers, shape, and colors with fresh objects', () => {
  for (const seed of seeds.slice(0, 26)) {
    for (const { size } of settings) {
      const green = generateBoard(seed, 'green', size);
      for (const variant of ['green', 'redblue', 'mixed']) {
        const board = generateBoard(seed, variant, size);
        const replay = generateBoard(seed, variant, size);
        assert.deepEqual(board, replay);
        assert.deepEqual(board.nodes, green.nodes);
        assert.deepEqual(board.edges.map(({ id, a, b }) => [id, a, b]),
          green.edges.map(({ id, a, b }) => [id, a, b]));
        board.edges[0].color = 'changed';
        board.nodes[0].x = -1;
        assert.deepEqual(generateBoard(seed, variant, size), replay);
      }
    }
  }
});

test('graphs are well formed and all live edges are connected to the ground', () => {
  for (const { size, edges, pieces } of settings) {
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size);
      const label = size + '/' + seed;
      assert.ok(board.edges.length >= edges[0] && board.edges.length <= edges[1], label);
      assert.equal(new Set(board.nodes.map(node => node.id)).size, board.nodes.length, label);
      assert.equal(new Set(board.edges.map(edge => edge.id)).size, board.edges.length, label);
      const ids = new Set(board.nodes.map(node => node.id));
      const pairs = new Set();
      board.edges.forEach((edge, index) => {
        assert.equal(edge.id, 'e' + index, label);
        assert.ok(ids.has(edge.a) && ids.has(edge.b) && edge.a !== edge.b, label);
        const pair = [edge.a, edge.b].sort().join('/');
        assert.ok(!pairs.has(pair), label);
        pairs.add(pair);
      });
      const roots = board.nodes.filter(node => node.ground).map(node => node.id);
      assert.deepEqual(reachable(roots, board.edges), ids, label);
      const chunks = components(board);
      assert.ok(chunks.length >= pieces[0] && chunks.length <= pieces[1], label);
      assert.ok(chunks.every(piece => piece.edges.length >= 2), label);
    }
  }
});

test('segments stay in bounds, remain visibly separated, and have accessible cut points', () => {
  for (const { size } of settings) {
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size);
      const label = size + '/' + seed;
      const points = new Map(board.nodes.map(node => [node.id, node]));
      for (const node of board.nodes) {
        assert.ok(Number.isInteger(node.x) && Number.isInteger(node.y), label);
        assert.ok(node.x >= 35 && node.x <= 865, label);
        assert.ok(node.ground ? node.y === 244 : node.y >= 35 && node.y <= 242, label);
      }
      const lines = board.edges.map(edge => [points.get(edge.a), points.get(edge.b)]);
      for (const [index, [a, b]] of lines.entries()) {
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 40, label);
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        for (const [other, [c, d]] of lines.entries()) {
          if (index === other) continue;
          assert.ok(pointToSegment(midpoint, c, d) >= 17, label);
          if (other > index || a === c || a === d || b === c || b === d) continue;
          assert.ok(segmentGap(a, b, c, d) >= 23, label);
        }
      }
      const bounds = components(board).map(({ nodes }) => {
        const xs = nodes.map(node => node.x);
        return [Math.min(...xs), Math.max(...xs)];
      }).sort((a, b) => a[0] - b[0]);
      for (let index = 1; index < bounds.length; index++) {
        assert.ok(bounds[index][0] - bounds[index - 1][1] >= 35, label);
      }
    }
  }
});

test('variant palettes balance player moves and give different players support cuts', () => {
  const variants = { green: ['green'], redblue: ['blue', 'red'], mixed: ['blue', 'green', 'red'] };
  for (const seed of seeds) {
    for (const { size } of settings) {
      for (const [variant, palette] of Object.entries(variants)) {
        const board = generateBoard(seed, variant, size);
        const colors = board.edges.map(edge => edge.color);
        assert.deepEqual([...new Set(colors)].sort(), palette);
        if (variant === 'green') continue;
        const counts = palette.map(color => colors.filter(entry => entry === color).length);
        assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
        assert.ok(Math.min(...counts) >= 2);
        const supports = components(board).map(piece => {
          const roots = new Set(piece.nodes.filter(node => node.ground).map(node => node.id));
          return new Set(piece.edges.filter(edge => roots.has(edge.a) || roots.has(edge.b))
            .map(edge => edge.color));
        });
        assert.ok(supports.some((piece, index) => piece.has('red') &&
          supports.some((other, j) => index !== j && other.has('blue'))));
      }
    }
  }
});

test('seeds vary the topology and produce both cycles and distinct ground supports', () => {
  const signatures = new Set();
  let loops = 0;
  let bridges = 0;
  for (const seed of seeds) {
    const chunks = components(generateBoard(seed, 'green', 'standard'));
    signatures.add(chunks.map(topologySignature).sort().join('/'));
    loops += Number(chunks.some(piece => piece.edges.length >= piece.nodes.length));
    bridges += Number(chunks.some(piece => piece.nodes.filter(node => node.ground).length > 1));
  }
  assert.ok(signatures.size >= 60);
  assert.ok(loops >= 10);
  assert.ok(bridges >= 10);
});

test('the default Grove has a working two-support bridge', () => {
  const board = generateBoard();
  assert.deepEqual(board, generateBoard('GROVE7', 'green', 'standard'));
  assert.equal(board.edges.length, 15);
  const chunks = components(board);
  assert.equal(chunks.length, 4);
  const bridge = chunks.find(piece => piece.nodes.filter(node => node.ground).length === 2);
  assert.ok(bridge);
  const [first, second] = bridge.nodes.filter(node => node.ground);
  const remaining = bridge.edges.filter(edge => edge.a !== first.id && edge.b !== first.id);
  assert.equal(remaining.length, bridge.edges.length - 1);
  const held = reachable([second.id], remaining);
  assert.ok(remaining.every(edge => held.has(edge.a) && held.has(edge.b)));
});

test('fresh seeds are short, human-shareable, and accepted directly', () => {
  const samples = Array.from({ length: 16 }, freshSeed);
  assert.ok(samples.every(seed => /^[A-HJ-NP-Z2-9]{6}$/.test(seed)));
  assert.ok(new Set(samples).size > 1);
  for (const seed of samples) {
    assert.deepEqual(generateBoard(seed), generateBoard(seed));
  }
});
