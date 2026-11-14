import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { legalMoves } from '../dist/js/rules.js';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { canUndo, createGame, isHumanTurn, matchKey, normalizePlayers, playCut, receiveLink, restoreGame, saveData, undoTurn } from '../dist/js/session.js';

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

test('names preserve Unicode, count code points, and fall back according to seat and controller', () => {
  const seats = normalizePlayers({
    blue: { name: ' \tMira\u2066  \u0001\u00a0🌲👩‍🔬\u2069  ', kind: 'computer' },
    red: { name: '🌿'.repeat(26), kind: 'human' },
  }, 'red', 'local');
  assert.deepEqual(seats.blue, { name: 'Mira 🌲👩‍🔬', kind: 'computer' });
  assert.equal(seats.red.name, '🌿'.repeat(24));
  assert.deepEqual(normalizePlayers(seats, 'red', 'local'), seats);
  assert.deepEqual(normalizePlayers({ blue: { name: ' \u202e ', kind: 'computer' } }, 'red', 'link'), {
    blue: { name: 'Player 2', kind: 'human' }, red: { name: 'Player 1', kind: 'human' },
  });
  assert.deepEqual(normalizePlayers(undefined, 'red', 'computer'), {
    blue: { name: 'Computer', kind: 'computer' }, red: { name: 'Player 1', kind: 'human' },
  });
  assert.deepEqual(normalizePlayers({ blue: { kind: 'computer' }, red: { kind: 'computer' } }, 'red', 'local'), {
    blue: { name: 'Computer 2', kind: 'computer' }, red: { name: 'Computer 1', kind: 'computer' },
  });
  assert.equal(normalizePlayers({ red: { name: 'N\ud800' } }).red.name, 'N\ufffd');
});

test('a human on Red can play second and take back a turn without undoing the computer opening', () => {
  const start = createGame({ seed: 'GROVE7', difficulty: 'large', opponent: 'computer', firstSide: 'blue',
    players: { blue: { name: 'Cedar', kind: 'computer' }, red: { name: 'Iris', kind: 'human' } } });
  assert.equal(start.boardVersion, 2);
  assert.equal(start.seat, 'red');
  const seatOnly = createGame({ seed: 'GROVE7', opponent: 'computer', seat: 'red' });
  assert.equal(seatOnly.players.blue.kind, 'computer');
  assert.equal(seatOnly.players.red.name, 'Player 2');
  assert.equal(isHumanTurn(start), false);
  assert.equal(canUndo(start), false);
  const opening = move(start, -1);
  assert.equal(isHumanTurn(opening), true);
  assert.equal(canUndo(opening), false);
  assert.equal(undoTurn(opening), opening);
  const humanCut = move(opening, -1);
  assert.equal(isHumanTurn(humanCut), false);
  assert.equal(canUndo(humanCut), true);
  assert.deepEqual(undoTurn(humanCut), opening);
  const reply = move(humanCut, -1);
  assert.equal(isHumanTurn(reply), true);
  assert.deepEqual(undoTurn(reply), opening);
  assert.deepEqual(restoreGame(JSON.parse(JSON.stringify(saveData(reply)))), reply);
});

test('Red can open and either or both local seats can be computer controlled', () => {
  const start = createGame({ seed: 'GROVE7', opponent: 'local', firstSide: 'red',
    players: { blue: { kind: 'human' }, red: { kind: 'computer' } } });
  assert.equal(start.side, 'red');
  assert.equal(start.seat, 'blue');
  assert.equal(isHumanTurn(start), false);
  const reply = move(start, -1);
  assert.equal(reply.rows[0].side, 'red');
  assert.equal(isHumanTurn(reply), true);
  const exhibition = createGame({ ...saveData(start), players: { blue: { kind: 'computer' }, red: { kind: 'computer' } } });
  const played = move(move(exhibition, -1), -1);
  assert.equal(isHumanTurn(played), false);
  assert.equal(canUndo(played), false);
  assert.equal(undoTurn(played), played);
});

test('a second-seated organizer can invite Red to open and exchange named turns across devices', () => {
  const config = { seed: 'GROVE7', variant: 'mixed', opponent: 'link', firstSide: 'red', seat: 'blue',
    players: { blue: { name: 'Mina', kind: 'human' }, red: { name: 'Aki 🌲', kind: 'human' } } };
  const organizer = createGame(config);
  const invitation = decodeTurn(encodeTurn(organizer));
  assert.equal(isHumanTurn(organizer), false);
  assert.equal(invitation.side, 'red');
  assert.equal(invitation.moves.length, 0);
  assert.equal(receiveLink({ ...invitation, side: 'blue' }, null).game, null);
  assert.equal(invitation.matchId, organizer.matchId);
  assert.equal(matchKey(invitation), matchKey(organizer));
  assert.equal(receiveLink(invitation, saveData(organizer)).game.seat, 'blue');
  const invited = receiveLink(invitation, null).game;
  assert.equal(invited.seat, 'red');
  assert.equal(isHumanTurn(invited), true);
  assert.deepEqual(invited.players, organizer.players);
  const first = move(invited, -1);
  assert.equal(canUndo(first), false);
  const returned = receiveLink(decodeTurn(encodeTurn(first)), saveData(organizer)).game;
  assert.equal(returned.seat, 'blue');
  assert.equal(isHumanTurn(returned), true);
  const second = move(returned, -1);
  const delivered = receiveLink(decodeTurn(encodeTurn(second)), saveData(first)).game;
  assert.equal(delivered.seat, 'red');
  assert.deepEqual(delivered.rows, second.rows);
  assert.deepEqual(delivered.players, config.players);
  const stale = receiveLink(invitation, saveData(delivered));
  assert.match(stale.note, /earlier/);
  assert.deepEqual(stale.game, delivered);
  const fresh = createGame(config);
  assert.ok(fresh.matchId);
  assert.notEqual(fresh.matchId, organizer.matchId);
  const separate = receiveLink(decodeTurn(encodeTurn(fresh)), saveData(delivered));
  assert.equal(separate.note, '');
  assert.equal(separate.game.matchId, fresh.matchId);
  assert.deepEqual(separate.game.moves, []);
});

test('identity separates named seats, starting colors and generator versions even when an identifier is absent', () => {
  const config = { seed: 'SHARED', variant: 'green', difficulty: 'small', firstSide: 'red', boardVersion: 2,
    players: { blue: { name: 'Mina' }, red: { name: 'Aki' } } };
  assert.notEqual(matchKey(config), matchKey({ ...config, players: { blue: { name: 'Bea' }, red: { name: 'Aki' } } }));
  assert.notEqual(matchKey(config), matchKey({ ...config, firstSide: 'blue' }));
  assert.notEqual(matchKey(config), matchKey({ ...config, boardVersion: 1 }));
  assert.notEqual(matchKey(config), matchKey({ ...config, players: { ...config.players, blue: { name: 'Mina', kind: 'computer' } } }));
  const decoded = decodeTurn(encodeTurn({ ...config, moves: [] }));
  const joined = receiveLink(decoded, null).game;
  assert.equal(joined.matchId, undefined);
  assert.equal(matchKey(joined), matchKey(config));
  assert.equal(restoreGame(saveData(joined)).matchId, undefined);
});

test('unversioned saved positions and published v1 links replay the original graph and seat assignments', () => {
  const saved = { seed: 'LEGACY-199', variant: 'mixed', difficulty: 'standard', opponent: 'link',
    seat: 'red', moves: ['e12', 'e11', 'e9', 'e10'] };
  const game = restoreGame(saved);
  assert.equal(game.boardVersion, 1);
  assert.equal(game.firstSide, 'blue');
  assert.equal(game.side, 'blue');
  assert.equal(game.matchId, undefined);
  assert.equal(game.seat, 'red');
  assert.deepEqual(game.live, ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  const snapshot = [game.board.nodes.map(node => [node.id, node.x, node.y, Boolean(node.ground)]),
    game.board.edges.map(edge => [edge.id, edge.a, edge.b, edge.color])];
  assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    '555f1345c390ce6a94b4f96aba61a357d6b035ccf9eb18d1ddbd8e01c8748de1');
  const decoded = decodeTurn('#turn=1.blue.mixed.standard.TEVHQUNZLTE5OQ.c-b-9-a.20c82660');
  assert.equal(matchKey(saved), matchKey(decoded));
  assert.deepEqual(receiveLink(decoded, saved).game, game);
  assert.deepEqual(restoreGame(saveData(game)), game);
  const legacySolo = restoreGame({ ...saved, opponent: 'computer', seat: 'blue' });
  assert.equal(legacySolo.players.blue.kind, 'human');
  assert.equal(legacySolo.players.red.kind, 'computer');
  assert.equal(restoreGame({ ...saved, boardVersion: 3 }), null);
});
