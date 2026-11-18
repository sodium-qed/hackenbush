import { BOT_CALIBRATION, CALIBRATION_VERSION } from './bot-calibration.js';
import { RATED_BOT_BY_ID } from './rated-bots.js';

export const SKILL_MODEL = 'full-garden-prior-1';
export const INITIAL_RATING = 1200;
export const INITIAL_RD = 200;
// Historical fits and v1/v2 ledgers used 1000 as their origin. Translating
// every absolute rating by the same amount leaves odds and evidence intact.
export const LEGACY_RATING_SHIFT = INITIAL_RATING - 1000;
const NAMED_PRIOR_VERSION = 'chess-com-prior-1';
const NAMED_BOT_SD = 200;
const PROVEN_SEAT_ADVANTAGE = 80;
const LOG_ODDS_PER_POINT = Math.LN10 / 400;
const DRIFT_PER_GAME = 12;

// Positive half of the 19-point Gauss–Hermite rule for N(0,1), including zero.
const quadrature = [
  [0, 0.283773192751521], [0.71208504404238, 0.220941712199144],
  [1.42887667607837, 0.103603657276144], [2.15550276131694, 0.0286666910301184],
  [2.89805127651575, 0.00450723542034206], [3.66441654745064, 0.000378502109414268],
  [4.46587262683103, 1.53511459546667e-5], [5.32053637733604, 2.53222003209288e-7],
  [6.26289115651325, 1.22037084844748e-9], [7.38257902403043, 7.48283005405721e-13],
];

export function newPool() {
  return { rating: INITIAL_RATING, rd: INITIAL_RD, games: 0, ratedGames: 0,
    wins: 0, losses: 0, provisional: true };
}

export function isProvisional(ratedGames, rd) {
  return ratedGames < 10 || rd > 110;
}

export function ratedBotSummary(variant, level) {
  if (!Object.hasOwn(BOT_CALIBRATION, variant)) return null;
  if (Object.hasOwn(RATED_BOT_BY_ID, level)) {
    const { elo } = RATED_BOT_BY_ID[level];
    return { level, rating: elo, sd: NAMED_BOT_SD, modelRating: elo, modelSd: NAMED_BOT_SD,
      provisional: true, sourceKind: 'assigned-prior', calibration: NAMED_PRIOR_VERSION };
  }
  const fit = BOT_CALIBRATION[variant].bots[level];
  if (!fit || !Number.isFinite(fit.rating)) return null;
  return { level, rating: fit.rating + LEGACY_RATING_SHIFT, sd: fit.sd,
    modelRating: fit.modelRating + LEGACY_RATING_SHIFT, modelSd: fit.modelSd,
    provisional: Boolean(fit.provisional), sourceKind: 'legacy-fit', calibration: CALIBRATION_VERSION };
}

// Conditional logistic probability on an Elo-sized unit. Compute both tails
// directly in the filter so an upset probability survives rounding near one.
export function winChance(difference) {
  const x = difference * LOG_ODDS_PER_POINT;
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const odds = Math.exp(x);
  return odds / (1 + odds);
}

/** Integrate a Bernoulli likelihood over Gaussian skill and independent
 * Gaussian nuisance variation; project each posterior to its first two moments. */
export function skillForecast(pool, offset, nuisanceSd) {
  const skillVariance = pool.rd ** 2 + DRIFT_PER_GAME ** 2;
  const spread = Math.sqrt(skillVariance + nuisanceSd ** 2);
  const gain = skillVariance / spread;
  const center = pool.rating + offset;
  const win = [0, 0, 0], loss = [0, 0, 0];
  function sample(z, weight) {
    const difference = center + z * spread;
    for (const [moments, probability] of [[win, winChance(difference)], [loss, winChance(-difference)]]) {
      const mass = weight * probability;
      moments[0] += mass;
      moments[1] += mass * z;
      moments[2] += mass * z * z;
    }
  }
  for (const [z, weight] of quadrature) {
    sample(z, weight);
    if (z !== 0) sample(-z, weight);
  }
  function posterior([mass, first, second]) {
    const zMean = first / mass;
    const zVariance = Math.max(0, second / mass - zMean ** 2);
    return { rating: pool.rating + gain * zMean,
      rd: Math.sqrt(Math.max(0, skillVariance - gain ** 2 + gain ** 2 * zVariance)) };
  }
  return { expected: win[0] / (win[0] + loss[0]), win: posterior(win), loss: posterior(loss) };
}

function openingParameters(game, opening, bot) {
  const favored = opening.winner == null ? 0 : opening.winner === game.seat ? 1 : -1;
  if (bot.sourceKind === 'assigned-prior') {
    // The roster's nominal Elo, its uncertainty, and the practical size of
    // a proven seat advantage are design priors for full Hackenbush gardens.
    // An unproved opening contributes no directional advantage.
    return { offset: -bot.modelRating + favored * PROVEN_SEAT_ADVANTAGE, sd: bot.modelSd, model: SKILL_MODEL };
  }
  const fit = BOT_CALIBRATION[game.variant];
  const first = game.firstSide === game.seat ? 1 : -1;
  const x = [-Number(bot.level === 'easy'), -Number(bot.level === 'expert'), favored, first];
  let calibrationVariance = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) calibrationVariance += x[i] * fit.covariance[i][j] * x[j];
  }
  return { offset: -bot.modelRating + favored * fit.opening.favored + first * fit.opening.first,
    sd: Math.sqrt(Math.max(0, calibrationVariance)), model: 'opening-conditioned-1' };
}

/** Price either result using the opening evidence and the pre-match rating. */
export function forecastOpening(pool, game, opening) {
  const level = game.players[game.seat === 'blue' ? 'red' : 'blue'].level;
  const bot = ratedBotSummary(game.variant, level);
  const { offset, sd, model } = openingParameters(game, opening, bot);
  // A declared, symmetric transfer allowance for board-specific variation in
  // human play, in Elo units. Neither difficulty nor solver speed earns points.
  const transferSd = 0.5 * opening.score + 0.75 * (opening.upper - opening.lower);
  const nuisanceSd = Math.hypot(sd, transferSd);
  const forecast = skillForecast(pool, offset, nuisanceSd);
  const rated = opening.information === 'skill';
  if (!rated) {
    forecast.win = { rating: pool.rating, rd: pool.rd };
    forecast.loss = { ...forecast.win };
    if (opening.forcedWinner) forecast.expected = Number(opening.forcedWinner === game.seat);
  }
  return { ...forecast, rated, offset, nuisanceSd, transferSd, model, calibration: bot.calibration };
}
