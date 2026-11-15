import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../dist/js/world-generator.js';
import { permuteMapNumber } from '../dist/js/map-seed.js';
import { cutEdge, initialEdges, legalMoves } from '../dist/js/rules.js';

const hex = '0123456789ABCDEF';
const seedOf = n => (n & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
const examples = ['000000', '000001', 'FFFFFF', 'FFFFFE', 'A35D7E', 'C0FFEE', 'C0FFEF',
  ...Array.from({ length: 160 }, (_, i) => seedOf(72991 + 76891 * i))];

function adjacency(board) {
  const neighbors = new Map(board.nodes.map(n => [n.id, []]));
  for (const e of board.edges) {
    neighbors.get(e.a).push(e.b);
    neighbors.get(e.b).push(e.a);
  }
  return neighbors;
}

function components(neighbors) {
  const unseen = new Set(neighbors.keys());
  let count = 0;
  while (unseen.size) {
    const start = unseen.values().next().value;
    const pending = [start];
    unseen.delete(start);
    count++;
    while (pending.length) for (const next of neighbors.get(pending.pop())) {
      if (unseen.delete(next)) pending.push(next);
    }
  }
  return count;
}

test('world codes normalize, share identically, and rebuild independent mutable objects', () => {
  const first = generateWorld(' c0Ffee ');
  const replay = generateWorld('C0FFEE');
  assert.deepEqual(first, replay);
  assert.equal(first.mapSeed, 'C0FFEE');
  first.nodes[0].x = -90;
  first.edges.find(e => e.control).control.y = 700;
  first.world.landmarks.pop();
  assert.deepEqual(generateWorld('C0FFEE'), replay);
  for (const value of [null, undefined, 0, '', '0xABC1', '12345', '1234567', 'AAAAAG']) {
    assert.throws(() => generateWorld(value), RangeError);
  }
});

test('entire playable networks start grounded with quiet roots and genuine cascading openings', () => {
  const habitats = new Set(), islands = new Set(), counts = new Set();
  for (const seed of examples) {
    const b = generateWorld(seed), n = new Map(b.nodes.map(v => [v.id, v]));
    const live = initialEdges(b);
    habitats.add(b.world.biome);
    islands.add(b.world.components);
    counts.add(b.world.landmarks.length);
    assert.equal(b.height, 340, seed);
    assert.equal(b.groundY, 314, seed);
    assert.deepEqual(live, b.edges.map(e => e.id), seed);
    assert.deepEqual(legalMoves(b, live, 'red'), live, seed);
    assert.deepEqual(legalMoves(b, live, 'blue'), live, seed);
    assert.ok(b.edges.length >= 75 && b.edges.length <= 180, seed);
    const graph = adjacency(b);
    assert.ok([...graph.values()].every(list => list.length > 0), seed);
    assert.equal(components(graph), b.world.components, seed);
    const pairs = new Set();
    for (const [i, e] of b.edges.entries()) {
      assert.equal(e.id, 'e' + i, seed);
      assert.ok(e.part && e.a !== e.b && e.color === 'green', seed);
      const pair = [e.a, e.b].sort().join('/');
      assert.ok(!pairs.has(pair), seed);
      pairs.add(pair);
    }
    assert.ok(b.roots.length >= 2 && b.loads.length >= 2, seed);
    for (const i of b.roots) {
      const e = b.edges[i];
      assert.ok(n.get(e.a).ground || n.get(e.b).ground, seed);
      assert.equal(cutEdge(b, live, e.id, 'blue').fallen.length, 0, seed);
    }
    for (const i of b.loads) {
      const e = b.edges[i];
      assert.ok(!n.get(e.a).ground && !n.get(e.b).ground, seed);
      assert.ok(cutEdge(b, live, e.id, 'blue').fallen.length > 0, seed);
    }
  }
  assert.equal(habitats.size, 8);
  assert.deepEqual([...counts].sort(), [3, 4, 5]);
  assert.deepEqual([...islands].sort(), [1, 2, 3]);
});

// Reconstruct the 24-bit value from the cuttable ground attachments alone.
// This independent bottom-up table ranks legal sequences lexicographically.
const suffixes = [Array.from({ length: 84 }, (_, cell) => cell >= 62 ? 1 : 0)];
for (let n = 1; n <= 7; n++) suffixes.push(suffixes[n - 1].map((_, cell) =>
  suffixes[n - 1].slice(cell + 4, cell + 32).reduce((sum, count) => sum + count, 0)));
const sum = cells => cells.reduce((a, b) => a + b, 0);
function readGround(board) {
  const cells = board.nodes.filter(n => n.ground).map(n => (n.x - 35) / 10).sort((a, b) => a - b);
  const total = sum(suffixes[cells.length - 1].slice(0, 22));
  assert.ok(total > 2 ** 22);
  let rank = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i], first = i ? cells[i - 1] + 4 : 0;
    assert.ok(Number.isInteger(cell) && cell >= first && cell <= 83);
    assert.ok(i ? cell <= cells[i - 1] + 31 : cell <= 21);
    rank += sum(suffixes[cells.length - 1 - i].slice(first, cell));
  }
  assert.ok(cells.at(-1) >= 62);
  const payload = Number((BigInt(rank) * 0x400000n + BigInt(total - 1)) / BigInt(total));
  return (cells.length - 5) * 2 ** 22 + payload;
}

function originalCode(word) {
  function unshift(x, distance) {
    for (let shift = distance; shift < 24; shift *= 2) x ^= x >>> shift;
    return x & 0xffffff;
  }
  function divide(x, odd) {
    let inverse = 1;
    for (let i = 0; i < 5; i++) inverse = Math.imul(inverse, 2 - Math.imul(inverse, odd));
    return Math.imul(x, inverse) & 0xffffff;
  }
  const first = divide(unshift(word, 12), 0x9e3779);
  const second = divide(unshift(first, 9), 0x52dce9);
  return seedOf(unshift(second, 11) ^ 0xb7283d);
}

test('all four root-count classes carry a full, recoverable 22-bit layout rank', () => {
  const words = examples.map(seed => permuteMapNumber(parseInt(seed, 16) ^ 0xb7283d));
  for (let count = 0; count < 4; count++) {
    for (const payload of [0, 1, 2, 0x155555, 0x200000, 0x3ffffe, 0x3fffff])
      words.push((count << 22) + payload);
  }
  for (const word of words) assert.equal(readGround(generateWorld(originalCode(word))), word);
});

// Only graph incidence, ground status and actual first-cut outcomes enter
// this fingerprint. Names, drawing coordinates, region art, edge IDs and
// seeds themselves cannot make two examples appear different.
function playSignature(board) {
  const graph = adjacency(board);
  let colors = new Map(board.nodes.map(n => [n.id, (n.ground ? 'g' : 'n') + graph.get(n.id).length]));
  for (let round = 0; round < 2; round++) {
    const previous = colors;
    colors = new Map([...graph].map(([id, adjacent]) =>
      [id, previous.get(id) + '[' + adjacent.map(v => previous.get(v)).sort().join(',') + ']']));
  }
  const live = initialEdges(board);
  const falls = board.edges.map(e => cutEdge(board, live, e.id, 'red').fallen.length).filter(n => n > 0).sort((a, b) => a - b);
  return [...colors.values()].sort().join('|') + '/' + falls.join(',');
}

test('every digit can change the whole rooted game, distribution of supports and biome', () => {
  for (const starting of ['000000', 'C0FFEE', 'A35D7E']) {
    const games = new Set(), ground = new Set();
    for (let position = 0; position < 6; position++) {
      const habitats = new Set(), dominant = new Set();
      for (const digit of hex) {
        if (digit === starting[position]) continue;
        const seed = starting.slice(0, position) + digit + starting.slice(position + 1);
        const board = generateWorld(seed);
        const game = playSignature(board);
        const feet = board.nodes.filter(n => n.ground).map(n => n.x).sort().join(',');
        assert.ok(!games.has(game) && !ground.has(feet), seed);
        games.add(game); ground.add(feet);
        habitats.add(board.world.biome); dominant.add(board.world.dominant);
      }
      assert.ok(habitats.size >= 4 && dominant.size >= 4, starting + '/' + position);
    }
    assert.equal(games.size, 90);
  }
});

function pointAt(a, b, c, t) {
  const s = 1 - t;
  return c ? { x: s*s*a.x + 2*s*t*c.x + t*t*b.x, y: s*s*a.y + 2*s*t*c.y + t*t*b.y } :
    { x: s*a.x + t*b.x, y: s*a.y + t*b.y };
}
function turn(a,b,c) { return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x); }
function distance(p,a,b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy)/(dx*dx + dy*dy)));
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
}

test('field bounds and picking clearance hold across representative worlds and prior tight contours', () => {
  const seeds = [...examples.slice(0, 26), '89365B', 'A072F5', '3933AD', 'C05B10', '1C194C', 'A3F806', '3F4BF6'];
  for (const seed of seeds) {
    const board = generateWorld(seed), n = new Map(board.nodes.map(v => [v.id, v]));
    const contours = board.edges.map(edge => {
      const a = n.get(edge.a), b = n.get(edge.b);
      const pts = Array.from({ length: 11 }, (_, i) => pointAt(a, b, edge.control, i / 10));
      for (const p of pts) assert.ok(p.x >= 7 && p.x <= 893 && p.y >= 11 && p.y <= 314.0001, seed);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      return { edge, pts, picks: Array(7).fill(Infinity), left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys) };
    });
    for (let i = 0; i < contours.length; i++) {
      const a = contours[i];
      for (let j = 0; j < i; j++) {
        const b = contours[j];
        if (a.right + 8 < b.left || a.left - 8 > b.right || a.bottom + 8 < b.top || a.top - 8 > b.bottom) continue;
        for (let v = 1; v < a.pts.length; v++) {
          const p = a.pts[v-1], q = a.pts[v];
          for (let w = 1; w < b.pts.length; w++) {
            const r = b.pts[w-1], s = b.pts[w];
            assert.ok(!(turn(p,q,r)*turn(p,q,s) < -1e-8 && turn(r,s,p)*turn(r,s,q) < -1e-8),
              seed + '/' + a.edge.id + '/' + b.edge.id);
            if (v >= 2 && v <= 8) a.picks[v-2] = Math.min(a.picks[v-2], distance(q,r,s));
            if (w >= 2 && w <= 8) b.picks[w-2] = Math.min(b.picks[w-2], distance(s,p,q));
          }
        }
      }
      assert.ok(Math.max(...a.picks) >= 3.8, seed + '/' + a.edge.id);
    }
    assert.ok(contours.every(c => Math.max(...c.picks) >= 3.8), seed);
  }
});
