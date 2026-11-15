import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { generateBoard } from '../dist/js/generator.js';
import { renderLandscape } from '../dist/js/landscape.js';
import { isDailySeed, normalizeTextSeed, TEXT_BOARD_VERSION } from '../dist/js/map-seed.js';
import { initialEdges } from '../dist/js/rules.js';

const garden = (seed, variant = 'green') => generateBoard(seed, variant, 'expert', TEXT_BOARD_VERSION);

test('ordinary seeds retain meaningful spaces, case, punctuation and Unicode across sharing', () => {
  assert.equal(normalizeTextSeed('  Cafe\u0301 / #?%+ & 🌿  '), 'Café / #?%+ & 🌿');
  assert.equal(normalizeTextSeed('North   Bank'), 'North   Bank');
  assert.equal(normalizeTextSeed(' 00abCd '), '00ABCD');
  const longest = '🌱'.repeat(64);
  assert.equal(new TextEncoder().encode(longest).length, 256);
  assert.equal(normalizeTextSeed(longest), longest);
  for (const seed of [undefined, 3, '', '   ', longest + '!', 'x'.repeat(65), 'x\0y', 'a\nb',
    '\tword', 'word\r', 'a\u0085b', 'a\u202Eb', 'a\uD800', '\uDC00b', 'DAILY', 'xDaILyb', 'DAILY-02-29-2024']) {
    assert.equal(normalizeTextSeed(seed), null);
  }
});

test('internal daily seeds require an exact, real Gregorian date', () => {
  for (const seed of ['DAILY-01-01-0001', 'DAILY-02-29-0004', 'DAILY-02-29-2000', 'DAILY-02-29-2024',
    'DAILY-04-30-2026', 'DAILY-12-31-9999']) {
    assert.equal(isDailySeed(seed), true, seed);
    assert.equal(garden(seed).mapSeed, seed);
    assert.equal(normalizeTextSeed(seed), null);
  }
  for (const seed of [null, 'DAILY-01-01-0000', 'DAILY-02-29-1900', 'DAILY-02-29-2025', 'DAILY-04-31-2026',
    'DAILY-00-01-2026', 'DAILY-13-01-2026', 'DAILY-01-00-2026', 'DAILY-12-32-2026', 'DAILY-1-01-2026',
    'DAILY-01-01-026', 'DAILY-01-01-10000', 'daily-01-01-2026', ' DAILY-01-01-2026', 'DAILY-01-01-2026\n']) {
    assert.equal(isDailySeed(seed), false);
    assert.throws(() => garden(seed), RangeError);
  }
});

test('the full label drives playable connections, colors and independently regenerated scenery', () => {
  const prefix = 'a'.repeat(63);
  const seeds = ['Grove', 'grove', 'Café / #?%+ & 🌿', prefix + 'x', prefix + 'y', prefix + '🌿',
    'DAILY-11-15-2026', 'DAILY-11-16-2026', 'DAILY-12-15-2026', 'DAILY-11-15-2027'];
  const networks = new Set(), settings = new Set();
  for (const seed of seeds) {
    const green = garden(seed), colored = garden(seed, 'redblue');
    assert.deepEqual(garden(seed, 'redblue'), colored);
    assert.equal(green.mapSeed, seed);
    assert.equal(green.edges.length, initialEdges(green).length);
    assert.deepEqual(colored.nodes, green.nodes);
    assert.deepEqual(colored.edges.map(e => ({ ...e, color: 'green' })), green.edges);
    assert.deepEqual(new Set(colored.edges.map(e => e.color)), new Set(['blue', 'red']));
    networks.add(JSON.stringify(green.edges.map(e => [e.a, e.b])));
    assert.match(green.world.mapSeed, /^[0-9A-F]{6}$/);
    settings.add(green.world.mapSeed);
  }
  assert.equal(networks.size, seeds.length);
  assert.equal(settings.size, seeds.length);
  assert.deepEqual(garden('  Cafe\u0301 / #?%+ & 🌿  '), garden('Café / #?%+ & 🌿'));
});

test('two labels with the same ground supports grow different networks and paint different landscapes', () => {
  const a = garden('Seedling 2273'), b = garden('Seedling 2680');
  const roots = board => board.nodes.filter(n => n.ground).map(n => n.x);
  assert.deepEqual(roots(a), roots(b));
  assert.notDeepEqual(a.edges.map(e => [e.a, e.b]), b.edges.map(e => [e.a, e.b]));

  function artwork(board) {
    let result;
    const container = { dataset: {}, classList: { add() {} }, setAttribute() {},
      ownerDocument: { createElementNS() { return { setAttribute() {} }; } },
      replaceChildren(svg) { result = svg.innerHTML.replace(/hb-landscape-sky-\d+/g, 'sky'); } };
    // Keep biome, wind and terrain heights fixed to isolate the scenery's own seed.
    renderLandscape(container, { ...a.world, mapSeed: board.world.mapSeed }, board.mapSeed);
    return result;
  }
  assert.equal(artwork(a), artwork(garden(a.mapSeed)));
  assert.notEqual(artwork(a), artwork(b));
});

test('six-hex v4 and v5 map contents and replay order match the original generator', () => {
  const expected = { 4: '79e2725f083246f23d636057b5700fea60282aaaa75152d03a7f123abcf436a7',
    5: 'bddc473ca018baa98cadcdc7de154f489b27b4e10702409a238af2e9ce821042' };
  for (const version of [4, 5]) {
    const matrix = createHash('sha256');
    for (const seed of ['000000', '000001', 'FFFFFF', 'C0FFEE', 'A35D7E', 'DECADE', 'fa11ed']) {
      for (const variant of ['green', 'redblue', 'mixed']) {
        matrix.update(JSON.stringify(generateBoard(seed, variant, 'expert', version)));
      }
    }
    assert.equal(matrix.digest('hex'), expected[version]);
  }
});
