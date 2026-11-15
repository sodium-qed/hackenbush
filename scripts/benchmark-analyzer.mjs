// node scripts/benchmark-analyzer.mjs [--budget-ms=220] [--repetitions=3] [--json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as current from '../dist/js/analysis-values.js';
import { generateBoard } from '../dist/js/generator.js';
import { cutEdge, initialEdges, legalMoves, otherSide } from '../dist/js/rules.js';
import { compare, createOracle, formatRational, makeBoard, parseRational } from '../tests/helpers/hackenbush-oracle.mjs';
import { hangingKnot, mirroredKnot, parallelKnot, smallKnot } from '../tests/helpers/analyzer-positions.mjs';

const baseline = 'b6a054dc50840cea8033ab54ad70e85c63b99d15';
const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
function positiveInt(name, fallback) {
  const option = args.find(arg => arg.startsWith('--' + name + '='));
  if (!option) return fallback;
  const value = Number(option.split('=')[1]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Expected positive integer for ' + name);
  return value;
}
const budgetMs = positiveInt('budget-ms', 220);
const repetitions = positiveInt('repetitions', 3);

function makeCases() {
  const cases = [];
  function add(label, board, live = initialEdges(board), side = 'blue', known = null) {
    const fingerprint = createHash('sha256').update(JSON.stringify({
      roots: board.nodes.filter(node => node.ground).map(node => node.id),
      edges: board.edges.filter(edge => live.includes(edge.id)).map(({ id, a, b, color }) => [id, a, b, color]),
      side
    })).digest('hex').slice(0, 12);
    cases.push({ label, board, live, side, known, fingerprint });
  }
  const forest = [];
  for (let branch = 0; branch < 8; branch++) {
    for (let h = 0; h < 12; h++) {
      const child = 1 + 12 * branch + h;
      forest.push([h ? child - 1 : 0, child, (h + branch) % 2 ? 'blue' : 'red']);
    }
  }
  add('96-edge forest', makeBoard(forest), undefined, 'blue', '0');

  const ring = Array.from({ length: 24 }, (_, i) => [i, (i + 1) % 24, i % 2 ? 'red' : 'blue']);
  add('24-edge ring', makeBoard(ring), undefined, 'blue', '0');
  add('Color-reflected knot', mirroredKnot(), undefined, 'blue', '0');
  add('Parallel-edge knot', parallelKnot());
  add('11-edge knot', smallKnot());
  add('Knot with pendant stalks', hangingKnot(), undefined, 'blue', formatRational(createOracle(smallKnot()).number()));
  // C0FFEE is a supplementary, deliberately selected witness for the
  // monochromatic-reachability proof. Keep it distinct in aggregate claims.
  for (const seed of ['A35D7E', 'A35D7F', '000000', 'FFFFFF', 'C0FFEE']) {
    const board = generateBoard(seed, 'redblue', 'expert', 5);
    let live = initialEdges(board);
    let side = 'blue';
    add('Map ' + seed, board, live, side);
    if (!seed.startsWith('A')) continue;
    // Replay legal turns, choosing the smallest cascade, breaking ties by
    // board order. Record the first position with at most thirteen live edges.
    while (live.length > 13) {
      const moves = legalMoves(board, live, side);
      if (!moves.length) break;
      let best = null;
      for (const id of moves) {
        const child = cutEdge(board, live, id, side);
        if (!best || child.live.length > best.live.length) best = child;
      }
      live = best.live;
      side = otherSide(side);
    }
    add('Endgame ' + seed, board, live, side);
  }
  for (const entry of cases) {
    if (entry.label === 'Parallel-edge knot') {
      const oracle = createOracle(entry.board, { interchangeableParallels: true });
      entry.known = formatRational(oracle.number(entry.live));
    }
    if (entry.live.length > 13 || entry.known !== null) continue;
    const oracle = createOracle(entry.board);
    entry.known = formatRational(oracle.number(entry.live));
  }
  return cases;
}

function verifyKnown(result, number, side) {
  if (number === null) return;
  const known = parseRational(number);
  if (result.exact) assert.equal(result.number, number);
  else {
    const lo = compare(parseRational(result.lower), known);
    const hi = compare(parseRational(result.upper), known);
    assert.ok(lo < 0 || (!lo && !result.lowerOpen), 'incorrect lower bound');
    assert.ok(hi > 0 || (!hi && !result.upperOpen), 'incorrect upper bound');
  }
  if (result.winner) {
    const winner = known.p > 0n ? 'blue' : known.p < 0n ? 'red' : otherSide(side);
    assert.equal(result.winner, winner);
  }
}

function asNumber(string) {
  const { p, q } = parseRational(string);
  return Number(p) / Number(q);
}

function observation(result, ms) {
  return {
    ms, exact: result.exact, number: result.number ?? null, winner: result.winner,
    interval: result.exact ? result.number :
      (result.lowerOpen ? '(' : '[') + result.lower + ', ' + result.upper + (result.upperOpen ? ')' : ']'),
    width: result.exact ? 0 : asNumber(result.upper) - asNumber(result.lower),
    nodes: result.nodes ?? null, cacheHits: result.cacheHits ?? null
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(runs) {
  return { exact: runs.filter(run => run.exact).length, winners: runs.filter(run => run.winner).length,
    medianMs: median(runs.map(run => run.ms)), medianWidth: median(runs.map(run => run.width)) };
}

async function run() {
  // The old analyzer imports exactly these two files. The detached module
  // directory prevents it from seeing new strategy helpers or caches.
  const temporary = await mkdtemp(join(tmpdir(), 'groundwork-analyzer-'));
  try {
    const files = ['analysis-values.js', 'strategy.js', 'rules.js'];
    await Promise.all(files.map(name => writeFile(join(temporary, name),
      execFileSync('git', ['show', baseline + ':dist/js/' + name], { cwd: root }))));
    await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
    const old = await import(pathToFileURL(join(temporary, files[0])).href);
    const cases = makeCases();
    const results = [];
    const warmup = makeBoard([[0, 1, 'blue'], [1, 2, 'red'], [2, 0, 'blue']]);
    for (const solver of [old, current]) {
      solver.analyzePosition(warmup, initialEdges(warmup), 'blue', 'redblue', { budgetMs });
    }
    for (const [i, sample] of cases.entries()) {
      const { label, board, live, side, fingerprint, known } = sample;
      const runs = { previous: [], updated: [] };
      for (let repeat = 0; repeat < repetitions; repeat++) {
        const order = (repeat + i) % 2 ? ['updated', 'previous'] : ['previous', 'updated'];
        const pair = {};
        for (const key of order) {
          const solver = key === 'previous' ? old : current;
          const start = performance.now();
          const result = solver.analyzePosition(board, live, side, 'redblue', { budgetMs, stats: true });
          const elapsed = performance.now() - start;
          verifyKnown(result, known, side);
          pair[key] = result;
          runs[key].push(observation(result, elapsed));
        }
        if (pair.previous.exact) verifyKnown(pair.updated, pair.previous.number, side);
        if (pair.updated.exact) verifyKnown(pair.previous, pair.updated.number, side);
        if (pair.previous.winner && pair.updated.winner) assert.equal(pair.previous.winner, pair.updated.winner);
      }
      results.push({ label, edges: live.length, side, fingerprint, known,
        previous: summarize(runs.previous), updated: summarize(runs.updated), runs });
    }
    const knot = cases.find(entry => entry.label === '11-edge knot');
    const proof = current.createAnalysisSession(knot.board, knot.live, knot.side);
    const progression = [];
    for (const nodeLimit of [0, 1, 4, 16, 32, 64, 128, 256, 512, 1024, 4096, 16384, 65536]) {
      const result = proof.refine({ budgetMs: Infinity, nodeLimit });
      verifyKnown(result, knot.known, knot.side);
      progression.push({ nodeLimit, status: result.status, ...observation(result, result.durationMs) });
      if (result.exact) break;
    }
    const environment = { node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model };
    if (args.includes('--json')) {
      console.log(JSON.stringify({ baseline, budgetMs, repetitions, environment, results, progression }, null, 2));
      return;
    }
    console.log('Baseline ' + baseline + ', ' + budgetMs + ' ms per fresh call, ' + repetitions + ' repetitions.');
    console.log(JSON.stringify(environment));
    console.log('| Position | Edges | Exact old / new | Winner old / new | Median ms old / new | Median width old / new |');
    console.log('| --- | ---: | --- | --- | --- | --- |');
    for (const { label, edges, previous: a, updated: b } of results) {
      console.log('| ' + [label, edges, a.exact + ' / ' + b.exact, a.winners + ' / ' + b.winners,
        a.medianMs.toFixed(2) + ' / ' + b.medianMs.toFixed(2),
        a.medianWidth.toFixed(3) + ' / ' + b.medianWidth.toFixed(3)].join(' | ') + ' |');
    }
    console.log('\n11-edge knot, cumulative proof session');
    console.log('| Slice limit | Cumulative nodes | Certified interval | Winner | Status |');
    console.log('| ---: | ---: | --- | --- | --- |');
    for (const row of progression) {
      console.log('| ' + [row.nodeLimit, row.nodes, row.interval, row.winner ?? 'unknown', row.status].join(' | ') + ' |');
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await run();
