import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastOpening, isProvisional, newPool, ratedBotSummary, skillForecast, winChance } from '../dist/js/rating-model.js';
import { createRatedGame } from '../dist/js/rating.js';
import { assessOutcomeChoice, prepareRatedOpening } from '../dist/js/rating-opening.js';
import { RATED_BOTS } from '../dist/js/rated-bots.js';
import { legacyRatedDeal, ratedBotMove, ratedOpeningWinner } from '../dist/js/rated-deal.js';
import { createGame } from '../dist/js/session.js';
import { cutEdge, initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';

const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} differs from ${b}`);
function gameFor(seed, variant, level) {
  const deal = legacyRatedDeal(seed);
  return createGame({ ...deal, variant, opponent: 'computer', timed: false,
    players: { [deal.seat]: { kind: 'human' }, [otherSide(deal.seat)]: { kind: 'computer', level } } });
}

// Direct integration over both independent normal variables, on a uniform grid.
// This oracle has different quadrature, variables, and posterior arithmetic.
function gridForecast(pool, offset, nuisance) {
  const sd = Math.hypot(pool.rd, 12);
  let area = 0, mass = 0, first = 0, second = 0;
  for (let i = -80; i <= 80; i++) {
    const r = pool.rating + sd * i / 10;
    for (let j = -80; j <= 80; j++) {
      const w = Math.exp(-(i * i + j * j) / 200);
      const p = 1 / (1 + 10 ** (-(r + offset + nuisance * j / 10) / 400));
      area += w;
      mass += w * p;
      first += w * p * r;
      second += w * p * r * r;
    }
  }
  return { expected: mass / area, rating: first / mass, rd: Math.sqrt(second / mass - (first / mass) ** 2) };
}

test('Elo-sized log odds, symmetric evidence and independent numerical integration', () => {
  close(winChance(0), 0.5);
  close(winChance(400), 10 / 11);
  close(winChance(-400), 1 / 11);
  const pool = newPool();
  const even = skillForecast(pool, -pool.rating, 20);
  close(even.expected, 0.5);
  close(even.win.rating - pool.rating, pool.rating - even.loss.rating);
  close(even.win.rd, even.loss.rd);
  for (const offset of [-1600, -1200, -920]) {
    for (const sd of [0, 65, 145]) {
      const f = skillForecast(pool, offset, sd), exact = gridForecast(pool, offset, sd);
      close(f.expected, exact.expected, 2e-7);
      close(f.win.rating, exact.rating, 0.001);
      close(f.win.rd, exact.rd, 0.002);
      close(f.expected * f.win.rating + (1 - f.expected) * f.loss.rating, pool.rating, 1e-8);
    }
  }
});

test('skill change reflects surprise, player and opponent uncertainty, and structural uncertainty', () => {
  const pool = newPool();
  const favorite = skillForecast(pool, -900, 0), underdog = skillForecast(pool, -1500, 0);
  assert.ok(favorite.expected > 0.5 && underdog.expected < 0.5);
  assert.ok(underdog.win.rating > favorite.win.rating && favorite.win.rating > pool.rating);
  assert.ok(favorite.loss.rating < underdog.loss.rating && underdog.loss.rating < pool.rating);
  const evenWin = skillForecast(pool, -pool.rating, 0).win.rating;
  assert.ok(skillForecast({ ...pool, rd: 40 }, -pool.rating, 0).win.rating < evenWin);
  assert.ok(skillForecast(pool, -pool.rating, 200).win.rating < evenWin);
  const game = gameFor('000000', 'redblue', 'easy');
  const opening = { information: 'skill', winner: game.seat, score: 10, lower: 10, upper: 10, forcedWinner: null };
  const favored = forecastOpening(pool, game, opening);
  const notFavored = forecastOpening(pool, game, { ...opening, winner: otherSide(game.seat) });
  assert.ok(favored.expected > notFavored.expected && favored.expected < 1 && notFavored.expected > 0);
  const uncertain = forecastOpening(pool, game, { ...opening, score: 50, lower: 0, upper: 100 });
  assert.ok(uncertain.transferSd > favored.transferSd && uncertain.nuisanceSd > favored.nuisanceSd);
  assert.ok(uncertain.expected < favored.expected);
  const bot = ratedBotSummary('redblue', 'easy');
  assert.notEqual(bot.modelRating, bot.rating);
  assert.equal(bot.sourceKind, 'legacy-fit');
  const fixed = forecastOpening(pool, game, { ...opening, information: 'forced', forcedWinner: game.seat });
  const unknown = forecastOpening(pool, game, { ...opening, information: 'unresolved' });
  assert.equal(fixed.expected, 1);
  for (const f of [fixed, unknown]) {
    assert.equal(f.rated, false);
    assert.deepEqual(f.win, { rating: pool.rating, rd: pool.rd });
    assert.deepEqual(f.loss, f.win);
  }
});

test('named full-garden bots price informative outcomes using their individual nominal Elo and a broad prior', () => {
  const pool = newPool();
  assert.equal(pool.rating, 1200);
  const opening = { information: 'skill', winner: null, forcedWinner: null, score: 40, lower: 20, upper: 60 };
  for (const variant of ['green', 'redblue']) {
    let previous = 1;
    for (const { id, elo } of RATED_BOTS) {
      const summary = ratedBotSummary(variant, id);
      assert.equal(summary.rating, elo);
      assert.equal(summary.modelRating, elo);
      assert.equal(summary.sourceKind, 'assigned-prior');
      assert.ok(summary.provisional && summary.modelSd >= 150);
      const game = createRatedGame(variant, id, '000000');
      const f = forecastOpening(pool, game, opening);
      assert.ok(f.rated && f.expected > 0 && f.expected < previous);
      assert.ok(f.win.rating > pool.rating && f.loss.rating < pool.rating);
      close(f.nuisanceSd, Math.hypot(summary.modelSd, f.transferSd));
      close(f.expected, skillForecast(pool, -elo, f.nuisanceSd).expected);
      assert.equal(f.calibration, summary.calibration);
      previous = f.expected;
    }
  }
  const game = createRatedGame('redblue', 'nelson', '000000');
  const unknown = forecastOpening(pool, game, opening);
  const advantage = forecastOpening(pool, game, { ...opening, winner: game.seat });
  const disadvantage = forecastOpening(pool, game, { ...opening, winner: otherSide(game.seat) });
  assert.ok(advantage.expected > unknown.expected && unknown.expected > disadvantage.expected);
  const unresolved = forecastOpening(pool, game, { ...opening, information: 'unresolved' });
  assert.equal(unresolved.expected, unknown.expected);
  assert.equal(unresolved.rated, false);
  assert.deepEqual(unresolved.win, { rating: pool.rating, rd: pool.rd });
  assert.deepEqual(unresolved.loss, unresolved.win);
});

test('only informative results can establish a provisional estimate', () => {
  assert.ok(isProvisional(9, 60));
  assert.ok(isProvisional(10, 120));
  assert.equal(isProvisional(10, 110), false);
  let pool = newPool();
  for (let i = 0; i < 60; i++) {
    const f = skillForecast(pool, -1200, 25);
    pool = i % 2 ? f.loss : f.win;
  }
  assert.ok(pool.rd > 20 && pool.rd < 75);
});

// Fully enumerate a small decision tree with the production bot fixed. No
// probes, transposition table, or theorem-based shortcut participate here.
function possibleWinners(game, live = game.live, side = game.firstSide, ply = 0) {
  let moves = legalMoves(game.board, live, side);
  if (!moves.length) return new Set([otherSide(side)]);
  if (side !== game.seat) moves = [ratedBotMove(game.board, live, side, game.players[side].level, game.seed, ply).edgeId];
  return new Set(moves.flatMap(id => [...possibleWinners(game, cutEdge(game.board, live, id, side).live, otherSide(side), ply + 1)]));
}

test('fixed-policy certificates agree with complete enumeration on small generated games', () => {
  let total = 0, forced = 0, scored = 0;
  for (let i = 0; i < 48; i++) {
    const seed = i.toString(16).padStart(6, '0').toUpperCase();
    if (legacyRatedDeal(seed).difficulty !== 'small') continue;
    for (const variant of ['green', 'redblue']) for (const level of ['easy', 'standard', 'expert']) {
      const game = gameFor(seed, variant, level);
      const correct = possibleWinners(game);
      const assessed = prepareRatedOpening(game);
      assert.equal(assessed.information, correct.size === 2 ? 'skill' : 'forced');
      assert.equal(assessed.forcedWinner, correct.size === 1 ? [...correct][0] : null);
      if (correct.size === 1) forced++; else scored++;
      total++;
    }
  }
  assert.ok(total > 50 && forced > 0 && scored > 0);
});

test('perfect-play winner, a forced policy result and the end of a search budget are distinct', () => {
  const game = gameFor('90129F', 'green', 'expert');
  const opening = prepareRatedOpening(game);
  assert.equal(opening.winner, otherSide(game.seat));
  assert.equal(opening.certificate, 'expert-policy');
  const f = forecastOpening(newPool(), game, opening);
  assert.equal(f.expected, 0);
  assert.equal(f.loss.rating, 1200);
  const easy = gameFor('90129F', 'green', 'easy');
  assert.equal(prepareRatedOpening(easy).information, 'skill');
  const nodes = [{ id: 'g', ground: true }, { id: 'a' }, { id: 'b' }];
  const board = { nodes, edges: ['a', 'b'].map((b, i) => ({ id: `e${i}`, a: 'g', b, color: 'green' })) };
  const sticks = { ...easy, board, live: initialEdges(board) };
  const winner = ratedOpeningWinner(board, sticks.live, sticks.firstSide);
  assert.equal(assessOutcomeChoice(sticks, winner).forcedWinner, otherSide(sticks.firstSide));
  assert.equal(assessOutcomeChoice(sticks, winner, 0).information, 'unresolved');
});
