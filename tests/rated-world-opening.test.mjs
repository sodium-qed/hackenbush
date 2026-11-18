import test from 'node:test';
import assert from 'node:assert/strict';
import { ratedBotMove, ratedDeal } from '../dist/js/rated-deal.js';
import { assessOutcomeChoice, assessRatedOpening, prepareRatedOpening } from '../dist/js/rating-opening.js';
import { forecastOpening, newPool } from '../dist/js/rating-model.js';
import { cutEdge, legalMoves, otherSide, winner } from '../dist/js/rules.js';
import { createGame } from '../dist/js/session.js';
import { makeBoard } from './helpers/hackenbush-oracle.mjs';
import { smallKnot } from './helpers/analyzer-positions.mjs';

function gameFor(seed, variant, level) {
  const deal = ratedDeal(seed);
  return createGame({ ...deal, variant, opponent: 'computer', players: {
    [deal.seat]: { kind: 'human' }, [otherSide(deal.seat)]: { kind: 'computer', level },
  } });
}

// Verify reported paths with the actual player-facing rules, including every
// seeded bot decision. A terminal line for a different policy is no certificate.
function replayWitnesses(game, opening) {
  for (const [expected, line] of Object.entries(opening.witnesses)) {
    let live = game.live, side = game.firstSide;
    for (const [ply, id] of line.entries()) {
      if (side !== game.seat) {
        const bot = ratedBotMove(game.board, live, side, game.players[side].level, game.seed, ply);
        assert.equal(id, bot.edgeId);
      }
      const applied = cutEdge(game.board, live, id, side);
      assert.ok(applied, 'witness contains a legal cut');
      live = applied.live;
      side = otherSide(side);
    }
    assert.equal(winner(game.board, live, side), expected, 'the complete line reaches its claimed result');
  }
}

test('full gardens price only witnessed choices and count all opening cuts', () => {
  const deals = [
    ['A35D7E', 'redblue', 'martin'], ['48094F', 'redblue', 'nelson'],
    ['000000', 'green', 'aron'], ['01CAFE', 'green', 'noam'],
  ];
  for (const [seed, variant, level] of deals) {
    const game = gameFor(seed, variant, level);
    const opening = prepareRatedOpening(game);
    assert.ok(opening.edges > 80);
    assert.equal(opening.edges, game.board.edges.length);
    assert.equal(opening.legalMoves, legalMoves(game.board, game.live, game.firstSide).length);
    assert.equal(opening.legalMoves, opening.winningMoves + opening.losingMoves + opening.unknownMoves);
    assert.ok(opening.lower <= opening.score && opening.score <= opening.upper);
    assert.equal(opening.winner, opening.perfectPlay.winner);
    assert.ok(opening.searchNodes <= 480);
    assert.equal(opening.information, 'skill');
    assert.equal(opening.certificate, 'two-witnesses');
    assert.deepEqual(Object.keys(opening.witnesses).sort(), ['blue', 'red']);
    replayWitnesses(game, opening);
    if (variant === 'green') {
      assert.equal(opening.perfectPlay.exact, true);
      assert.equal(opening.unknownMoves, 0);
      assert.equal(opening.lower, opening.upper);
      assert.equal(opening.winner, opening.perfectPlay.nimber ? game.firstSide : otherSide(game.firstSide));
    }
  }
});

test('unresolved Red–Blue perfect play is separate from certified outcomes against the bot', () => {
  const game = gameFor('A35D7E', 'redblue', 'martin');
  const opening = prepareRatedOpening(game);
  assert.equal(opening.perfectPlay.exact, false);
  assert.equal(opening.winner, null);
  assert.equal(typeof opening.perfectPlay.lower, 'string');
  assert.equal(typeof opening.perfectPlay.upper, 'string');
  assert.ok(opening.unknownMoves > 0);
  assert.equal(opening.information, 'skill');
  const limited = assessOutcomeChoice(game, opening.winner, 1);
  assert.equal(limited.information, 'unresolved');
  assert.equal(limited.forcedWinner, null);
  assert.deepEqual(limited.witnesses, {});
});

test('a certified Red–Blue winner can be known before the exact number', () => {
  const game = gameFor('FFFFFF', 'redblue', 'martin');
  const opening = prepareRatedOpening(game);
  assert.equal(opening.perfectPlay.exact, false);
  assert.equal(opening.winner, 'red');
  assert.match(opening.perfectPlay.upper, /^-/);
  assert.equal(opening.information, 'skill');
  replayWitnesses(game, opening);
});

test('Noam can guarantee a favored Green seat, while Red–Blue needs separate evidence', () => {
  const game = gameFor('A35D7F', 'green', 'noam');
  const opponent = otherSide(game.seat);
  const opening = prepareRatedOpening(game);
  assert.equal(opening.winner, opponent);
  assert.equal(opening.information, 'forced');
  assert.equal(opening.forcedWinner, opponent);
  assert.equal(opening.certificate, 'perfect-green-policy');
  assert.equal(assessOutcomeChoice(gameFor('A35D7F', 'green', 'li'), opponent, 0).information, 'unresolved');
  assert.equal(assessOutcomeChoice(gameFor('A35D7F', 'redblue', 'noam'), opponent, 0).information, 'unresolved');
});

test('full-garden proofs and witnesses replay independently of the clock and ambient randomness', t => {
  const game = gameFor('A35D7E', 'redblue', 'nelson');
  const original = prepareRatedOpening(game);
  t.mock.method(Math, 'random', () => { throw new Error('Unseeded opening'); });
  let tick = 0;
  t.mock.method(performance, 'now', () => ++tick * 1000);
  assert.deepEqual(prepareRatedOpening(game), original);
});

test('automatic assessment continues an inconclusive deal and prices its actual result', async () => {
  const game = gameFor('01CAFE', 'redblue', 'isabel');
  assert.equal(prepareRatedOpening(game).information, 'unresolved');
  const updates = [];
  const opening = await assessRatedOpening(game, { settleWhenReady: true, onProgress: progress => updates.push(progress) });
  assert.equal(opening.information, 'skill');
  assert.ok(opening.searchNodes > 480);
  replayWitnesses(game, opening);
  assert.ok(updates.at(-1).ready);
  assert.ok(updates.every((p, i) => !i || p.positions >= updates[i - 1].positions));
  const pool = newPool(), forecast = forecastOpening(pool, game, opening);
  assert.ok(forecast.rated && forecast.win.rating > pool.rating && forecast.loss.rating < pool.rating);
});

test('only exhausting the fixed policy tree certifies a one-outcome garden', async () => {
  const board = makeBoard([[0, 1, 'blue'], [1, 2, 'red']]);
  const game = { boardVersion: 5, variant: 'redblue', board, live: ['e0', 'e1'], seed: '000000',
    seat: 'blue', firstSide: 'blue', moves: [], side: 'blue', players: {blue: {kind: 'human'}, red: {kind: 'computer', level: 'martin'}} };
  assert.equal(assessOutcomeChoice(game, 'blue').information, 'unresolved');
  const opening = await assessRatedOpening(game);
  assert.equal(opening.information, 'forced');
  assert.equal(opening.certificate, 'policy-tree');
  assert.equal(opening.forcedWinner, 'blue');
  replayWitnesses(game, opening);
});

test('automatic work stops at a settled opening and abandoned jobs can be canceled', async () => {
  const game = gameFor('A35D7F', 'green', 'noam');
  const progress = [];
  const result = await assessRatedOpening(game, { onProgress: p => progress.push(p) });
  assert.equal(result.certificate, 'perfect-green-policy');
  assert.ok(progress.at(-1).complete);
  const control = new AbortController();
  const unfinished = gameFor('01CAFE', 'redblue', 'isabel');
  await assert.rejects(assessRatedOpening(unfinished, {
    signal: control.signal, onProgress: () => control.abort()
  }), { name: 'AbortError' });
  await assert.rejects(assessRatedOpening({ ...unfinished, moves: ['e0'] }), /original position/);
});

test('automatic work continues to refine a playable opening after the first scoreable estimate', async () => {
  const board = smallKnot();
  const game = { ...gameFor('A35D7E', 'redblue', 'martin'), board, live: board.edges.map(edge => edge.id) };
  const automatic = await assessRatedOpening(game, { settleWhenReady: true });
  const refined = await assessRatedOpening(game);
  assert.equal(automatic.information, 'skill');
  assert.ok(automatic.lower < automatic.upper);
  assert.equal(refined.lower, refined.upper);
  assert.ok(refined.lower >= automatic.lower && refined.upper <= automatic.upper);
  const pool = newPool();
  const before = forecastOpening(pool, game, automatic), after = forecastOpening(pool, game, refined);
  assert.ok(after.transferSd < before.transferSd);
  assert.notEqual(after.win.rating, before.win.rating);
  assert.notEqual(after.loss.rating, before.loss.rating);
});
