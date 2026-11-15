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

test('version 2 reproduces identifiers, shape, and colors with fresh objects', () => {
  for (const seed of seeds.slice(0, 26)) {
    for (const { size } of settings) {
      const green = generateBoard(seed, 'green', size, 2);
      for (const variant of ['green', 'redblue', 'mixed']) {
        const board = generateBoard(seed, variant, size, 2);
        const replay = generateBoard(seed, variant, size, 2);
        assert.deepEqual(board, replay);
        assert.deepEqual(board.nodes, green.nodes);
        assert.deepEqual(board.edges.map(({ id, a, b }) => [id, a, b]),
          green.edges.map(({ id, a, b }) => [id, a, b]));
        board.edges[0].color = 'changed';
        board.nodes[0].x = -1;
        assert.deepEqual(generateBoard(seed, variant, size, 2), replay);
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
  const original = createHash('sha256');
  for (const seed of ['GROVE7', '', '  arbitrary / # ? % =  ', '🌿',
    ...Array.from({ length: 33 }, (_, i) => 'legacy-' + i)]) {
    for (const { size } of settings) {
      for (const variant of ['green', 'redblue', 'mixed']) {
        original.update(JSON.stringify(generateBoard(seed, variant, size, 2)));
      }
    }
  }
  assert.equal(original.digest('hex'), 'b9f09c96928137b75ec7a733abb6a422cdb6077100d04a0595973baabe167c09');
});

test('historical version 2 networks remain connected above ground at every original size', () => {
  for (const { size, edges, cycles, supports } of settings) {
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size, 2);
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

test('version 2 segments retain their original geometry', () => {
  for (const { size } of settings) {
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size, 2);
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

test('version 2 palettes retain their independent and cascading cuts', () => {
  const variants = { green: ['green'], redblue: ['blue', 'red'], mixed: ['blue', 'green', 'red'] };
  for (const seed of seeds) {
    for (const { size } of settings) {
      for (const [variant, palette] of Object.entries(variants)) {
        const board = generateBoard(seed, variant, size, 2);
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

test('version 2 topology and cascades are preserved at every original size', () => {
  for (const { size, cascade, cycles, edges } of settings) {
    const signatures = new Set();
    const counts = new Set();
    for (const seed of seeds) {
      const board = generateBoard(seed, 'green', size, 2);
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

test('the original version 2 Grove keeps its three cycles, three roots and detachable outer crown', () => {
  const board = generateBoard('GROVE7', 'green', 'standard', 2);
  assert.equal(board.edges.length, 32);
  assert.equal(board.nodes.filter(node => node.ground).length, 3);
  assert.equal(board.edges.length - board.nodes.length + 1, 3);
  assert.equal(extraFalls(board, board.edges[0]), 0);
  assert.equal(extraFalls(board, board.edges[9]), 2);
  assert.equal(extraFalls(board, board.edges[25]), 4);
});

const gardenSeeds = ['GROVE7', 'FIELD0', 'c', '🌼', '', '  /% # expert  ',
  ...Array.from({ length: 64 }, (_, i) => 'botanical-' + i)];

test('the version 3 Expert gardens reproduce both colors and original replay edge indices', () => {
  const opening = generateBoard(undefined, 'green', 'expert', 3);
  assert.equal(opening.family, 'Interwoven garden');
  assert.equal(opening.edges.length, 91);
  assert.equal(opening.edges.filter(e => e.control).length, 81);
  for (const size of ['small', 'standard', 'large', 'expert', undefined]) {
    assert.deepEqual(generateBoard('GROVE7', 'green', size, 3), opening);
    assert.deepEqual(generateBoard('GROVE7', 'green', size, '3'), opening);
  }
  const digest = createHash('sha256');
  for (const seed of ['GROVE7', 'FIELD0', 'N4X7TM', '🌼', ...'abcdefghijklmnop']) {
    for (const variant of ['green', 'redblue']) {
      digest.update(JSON.stringify(generateBoard(seed, variant, 'expert', 3)));
    }
  }
  assert.equal(digest.digest('hex'), '553cfe8a7f005e9b793103a66fb125ccd84748eefe51ec48e3c20dad78170b64');
  const copy = generateBoard('GROVE7', 'green', 'expert', 3);
  copy.edges.find(edge => edge.control).control.x = -999;
  assert.deepEqual(generateBoard('GROVE7', 'green', 'expert', 3), opening);
});

test('flowers, tree canopies, root arches and trellises contribute real cycles with shared grounds', () => {
  const families = new Set();
  const topologies = new Set();
  for (const seed of gardenSeeds) {
    const b = generateBoard(seed, 'green', 'expert', 3);
    families.add(b.family);
    topologies.add(topologySignature(b));
    assert.ok(b.edges.length >= 82 && b.edges.length <= 100, seed);
    assert.equal(b.height, 340);
    assert.equal(b.groundY, 314);
    assert.equal(components(b).length, 1, seed);
    assert.ok(b.edges.every(edge => edge.color === 'green'));
    const roots = b.nodes.filter(n => n.ground);
    const above = b.nodes.filter(n => !n.ground);
    assert.ok(roots.length >= 4, seed);
    assert.ok(roots.every(n => n.y === b.groundY), seed);
    const lifted = b.edges.filter(e => !roots.some(n => n.id === e.a || n.id === e.b));
    assert.deepEqual(reachable([above[0].id], lifted), new Set(above.map(n => n.id)), seed);
    assert.ok(lifted.length - above.length + 1 >= 20, seed);
    const groups = {};
    for (const edge of b.edges) (groups[edge.part] ??= []).push(edge);
    const contour = id => new Set(groups.petal.filter(e => e.a === id || e.b === id)
      .map(e => e.a === id ? e.b : e.a));
    const closedPetals = groups['flower center'].filter(edge => {
      const from = contour(edge.a);
      return [...contour(edge.b)].some(id => from.has(id));
    });
    assert.ok(closedPetals.length >= 4, seed);
    for (const name of ['root arch', 'canopy', 'graft']) {
      assert.ok(groups[name].length > 0);
      for (const edge of groups[name]) {
        assert.ok(reachable([edge.a], lifted.filter(other => other !== edge)).has(edge.b), seed + '/' + name);
      }
    }
    assert.ok(above.some(n => groups.lattice.filter(e => e.a === n.id || e.b === n.id).length === 4), seed);
    assert.ok(groups['root runner'].length >= 6 && groups.graft.length >= 4, seed);
    assert.ok(Math.max(...groups.stem.map(edge => extraFalls(b, edge))) >= 12, seed);
    assert.ok(groups['hanging vine'].some(edge => extraFalls(b, edge) > 0), seed);
    assert.ok(roots.every(root => b.edges.filter(e => e.a === root.id || e.b === root.id)
      .every(e => extraFalls(b, e) === 0)), seed);
    const pairs = new Set(b.edges.map(e => [e.a, e.b].sort().join('/')));
    assert.equal(pairs.size, b.edges.length, seed);
    b.edges.forEach((edge, index) => assert.equal(edge.id, 'e' + index));
  }
  assert.deepEqual([...families].sort(), ['Interwoven garden', 'Orchard grove', 'Vine trellis', 'Wildflower meadow']);
  assert.ok(topologies.size >= 35);
});

test('red and blue receive exclusive quiet and cascading moves on the same garden geometry', () => {
  for (const seed of gardenSeeds) {
    const green = generateBoard(seed, 'green', 'expert', 3);
    const colored = generateBoard(seed, 'redblue', 'expert', 3);
    assert.deepEqual(colored.nodes, green.nodes);
    assert.deepEqual(colored.edges.map(e => ({ ...e, color: 'green' })), green.edges);
    const roots = new Set(colored.nodes.filter(node => node.ground).map(node => node.id));
    const blue = colored.edges.filter(e => e.color === 'blue').length;
    assert.ok(Math.abs(blue * 2 - colored.edges.length) <= 1);
    for (const color of ['blue', 'red']) {
      const moves = colored.edges.filter(e => e.color === color);
      assert.ok(moves.some(e => extraFalls(colored, e) > 0), seed);
      assert.ok(moves.some(e => (roots.has(e.a) || roots.has(e.b)) && extraFalls(colored, e) === 0), seed);
    }
  }
});

function curveSamples(a, control, b) {
  if (!control) return [a, b];
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24, s = 1 - t;
    return { x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
      y: s * s * a.y + 2 * s * t * control.y + t * t * b.y };
  });
}

test('curved contours stay on the field, expose usable cut points, and meet at shared joints only', () => {
  for (const seed of gardenSeeds.slice(0, 24)) {
    const board = generateBoard(seed, 'green', 'expert', 3);
    const nodes = new Map(board.nodes.map(n => [n.id, n]));
    for (let i = 0; i < board.nodes.length; i++) {
      const a = board.nodes[i];
      for (let j = 0; j < i; j++) {
        const b = board.nodes[j];
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 16, seed);
      }
    }
    const paths = board.edges.map(e => {
      const a = nodes.get(e.a), b = nodes.get(e.b);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 18, seed);
      const points = curveSamples(a, e.control, b);
      const xx = points.map(p => p.x), yy = points.map(p => p.y);
      assert.ok(Math.min(...xx) >= 9 && Math.max(...xx) <= 891, seed);
      assert.ok(Math.min(...yy) >= 11 && Math.max(...yy) <= board.groundY, seed);
      const midpoint = e.control ? points[12] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return { edge: e, points, midpoint, left: Math.min(...xx), right: Math.max(...xx),
        top: Math.min(...yy), bottom: Math.max(...yy) };
    });
    for (let i = 0; i < paths.length; i++) {
      const a = paths[i];
      for (let j = 0; j < i; j++) {
        const b = paths[j];
        if (a.left > b.right + 8 || a.right < b.left - 8 || a.top > b.bottom + 8 || a.bottom < b.top - 8) continue;
        const shared = [a.edge.a, a.edge.b].some(id => b.edge.a === id || b.edge.b === id);
        for (let m = 1; m < a.points.length; m++) {
          const p = a.points[m - 1], q = a.points[m];
          assert.ok(pointToSegment(b.midpoint, p, q) >= 5.7, seed);
          for (let n = 1; n < b.points.length; n++) {
            const u = b.points[n - 1], v = b.points[n];
            assert.ok(!(turn(p, q, u) * turn(p, q, v) < -1e-8 && turn(u, v, p) * turn(u, v, q) < -1e-8), seed);
            if (!shared) assert.ok(segmentGap(p, q, u, v) >= 6.7, seed);
          }
        }
        for (let n = 1; n < b.points.length; n++) {
          assert.ok(pointToSegment(a.midpoint, b.points[n - 1], b.points[n]) >= 5.7, seed);
        }
      }
    }
  }
});

test('fresh seeds are short, human-shareable, and accepted directly', () => {
  const samples = Array.from({ length: 16 }, freshSeed);
  assert.ok(samples.every(seed => /^[0-9A-F]{6}$/.test(seed)));
  assert.ok(new Set(samples).size > 1);
  for (const seed of samples) {
    assert.deepEqual(generateBoard(seed), generateBoard(seed));
  }
});
