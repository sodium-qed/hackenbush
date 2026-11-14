import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { freshSeed, generateBoard } from '../dist/js/generator.js';

const settings = [
  { size: 'small', edges: [12, 18], cycles: 1, supports: 2, cascade: 2 },
  { size: 'standard', edges: [24, 32], cycles: 2, supports: 2, cascade: 3 },
  { size: 'large', edges: [36, 48], cycles: 3, supports: 3, cascade: 4 },
];
const seeds = [
  'GROVE7', 'GROVE-RESERVE-1', '', 'S', 'grove7', '  arbitrary / # ? % =  ', '🌿',
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

function extraFalls(board, cut) {
  const rest = board.edges.filter(edge => edge !== cut);
  const grounded = reachable(board.nodes.filter(node => node.ground).map(node => node.id), rest);
  return rest.filter(edge => !grounded.has(edge.a)).length;
}

test('version 1 reproduces complete legacy seeds, colors and move identifiers byte for byte', () => {
  // Captured from the original deployed board generator before adding version 2.
  const fixtures = [
    ['GROVE7', 'green', 'standard', '8f9974a19e1480783ea8e09a3075d07a464a69a6064eb62687c6a183f9074f15'],
    ['GROVE7', 'redblue', 'standard', '930fd90dd3a32bca142f02da1710d819cd4c9fb0d77a7a444446761dbd422723'],
    ['GROVE7', 'mixed', 'standard', 'e0a61477cf49f1d45d50cc112e9abc78eaac2216ceb7e8216600cada718c63cd'],
    ['forest legacy /🌿', 'mixed', 'large', 'ebd5b90150e562b0a17966de83016a107899d07c54c0fb0a752885e8821ca14a'],
    ['H7K4QF', 'redblue', 'small', '285c4699299189b63765c42f2dd9acc1ac37aabb26f691007d4a0f85d500c3af'],
  ];
  for (const [seed, variant, size, digest] of fixtures) {
    const board = generateBoard(seed, variant, size, 1);
    assert.equal(createHash('sha256').update(JSON.stringify(board)).digest('hex'), digest);
    assert.deepEqual(board, generateBoard(seed, variant, size, '1'));
  }
  const matrix = createHash('sha256');
  const legacySeeds = ['GROVE7', '', '  arbitrary / # ? % =  ', '🌿',
    ...Array.from({ length: 33 }, (_, index) => 'legacy-' + index)];
  for (const seed of legacySeeds) {
    for (const { size } of settings) {
      for (const variant of ['green', 'redblue', 'mixed']) {
        matrix.update(JSON.stringify(generateBoard(seed, variant, size, 1)));
      }
    }
  }
  assert.equal(matrix.digest('hex'), 'c136be62e1744a5ac25f9e191ceb5681038eca40ad8872cdd40857c0aaf2b333');
});

test('same seed and settings reproduce identifiers, shape, and colors with fresh objects', () => {
  for (const seed of seeds.slice(0, 26)) {
    for (const { size } of settings) {
      const green = generateBoard(seed, 'green', size);
      for (const variant of ['green', 'redblue', 'mixed']) {
        const board = generateBoard(seed, variant, size);
        const replay = generateBoard(seed, variant, size, 2);
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

test('version 2 seed layouts, colors and edge indices remain replay-compatible', () => {
  const matrix = createHash('sha256');
  for (const seed of ['GROVE7', 'FIELD0', 'N4X7TM', 'GROVE-RESERVE-1', '🌿']) {
    for (const { size } of settings) {
      for (const variant of ['green', 'redblue', 'mixed']) {
        matrix.update(JSON.stringify(generateBoard(seed, variant, size, 2)));
      }
    }
  }
  assert.equal(matrix.digest('hex'), '7917e6f4d9c5177abafacc916ab278270472fa81ea263b3907f8ae64202b9aa5');
});

test('each network spans the field, stays connected above ground, and has independent supports', () => {
  for (const { size, edges, cycles, supports } of settings) {
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
      assert.equal(components(board).length, 1, label);
      assert.ok(roots.length >= supports, label);
      const above = board.nodes.filter(node => !node.ground).map(node => node.id);
      const lifted = board.edges.filter(edge => !roots.includes(edge.a) && !roots.includes(edge.b));
      assert.deepEqual(reachable([above[0]], lifted), new Set(above), label);
      assert.ok(lifted.length - above.length + 1 >= cycles, label);
      const xs = board.nodes.map(node => node.x);
      assert.ok(Math.max(...xs) - Math.min(...xs) >= 650, label);
      // Any one surviving support can hold the entire above-ground network.
      for (const root of roots) {
        const held = reachable([root], board.edges.filter(edge =>
          (edge.a === root || !roots.includes(edge.a)) && (edge.b === root || !roots.includes(edge.b))));
        assert.ok(above.every(id => held.has(id)), label);
      }
    }
  }
});

test('segments stay in bounds, remain visibly separated, and have accessible cut points', () => {
  for (const { size } of settings) {
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size);
      const label = size + '/' + seed;
      const points = new Map(board.nodes.map(node => [node.id, node]));
      for (const [index, node] of board.nodes.entries()) {
        assert.ok(Number.isInteger(node.x) && Number.isInteger(node.y), label);
        assert.ok(node.x >= 35 && node.x <= 865, label);
        assert.ok(node.ground ? node.y === 244 : node.y >= 35 && node.y <= 215, label);
        for (const neighbor of board.nodes.slice(0, index)) {
          assert.ok(Math.hypot(node.x - neighbor.x, node.y - neighbor.y) >= 30, label);
        }
      }
      const lines = board.edges.map(edge => [points.get(edge.a), points.get(edge.b)]);
      for (const [index, [a, b]] of lines.entries()) {
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 32, label);
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        for (const [other, [c, d]] of lines.entries()) {
          if (index === other) continue;
          assert.ok(pointToSegment(midpoint, c, d) >= 14 - 1e-8, label);
          if (other > index || a === c || a === d || b === c || b === d) continue;
          assert.ok(segmentGap(a, b, c, d) >= 20 - 1e-8, label);
        }
      }
    }
  }
});

test('each player has exclusive cascading cuts and independent quiet support cuts', () => {
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
        const roots = new Set(board.nodes.filter(node => node.ground).map(node => node.id));
        for (const color of ['red', 'blue']) {
          const moves = board.edges.filter(edge => edge.color === color);
          assert.ok(moves.some(edge => extraFalls(board, edge) > 0));
          assert.ok(moves.some(edge => (roots.has(edge.a) || roots.has(edge.b)) && extraFalls(board, edge) === 0));
        }
      }
    }
  }
});

test('topologies vary across seeds and support meaningful opening cascades at every size', () => {
  for (const { size, cascade, cycles, edges } of settings) {
    const signatures = new Set();
    const counts = new Set();
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size);
      signatures.add(topologySignature(board));
      counts.add(board.edges.length);
      const falls = board.edges.map(edge => extraFalls(board, edge));
      assert.ok(falls.filter(value => value > 0).length >= 2, size + '/' + seed);
      assert.ok(Math.max(...falls) >= cascade, size + '/' + seed);
      const degrees = board.nodes.map(n => board.edges.filter(e => e.a === n.id || e.b === n.id).length);
      assert.ok(degrees.filter(degree => degree >= 3).length >= 2 * cycles);
    }
    assert.ok(signatures.size >= (size === 'small' ? 28 : 75));
    assert.equal(counts.size, edges[1] - edges[0] + 1);
  }
});

test('the opening Grove has three real upper cycles, three roots and a detachable outer crown', () => {
  const board = generateBoard();
  assert.deepEqual(board, generateBoard('GROVE7', 'green', 'standard'));
  assert.equal(board.edges.length, 32);
  assert.equal(board.nodes.filter(node => node.ground).length, 3);
  assert.equal(board.edges.length - board.nodes.length + 1, 3);
  assert.equal(extraFalls(board, board.edges[0]), 0);
  assert.equal(extraFalls(board, board.edges[9]), 2);
  assert.equal(extraFalls(board, board.edges[25]), 4);
});

test('fresh seeds are short, human-shareable, and accepted directly', () => {
  const samples = Array.from({ length: 16 }, freshSeed);
  assert.ok(samples.every(seed => /^[A-HJ-NP-Z2-9]{6}$/.test(seed)));
  assert.ok(new Set(samples).size > 1);
  for (const seed of samples) {
    assert.deepEqual(generateBoard(seed), generateBoard(seed));
  }
});
