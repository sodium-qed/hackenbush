import assert from 'node:assert/strict';
import test from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import { LANDMARKS, landmarkIndices } from '../dist/js/map-catalog.js';
import { sceneForSeed } from '../dist/js/scenery.js';

const hex = '0123456789ABCDEF';

function adjacency(nodes, edges) {
  const graph = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    graph.get(e.a).push([e.b, e]);
    graph.get(e.b).push([e.a, e]);
  }
  return graph;
}

function reach(graph, starts, skip) {
  const found = new Set(starts), pending = [...starts];
  while (pending.length) {
    for (const [next, edge] of graph.get(pending.pop())) {
      if (edge === skip || found.has(next)) continue;
      found.add(next);
      pending.push(next);
    }
  }
  return found;
}

// Collapse every non-root two-valent joint. Preserve loops and parallel
// edges when contracting a cycle. The signature uses root status, degrees
// and iterative neighbor-color refinement only: no geometry or part names.
function rootedSignature(vertices, edges, root) {
  const graph = new Map([...vertices].map(id => [id, new Map()]));
  function connect(a, b) {
    graph.get(a).set(b, (graph.get(a).get(b) ?? 0) + 1);
    graph.get(b).set(a, (graph.get(b).get(a) ?? 0) + 1);
  }
  for (const e of edges) connect(e.a, e.b);
  for (const [v, incident] of graph) {
    if (v === root) continue;
    const neighbors = [...incident].flatMap(([n, count]) => Array(count).fill(n));
    if (neighbors.length !== 2 || neighbors.includes(v)) continue;
    for (const n of neighbors) graph.get(n).delete(v);
    graph.delete(v);
    connect(...neighbors);
  }
  const id = [...graph.keys()];
  const invariant = v => {
    const neighbors = graph.get(v);
    return [v === root ? 1 : 0, [...neighbors.values()].reduce((sum, k) => sum + k, 0), neighbors.get(v) ?? 0].join('/');
  };
  let colors = new Map(id.map(v => [v, invariant(v)]));
  const describe = v => {
    const neighbors = [...graph.get(v)].map(([w, count]) => count + '*' + colors.get(w)).sort();
    return colors.get(v) + ':' + neighbors.join(',');
  };
  for (let round = 0; round < id.length; round++) {
    const labels = id.map(describe);
    const palette = new Map([...new Set(labels)].sort().map((name, i) => [name, String(i)]));
    colors = new Map(id.map((v, i) => [v, palette.get(labels[i])]));
  }
  return id.map(v => invariant(v) + '=' + describe(v)).sort().join('|');
}

function sectorSignature(board, slot) {
  const left = slot * 150;
  const vertices = board.nodes.filter(n => n.x >= left && n.x < left + 150 && n.y <= 250);
  const ids = new Set(vertices.map(n => n.id));
  const hub = vertices.find(n => n.x === left + 75 && n.y === 250);
  return rootedSignature(ids, board.edges.filter(e => ids.has(e.a) && ids.has(e.b)), hub.id);
}

// Independently locate motifs in an unlabeled board graph. Each hangs from
// one bridge. Nested hanging twigs disappear when keeping maximal detached
// sets, leaving exactly one entire motif at each of the six backbone ports.
function decodeGraph(board, alphabet) {
  const graph = adjacency(board.nodes, board.edges);
  const roots = new Set(board.nodes.filter(n => n.ground).map(n => n.id));
  const allIds = board.nodes.map(n => n.id);
  const detached = [];
  for (const cut of board.edges) {
    const live = reach(graph, roots, cut);
    if (live.size === allIds.length) continue;
    const ids = new Set(allIds.filter(id => !live.has(id)));
    detached.push({
      ids, root: live.has(cut.a) ? cut.b : cut.a, port: live.has(cut.a) ? cut.a : cut.b,
    });
  }
  detached.sort((a, b) => b.ids.size - a.ids.size);
  const covered = new Set(), attachments = new Map();
  for (const component of detached) {
    if (covered.has(component.root)) continue;
    for (const v of component.ids) covered.add(v);
    const edges = board.edges.filter(e => component.ids.has(e.a) && component.ids.has(e.b));
    attachments.set(component.port, alphabet.get(rootedSignature(component.ids, edges, component.root)));
  }
  assert.equal(attachments.size, 6);
  const core = adjacency(board.nodes.filter(v => !covered.has(v.id)),
    board.edges.filter(e => !covered.has(e.a) && !covered.has(e.b)));
  const routes = new Map();
  for (const port of attachments.keys()) {
    const neighbors = new Set();
    let hasRoot = false;
    for (const [first, startingEdge] of core.get(port)) {
      let v = first, via = startingEdge;
      while (!attachments.has(v) && !roots.has(v)) {
        const onwards = core.get(v).filter(([, edge]) => edge !== via);
        assert.equal(onwards.length, 1);
        [v, via] = onwards[0];
      }
      if (roots.has(v)) hasRoot = true;
      else neighbors.add(v);
    }
    routes.set(port, { neighbors: [...neighbors], hasRoot });
  }
  const ends = [...routes].filter(([, route]) => route.neighbors.length === 1);
  assert.equal(ends.length, 2);
  const starts = ends.filter(([, route]) => routes.get(route.neighbors[0]).hasRoot);
  assert.equal(starts.length, 1);
  let current = starts[0][0], previous, code = '';
  while (current !== undefined) {
    const digit = attachments.get(current);
    assert.ok(hex.includes(digit) && digit !== undefined);
    code += digit;
    const next = routes.get(current).neighbors.find(v => v !== previous);
    previous = current;
    current = next;
  }
  return code;
}

const legacyBoard = (seed, variant = 'green') => generateBoard(seed, variant, 'expert', 4);

test('the generation 4 catalog assigns each of 16 digits one distinct rooted playable topology', () => {
  assert.equal(LANDMARKS.length, 16);
  assert.equal(new Set(LANDMARKS.map(item => item.id)).size, 16);
  assert.equal(new Set(LANDMARKS.map(item => item.name)).size, 16);
  const signatures = new Map();
  for (const digit of hex) {
    const b = legacyBoard(digit.repeat(6));
    const signature = sectorSignature(b, 0);
    assert.ok(!signatures.has(signature), digit + ' collides with ' + signatures.get(signature));
    signatures.set(signature, digit);
    for (let slot = 0; slot < 6; slot++) assert.equal(sectorSignature(b, slot), signature);
  }
  // Each of six ordered positions independently takes any of the 16 different
  // rooted signatures. No hash or pseudorandom choice selects a landmark.
  assert.equal(signatures.size ** 6, 16_777_216);
  for (let i = 0; i < 16; i++) {
    const code = Array.from({ length: 6 }, (_, slot) => hex[(i + 5 * slot) % 16]).join('');
    const board = legacyBoard(code);
    assert.equal(decodeGraph(board, signatures), code);
  }
  for (const code of ['000000', 'FFFFFF', '000001', '100000', '012345', '543210', 'A35D7E', 'E7D53A']) {
    assert.equal(decodeGraph(legacyBoard(code), signatures), code);
  }
});

test('V4 normalizes the code and preserves settings, artwork, and geometry in both palettes', () => {
  const code = 'A35D7E';
  const green = legacyBoard();
  assert.deepEqual(generateBoard('  a35d7e ', 'green', 'expert', '4'), green);
  assert.equal(green.mapSeed, code);
  assert.equal(green.family, sceneForSeed(code).name);
  assert.equal(green.height, 340);
  assert.equal(green.groundY, 314);
  assert.deepEqual(green.landmarks, landmarkIndices(code).map(i => LANDMARKS[i].name));
  for (const invalid of ['', '12345', '0000000', 'Z00000', 'GROVE7', '0xABCD', null, 123456]) {
    assert.throws(() => legacyBoard(invalid), RangeError);
  }
  for (const digit of hex) {
    const seed = digit.repeat(6);
    const a = legacyBoard(seed), b = generateBoard(seed, 'redblue', 'expert', 4);
    assert.ok(a.edges.every(e => e.color === 'green'));
    assert.deepEqual(b.nodes, a.nodes);
    assert.deepEqual(b.edges.map(e => ({ ...e, color: 'green' })), a.edges);
    const count = b.edges.filter(e => e.color === 'red').length;
    assert.ok(Math.abs(2 * count - b.edges.length) <= 1);
    const g = adjacency(b.nodes, b.edges);
    const roots = new Set(b.nodes.filter(n => n.ground).map(n => n.id));
    assert.ok(roots.size >= 3);
    assert.equal(reach(g, roots).size, b.nodes.length);
    assert.ok(b.edges.length >= 82 && b.edges.length <= 100);
    for (const color of ['red', 'blue']) {
      const moves = b.edges.filter(e => e.color === color);
      assert.ok(moves.some(e => (roots.has(e.a) || roots.has(e.b)) &&
        reach(g, roots, e).size === b.nodes.length));
      assert.ok(moves.some(e => !roots.has(e.a) && !roots.has(e.b) &&
        b.nodes.length - reach(g, roots, e).size >= 2));
    }
    b.edges.forEach((e, i) => assert.equal(e.id, 'e' + i));
  }
});
