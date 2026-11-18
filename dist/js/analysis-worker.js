import { analysisModes, certificateKey, intersectProof, proofLimit, recentCache } from './analysis-modes.js?v=13';
import { createAnalysisSession } from './analysis-values.js?v=11';
import { createOpeningSurvey, estimateDifficulty } from './difficulty.js?v=13';

const sessions = recentCache(4);
const sliceMs = 65;
let active = null;
let timer = null;

// Cache entries carry cumulative work even when their internal search tree
// was evicted and restarted from a retained page certificate.
function openSession(board, variant, position) {
  const existing = sessions.get(position.key);
  if (existing) {
    existing.result = intersectProof(position.cached?.result, existing.result, position.side);
    return existing;
  }
  const previous = position.cached?.result;
  const session = createAnalysisSession(board, position.live, position.side, variant, { maxEntries: 3000 });
  const entry = { result: previous, refine };
  function refine(budgetMs, nodeLimit) {
    const fresh = session.refine({ budgetMs, nodeLimit });
    const total = { ...fresh, nodes: (previous?.nodes || 0) + fresh.nodes,
      durationMs: (previous?.durationMs || 0) + fresh.durationMs, cacheHits: (previous?.cacheHits || 0) + fresh.cacheHits };
    entry.result = intersectProof(entry.result, total, position.side);
    return entry.result;
  }
  refine(0, 0);
  return sessions.set(position.key, entry);
}

function* analyze(board, variant, position) {
  const mode = analysisModes[position.mode];
  const { cached = {}, assessCuts, side } = position;
  let { result, difficulty, difficultyRank = 0 } = cached;
  let entry;
  if (!proofLimit(result, mode)) {
    entry = openSession(board, variant, position);
    result = entry.result;
  }
  if (position.dailyWinner && !result.winner) result = { ...result, winner: position.dailyWinner };
  const initial = certificateKey(result);
  const reused = Boolean(cached.result && proofLimit(result, mode));

  // Publish structural arithmetic before exact search. Each yield returns
  // to the event loop so a stop or a replay change can supersede this job.
  let reason = proofLimit(result, mode);
  while (!reason) {
    yield { result, difficulty, difficultyRank, phase: 'searching' };
    const time = Math.min(sliceMs, mode.budgetMs - result.durationMs);
    entry.result = result;
    result = entry.refine(time, mode.nodeLimit - result.nodes);
    reason = proofLimit(result, mode);
  }
  if (assessCuts && ((difficultyRank < mode.rank && !(difficulty?.complete && difficulty.coverage === 1)) ||
      (result.winner && difficulty?.winner !== result.winner))) {
    yield { result, difficulty, difficultyRank, phase: 'assessing' };
    let grade;
    if (position.mode === 'indefinite' && result.kind !== 'green' && position.live.length <= 256) {
      const entry = openSession(board, variant, position);
      entry.survey ??= createOpeningSurvey(board, position.live, side);
      let pass = entry.survey.snapshot(result.winner);
      while (pass.screened < pass.difficulty.legalMoves || pass.difficulty.unknownMoves) {
        const until = performance.now() + sliceMs;
        do { pass = entry.survey.advance(result.winner); }
        while ((pass.screened < pass.difficulty.legalMoves || pass.difficulty.unknownMoves) && performance.now() < until);
        yield { result, difficulty: pass.difficulty, difficultyRank, phase: 'assessing' };
      }
      grade = pass.difficulty;
    } else grade = estimateDifficulty(board, position.live, side, variant, { ...mode.cuts, analysis: result });
    // An older pass may have checked more options on a faster slice. Keep
    // that evidence when the new sample leaves more of the index unresolved.
    if (!difficulty || grade.upper - grade.lower < difficulty.upper - difficulty.lower ||
        (grade.upper - grade.lower === difficulty.upper - difficulty.lower && grade.coverage >= difficulty.coverage) ||
        (grade.winner && !difficulty.winner)) difficulty = grade;
    difficultyRank = mode.rank;
    if (difficulty.winner && !result.winner) result = { ...result, winner: difficulty.winner };
  }
  yield { result, difficulty, difficultyRank, phase: 'finished', reason, reused, improved: certificateKey(result) !== initial };
}

function run(job) {
  if (active !== job) return;
  const work = job.queue.shift();
  try {
    const { value, done } = work.steps.next();
    if (!done) {
      self.postMessage({ id: job.id, type: 'update', index: work.index, ...value });
      if (value.phase !== 'finished') job.queue.push(work);
    }
    if (job.queue.length) timer = setTimeout(() => run(job), 0);
    else {
      active = null;
      self.postMessage({ id: job.id, type: 'done' });
    }
  } catch {
    // Leave any already published certificates available in the page cache.
    active = null;
    self.postMessage({ id: job.id, type: 'error' });
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    if (active?.id === data.id) {
      clearTimeout(timer);
      active = null;
    }
    self.postMessage({ id: data.id, type: 'cancelled' });
    return;
  }
  if (data.type !== 'start') return;
  clearTimeout(timer);
  const job = { id: data.id, queue: data.positions.map(position => ({
    index: position.index, steps: analyze(data.board, data.variant, position)
  })) };
  active = job;
  timer = setTimeout(() => run(job), 0);
};
