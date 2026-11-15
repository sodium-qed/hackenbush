import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyProgress, recordDailyResult } from '../dist/js/daily-progress.js';
import { TEXT_BOARD_VERSION } from '../dist/js/map-seed.js';
import { legalMoves, otherSide } from '../dist/js/rules.js';
import { createGame, expireTurn, playCut, restoreGame, saveData, startTurnClock } from '../dist/js/session.js';

const seed = 'DAILY-11-15-2026';

function installStorage(t, descriptor) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : delete globalThis.localStorage);
}

function trackStorage(t) {
  const data = new Map();
  installStorage(t, { value: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } });
  return data;
}

function daily({ seat = 'blue', firstSide = 'blue', level = 'easy', ...config } = {}) {
  return createGame({ boardVersion: TEXT_BOARD_VERSION, seed, variant: 'redblue', opponent: 'computer', seat, firstSide,
    players: { [seat]: { kind: 'human' }, [otherSide(seat)]: { kind: 'computer', level } }, ...config });
}

function timeout(game) {
  const armed = startTurnClock(game, 1000);
  assert.ok(armed.deadline);
  return expireTurn(armed, armed.deadline);
}

function finishByCuts(game) {
  while (!game.victor) {
    const id = legalMoves(game.board, game.live, game.side)[0];
    game = playCut(startTurnClock(game, 1000), id, 1000);
  }
  assert.equal(game.timedOut, null);
  return game;
}

test('a daily loss can become a win, and repeated saves or later losses cannot erase it', t => {
  const data = trackStorage(t);
  const opening = daily();
  recordDailyResult(opening);
  assert.equal(dailyProgress(seed, 'easy'), null);

  const loss = timeout(opening);
  recordDailyResult(loss);
  assert.deepEqual(dailyProgress(seed, 'easy'), { won: false });

  const win = finishByCuts(daily());
  assert.equal(win.victor, win.seat);
  recordDailyResult(win);
  recordDailyResult(restoreGame(saveData(win)));
  recordDailyResult(timeout(daily()));
  assert.deepEqual(dailyProgress(seed, 'easy'), { won: true });
  assert.equal(data.size, 2);
  assert.equal(dailyProgress(seed, 'expert'), null);
  assert.equal(dailyProgress('DAILY-11-16-2026', 'easy'), null);
});

test('the last legal cut records the actual winner at the opposing computer’s level', t => {
  trackStorage(t);
  const game = finishByCuts(daily({ level: 'standard', variant: 'green' }));
  recordDailyResult(restoreGame(saveData(game)));
  assert.deepEqual(dailyProgress(seed, 'standard'), { won: game.victor === game.seat });
  assert.equal(dailyProgress(seed, 'easy'), null);
});

test('a computer timeout cannot earn a daily win for either human color', t => {
  const data = trackStorage(t);
  for (const seat of ['red', 'blue']) {
    const cpuTurn = daily({ seat, firstSide: otherSide(seat) });
    recordDailyResult({ ...cpuTurn, victor: seat, timedOut: cpuTurn.side });
  }
  assert.equal(dailyProgress(seed, 'easy'), null);
  assert.equal(data.size, 0);
});

test('unrelated matches and sessions without a human against one computer get no daily credit', t => {
  const data = trackStorage(t);
  const game = timeout(daily());
  for (const change of [
    { seed: 'MORNINGGARDEN' }, { seed: 'DAILY-02-30-2026' }, { boardVersion: 3 }, { boardVersion: 6 },
    { opponent: 'link' }, { opponent: 'local' }, { players: { blue: { kind: 'computer' }, red: { kind: 'computer' } } },
    { players: { blue: { kind: 'human' }, red: { kind: 'human' } } }, { seat: 'red' }, { victor: null },
  ]) recordDailyResult({ ...game, ...change });
  assert.equal(data.size, 0);
});

test('blocked local storage leaves the daily game playable', t => {
  installStorage(t, { get() { throw new Error('Storage blocked'); } });
  assert.doesNotThrow(() => recordDailyResult(timeout(daily())));
  assert.equal(dailyProgress(seed, 'easy'), null);
});
