import test from 'node:test';
import assert from 'node:assert/strict';
import { createRatedGame, createRatingStore, HISTORY_PER_VARIANT, prepareRatedOpening, RATING_KEY } from '../dist/js/rating.js';
import { BOT_CALIBRATION } from '../dist/js/bot-calibration.js';
import { playCut, restoreGame, saveData } from '../dist/js/session.js';
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

async function start(store, variant = 'green', level = 'nelson') {
  const result = await store.start(variant, level);
  assert.equal(result.ok, true, result.reason);
  return restoreGame(result.active.game);
}

function step(game, humanLevel = game.boardVersion === 1 ? 'expert' : 'noam') {
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
  for (const pool of Object.values(first.read().pools)) assert.deepEqual([pool.rating, pool.rd, pool.games], [1200, 200, 0]);
  assert.equal((await first.start('green', 'standard')).reason, 'ineligible');
  const game = await start(first);
  const assignment = first.read().active;
  assert.equal(assignment.id, game.matchId);
  assert.ok(first.matches(game));
  assert.equal(game.boardVersion, 5);
  assert.equal(assignment.family, game.board.family);
  assert.equal(game.players.blue.name, 'Nelson');
  assert.equal(assignment.bot.rating, 1300);
  assert.equal(assignment.bot.sourceKind, 'assigned-prior');
  assert.equal(assignment.opening.edges, game.board.edges.length);
  const next = playCut(game, 'e100');
  assert.equal((await first.finish(next)).reason, 'unfinished');
  assert.ok((await first.checkpoint(next)).ok);
  const reopened = f.store();
  const resume = await reopened.start('redblue', 'aron');
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
    { ...next, victor: game.seat }, { ...next, moves: ['e999'] }]) {
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

test('a proven forced loss to Noam on a full Green garden preserves skill and RD', async () => {
  const f = fixture(2), store = f.store();
  const opening = await start(store, 'green', 'noam');
  assert.equal(store.read().active.opening.certificate, 'perfect-green-policy');
  const result = await store.finish(await playUntilLast(store, opening));
  assert.equal(result.record.reason, 'loss');
  assert.equal(result.record.rated, false);
  assert.equal(result.record.expected, 0);
  assert.equal(result.record.delta, 0);
  assert.equal(result.record.rdAfter, result.record.rdBefore);
  assert.deepEqual(result.state.pools.green, { rating: 1200, rd: 200, games: 1, ratedGames: 0,
    wins: 0, losses: 1, provisional: true });
});

test('concurrent starts and divergent continuations retain only the first durable branch', async () => {
  const f = fixture(), a = f.store(), b = f.store();
  const [first, second] = await Promise.all([a.start('green', 'nelson'), b.start('redblue', 'martin')]);
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
    const game = await start(store, 'green', 'martin');
    first ??= game;
    assert.ok(!seeds.has(game.seed));
    seeds.add(game.seed);
    assert.ok((await store.forfeit(game.matchId)).ok);
  }
  assert.equal(store.read().pools.green.games, seeds.size);
  assert.equal(store.read().history.length, HISTORY_PER_VARIANT);
  assert.equal((await store.finish(first)).reason, 'ineligible');
  const other = await start(store, 'redblue', 'martin');
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
  const starting = store.start('green', 'nelson');
  await f.store().reset();
  release();
  assert.equal((await starting).reason, 'stale');
  assert.equal(store.read().active, null);
  const brokenWorker = f.store({ prepareOpening: () => { throw Error('worker unavailable'); } });
  assert.equal((await brokenWorker.start('green', 'nelson')).reason, 'prepare-failed');
  assert.equal(store.read().issued, 0);
});

test('storage failure, invalid data and future schemas preserve last durable data', async () => {
  const f = fixture(), store = f.store();
  f.failReads(true);
  assert.equal(store.read().status, 'unavailable');
  assert.equal((await store.start('green', 'martin')).reason, 'unavailable');
  f.failReads(false);
  await start(store);
  const valid = JSON.parse(f.values.get(RATING_KEY));
  for (const corrupt of [s => { s.pools.green.rd = '123'; }, s => { s.active.startedAt = Number.MAX_SAFE_INTEGER; },
    s => { s.active.game.moves = ['e0', 'e0']; }, s => { s.active.game.moves = ['e999']; },
    s => { s.active.game.moves = ['e010']; }, s => { s.active.opening.edges++; }, s => { s.active.opening.winner = null; },
    s => { s.active.family = 'a different garden'; }, s => { s.active.game.players.blue.level = 'standard'; },
    s => { s.active.opening.upper = 150; }, s => { s.active.forecast.loss = null; }]) {
    const data = structuredClone(valid); corrupt(data);
    const raw = JSON.stringify(data); f.values.set(RATING_KEY, raw);
    assert.equal(store.read().status, 'invalid');
    assert.equal((await store.start('green', 'martin')).reason, 'invalid');
    assert.equal(f.values.get(RATING_KEY), raw);
  }
  f.values.set(RATING_KEY, 'malformed');
  assert.equal(store.read().status, 'invalid');
  assert.ok((await store.reset()).ok);
  const newer = JSON.stringify({ version: 999, futureField: true }); f.values.set(RATING_KEY, newer);
  assert.equal((await store.start('redblue', 'noam')).reason, 'newer');
  assert.equal((await store.reset()).reason, 'newer');
  assert.equal(f.values.get(RATING_KEY), newer);
});

// These moves and full-precision prices came from a two-match v2 profile.
// The pending Green bot is about to reply to e1 using its original Easy tape.
function oldProfile(version) {
  const calibration = 'archived-calibration', model = 'opening-conditioned-1';
  function assignment(seed, variant, id, moves, expected) {
    const g = createRatedGame(variant, 'easy', seed, id, 1);
    return { id, seed, variant, level: 'easy', seat: g.seat, firstSide: g.firstSide, difficulty: g.difficulty,
      boardVersion: 1, timed: false, startedAt: 1000, game: { ...saveData(g), moves }, expected,
      opening: prepareRatedOpening(g), bot: { level: 'easy', ...BOT_CALIBRATION[variant].bots.easy, provisional: false, calibration } };
  }
  const active = assignment('48094F', 'green', 'rated-' + 'a'.repeat(32), ['e1'], 0.8784612711449274);
  active.forecast = { expected: active.expected, rated: true, model, calibration, offset: -576.167964,
    nuisanceSd: 42.47651346332465, transferSd: 41.5, win: { rating: 1024.1971510242347, rd: 190.40734931015223 },
    loss: { rating: 825.1071058001461, rd: 182.84937896838184 } };
  const record = { ...assignment('000000', 'redblue', 'rated-' + 'b'.repeat(32),
    ['e2', 'e4', 'e0', 'e14', 'e10', 'e13', 'e12', 'e9'], 0.5386997366941875),
    endedAt: 1100, reason: 'loss', won: false, rated: true, model, calibration, nuisanceSd: 8.5993021809912,
    transferSd: 2, before: 1000, after: 901.8029278114026, delta: -98.19707218859742, rdBefore: 200, rdAfter: 178.05840010157516 };
  const empty = { rating: 1000, rd: 200, games: 0, ratedGames: 0, wins: 0, losses: 0, provisional: true };
  const pools = { green: empty, redblue: { ...empty, rating: record.after, rd: record.rdAfter, games: 1, ratedGames: 1, losses: 1 } };
  const profile = { version, epoch: 'rated-' + 'f'.repeat(32), issued: 2, stream: { current: 2, step: 1 }, pools, active };
  if (version === 1) {
    pools.green.history = [];
    pools.redblue.history = [record];
  } else profile.history = [record];
  return profile;
}

for (const version of [1, 2]) test(`v${version} profiles rebase once, retain replays and finish the pending miniature at its frozen price`, async () => {
  const f = fixture(), store = f.store(), old = oldProfile(version);
  const oldRecord = (old.history ?? old.pools.redblue.history)[0];
  const raw = JSON.stringify(old);
  f.values.set(RATING_KEY, raw);
  const state = store.read();
  assert.equal(state.status, 'ok');
  assert.equal(state.version, 3);
  assert.equal(f.values.get(RATING_KEY), raw);
  assert.equal(state.pools.green.rating, 1200);
  assert.equal(state.pools.redblue.rating, oldRecord.after + 200);
  assert.equal(state.pools.redblue.rd, oldRecord.rdAfter);
  const [record] = state.history;
  for (const key of ['id', 'delta', 'rdBefore', 'rdAfter', 'expected', 'calibration']) assert.equal(record[key], oldRecord[key]);
  assert.equal(record.before, oldRecord.before + 200);
  assert.equal(record.after, oldRecord.after + 200);
  assert.equal(record.bot.rating, oldRecord.bot.rating + 200);
  assert.equal(record.bot.modelRating, oldRecord.bot.modelRating + 200);
  assert.equal(record.bot.sd, oldRecord.bot.sd);
  assert.deepEqual(record.game, oldRecord.game);
  assert.equal(restoreGame(record.game).victor, 'blue');
  const resumed = await store.start('green', 'easy');
  assert.equal(resumed.active.id, old.active.id);
  assert.deepEqual(resumed.active.game, old.active.game);
  assert.equal(resumed.active.forecast.offset, old.active.forecast.offset - 200);
  for (const result of ['win', 'loss']) {
    assert.equal(resumed.active.forecast[result].rating, old.active.forecast[result].rating + 200);
    assert.equal(resumed.active.forecast[result].rd, old.active.forecast[result].rd);
  }
  const opening = restoreGame(resumed.active.game), reply = step(opening);
  assert.equal(opening.boardVersion, 1);
  assert.equal(opening.players[opening.side].level, 'easy');
  f.failWrites(true);
  assert.equal((await store.checkpoint(reply)).reason, 'unavailable');
  assert.equal(f.values.get(RATING_KEY), raw);
  f.failWrites(false);
  assert.ok((await store.checkpoint(reply)).ok);
  assert.equal(JSON.parse(f.values.get(RATING_KEY)).version, 3);
  const final = await playUntilLast(store, reply);
  const settled = await store.finish(final);
  assert.ok(settled.ok);
  const frozen = old.active.forecast[settled.record.reason];
  assert.equal(settled.record.calibration, old.active.forecast.calibration);
  assert.equal(settled.record.after, frozen.rating + 200);
  assert.equal(settled.record.rdAfter, frozen.rd);
  assert.equal(settled.record.delta, frozen.rating - old.pools.green.rating);
  const reopened = f.store();
  assert.deepEqual(reopened.read().history, settled.state.history);
  assert.equal((await reopened.finish(final)).state.issued, 2);
  const next = await start(reopened, 'redblue', 'isabel');
  assert.equal(next.boardVersion, 5);
  assert.equal(reopened.read().issued, 3);
  assert.notEqual(next.seed, old.active.seed);
});

test('resigning a migrated pending game retains its exact original loss delta', async () => {
  const f = fixture(), old = oldProfile(2);
  f.values.set(RATING_KEY, JSON.stringify(old));
  const result = await f.store().forfeit(old.active.id);
  assert.ok(result.ok);
  const frozenLoss = old.active.forecast.loss;
  assert.equal(result.record.reason, 'forfeit');
  assert.equal(result.record.delta, frozenLoss.rating - old.pools.green.rating);
  assert.equal(result.record.after, frozenLoss.rating + 200);
  assert.equal(result.record.rdAfter, frozenLoss.rd);
});
