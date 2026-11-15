// Run from the repository root with: node scripts/difficulty-study.mjs
// Counts, seeds and effort are deterministic. Wall-clock times are omitted.
import assert from 'node:assert/strict';
import { analyzePosition } from '../dist/js/analysis-values.js';
import { estimateDifficulty } from '../dist/js/difficulty.js';
import { generateBoard } from '../dist/js/generator.js';
import { initialEdges, otherSide } from '../dist/js/rules.js';
import { createOracle, formatRational, makeBoard } from '../tests/helpers/hackenbush-oracle.mjs';

const sides = ['blue', 'red'];
const censusBudget = { budgetMs: Infinity, nodeLimit: 16384, maxMoves: 6 };
const topologies = {
  singles: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]],
  stalk: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
  forks: [[0, 1], [1, 2], [1, 3], [0, 4], [4, 5], [4, 6]],
  stalks321: [[0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [0, 6]],
  ring: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
  hinge: [[0, 1], [1, 2], [2, 0], [1, 3], [3, 4], [4, 1]],
};
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const round = x => Math.round(x * 1000) / 1000;

function ranks(values) {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const result = [];
  for (let i = 0; i < order.length;) {
    let end = i + 1;
    while (end < order.length && order[end].value === order[i].value) end++;
    for (let j = i; j < end; j++) result[order[j].i] = (i + end - 1) / 2;
    i = end;
  }
  return result;
}

function spearman(rows, x, y) {
  const a = ranks(rows.map(row => row[x]));
  const b = ranks(rows.map(row => row[y]));
  const ax = mean(a), by = mean(b);
  let product = 0, sumA = 0, sumB = 0;
  for (let i = 0; i < a.length; i++) {
    product += (a[i] - ax) * (b[i] - by);
    sumA += (a[i] - ax) ** 2;
    sumB += (b[i] - by) ** 2;
  }
  return sumA && sumB ? round(product / Math.sqrt(sumA * sumB)) : null;
}

// Shortest terminal-only proof: a winner needs one witness, while a loser
// must refute every available cut. This uses the independent game-tree oracle.
function terminalDepth(oracle) {
  const memo = new Map();
  function depth(live, side) {
    const key = JSON.stringify([live, side]);
    if (memo.has(key)) return memo.get(key);
    const other = otherSide(side);
    const cuts = oracle.options(live).filter(move => move.color === side);
    const witnesses = cuts.filter(move => oracle.winner(move.live, other) === side);
    const children = (witnesses.length ? witnesses : cuts).map(move => depth(move.live, other));
    const value = cuts.length ? 1 + (witnesses.length ? Math.min(...children) : Math.max(...children)) : 0;
    memo.set(key, value);
    return value;
  }
  return depth;
}

function sixEdgeCensus() {
  const all = [], families = [], flips = [];
  for (const [topology, pairs] of Object.entries(topologies)) {
    const cases = [];
    for (let pattern = 0; pattern < 64; pattern++) {
      const colors = pairs.map((_, i) => pattern & 2 ** i ? 'red' : 'blue');
      const board = makeBoard(pairs.map((pair, i) => [...pair, colors[i]]));
      const oracle = createOracle(board);
      const depth = terminalDepth(oracle);
      const number = oracle.number();
      const code = colors.map(color => color === 'red' ? 'R' : 'B').join('');
      for (const side of sides) {
        const analysis = analyzePosition(board, oracle.opening, side, 'redblue',
          { ...censusBudget, stats: true });
        assert.equal(analysis.number, formatRational(number));
        const result = estimateDifficulty(board, oracle.opening, side, 'redblue', { ...censusBudget, analysis });
        const limited = estimateDifficulty(board, oracle.opening, side, 'redblue',
          { analysis, budgetMs: Infinity, nodeLimit: 4, maxMoves: 2 });
        const moves = oracle.options(oracle.opening).filter(move => move.color === side);
        const wins = moves.filter(move => oracle.winner(move.live, otherSide(side)) === side);
        const cutProofDepth = Math.max(0, ...moves.map(move => 1 + depth(move.live, otherSide(side))));
        assert.equal(result.winner, oracle.winner(oracle.opening, side));
        assert.equal(result.winningMoves, wins.length);
        assert.equal(result.losingMoves, moves.length - wins.length);
        assert.equal(result.unknownMoves, 0);
        assert.equal(result.lower, result.upper);
        assert.ok(limited.lower <= result.score && limited.upper >= result.score);
        cases.push({ topology, pattern, code, side, number: analysis.number, winner: result.winner,
          score: result.score, legal: moves.length, wins: wins.length,
          uniformRisk: result.tactics.uniformRisk[0], shallowRisk: result.tactics.screenedRisk[0],
          structure: result.topology.index, cutProofDepth,
          exponent: Math.log2(Number(number.q)), proofNodes: result.effort.proofNodes,
          rootNodes: analysis.nodes, width: limited.upper - limited.lower });
      }
    }
    for (const row of cases) {
      for (let i = 0; i < 6; i++) {
        if (row.pattern & 2 ** i) continue;
        const neighbor = cases[(row.pattern + 2 ** i) * 2 + sides.indexOf(row.side)];
        flips.push({ change: Math.abs(neighbor.score - row.score), swapped: row.winner !== neighbor.winner,
          topology, edge: i + 1, side: row.side, before: row.code, after: neighbor.code,
          beforeScore: row.score, afterScore: neighbor.score });
      }
    }
    const winners = cases.filter(row => row.wins);
    families.push({ topology, seats: cases.length, wins: winners.length,
      range: [Math.min(...cases.map(r => r.score)), Math.max(...cases.map(r => r.score))],
      medianWin: median(winners.map(r => r.score)), medianWidth: median(cases.map(r => r.width)),
      meanRootProofNodes: round(mean(cases.map(r => r.rootNodes))),
      meanChildProofNodes: round(mean(cases.map(r => r.proofNodes))) });
    all.push(...cases);
  }
  const winners = all.filter(r => r.wins);
  const balanced = winners.filter(r => r.side === 'blue' && r.legal === 3);
  let sameGraph = null;
  for (const one of balanced.filter(r => r.wins === 1)) {
    const many = balanced.find(r => r.topology === one.topology && r.wins === 3);
    if (!many) continue;
    if (!sameGraph || one.score - many.score > sameGraph.one.score - sameGraph.many.score) {
      sameGraph = { one, many };
    }
  }
  const largestFlip = flips.reduce((a, b) => a.change >= b.change ? a : b);
  const weightSensitivity = [];
  for (const [shallowWeight, structureCap] of [[.5, .2], [.8, .2], [2 / 3, .1], [2 / 3, .3]]) {
    const revised = winners.map(row => {
      const risk = (1 - shallowWeight) * row.uniformRisk + shallowWeight * row.shallowRisk;
      const alternate = Math.round(100 * (risk + (1 - risk) * structureCap * row.structure));
      return { score: row.score, alternate };
    });
    const changes = revised.map(row => Math.abs(row.score - row.alternate));
    weightSensitivity.push({ shallowWeight: round(shallowWeight), structureCap,
      rho: spearman(revised, 'score', 'alternate'), maxChange: Math.max(...changes) });
  }
  return {
    seats: all.length, winningSeats: winners.length, families, cappedRangesCoverOracle: all.length,
    cappedExactlyScored: all.filter(r => r.width === 0).length,
    cappedMedianWidthOnWinningSeats: median(winners.map(r => r.width)),
    rankCorrelationWithinWinningSeats: {
      uniformRisk: spearman(winners, 'score', 'uniformRisk'),
      rootProofNodes: spearman(winners, 'score', 'rootNodes'),
      childProofNodes: spearman(winners, 'score', 'proofNodes'),
      denominatorExponent: spearman(winners, 'score', 'exponent'),
      allCutsTerminalProofDepth: spearman(winners, 'score', 'cutProofDepth'),
    },
    weightSensitivity,
    oneColorChange: { pairs: flips.length, winnerFlips: flips.filter(f => f.swapped).length,
      noScoreChange: flips.filter(f => !f.change).length, meanAbsoluteChange: round(mean(flips.map(f => f.change))),
      largestFlip },
    sameGraphThreeLegalBlueCuts: sameGraph,
  };
}

function seededFields() {
  const groups = [];
  for (const [version, seeds] of [[1, 6], [2, 3]]) {
    for (const variant of ['green', 'redblue']) {
      const rows = [];
      for (let i = 0; i < seeds; i++) {
        for (const size of ['small', 'standard', 'large']) {
          const board = generateBoard('CDI-' + i, variant, size, version);
          const live = initialEdges(board);
          for (const side of sides) {
            const analysis = analyzePosition(board, live, side, variant,
              { budgetMs: Infinity, nodeLimit: 640, stats: true });
            const result = estimateDifficulty(board, live, side, variant,
              { analysis, budgetMs: Infinity, nodeLimit: 512, maxMoves: 24 });
            rows.push({ edges: live.length, score: result.score, covered: result.coverage,
              width: result.upper - result.lower, expense: result.effort.nodes,
              allOutcomes: result.unknownMoves === 0, complete: result.complete });
          }
        }
      }
      const resolved = rows.filter(r => r.complete);
      groups.push({ version, variant, seats: rows.length, scoreResolved: resolved.length,
        allOutcomesResolved: rows.filter(r => r.allOutcomes).length,
        edgeRange: [Math.min(...rows.map(r => r.edges)), Math.max(...rows.map(r => r.edges))],
        medianWidth: median(rows.map(r => r.width)), widest: Math.max(...rows.map(r => r.width)),
        meanOutcomeCoverage: round(mean(rows.map(r => r.covered))),
        medianSurveyNodes: median(rows.map(r => r.expense)),
        sizeScoreRhoResolvedOnly: resolved.length ? spearman(resolved, 'edges', 'score') : null });
    }
  }
  return groups;
}

console.log(JSON.stringify({ census: sixEdgeCensus(), fields: seededFields() }, null, 2));
