import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosition } from '../dist/js/analysis-values.js';
import { createDailyGame, dailyOpening, dailySeed } from '../dist/js/daily.js';
import { generateBoard } from '../dist/js/generator.js';
import { chooseComputerMove } from '../dist/js/opponents.js';
import { cutEdge, initialEdges, otherSide } from '../dist/js/rules.js';
import { playCut, restoreGame, saveData, startTurnClock, TURN_MS } from '../dist/js/session.js';

test('the daily seed follows the local calendar across midnight, leap day and New Year', () => {
  for (const [date, seed] of [
    [new Date(2028, 1, 28, 23, 59, 59), 'DAILY-02-28-2028'],
    [new Date(2028, 1, 29, 0, 0, 0), 'DAILY-02-29-2028'],
    [new Date(2026, 11, 31, 23, 59, 59), 'DAILY-12-31-2026'],
    [new Date(2027, 0, 1, 0, 0, 0), 'DAILY-01-01-2027'],
  ]) assert.equal(dailySeed(date), seed);
  assert.throws(() => dailySeed(new Date(NaN)), RangeError);
  for (const seed of ['DAILY-02-29-2027', 'DAILY-1-02-2026', 'daily-01-02-2026', 'C0FFEE', undefined]) {
    assert.throws(() => dailyOpening(seed), RangeError);
  }
});

test('the complete generated board, starting turn and human seat are identical at every AI level', () => {
  for (const seed of ['DAILY-11-15-2026', 'DAILY-01-03-2026', 'DAILY-04-16-2026']) {
    const { variant, firstSide, humanSide } = dailyOpening(seed);
    const original = generateBoard(seed, variant, 'expert', 7);
    for (const level of ['easy', 'standard', 'expert']) {
      const game = createDailyGame(seed, level, 'Avery');
      assert.deepEqual(game.board, original);
      assert.deepEqual(game.live, initialEdges(original));
      assert.deepEqual(game.moves, []);
      assert.equal(game.victor, null);
      assert.equal(game.firstSide, firstSide);
      assert.equal(game.side, firstSide);
      assert.equal(game.seat, humanSide);
      assert.equal(game.opponent, 'computer');
      assert.deepEqual(game.players[humanSide], { name: 'Avery', kind: 'human' });
      assert.deepEqual(game.players[otherSide(humanSide)], { name: 'Computer', kind: 'computer', level });
      assert.equal(game.timed, true);
      assert.equal(game.deadline, null);
      const running = startTurnClock(game, 1_000);
      assert.equal(running.deadline, 1_000 + TURN_MS);
      assert.deepEqual(restoreGame(saveData(running), 1_001), running);
    }
  }
});

test('Green seats follow the exact nimber for each date, including zero openings', () => {
  const orders = new Set(), seeds = new Set();
  let greenDays = 0;
  for (let day = 1; day <= 31; day++) {
    const seed = dailySeed(new Date(2026, 0, day));
    const opening = dailyOpening(seed);
    if (opening.variant !== 'green') continue;
    const board = generateBoard(seed, 'green', 'expert', 7);
    const value = analyzePosition(board, initialEdges(board), opening.firstSide, 'green', { budgetMs: 0 });
    assert.equal(value.exact, true);
    assert.equal(opening.humanSide, value.nimber ? opening.firstSide : otherSide(opening.firstSide));
    orders.add(Boolean(value.nimber));
    seeds.add(JSON.stringify(board.edges.map(({ a, b }) => [a, b])));
    greenDays++;
  }
  assert.deepEqual(orders, new Set([true, false]));
  assert.equal(seeds.size, greenDays);
});

test('perfect Green play wins complete timed duels from either human turn order', () => {
  for (const seed of ['DAILY-11-15-2026', 'DAILY-01-03-2026']) {
    let game = createDailyGame(seed), now = 1_000;
    while (!game.victor) {
      game = startTurnClock(game, now);
      const move = chooseComputerMove(game.board, game.live, game.side, 'expert');
      assert.equal(move.proven, true);
      game = playCut(game, move.edgeId, now + 100);
      assert.ok(game);
      now += 1_000;
    }
    assert.equal(game.victor, game.seat);
    assert.equal(game.timedOut, null);
  }
});

test('actual unilateral cuts certify positive and negative Red–Blue daily openings', () => {
  // Replaying these shorter certificates through the normal cut rules provides
  // independent witnesses for the color: even after giving away every listed
  // move, that color still has a strictly favorable structural endpoint.
  for (const [seed, side, cuts] of [
    ['DAILY-04-16-2026', 'blue', ['e79', 'e52', 'e34', 'e77']],
    ['DAILY-07-17-2026', 'red', ['e95', 'e100', 'e91']],
  ]) {
    const opening = dailyOpening(seed);
    assert.equal(opening.variant, 'redblue');
    assert.equal(opening.humanSide, side);
    const board = generateBoard(seed, 'redblue', 'expert', 7);
    let live = initialEdges(board);
    for (const id of cuts) live = cutEdge(board, live, id, side).live;
    const value = analyzePosition(board, live, side, 'redblue', { budgetMs: 0 });
    const endpoint = value.number ?? (side === 'blue' ? value.lower : value.upper);
    const numerator = BigInt(endpoint.split('/')[0]);
    assert.ok(side === 'blue' ? numerator > 0n : numerator < 0n);
  }
});

test('daily dates reproduce with frozen or rapidly advancing performance clocks', t => {
  const seeds = ['DAILY-01-03-2026', 'DAILY-04-16-2026', 'DAILY-04-17-2026', 'DAILY-07-17-2026'];
  const expected = seeds.map(dailyOpening);
  let time = 0, interval = 0;
  t.mock.method(performance, 'now', () => time += interval);
  for (interval of [0, 10_000]) assert.deepEqual(seeds.map(dailyOpening), expected);
});
