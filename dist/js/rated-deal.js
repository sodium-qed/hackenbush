import { MAP_COUNT, normalizeMapSeed, permuteMapNumber } from './map-seed.js';
import { chooseComputerMove } from './opponents.js?v=11';
import { RATED_BOT_BY_ID, chooseRatedBotMove } from './rated-bots.js?v=11';
import { otherSide } from './rules.js';

export const RATED_BOARD_VERSION = 5;
const sizes = ['small', 'standard', 'large'];

function checkedSeed(seed) {
  const normalized = normalizeMapSeed(seed);
  if (!normalized) throw new RangeError('A rated deal needs a six-digit hexadecimal seed.');
  return normalized;
}

/** The map code goes directly to the ordinary map generator. Two independent
 * bits in a separate permutation assign the opening side and the human seat. */
export function ratedDeal(seed, boardVersion = RATED_BOARD_VERSION) {
  const code = checkedSeed(seed);
  const word = permuteMapNumber(Number.parseInt(code, 16) ^ 0x678f31);
  const seats = {
    firstSide: word & 1 ? 'red' : 'blue',
    seat: word & 2 ? 'red' : 'blue',
  };
  if (boardVersion === 1) {
    const difficulty = sizes[Math.floor((word >>> 2) * 3 / (MAP_COUNT / 4))];
    return { seed: code, boardVersion, difficulty, ...seats };
  }
  if (boardVersion !== RATED_BOARD_VERSION) throw new RangeError('Unknown rated board version.');
  return { seed: code, boardVersion, difficulty: 'expert', ...seats, timed: true };
}

/** Frozen miniature deals for existing matches and their original calibration. */
export function legacyRatedDeal(seed) {
  return ratedDeal(seed, 1);
}

export function isRatedBot(level) {
  return typeof level === 'string' && Object.hasOwn(RATED_BOT_BY_ID, level);
}

/** Both play and replay choose the policy recorded with the computer's seat. */
export function ratedBotMove(board, live, side, level, seed, ply) {
  if (isRatedBot(level)) return chooseRatedBotMove(board, live, side, level, seed, ply);
  // The archived Easy stream and Expert proof contract remain reproducible.
  if (level === 'easy') {
    if (!Number.isInteger(ply) || ply < 0 || ply > 22) throw new RangeError('Invalid rated ply.');
    const stream = permuteMapNumber(0x42c79d + 2 * ply + Number(side === 'red'));
    const draw = permuteMapNumber(Number.parseInt(checkedSeed(seed), 16) ^ stream) / MAP_COUNT;
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
