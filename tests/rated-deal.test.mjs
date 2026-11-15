import test from 'node:test';
import assert from 'node:assert/strict';
import { RATED_BOTS } from '../dist/js/rated-bots.js';
import { legacyRatedDeal, ratedBotMove, ratedDeal } from '../dist/js/rated-deal.js';
import { legalMoves, otherSide } from '../dist/js/rules.js';
import { createGame, expireTurn, matchKey, playCut, restoreGame, saveData, startTurnClock } from '../dist/js/session.js';

function playersFor(human, level, name) {
  return {
    [human]: { kind: 'human', name: 'You' },
    [otherSide(human)]: { kind: 'computer', name, level },
  };
}

test('a rated map and an ordinary map share every edge, color, landmark and ground coordinate', () => {
  const assignments = new Set();
  for (const seed of ['000000', '000001', '000003', '000008', 'ABCDEF', 'FFFFFF']) {
    const deal = ratedDeal(seed);
    assert.deepEqual(ratedDeal(' ' + seed.toLowerCase() + ' '), deal);
    assert.equal(deal.seed, seed);
    assert.equal(deal.boardVersion, 5);
    assert.equal(deal.difficulty, 'expert');
    assert.equal(deal.timed, false);
    assignments.add([deal.firstSide, deal.seat].join('/'));
    for (const variant of ['green', 'redblue']) {
      const rated = createGame({ ...deal, variant, opponent: 'computer', players: playersFor(deal.seat, 'nelson', 'Nelson') });
      const casual = createGame({ seed: rated.board.mapSeed, variant });
      assert.equal(rated.board.mapSeed, seed);
      assert.deepEqual(rated.board, casual.board);
      assert.deepEqual(rated.live, casual.live);
      assert.ok(rated.board.world.landmarks.length >= 3);
      assert.ok(rated.board.edges.length > 22);
      assert.equal(casual.timed, true);
    }
  }
  assert.equal(assignments.size, 4);
  for (const seed of ['GROVE7', '00000', 'DAILY-01-01-2026', 0, null]) {
    assert.throws(() => ratedDeal(seed), RangeError);
  }
  for (const version of [2, 4, 6, '5', null]) assert.throws(() => ratedDeal('ABCDEF', version), RangeError);
});

test('untimed full-map replays retain the named bot, assigned turn, large edge IDs and terminal position', () => {
  // The human opens on Red, and both variants have playable three-digit branch IDs.
  const deal = ratedDeal('000000');
  for (const variant of ['green', 'redblue']) {
    const config = { ...deal, variant, opponent: 'computer', players: playersFor(deal.seat, 'martin', 'Martin') };
    const opening = createGame(config);
    assert.ok(opening.matchId);
    const gameId = 'rated-' + 'a'.repeat(32);
    let game = createGame({ ...config, matchId: gameId });
    assert.notEqual(opening.matchId, game.matchId);
    assert.equal(startTurnClock(game, 1000), game);
    assert.equal(expireTurn(game, 100000), game);
    while (!game.victor) {
      const saved = JSON.parse(JSON.stringify(saveData(game)));
      const resumed = restoreGame(saved);
      assert.deepEqual(resumed.live, game.live);
      const bot = resumed.players[otherSide(resumed.seat)];
      assert.deepEqual(bot, { kind: 'computer', name: 'Martin', level: 'martin' });
      const id = resumed.side === resumed.seat ? legalMoves(resumed.board, resumed.live, resumed.side).at(-1)
        : ratedBotMove(resumed.board, resumed.live, resumed.side, bot.level, resumed.seed, resumed.moves.length).edgeId;
      game = playCut(resumed, id);
      assert.ok(game);
    }
    assert.ok(game.moves.some(id => Number(id.slice(1)) >= 100));
    assert.equal(game.matchId, gameId);
    assert.deepEqual(restoreGame(saveData(game)), game);
  }
});

test('the untimed map exception requires one named bot and the human on this device', () => {
  const deal = ratedDeal('000001');
  assert.notEqual(deal.firstSide, deal.seat);
  for (const { id, name } of RATED_BOTS) {
    const config = { ...deal, opponent: 'computer', players: playersFor(deal.seat, id, name) };
    const game = createGame(config);
    assert.deepEqual(restoreGame(saveData(game)), game);
    assert.equal(matchKey(game), matchKey(saveData(game)));
  }
  const players = playersFor(deal.seat, 'martin', 'Martin');
  const config = { ...deal, opponent: 'computer', players };
  for (const changes of [
    { opponent: 'local' }, { opponent: 'link' }, { seat: otherSide(deal.seat) },
    { players: playersFor(deal.seat, 'expert', 'Expert') },
    { players: { blue: players.red, red: players.red } },
    { boardVersion: 4 }, { boardVersion: 7 },
  ]) assert.throws(() => createGame({ ...config, ...changes }));
});

test('saved miniature gardens regenerate their original seats, bot cuts and winner', () => {
  // Transcripts from board version 1, with the human taking the last legal cut.
  const receipts = [
    { seed: '000002', difficulty: 'small', firstSide: 'red', seat: 'blue', variant: 'green', level: 'easy',
      victor: 'red', moves: ['e5', 'e4', 'e1', 'e3', 'e0'] },
    { seed: '000000', difficulty: 'standard', firstSide: 'red', seat: 'red', variant: 'redblue', level: 'standard',
      victor: 'blue', moves: ['e15', 'e1', 'e12', 'e4', 'e10', 'e9', 'e0', 'e13'] },
    { seed: 'ABCDEF', difficulty: 'large', firstSide: 'blue', seat: 'blue', variant: 'green', level: 'expert',
      victor: 'red', moves: ['e16', 'e13', 'e15', 'e0', 'e12', 'e6', 'e11', 'e5', 'e10', 'e4', 'e9', 'e3'] },
  ];
  for (const { seed, difficulty, firstSide, seat, variant, level, moves, victor } of receipts) {
    const deal = { seed, boardVersion: 1, difficulty, firstSide, seat };
    assert.deepEqual(legacyRatedDeal(seed), deal);
    assert.deepEqual(ratedDeal(seed, 1), deal);
    const saved = { ...deal, variant, opponent: 'computer', matchId: 'rated-' + '1'.repeat(32),
      players: playersFor(seat, level, level[0].toUpperCase() + level.slice(1)), timed: false, deadline: null, timedOut: null };
    let game = restoreGame({ ...saved, moves: [] });
    for (const id of moves) {
      if (game.side !== seat) assert.equal(ratedBotMove(game.board, game.live, game.side, level, seed, game.moves.length).edgeId, id);
      game = playCut(game, id);
      assert.ok(game);
    }
    assert.equal(game.victor, victor);
    assert.deepEqual(restoreGame({ ...saved, moves }), game);
  }
});
