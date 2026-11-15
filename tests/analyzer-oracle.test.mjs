import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition, createAnalysisSession } from '../dist/js/analysis-values.js';
import { compare, createOracle, formatRational, makeBoard, parseRational } from './helpers/hackenbush-oracle.mjs';
import { mirroredKnot, parallelKnot, smallKnot } from './helpers/analyzer-positions.mjs';

const blue = 'blue';
const red = 'red';
const sides = [blue, red];
const ample = { budgetMs: Infinity, nodeLimit: 100_000 };

function interval(result) {
  if (result.exact) {
    const value = parseRational(result.number);
    return { lo: value, hi: value, loOpen: false, hiOpen: false };
  }
  assert.equal(typeof result.lowerOpen, 'boolean');
  assert.equal(typeof result.upperOpen, 'boolean');
  return { lo: parseRational(result.lower), hi: parseRational(result.upper),
    loOpen: result.lowerOpen, hiOpen: result.upperOpen };
}

function checkNumber(result, expected, winner, label = '') {
  assert.equal(result.kind, 'redblue', label);
  const { lo, hi, loOpen, hiOpen } = interval(result);
  assert.ok(loOpen ? compare(lo, expected) < 0 : compare(lo, expected) <= 0, 'lower bound ' + label);
  assert.ok(hiOpen ? compare(expected, hi) < 0 : compare(expected, hi) <= 0, 'upper bound ' + label);
  if (result.exact) {
    assert.equal(result.number, formatRational(expected), label);
    assert.equal(result.winner, winner, label);
  } else if (result.winner !== null) {
    assert.equal(result.winner, winner, label);
  }
}

function checkRefinement(oldResult, newResult) {
  const previous = interval(oldResult);
  const current = interval(newResult);
  const lowerChange = compare(current.lo, previous.lo);
  const upperChange = compare(current.hi, previous.hi);
  assert.ok(lowerChange >= 0 && upperChange <= 0, 'certified interval expanded');
  if (!lowerChange && previous.loOpen) assert.ok(current.loOpen, 'lost strict lower bound');
  if (!upperChange && previous.hiOpen) assert.ok(current.hiOpen, 'lost strict upper bound');
  if (oldResult.winner) assert.equal(newResult.winner, oldResult.winner, 'lost winning certificate');
  assert.ok(newResult.nodes >= oldResult.nodes);
  assert.ok(newResult.durationMs >= oldResult.durationMs);
  assert.ok(newResult.cacheHits >= oldResult.cacheHits);
  return lowerChange > 0 || upperChange < 0 || previous.loOpen !== current.loOpen || previous.hiOpen !== current.hiOpen;
}

test('independent rational and move-tree answers agree with hand-computable normal-play examples', () => {
  const fixtures = [
    ['empty', [], [0], '0'],
    ['alternating stalk', [[0, 1, blue], [1, 2, red], [2, 3, blue]], [0], '3/4'],
    ['red below two blue leaves', [[0, 1, red], [1, 2, blue], [1, 3, blue]], [0], '-1/4'],
    ['independent negative twig and blue shrub', [[0, 1, blue], [1, 2, red], [1, 3, red], [0, 4, red]], [0], '-3/4'],
    ['blue-supported red loop', [[0, 1, blue], [1, 1, red]], [0], '1/2'],
    ['one triangle', [[0, 1, blue], [1, 2, red], [2, 0, blue]], [0], '1'],
    ['two ground vertices', [[0, 1, blue], [1, 2, red]], [0, 2], '0'],
    ['parallel edges, a loop and a leaf', [[0, 1, blue], [0, 1, red], [1, 1, blue], [1, 2, red]], [0], '0'],
    ['ungrounded wood falls', [[0, 1, blue], [9, 8, red], [8, 8, red]], [0], '1']
  ];
  for (const [label, edges, grounds, expected] of fixtures) {
    const board = makeBoard(edges, grounds);
    const oracle = createOracle(board);
    assert.equal(formatRational(oracle.number()), expected, label);
    for (const side of sides) {
      const result = createAnalysisSession(board, oracle.opening, side).refine(ample);
      assert.ok(result.exact, label);
      checkNumber(result, oracle.number(), oracle.winner(oracle.opening, side), label);
    }
  }
});

test('all ternary assignments on six edge slots match exact number and independent minimax for both starters', () => {
  // Each slot is absent, red or blue. Repeated endpoint pairs remain distinct.
  const slots = [[0, 1], [1, 2], [2, 0], [0, 1], [1, 1], [2, 2]];
  for (let word = 0; word < 3 ** slots.length; word++) {
    const edges = [];
    let digits = word;
    for (const [a, b] of slots) {
      const digit = digits % 3;
      if (digit) edges.push([a, b, digit === 1 ? blue : red]);
      digits = Math.floor(digits / 3);
    }
    for (const grounds of [[0], [0, 2]]) {
      const board = makeBoard(edges, grounds);
      const oracle = createOracle(board);
      const expected = oracle.number();
      for (const side of sides) {
        const label = 'word ' + word + ' grounds ' + grounds + ' ' + side;
        const result = createAnalysisSession(board, oracle.opening, side).refine(ample);
        assert.ok(result.exact, label);
        checkNumber(result, expected, oracle.winner(oracle.opening, side), label);
      }
    }
  }
});

test('Green fusion and parallel-edge ground handling agree with mex on every reachable edge set', () => {
  const shape = [[0, 1], [1, 2], [2, 3], [3, 1], [2, 2], [2, 4], [2, 4], [4, 5], [5, 6], [6, 6]];
  for (const grounds of [[0], [0, 6]]) {
    const board = makeBoard(shape.map(pair => [...pair, 'green']), grounds);
    const oracle = createOracle(board);
    for (const live of oracle.positions()) {
      const nimber = oracle.nimber(live);
      for (const side of sides) {
        const result = analyzePosition(board, live, side, 'green', { budgetMs: 0 });
        assert.ok(result.exact);
        assert.equal(result.nimber, nimber);
        assert.equal(result.winner, oracle.winner(live, side));
      }
    }
  }
});

test('short bounded proof slices contain the independent exact value across every coloring of a double cycle', () => {
  const shape = [[0, 1], [0, 2], [1, 2], [2, 3], [3, 1], [3, 3], [3, 4]];
  for (let pattern = 0; pattern < 2 ** shape.length; pattern++) {
    const board = makeBoard(shape.map(([a, b], i) => [a, b, pattern & 2 ** i ? red : blue]));
    const oracle = createOracle(board);
    for (const side of sides) {
      const proof = createAnalysisSession(board, oracle.opening, side);
      const expected = oracle.number();
      const winner = oracle.winner(oracle.opening, side);
      let previous;
      for (const nodeLimit of [0, 1, 7, 31, 4096]) {
        const next = proof.refine({ budgetMs: Infinity, nodeLimit });
        checkNumber(next, expected, winner, 'coloring ' + pattern);
        if (previous) checkRefinement(previous, next);
        previous = next;
        if (next.exact) break;
      }
      assert.ok(previous.exact, 'seven-edge coloring ' + pattern);
    }
  }
});

test('seeded multigraph openings and their followers agree with independent search under successive cutoffs', () => {
  let state = 0x7a11cafe;
  function draw(bound) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * bound);
  }
  for (let sample = 0; sample < 96; sample++) {
    const vertices = 2 + draw(5);
    const count = vertices - 1 + draw(11 - vertices + 1);
    const edges = [];
    for (let v = 1; v < vertices; v++) edges.push([draw(v), v, sides[draw(2)]]);
    while (edges.length < count) edges.push([draw(vertices), draw(vertices), sides[draw(2)]]);
    const board = makeBoard(edges, sample % 3 === 0 ? [0, vertices - 1] : [0]);
    const oracle = createOracle(board);
    const followers = oracle.options(oracle.opening);
    const positions = [oracle.opening, followers[draw(followers.length)].live];
    for (const live of positions) {
      const expected = oracle.number(live);
      for (const side of sides) {
        const proof = createAnalysisSession(board, live, side);
        let previous;
        for (const nodeLimit of [0, 3, 29, 343, 100000]) {
          const next = proof.refine({ budgetMs: Infinity, nodeLimit });
          checkNumber(next, expected, oracle.winner(live, side), 'random case ' + sample);
          if (previous) checkRefinement(previous, next);
          previous = next;
          if (next.exact) break;
        }
        assert.ok(previous.exact, 'random case ' + sample + ' left unresolved');
      }
    }
  }
});

test('every partial proof on a cyclic knot contains its independent value and remembers progress', () => {
  const board = smallKnot();
  const oracle = createOracle(board);
  for (const side of sides) {
    const proof = createAnalysisSession(board, oracle.opening, side);
    const expected = oracle.number();
    const winner = oracle.winner(oracle.opening, side);
    let previous = proof.refine({ budgetMs: 0, nodeLimit: 0 });
    checkNumber(previous, expected, winner);
    assert.equal(previous.exact, false, 'structural pass should leave the asymmetric knot open');
    let narrowedBeforeExact = false;
    let earlyWinner = false;
    for (const nodes of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 8192, 65536]) {
      const next = proof.refine({ budgetMs: Infinity, nodeLimit: nodes });
      checkNumber(next, expected, winner);
      assert.ok(next.nodes - previous.nodes <= nodes, 'slice exceeded its node cap');
      const narrowed = checkRefinement(previous, next);
      narrowedBeforeExact ||= !next.exact && narrowed;
      earlyWinner ||= !next.exact && !!next.winner;
      previous = next;
      if (next.exact) break;
    }
    assert.ok(previous.exact, 'ample total work should finish a small knot');
    assert.ok(narrowedBeforeExact, 'expected strict improvement before the exact report');
    assert.ok(earlyWinner, 'expected an independent winner certificate before exact value');
    assert.equal(previous.status, 'exact');
  }
});

test('a 22-edge color-reversing graph and its perturbed versions do not share certificates', () => {
  const symmetric = mirroredKnot();
  const all = symmetric.edges.map(edge => edge.id);
  for (const side of sides) {
    const result = createAnalysisSession(symmetric, all, side).refine(ample);
    assert.equal(result.number, '0');
    assert.equal(result.winner, side === blue ? red : blue);
  }
  // This independent positive twig breaks cancellation. Reuse IDs, then
  // shuffle the old edge order to test that cache keys remain position-aware.
  const twig = { id: 'twig', a: 0, b: 'twig-tip', color: blue };
  const positive = { nodes: [...symmetric.nodes, { id: 'twig-tip', ground: false }],
    edges: [twig, ...symmetric.edges.toReversed()] };
  const result = createAnalysisSession(positive, [twig.id, ...all], red).refine(ample);
  assert.equal(result.number, '1');
  assert.equal(result.winner, blue);
});

test('monochromatic ground paths give strict zero endpoints and can certify an exact number before search', () => {
  for (const color of sides) {
    const other = color === blue ? red : blue;
    // Only this color touches ground; two separate supports feed the cycles.
    const board = makeBoard([[0, 1, color], [0, 2, color], [1, 2, other], [1, 3, other],
      [2, 3, other], [1, 2, color]]);
    const oracle = createOracle(board);
    const expected = oracle.number();
    for (const side of sides) {
      const result = createAnalysisSession(board, oracle.opening, side).refine({ budgetMs: 0, nodeLimit: 0 });
      checkNumber(result, expected, oracle.winner(oracle.opening, side));
      assert.equal(result.exact, false);
      assert.equal(result.winner, color);
      assert.equal(color === blue ? result.lower : result.upper, '0');
      assert.equal(color === blue ? result.lowerOpen : result.upperOpen, true);
      assert.equal(result.nodes, 0);
    }
  }
  // All 11 Blue and 11 Red edges have their own monochromatic ground paths.
  const balanced = parallelKnot();
  const oracle = createOracle(balanced, { interchangeableParallels: true });
  assert.equal(formatRational(oracle.number()), '0');
  for (const side of sides) {
    const result = createAnalysisSession(balanced, oracle.opening, side).refine({ budgetMs: 0, nodeLimit: 0 });
    assert.equal(result.number, '0');
    assert.equal(result.winner, side === blue ? red : blue);
    assert.equal(result.nodes, 0);
  }
});

test('eviction from a sixteen-entry value cache cannot weaken a published interval or winner', () => {
  const board = smallKnot();
  const oracle = createOracle(board);
  const session = createAnalysisSession(board, oracle.opening, red, 'redblue', { maxEntries: 16 });
  let previous = session.refine({ budgetMs: Infinity, nodeLimit: 0 });
  for (const nodeLimit of [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240]) {
    const next = session.refine({ budgetMs: Infinity, nodeLimit });
    checkNumber(next, oracle.number(), oracle.winner(oracle.opening, red));
    checkRefinement(previous, next);
    previous = next;
    if (previous.exact) break;
  }
  assert.ok(previous.cacheHits > 0);
});

test('equal-valued pendant forests substitute at an above-ground attachment on two intersecting cycles', () => {
  const core = [[0, 1, blue], [0, 2, red], [1, 2, red], [2, 3, blue], [1, 3, red]];
  const half = [[1, 4, blue], [4, 5, red]];
  const negativeHalf = [[1, 6, red], [6, 7, blue]];
  const otherHalf = [[1, 6, blue], [6, 7, red]];
  const cases = [
    [[...half, ...negativeHalf], []],
    [[...half, ...otherHalf], [[1, 8, blue]]],
    [[...negativeHalf, [1, 4, red], [4, 5, blue]], [[1, 8, red]]]
  ];
  for (const [forest, stalk] of cases) {
    const original = makeBoard([...core, ...forest]);
    const substitute = makeBoard([...core, ...stalk]);
    const expected = createOracle(substitute).number();
    const oracle = createOracle(original);
    assert.equal(formatRational(oracle.number()), formatRational(expected));
    for (const side of sides) {
      const proof = createAnalysisSession(original, oracle.opening, side);
      const result = proof.refine(ample);
      assert.ok(result.exact);
      checkNumber(result, expected, oracle.winner(oracle.opening, side));
    }
  }
});

test('archived three-color games preserve minimax outcomes without assuming interwoven parts are numbers', () => {
  const shape = [[0, 1], [1, 2], [2, 0], [2, 2], [2, 3]];
  const colors = [blue, red, 'green'];
  for (let word = 0; word < 3 ** shape.length; word++) {
    const board = makeBoard(shape.map(([a, b], i) => [a, b, colors[Math.floor(word / 3 ** i) % 3]]));
    const present = new Set(board.edges.map(edge => edge.color));
    if (present.size < 2 || !present.has('green')) continue;
    const oracle = createOracle(board);
    for (const side of sides) {
      const session = createAnalysisSession(board, oracle.opening, side, 'mixed');
      const early = session.refine({ budgetMs: Infinity, nodeLimit: 1 });
      const winner = oracle.winner(oracle.opening, side);
      if (early.winner) assert.equal(early.winner, winner);
      const result = session.refine(ample);
      assert.equal(result.winner, winner, 'coloring ' + word + ' ' + side);
      assert.equal(result.kind, 'mixed');
      if (!result.exact) assert.equal(result.number, undefined);
    }
  }
});

test('budget-zero analysis of an asymmetric large cyclic core preserves an unknown value', () => {
  const board = mirroredKnot();
  const edited = { ...board, edges: board.edges.map((edge, i) => i === 0 ? { ...edge, color: blue } : edge) };
  const live = edited.edges.map(edge => edge.id);
  const report = createAnalysisSession(edited, live, blue).refine({ budgetMs: 0, nodeLimit: 0 });
  assert.equal(report.exact, false);
  assert.equal(report.number, undefined);
  assert.ok(compare(interval(report).lo, interval(report).hi) < 0);
  assert.ok(report.status === 'time-limit' || report.status === 'node-limit');
});

test('forty-two live edges can certify the winner before their exact number is known', () => {
  const core = smallKnot();
  const reference = createOracle(core).number();
  // Add 31 independent blue ground twigs. Each contributes exactly +1.
  const edges = core.edges.map(({ a, b, color }) => [a, b, color]);
  for (let i = 0; i < 31; i++) edges.push([0, 'independent-' + i, blue]);
  const board = makeBoard(edges);
  const expected = { p: reference.p + 31n * reference.q, q: reference.q };
  const live = board.edges.map(edge => edge.id);
  const report = createAnalysisSession(board, live, red).refine({ budgetMs: 0, nodeLimit: 0 });
  assert.equal(report.exact, false);
  checkNumber(report, expected, blue);
  assert.equal(report.winner, blue);
});
