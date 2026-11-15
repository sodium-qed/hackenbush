import { normalizeMapSeed, permuteMapNumber } from './map-seed.js';

// Atlas order is part of the v4 seed format.
export const SCENES = [
  ['wildflower-meadow', 'Wildflower meadow', '#f4eadb'],
  ['orchard-grove', 'Orchard grove', '#f0ecd4'],
  ['vine-terraces', 'Vine terraces', '#e9edda'],
  ['knot-garden', 'Knot garden', '#edecdc'],
  ['alpine-lake', 'Alpine lake', '#e1eced'],
  ['mangrove-creek', 'Mangrove creek', '#e4ede1'],
  ['redwood-grove', 'Redwood grove', '#eae4d7'],
  ['amber-dunes', 'Amber dunes', '#f4e8cd'],
  ['glacial-fjord', 'Glacial fjord', '#dce9ee'],
  ['rice-terraces', 'Rice terraces', '#e5ecd5'],
  ['karst-river', 'Karst river', '#dfe9e3'],
  ['lily-pond', 'Lily pond', '#e8e5ec'],
  ['basalt-coast', 'Basalt coast', '#e1e5e5'],
  ['cloud-forest', 'Cloud forest', '#e0e8df'],
  ['mesa-canyon', 'Mesa canyon', '#f1e0ce'],
  ['moonlit-estuary', 'Moonlit estuary', '#e0e4ec'],
];

export function sceneForSeed(value) {
  const seed = normalizeMapSeed(value);
  if (!seed) throw new RangeError('A map seed must have six hexadecimal digits.');
  const nibbles = Array.from(seed, digit => parseInt(digit, 16));
  // Each weight is odd, so changing any single landmark also changes the setting.
  const index = nibbles.reduce((sum, digit, slot) => sum + (2 * slot + 1) * digit, 0) & 15;
  const [id, name, paper] = SCENES[index];
  const detail = permuteMapNumber(parseInt(seed, 16));
  return {
    id, name, paper, image: './art/scenes/' + id + '.webp',
    horizontal: 18 + (detail & 63), vertical: 20 + ((detail >>> 6) & 31),
    flip: (detail & 0x800) ? -1 : 1, zoom: 102 + ((detail >>> 12) & 15),
    light: 12 + ((detail >>> 16) & 63),
  };
}
