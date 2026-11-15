import { BOT_CALIBRATION, CALIBRATION_VERSION } from './bot-calibration.js';

export const SKILL_MODEL = 'opening-conditioned-1';
export const INITIAL_RATING = 1000;
export const INITIAL_RD = 200;
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
  const fit = BOT_CALIBRATION[variant]?.bots?.[level];
  if (!fit || !Number.isFinite(fit.rating)) return null;
  return { level, rating: fit.rating, sd: fit.sd, modelRating: fit.modelRating, modelSd: fit.modelSd, provisional: Boolean(fit.provisional),
    calibration: CALIBRATION_VERSION };
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

/** Freeze the forecast before the first cut, including the consequences of
 * either result. Runtime-only measurements never enter the rating update. */
export function forecastOpening(pool, game, opening) {
  const level = game.players[game.seat === 'blue' ? 'red' : 'blue'].level;
  const fit = BOT_CALIBRATION[game.variant];
  const favored = opening.winner === game.seat ? 1 : -1;
  const first = game.firstSide === game.seat ? 1 : -1;
  const x = [-Number(level === 'easy'), -Number(level === 'expert'), favored, first];
  let calibrationVariance = 0;
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < x.length; j++) calibrationVariance += x[i] * fit.covariance[i][j] * x[j];
  }
  // A declared, symmetric transfer allowance for board-specific variation in
  // human play, in Elo units. Neither difficulty nor solver speed earns points.
  const transferSd = 0.5 * opening.score + 0.75 * (opening.upper - opening.lower);
  const nuisanceSd = Math.hypot(Math.sqrt(Math.max(0, calibrationVariance)), transferSd);
  const offset = -fit.bots[level].modelRating + favored * fit.opening.favored + first * fit.opening.first;
  const forecast = skillForecast(pool, offset, nuisanceSd);
  const rated = opening.information === 'skill';
  if (!rated) {
    forecast.win = { rating: pool.rating, rd: pool.rd };
    forecast.loss = { ...forecast.win };
    if (opening.forcedWinner) forecast.expected = Number(opening.forcedWinner === game.seat);
  }
  return { ...forecast, rated, offset, nuisanceSd, transferSd,
    model: SKILL_MODEL, calibration: CALIBRATION_VERSION };
}
