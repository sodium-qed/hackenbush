import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_CALIBRATION, CALIBRATION_VERSION } from '../dist/js/bot-calibration.js';
import { generateBoard } from '../dist/js/generator.js';
import { legacyRatedDeal as ratedDeal, ratedBotMove, ratedOpeningWinner } from '../dist/js/rated-deal.js';
import { initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';
import { calibrationSeed, generateCorpus, playCalibrationGame } from '../scripts/calibration.mjs';
import { features, fitVariant, predict } from '../scripts/calibration-fit.mjs';
import { createOracle, makeBoard } from './helpers/hackenbush-oracle.mjs';

test('legacy rated deals reproduce all twelve size, opener and seat assignments on six-hex seeds', () => {
  assert.deepEqual(ratedDeal(' abcdef '), {
    seed: 'ABCDEF', boardVersion: 1, difficulty: 'large', firstSide: 'blue', seat: 'blue',
  });
  for (const bad of ['GROVE7', '00000', 'DAILY-01-01-2026', 0, null]) assert.throws(() => ratedDeal(bad), RangeError);
  const seeds = new Set(), seen = new Set();
  for (let i = 0; i < 512; i++) {
    const seed = calibrationSeed(i);
    const deal = ratedDeal(seed);
    seeds.add(seed); seen.add([deal.difficulty, deal.firstSide, deal.seat].join('/'));
    assert.equal(deal.boardVersion, 1);
  }
  assert.equal(seeds.size, 512);
  assert.equal(seen.size, 12);
});

test('rated Expert proves both sides at every descendant of small generated fields, without a clock', t => {
  t.mock.method(performance, 'now', () => { throw new Error('Rated Expert sampled wall time'); });
  for (const variant of ['green', 'redblue']) {
    for (const seed of ['000002', '1ACED0', 'BB5313']) {
      const board = generateBoard(seed, variant, 'small', 1);
      const oracle = createOracle(board);
      for (const live of oracle.positions()) for (const side of ['blue', 'red']) {
        const winner = oracle.winner(live, side);
        const proof = ratedBotMove(board, live, side, 'expert', seed, 0);
        assert.equal(proof.proven, true);
        assert.equal(proof.winning, winner === side);
        assert.equal(ratedOpeningWinner(board, live, side), winner);
        if (!legalMoves(board, live, side).length) { assert.equal(proof.edgeId, null); continue; }
        const option = oracle.options(live).find(move => move.id === proof.edgeId);
        assert.ok(option && (option.color === 'green' || option.color === side));
        assert.equal(oracle.winner(option.live, otherSide(side)), winner);
      }
    }
  }
});

test('the clock-independent search explicitly rejects out-of-family graphs', () => {
  const longStem = makeBoard(Array.from({ length: 8 }, (_, i) => [i, i + 1, 'red']));
  const oversized = makeBoard(Array.from({ length: 23 }, (_, i) => [0, i + 1, 'green']));
  const mixed = makeBoard([[0, 1, 'blue'], [1, 2, 'green']]);
  for (const board of [longStem, oversized, mixed]) {
    assert.throws(() => ratedOpeningWinner(board, initialEdges(board), 'blue'), RangeError);
  }
});

test('calibrated seat-swapped games and Easy replay independently of ambient randomness', t => {
  t.mock.method(Math, 'random', () => { throw new Error('Unseeded random draw'); });
  t.mock.method(performance, 'now', () => { throw new Error('Timing changed a rated move'); });
  const deal = ratedDeal('ABCDEF');
  const board = generateBoard(deal.seed, 'redblue', deal.difficulty, 1);
  for (const [a, b] of [['expert', 'easy'], ['easy', 'expert'], ['standard', 'standard']]) {
    assert.deepEqual(playCalibrationGame(board, deal, a, b), playCalibrationGame(board, deal, a, b));
  }
  // Exercise the shipped Easy draw over the range of choices on a fixed rack.
  const rack = makeBoard(Array.from({ length: 5 }, (_, i) => [0, i + 1, 'green']));
  const live = initialEdges(rack);
  for (const side of ['blue', 'red']) {
    const edges = new Set(Array.from({ length: 256 }, (_, i) => ratedBotMove(rack, live, side, 'easy', calibrationSeed(i), 3).edgeId));
    assert.deepEqual(edges, new Set(live));
  }
});

test('the paired corpus reproduces its transcript, seeded cluster fit and real policy certificates', () => {
  const sample = generateCorpus(8);
  assert.equal(sample.digest, '242294289e8f53a3b341861968c07b671fcd2a4efbe47b88a117e30087f1d00d');
  for (const boards of Object.values(sample.byVariant)) for (const board of boards) {
    assert.equal(board.games.length, 9);
    assert.equal(new Set(board.games.map(g => `${g.blue}/${g.red}`)).size, 9);
    for (const game of board.games) {
      if (game[game.favored] === 'expert') assert.equal(game.winner, game.favored);
      if (game.forcedWinner) assert.equal(game.winner, game.forcedWinner);
    }
  }
  const { byVariant } = generateCorpus(24);
  for (const boards of Object.values(byVariant)) {
    const result = fitVariant(boards, 8);
    assert.deepEqual(fitVariant(boards, 8), result);
    assert.equal(result.data.sample.boards, 20);
    assert.equal(result.data.sample.holdoutBoards, 4);
    assert.ok(result.data.sample.fitted > 0 && result.data.sample.fitted < result.data.sample.games);
  }
});

test('finite predictors respect seat exchange, while certified policy points are exact', () => {
  const blue = { blue: 'easy', red: 'standard', favored: 'red', firstSide: 'blue' };
  const red = { blue: 'standard', red: 'easy', favored: 'blue', firstSide: 'red' };
  const beta = [-0.5, 1, 0.8, -0.4];
  assert.deepEqual(features(blue), [1, 0, -1, 1]);
  assert.ok(Math.abs(predict(blue, beta) + predict(red, beta) - 1) < 1e-12);
  assert.equal(predict({ ...blue, red: 'expert' }, beta), 0);
  assert.equal(predict({ ...blue, forcedWinner: 'blue' }, beta), 1);
  assert.ok(predict({ ...blue, red: 'expert' }, beta, false) > 0);
});

test('published estimates retain the reference scale, sufficient sample counts and joint uncertainty', () => {
  assert.match(CALIBRATION_VERSION, /^gardens-1-[a-f0-9]{12}$/);
  for (const fit of Object.values(BOT_CALIBRATION)) {
    assert.equal(fit.sample.boards + fit.sample.holdoutBoards, 4096);
    assert.equal(fit.sample.games, 9 * fit.sample.boards);
    assert.deepEqual(fit.order, ['easy', 'expert', 'favored', 'first']);
    assert.equal(fit.bots.standard.rating, 1000);
    assert.equal(fit.bots.standard.sd, 0);
    assert.ok(fit.bots.easy.rating < fit.bots.standard.rating && fit.bots.standard.rating < fit.bots.expert.rating);
    const sds = [fit.bots.easy.modelSd, fit.bots.expert.modelSd, fit.opening.favoredSd, fit.opening.firstSd];
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(sds[i] ** 2 - fit.covariance[i][i]) < 1e-4);
      for (let j = 0; j < 4; j++) assert.equal(fit.covariance[i][j], fit.covariance[j][i]);
    }
  }
});
