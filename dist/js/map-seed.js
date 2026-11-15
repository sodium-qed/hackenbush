export const CURRENT_BOARD_VERSION = 5;
export const MAP_COUNT = 0x1000000;
const MASK = MAP_COUNT - 1;

export function usesMapSeed(version) {
  return version === 4 || version === CURRENT_BOARD_VERSION;
}

export function normalizeMapSeed(value) {
  if (typeof value !== 'string') return null;
  const seed = value.trim();
  return /^[0-9A-Fa-f]{6}$/.test(seed) ? seed.toUpperCase() : null;
}

// XOR shifts and multiplication by odd integers are bijections on 24-bit words.
export function permuteMapNumber(value) {
  let word = value & MASK;
  word ^= word >>> 11;
  word = Math.imul(word, 0x52dce9) & MASK;
  word ^= word >>> 9;
  word = Math.imul(word, 0x9e3779) & MASK;
  return (word ^ (word >>> 12)) & MASK;
}

function isWord(value) {
  return Number.isInteger(value) && value >= 0 && value <= MASK;
}

export function nextMapSeed(previous, entropy = globalThis.crypto) {
  let state = previous;
  if (!state || !isWord(state.current) || !isWord(state.step) || !(state.step & 1)) {
    const words = entropy.getRandomValues(new Uint32Array(2));
    state = { current: words[0] & MASK, step: (words[1] & MASK) | 1 };
  }
  const seed = permuteMapNumber(state.current).toString(16).padStart(6, '0').toUpperCase();
  return { seed, state: { current: (state.current + state.step) & MASK, step: state.step } };
}
