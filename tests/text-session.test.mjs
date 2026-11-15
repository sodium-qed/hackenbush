import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { TEXT_BOARD_VERSION } from '../dist/js/map-seed.js';
import { legalMoves, otherSide } from '../dist/js/rules.js';
import { TURN_MS, createGame, expireTurn, matchKey, playCut, receiveLink, restoreGame, saveData, startTurnClock } from '../dist/js/session.js';

const text = { boardVersion: TEXT_BOARD_VERSION, seed: '  Cafe\u0301 /#? 🌱  ' };
const daily = { boardVersion: TEXT_BOARD_VERSION, seed: 'DAILY-02-29-2028', opponent: 'computer' };

// Give an independently altered seed a valid CRC so the decoder reaches seed validation.
function turnWithSeed(hash, seed) {
  const fields = hash.slice('#turn='.length).split('.').slice(0, -1);
  fields[4] = Buffer.from(seed).toString('base64url');
  const payload = fields.join('.');
  let crc = -1;
  for (const byte of Buffer.from(payload)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return '#turn=' + payload + '.' + ((~crc) >>> 0).toString(16).padStart(8, '0');
}

test('a text seed retains its spelling, board and match identity across a turn link and reload', () => {
  const host = createGame({ ...text, opponent: 'link', firstSide: 'red', seat: 'blue', matchId: 'word-garden',
    players: { red: { name: 'Iris' }, blue: { name: 'Rowan' } } });
  const invitation = encodeTurn(host);
  const decoded = decodeTurn(invitation);
  assert.equal(host.seed, 'Café /#? 🌱');
  assert.equal(decoded.seed, host.seed);
  assert.equal(decoded.boardVersion, 7);
  assert.equal(decoded.wireVersion, 3);
  assert.deepEqual(decoded.board, host.board);
  assert.equal(encodeTurn(decoded), invitation);
  assert.equal(matchKey(host), matchKey({ ...host, seed: text.seed }));
  assert.notEqual(matchKey(host), matchKey({ ...host, seed: host.seed.toLowerCase() }));
  assert.notEqual(matchKey(host), matchKey({ ...host, boardVersion: 3 }));

  const visitor = startTurnClock(receiveLink(decoded).game, 100_000);
  assert.equal(visitor.seat, 'red');
  const cut = playCut(visitor, legalMoves(visitor.board, visitor.live, visitor.side).at(-1), 100_001);
  const reply = receiveLink(decodeTurn(encodeTurn(cut)), saveData(host)).game;
  assert.equal(reply.seat, 'blue');
  assert.deepEqual(reply.rows, cut.rows);
  assert.deepEqual(reply.players, host.players);
  assert.equal(matchKey(reply), matchKey(host));
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(saveData(reply)))), reply);
});

test('the full four-byte text seed fits in a turn link, and malformed or reserved inputs fail on import', () => {
  const seed = '🌱'.repeat(64);
  const game = createGame({ ...text, seed, opponent: 'link' });
  const hash = encodeTurn(game);
  assert.equal(decodeTurn(hash).seed, seed);
  assert.equal(turnWithSeed(hash, seed), hash);
  for (const invalid of ['', '   ', seed + 'a', '\nfern', 'fern\u0000', 'onceDAILYonly',
    'dAiLy-02-29-2028', ' DAILY-02-29-2028 ', 'DAILY-02-30-2028', daily.seed]) {
    assert.throws(() => createGame({ ...text, seed: invalid }));
    assert.equal(restoreGame({ ...saveData(game), seed: invalid }), null);
    assert.throws(() => encodeTurn({ ...game, seed: invalid }));
    assert.equal(decodeTurn(turnWithSeed(hash, invalid)), null);
  }
  assert.equal(receiveLink({ ...decodeTurn(hash), seed: daily.seed }).game, null);
  assert.throws(() => createGame({ ...text, seed: '\ud800' }));
  assert.throws(() => createGame({ ...text, timed: false }));
  assert.throws(() => encodeTurn({ ...game, variant: 'mixed' }));
});

test('a saved daily duel restores its original date, controllers, difficulty and pending turn', () => {
  for (const [variant, seat, firstSide, level] of [
    ['green', 'red', 'blue', 'easy'], ['redblue', 'blue', 'red', 'standard'], ['redblue', 'red', 'red', 'expert'],
  ]) {
    const computer = otherSide(seat);
    const players = { [seat]: { kind: 'human', name: 'Iris' }, [computer]: { kind: 'computer', name: 'Fern', level } };
    const opening = startTurnClock(createGame({ ...daily, variant, seat, firstSide, players }), 200_000);
    const edge = legalMoves(opening.board, opening.live, firstSide).at(-1);
    const next = startTurnClock(playCut(opening, edge, 200_100), 200_100);
    const saved = JSON.parse(JSON.stringify(saveData(next)));
    assert.equal(saved.seed, daily.seed);
    assert.deepEqual(saved.players, players);
    assert.equal(saved.seat, seat);
    assert.equal(saved.firstSide, firstSide);
    assert.deepEqual(restoreGame(saved, 200_101), next);
    assert.notEqual(matchKey(next), matchKey({ ...next, seed: 'DAILY-03-01-2028' }));
    assert.throws(() => encodeTurn({ ...next, players: undefined }));
    for (const changes of [
      { opponent: 'link' }, { opponent: 'local' }, { seat: computer },
      { players: { red: { kind: 'human' }, blue: { kind: 'human' } } },
      { players: { red: { kind: 'computer' }, blue: { kind: 'computer' } } },
      { seed: 'DAILY-02-29-2027' }, { seed: 'daily-02-29-2028' }, { seed: daily.seed + ' ' },
    ]) assert.equal(restoreGame({ ...saved, ...changes }, 200_101), null);
  }
});

test('returning to a daily computer turn resumes the move, while the human clock still expires', () => {
  for (const seat of ['blue', 'red']) {
    const opening = startTurnClock(createGame({ ...daily, seat, firstSide: seat }), 30_000);
    const firstCut = legalMoves(opening.board, opening.live, opening.side).at(-1);
    const pending = startTurnClock(playCut(opening, firstCut, 30_001), 30_001);
    assert.equal(pending.side, otherSide(seat));
    const saved = saveData(pending);
    assert.equal(restoreGame({ ...saved, deadline: null, timedOut: pending.side }), null);
    assert.equal(expireTurn(pending, pending.deadline - 1), pending);

    for (const now of [pending.deadline, pending.deadline + 86_400_000]) {
      const resumed = expireTurn(pending, now);
      assert.deepEqual(resumed, { ...pending, deadline: now + TURN_MS });
      assert.deepEqual(restoreGame(saved, now), resumed);
      assert.equal(expireTurn(resumed, now + 1), resumed);

      const reply = legalMoves(resumed.board, resumed.live, resumed.side).at(-1);
      const human = startTurnClock(playCut(resumed, reply, now + 1), now + 1);
      const lost = expireTurn(human, human.deadline);
      assert.equal(lost.timedOut, seat);
      assert.equal(lost.victor, otherSide(seat));
      assert.deepEqual(restoreGame(saveData(human), human.deadline), lost);
      assert.deepEqual(restoreGame(saveData(lost), human.deadline), lost);
    }
  }
});

test('computer timeouts retain their original result on ordinary text and historical date-like boards', () => {
  for (const config of [{ ...daily, seed: 'Orchard' }, { ...daily, boardVersion: 3 }]) {
    const opening = startTurnClock(createGame({ ...config, seat: 'red', firstSide: 'blue' }), 30_000);
    const lost = expireTurn(opening, opening.deadline);
    assert.equal(lost.timedOut, 'blue');
    assert.equal(lost.victor, 'red');
    assert.deepEqual(restoreGame(saveData(opening), opening.deadline), lost);
    assert.deepEqual(restoreGame(saveData(lost), opening.deadline), lost);
  }
});

test('earlier free-form links keep their original seed bytes and hex generators keep their validation', () => {
  const original = '  MyDaily/Cafe\u0301  ';
  for (const boardVersion of [1, 2, 3]) {
    const game = createGame({ seed: original, boardVersion, opponent: 'link' });
    assert.equal(game.seed, original);
    assert.deepEqual(restoreGame(saveData(game)), game);
    const hash = encodeTurn(game);
    const decoded = decodeTurn(hash);
    assert.equal(decoded.seed, original);
    assert.equal(encodeTurn(decoded), hash);
  }
  for (const boardVersion of [4, 5]) {
    assert.throws(() => createGame({ seed: original, boardVersion }));
    const hex = createGame({ seed: '00abcf', boardVersion });
    assert.equal(hex.seed, '00ABCF');
    assert.equal(decodeTurn(encodeTurn(hex)).boardVersion, boardVersion);
  }
});
