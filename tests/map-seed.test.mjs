import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { MAP_COUNT, nextMapSeed, normalizeMapSeed, permuteMapNumber } from '../dist/js/map-seed.js';
import { sceneForSeed, SCENES } from '../dist/js/scenery.js';

test('seed codes preserve all six ASCII digits and leading zeros', () => {
  assert.equal(normalizeMapSeed(' 00abCd '), '00ABCD');
  assert.equal(normalizeMapSeed('000000'), '000000');
  for (const bad of [null, 123456, 'DEF', '1234567', 'GH1111', 'ﬀ0000', '０00000']) {
    assert.equal(normalizeMapSeed(bad), null);
  }
});

test('a complete 24-bit deal cycle visits every one of the 16^6 map codes once', () => {
  const bits = new Uint8Array(MAP_COUNT / 8);
  const step = 0x20C51B;
  let cursor = 0x193AC2;
  for (let i = 0; i < MAP_COUNT; i++) {
    const word = permuteMapNumber(cursor);
    const index = word >>> 3;
    const bit = 1 << (word & 7);
    if (bits[index] & bit) assert.fail('Repeated map ' + word.toString(16));
    bits[index] |= bit;
    cursor = (cursor + step) & (MAP_COUNT - 1);
  }
  assert.equal(cursor, 0x193AC2);
  assert.ok(bits.every(byte => byte === 255));
  const entropy = {getRandomValues(words) { words.set([0x193AC2, step - 1]); return words; }};
  const first = nextMapSeed(null, entropy);
  assert.equal(first.seed, permuteMapNumber(0x193AC2).toString(16).toUpperCase().padStart(6, '0'));
  assert.equal(first.state.step, step);
  assert.deepEqual(nextMapSeed(first.state), nextMapSeed(structuredClone(first.state)));
  assert.deepEqual(nextMapSeed({ current: 1, step: 0 }, entropy), first);
});

test('each digit can independently select every pictured landscape', async () => {
  assert.equal(SCENES.length, 16);
  assert.equal(new Set(SCENES.map(scene => scene[0])).size, 16);
  for (let slot = 0; slot < 6; slot++) {
    const regions = new Set();
    for (const digit of '0123456789ABCDEF') {
      const seed = 'C0FFEE'.split('');
      seed[slot] = digit;
      regions.add(sceneForSeed(seed.join('')).id);
    }
    assert.equal(regions.size, 16);
  }
  for (const [id] of SCENES) await access(new URL('../dist/art/scenes/' + id + '.webp', import.meta.url));
  assert.deepEqual(sceneForSeed('C0FFEE'), sceneForSeed('c0ffee'));
});
