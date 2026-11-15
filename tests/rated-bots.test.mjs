import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard } from '../dist/js/generator.js';
import { DEFAULT_RATED_BOT, RATED_BOTS, RATED_BOT_BY_ID, chooseRatedBotMove } from '../dist/js/rated-bots.js';
import { cutEdge, initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';
import { createOracle, makeBoard } from './helpers/hackenbush-oracle.mjs';

test('the rated catalog carries one sourced Chess.com reference per Hackenbush policy', () => {
  assert.deepEqual(RATED_BOTS.map(bot => [bot.name, bot.elo]), [
    ['Martin', 250], ['Aron', 700], ['Emir', 1000], ['Nelson', 1300],
    ['Isabel', 1600], ['Wally', 1800], ['Li', 2000], ['Noam', 2200],
  ]);
  assert.equal(DEFAULT_RATED_BOT, 'nelson');
  for (const bot of RATED_BOTS) {
    assert.equal(RATED_BOT_BY_ID[bot.id], bot);
    assert.equal(new URL(bot.source).hostname, 'www.chess.com');
    assert.ok(Object.isFrozen(bot));
  }
});

test('every named policy reproduces legal, distinct choices on fresh full garden objects', () => {
  for (const variant of ['green', 'redblue']) {
    const signatures = new Map(RATED_BOTS.map(bot => [bot.id, []]));
    for (const seed of ['A35D7E', '89ABCD', '123456', 'A1B2C3']) {
      const board = generateBoard(seed, variant, 'standard', 5);
      const fresh = structuredClone(board);
      let live = initialEdges(board);
      assert.ok(live.length > 64);
      for (let ply = 0; ply < 6; ply++) {
        const side = ply % 2 ? 'red' : 'blue';
        const legal = legalMoves(board, live, side);
        if (!legal.length) break;
        for (const { id } of RATED_BOTS) {
          const move = chooseRatedBotMove(board, live, side, id, seed, ply);
          const restored = chooseRatedBotMove(fresh, [...live].reverse(), side, id, seed.toLowerCase(), ply);
          assert.deepEqual(restored, move, variant + ' ' + id);
          assert.ok(legal.includes(move.edgeId), id);
          signatures.get(id).push(move.edgeId);
        }
        live = cutEdge(board, live, signatures.get('nelson').at(-1), side).live;
      }
    }
    assert.equal(new Set([...signatures.values()].map(ids => ids.join(','))).size, RATED_BOTS.length, variant);
  }
});

test('Noam leaves zero in every winning Green follower of a multi-root cyclic graph', () => {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 1], [2, 2], [2, 4], [2, 4], [4, 5], [5, 6]];
  const board = makeBoard(edges.map(pair => [...pair, 'green']), [0, 6]);
  const oracle = createOracle(board);
  for (const live of oracle.positions()) {
    const value = oracle.nimber(live);
    for (const side of ['blue', 'red']) {
      const move = chooseRatedBotMove(board, live, side, 'noam', 'BADDED', board.edges.length - live.length);
      assert.equal(move.proven, true);
      assert.equal(move.winning, value !== 0);
      if (value) assert.equal(oracle.nimber(cutEdge(board, live, move.edgeId, side).live), 0);
    }
  }
});

test('upper moves can find the unique winning edge above bit 63 in both variants', () => {
  const green = makeBoard([
    ...Array.from({ length: 64 }, (_, i) => [0, i + 1, 'green']),
    [0, 65, 'green'], [65, 66, 'green'], [66, 67, 'green'],
  ]);
  const redBlue = makeBoard([
    ...Array.from({ length: 50 }, (_, i) => [0, 'red-' + i, 'red']),
    ...Array.from({ length: 51 }, (_, i) => [i, i + 1, 'blue']),
  ]);
  assert.deepEqual(chooseRatedBotMove(green, initialEdges(green), 'red', 'noam', '102ACE', 0),
    { edgeId: 'e64', proven: true, winning: true });
  assert.deepEqual(chooseRatedBotMove(redBlue, initialEdges(redBlue), 'blue', 'noam', '102ACE', 0),
    { edgeId: 'e100', proven: true, winning: true });
});

test('small Red–Blue certificates and Noam’s exact endgame choices agree with independent game trees', () => {
  const slots = [[0, 1], [1, 2], [2, 0], [1, 3], [3, 2], [2, 2], [1, 3]];
  for (let coloring = 0; coloring < 2 ** slots.length; coloring++) {
    const board = makeBoard(slots.map((pair, i) => [...pair, (coloring >> i) & 1 ? 'blue' : 'red']));
    const oracle = createOracle(board);
    for (const side of ['blue', 'red']) {
      const winner = oracle.winner(oracle.opening, side);
      for (const bot of RATED_BOTS) {
        const move = chooseRatedBotMove(board, oracle.opening, side, bot.id, 'FEE123', 0);
        if (bot.id === 'noam') assert.ok(move.proven);
        if (move.winning === true) {
          assert.equal(winner, side, bot.id);
          const next = oracle.options(oracle.opening).find(option => option.id === move.edgeId);
          assert.equal(oracle.winner(next.live, otherSide(side)), side, bot.id);
        }
        if (move.winning === false) assert.equal(winner, otherSide(side), bot.id);
        if (move.edgeId === null) assert.equal(legalMoves(board, oracle.opening, side).length, 0);
      }
    }
  }
});
