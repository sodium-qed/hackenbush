import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { legalMoves } from '../dist/js/rules.js';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import {
  TURN_MS, canUndo, createGame, expireTurn, isHumanTurn, matchKey, normalizePlayers,
  playCut, receiveLink, restoreGame, saveData, startTurnClock, undoTurn,
} from '../dist/js/session.js';

function move(game, choice = 0, now = Date.now()) {
  const moves = legalMoves(game.board, game.live, game.side);
  return playCut(startTurnClock(game, now), moves.at(choice), now);
}

test('two people on separate devices complete a match, including refreshes and the final link', () => {
  for (const [boardVersion, variant] of [[5, 'green'], [5, 'redblue'], [4, 'green'], [4, 'redblue'], [3, 'green'], [3, 'redblue'], [2, 'mixed']]) {
    let host = createGame({ seed: boardVersion >= 4 ? '00C0DE' : 'GROVE7', variant, boardVersion, opponent: 'link' });
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
  const first = createGame({ boardVersion: 3, seed: 'GROVE7', opponent: 'link' });
  const host = move(first, -1);
  const same = receiveLink(decodeTurn(encodeTurn(host)), saveData(host));
  assert.equal(same.game.seat, 'blue');
  assert.equal(isHumanTurn(same.game), false);
  const visitor = receiveLink(decodeTurn(encodeTurn(host)), null).game;
  const later = receiveLink(decodeTurn(encodeTurn(move(visitor, -1))), saveData(host)).game;
  const stale = receiveLink(decodeTurn(encodeTurn(host)), saveData(later));
  assert.deepEqual(stale.game.moves, later.moves);
  assert.match(stale.note, /earlier/);
  const other = move(first, 0);
  const fork = receiveLink(decodeTurn(encodeTurn(other)), saveData(later));
  assert.deepEqual(fork.game.moves, later.moves);
  assert.match(fork.note, /different/);
});

test('legacy untimed undo reverses a whole computer turn and handles an unanswered first cut', () => {
  const start = createGame({ boardVersion: 2, seed: 'GROVE7', opponent: 'computer' });
  const waiting = move(start, -1);
  assert.equal(isHumanTurn(waiting), false);
  assert.deepEqual(undoTurn(waiting).moves, []);
  const replied = move(waiting, -1);
  assert.equal(isHumanTurn(replied), true);
  assert.deepEqual(undoTurn(replied).live, start.live);
  const local = createGame({ boardVersion: 2, seed: 'GROVE7' });
  const secondTurn = move(move(local, -1), -1);
  assert.equal(undoTurn(secondTurn).moves.length, 1);
  const linked = move(createGame({ boardVersion: 3, seed: 'GROVE7', opponent: 'link' }));
  assert.equal(undoTurn(linked), linked);
});

test('saved games replay the branch history or reject corrupted progress', () => {
  const start = createGame({ boardVersion: 3, seed: 'GROVE7', variant: 'redblue' });
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
  const start = createGame({ boardVersion: 2, seed: 'GROVE7', difficulty: 'large', opponent: 'computer', firstSide: 'blue',
    players: { blue: { name: 'Cedar', kind: 'computer' }, red: { name: 'Iris', kind: 'human' } } });
  assert.equal(start.boardVersion, 2);
  assert.equal(start.seat, 'red');
  const seatOnly = createGame({ boardVersion: 3, seed: 'GROVE7', opponent: 'computer', seat: 'red' });
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
  const start = createGame({ boardVersion: 3, seed: 'GROVE7', opponent: 'local', firstSide: 'red',
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
  const config = { boardVersion: 3, seed: 'GROVE7', variant: 'redblue', opponent: 'link', firstSide: 'red', seat: 'blue',
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
  const originalLink = '#turn=1.blue.mixed.standard.TEVHQUNZLTE5OQ.c-b-9-a.20c82660';
  const decoded = decodeTurn(originalLink);
  assert.equal(matchKey(saved), matchKey(decoded));
  assert.deepEqual(receiveLink(decoded, saved).game, game);
  assert.equal(encodeTurn(restoreGame(saveData(receiveLink(decoded, saved).game))), originalLink);
  assert.deepEqual(restoreGame(saveData(game)), game);
  const legacySolo = restoreGame({ ...saved, opponent: 'computer', seat: 'blue' });
  assert.equal(legacySolo.players.blue.kind, 'human');
  assert.equal(legacySolo.players.red.kind, 'computer');
  assert.equal(restoreGame({ ...saved, boardVersion: 4 }), null);
});

test('new games are timed Expert matches with independent identities; older formats keep their original settings', () => {
  for (const opponent of ['local', 'computer', 'link']) {
    const config = { seed: 'A07C42', opponent };
    const game = createGame(config);
    assert.equal(game.boardVersion, 5);
    assert.equal(game.difficulty, 'expert');
    assert.equal(game.timed, true);
    assert.equal(game.deadline, null);
    assert.equal(game.timedOut, null);
    assert.ok(game.matchId);
    assert.notEqual(matchKey(game), matchKey(createGame(config)));
    assert.equal(restoreGame(saveData(game)).matchId, game.matchId);
  }
  for (const difficulty of ['small', 'standard', 'large']) {
    assert.throws(() => createGame({ seed: 'A07C42', difficulty }));
    assert.equal(createGame({ seed: 'WATCH', difficulty, boardVersion: 2 }).timed, false);
  }
  assert.throws(() => createGame({ seed: 'A07C42', variant: 'mixed' }));
  assert.throws(() => createGame({ seed: 'A07C42', timed: false }));
  for (const boardVersion of [1, 2]) {
    assert.throws(() => createGame({ seed: 'WATCH', difficulty: 'expert', boardVersion }));
    const classic = createGame({ seed: 'WATCH', variant: 'mixed', boardVersion });
    assert.equal(startTurnClock(classic, 12345), classic);
    const { timed, deadline, timedOut, ...oldSave } = saveData(classic);
    assert.deepEqual(restoreGame(oldSave), classic);
    assert.notEqual(matchKey(oldSave), matchKey({ ...oldSave, timed: true }));
  }
});

test('restoring a saved generation 3 Expert match reproduces its graph, moves, and pending deadline', () => {
  const saved = { seed: 'gRoVe 🌱/旧', variant: 'redblue', difficulty: 'expert', opponent: 'link', seat: 'blue',
    firstSide: 'red', boardVersion: 3, players: { blue: { name: 'Jun 🌿', kind: 'human' }, red: { name: 'Renée / J.', kind: 'human' } },
    moves: ['e97', 'e94', 'e96'], timed: true, deadline: 50_000, timedOut: null, matchId: 'historic_v3' };
  const game = restoreGame(saved, 49_999);
  assert.deepEqual(saveData(game), saved);
  assert.equal(game.side, 'blue');
  assert.equal(game.board.edges.length, 98);
  assert.equal(game.live.length, 95);
  assert.equal(createHash('sha256').update(JSON.stringify(game.board)).digest('hex'),
    'cd78e98aad0f3cd58627303fcd75e404154c26ac82803e1dfd3fbaf4318dd417');
  assert.equal(createHash('sha256').update(JSON.stringify(game.live)).digest('hex'),
    'd170d15f4c46b29c00505c43087a417e230990191076c550e309c641e19b93e1');
  assert.equal(restoreGame(saved, 50_000).timedOut, 'blue');
  assert.equal(restoreGame({ ...saved, boardVersion: 4 }, 49_999), null);
});

test('a hex map survives two seats, a midgame reload, and a shared timeout', () => {
  const host = createGame({ seed: '0000af', variant: 'redblue', opponent: 'link', seat: 'red', firstSide: 'red', matchId: 'hex-table' });
  assert.equal(host.seed, '0000AF');
  assert.equal(host.boardVersion, 5);
  const first = move(host, -1, 10_000);
  const guest = receiveLink(decodeTurn(encodeTurn(first)), null, 100_000).game;
  assert.deepEqual(guest.board, host.board);
  const second = move(guest, -1, 100_000);
  const returned = receiveLink(decodeTurn(encodeTurn(second)), saveData(first), 200_000).game;
  const armed = startTurnClock(returned, 200_000);
  const saved = JSON.parse(JSON.stringify(saveData(armed)));
  assert.deepEqual(saved.moves, [...first.moves, second.moves[1]]);
  assert.equal(saved.seed, '0000AF');
  const lowercaseSave = { ...saved, seed: '0000af' };
  assert.equal(matchKey(lowercaseSave), matchKey(saved));
  const resumed = restoreGame(lowercaseSave, 209_999);
  assert.deepEqual(resumed, armed);
  assert.equal(resumed.deadline, 210_000);
  const expired = restoreGame(saved, 210_000);
  const final = decodeTurn(encodeTurn(expired));
  assert.equal(final.wireVersion, 3);
  assert.equal(final.boardVersion, 5);
  assert.equal(final.seed, '0000AF');
  assert.equal(final.timedOut, 'red');
  assert.equal(final.winner, 'blue');
  assert.deepEqual(final.moves, saved.moves);
  assert.equal(receiveLink(final, saveData(second), 900_000).game.victor, 'blue');
  assert.notEqual(matchKey(saved), matchKey({ ...saved, boardVersion: 3 }));
  assert.equal(restoreGame({ ...saved, seed: 'ZZZZZZ' }, 200_001), null);
  assert.throws(() => createGame({ seed: 'ABCDF' }));
});

test('a scheduled first turn admits cuts from its reveal through the last millisecond before expiry', () => {
  const game = createGame({ boardVersion: 3, seed: 'CUT-OFF' });
  const edge = legalMoves(game.board, game.live, game.side).at(-1);
  const reveal = 100_000;
  assert.equal(TURN_MS, 10_000);
  assert.equal(playCut(game, edge, reveal), null);
  const clock = startTurnClock(game, reveal);
  assert.equal(game.deadline, null);
  assert.equal(clock.deadline, reveal + TURN_MS);
  assert.equal(startTurnClock(clock, reveal + 6_000), clock);
  assert.equal(playCut(clock, edge, reveal - 1), null);
  assert.ok(playCut(clock, edge, reveal));
  const cut = playCut(clock, edge, clock.deadline - 1);
  assert.deepEqual(cut.moves, [edge]);
  assert.equal(cut.deadline, null);
  assert.equal(canUndo(cut), false);
  assert.equal(undoTurn(cut), cut);
  assert.equal(expireTurn(clock, clock.deadline - 1), clock);
  assert.equal(playCut(clock, edge, clock.deadline), null);
  assert.equal(playCut(clock, edge, clock.deadline + 86_400_000), null);
  const expired = expireTurn(clock, clock.deadline);
  assert.equal(expired.timedOut, 'blue');
  assert.equal(expired.victor, 'red');
  assert.equal(expired.deadline, null);
  assert.deepEqual(expired.moves, []);
  assert.deepEqual(expired.live, game.live);
  assert.equal(isHumanTurn(expired), false);
  assert.equal(expireTurn(expired, clock.deadline + 1), expired);
  assert.equal(startTurnClock(expired, clock.deadline + 1), expired);
});

test('reload keeps the absolute deadline and resolves a clock that expired while the page was closed', () => {
  const armed = startTurnClock(createGame({ boardVersion: 3, seed: 'RELOAD', firstSide: 'red' }), 200_000);
  const saved = JSON.parse(JSON.stringify(saveData(armed)));
  for (const now of [199_000, 200_001, armed.deadline - 1]) {
    const resumed = restoreGame(saved, now);
    assert.equal(resumed.deadline, armed.deadline);
    assert.equal(startTurnClock(resumed, now).deadline, armed.deadline);
    assert.equal(resumed.victor, null);
  }
  const result = restoreGame(saved, armed.deadline + 86_400_000);
  assert.equal(result.victor, 'blue');
  assert.equal(result.timedOut, 'red');
  assert.equal(result.deadline, null);
  assert.deepEqual(restoreGame(saveData(result), armed.deadline + 2 * 86_400_000), result);
  for (const deadline of ['210000', -1, 4.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(restoreGame({ ...saved, deadline }, 200_500), null);
  }
  for (const metadata of [{ timed: false }, { timedOut: 'red' }, { deadline: null, timedOut: 'blue' },
    { opponent: 'link', seat: 'blue' }]) {
    assert.equal(restoreGame({ ...saved, ...metadata }, 200_500), null);
  }
  const old = createGame({ boardVersion: 2, seed: 'RELOAD' });
  assert.equal(restoreGame({ ...saveData(old), deadline: armed.deadline }, 200_500), null);
});

test('computers on either color receive and lose the same ten-second turn as a human', () => {
  for (const firstSide of ['blue', 'red']) {
    const start = createGame({ boardVersion: 3, seed: 'CPU-CLOCK', firstSide, opponent: 'computer',
      players: { blue: { kind: 'computer' }, red: { kind: 'computer' } } });
    assert.equal(isHumanTurn(start), false);
    const opening = startTurnClock(start, 300_000);
    const next = move(opening, -1, opening.deadline - 1);
    assert.equal(next.deadline, null);
    const second = startTurnClock(next, opening.deadline - 1);
    assert.equal(second.deadline, opening.deadline - 1 + TURN_MS);
    const edge = legalMoves(second.board, second.live, second.side)[0];
    assert.equal(playCut(second, edge, second.deadline), null);
    const expired = expireTurn(second, second.deadline + 60_000);
    assert.equal(expired.timedOut, second.side);
    assert.equal(expired.victor, firstSide);
    assert.deepEqual(expired.moves, next.moves);
  }
});

test('an invitation and a turn in transit consume no time; reopening an active incoming turn keeps its deadline', () => {
  const host = createGame({ boardVersion: 3, seed: 'HANDOFF', opponent: 'link', firstSide: 'red', seat: 'blue' });
  assert.equal(startTurnClock(host, 401_000), host);
  const invite = decodeTurn(encodeTurn(host));
  const received = receiveLink({ ...invite, deadline: 401_000 }, null, 900_000).game;
  assert.equal(received.seat, 'red');
  assert.equal(received.deadline, null);
  const own = startTurnClock(received, 900_000);
  const saved = saveData(own);
  const reloaded = receiveLink(invite, saved, own.deadline - 2_000).game;
  assert.equal(reloaded.deadline, own.deadline);
  assert.equal(reloaded.timedOut, null);
  const cut = move(reloaded, -1, own.deadline - 1);
  assert.equal(startTurnClock(cut, own.deadline), cut);
  const reply = decodeTurn(encodeTurn(cut));
  const delivered = receiveLink(reply, saveData(host), 1_500_000).game;
  assert.equal(delivered.seat, 'blue');
  assert.equal(delivered.deadline, null);
  assert.equal(startTurnClock(delivered, 1_500_000).deadline, 1_510_000);
  const expired = receiveLink(invite, saved, own.deadline).game;
  assert.equal(expired.timedOut, 'red');
  assert.equal(expired.victor, 'blue');
});

test('timeout results beat competing later cuts on the same branch in either arrival order', () => {
  const host = startTurnClock(createGame({ boardVersion: 3, seed: 'RACE', opponent: 'link' }), 500_000);
  const timeout = expireTurn(host, host.deadline);
  const resultLink = decodeTurn(encodeTurn(timeout));
  const competing = move(host, -1, host.deadline - 1);
  const moveLink = decodeTurn(encodeTurn(competing));
  const after = host.deadline + 2_000;
  for (const local of [host, timeout]) {
    const result = receiveLink(moveLink, saveData(local), after).game;
    assert.equal(result.timedOut, 'blue');
    assert.equal(result.seat, 'blue');
    assert.deepEqual(result.moves, []);
  }
  const arrivingLate = receiveLink(resultLink, saveData(competing), after).game;
  assert.equal(arrivingLate.timedOut, 'blue');
  assert.deepEqual(arrivingLate.moves, []);
  const visitor = receiveLink(resultLink, null, after).game;
  assert.equal(visitor.seat, 'red');
  assert.equal(visitor.victor, 'red');
  assert.equal(isHumanTurn(visitor), false);
  const replay = receiveLink(decodeTurn(encodeTurn(host)), saveData(visitor), after).game;
  assert.deepEqual(replay, visitor);
});
