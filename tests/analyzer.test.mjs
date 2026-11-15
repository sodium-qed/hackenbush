import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition, dyadicChange } from '../dist/js/analysis-values.js';
import { replayPositions } from '../dist/js/analyzer.js';
import { cutEdge, initialEdges, otherSide } from '../dist/js/rules.js';

function makeBoard(connections, roots = [0]) {
  const ids = new Set([...roots, ...connections.flatMap(([a, b]) => [a, b])]);
  return { nodes: [...ids].map(id => ({ id, ground: roots.includes(id) })),
    edges: connections.map(([a, b, color], index) => ({ id: 'e' + index, a, b, color })) };
}

function asNumber(text) {
  const [p, q = 1] = text.split('/').map(Number);
  return p / q;
}

// A small independent game-tree oracle. Enumerate dyadics by birthday (an
// integer starts on its absolute day, a proper dyadic on 1+floor(|x|)+exponent)
// rather than using the production simplicity algorithm or tree formulas.
function oracle(board, green) {
  const memo = new Map();
  const candidates = new Map();
  if (!green) {
    const n = board.edges.length;
    for (let i = -n; i <= n; i++) candidates.set(i, Math.abs(i));
    for (let exponent = 1; exponent <= n; exponent++) {
      const denominator = 2 ** exponent;
      for (let p = 1; p < denominator * n; p += 2) {
        const value = p / denominator;
        const birthday = 1 + Math.floor(value) + exponent;
        if (birthday <= n) {
          candidates.set(value, birthday);
          candidates.set(-value, birthday);
        }
      }
    }
  }
  const byBirthday = [...candidates].sort((a, b) => a[1] - b[1]).map(([value]) => value);
  function value(live) {
    const key = live.join(',');
    if (memo.has(key)) return memo.get(key);
    const options = { blue: [], red: [], green: [] };
    for (const edge of board.edges) {
      if (!live.includes(edge.id)) continue;
      const next = cutEdge(board, live, edge.id, edge.color);
      options[edge.color].push(value(next.live));
    }
    let result;
    if (green) {
      result = 0;
      while (options.green.includes(result)) result++;
    } else {
      result = byBirthday.find(candidate => options.blue.every(x => x < candidate) && options.red.every(x => x > candidate));
      assert.notEqual(result, undefined);
    }
    memo.set(key, result);
    return result;
  }
  return value;
}

test('Green values on cyclic, parallel and multiply grounded positions match explicit mex after every cut', () => {
  const board = makeBoard([[0, 1], [1, 2], [2, 3], [3, 1], [3, 4], [4, 4], [2, 5], [2, 5], [5, 6]]
    .map(pair => [...pair, 'green']), [0, 6]);
  const reference = oracle(board, true);
  const opening = initialEdges(board);
  const positions = [opening, ...opening.map(id => cutEdge(board, opening, id, 'green').live), []];
  for (const live of positions) {
    const nimber = reference(live);
    for (const side of ['blue', 'red']) {
      assert.deepEqual(analyzePosition(board, live, side, 'green', { budgetMs: 0 }),
        { kind: 'green', exact: true, nimber, winner: nimber ? side : otherSide(side) });
    }
  }
});

test('all colorings of a small cyclic Red–Blue graph have the independently enumerated number', () => {
  const topology = [[0, 1], [1, 2], [2, 3], [3, 1], [2, 2], [3, 4]];
  for (let pattern = 0; pattern < 2 ** topology.length; pattern++) {
    const board = makeBoard(topology.map((pair, i) => [...pair, pattern & 2 ** i ? 'red' : 'blue']));
    const live = initialEdges(board);
    const value = oracle(board, false)(live);
    const result = analyzePosition(board, live, 'red', 'redblue', { budgetMs: 500 });
    assert.equal(result.exact, true);
    assert.equal(asNumber(result.number), value || 0);
    assert.equal(result.winner, value < 0 ? 'red' : 'blue');

    const limited = analyzePosition(board, live, 'blue', 'redblue', { budgetMs: 0 });
    if (!limited.exact) {
      assert.ok(limited.lowerOpen ? asNumber(limited.lower) < value : asNumber(limited.lower) <= value);
      assert.ok(limited.upperOpen ? asNumber(limited.upper) > value : asNumber(limited.upper) >= value);
      if (limited.winner) assert.equal(limited.winner, value > 0 ? 'blue' : 'red');
    }
  }
});

test('an 82-edge forest keeps every bit of a small dyadic added to a whole number', () => {
  const denominator = 2n ** 80n;
  for (const side of ['blue', 'red']) {
    const edges = [[0, 1, side], [0, 2, side], ...Array.from({ length: 80 }, (_, i) =>
      [2, i + 3, otherSide(side)])];
    const board = makeBoard(edges);
    const value = analyzePosition(board, initialEdges(board), otherSide(side), 'redblue', { budgetMs: 0 });
    assert.equal(value.exact, true);
    assert.equal(value.winner, side);
    assert.equal(value.number, (side === 'red' ? '-' : '') + (denominator + 1n) + '/' + denominator);
    assert.equal(dyadicChange(side === 'red' ? '-1' : '1', value.number),
      (side === 'red' ? '-' : '+') + '1/' + denominator);
  }
});

test('a large simple colored cycle can be priced exactly and a bound alone can certify the winner', () => {
  const ring = Array.from({ length: 24 }, (_, i) => [i, (i + 1) % 24, i % 2 ? 'red' : 'blue']);
  const cycle = makeBoard(ring);
  // Swapping colors and reflecting the cycle at its grounded vertex fixes the board.
  assert.equal(analyzePosition(cycle, initialEdges(cycle), 'blue', 'redblue', { budgetMs: 1500 }).number, '0');
  const supported = makeBoard([[0, 1, 'blue'], ...ring.map(([a, b, color]) => [a + 1, b + 1, color])]);
  const limited = analyzePosition(supported, initialEdges(supported), 'red', 'redblue', { budgetMs: 0 });
  assert.equal(limited.exact, false);
  assert.ok(asNumber(limited.lower) > 0);
  assert.equal(limited.winner, 'blue');
});

test('archived mixed games separate solvable summands and preserve uncertainty for interwoven colors', () => {
  const independent = makeBoard([[0, 1, 'green'], [0, 2, 'blue'], [2, 3, 'red'], [0, 4, 'red']]);
  assert.deepEqual(analyzePosition(independent, initialEdges(independent), 'blue', 'mixed'),
    { kind: 'mixed', exact: true, number: '-1/2', nimber: 1, winner: 'red' });
  const interwoven = makeBoard([[0, 1, 'blue'], [1, 2, 'green']]);
  for (const side of ['red', 'blue']) {
    assert.deepEqual(analyzePosition(interwoven, initialEdges(interwoven), side, 'mixed'),
      { kind: 'mixed', exact: false, winner: 'blue' });
  }
});

test('post-game replay keeps cascades, unfinished wood, zero-cut timeouts and the untimed result', () => {
  const board = makeBoard([[0, 1, 'blue'], [1, 2, 'red'], [0, 3, 'blue']]);
  const game = { variant: 'redblue', board, firstSide: 'blue', side: 'red', victor: 'blue',
    rows: [{ edgeId: 'e0' }], moves: ['e0'], live: ['e2'] };
  assert.deepEqual(replayPositions({ ...game, victor: null }), []);
  const frames = replayPositions(game);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], { side: 'blue', live: ['e0', 'e1', 'e2'], move: null });
  assert.deepEqual(frames[1].live, game.live);
  assert.deepEqual(frames[1].move.fallen, ['e1']);
  assert.equal(frames[1].side, 'red');
  assert.equal(analyzePosition(board, frames[1].live, frames[1].side).number, '1');
  assert.deepEqual(replayPositions({ ...game, moves: undefined }), frames);

  const timed = { ...game, victor: 'red', side: 'blue', timedOut: 'blue', moves: [], rows: [] };
  const [only, ...rest] = replayPositions(timed);
  assert.deepEqual(rest, []);
  assert.deepEqual(only.live, initialEdges(board));
  assert.equal(analyzePosition(board, only.live, only.side).winner, 'blue');
  assert.equal(timed.victor, 'red');
});
