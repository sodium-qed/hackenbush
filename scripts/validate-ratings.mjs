import { pathToFileURL } from 'node:url';
import { calibrationSeed, playCalibrationGame } from './calibration.mjs';
import { forecastOpening, newPool, ratedBotSummary, skillForecast, winChance } from '../dist/js/rating-model.js';
import { prepareRatedOpening } from '../dist/js/rating-opening.js';
import { ratedDeal } from '../dist/js/rated-deal.js';
import { otherSide } from '../dist/js/rules.js';
import { createGame } from '../dist/js/session.js';

function randomStream() {
  let word = 0xa43d97eb;
  return () => { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>> 0) / 2 ** 32; };
}

/** Known, stationary latent skills, randomized challenges, independently
 * drawn nuisance effects. This checks the filter under its data model. */
export function syntheticRecovery(trials = 512, games = 80) {
  const random = randomStream();
  const groups = {};
  for (const truth of [800, 1000, 1200]) {
    let signed = 0, squared = 0, totalRd = 0, covered = 0;
    for (let trial = 0; trial < trials; trial++) {
      let pool = newPool();
      for (let i = 0; i < games; i++) {
        const offset = -1000 + 600 * (random() - 0.5);
        const nuisance = 10 + random() * 100;
        const z = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
        const win = random() < winChance(truth + offset + nuisance * z);
        const prediction = skillForecast(pool, offset, nuisance);
        pool = win ? prediction.win : prediction.loss;
      }
      const error = pool.rating - truth;
      signed += error;
      squared += error ** 2;
      totalRd += pool.rd;
      covered += Number(Math.abs(error) <= 1.96 * pool.rd);
    }
    groups[truth] = { meanError: signed / trials, rmse: Math.sqrt(squared / trials),
      meanRd: totalRd / trials, coverage196: covered / trials };
  }
  return { trialsPerSkill: trials, gamesPerTrial: games, groups };
}

/** A second deal sample, disjoint from the calibration study. Standard acts as
 * a known reference player. Keep all levels on each seed clustered in the
 * interpretation; results describe a program, not observations of humans. */
export function referencePolicyStudy(boardCount = 384) {
  const levels = ['easy', 'standard', 'expert'];
  const results = {};
  for (const variant of ['green', 'redblue']) {
    let skill = 0, forced = 0, unresolved = 0, wins = 0, expected = 0;
    let fullError = 0, noTransferError = 0, overallOnlyError = 0;
    for (let i = 0; i < boardCount; i++) {
      const deal = ratedDeal(calibrationSeed(0x9000 + i));
      const bot = otherSide(deal.seat);
      for (const level of levels) {
        const g = createGame({ ...deal, variant, opponent: 'computer', timed: false,
          players: { [deal.seat]: { kind: 'human' }, [bot]: { kind: 'computer', level } } });
        const opening = prepareRatedOpening(g);
        const contest = playCalibrationGame(g.board, deal, bot === 'blue' ? level : 'standard', bot === 'red' ? level : 'standard');
        const y = Number(contest.winner === g.seat);
        if (opening.information === 'unresolved') { unresolved++; continue; }
        if (opening.information === 'forced') {
          if (opening.forcedWinner !== contest.winner) throw new Error('Contradictory policy certificate.');
          forced++; continue;
        }
        skill++;
        const reference = { rating: 1000, rd: 0 };
        const forecast = forecastOpening(reference, g, opening);
        const ablated = forecastOpening(reference, g, { ...opening, lower: 0, upper: 0, score: 0 });
        const baseline = winChance(1000 - ratedBotSummary(variant, level).rating);
        fullError += (forecast.expected - y) ** 2;
        noTransferError += (ablated.expected - y) ** 2;
        overallOnlyError += (baseline - y) ** 2;
        wins += y; expected += forecast.expected;
      }
    }
    results[variant] = { skill, forced, unresolved, observedWinRate: wins / skill, predictedWinRate: expected / skill,
      fullBrier: fullError / skill, withoutStructuralTransferBrier: noTransferError / skill, overallOnlyBrier: overallOnlyError / skill };
  }
  return { boardsPerVariant: boardCount, levelsPerBoard: levels.length, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ synthetic: syntheticRecovery(), actual: referencePolicyStudy() }, null, 2));
}
