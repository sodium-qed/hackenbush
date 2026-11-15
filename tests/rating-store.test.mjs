import test from 'node:test';
import assert from 'node:assert/strict';
import { createRatingStore, HISTORY_PER_VARIANT, prepareRatedOpening, RATING_KEY } from '../dist/js/rating.js';
import { playCut, restoreGame } from '../dist/js/session.js';
import { legalMoves } from '../dist/js/rules.js';
import { ratedBotMove } from '../dist/js/rated-deal.js';

function fixture(word = 0) {
  const values = new Map();
  let readFails = false, writeFails = false, count = 0, time = 100_000;
  const storage = {
    getItem(key) { if (readFails) throw Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (writeFails) throw Error('quota'); values.set(key, value); },
  };
  const entropy = { getRandomValues(array) {
    for (let i = 0; i < array.length; i++) array[i] = count === 0 ? word : Math.imul(count, 0x141f73);
    count++; return array;
  } };
  // Two separately constructed storage handles share an origin-wide lock.
  let pending = Promise.resolve();
  const locks = { request(_name, operation) { const next = pending.then(operation); pending = next.catch(() => {}); return next; } };
  const store = (extras = {}) => createRatingStore({ storage: { ...storage }, entropy, locks, clock: () => time++, ...extras });
  return { store, values, failReads(v) { readFails = v; }, failWrites(v) { writeFails = v; } };
}

async function start(store, variant = 'green', level = 'standard') {
  const result = await store.start(variant, level);
  assert.equal(result.ok, true, result.reason);
  return restoreGame(result.active.game);
}

function step(game, humanLevel = 'expert') {
  const level = game.side === game.seat ? humanLevel : game.players[game.side].level;
  const { edgeId } = ratedBotMove(game.board, game.live, game.side, level, game.seed, game.moves.length);
  return playCut(game, edgeId);
}

async function playUntilLast(store, opening) {
  let game = opening;
  while (!game.victor) {
    game = step(game);
    if (!game.victor) assert.ok((await store.checkpoint(game)).ok);
  }
  return game;
}

test('an unfinished issued deal survives reload, variant changes and another start', async () => {
  const f = fixture(), first = f.store();
  const game = await start(first);
  const assignment = first.read().active;
  assert.equal(assignment.id, game.matchId);
  assert.ok(first.matches(game));
  const next = step(game);
  assert.equal((await first.finish(next)).reason, 'unfinished');
  assert.ok((await first.checkpoint(next)).ok);
  const reopened = f.store();
  const resume = await reopened.start('redblue', 'easy');
  assert.equal(resume.active.id, assignment.id);
  assert.deepEqual(resume.active.game.moves, next.moves);
  assert.deepEqual(resume.active.forecast, assignment.forecast);
  assert.equal(reopened.read().pools.green.games, 0);
  assert.equal(reopened.read().issued, 1);
});

test('only matching configured games and a verified legal transition can alter the ledger', async () => {
  const store = fixture().store(), game = await start(store), next = step(game);
  for (const derived of [{ ...next, opponent: 'link' }, { ...next, seed: 'DAILY-01-01-2026' },
    { ...next, seed: 'different' }, { ...next, boardVersion: 6, difficulty: 'custom' },
    { ...next, matchId: 'ordinary-replay' }, { ...next, timed: true },
    { ...next, players: { ...next.players, [game.seat]: { kind: 'computer' } } },
    { ...next, victor: game.seat }, { ...next, moves: ['e99'] }]) {
    assert.equal((await store.checkpoint(derived)).ok, false);
    assert.deepEqual(store.read().active.game.moves, []);
  }
  assert.equal((await store.checkpoint(step(next))).reason, 'stale');
  assert.ok((await store.checkpoint(next)).ok);
  const actual = step(next);
  const wrongId = legalMoves(next.board, next.live, next.side).find(id => id !== actual.moves.at(-1));
  assert.ok(wrongId);
  assert.equal((await store.checkpoint(playCut(next, wrongId))).reason, 'ineligible');
  assert.equal((await store.checkpoint(game)).reason, 'stale');
});

test('one atomic terminal settlement updates a single pool, persists its receipt, and tolerates a retry', async () => {
  const f = fixture(), store = f.store();
  const game = await start(store);
  const final = await playUntilLast(store, game);
  const stateBefore = store.read();
  assert.equal(final.victor, game.seat);
  f.failWrites(true);
  assert.equal((await store.finish(final)).reason, 'unavailable');
  assert.deepEqual(store.read(), stateBefore);
  f.failWrites(false);
  const [a, b] = await Promise.all([store.finish(final), f.store().finish(final)]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.record, b.record);
  const { record } = a;
  assert.equal(record.reason, 'win');
  assert.ok(record.rated && record.delta > 0 && record.rdAfter < record.rdBefore);
  assert.deepEqual(restoreGame(record.game).moves, final.moves);
  assert.ok(store.matches(final));
  assert.deepEqual(record.opening, stateBefore.active.opening);
  const persisted = f.store().read();
  assert.equal(persisted.active, null);
  assert.equal(persisted.pools.green.ratedGames, 1);
  assert.equal(persisted.pools.green.wins, 1);
  assert.equal(persisted.pools.redblue.games, 0);
  assert.equal(persisted.history.length, 1);
  assert.equal((await store.forfeit(record.id)).record.reason, 'win');
});

test('a forced Expert loss remains in history with exactly zero skill and RD change', async () => {
  const f = fixture(2), store = f.store();
  const opening = await start(store, 'green', 'expert');
  assert.equal(store.read().active.opening.certificate, 'expert-policy');
  const result = await store.finish(await playUntilLast(store, opening));
  assert.equal(result.record.reason, 'loss');
  assert.equal(result.record.rated, false);
  assert.equal(result.record.expected, 0);
  assert.equal(result.record.delta, 0);
  assert.equal(result.record.rdAfter, result.record.rdBefore);
  assert.deepEqual(result.state.pools.green, { rating: 1000, rd: 200, games: 1, ratedGames: 0,
    wins: 0, losses: 1, provisional: true });
});

test('concurrent starts and divergent continuations retain only the first durable branch', async () => {
  const f = fixture(), a = f.store(), b = f.store();
  const [first, second] = await Promise.all([a.start('green', 'standard'), b.start('redblue', 'easy')]);
  assert.ok(first.ok && second.ok);
  assert.equal(first.active.id, second.active.id);
  const game = restoreGame(first.active.game);
  assert.equal(game.side, game.seat);
  const [left, right] = legalMoves(game.board, game.live, game.side).map(id => playCut(game, id)).filter(g => !g.victor);
  const [one, two] = await Promise.all([a.checkpoint(left), b.checkpoint(right)]);
  assert.equal(one.ok, true);
  assert.equal(two.reason, 'stale');
  assert.deepEqual(two.state.active.game.moves, left.moves);
  const [r1, r2] = await Promise.all([a.forfeit(game.matchId), b.forfeit(game.matchId)]);
  assert.deepEqual(r1.record, r2.record);
  assert.equal(r1.record.reason, 'forfeit');
  assert.equal(r1.record.won, false);
  assert.ok(r1.record.delta < 0);
  assert.equal(a.read().history.length, 1);
});

test('seed sequence outlives bounded history and reset prevents stale completions', async () => {
  const f = fixture(), store = f.store();
  const seeds = new Set();
  let first;
  for (let i = 0; i < HISTORY_PER_VARIANT + 3; i++) {
    const game = await start(store, 'green', 'easy');
    first ??= game;
    assert.ok(!seeds.has(game.seed));
    seeds.add(game.seed);
    assert.ok((await store.forfeit(game.matchId)).ok);
  }
  assert.equal(store.read().pools.green.games, seeds.size);
  assert.equal(store.read().history.length, HISTORY_PER_VARIANT);
  assert.equal((await store.finish(first)).reason, 'ineligible');
  const other = await start(store, 'redblue', 'easy');
  assert.ok(!seeds.has(other.seed));
  assert.ok((await store.forfeit(other.matchId)).ok);
  assert.equal(store.read().history.length, HISTORY_PER_VARIANT + 1);
  const stale = await start(store);
  f.values.set('groundwork.other', 'keep');
  assert.ok((await store.reset()).ok);
  assert.equal(store.read().issued, 0);
  assert.equal(store.read().active, null);
  assert.equal(store.read().history.length, 0);
  assert.equal(f.values.get('groundwork.other'), 'keep');
  assert.equal((await store.checkpoint(step(stale))).reason, 'ineligible');
});

test('a reset while a worker is preparing, or its failure, cannot resurrect a draw', async () => {
  const f = fixture();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const store = f.store({ prepareOpening: async g => { await wait; return prepareRatedOpening(g); } });
  const starting = store.start('green', 'standard');
  await f.store().reset();
  release();
  assert.equal((await starting).reason, 'stale');
  assert.equal(store.read().active, null);
  const brokenWorker = f.store({ prepareOpening: () => { throw Error('worker unavailable'); } });
  assert.equal((await brokenWorker.start('green', 'standard')).reason, 'prepare-failed');
  assert.equal(store.read().issued, 0);
});

test('storage failure, invalid data and future schemas preserve last durable data', async () => {
  const f = fixture(), store = f.store();
  f.failReads(true);
  assert.equal(store.read().status, 'unavailable');
  assert.equal((await store.start('green', 'easy')).reason, 'unavailable');
  f.failReads(false);
  await start(store);
  const valid = JSON.parse(f.values.get(RATING_KEY));
  for (const corrupt of [s => { s.pools.green.rd = '123'; }, s => { s.active.startedAt = Number.MAX_SAFE_INTEGER; },
    s => { s.active.game.moves = ['e0', 'e0']; }, s => { s.active.game.moves = ['e99']; },
    s => { s.active.opening.upper = 150; }, s => { s.active.forecast.loss = null; }]) {
    const data = structuredClone(valid); corrupt(data);
    const raw = JSON.stringify(data); f.values.set(RATING_KEY, raw);
    assert.equal(store.read().status, 'invalid');
    assert.equal((await store.start('green', 'easy')).reason, 'invalid');
    assert.equal(f.values.get(RATING_KEY), raw);
  }
  f.values.set(RATING_KEY, 'malformed');
  assert.equal(store.read().status, 'invalid');
  assert.ok((await store.reset()).ok);
  const newer = JSON.stringify({ version: 999, futureField: true }); f.values.set(RATING_KEY, newer);
  assert.equal((await store.start('redblue', 'expert')).reason, 'newer');
  assert.equal((await store.reset()).reason, 'newer');
  assert.equal(f.values.get(RATING_KEY), newer);
});

test('compatible variant-history migration preserves receipts and already-priced matches', async () => {
  const f = fixture(), store = f.store();
  const first = await start(store);
  await store.forfeit(first.matchId);
  const second = await start(store, 'redblue', 'easy');
  const data = JSON.parse(f.values.get(RATING_KEY));
  const oldRating = data.active.forecast.loss.rating;
  data.version = 1;
  for (const v of ['green', 'redblue']) data.pools[v].history = data.history.filter(r => r.variant === v);
  delete data.history;
  data.active.forecast.calibration = 'older-calibration';
  f.values.set(RATING_KEY, JSON.stringify(data));
  assert.equal(store.read().history[0].id, first.matchId);
  assert.equal(JSON.parse(f.values.get(RATING_KEY)).version, 1);
  const r = await store.forfeit(second.matchId);
  assert.equal(r.record.calibration, 'older-calibration');
  assert.equal(r.record.after, oldRating);
  assert.equal(JSON.parse(f.values.get(RATING_KEY)).version, 2);
});
