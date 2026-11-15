import test from 'node:test';
import assert from 'node:assert/strict';
import { ratedBotMove, ratedDeal } from '../dist/js/rated-deal.js';
import { assessOutcomeChoice, prepareRatedOpening } from '../dist/js/rating-opening.js';
import { cutEdge, legalMoves, otherSide, winner } from '../dist/js/rules.js';
import { createGame } from '../dist/js/session.js';

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
