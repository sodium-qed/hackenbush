import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import { copyText, decodeTurn, encodeTurn } from '../dist/js/linkplay.js';
import { cutEdge, initialEdges, legalMoves, otherSide, winner } from '../dist/js/rules.js';

const options = { seed: 'GROVE7', variant: 'green', difficulty: 'standard' };

function play(settings, limit = Infinity) {
  const board = generateBoard(settings.seed, settings.variant, settings.difficulty);
  let live = initialEdges(board);
  let side = 'blue';
  const moves = [];
  while (moves.length < limit && !winner(board, live, side)) {
    const edgeId = legalMoves(board, live, side).at(-1);
    live = cutEdge(board, live, edgeId, side).live;
    moves.push(edgeId);
    side = otherSide(side);
    assert.ok(moves.length <= board.edges.length);
  }
  return { ...settings, board, live, moves, side, winner: winner(board, live, side) };
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

test('every variant and size can replay the next two seats on independent boards', () => {
  for (const variant of ['green', 'redblue', 'mixed']) {
    for (const difficulty of ['small', 'standard', 'large']) {
      const settings = { seed: 'Grove #4/🪵.é', variant, difficulty };
      for (const count of [0, 1, 2]) {
        const expected = play(settings, count);
        const hash = encodeTurn({ ...settings, moves: Object.freeze([...expected.moves]) });
        assert.match(hash, /^#turn=[A-Za-z0-9._-]+$/);
        const sharedUrl = new URL(hash, 'http://localhost/username/game/');
        const decoded = decodeTurn(sharedUrl.hash);
        assert.deepEqual(decoded, expected);
        assert.equal(encodeTurn(decoded), hash);
      }
    }
  }
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

  const hash = encodeTurn({ ...colored, moves: [] });
  const redIndex = board.edges.indexOf(red).toString(36);
  assert.equal(decodeTurn(replaceField(hash, 5, redIndex)), null);
  const validHash = encodeTurn(green);
  const first = green.board.edges.findIndex(candidate => candidate.id === edge).toString(36);
  assert.equal(decodeTurn(replaceField(validHash, 5, `${first}-${first}`)), null);
});

test('corruption, forged metadata, ambiguous representations and malformed seed bytes are rejected', () => {
  const hash = encodeTurn({ ...options, moves: [] });
  const damaged = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
  const excessiveCuts = Array(257).fill('0').join('-');
  const excessiveSeed = Buffer.alloc(257, 65).toString('base64url');
  const badInputs = [
    undefined, null, {}, '', '#turn=', `x${hash}`, `${hash}.`, `${hash}%20`, damaged,
    '#turn=' + 'a'.repeat(3000), replaceField(hash, 0, '2'), replaceField(hash, 1, 'red'),
    replaceField(hash, 2, 'purple'), replaceField(hash, 3, 'huge'),
    replaceField(hash, 4, '/w=='), replaceField(hash, 4, '_w'), replaceField(hash, 4, 'YR'),
    replaceField(hash, 4, 'a'), replaceField(hash, 4, excessiveSeed),
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
