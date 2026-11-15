import { generateBoard } from '../dist/js/generator.js';
import { RATED_BOTS } from '../dist/js/rated-bots.js';
import { legacyRatedDeal, ratedDeal } from '../dist/js/rated-deal.js';
import { calibrationSeed, playCalibrationGame } from './calibration.mjs';

// Swap the two policies on each identical opening. All policies see the same
// sequence of gardens, independent of the legacy calibration and validation sets.
const boards = Number(process.argv[2] ?? 64);
const variants = process.argv[3] ? [process.argv[3]] : ['green', 'redblue'];
const firstIndex = Number(process.argv[4] ?? 0x20000);
if (!Number.isSafeInteger(boards) || boards < 1 || !Number.isSafeInteger(firstIndex) ||
    firstIndex < 0 || firstIndex + boards > 0x1000000 ||
    variants.some(v => v !== 'green' && v !== 'redblue')) {
  throw new Error('Usage: node scripts/full-garden-study.mjs [positive board count] [green|redblue] [first seed index]');
}

const pairs = RATED_BOTS.slice(1).map((bot, i) => [bot.id, RATED_BOTS[i].id]);
pairs.push([RATED_BOTS.at(-1).id, RATED_BOTS[0].id], [RATED_BOTS.at(-1).id, 'nelson']);

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  return { min: sorted[0], median, max: sorted.at(-1) };
}

for (const variant of variants) {
  const edges = [], legacyEdges = [], plies = [];
  const results = pairs.map(([higher, lower]) => ({ higher, lower, wins: 0, split: 0, sweeps: 0, losses: 0 }));
  for (let i = 0; i < boards; i++) {
    const seed = calibrationSeed(firstIndex + i);
    const deal = ratedDeal(seed);
    const board = generateBoard(seed, variant, deal.difficulty, deal.boardVersion);
    const old = legacyRatedDeal(seed);
    edges.push(board.edges.length);
    legacyEdges.push(generateBoard(seed, variant, old.difficulty, old.boardVersion).edges.length);
    for (const row of results) {
      const asBlue = playCalibrationGame(board, deal, row.higher, row.lower);
      const asRed = playCalibrationGame(board, deal, row.lower, row.higher);
      const wins = Number(asBlue.winner === 'blue') + Number(asRed.winner === 'red');
      row.wins += wins;
      if (wins === 2) row.sweeps++;
      else if (wins === 1) row.split++;
      else row.losses++;
      plies.push(asBlue.moves.length, asRed.moves.length);
    }
  }
  console.log(JSON.stringify({ variant, boards, firstIndex, games: plies.length, turnsMedian: quantiles(plies).median,
    edges: { ...quantiles(edges), legacyMedian: quantiles(legacyEdges).median },
    gamesPerPair: 2 * boards, results }, null, 2));
}
