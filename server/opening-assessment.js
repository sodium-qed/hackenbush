import { generateBoard } from '../dist/js/generator.js';
import { permuteMapNumber } from '../dist/js/map-seed.js';
import { initialEdges, legalMoves, cutEdge, otherSide } from '../dist/js/rules.js';
import { recentCache } from '../dist/js/analysis-modes.js';

const referenceGames = 128;
const gardens = recentCache(4);
const seatAllowance = 80;

// A reproducible reference for two human seats. Both reference players choose
// uniformly among legal cuts. Each trial has its own stream so a persisted
// prefix can resume in another server process without replaying prior trials.
function trial(match, index) {
  const key = [match.board_version, match.variant, match.seed].join('/');
  let garden = gardens.get(key);
  if (!garden) {
    const board = generateBoard(match.seed, match.variant, 'expert', match.board_version);
    garden = gardens.set(key, { board, live: initialEdges(board) });
  }
  let live = garden.live, side = match.first_side;
  let random = permuteMapNumber(parseInt(match.seed, 16) ^ permuteMapNumber(index + 1));
  for (;;) {
    const moves = legalMoves(garden.board, live, side);
    if (!moves.length) return otherSide(side);
    random = (Math.imul(1664525, random) + 1013904223) >>> 0;
    const id = moves[Math.floor(random / 2 ** 32 * moves.length)];
    live = cutEdge(garden.board, live, id, side).live;
    side = otherSide(side);
  }
}

function price(match, blueWins) {
  const offset = seatAllowance * (2 * blueWins / referenceGames - 1);
  const expected = 1 / (1 + 10 ** ((match.red_rating - match.blue_rating - offset) / 400));
  return { blue: Math.round(32 * (1 - expected)), red: -Math.round(32 * expected) };
}

function assessment(match, trials, wins) {
  const low = price(match, wins), high = price(match, wins + referenceGames - trials);
  // Every remaining trial is either a Blue or Red win. Elo is monotone in
  // that count. Matching rounded endpoints certify both possible awards.
  return { trials, wins, ready: low.blue === high.blue && low.red === high.red, delta: low };
}

export function liveOpening(match, steps = 0) {
  let trials = match.opening_trials ?? 0, wins = match.opening_blue_wins ?? 0;
  let result = assessment(match, trials, wins);
  for (let i = 0; i < steps && !result.ready; i++) {
    wins += Number(trial(match, trials) === 'blue');
    result = assessment(match, ++trials, wins);
  }
  return result;
}
