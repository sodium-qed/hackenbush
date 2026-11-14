import test from 'node:test';
import assert from 'node:assert/strict';
import { legalMoves } from '../dist/js/rules.js';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { createGame, isHumanTurn, playCut, receiveLink, restoreGame, saveData, undoTurn } from '../dist/js/session.js';

function move(game, choice = 0) {
  const moves = legalMoves(game.board, game.live, game.side);
  return playCut(game, moves.at(choice));
}

test('two people on separate devices complete a match, including refreshes and the final link', () => {
  for (const variant of ['green', 'redblue', 'mixed']) {
    let host = createGame({ seed: 'GROVE7', variant, opponent: 'link' });
    let guest = null;
    let active = host;
    while (!active.victor) {
      assert.equal(isHumanTurn(active), true);
      const next = move(active, -1);
      assert.ok(next);
      assert.equal(isHumanTurn(next), false);
      const link = decodeTurn(encodeTurn(next));
      if (active.seat === 'blue') {
        host = restoreGame(saveData(next));
        guest = receiveLink(link, guest && saveData(guest)).game;
        assert.equal(host.seat, 'blue');
        assert.equal(guest.seat, 'red');
        active = guest;
      } else {
        guest = restoreGame(saveData(next));
        host = receiveLink(link, saveData(host)).game;
        active = host;
      }
      assert.deepEqual(host.live, guest.live);
      assert.deepEqual(host.rows, guest.rows);
      assert.equal(host.victor, guest.victor);
    }
    assert.equal(isHumanTurn(host), false);
    assert.equal(isHumanTurn(guest), false);
  }
});

test('opening an older, outgoing or diverging link preserves the local seat and latest moves', () => {
  const first = createGame({ seed: 'GROVE7', opponent: 'link' });
  const host = move(first, -1);
  const same = receiveLink(decodeTurn(encodeTurn(host)), saveData(host));
  assert.equal(same.game.seat, 'blue');
  assert.equal(isHumanTurn(same.game), false);
  const later = move(host, -1);
  const stale = receiveLink(decodeTurn(encodeTurn(host)), saveData(later));
  assert.deepEqual(stale.game.moves, later.moves);
  assert.match(stale.note, /earlier/);
  const other = move(first, 0);
  const fork = receiveLink(decodeTurn(encodeTurn(other)), saveData(later));
  assert.deepEqual(fork.game.moves, later.moves);
  assert.match(fork.note, /different/);
});

test('undo against the computer reverses a whole turn and handles an unanswered first cut', () => {
  const start = createGame({ seed: 'GROVE7', opponent: 'computer' });
  const waiting = move(start, -1);
  assert.equal(isHumanTurn(waiting), false);
  assert.deepEqual(undoTurn(waiting).moves, []);
  const replied = move(waiting, -1);
  assert.equal(isHumanTurn(replied), true);
  assert.deepEqual(undoTurn(replied).live, start.live);
  const local = createGame({ seed: 'GROVE7' });
  const secondTurn = move(move(local, -1), -1);
  assert.equal(undoTurn(secondTurn).moves.length, 1);
  const linked = move(createGame({ seed: 'GROVE7', opponent: 'link' }));
  assert.equal(undoTurn(linked), linked);
});

test('saved games replay the branch history or reject corrupted progress', () => {
  const start = createGame({ seed: 'GROVE7', variant: 'mixed' });
  const next = move(start);
  assert.deepEqual(restoreGame(saveData(next)).rows, next.rows);
  assert.equal(restoreGame({ ...saveData(next), moves: ['nonexistent'] }), null);
  assert.equal(restoreGame({ ...saveData(next), difficulty: 'unknown' }), null);
  assert.equal(restoreGame(null), null);
});
