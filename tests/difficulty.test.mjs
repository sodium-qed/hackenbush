import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDifficulty } from '../dist/js/difficulty.js';
import { createOracle, formatRational, makeBoard } from './helpers/hackenbush-oracle.mjs';

const full = { budgetMs: Infinity, nodeLimit: 16384, maxMoves: 256 };
const staticOnly = { budgetMs: 0, nodeLimit: 0, maxMoves: 0 };
const opposite = side => side === 'blue' ? 'red' : 'blue';
const legal = (move, side) => move.color === side || move.color === 'green';

function stalks(lengths) {
  const wood = [];
  let vertex = 0;
  for (const length of lengths) {
    let a = 0;
    for (let i = 0; i < length; i++) {
      wood.push([a, ++vertex, 'green']);
      a = vertex;
    }
  }
  return makeBoard(wood);
}

function measure(board, side = 'blue', variant = 'green', options = full) {
  return estimateDifficulty(board, board.edges.map(edge => edge.id), side, variant, options);
}

function reference(oracle, live, side) {
  const other = opposite(side);
  const plays = oracle.options(live).filter(move => legal(move, side));
  let wins = 0, instant = 0, refuted = 0;
  for (const move of plays) {
    if (oracle.winner(move.live, other) === side) wins++;
    const replies = oracle.options(move.live).filter(reply => legal(reply, other));
    if (!replies.length) instant++;
    if (replies.some(reply => !oracle.options(reply.live).some(next => legal(next, side)))) refuted++;
  }
  return { plays, wins, instant, refuted };
}

test('one winning cut among four can be exposed or concealed; smaller can score higher', () => {
  const exposed = measure(stalks([4]));
  const concealed = measure(stalks([1, 1, 2]));
  for (const profile of [exposed, concealed]) {
    assert.equal(profile.winningMoves, 1);
    assert.equal(profile.losingMoves, 3);
    assert.equal(profile.unknownMoves, 0);
    assert.deepEqual(profile.tactics.uniformRisk, [.75, .75]);
  }
  assert.equal(exposed.tactics.instantWins, 1);
  assert.equal(exposed.tactics.immediateRefutations, 3);
  assert.deepEqual(exposed.tactics.screenedRisk, [0, 0]);
  assert.deepEqual(concealed.tactics.screenedRisk, [.75, .75]);
  assert.equal(concealed.tactics.concealedLosses, 3);
  assert.equal(exposed.score, 34);
  assert.equal(concealed.score, 76);
  assert.ok(measure(stalks([40])).score < concealed.score);
  const equivalent = measure(stalks([1, 1, 1, 1, 1]));
  assert.equal(equivalent.winningMoves, 5);
  assert.equal(equivalent.score, 0);
});

test('ground contraction counts loops, parallel pairs, cycle hinges and a leaf bridge', () => {
  const pairs = [[0, 1], [1, 2], [2, 4], [1, 3], [3, 5], [5, 1], [1, 1], [0, 6], [4, 6], [5, 7], [0, 4]];
  const board = makeBoard(pairs.map(pair => [...pair, 'green']), [0, 4, 99]);
  const t = measure(board).topology;
  assert.equal(t.groundContacts, 2);
  assert.equal(t.nonGroundVertices, 6);
  assert.equal(t.edges, 11);
  assert.equal(t.cycleRank, 5);
  assert.equal(t.cycleEdges, 10);
  assert.equal(t.components, 3);
  assert.equal(t.largestComponent, 8);
  assert.equal(t.articulations, 2);
  assert.equal(t.bridges, 1);
  assert.equal(t.maxDrop, 1);
  assert.equal(t.meanDrop, 1);
  assert.equal(t.coupling, (8 * 7 + 2) / (11 * 10));
});

test('every coloring of a cyclic Red–Blue field matches independent winning cuts, tactical screens and exact sensitivity', () => {
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 1], [3, 4]];
  for (let pattern = 0; pattern < 2 ** pairs.length; pattern++) {
    const board = makeBoard(pairs.map((pair, i) => [...pair, pattern & 2 ** i ? 'red' : 'blue']));
    const oracle = createOracle(board);
    for (const side of ['blue', 'red']) {
      const profile = measure(board, side, 'redblue');
      const expected = reference(oracle, oracle.opening, side);
      assert.equal(profile.winner, oracle.winner(oracle.opening, side));
      assert.equal(profile.legalMoves, expected.plays.length);
      assert.equal(profile.winningMoves, expected.wins);
      assert.equal(profile.losingMoves, expected.plays.length - expected.wins);
      assert.equal(profile.tactics.instantWins, expected.instant);
      assert.equal(profile.tactics.immediateRefutations, expected.refuted);
      assert.equal(profile.tactics.concealedLosses, profile.losingMoves - expected.refuted);
      assert.equal(profile.coverage, 1);
      assert.equal(profile.lower, profile.upper);
      const numbers = expected.plays.map(move => oracle.number(move.live))
        .sort((left, right) => Number(left.p * right.q - right.p * left.q));
      assert.equal(profile.sensitivity.complete, true);
      assert.equal(profile.sensitivity.observedMinimum, numbers.length ? formatRational(numbers[0]) : null);
      assert.equal(profile.sensitivity.observedMaximum, numbers.length ? formatRational(numbers.at(-1)) : null);
      assert.ok(profile.effort.nodes <= full.nodeLimit);
    }
  }
});

test('under a move or proof limit the completed score and both exact cut counts remain inside their intervals', () => {
  const pairs = [[0, 1], [1, 2], [2, 0], [1, 3], [3, 2], [2, 4]];
  for (const colors of ['GGBRBG', 'RBRBRB', 'BGBRGR', 'RRGGGB', 'GGGGGG', 'BBBRBB']) {
    const color = { G: 'green', B: 'blue', R: 'red' };
    const board = makeBoard(pairs.map((pair, i) => [...pair, color[colors[i]]]));
    const oracle = createOracle(board);
    for (const side of ['blue', 'red']) {
      const target = measure(board, side, 'mixed');
      assert.equal(target.unknownMoves, 0);
      assert.equal(target.tactics.uncheckedReplies, 0);
      for (const maxMoves of [0, 1, 3, 6]) {
        for (const rootProof of [null, oracle.winner(oracle.opening, side)]) {
          const partial = measure(board, side, 'mixed', { analysis: { winner: rootProof },
            budgetMs: Infinity, nodeLimit: 5, maxMoves });
          assert.ok(partial.lower <= target.score && target.score <= partial.upper);
          assert.ok(partial.winningMoves <= target.winningMoves);
          assert.ok(partial.losingMoves <= target.losingMoves);
          assert.ok(partial.winningMoves + partial.unknownMoves >= target.winningMoves);
          if (partial.winner) assert.equal(partial.winner, target.winner);
          assert.ok(partial.effort.nodes <= 5);
          assert.ok(partial.effort.childScans <= maxMoves);
        }
      }
    }
  }
});

test('a proved loss makes all choices losing; a forced move can have a resolved score and an unknown winner', () => {
  const loss = measure(stalks([1, 2, 3]), 'red', 'green', staticOnly);
  assert.equal(loss.winner, 'blue');
  assert.equal(loss.losingMoves, 6);
  assert.equal(loss.effort.nodes, 0);
  assert.equal(loss.coverage, 1);
  assert.deepEqual(loss.tactics.uniformRisk, [0, 0]);
  assert.deepEqual(loss.tactics.screenedRisk, [0, 0]);
  assert.equal(loss.tactics.uncheckedReplies, 6);
  const single = makeBoard([[0, 1, 'red'], [1, 2, 'blue']]);
  const uncertain = measure(single, 'blue', 'redblue', staticOnly);
  assert.equal(uncertain.legalMoves, 1);
  assert.equal(uncertain.complete, true);
  assert.equal(uncertain.coverage, 0);
  assert.equal(uncertain.winner, null);
  assert.equal(uncertain.score, Math.round(20 * uncertain.topology.index));
  const known = measure(single, 'blue', 'redblue', { ...staticOnly, analysis: { winner: 'red' } });
  assert.equal(known.losingMoves, 1);
  const terminal = estimateDifficulty(single, [], 'red', 'redblue', full);
  assert.equal(terminal.score, 0);
  assert.equal(terminal.legalMoves, 0);
  assert.equal(terminal.winner, 'blue');
});

test('a known winning parent and one remaining candidate can certify the last cut without another search', () => {
  const one = makeBoard([[0, 1, 'red'], [0, 2, 'blue'], [2, 3, 'red']]);
  const known = measure(one, 'red', 'redblue', { ...full, analysis: { winner: 'red' }, maxMoves: 1 });
  // Cutting the isolated red branch loses. The only remaining red cut preserves the win.
  assert.equal(known.winningMoves, 1);
  assert.equal(known.losingMoves, 1);
  assert.equal(known.effort.childScans, 1);
});

test('directly grounded physical cuts have exact colored, green or mixed outcomes even with no child budget', () => {
  const colors = { B: 'blue', R: 'red', G: 'green' };
  const pairs = [[0, 1], [0, 1], [0, 2], [0, 3], [0, 0]];
  for (const pattern of ['BBBBB', 'BRRBB', 'RRRRR', 'GGGGG', 'RBGGG', 'BRGGG', 'GRRRG']) {
    const board = makeBoard(pairs.map((pair, i) => [...pair, colors[pattern[i]]]));
    const oracle = createOracle(board);
    for (const side of ['blue', 'red']) {
      const result = measure(board, side, 'mixed', staticOnly);
      const known = reference(oracle, oracle.opening, side);
      assert.equal(result.winningMoves, known.wins);
      assert.equal(result.losingMoves, known.plays.length - known.wins);
      assert.equal(result.tactics.immediateRefutations, known.refuted);
      assert.equal(result.tactics.uncheckedReplies, 0);
      assert.equal(result.coverage, 1);
      assert.equal(result.effort.nodes, 0);
      assert.equal(result.effort.status, 'survey complete');
    }
  }
});

test('oversized mixed networks disclose unmeasured structure and avoid graph proof allocation', () => {
  const board = makeBoard(Array.from({ length: 280 }, (_, i) => [0, i + 1, i % 2 ? 'blue' : 'red']));
  const profile = measure(board, 'red', 'redblue', full);
  assert.equal(profile.topology.measured, false);
  assert.equal(profile.unknownMoves, 140);
  assert.equal(profile.winner, null);
  assert.equal(profile.effort.rootScans, 0);
  assert.equal(profile.effort.nodes, 0);
  assert.ok(profile.lower < profile.upper);
  const provedLoss = measure(board, 'red', 'redblue', { ...full, analysis: { winner: 'blue' } });
  assert.equal(provedLoss.losingMoves, 140);
  assert.deepEqual([provedLoss.lower, provedLoss.upper], [0, 20]);
});
