import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSeats, entrantName } from '../dist/js/draw.js';

const entrants = [
  { name: 'Alice', kind: 'human' },
  { name: 'River', kind: 'computer' },
];

function coins(...values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, 'unexpected extra draw');
    return values[index++];
  };
}

test('all four independent colored assignments keep names and controllers together', () => {
  const combinations = new Set();
  for (const opener of [0, 1]) for (const color of [0, 1]) {
    const result = drawSeats({ entrants }, 'redblue', coins(opener, color));
    assert.equal(result.firstSide, color ? 'red' : 'blue');
    assert.deepEqual(result.players[result.firstSide], entrants[opener]);
    assert.equal(result.players[result.seat].name, 'Alice');
    assert.equal(result.opponent, 'computer');
    combinations.add(result.firstSide + '/' + result.players[result.firstSide].name);
  }
  assert.equal(combinations.size, 4);
});

test('Green draws only the opening person', () => {
  for (const opener of [0, 1]) {
    const match = drawSeats({ entrants }, 'green', coins(opener));
    assert.deepEqual(match.players[match.firstSide], entrants[opener]);
    assert.equal(match.players[match.seat].name, 'Alice');
  }
});

test('the linked organizer stays on the selected device through every possible draw', () => {
  for (const hostIndex of [0, 1]) for (const opener of [0, 1]) for (const color of [0, 1]) {
    const match = drawSeats({ entrants, opponent: 'link', hostIndex }, 'redblue', coins(opener, color));
    assert.equal(match.opponent, 'link');
    assert.equal(match.players[match.seat].name, entrants[hostIndex].name);
    assert.equal(match.players[match.firstSide].name, entrants[opener].name);
    assert.ok(Object.values(match.players).every(player => player.kind === 'human'));
  }
  const defaultHost = drawSeats({ entrants, opponent: 'link' }, 'redblue', coins(1, 0));
  assert.equal(defaultHost.players[defaultHost.seat].name, 'Alice');
});

test('local play accepts all controller pairings without mutating the draft', () => {
  for (const left of ['human', 'computer']) for (const right of ['human', 'computer']) {
    const config = Object.freeze({ entrants: Object.freeze([
      Object.freeze({ name: 'A', kind: left }), Object.freeze({ name: 'B', kind: right }),
    ]) });
    const match = drawSeats(config, 'redblue', coins(1, 1));
    assert.deepEqual(match.players.red, config.entrants[1]);
    assert.deepEqual(match.players.blue, config.entrants[0]);
    assert.equal(match.opponent, left === 'human' && right === 'human' ? 'local' : 'computer');
    if (left !== right) assert.equal(match.players[match.seat].kind, 'human');
  }
});

test('names keep Unicode and normalise whitespace, blank input and bot nicknames', () => {
  assert.equal(entrantName('  Jose\u0301\t中  '), 'José 中');
  assert.equal(entrantName('  \u200B\u2060\uFE0F'), '');
  assert.equal(entrantName('🌱'.repeat(25)), '🌱'.repeat(24));
  assert.equal(entrantName('👩‍🌾'), '👩‍🌾');
  const bots = { entrants: [{ name: '', kind: 'computer' }, { name: '  ', kind: 'computer' }] };
  const first = drawSeats(bots, 'redblue', coins(0, 1));
  const second = drawSeats(bots, 'redblue', coins(1, 1));
  assert.notEqual(first.players.red.name, first.players.blue.name);
  assert.equal(first.players.red.name, second.players.blue.name);
  assert.equal(first.players.blue.name, second.players.red.name);
  const guests = drawSeats({}, 'green', coins(1));
  assert.equal(guests.opponent, 'local');
  assert.deepEqual(guests.players.blue, { name: 'Guest B', kind: 'human' });
});

test('the default draw uses independent cryptographic coin bits', t => {
  const sample = [254, 255];
  const random = t.mock.method(globalThis.crypto, 'getRandomValues', bytes => {
    bytes[0] = sample.shift();
    return bytes;
  });
  const match = drawSeats({ entrants }, 'redblue');
  assert.equal(random.mock.callCount(), 2);
  assert.equal(match.firstSide, 'red');
  assert.equal(match.players.red.name, 'Alice');
});
