import { analyzePosition, createAnalysisSession } from './analysis-values.js?v=11';
import { recentCache } from './analysis-modes.js';
import { createOpeningSurvey, estimateDifficulty } from './difficulty.js?v=13';
import { ratedBotMove, ratedOpeningWinner } from './rated-deal.js?v=11';
import { cutEdge, legalMoves, otherSide } from './rules.js';
import { inspectGraph, prepareGraph } from './strategy.js?v=11';

const HUMAN_WIN = 1, BOT_WIN = 2;

/** A fixed deal and policy form a finite decision tree for the human. Two
 * terminal witnesses prove the result can vary. Exhausting every reachable
 * state proves constancy. A node cutoff certifies neither conclusion. */
function assessLegacyChoice(game, winner, nodeLimit) {
  const { board, seed, seat, firstSide } = game;
  const bot = otherSide(seat), level = game.players[bot].level;
  if (level === 'expert' && winner === bot) {
    return { information: 'forced', forcedWinner: bot, certificate: 'expert-policy', searchNodes: 0 };
  }
  const botMoves = new Map();
  const keyOf = (live, ply) => `${ply}|${live.join(',')}`;
  function botMove(live, ply) {
    const key = keyOf(live, ply);
    if (!botMoves.has(key)) botMoves.set(key, ratedBotMove(board, live, bot, level, seed, ply).edgeId);
    return botMoves.get(key);
  }
  let observed = 0;
  function terminal(side) { observed |= side === bot ? HUMAN_WIN : BOT_WIN; }

  // Cheap constructive probes usually find both witnesses. The first human
  // policy plays perfectly. Other probes use reproducible exploratory cuts.
  let random = (parseInt(seed, 16) ^ 0x85ebca6b) >>> 0;
  for (let trial = 0; trial < 12 && observed !== 3; trial++) {
    let live = game.live, side = firstSide, ply = 0;
    while (true) {
      const legal = legalMoves(board, live, side);
      if (!legal.length) { terminal(side); break; }
      let move;
      if (side === bot) move = botMove(live, ply);
      else if (trial === 0) move = ratedBotMove(board, live, side, 'expert', seed, ply).edgeId;
      else {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        move = legal[Math.floor(random / 2 ** 32 * legal.length)];
      }
      live = cutEdge(board, live, move, side).live;
      side = otherSide(side);
      ply++;
    }
  }
  const seen = new Set();
  let capped = false;
  function visit(live, side, ply) {
    if (observed === 3 || capped) return;
    const key = keyOf(live, ply);
    if (seen.has(key)) return;
    if (seen.size >= nodeLimit) { capped = true; return; }
    seen.add(key);
    const legal = legalMoves(board, live, side);
    if (!legal.length) { terminal(side); return; }
    const candidates = side === bot ? [botMove(live, ply)] : legal;
    for (const id of candidates) {
      visit(cutEdge(board, live, id, side).live, otherSide(side), ply + 1);
      if (observed === 3 || capped) break;
    }
  }
  visit(game.live, firstSide, 0);
  if (observed === 3) {
    return { information: 'skill', forcedWinner: null, certificate: 'two-witnesses', searchNodes: seen.size };
  }
  if (capped) return { information: 'unresolved', forcedWinner: null, certificate: 'node-limit', searchNodes: seen.size };
  return { information: 'forced', forcedWinner: observed === HUMAN_WIN ? seat : bot,
    certificate: 'policy-tree', searchNodes: seen.size };
}

function count(mask) {
  let total = 0;
  for (; mask; mask &= mask - 1n) total++;
  return total;
}

// These moves belong to the simulated human. Deliberately giving the opponent
// a good cut is a valid way to witness a loss. The bot always plays its actual
// assigned policy, with its original seed and ply.
function probeCut(graph, mask, side, green, seekWin, random) {
  const other = otherSide(side);
  const shape = inspectGraph(graph, mask);
  const options = [];
  for (let bits = mask & graph.allowed[side]; bits; bits &= bits - 1n) {
    const i = graph.bitIndex.get(bits & -bits);
    const removed = shape.drops[i], next = mask & ~removed;
    let score = 0;
    if (!green) {
      const gain = count(removed & graph.colors[other]) - count(removed & graph.colors[side]);
      const anchors = removed & graph.incident[0];
      const anchorGain = count(anchors & graph.colors[other]) - count(anchors & graph.colors[side]);
      score = 4 * gain + 3 * anchorGain;
      if (!(next & graph.allowed[other])) score = Infinity;
      else if (!(next & graph.allowed[side])) score = -Infinity;
      if (!seekWin) score = -score;
    }
    options.push({ id: graph.edges[i].id, next, score: score + count(removed) / 8 + random() });
  }
  options.sort((a, b) => b.score - a.score);
  // The Green nimber lets us search for a winning cut, or intentionally
  // offer one. A losing seat may still win if the fixed opponent errs.
  if (green && (shape.nim || !seekWin)) {
    const preferred = options.find(({ next }) => (inspectGraph(graph, next).nim === 0) === seekWin);
    if (preferred) return preferred.id;
  }
  return options[0].id;
}

const WORLD_PROBE_LIMIT = 480;

// A slice resumes both the current playout and the exhaustive search. Sampling
// can establish two outcomes. Only a proof can establish a forced outcome.
function createWorldChoice(game, winner) {
  const { board, seed, seat, firstSide } = game;
  const opponent = otherSide(seat), level = game.players[opponent].level;
  const green = game.variant === 'green';
  function forced(forcedWinner, certificate) {
    return { information: 'forced', forcedWinner, certificate, searchNodes: 0, witnesses: {} };
  }
  if (green && level === 'noam' && winner === opponent) {
    return () => forced(opponent, 'perfect-green-policy');
  }
  const graph = prepareGraph(board, game.live);
  const bits = new Map(graph.edges.map((edge, i) => [edge.id, 1n << BigInt(i)]));
  const openingMask = (1n << BigInt(graph.edges.length)) - 1n;
  if (!(openingMask & graph.allowed[firstSide]) || !(openingMask & graph.allowed[otherSide(firstSide)])) {
    const forcedWinner = openingMask & graph.allowed[firstSide] ? firstSide : otherSide(firstSide);
    return () => forced(forcedWinner, 'no-legal-reply');
  }
  if (winner && !(openingMask & ~graph.incident[0])) {
    // Every cut removes exactly its own edge. Remaining move counts fix the result.
    return () => forced(winner, 'grounded-moves');
  }

  const opponentMoves = recentCache(512);
  function fixedMove(live, ply) {
    const key = ply + '|' + live.join(',');
    return opponentMoves.get(key) ?? opponentMoves.set(key, ratedBotMove(board, live, opponent, level, seed, ply).edgeId);
  }
  let nodes = 0, randomState = Number.parseInt(seed, 16) ^ 0x85ebca6b;
  function random() {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  }
  const witnesses = {};
  let probes = 0;
  function* sample() {
    for (;;) {
      let live = game.live, side = firstSide, mask = openingMask;
      const line = [];
      const seekWin = !witnesses[seat];
      const humanPolicy = seekWin && !green ? [null, 'noam', null, 'li'][probes % 6] : null;
      const varySeed = humanPolicy === 'li' || (humanPolicy && probes >= 6);
      const humanSeed = varySeed ? Math.floor(random() * 2 ** 24).toString(16).padStart(6, '0') : seed;
      do {
        let move;
        if (side === opponent) move = fixedMove(live, line.length);
        else if (humanPolicy) move = ratedBotMove(board, live, seat, humanPolicy, humanSeed, line.length).edgeId;
        else move = probeCut(graph, mask, seat, green, seekWin, random);
        const cut = cutEdge(board, live, move, side);
        live = cut.live;
        mask &= ~bits.get(move);
        for (const id of cut.fallen) mask &= ~bits.get(id);
        line.push(move);
        side = otherSide(side);
        if (!(mask & graph.allowed[side])) {
          witnesses[otherSide(side)] ??= line;
          probes++;
        }
        yield;
      } while (mask & graph.allowed[side]);
    }
  }

  // Eviction only repeats completed work. The active path always fits in
  // the depth of one garden, even when the search has no overall work cap.
  const visited = recentCache(2048), path = [];
  function* visit(live, side) {
    const key = path.length + '|' + live.join(',');
    if (visited.get(key)) { yield; return; }
    const legal = legalMoves(board, live, side);
    if (!legal.length) witnesses[otherSide(side)] ??= [...path];
    yield;
    const moves = side === opponent && legal.length ? [fixedMove(live, path.length)] : legal;
    for (const id of moves) {
      path.push(id);
      yield* visit(cutEdge(board, live, id, side).live, otherSide(side));
      path.pop();
    }
    visited.set(key, true);
  }
  const playout = sample(), tree = visit(game.live, firstSide);
  let exhausted = false;
  return function refine(nodeLimit, probeLimit = Infinity) {
    const end = nodes + nodeLimit;
    while (nodes < end && probes < probeLimit && !exhausted && !(witnesses.blue && witnesses.red)) {
      if (probes < 6 || nodes % 2 === 0) playout.next();
      else exhausted = tree.next().done;
      nodes++;
    }
    const both = Boolean(witnesses.blue && witnesses.red);
    return { information: both ? 'skill' : exhausted ? 'forced' : 'unresolved',
      forcedWinner: exhausted && !both ? Object.keys(witnesses)[0] : null,
      certificate: both ? 'two-witnesses' : exhausted ? 'policy-tree' : 'probe-limit',
      searchNodes: nodes, witnesses: { ...witnesses } };
  };
}

/** Perfect play and attainable results against one fixed opponent are distinct.
 * Legacy assignments retain their original, bounded exhaustive search. */
export function assessOutcomeChoice(game, winner, nodeLimit) {
  return game.boardVersion === 5 ? createWorldChoice(game, winner)(nodeLimit ?? WORLD_PROBE_LIMIT, 6)
    : assessLegacyChoice(game, winner, nodeLimit ?? 600);
}

function difficultyFields(d) {
  const { winner, model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves } = d;
  return { winner, model, score, lower, upper, coverage, legalMoves, winningMoves, losingMoves, unknownMoves };
}

/** Bounded, reproducible snapshot for offline studies and historical callers. */
export function prepareRatedOpening(game) {
  const { board, live, firstSide, variant } = game;
  const world = game.boardVersion === 5;
  const proof = world ? analyzePosition(board, live, firstSide, variant, { budgetMs: Infinity, nodeLimit: 256 })
    : { winner: ratedOpeningWinner(board, live, firstSide) };
  // Survey every Green cut using its polynomial nimber calculation. Limit both
  // the number of Red–Blue child proofs and their shared allowance on full worlds.
  const worldSurvey = variant === 'green' ? live.length : 8;
  const d = estimateDifficulty(board, live, firstSide, variant,
    { analysis: proof, budgetMs: Infinity, nodeLimit: world && variant === 'redblue' ? 48 : 256,
      maxMoves: world ? worldSurvey : 24 });
  return { ...difficultyFields(d), edges: live.length, ...(world ? { perfectPlay: { ...proof, winner: d.winner } } : {}),
    ...assessOutcomeChoice(game, d.winner) };
}

function createAssessment(game) {
  const { board, live, firstSide, variant } = game;
  const root = createAnalysisSession(board, live, firstSide, variant);
  let proof = root.refine({ budgetMs: Infinity, nodeLimit: 256 });
  const survey = variant === 'redblue' ? createOpeningSurvey(board, live, firstSide) : null;
  const initial = survey?.snapshot(proof.winner);
  let difficulty = initial?.difficulty ?? estimateDifficulty(board, live, firstSide, variant,
    { analysis: proof, budgetMs: Infinity, nodeLimit: live.length, maxMoves: live.length });
  let screened = initial?.screened ?? difficulty.legalMoves, surveyNodes = initial?.nodes ?? difficulty.effort.nodes;
  const refineChoice = createWorldChoice(game, difficulty.winner);
  let choice = refineChoice(0);

  function progress() {
    const forced = choice.information === 'forced';
    const eligible = choice.information === 'skill';
    // A known policy outcome and the full tactical survey suffice for an
    // first price. Further search can still settle the seat advantage
    // and the difficulty interval used by the Elo forecast.
    const complete = forced || (eligible && !!difficulty.winner && difficulty.lower === difficulty.upper);
    return { ready: complete || (eligible && screened === difficulty.legalMoves), complete,
      positions: choice.searchNodes + surveyNodes + proof.nodes, outcomes: Object.keys(choice.witnesses).length,
      information: choice.information, screened, legalMoves: difficulty.legalMoves,
      lower: difficulty.lower, upper: difficulty.upper };
  }
  function advance() {
    if (choice.information === 'unresolved') choice = refineChoice(4);
    if (survey && choice.information !== 'forced' &&
        (screened < difficulty.legalMoves || !difficulty.winner || difficulty.lower !== difficulty.upper)) {
      if (!difficulty.winner) proof = root.refine({ budgetMs: Infinity, nodeLimit: 32 });
      const next = survey.advance(proof.winner ?? difficulty.winner);
      difficulty = next.difficulty;
      screened = next.screened;
      surveyNodes = next.nodes;
    }
    return progress();
  }
  function result() {
    const { nodes, cacheHits, durationMs, searchEdges, status, ...certificate } = proof;
    return { ...difficultyFields(difficulty), edges: live.length, perfectPlay: { ...certificate, winner: difficulty.winner },
      ...choice };
  }
  return { advance, progress, result };
}

// The deal can be issued before any proof or playout has run.
export function pendingOpening(game) {
  const moves = legalMoves(game.board, game.live, game.firstSide).length;
  return { winner: null, model: 'Opening assessment pending', score: 50, lower: 0, upper: 100, coverage: 0,
    legalMoves: moves, winningMoves: 0, losingMoves: 0, unknownMoves: moves, edges: game.live.length,
    information: 'unresolved', forcedWinner: null, certificate: 'pending', searchNodes: 0 };
}

/** Always use the untouched deal. Publish the first scoreable result promptly,
 * then refine it during play. Work caps apply per slice, never per game. */
export async function assessRatedOpening(game, { signal, onProgress, settleWhenReady = false } = {}) {
  signal?.throwIfAborted();
  if (game.moves.length || game.side !== game.firstSide) throw new Error('Assessment needs the original position.');
  const session = createAssessment(game);
  let progress = session.progress(), lastReport = performance.now();
  onProgress?.(progress, session.result());
  while (!progress.complete && !(settleWhenReady && progress.ready)) {
    await new Promise(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    const deadline = performance.now() + 35;
    const wasReady = progress.ready;
    do { progress = session.advance(); }
    while (!progress.complete && progress.ready === wasReady && performance.now() < deadline);
    if (progress.complete || progress.ready !== wasReady || performance.now() - lastReport >= 500) {
      onProgress?.(progress, session.result());
      lastReport = performance.now();
    }
  }
  return session.result();
}
