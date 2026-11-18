import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import {
  normalizeRoomCode, onlineApiBase, OnlineRequestError, readOnlineIntent, requestOnline, roomInviteUrl,
} from '../dist/js/online-session.js';
import { cutEdge, initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';
import { serveGame } from '../server/http.js';
import { liveOpening } from '../server/opening-assessment.js';
import { openArenaDB } from '../server/local-db.js';

// Bridge the production fetch client to the Worker route using standard HTTP requests and responses.
function openArena(t, persistent = false, execution) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'hackenbush-online-')) : null;
  const filename = directory ? join(directory, 'arena.sqlite') : ':memory:';
  let now = Date.UTC(2026, 0, 1);
  const env = { DB: openArenaDB(filename), now: () => now };
  t.mock.method(globalThis, 'fetch', (url, options) => serveGame(new Request(url, options), env, () => null, execution));
  t.after(() => {
    env.DB.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  function client(token) {
    async function send(method, path, body, allowedStatuses) {
      try {
        const { payload } = await requestOnline('https://hackenbush.test', '/api' + path, { method, token, body });
        assert.ok(!allowedStatuses || allowedStatuses.some(code => code < 300), `${method} ${path} unexpectedly succeeded`);
        return payload;
      } catch (error) {
        if (!(error instanceof OnlineRequestError) || !allowedStatuses?.includes(error.status)) throw error;
        return { error: error.message, status: error.status };
      }
    }
    return {
      token,
      state: () => send('GET', '/state'),
      post: (path, body, allowedStatuses) => send('POST', path, body, allowedStatuses),
      remove: path => send('DELETE', path),
    };
  }

  return {
    client,
    setTime(value) { now = value; },
    restart() { env.DB.close(); env.DB = openArenaDB(filename); },
    seedGreenRatings(ratings) {
      const update = env.DB.prepare('UPDATE arena_players SET green_rating = ? WHERE name = ?');
      return env.DB.batch(Object.entries(ratings).map(([name, rating]) => update.bind(rating, name)));
    },
    async guest(name) {
      const { token, profile } = await client().post('/profile', { name });
      assert.ok(token);
      assert.deepEqual(profile.ratings, { green: 1200, redblue: 1200 });
      return client(token);
    },
  };
}

function bothSeats(first, firstMatch, second, secondMatch) {
  assert.equal(firstMatch.id, secondMatch.id);
  assert.equal(firstMatch.seat, otherSide(secondMatch.seat));
  assert.deepEqual(firstMatch.players, secondMatch.players);
  assert.deepEqual(firstMatch.live, secondMatch.live);
  return { [firstMatch.seat]: first, [secondMatch.seat]: second };
}

function originalPrice(match) {
  return liveOpening({ seed: match.seed, variant: match.variant, board_version: match.boardVersion,
    first_side: match.firstSide, red_rating: match.players.red.rating, blue_rating: match.players.blue.rating }, Infinity);
}

const move = (client, match, edgeId, statuses) => client.post(`/matches/${match.id}/move`, {
  version: match.version, edgeId,
}, statuses);

test('a Pages project can reach the arena with authenticated cross-origin JSON requests', async t => {
  openArena(t);
  const origin = 'https://sodium-qed.github.io';
  const hosted = 'https://hackenbush.test';
  const url = new URL('/api/state', onlineApiBase(origin + '/hackenbush/', hosted));
  assert.equal(url.origin, hosted);
  for (const server of ['http://localhost:5173', 'http://192.168.1.5:5173', 'https://preview.test']) {
    assert.equal(new URL(onlineApiBase(server + '/?room=ABCDEF', hosted)).origin, server);
  }
  const response = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'x-groundwork-token,content-type',
  } });
  assert.equal(response.status, 204);
  assert.ok([origin, '*'].includes(response.headers.get('access-control-allow-origin')));
  const methods = response.headers.get('access-control-allow-methods').split(/,\s*/);
  for (const method of ['GET', 'POST', 'DELETE']) assert.ok(methods.includes(method));
  const headers = response.headers.get('access-control-allow-headers').toLowerCase().split(/,\s*/);
  for (const header of ['x-groundwork-token', 'content-type']) assert.ok(headers.includes(header));
  const anonymous = await fetch(url, { headers: { Origin: origin } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
});

test('a private invitation and its typed code reach the same game, with authoritative cuts and unrated results', async t => {
  const arena = openArena(t);
  const [host, visitor, observer] = await Promise.all(['Aster', 'Birch', 'Cedar'].map(arena.guest));
  const { room } = await host.post('/rooms', { variant: 'redblue' });
  const source = 'https://garden.test/hackenbush/?seed=ABCDEF&v=5#turn=old';
  assert.equal(readOnlineIntent(source).resumeAllowed, false);
  const invite = roomInviteUrl(source, room.code);
  const url = new URL(invite);
  assert.equal(url.pathname, '/hackenbush/');
  assert.equal(url.origin, new URL(source).origin);
  assert.deepEqual([...url.searchParams], [['room', room.code]]);
  assert.equal(url.hash, '');
  const intent = readOnlineIntent(invite);
  assert.equal(intent.hasRoom, true);
  assert.equal(intent.code, normalizeRoomCode(room.code.toLowerCase()));
  assert.equal((await observer.state()).room, null);

  const joined = await visitor.post('/rooms/join', { code: intent.code });
  const matched = await host.state();
  assert.equal(matched.room, null);
  const opening = matched.match;
  const seats = bothSeats(host, opening, visitor, joined.match);
  assert.equal(opening.rated, false);
  assert.equal(opening.openingAssessment, null);
  assert.equal(opening.version, 0);
  assert.equal(opening.side, opening.firstSide);
  assert.equal(opening.deadline - opening.turnStartsAt, 10_000);
  assert.ok(opening.turnStartsAt > matched.serverNow);
  const board = generateBoard(opening.seed, opening.variant, opening.difficulty, opening.boardVersion);
  assert.deepEqual(opening.live, initialEdges(board));
  const [edge, alternative] = legalMoves(board, opening.live, opening.side);
  const cutter = seats[opening.side];
  const opponent = seats[otherSide(opening.side)];
  await move(cutter, opening, edge, [409]);
  arena.setTime(opening.turnStartsAt + 150);
  await move(opponent, opening, edge, [409]);
  await move(observer, opening, edge, [404]);
  const [accepted, retried] = await Promise.all([move(cutter, opening, edge), move(cutter, opening, edge)]);
  assert.deepEqual(accepted.match.moves, [edge]);
  assert.deepEqual(retried.match.moves, [edge]);
  await move(cutter, opening, alternative, [409]);
  const { match, serverNow } = await opponent.state();
  assert.deepEqual(match.live, cutEdge(board, opening.live, edge, opening.side).live);
  assert.equal(match.version, 1);
  assert.equal(match.deadline, serverNow + 10_000);
  assert.equal(match.side, otherSide(opening.side));

  const resigned = await opponent.post(`/matches/${match.id}/resign`, {});
  assert.equal(resigned.match.result.reason, 'resign');
  assert.equal(resigned.match.result.winner, opening.side);
  assert.deepEqual(resigned.match.result.delta, { blue: 0, red: 0 });
  assert.deepEqual((await cutter.state()).profile.ratings, { green: 1200, redblue: 1200 });
  assert.equal((await opponent.remove(`/matches/${match.id}`)).match, null);
  assert.deepEqual((await cutter.state()).match.result, resigned.match.result);
});

test('ranked players finish the same garden, settle Elo once, and reload after a database restart', async t => {
  const arena = openArena(t, true);
  const [first, second, otherRules] = await Promise.all(['Ash', 'Beech', 'Elm'].map(arena.guest));
  await otherRules.post('/queue', { variant: 'redblue' });
  const waiting = await first.post('/queue', { variant: 'green' });
  assert.equal(waiting.queue.variant, 'green');
  assert.equal(waiting.match, null);
  assert.equal((await first.post('/queue', { variant: 'green' })).match, null);
  const joined = await second.post('/queue', { variant: 'green' });
  const matched = await first.state();
  const seats = bothSeats(first, matched.match, second, joined.match);
  assert.equal(matched.queue, null);
  assert.equal(joined.queue, null);
  assert.equal((await otherRules.state()).queue.variant, 'redblue');
  let match = matched.match;
  assert.equal(match.rated, true);
  const price = originalPrice(match);
  assert.ok(match.openingAssessment.trials < price.trials);
  const board = generateBoard(match.seed, match.variant, match.difficulty, match.boardVersion);
  let lastSide;
  while (!match.result) {
    const edge = legalMoves(board, match.live, match.side)[0];
    assert.ok(edge && match.moves.length < board.edges.length, 'the server allowed play after the last legal cut');
    lastSide = match.side;
    arena.setTime(match.turnStartsAt + 100);
    const before = match;
    ({ match } = await move(seats[lastSide], match, edge));
    assert.deepEqual(match.live, cutEdge(board, before.live, edge, lastSide).live);
    assert.deepEqual(match.moves, [...before.moves, edge]);
    if (before.moves.length === 0) {
      arena.restart();
      const resumed = await arena.client(seats[lastSide].token).state();
      const { openingAssessment, ...position } = resumed.match;
      const { openingAssessment: previous, ...beforeReconnect } = match;
      assert.deepEqual(position, beforeReconnect);
      assert.ok(openingAssessment.trials >= previous.trials);
      assert.equal(resumed.match.deadline, match.deadline);
    }
  }
  assert.equal(match.result.reason, 'no-moves');
  assert.equal(match.result.winner, lastSide);
  assert.deepEqual(match.openingAssessment, { trials: price.trials, ready: true, blueDelta: price.delta });
  assert.deepEqual(match.result.delta, { blue: price.delta[lastSide], red: -price.delta[lastSide] });

  await Promise.all([first, second].map(client => client.post(`/matches/${match.id}/resign`, {})));
  arena.restart();
  for (const side of ['blue', 'red']) {
    const fresh = await arena.client(seats[side].token).state();
    assert.equal(fresh.match.id, match.id);
    assert.deepEqual(fresh.match.result, match.result);
    assert.deepEqual(fresh.profile.ratings, { green: 1200 + match.result.delta[side], redblue: 1200 });
  }
});

test('a server deadline survives reload and simultaneous observations settle a ranked timeout once', async t => {
  const arena = openArena(t);
  const [first, second] = await Promise.all(['Fern', 'Iris'].map(arena.guest));
  await first.post('/queue', { variant: 'redblue' });
  const { match } = await second.post('/queue', { variant: 'redblue' });
  const seats = bothSeats(first, (await first.state()).match, second, match);
  arena.setTime(match.deadline - 1);
  const reloaded = arena.client(seats[match.side].token);
  const running = await reloaded.state();
  assert.equal(running.match.result, null);
  assert.equal(running.match.deadline, match.deadline);
  assert.deepEqual(running.profile.ratings, { green: 1200, redblue: 1200 });
  arena.setTime(match.deadline);
  const price = originalPrice(match);
  const deltaBlue = price.delta[otherSide(match.side)];
  const deltas = { blue: deltaBlue, red: -deltaBlue };
  const views = await Promise.all([first.state(), second.state(), reloaded.state()]);
  for (const view of views) {
    const { result, seat } = view.match;
    assert.equal(result.reason, 'timeout');
    assert.equal(result.winner, otherSide(match.side));
    assert.deepEqual(view.match.moves, []);
    assert.deepEqual(result.delta, deltas);
    assert.deepEqual(view.match.openingAssessment, { trials: price.trials, ready: true, blueDelta: price.delta });
    assert.deepEqual(view.profile.ratings, { green: 1200, redblue: 1200 + deltas[seat] });
  }
  const board = generateBoard(match.seed, match.variant, match.difficulty, match.boardVersion);
  await move(reloaded, match, legalMoves(board, match.live, match.side)[0], [409]);
  assert.deepEqual((await reloaded.state()).profile.ratings, { green: 1200, redblue: 1200 + deltas[match.side] });
});

test('the ranked queue prefers closer Elo and widens the range as players wait', async t => {
  const arena = openArena(t);
  const [older, closer, arrival, distant] = await Promise.all(['Willow', 'Alder', 'Hazel', 'Pine'].map(arena.guest));
  await arena.seedGreenRatings({ Willow: 1105, Alder: 1280, Pine: 1350 });
  const green = { variant: 'green' };
  const { serverNow } = await older.post('/queue', green);
  arena.setTime(serverNow + 1);
  assert.equal((await closer.post('/queue', green)).match, null);
  const nearest = await arrival.post('/queue', green);
  assert.equal(nearest.match.players[otherSide(nearest.match.seat)].name, 'Alder');
  assert.equal((await closer.state()).match.id, nearest.match.id);
  assert.equal((await older.state()).match, null);
  const waiting = await distant.post('/queue', green);
  assert.equal(waiting.match, null);
  arena.setTime(serverNow + 15_100);
  const widened = await older.state();
  assert.equal(widened.match.players[otherSide(widened.match.seat)].name, 'Pine');
  assert.equal((await distant.state()).match.id, widened.match.id);
});

test('canceled and expired tickets cannot match; a room admits one concurrent guest and expires cleanly', async t => {
  const arena = openArena(t);
  const [a, b, c] = await Promise.all(['Larch', 'Maple', 'Oak'].map(arena.guest));
  const green = { variant: 'green' };
  await a.post('/queue', green);
  assert.equal((await a.remove('/queue')).queue, null);
  const waiting = await b.post('/queue', green);
  assert.equal(waiting.match, null);
  arena.setTime(waiting.serverNow + 46_000);
  const fresh = await c.post('/queue', green);
  assert.equal(fresh.match, null);
  assert.equal((await b.state()).queue, null);
  await c.remove('/queue');

  const canceled = await a.post('/rooms', green);
  assert.equal((await a.remove('/rooms')).room, null);
  await b.post('/rooms/join', { code: canceled.room.code }, [404, 410]);
  const expiring = await a.post('/rooms', green);
  arena.setTime(expiring.room.expiresAt + 1);
  await c.post('/rooms/join', { code: expiring.room.code }, [404, 410]);
  assert.equal((await a.state()).room, null);

  const { room } = await a.post('/rooms', green);
  const attempts = await Promise.all([b, c].map(client =>
    client.post('/rooms/join', { code: room.code }, [200, 201, 404, 409, 410])));
  assert.equal(attempts.filter(attempt => attempt.match).length, 1);
  const owner = await a.state();
  const contenders = await Promise.all([b.state(), c.state()]);
  assert.equal(contenders.filter(item => item.match?.id === owner.match.id).length, 1);
  assert.equal(contenders.filter(item => item.match === null).length, 1);
});

test('the ranked server assesses the original without polling and both devices get the same price', async t => {
  const work = [];
  const arena = openArena(t, false, { waitUntil(task) { work.push(task); } });
  const [a, b] = await Promise.all(['Grove', 'Reed'].map(arena.guest));
  await a.post('/queue', { variant: 'redblue' });
  const { match } = await b.post('/queue', { variant: 'redblue' });
  const seats = { [match.seat]: b, [otherSide(match.seat)]: a };
  const board = generateBoard(match.seed, match.variant, match.difficulty, match.boardVersion);
  const [edge] = legalMoves(board, match.live, match.side);
  arena.setTime(match.turnStartsAt);
  const cut = await move(seats[match.side], match, edge);
  assert.deepEqual(cut.match.moves, [edge]);
  assert.ok(work.length > 0);
  await Promise.all(work);
  const original = originalPrice(match), views = await Promise.all([a.state(), b.state()]);
  for (const { match: current } of views) {
    assert.deepEqual(current.openingAssessment, { ready: true, trials: original.trials, blueDelta: original.delta });
    assert.deepEqual(current.moves, [edge]);
    assert.equal(current.deadline, cut.match.deadline);
  }
  const ended = await seats.red.post(`/matches/${match.id}/resign`, {});
  assert.equal(ended.match.result.delta.blue, original.delta.blue);
});

test('restarting reference trials preserves their opening-conditioned award across unrelated move histories', () => {
  const row = { seed: 'A35D7E', variant: 'redblue', first_side: 'red', board_version: 5, blue_rating: 1200, red_rating: 1200 };
  const start = liveOpening(row, 7), all = liveOpening(row, Infinity);
  assert.equal(start.ready, false);
  assert.equal(start.trials, 7);
  assert.ok(all.ready && all.trials > start.trials && all.trials <= 128);
  const resumed = liveOpening({ ...row, opening_trials: start.trials, opening_blue_wins: start.wins,
    side: 'blue', live: [], moves: ['e1', 'e2'] }, Infinity);
  assert.deepEqual(resumed, all);
  const exactAward = wins => Math.round(32 / (1 + 10 ** ((80 * (2 * wins / 128 - 1)) / 400)));
  assert.equal(all.delta.blue, exactAward(all.wins));
  assert.equal(all.delta.blue, exactAward(all.wins + 128 - all.trials));
  assert.notEqual(all.delta.blue, 16);
});
