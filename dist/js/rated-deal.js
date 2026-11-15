import { MAP_COUNT, normalizeMapSeed, permuteMapNumber } from './map-seed.js';
import { chooseComputerMove } from './opponents.js?v=9';
import { otherSide } from './rules.js';

const sizes = ['small', 'standard', 'large'];

function seedWord(seed) {
  const normalized = normalizeMapSeed(seed);
  if (!normalized) throw new RangeError('A rated deal needs a six-digit hexadecimal seed.');
  return Number.parseInt(normalized, 16);
}

/** Deal specification shared by the browser and calibration. Two distinct
 * bits select the seats. The remaining 22 bits select the size stratum. */
export function ratedDeal(seed) {
  const word = permuteMapNumber(seedWord(seed) ^ 0x678f31);
  return {
    seed: normalizeMapSeed(seed), boardVersion: 1,
    difficulty: sizes[Math.floor((word >>> 2) * 3 / (MAP_COUNT / 4))],
    firstSide: word & 1 ? 'red' : 'blue',
    seat: word & 2 ? 'red' : 'blue',
  };
}

/** The production opponents with reproducible Easy draws and a bounded,
 * clock-independent completion of Expert's existing small-component solver. */
export function ratedBotMove(board, live, side, level, seed, ply) {
  if (level === 'easy') {
    if (!Number.isInteger(ply) || ply < 0 || ply > 22) throw new RangeError('Invalid rated ply.');
    const stream = permuteMapNumber(0x42c79d + 2 * ply + Number(side === 'red'));
    const draw = permuteMapNumber(seedWord(seed) ^ stream) / MAP_COUNT;
    return chooseComputerMove(board, live, side, level, { random: () => draw });
  }
  const move = chooseComputerMove(board, live, side, level, { completeSmallComponents: true });
  if (level === 'expert' && !move.proven) throw new Error('Rated Expert requires a certified move.');
  return move;
}

export function ratedOpeningWinner(board, live, firstSide) {
  const proof = chooseComputerMove(board, live, firstSide, 'expert', { completeSmallComponents: true });
  if (!proof.proven) throw new Error('The rated opening could not be certified.');
  return proof.winning ? firstSide : otherSide(firstSide);
}
