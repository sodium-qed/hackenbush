// Four logit coefficients: Easy, Expert, signed opening winner, signed first
// mover. Standard is fixed at zero; conversion to display points happens once.
export const POINTS = 400 / Math.LN10;
export const ORDER = ['easy', 'expert', 'favored', 'first'];
export const LEVELS = ['easy', 'standard', 'expert'];
export const PAIRS = [['easy', 'standard'], ['standard', 'expert'], ['easy', 'expert']];
const PRIOR_PRECISION = 1 / 16; // Independent Normal(0, 4²) on the logit scale.

export function features(game) {
  return [
    Number(game.blue === 'easy') - Number(game.red === 'easy'),
    Number(game.blue === 'expert') - Number(game.red === 'expert'),
    game.favored === 'blue' ? 1 : -1,
    game.firstSide === 'blue' ? 1 : -1,
  ];
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function dot(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

export function predict(game, coefficients, knowBothPolicies = true) {
  if (game.forcedWinner) return Number(game.forcedWinner === 'blue');
  if (knowBothPolicies && game[game.favored] === 'expert') return Number(game.favored === 'blue');
  return logistic(dot(features(game).slice(0, coefficients.length), coefficients));
}

// Encode repeated design rows once. Counts can then be rebuilt by resampling
// whole boards, preserving all seat swaps and repeated policies on that board.
function design(boards, excludeCertain) {
  const rows = [], rowIds = new Map();
  const clusters = boards.map(board => {
    const entries = [];
    for (const game of board.games) {
      if (excludeCertain && (game.information !== 'skill' || game[game.favored] === 'expert')) continue;
      const x = features(game);
      const key = x.join(',');
      if (!rowIds.has(key)) { rowIds.set(key, rows.length); rows.push(x); }
      entries.push([rowIds.get(key), Number(game.winner === 'blue')]);
    }
    return entries;
  });
  return { rows, clusters };
}

function tally({ rows, clusters }, sample) {
  const n = Array(rows.length).fill(0), wins = Array(rows.length).fill(0);
  for (const cluster of sample) {
    for (const [row, y] of clusters[cluster]) { n[row]++; wins[row] += y; }
  }
  return { rows, n, wins };
}

// Positive-definite Newton system: four parameters and a proper ridge prior.
function solve(matrix, vector) {
  const size = vector.length;
  const lower = Array.from({ length: size }, () => Array(size).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j <= i; j++) {
      let v = matrix[i][j];
      for (let k = 0; k < j; k++) v -= lower[i][k] * lower[j][k];
      lower[i][j] = i === j ? Math.sqrt(v) : v / lower[j][j];
    }
  }
  const y = [], x = Array(size);
  for (let i = 0; i < size; i++) {
    let v = vector[i];
    for (let j = 0; j < i; j++) v -= lower[i][j] * y[j];
    y[i] = v / lower[i][i];
  }
  for (let i = size - 1; i >= 0; i--) {
    let v = y[i];
    for (let j = i + 1; j < size; j++) v -= lower[j][i] * x[j];
    x[i] = v / lower[i][i];
  }
  return x;
}

function fit({ rows, n, wins }, size = 4) {
  const beta = Array(size).fill(0);
  for (let step = 0; step < 40; step++) {
    const gradient = beta.map(v => -v * PRIOR_PRECISION);
    const information = beta.map((_, i) => beta.map((__, j) => Number(i === j) * PRIOR_PRECISION));
    for (let row = 0; row < rows.length; row++) {
      const x = rows[row];
      const p = logistic(dot(beta, x));
      const weight = n[row] * p * (1 - p);
      for (let i = 0; i < size; i++) {
        gradient[i] += x[i] * (wins[row] - n[row] * p);
        for (let j = 0; j < size; j++) information[i][j] += x[i] * x[j] * weight;
      }
    }
    const delta = solve(information, gradient);
    const maximum = Math.max(...delta.map(Math.abs));
    for (let i = 0; i < size; i++) beta[i] += delta[i] / Math.max(1, maximum / 3);
    if (maximum < 1e-9) return beta;
  }
  throw new Error('Calibration regression did not converge.');
}

function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function covariance(sample) {
  const n = sample.length;
  const means = sample[0].map((_, i) => sample.reduce((sum, b) => sum + b[i], 0) / n);
  return means.map((a, i) => means.map((b, j) => sample.reduce((sum, draw) =>
    sum + (draw[i] - a) * (draw[j] - b), 0) / (n - 1)));
}

function metrics(games, coefficients, knowBothPolicies = true) {
  let squared = 0, logLoss = 0, wins = 0, predicted = 0;
  for (const game of games) {
    const p = predict(game, coefficients, knowBothPolicies), y = Number(game.winner === 'blue');
    squared += (p - y) ** 2;
    logLoss -= Math.log(y ? p : 1 - p);
    wins += y; predicted += p;
  }
  return { games: games.length, brier: squared / games.length, logLoss: logLoss / games.length,
    blueRate: wins / games.length, predictedBlue: predicted / games.length };
}

function comparisons(boards) {
  return PAIRS.map(([lower, higher]) => {
    const scores = boards.map(board => board.games.filter(game =>
      (game.blue === higher && game.red === lower) || (game.red === higher && game.blue === lower))
      .reduce((total, game) => total + Number(game[game.winner] === higher), 0) / 2);
    const rate = scores.reduce((a, b) => a + b, 0) / scores.length;
    const se = Math.sqrt(scores.reduce((sum, r) => sum + (r - rate) ** 2, 0) / (scores.length * (scores.length - 1)));
    return { lower, higher, games: 2 * scores.length, higherWins: Math.round(rate * 2 * scores.length), rate,
      interval: [Math.max(0, rate - 1.96 * se), Math.min(1, rate + 1.96 * se)] };
  });
}

function policyAccuracy(games) {
  return Object.fromEntries(LEVELS.map(level => {
    const favored = games.filter(game => game[game.favored] === level);
    return [level, { favored: favored.length, wins: favored.filter(game => game.favored === game.winner).length }];
  }));
}

function eligibilityCounts(boards) {
  return Object.fromEntries(LEVELS.map(level => {
    const counts = { skill: 0, forced: 0, unresolved: 0 };
    for (const b of boards) counts[b.eligibility[level].information]++;
    return [level, counts];
  }));
}

function heldoutPairs(games, coefficients) {
  return PAIRS.map(([lower, higher]) => {
    const pairs = games.filter(g => (g.blue === lower && g.red === higher) || (g.red === lower && g.blue === higher));
    let wins = 0, predicted = 0;
    for (const game of pairs) {
      const blue = predict(game, coefficients);
      wins += Number(game[game.winner] === higher);
      predicted += game.blue === higher ? blue : 1 - blue;
    }
    return { lower, higher, rate: wins / pairs.length, expected: predicted / pairs.length };
  });
}

function bootstrapRandom(word) {
  // xorshift32, nonzero fixed starting state.
  return () => {
    word ^= word << 13; word ^= word >>> 17; word ^= word << 5;
    return (word >>> 0) / 4294967296;
  };
}

// Fit only on training boards. The published parameters are exactly the
// coefficients used on the held-out split, apart from display precision.
export function fitVariant(boards, bootstrapCount) {
  if (boards.length < 10 || bootstrapCount < 2) throw new RangeError('Need at least 10 boards and two resamples.');
  const train = boards.filter(b => !b.holdout), test = boards.filter(b => b.holdout);
  const grid = design(train, true), overall = design(train, false), indices = train.map((_, i) => i);
  const counts = tally(grid, indices);
  const beta = fit(counts), skillOnly = fit(counts, 2);
  const ladder = fit(tally(overall, indices), 2);
  const rng = bootstrapRandom(0x74c31ab9);
  const replicates = Array.from({ length: bootstrapCount }, () => {
    const resample = indices.map(() => Math.floor(rng() * indices.length));
    return [...fit(tally(grid, resample)), ...fit(tally(overall, resample), 2)].map(logit => logit * POINTS);
  });
  const cov = covariance(replicates);
  const intervals = cov.map((_, i) => [0.025, 0.975].map(q => quantile(replicates.map(b => b[i]), q)));
  const sd = cov.map((row, i) => Math.sqrt(row[i]));
  const [easy, expert, favored, first] = beta.map(value => value * POINTS);
  const games = boards.flatMap(b => b.games), holdout = test.flatMap(b => b.games);
  const resolved = holdout.filter(game => game.information !== 'unresolved');
  const scoreable = holdout.filter(game => game.information === 'skill');
  const eligible = scoreable.filter(game => game[game.favored] !== 'expert');
  const fitted = counts.n.reduce((a, b) => a + b, 0);
  const data = {
    bots: {
      easy: { rating: 1000 + ladder[0] * POINTS, sd: sd[4], modelRating: 1000 + easy, modelSd: sd[0] },
      standard: { rating: 1000, sd: 0, modelRating: 1000, modelSd: 0 },
      expert: { rating: 1000 + ladder[1] * POINTS, sd: sd[5], modelRating: 1000 + expert, modelSd: sd[1] },
    },
    opening: { favored, first, favoredSd: sd[2], firstSd: sd[3] },
    order: ORDER, covariance: cov.slice(0, 4).map(row => row.slice(0, 4)),
    sample: { boards: train.length, games: train.length * 9, fitted, holdoutBoards: test.length },
  };
  const diagnostics = {
    intervals: Object.fromEntries([...ORDER, 'ladderEasy', 'ladderExpert'].map((key, i) =>
      [key, intervals[i].map(v => v + (i === 2 || i === 3 ? 0 : 1000))])),
    holdout: { full: metrics(resolved, beta), baseline: metrics(resolved, skillOnly),
      conditional: metrics(eligible, beta), conditionalBaseline: metrics(eligible, skillOnly),
      proxyAsPlayer: metrics(scoreable, beta, false), proxyAsPlayerBaseline: metrics(scoreable, skillOnly, false) },
    comparisons: comparisons(boards), heldoutPairs: heldoutPairs(resolved, beta), favoredByLevel: policyAccuracy(games),
    eligibility: eligibilityCounts(boards),
    favoredFirst: boards.filter(b => b.favored === b.firstSide).length,
    firstWins: games.filter(g => g.winner === g.firstSide).length,
    strata: Object.fromEntries(['small', 'standard', 'large'].map(size => [size, boards.filter(b => b.difficulty === size).length])),
    cyclic: boards.filter(b => b.cyclic).length,
    edges: [Math.min(...boards.map(b => b.edges)), Math.max(...boards.map(b => b.edges))],
  };
  return { data, diagnostics };
}
