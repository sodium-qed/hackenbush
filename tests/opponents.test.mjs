import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSeats } from '../dist/js/draw.js';
import { chooseComputerMove, computerLevelLabel } from '../dist/js/opponents.js';
import { cutEdge, initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';
import { createGame, restoreGame, saveData } from '../dist/js/session.js';
import { decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { chooseMove } from '../dist/js/strategy.js';

function stalks(stems) {
  const nodes = [{ id: 'ground', ground: true }];
  const edges = [];
  for (const [name, colors] of Object.entries(stems)) {
    let a = 'ground';
    for (const [index, color] of colors.entries()) {
      const b = name + '-' + (index + 1);
      nodes.push({ id: b });
      edges.push({ id: b, a, b, color });
      a = b;
    }
  }
  return { nodes, edges };
}

test('Easy can draw every legal standing edge on either side', t => {
  const board = stalks({ blue: ['blue', 'red'], red: ['red'], shared: ['green'], fallen: ['blue', 'blue'] });
  const live = cutEdge(board, initialEdges(board), 'fallen-1', 'blue').live;
  const random = t.mock.method(Math, 'random');
  for (const side of ['blue', 'red']) {
    const legal = legalMoves(board, live, side);
    for (const [index, id] of legal.entries()) {
      random.mock.mockImplementation(() => (index + 0.5) / legal.length);
      assert.deepEqual(chooseComputerMove(board, live, side, 'easy'), { edgeId: id, proven: false, winning: null });
    }
  }
});

test('Standard takes immediate wins and avoids an immediate winning reply', () => {
  for (const side of ['blue', 'red']) {
    const other = otherSide(side);
    const winning = stalks({ unrelated: [side], support: [side, other, other] });
    assert.deepEqual(chooseComputerMove(winning, initialEdges(winning), side, 'standard'),
      { edgeId: 'support-1', proven: true, winning: true });

    const trap = stalks({ home: [side], vulnerable: [other, side, side] });
    const choice = chooseComputerMove(trap, initialEdges(trap), side, 'standard');
    assert.equal(choice.edgeId, 'vulnerable-3');
    assert.equal(choice.winning, null);

    const shared = stalks({ short: ['green'], tall: ['green', 'green'] });
    assert.equal(chooseComputerMove(shared, initialEdges(shared), side, 'standard').edgeId, 'tall-2');
  }
});

test('Expert retains the solver and can find a longer winning line than Standard', () => {
  const board = stalks({ one: ['green'], two: Array(2).fill('green'), four: Array(4).fill('green') });
  const live = initialEdges(board);
  const expert = chooseMove(board, live, 'blue');
  assert.equal(expert.winning, true);
  for (const level of ['expert', undefined, null, 'unknown', 'constructor']) {
    assert.deepEqual(chooseComputerMove(board, live, 'blue', level), expert);
    assert.equal(computerLevelLabel(level), 'Expert');
  }
  const standard = chooseComputerMove(board, live, 'blue', 'standard');
  assert.equal(chooseMove(board, cutEdge(board, live, standard.edgeId, 'blue').live, 'red').winning, true);
  assert.equal(chooseMove(board, cutEdge(board, live, expert.edgeId, 'blue').live, 'red').winning, false);
});

test('Expert finds the unique winning cut above edge 128 on a large Green board', () => {
  const board = stalks({ shorter: Array(77).fill('green'), taller: Array(78).fill('green') });
  const live = initialEdges(board);
  // Only removing the taller stalk's tip leaves two identical stalks.
  for (const side of ['blue', 'red']) {
    const move = chooseComputerMove(board, live, side, 'expert');
    assert.deepEqual(move, { edgeId: 'taller-78', proven: true, winning: true });
    const reply = chooseComputerMove(board, cutEdge(board, live, move.edgeId, side).live, otherSide(side), 'expert');
    assert.equal(reply.proven, true);
    assert.equal(reply.winning, false);
  }
});

test('each level recognizes a side with no legal cut', () => {
  const redOnly = stalks({ red: ['red', 'red'] });
  for (const level of ['easy', 'standard', 'expert']) {
    assert.deepEqual(chooseComputerMove(redOnly, initialEdges(redOnly), 'blue', level),
      { edgeId: null, proven: true, winning: false });
  }
});

test('each computer keeps its level through every colored draw and a saved match', () => {
  const entrants = [{ name: 'Fern', kind: 'computer', level: 'easy' }, { name: 'Cedar', kind: 'computer', level: 'standard' }];
  for (const opener of [0, 1]) for (const color of [0, 1]) {
    const coins = [opener, color];
    const drawn = drawSeats({ entrants }, 'redblue', () => coins.shift());
    const game = createGame({ ...drawn, boardVersion: 2, seed: 'GROVE7', variant: 'redblue', difficulty: 'large' });
    const saved = JSON.parse(JSON.stringify(saveData(game)));
    assert.equal(saved.difficulty, 'large');
    assert.deepEqual(saved.players[game.firstSide], entrants[opener]);
    assert.deepEqual(saved.players[otherSide(game.firstSide)], entrants[1 - opener]);
    assert.deepEqual(restoreGame(saved).players, saved.players);
  }
});

test('old computers default to Expert and human turn links keep their original schema', () => {
  const entrants = [{ name: 'Fern', kind: 'computer' }, { name: 'Cedar', kind: 'human', level: 'easy' }];
  const drawn = drawSeats({ entrants }, 'redblue', () => 0);
  const game = createGame({ ...drawn, seed: '00C0DE', variant: 'redblue' });
  const archived = restoreGame(saveData(game));
  assert.deepEqual(archived.players.blue, entrants[0]);
  assert.equal(computerLevelLabel(archived.players.blue.level), 'Expert');
  assert.deepEqual(archived.players.red, { name: 'Cedar', kind: 'human' });

  const linked = drawSeats({ entrants, opponent: 'link' }, 'redblue', () => 0);
  const match = createGame({ ...linked, seed: '00C0DE', variant: 'redblue' });
  assert.deepEqual(decodeTurn(encodeTurn(match)).players, {
    blue: { name: 'Fern', kind: 'human' }, red: { name: 'Cedar', kind: 'human' },
  });
});
