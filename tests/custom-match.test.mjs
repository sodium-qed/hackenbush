import test from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_BOARD_VERSION, writeCustomBoard } from '../dist/js/custom-board.js';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { createGame, expireTurn, matchKey, playCut, receiveLink, restoreGame, saveData, startTurnClock } from '../dist/js/session.js';

const design = [
  { a: 0, b: 10, color: 'blue' },
  { a: 10, b: 20, color: 'red' },
  { a: 4, b: 13, color: 'red' },
];
const seed = writeCustomBoard('redblue', 'Three branches', design);
const config = { boardVersion: CUSTOM_BOARD_VERSION, seed, variant: 'redblue', firstSide: 'blue' };

test('built boards preserve their graph, fallen branches and result through two devices and a reload', () => {
  const host = startTurnClock(createGame({ ...config, opponent: 'link', seat: 'blue' }), 40_000);
  const first = playCut(host, host.board.edges[0].id, 40_001);
  assert.equal(first.live.length, 1);
  assert.deepEqual(first.rows[0].fallen, ['e2']);
  const offer = decodeTurn(encodeTurn(first));
  const guest = startTurnClock(receiveLink(offer).game, 52_000);
  assert.equal(guest.board.family, 'Three branches');
  assert.equal(guest.seat, 'red');
  assert.deepEqual(guest.board, host.board);
  const final = playCut(guest, guest.live[0], 52_100);
  const result = receiveLink(decodeTurn(encodeTurn(final)), saveData(first));
  assert.equal(result.game.victor, 'red');
  assert.deepEqual(restoreGame(saveData(result.game)).rows, final.rows);
  assert.equal(matchKey(host), matchKey(result.game));
});

test('a timeout can be shared on a custom board with no cuts, and mismatched boards are rejected', () => {
  const host = startTurnClock(createGame({ ...config, opponent: 'link', seat: 'blue' }), 90_000);
  const timeout = expireTurn(host, 100_000);
  const guest = receiveLink(decodeTurn(encodeTurn(timeout))).game;
  assert.equal(guest.timedOut, 'blue');
  assert.equal(guest.live.length, 3);
  assert.equal(guest.seed, seed);
  assert.throws(() => createGame({ ...config, variant: 'green' }));
  assert.equal(restoreGame({ ...saveData(host), seed: seed + '!' }), null);
  assert.notEqual(matchKey(host), matchKey({ ...host, seed: writeCustomBoard('redblue', '', design.slice(0, 1)) }));
});
