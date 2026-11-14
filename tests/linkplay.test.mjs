import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import { copyText, decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { cutEdge, initialEdges, legalMoves, otherSide, winner } from '../dist/js/rules.js';
import { createGame, isHumanTurn, playCut, receiveLink, saveData } from '../dist/js/session.js';

const options = { seed: 'GROVE7', variant: 'green', difficulty: 'standard' };
const legacyHash = '#turn=1.blue.mixed.small.NTRNRlU1.7.2142c28d';
const namedPlayers = {
  blue: { name: '李友 🌿', kind: 'human' },
  red: { name: 'Renée / J.', kind: 'human' },
};

function play(settings, limit = Infinity) {
  const firstSide = settings.firstSide ?? 'blue';
  const boardVersion = settings.boardVersion ?? 2;
  const players = settings.players ?? {
    [firstSide]: { name: 'Player 1', kind: 'human' },
    [otherSide(firstSide)]: { name: 'Player 2', kind: 'human' },
  };
  const board = generateBoard(settings.seed, settings.variant, settings.difficulty, boardVersion);
  let live = initialEdges(board);
  let side = firstSide;
  const moves = [];
  while (moves.length < limit && !winner(board, live, side)) {
    const edgeId = legalMoves(board, live, side).at(-1);
    live = cutEdge(board, live, edgeId, side).live;
    moves.push(edgeId);
    side = otherSide(side);
    assert.ok(moves.length <= board.edges.length);
  }
  return { ...settings, board, live, moves, side, winner: winner(board, live, side), firstSide,
    boardVersion, players, matchId: settings.matchId };
}

// Construct a deliberately altered but checksum-correct message to exercise replay validation.
function replaceField(hash, index, value) {
  const fields = hash.slice('#turn='.length).split('.').slice(0, -1);
  fields[index] = value;
  const payload = fields.join('.');
  let crc = -1;
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const tag = ((~crc) >>> 0).toString(16).padStart(8, '0');
  return `#turn=${payload}.${tag}`;
}

test('both opening sides can exchange an invitation and their next two cuts in every variant and size', () => {
  for (const variant of ['green', 'redblue', 'mixed']) {
    for (const difficulty of ['small', 'standard', 'large']) {
      for (const firstSide of ['blue', 'red']) {
        const settings = { seed: 'Grove #4/🪵.é', variant, difficulty, firstSide, players: namedPlayers, matchId: 'invitation_2-z' };
        for (const count of [0, 1, 2]) {
          const expected = play(settings, count);
          const hash = encodeTurn({ ...settings, moves: Object.freeze([...expected.moves]) });
          assert.match(hash, /^#turn=2\.[A-Za-z0-9._-]+$/);
          const sharedUrl = new URL(hash, 'http://localhost/username/game/');
          const decoded = decodeTurn(sharedUrl.hash);
          assert.deepEqual(decoded, expected);
          assert.equal(encodeTurn(decoded), hash);
        }
      }
    }
  }
});

test('the published v1 turn resumes the original board and replies keep that generator', () => {
  const saved = decodeTurn(legacyHash);
  assert.ok(saved);
  assert.equal(saved.seed, '54MFU5');
  assert.equal(saved.firstSide, 'blue');
  assert.equal(saved.boardVersion, 1);
  assert.equal(saved.matchId, undefined);
  assert.equal(saved.side, 'red');
  assert.equal(saved.winner, null);
  assert.deepEqual(saved.players, { blue: { name: 'Player 1', kind: 'human' }, red: { name: 'Player 2', kind: 'human' } });
  assert.deepEqual(saved.moves, ['e7']);
  assert.deepEqual(saved.live, ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.deepEqual(saved.board, generateBoard('54MFU5', 'mixed', 'small', 1));
  assert.deepEqual(decodeTurn(encodeTurn(saved)), saved);

  const reply = decodeTurn(encodeTurn({ ...saved, moves: ['e7', 'e5'] }));
  assert.equal(reply.boardVersion, 1);
  assert.equal(reply.side, 'blue');
  assert.deepEqual(reply.live, ['e0', 'e1', 'e2', 'e3', 'e4', 'e6']);
  for (const hash of [replaceField(legacyHash, 1, 'red'), replaceField(legacyHash, 5, '4'),
    replaceField(legacyHash, 5, '7-8'), replaceField(legacyHash, 5, '7-7'), replaceField(legacyHash, 0, '2')]) {
    assert.equal(decodeTurn(hash), null);
  }
});

test('two devices keep their seats whether the organizer moves first or sends the opening invitation', () => {
  for (const firstSide of ['blue', 'red']) {
    for (const seat of ['blue', 'red']) {
      let host = createGame({ ...options, opponent: 'link', firstSide, seat, players: namedPlayers, matchId: `table-${firstSide}-${seat}` });
      assert.equal(isHumanTurn(host), firstSide === seat);
      if (isHumanTurn(host)) host = playCut(host, legalMoves(host.board, host.live, host.side).at(-1));
      const visitor = receiveLink(decodeTurn(encodeTurn(host)), null).game;
      assert.equal(visitor.seat, otherSide(seat));
      assert.equal(isHumanTurn(visitor), true);
      assert.equal(visitor.moves.length, firstSide === seat ? 1 : 0);
      assert.deepEqual(visitor.players, namedPlayers);

      const reply = playCut(visitor, legalMoves(visitor.board, visitor.live, visitor.side).at(-1));
      const received = receiveLink(decodeTurn(encodeTurn(reply)), saveData(host)).game;
      assert.equal(received.seat, seat);
      assert.equal(isHumanTurn(received), true);
      assert.deepEqual(received.moves, reply.moves);
      assert.deepEqual(received.players, namedPlayers);
      assert.equal(received.matchId, host.matchId);
    }
  }
});

test('bare encodes use the latest generator, and names and optional match ID survive round trips', () => {
  const basic = decodeTurn(encodeTurn({ ...options, moves: [] }));
  assert.equal(basic.boardVersion, 2);
  assert.equal(basic.firstSide, 'blue');
  assert.equal(basic.matchId, undefined);
  assert.deepEqual(basic.board, generateBoard(options.seed, options.variant, options.difficulty));
  assert.deepEqual(basic.players, { blue: { name: 'Player 1', kind: 'human' }, red: { name: 'Player 2', kind: 'human' } });

  const redFirst = { ...options, firstSide: 'red', moves: [], matchId: 'a'.repeat(64) };
  const emptyNames = decodeTurn(encodeTurn(redFirst));
  assert.equal(emptyNames.players.red.name, 'Player 1');
  assert.equal(emptyNames.players.blue.name, 'Player 2');
  const players = { blue: { name: '  Méi\t👨‍🌾 \u202e', kind: 'human' }, red: { name: '🌿'.repeat(26), kind: 'human' } };
  const normalized = decodeTurn(encodeTurn({ ...redFirst, players }));
  assert.equal(normalized.players.blue.name, 'Méi 👨‍🌾');
  assert.equal(normalized.players.red.name, '🌿'.repeat(24));
  assert.equal(normalized.matchId, redFirst.matchId);
  assert.deepEqual(decodeTurn(encodeTurn(normalized)), normalized);
});

test('short seeds, UTF-8 byte limits, arbitrary Unicode, and leading BOMs round-trip exactly', () => {
  for (const seed of ['', 'x', 'é'.repeat(128), '\ufeffSEED', 'a.%-_?/#😀']) {
    const hash = encodeTurn({ ...options, seed, moves: [] });
    assert.equal(decodeTurn(hash).seed, seed);
  }
  for (const seed of [undefined, null, 1234, 'é'.repeat(129), 'x'.repeat(257), '\ud800']) {
    assert.throws(() => encodeTurn({ ...options, seed, moves: [] }));
  }
});

test('a falling edge cannot be encoded or imported as a second deliberate move', () => {
  const { board, live } = play(options, 0);
  const edge = board.edges.find(candidate => cutEdge(board, live, candidate.id, 'blue')?.fallen.length);
  assert.ok(edge, 'the fixture should have a cut with a falling branch');
  const result = cutEdge(board, live, edge.id, 'blue');
  const firstTurn = encodeTurn({ ...options, moves: [edge.id] });
  const received = decodeTurn(firstTurn);
  assert.deepEqual(received.moves, [edge.id]);
  assert.deepEqual(received.live, result.live);
  const history = [edge.id, result.fallen[0]];
  assert.throws(() => encodeTurn({ ...options, moves: history }));
  const ordinals = history.map(id => board.edges.findIndex(entry => entry.id === id).toString(36));
  assert.equal(decodeTurn(replaceField(firstTurn, 5, ordinals.join('-'))), null);
});

test('a finished match can be shared but the replay must stop at its final cut', () => {
  const expected = play(options);
  assert.ok(expected.winner);
  const terminal = encodeTurn(expected);
  assert.deepEqual(decodeTurn(terminal), expected);
  assert.throws(() => encodeTurn({ ...options, moves: [...expected.moves, expected.board.edges[0].id] }));
  const original = terminal.slice('#turn='.length).split('.')[5];
  assert.equal(decodeTurn(replaceField(terminal, 5, `${original}-0`)), null);
});

test('illegal colors, repeated cuts, unknown edges, unsupported settings and oversized input fail', () => {
  const colored = { ...options, variant: 'redblue' };
  const { board } = play(colored, 0);
  const red = board.edges.find(edge => edge.color === 'red');
  assert.ok(red);
  const green = play(options, 1);
  const edge = green.moves[0];
  assert.throws(() => encodeTurn({ ...colored, moves: [red.id] }));
  assert.throws(() => encodeTurn({ ...options, moves: [edge, edge] }));
  assert.throws(() => encodeTurn({ ...options, moves: ['e-unknown'] }));
  assert.throws(() => encodeTurn({ ...options, variant: 'purple', moves: [] }));
  assert.throws(() => encodeTurn({ ...options, difficulty: 'huge', moves: [] }));
  assert.throws(() => encodeTurn({ ...options, moves: Array(257).fill(edge) }));
  assert.throws(() => encodeTurn({ ...options, moves: '0-1' }));
  for (const extra of [{ firstSide: 'purple' }, { boardVersion: 0 }, { boardVersion: '2' },
    { matchId: {} }, { matchId: '' }, { matchId: 'a'.repeat(65) }, { matchId: 'not/an/id' },
    { players: false }, { players: { blue: [] } }, { players: { red: { kind: 'cpu' } } },
    { players: { red: { name: 123 } } }, { players: { blue: { name: 'a'.repeat(257) } } }]) {
    assert.throws(() => encodeTurn({ ...options, moves: [], ...extra }));
  }

  const hash = encodeTurn({ ...colored, moves: [] });
  const redIndex = board.edges.indexOf(red).toString(36);
  assert.equal(decodeTurn(replaceField(hash, 5, redIndex)), null);
  const blue = board.edges.find(edge => edge.color === 'blue');
  const redFirstHash = encodeTurn({ ...colored, firstSide: 'red', moves: [] });
  assert.throws(() => encodeTurn({ ...colored, firstSide: 'red', moves: [blue.id] }));
  assert.equal(decodeTurn(replaceField(redFirstHash, 5, board.edges.indexOf(blue).toString(36))), null);
  const validHash = encodeTurn(green);
  const first = green.board.edges.findIndex(candidate => candidate.id === edge).toString(36);
  assert.equal(decodeTurn(replaceField(validHash, 5, `${first}-${first}`)), null);
});

test('corruption, forged metadata, ambiguous representations and malformed seed bytes are rejected', () => {
  const hash = encodeTurn({ ...options, moves: [] });
  const damaged = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
  const excessiveCuts = Array(257).fill('0').join('-');
  const excessiveSeed = Buffer.alloc(257, 65).toString('base64url');
  const nameToken = name => Buffer.from(name, 'utf8').toString('base64url');
  const badInputs = [
    undefined, null, {}, '', '#turn=', `x${hash}`, `${hash}.`, `${hash}%20`, damaged,
    '#turn=' + 'a'.repeat(3000), replaceField(hash, 0, '3'), replaceField(hash, 0, '1'), replaceField(hash, 1, 'purple'),
    replaceField(hash, 2, 'purple'), replaceField(hash, 3, 'huge'),
    replaceField(hash, 4, '/w=='), replaceField(hash, 4, '_w'), replaceField(hash, 4, 'YR'),
    replaceField(hash, 4, 'a'), replaceField(hash, 4, excessiveSeed),
    replaceField(hash, 6, '01'), replaceField(hash, 6, '3'), replaceField(hash, 9, 'a'.repeat(65)),
    replaceField(hash, 9, 'bad/id'), replaceField(hash, 9, '?'), replaceField(hash, 7, '_w'),
    ...['', ' Alice', 'Bob\u202e', 'Player\nName', 'A'.repeat(25), '🌿'.repeat(25)].map(name => replaceField(hash, 8, nameToken(name))),
    ...['0-', '-0', '00', '1--2', 'Z', 'zzzzzzz', '1.0', '@', excessiveCuts]
      .map(cuts => replaceField(hash, 5, cuts)),
  ];
  for (const input of badInputs) assert.equal(decodeTurn(input), null, String(input));
});

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

test('copyText uses the native clipboard when available and reports failure without a browser', async t => {
  const seen = [];
  const browser = { clipboard: { writeText: async text => { seen.push(text); } } };
  replaceGlobal(t, 'navigator', browser);
  replaceGlobal(t, 'document', undefined);
  assert.equal(await copyText('the entire link'), true);
  assert.deepEqual(seen, ['the entire link']);
  assert.equal(await copyText(null), false);
  browser.clipboard.writeText = async () => { throw new Error('denied'); };
  assert.equal(await copyText('blocked'), false);
});

test('copyText falls back inside the active dialog and restores focus and selection', async t => {
  const events = [];
  const input = {
    style: {}, focus() {}, select() { events.push('select'); },
    setSelectionRange(start, end) { events.push([start, end]); }, remove() { events.push('remove'); },
  };
  const dialog = { appendChild(element) { assert.equal(element, input); events.push('dialog'); } };
  const trigger = { closest: () => dialog, focus: () => events.push('restore focus') };
  const range = {};
  const selection = {
    rangeCount: 1, getRangeAt: () => ({ cloneRange: () => range }),
    removeAllRanges() {}, addRange(previous) { assert.equal(previous, range); events.push('restore selection'); },
  };
  const doc = {
    activeElement: trigger, body: {}, getSelection: () => selection,
    createElement(tag) { assert.equal(tag, 'textarea'); return input; },
    execCommand(command) { events.push(command); return true; },
  };
  replaceGlobal(t, 'navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  replaceGlobal(t, 'document', doc);
  assert.equal(await copyText('turn'), true);
  assert.equal(input.value, 'turn');
  assert.deepEqual(events, ['dialog', 'select', [0, 4], 'copy', 'remove', 'restore focus', 'restore selection']);
  doc.execCommand = () => false;
  assert.equal(await copyText('turn'), false);
});
