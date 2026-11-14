import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove } from '../dist/js/strategy.js';
import { generateBoard } from '../dist/js/generator.js';

function makeBoard(connections, roots = [0]) {
  const vertices = new Set([...roots, ...connections.flatMap(([a, b]) => [a, b])]);
  return {
    nodes: [...vertices].map(id => ({ id, ground: roots.includes(id) })),
    edges: connections.map(([a, b, color], i) => ({ id: `e${i}`, a, b, color })),
  };
}

// Independent oracle: repeated reachability scans and full normal-play minimax.
// It shares neither the production fall calculation nor any valuation formula.
function oracle(board) {
  const lookup = new Map(board.edges.map(edge => [edge.id, edge]));
  const ground = board.nodes.filter(node => node.ground).map(node => node.id);
  const cache = new Map();

  function moves(live, side) {
    return live.filter(id => ['green', side].includes(lookup.get(id).color));
  }

  function after(live, id) {
    const remaining = live.filter(edge => edge !== id);
    const reached = new Set(ground);
    let size;
    do {
      size = reached.size;
      for (const edgeId of remaining) {
        const { a, b } = lookup.get(edgeId);
        if (reached.has(a)) reached.add(b);
        if (reached.has(b)) reached.add(a);
      }
    } while (size !== reached.size);
    return remaining.filter(edge => reached.has(lookup.get(edge).a));
  }

  function wins(live, side) {
    const key = side + live.join(',');
    if (cache.has(key)) return cache.get(key);
    const other = side === 'blue' ? 'red' : 'blue';
    const outcome = moves(live, side).some(id => !wins(after(live, id), other));
    cache.set(key, outcome);
    return outcome;
  }

  return { moves, after, wins };
}

function verifyPosition(board, live = board.edges.map(edge => edge.id)) {
  const referee = oracle(board);
  for (const side of ['blue', 'red']) {
    const choice = chooseMove(board, live, side, { budgetMs: 500 });
    const other = side === 'blue' ? 'red' : 'blue';
    assert.equal(choice.proven, true);
    assert.equal(choice.winning, referee.wins(live, side));
    if (referee.moves(live, side).length) {
      assert.ok(referee.moves(live, side).includes(choice.edgeId));
      if (choice.winning) assert.equal(referee.wins(referee.after(live, choice.edgeId), other), false);
    } else {
      assert.equal(choice.edgeId, null);
    }
  }
}

test('Green choices account for fused loops, multiple roots, bridges, and parallel edges', () => {
  const topology = [[0, 1], [1, 2], [2, 3], [3, 1], [2, 4], [4, 5], [4, 5], [4, 4], [6, 3]];
  const board = makeBoard(topology.map(([a, b]) => [a, b, 'green']), [0, 6]);
  const all = board.edges.map(edge => edge.id);
  const referee = oracle(board);
  verifyPosition(board, all);
  for (const id of all) verifyPosition(board, referee.after(all, id));
});

test('red-blue trees and grounded cycles agree with minimax across all six-edge colorings', () => {
  const topologies = [
    [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [0, 6]],
    [[0, 1], [1, 2], [2, 7], [2, 3], [0, 4], [4, 4]],
  ];
  for (const topology of topologies) {
    for (let pattern = 0; pattern < 2 ** topology.length; pattern++) {
      const edges = topology.map(([a, b], i) => [a, b, pattern & (1 << i) ? 'red' : 'blue']);
      verifyPosition(makeBoard(edges, [0, 7]));
    }
  }
});

test('all three-color assignments on a five-edge graph agree with exhaustive play', () => {
  const topology = [[0, 1], [1, 2], [2, 0], [2, 3], [0, 4]];
  const colors = ['green', 'blue', 'red'];
  for (let pattern = 0; pattern < 3 ** topology.length; pattern++) {
    const edges = topology.map(([a, b], i) => [a, b, colors[Math.floor(pattern / 3 ** i) % 3]]);
    verifyPosition(makeBoard(edges));
  }
});

test('random rooted multigraphs and reachable snapshots match independent play', () => {
  let state = 1699;
  function draw(limit) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 2 ** 32) * limit);
  }
  const palettes = [['green'], ['blue', 'red'], ['green', 'blue', 'red']];
  for (let sample = 0; sample < 72; sample++) {
    const palette = palettes[sample % palettes.length];
    const colors = () => palette[draw(palette.length)];
    const vertices = 3 + draw(5);
    const edges = Array.from({ length: vertices - 1 }, (_, i) => [i + 1, draw(i + 1), colors()]);
    for (let i = 0; i < 3; i++) edges.push([draw(vertices), draw(vertices), colors()]);
    const board = makeBoard(edges, sample % 4 ? [0] : [0, vertices - 1]);
    verifyPosition(board);
    const ids = board.edges.map(edge => edge.id);
    verifyPosition(board, oracle(board).after(ids, ids[draw(ids.length)]));
  }
});

test('terminal and bounded search results have distinct outcomes and legal fallbacks', () => {
  const board = makeBoard([[0, 1, 'blue'], [1, 2, 'green'], [0, 3, 'red'], [3, 4, 'green']]);
  const ids = board.edges.map(edge => edge.id);
  assert.deepEqual(chooseMove(board, [], 'blue'), { edgeId: null, proven: true, winning: false });
  assert.deepEqual(chooseMove(board, ['e0'], 'red'), { edgeId: null, proven: true, winning: false });
  const bounded = chooseMove(board, ids, 'blue', { budgetMs: 0 });
  assert.ok(oracle(board).moves(ids, 'blue').includes(bounded.edgeId));
  assert.deepEqual([bounded.proven, bounded.winning], [false, null]);

  const wide = makeBoard(Array.from({ length: 35 }, (_, i) => [0, i + 1, i % 2 ? 'red' : 'blue']));
  const wideIds = wide.edges.map(edge => edge.id);
  const fallback = chooseMove(wide, wideIds, 'red', { budgetMs: 0 });
  assert.ok(oracle(wide).moves(wideIds, 'red').includes(fallback.edgeId));
  assert.equal(fallback.winning, false);
  assert.equal(fallback.proven, true);

  const lastBit = makeBoard(Array.from({ length: 31 }, (_, i) => [0, i + 1, i === 30 ? 'blue' : 'red']));
  const topBit = chooseMove(lastBit, lastBit.edges.map(edge => edge.id), 'blue');
  assert.deepEqual(topBit, { edgeId: 'e30', proven: true, winning: false });
});

test('legacy mixed standard openings match exhaustive play for both sides', () => {
  for (const seed of ['GROVE7', 'FORKS', 'TANGLES', 'OWL', 'VALLEY', 'YUKON']) {
    verifyPosition(generateBoard(seed, 'mixed', 'standard', 1));
  }
});

test('legacy standard and large boards have proven choices in every variant', () => {
  for (const size of ['standard', 'large']) {
    for (const variant of ['green', 'redblue', 'mixed']) {
      for (const seed of ['GROVE7', 'FORKS', 'TANGLES', 'OWL']) {
        const board = generateBoard(seed, variant, size, 1);
        const live = board.edges.map(edge => edge.id);
        for (const side of ['blue', 'red']) {
          const move = chooseMove(board, live, side);
          assert.equal(move.proven, true, [seed, size, variant, side].join(' '));
          assert.ok(oracle(board).moves(live, side).includes(move.edgeId));
        }
      }
    }
  }
});

// Find bridges independently by removing each edge and checking its endpoints.
// Contract the other edges with union-find, then evaluate the resulting tree.
function referenceGreenValue(board, live) {
  const active = new Set(live);
  const root = Symbol('ground');
  const ground = new Set(board.nodes.filter(n => n.ground).map(n => n.id));
  const normalize = id => ground.has(id) ? root : id;
  const edges = board.edges.filter(e => active.has(e.id)).map(e => [normalize(e.a), normalize(e.b)]);
  const parent = new Map();
  function find(v) {
    while (parent.has(v)) v = parent.get(v);
    return v;
  }
  const bridges = [];
  const loops = [];
  edges.forEach(([a, b], removed) => {
    const reached = new Set([a]);
    let size;
    do {
      size = reached.size;
      edges.forEach(([u, v], i) => {
        if (i === removed) return;
        if (reached.has(u)) reached.add(v);
        if (reached.has(v)) reached.add(u);
      });
    } while (!reached.has(b) && reached.size !== size);
    if (reached.has(b)) {
      const u = find(a), v = find(b);
      if (u !== v) parent.set(u, v);
      loops.push(a);
    } else bridges.push([a, b]);
  });
  const parity = new Map();
  for (const v of loops) parity.set(find(v), (parity.get(find(v)) ?? 0) ^ 1);
  const collapsed = bridges.map(([a, b]) => [find(a), find(b)]);
  function value(v, from) {
    let nim = parity.get(v) ?? 0;
    for (const [a, b] of collapsed) {
      if (a === v && b !== from) nim ^= value(b, v) + 1;
      if (b === v && a !== from) nim ^= value(a, v) + 1;
    }
    return nim;
  }
  return value(find(root), null);
}

test('Green proves V2 networks and a 70-edge multigraph against independent contraction', () => {
  const boards = ['small', 'standard', 'large'].flatMap(size =>
    ['GROVE7', 'FORKS', 'TANGLES', 'OWL'].map(seed => generateBoard(seed, 'green', size)));
  const wide = Array.from({ length: 53 }, (_, i) => [i, i + 1, 'green']);
  for (let i = 0; i < 17; i++) wide.push([2 * i + 1, 2 * i + 6, 'green']);
  boards.push(makeBoard(wide, [0, 16, 47]));
  for (const board of boards) {
    const live = board.edges.map(e => e.id);
    const win = referenceGreenValue(board, live) !== 0;
    for (const side of ['blue', 'red']) {
      const move = chooseMove(board, live, side, { budgetMs: 0 });
      assert.equal(move.proven, true);
      assert.equal(move.winning, win);
      if (win) assert.equal(referenceGreenValue(board, oracle(board).after(live, move.edgeId)), 0);
    }
  }
});

test('the unique immediate win is found on the last edge of a large colored board', () => {
  for (const side of ['blue', 'red']) {
    const other = side === 'blue' ? 'red' : 'blue';
    const edges = [[0, 'spare', side]];
    for (let i = 1; i <= 45; i++) edges.push([i, i + 1, i % 7 ? other : 'green']);
    edges.push([0, 1, side]);
    const board = makeBoard(edges);
    const live = board.edges.map(e => e.id);
    assert.deepEqual(chooseMove(board, live, side, { budgetMs: 0 }),
      { edgeId: 'e46', proven: true, winning: true });
  }
});

test('large mixed play preserves a separate support against a one-reply loss', () => {
  const edges = [[0, 1, 'blue'], [0, 2, 'red']];
  for (let i = 0; i < 15; i++) edges.push([1, 10 + i, 'red']);
  for (let i = 0; i < 24; i++) edges.push([2, 30 + i, i === 0 ? 'green' : 'blue']);
  const board = makeBoard(edges);
  const live = board.edges.map(e => e.id);
  const move = chooseMove(board, live, 'blue');
  assert.notEqual(move.edgeId, 'e0');
  const referee = oracle(board);
  const next = referee.after(live, move.edgeId);
  for (const reply of referee.moves(next, 'red')) assert.ok(referee.moves(referee.after(next, reply), 'blue').length);
});

test('large red-blue support bundles agree with an independent count-state minimax', () => {
  function wins(counts, player, memo) {
    if (!counts[0] && !counts[1]) return false;
    const key = [player, ...counts].join(',');
    if (memo.has(key)) return memo.get(key);
    const canWin = [player, player + 2].some(group => {
      if (!counts[group]) return false;
      const next = [...counts];
      next[group]--;
      return !wins(next, 1 - player, memo);
    });
    memo.set(key, canWin);
    return canWin;
  }

  for (const counts of [[19, 18, 3, 2], [10, 22, 2, 10], [18, 18, 2, 2]]) {
    const edges = [];
    const groups = [];
    counts.forEach((size, group) => {
      for (let i = 0; i < size; i++) {
        edges.push([group < 2 ? 0 : 1, group < 2 ? 1 : 2, group % 2 ? 'red' : 'blue']);
        groups.push(group);
      }
    });
    const board = makeBoard(edges);
    const live = board.edges.map(e => e.id);
    const memo = new Map();
    for (const player of [0, 1]) {
      const move = chooseMove(board, live, player ? 'red' : 'blue', { budgetMs: 600 });
      assert.equal(move.proven, true);
      assert.equal(move.winning, wins(counts, player, memo));
      if (move.winning) {
        const next = [...counts];
        next[groups[live.indexOf(move.edgeId)]]--;
        assert.equal(wins(next, 1 - player, memo), false);
      }
    }
  }
});

test('connected small V2 colored openings agree with exhaustive play', () => {
  for (const variant of ['redblue', 'mixed']) {
    for (const seed of ['FORKS', '1']) verifyPosition(generateBoard(seed, variant, 'small'));
  }
});

test('timed V2 colored choices are legal and expose complete or explicitly unknown outcomes', () => {
  for (const size of ['standard', 'large']) for (const variant of ['redblue', 'mixed']) {
    for (const seed of ['GROVE7', 'TANGLES']) {
      const board = generateBoard(seed, variant, size);
      assert.ok(board.edges.length >= (size === 'large' ? 36 : 24));
      const live = board.edges.map(e => e.id);
      for (const side of ['blue', 'red']) {
        const start = performance.now();
        const move = chooseMove(board, live, side, { budgetMs: 12 });
        assert.ok(performance.now() - start < 350, 'a bounded search returned promptly');
        assert.ok(oracle(board).moves(live, side).includes(move.edgeId));
        assert.equal(move.proven, typeof move.winning === 'boolean');
        if (!move.proven) assert.equal(move.winning, null);
      }
    }
  }
});
