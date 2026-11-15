export const CURRENT_BOARD_VERSION = 5;
export const TEXT_BOARD_VERSION = 7;
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

export function normalizeTextSeed(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}\p{Bidi_Control}]/u.test(value)) return null;
  const seed = value.trim().normalize('NFC');
  // Each Unicode scalar takes at most four UTF-8 bytes, so 64 fit in 256 bytes.
  if (!seed || seed.length > 128 || [...seed].length > 64 || /daily/i.test(seed)) return null;
  return normalizeMapSeed(seed) ?? seed;
}

export function isDailySeed(value) {
  if (typeof value !== 'string' || value.length !== 16) return false;
  const parts = /^DAILY-(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!parts) return false;
  const month = Number(parts[1]), day = Number(parts[2]), year = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
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
