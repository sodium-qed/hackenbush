import { analyzePosition, dyadicChange } from './analysis-values.js?v=11';
import { legalMoves, otherSide } from './rules.js';
import { inspectGraph, prepareGraph } from './strategy.js?v=11';

const MODEL = 'Cut Discrimination Index v1';
// The same mask scale as the existing bot. Oversized imported graphs still
// receive a sound interval and can use any separately supplied winner proof.
const MAX_EDGES = 256;
const MAX_NODES = 65536;

function count(mask) {
  let total = 0;
  for (; mask; mask &= mask - 1n) total++;
  return total;
}

function bounded(value, fallback, maximum) {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(value)));
}

function topologyFor(board, live, graph, opening) {
  const edges = graph.edges.length;
  const vertices = graph.incident.length;
  const loops = graph.edges.filter(edge => edge.a === edge.b).length;
  const cycleEdges = count(opening.cyclic) + loops;
  const ground = new Set(board.nodes.filter(node => node.ground).map(node => node.id));
  const active = new Set(live);
  const contacts = new Set();
  for (const edge of board.edges) {
    if (!active.has(edge.id)) continue;
    if (ground.has(edge.a)) contacts.add(edge.a);
    if (ground.has(edge.b)) contacts.add(edge.b);
  }
  const sizes = opening.parts.map(part => count(part.mask));
  const coupling = edges < 2 ? 0 :
    sizes.reduce((sum, size) => sum + size * (size - 1), 0) / (edges * (edges - 1));
  const cyclicFraction = edges ? cycleEdges / edges : 0;
  const articulationFraction = vertices > 1 ? opening.articulations / (vertices - 1) : 0;
  const drops = opening.drops.map(count);
  return {
    measured: true, edges, groundContacts: contacts.size, nonGroundVertices: vertices - 1,
    components: sizes.length, largestComponent: Math.max(0, ...sizes), bridges: edges - cycleEdges,
    cycleEdges, cycleRank: edges - vertices + 1, articulations: opening.articulations,
    maxDrop: Math.max(0, ...drops), meanDrop: edges ? drops.reduce((a, b) => a + b, 0) / edges : 0,
    coupling, index: (coupling * (1 + cyclicFraction) + articulationFraction) / 3,
  };
}

function optionsFor(graph, opening, side, other) {
  const options = [];
  for (let moves = opening.mask & graph.allowed[side]; moves; moves &= moves - 1n) {
    const index = graph.bitIndex.get(moves & -moves);
    const next = opening.mask & ~opening.drops[index];
    const immediate = !(next & graph.allowed[other]);
    options.push({ next, color: graph.edges[index].color, immediate, winner: immediate ? side : null,
      refuted: immediate ? false : null, value: null });
  }
  return options;
}

function hasRefutation(graph, mask, child, side, other) {
  const own = mask & graph.allowed[side];
  for (let replies = mask & graph.allowed[other]; replies; replies &= replies - 1n) {
    const index = graph.bitIndex.get(replies & -replies);
    if (!(own & ~child.drops[index])) return true;
  }
  return false;
}

// Every directly grounded edge survives every other cut. All successors are
// independent colored units and green *1s, including loops and parallel edges.
function priceGroundOptions(graph, options, side, other, kind) {
  const balance = count(graph.colors.blue) - count(graph.colors.red);
  const greenParity = count(graph.colors.green) % 2;
  for (const option of options) {
    const number = balance + (option.color === 'red' ? 1 : option.color === 'blue' ? -1 : 0);
    const nimber = greenParity ^ Number(option.color === 'green');
    option.winner = number > 0 ? 'blue' : number < 0 ? 'red' : nimber ? other : side;
    const own = option.next & graph.allowed[side];
    const lastCutIsShared = own !== 0n && !(own & (own - 1n)) && !!(own & graph.colors.green);
    option.refuted = !option.immediate && (!own || lastCutIsShared);
    if (kind === 'green') option.value = nimber;
    if (kind === 'redblue') option.value = String(number);
  }
  return balance;
}

function idsFor(graph, mask) {
  const ids = [];
  for (; mask; mask &= mask - 1n) ids.push(graph.edges[graph.bitIndex.get(mask & -mask)].id);
  return ids;
}

function valueSummary(options, kind, openingValue) {
  const values = options.map(option => option.value).filter(value => value !== null);
  const distinct = [...new Set(values)];
  let lowest = null, highest = null;
  if (kind === 'redblue') {
    for (const value of distinct) {
      if (lowest === null || dyadicChange(lowest, value).startsWith('-')) lowest = value;
      if (highest === null || dyadicChange(highest, value).startsWith('+')) highest = value;
    }
  }
  return { kind, opening: openingValue, known: values.length, distinct: distinct.length,
    complete: kind !== 'mixed' && values.length === options.length,
    observedMinimum: lowest, observedMaximum: highest,
    observedSpread: lowest === null ? null : dyadicChange(lowest, highest) };
}

function summarize(options, side, rootWinner, topology) {
  const other = otherSide(side);
  if (!options.length) rootWinner = other;
  if (options.some(option => option.winner === side)) rootWinner = side;
  if (rootWinner === other) {
    // Every option from a proved losing position loses under perfect play.
    for (const option of options) option.winner = other;
  } else if (rootWinner === side && options.every(option => option.winner !== side)) {
    const candidates = options.filter(option => option.winner === null);
    if (candidates.length === 1) {
      candidates[0].winner = side;
      candidates[0].refuted = false;
    }
  }

  const n = options.length;
  const winningMoves = options.filter(option => option.winner === side).length;
  const losingMoves = options.filter(option => option.winner === other).length;
  const unknownMoves = n - winningMoves - losingMoves;
  if (losingMoves === n) rootWinner = other;
  const instantWins = options.filter(option => option.immediate === true).length;
  const immediateRefutations = options.filter(option => option.refuted === true).length;
  const concealedLosses = options.filter(option => option.winner === other && option.refuted === false).length;

  // A winning cut cannot have an immediate refutation. Extremize the two
  // reference policies over the remaining possibilities, without interpreting
  // unexamined cuts as losses or estimating them by sample extrapolation.
  let uniformLow = 0, uniformHigh = 0, screenedLow = 0, screenedHigh = 0;
  if (n && rootWinner !== other) {
    const minWins = Math.max(1, winningMoves);
    const maxWins = n - losingMoves;
    const maxConcealed = n - immediateRefutations - minWins;
    if (rootWinner === side) uniformLow = (n - maxWins) / n;
    uniformHigh = (n - minWins) / n;
    if (!instantWins) {
      if (rootWinner === side && options.every(option => option.immediate !== null)) {
        screenedLow = concealedLosses / (maxWins + concealedLosses);
      }
      screenedHigh = maxConcealed / (minWins + maxConcealed);
    }
  }
  function scoreAt(uniform, screened, structure) {
    const risk = (uniform + 2 * screened) / 3;
    return n ? Math.round(100 * (risk + (1 - risk) * structure / 5)) : 0;
  }
  const lower = scoreAt(uniformLow, screenedLow, topology.index ?? 0);
  const upper = scoreAt(uniformHigh, screenedHigh, topology.index ?? 1);
  return { model: MODEL, score: Math.round((lower + upper) / 2), lower, upper,
    complete: lower === upper, winner: rootWinner, legalMoves: n, winningMoves, losingMoves,
    unknownMoves, coverage: n ? (n - unknownMoves) / n : 1, topology,
    tactics: { instantWins, immediateRefutations, concealedLosses,
      uncheckedReplies: options.filter(option => option.refuted === null).length,
      uniformRisk: [uniformLow, uniformHigh], screenedRisk: [screenedLow, screenedHigh] } };
}

/** Measure the current seat's structural decision difficulty on standing edges.
 * A supplied analysis must be a certificate for this board, live set and seat.
 * Use in a Worker for child proofs. Infinity plus finite caps is reproducible.
 * An interval covers the completed index; it is not a human confidence band. */
export function estimateDifficulty(board, live, side, variant = 'redblue', settings = {}) {
  const started = performance.now();
  const budget = bounded(settings.budgetMs, 35, Infinity);
  const deadline = started + budget;
  const nodeLimit = bounded(settings.nodeLimit, 512, MAX_NODES);
  const maxMoves = bounded(settings.maxMoves, 24, MAX_EDGES);
  const other = otherSide(side);
  const analysis = settings.analysis;
  let rootWinner = ['blue', 'red'].includes(analysis?.winner) ? analysis.winner : null;
  const effort = { rootScans: 0, childScans: 0, proofCalls: 0, proofNodes: 0, nodes: 0,
    nodeLimit, maxMoves, sizeLimit: MAX_EDGES };

  if (live.length > MAX_EDGES) {
    const opponentHasMove = legalMoves(board, live, other).length > 0;
    const options = legalMoves(board, live, side).map(() => ({
      immediate: opponentHasMove ? null : true, winner: opponentHasMove ? null : side,
      refuted: opponentHasMove ? null : false, value: null,
    }));
    const topology = { measured: false, edges: live.length, index: null };
    return { ...summarize(options, side, rootWinner, topology), sensitivity: valueSummary(options, variant, null),
      effort: { ...effort, status: 'size limit', durationMs: performance.now() - started } };
  }

  const graph = prepareGraph(board, live);
  const mask = (1n << BigInt(graph.edges.length)) - 1n;
  const opening = inspectGraph(graph, mask);
  effort.rootScans++;
  const topology = topologyFor(board, live, graph, opening);
  const green = mask ? mask === graph.colors.green : variant === 'green';
  const kind = green ? 'green' : graph.colors.green ? 'mixed' : 'redblue';
  let openingValue = green ? opening.nim : analysis?.exact && kind === 'redblue' ? analysis.number : null;
  if (green) rootWinner = opening.nim ? side : other;
  const options = optionsFor(graph, opening, side, other);
  for (const option of options) {
    if (!option.immediate) continue;
    if (green) option.value = 0;
    if (kind === 'redblue') option.value = String((side === 'blue' ? 1 : -1) * count(option.next));
  }

  const direct = !(mask & ~graph.incident[0]);
  if (direct) {
    const balance = priceGroundOptions(graph, options, side, other, kind);
    if (kind === 'redblue') openingValue = String(balance);
  }
  const survey = direct ? [] : options.filter(option => !option.immediate).slice(0, maxMoves);
  for (const [index, option] of survey.entries()) {
    if (effort.nodes >= nodeLimit || performance.now() >= deadline) break;
    const child = inspectGraph(graph, option.next);
    effort.childScans++;
    effort.nodes++;
    option.refuted = hasRefutation(graph, option.next, child, side, other);
    if (option.refuted) option.winner = other;
    if (green) {
      option.value = child.nim;
      option.winner = child.nim ? other : side;
      continue;
    }
    if (effort.nodes >= nodeLimit || performance.now() >= deadline) continue;
    const remainingMoves = survey.length - index;
    const share = Math.floor((nodeLimit - effort.nodes) / remainingMoves);
    const proof = analyzePosition(board, idsFor(graph, option.next), other, variant,
      { budgetMs: (deadline - performance.now()) / remainingMoves, nodeLimit: share, stats: true });
    effort.proofNodes += proof.nodes;
    effort.nodes += proof.nodes;
    effort.proofCalls++;
    if (proof.winner) option.winner = proof.winner;
    if (kind === 'redblue' && proof.exact) option.value = proof.number;
  }

  const result = summarize(options, side, rootWinner, topology);
  const status = result.tactics.uncheckedReplies ? 'survey limited'
    : result.unknownMoves ? 'proof limited' : 'survey complete';
  return { ...result, sensitivity: valueSummary(options, kind, openingValue),
    effort: { ...effort, status, durationMs: performance.now() - started } };
}
