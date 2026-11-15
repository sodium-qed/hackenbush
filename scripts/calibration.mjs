import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { generateBoard } from '../dist/js/generator.js';
import { permuteMapNumber } from '../dist/js/map-seed.js';
import { ratedBotMove, ratedDeal, ratedOpeningWinner } from '../dist/js/rated-deal.js';
import { assessOutcomeChoice } from '../dist/js/rating-opening.js';
import { cutEdge, initialEdges, otherSide } from '../dist/js/rules.js';
import { prepareGraph, inspectGraph } from '../dist/js/strategy.js';
import { fitVariant, LEVELS, PAIRS } from './calibration-fit.mjs';

const VARIANTS = ['green', 'redblue'];
// Development/pilot boards precede this range. Freeze a disjoint evaluation.
const STUDY_START = 0x4000, DEFAULT_BOARDS = 4096, DEFAULT_BOOTSTRAPS = 800;
const output = new URL('../dist/js/bot-calibration.js', import.meta.url);

// An odd increment and the existing 24-bit permutation enumerate distinct
// seeds. The first N are the fixed study sample; every fifth board is held out.
export function calibrationSeed(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 0x1000000) throw new RangeError('Invalid calibration board.');
  return permuteMapNumber(0x2d1079 + Math.imul(index, 0x141f73)).toString(16).toUpperCase().padStart(6, '0');
}

export function playCalibrationGame(board, deal, blue, red) {
  let live = initialEdges(board), side = deal.firstSide;
  const moves = [], levels = { blue, red };
  for (;;) {
    const { edgeId } = ratedBotMove(board, live, side, levels[side], deal.seed, moves.length);
    if (edgeId === null) return { winner: otherSide(side), moves };
    const change = cutEdge(board, live, edgeId, side);
    if (!change) throw new Error('Calibration encountered an illegal bot move.');
    moves.push(edgeId);
    live = change.live;
    side = otherSide(side);
  }
}

export function generateCorpus(count) {
  if (!Number.isInteger(count) || count < 1 || count > 0x1000000 - STUDY_START) throw new RangeError('Invalid corpus size.');
  const byVariant = { green: [], redblue: [] };
  const digest = createHash('sha256');
  for (let index = 0; index < count; index++) {
    const deal = ratedDeal(calibrationSeed(STUDY_START + index));
    for (const variant of VARIANTS) {
      const board = generateBoard(deal.seed, variant, deal.difficulty, deal.boardVersion);
      const live = initialEdges(board);
      const graph = prepareGraph(board, live);
      const opening = inspectGraph(graph, (1n << BigInt(graph.edges.length)) - 1n);
      const favored = ratedOpeningWinner(board, live, deal.firstSide);
      // The actual issued human seat is the proxy-player seat for conditional
      // calibration. Determine eligibility before observing either policy's result.
      const botSide = otherSide(deal.seat);
      const eligibility = Object.fromEntries(LEVELS.map(level => [level, assessOutcomeChoice({
        ...deal, board, live, players: { [botSide]: { level } },
      }, favored)]));
      const record = { ...deal, favored, eligibility, edges: live.length, cyclic: Boolean(opening.cyclic),
        holdout: index % 5 === 4, games: [] };
      const seats = [...LEVELS.map(level => [level, level]), ...PAIRS.flatMap(([a, b]) => [[a, b], [b, a]])];
      for (const [blue, red] of seats) {
        const game = playCalibrationGame(board, deal, blue, red);
        const assessment = eligibility[botSide === 'blue' ? blue : red];
        const row = { blue, red, firstSide: deal.firstSide, favored, winner: game.winner,
          information: assessment.information, forcedWinner: assessment.forcedWinner };
        if (row[favored] === 'expert' && game.winner !== favored) throw new Error('Expert lost from a proven winning seat.');
        if (row.forcedWinner && game.winner !== row.forcedWinner) throw new Error('Play contradicted a fixed-policy certificate.');
        record.games.push(row);
        digest.update(JSON.stringify([deal.seed, variant, deal.difficulty, deal.firstSide, deal.seat, blue, red, favored,
          assessment.information, assessment.forcedWinner, game.winner, game.moves]) + '\n');
      }
      byVariant[variant].push(record);
    }
  }
  return { byVariant, digest: digest.digest('hex') };
}

function rounded(value) {
  return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
}

export function runCalibration(count = DEFAULT_BOARDS, bootstraps = DEFAULT_BOOTSTRAPS) {
  const { byVariant, digest } = generateCorpus(count);
  const fitted = Object.fromEntries(VARIANTS.map(variant => [variant, fitVariant(byVariant[variant], bootstraps)]));
  const data = rounded(Object.fromEntries(VARIANTS.map(v => [v, fitted[v].data])));
  const diagnostics = rounded(Object.fromEntries(VARIANTS.map(v => [v, fitted[v].diagnostics])));
  return { boardsPerVariant: count, bootstraps, digest, data, diagnostics };
}

function moduleText({ digest, data }) {
  const fingerprint = createHash('sha256').update(digest).update(JSON.stringify(data)).digest('hex').slice(0, 12);
  return '// Generated by node scripts/calibration.mjs --write. See docs/research/BOT_CALIBRATION.md.\n' +
    `export const CALIBRATION_VERSION = 'gardens-1-${fingerprint}';\n` +
    `export const BOT_CALIBRATION = ${JSON.stringify(data, null, 2)};\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = process.argv.slice(2);
  const numberArg = (name, fallback) => {
    const arg = options.find(o => o.startsWith(`--${name}=`));
    const value = arg ? Number(arg.split('=')[1]) : fallback;
    if (!Number.isSafeInteger(value) || value < 2) throw new RangeError(`Invalid ${name}.`);
    return value;
  };
  const count = numberArg('boards', DEFAULT_BOARDS), bootstraps = numberArg('bootstraps', DEFAULT_BOOTSTRAPS);
  const write = options.includes('--write'), check = options.includes('--check');
  if ((write || check) && (count !== DEFAULT_BOARDS || bootstraps !== DEFAULT_BOOTSTRAPS)) {
    throw new Error('Published calibration uses the documented full corpus and resample count.');
  }
  const result = runCalibration(count, bootstraps);
  if (write) await writeFile(output, moduleText(result));
  if (check && await readFile(output, 'utf8') !== moduleText(result)) throw new Error('Shipped bot calibration differs from this run.');
  console.log(JSON.stringify(result, null, 2));
}
