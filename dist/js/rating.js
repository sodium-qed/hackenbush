import { MAP_COUNT, nextMapSeed } from './map-seed.js';
import { COMPUTER_LEVELS, computerLevelLabel } from './opponents.js';
import { RATED_BOT_BY_ID } from './rated-bots.js';
import { isRatedBot, RATED_BOARD_VERSION, ratedBotMove, ratedDeal } from './rated-deal.js';
import { createGame, expireTurn, playCut, restoreGame, saveData, startTurnClock, TURN_MS } from './session.js';
import { initialEdges, legalMoves, otherSide } from './rules.js';
import { forecastOpening, isProvisional, LEGACY_RATING_SHIFT, newPool, ratedBotSummary } from './rating-model.js';
import { assessRatedOpening, pendingOpening, prepareRatedOpening } from './rating-opening.js';

export { prepareRatedOpening, ratedBotSummary };
export const RATING_KEY = 'groundwork.hackenbush.ratings';
export const HISTORY_PER_VARIANT = 40;
export const RATED_OPENING_MS = 2000;
const BOT_DELAY_MS = 700;
const FORMAT = 5;
const variants = ['green', 'redblue'];
const sides = ['blue', 'red'];
const sameRealmWrites = new WeakMap();
const safeCount = n => Number.isSafeInteger(n) && n >= 0;
const inRange = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
const validDate = n => safeCount(n) && n <= 8_640_000_000_000_000;
const validId = id => typeof id === 'string' && /^rated-[0-9a-f]{32}$/.test(id);

function validPolicy(version, level) {
  return version === 1 ? typeof level === 'string' && Object.hasOwn(COMPUTER_LEVELS, level) : version === RATED_BOARD_VERSION && isRatedBot(level);
}

export function createRatedGame(variant, level, seed, id, boardVersion = RATED_BOARD_VERSION, timed = boardVersion === RATED_BOARD_VERSION) {
  if (!variants.includes(variant) || !validPolicy(boardVersion, level)) throw new RangeError('Invalid rated configuration.');
  const deal = ratedDeal(seed, boardVersion), opponent = otherSide(deal.seat);
  const name = boardVersion === 1 ? computerLevelLabel(level) : RATED_BOT_BY_ID[level].name;
  return createGame({ ...deal, variant, matchId: id, opponent: 'computer', timed,
    players: { [deal.seat]: { kind: 'human', name: 'You' }, [opponent]: { kind: 'computer', name, level } } });
}

function emptyLedger(status = 'ok') {
  return { status, version: FORMAT, epoch: null, issued: 0, stream: null,
    pools: { green: newPool(), redblue: newPool() }, active: null, history: [] };
}

function validMoment(value, shift = LEGACY_RATING_SHIFT) {
  return value && inRange(value.rating, -100000 + shift, 100000 + shift) && Number.isFinite(value.rd) && value.rd > 0 && value.rd <= 1000;
}

function validPool(pool, shift) {
  return validMoment(pool, shift) && safeCount(pool.games) && safeCount(pool.ratedGames) &&
    pool.ratedGames <= pool.games && safeCount(pool.wins) && safeCount(pool.losses) &&
    pool.wins + pool.losses === pool.games && pool.provisional === isProvisional(pool.ratedGames, pool.rd);
}

function validOpening(o, { boardVersion, variant }) {
  return o && (sides.includes(o.winner) || (boardVersion === 5 && o.winner === null && (variant === 'redblue' || o.certificate === 'pending'))) &&
    ['skill', 'forced', 'unresolved'].includes(o.information) &&
    (o.information === 'forced' ? sides.includes(o.forcedWinner) : o.forcedWinner === null) &&
    typeof o.model === 'string' && typeof o.certificate === 'string' && safeCount(o.searchNodes) &&
    inRange(o.score, 0, 100) && inRange(o.lower, 0, o.score) && inRange(o.upper, o.score, 100) && inRange(o.coverage, 0, 1) &&
    [o.legalMoves, o.winningMoves, o.losingMoves, o.unknownMoves, o.edges].every(safeCount) &&
    o.legalMoves === o.winningMoves + o.losingMoves + o.unknownMoves && o.legalMoves <= o.edges &&
    o.edges > 0 && o.edges <= (boardVersion === 1 ? 22 : 256);
}

function validBot(bot, level) {
  return bot?.level === level && Number.isFinite(bot.rating) && inRange(bot.sd, 0, 10000) &&
    Number.isFinite(bot.modelRating) && inRange(bot.modelSd, 0, 10000) && typeof bot.calibration === 'string';
}

function sameAssignment(a, game) {
  return a && game && game.matchId === a.id && game.opponent === 'computer' && game.timed === a.timed &&
    game.seed === a.seed && game.variant === a.variant &&
    game.seat === a.seat && game.firstSide === a.firstSide && game.boardVersion === a.boardVersion &&
    game.difficulty === a.difficulty && game.players?.[a.seat]?.kind === 'human' &&
    game.players?.[otherSide(a.seat)]?.kind === 'computer' && game.players[otherSide(a.seat)].level === a.level;
}

function validAssignment(a, inspectSession) {
  if (!a || !validId(a.id) || !variants.includes(a.variant) || !validPolicy(a.boardVersion, a.level) || typeof a.timed !== 'boolean' ||
      typeof a.seed !== 'string' || !/^[0-9A-F]{6}$/.test(a.seed) || !sides.includes(a.seat) || !sides.includes(a.firstSide) ||
      (a.assessmentPending !== undefined && (typeof a.assessmentPending !== 'boolean' || !safeCount(a.assessmentWork) ||
        typeof a.assessmentReady !== 'boolean')) || !validOpening(a.opening, a) || !validBot(a.bot, a.level) || !inRange(a.expected, 0, 1) ||
      !sameAssignment(a, a.game) || !Array.isArray(a.game.moves) || a.game.moves.length > a.opening.edges ||
      !a.game.moves.every(id => typeof id === 'string' && /^e(?:0|[1-9]\d{0,2})$/.test(id) && Number(id.slice(1)) < a.opening.edges)) return null;
  const deal = ratedDeal(a.seed, a.boardVersion);
  if (a.seat !== deal.seat || a.firstSide !== deal.firstSide || a.difficulty !== deal.difficulty) return null;
  const session = inspectSession(a.game);
  if (!session || session.edges !== a.opening.edges || session.legalMoves !== a.opening.legalMoves ||
      (a.boardVersion === 5 && session.family !== a.family)) return null;
  return session;
}

function validRecord(r, inspectSession, shift) {
  const session = validAssignment(r, inspectSession);
  return session && validDate(r.startedAt) && validDate(r.endedAt) && typeof r.won === 'boolean' &&
    typeof r.rated === 'boolean' && r.rated === (r.opening.information === 'skill') &&
    r.game.deadline === null && (r.reason === 'timeout' ? sides.includes(r.game.timedOut) :
      r.game.timedOut === null && (r.won ? r.reason === 'win' : ['loss', 'forfeit'].includes(r.reason))) &&
    session.victor === (r.reason === 'forfeit' ? null : r.won ? r.seat : otherSide(r.seat)) &&
    validMoment({ rating: r.before, rd: r.rdBefore }, shift) && validMoment({ rating: r.after, rd: r.rdAfter }, shift) &&
    Number.isFinite(r.delta) && typeof r.model === 'string';
}

function validActive(a, inspectSession, shift) {
  const session = validAssignment(a, inspectSession);
  return session && !session.victor && a.game.timedOut === null &&
    (a.timed ? validDate(a.game.deadline) && a.game.deadline >= TURN_MS : a.game.deadline === null) &&
    validDate(a.startedAt) && validMoment(a.forecast?.win, shift) && validMoment(a.forecast?.loss, shift) &&
    a.forecast.expected === a.expected && a.forecast.rated === (a.opening.information === 'skill') &&
    (a.forecast.deltas === undefined || (Number.isFinite(a.forecast.deltas?.win) && Number.isFinite(a.forecast.deltas?.loss))) &&
    typeof a.forecast.model === 'string' && typeof a.forecast.calibration === 'string';
}

function trimHistory(history) {
  const counts = { green: 0, redblue: 0 }, pendingThrough = { green: -1, redblue: -1 };
  // Keep the suffix needed to recalculate later receipts in match order if
  // an earlier game ended before its opening could be priced.
  history.forEach((row, i) => { if (row.assessmentPending) pendingThrough[row.variant] = i; });
  return history.filter((row, i) => ++counts[row.variant] <= HISTORY_PER_VARIANT || i <= pendingThrough[row.variant]);
}

// The v1 interchange layout kept the same receipts in per-variant lists.
// Merge on read. Commit the migration only with a successful later mutation.
function decode(raw, inspectSession) {
  if (raw === null) return emptyLedger();
  const data = JSON.parse(raw);
  if (Number.isInteger(data?.version) && data.version > FORMAT) return emptyLedger('newer');
  if (data?.version === 1 && variants.every(v => Array.isArray(data.pools?.[v]?.history))) {
    const records = variants.flatMap(v => data.pools[v].history);
    data.history = records.sort((a, b) => b.endedAt - a.endedAt);
    for (const v of variants) delete data.pools[v].history;
    data.version = 2;
  }
  const shift = data?.version === 2 ? 0 : LEGACY_RATING_SHIFT;
  if (![2, 3, 4, FORMAT].includes(data?.version) || !validId(data.epoch) || !safeCount(data.issued) || data.issued > MAP_COUNT ||
      !variants.every(v => validPool(data.pools?.[v], shift)) || !Array.isArray(data.history) ||
      !data.history.every(r => validRecord(r, inspectSession, shift)) || trimHistory(data.history).length !== data.history.length ||
      !(data.active === null || validActive(data.active, inspectSession, shift))) return emptyLedger('invalid');
  const stream = data.stream;
  if (data.issued === 0 ? stream !== null : !stream || !safeCount(stream.current) || stream.current >= MAP_COUNT ||
      !safeCount(stream.step) || stream.step >= MAP_COUNT || !(stream.step & 1)) return emptyLedger('invalid');
  if (data.issued !== data.pools.green.games + data.pools.redblue.games + Number(data.active !== null)) return emptyLedger('invalid');
  if (data.version === 2) {
    const assignments = data.active ? [...data.history, data.active] : data.history;
    if (assignments.some(a => a.boardVersion !== 1)) return emptyLedger('invalid');
    for (const a of assignments) {
      a.bot.rating += LEGACY_RATING_SHIFT;
      a.bot.modelRating += LEGACY_RATING_SHIFT;
      a.bot.sourceKind = 'legacy-fit';
    }
    for (const r of data.history) {
      r.before += LEGACY_RATING_SHIFT;
      r.after += LEGACY_RATING_SHIFT;
    }
    if (data.active) {
      const { forecast } = data.active;
      const oldRating = data.pools[data.active.variant].rating;
      // Adding 200 can round the last bit. Keep the originally priced changes.
      forecast.deltas = { win: forecast.win.rating - oldRating, loss: forecast.loss.rating - oldRating };
      forecast.win.rating += LEGACY_RATING_SHIFT;
      forecast.loss.rating += LEGACY_RATING_SHIFT;
      if (Number.isFinite(forecast.offset)) forecast.offset -= LEGACY_RATING_SHIFT;
    }
    for (const v of variants) data.pools[v].rating += LEGACY_RATING_SHIFT;
  }
  data.version = FORMAT;
  return { ...data, status: 'ok' };
}

function browserValue(name) {
  try { return globalThis[name]; } catch { return null; }
}

function withDatabaseLock(dbApi, work) {
  // LocalStorage has atomic writes but lacks read/modify/write transactions.
  // An exclusive IndexedDB transaction serializes the short synchronous edit
  // across tabs when Web Locks aren't exposed. No profile data goes in this DB.
  return new Promise((resolve, reject) => {
    const open = dbApi.open(RATING_KEY + '.guard', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('guard');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('guard', 'readwrite');
      let result;
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => { db.close(); resolve(result); };
      const get = tx.objectStore('guard').get('ledger');
      get.onsuccess = () => {
        try { result = work(); } catch (error) { tx.abort(); reject(error); }
      };
    };
  });
}

function randomId(entropy) {
  const words = entropy.getRandomValues(new Uint32Array(4));
  return 'rated-' + Array.from(words, n => n.toString(16).padStart(8, '0')).join('');
}

function failed(reason, state) { return { ok: false, reason, state }; }
function success(state, extra = {}) { return { ok: true, state, active: state.active, ...extra }; }

/** The next event can be recovered from the saved position even if every tab closed. */
export function ratedClockEvent(active) {
  if (!active?.timed || active.game.deadline === null) return null;
  const side = active.game.moves.length % 2 ? otherSide(active.firstSide) : active.firstSide;
  return side === active.seat ? active.game.deadline : active.game.deadline - TURN_MS + BOT_DELAY_MS;
}

function localBotDecision(game) {
  const start = performance.now();
  const { edgeId } = ratedBotMove(game.board, game.live, game.side, game.players[game.side].level, game.seed, game.moves.length);
  return { edgeId, elapsedMs: performance.now() - start };
}

/** The single pending assignment, deck cursor, ratings and receipts share one
 * atomic storage value. Board preparation is outside every write lock. */
export function createRatingStore(options = {}) {
  const storage = 'storage' in options ? options.storage : browserValue('localStorage');
  const locks = 'locks' in options ? options.locks : browserValue('navigator')?.locks;
  const dbApi = 'indexedDB' in options ? options.indexedDB : browserValue('indexedDB');
  const entropy = options.entropy ?? browserValue('crypto');
  const clock = options.clock ?? Date.now;
  const prepare = options.prepareOpening ?? assessRatedOpening;
  const chooseBot = options.chooseBot ?? localBotDecision;
  const jobs = new Map();
  let scheduled = false;
  function scheduleAssessments() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; assessPending(); }, 0);
  }

  // Validating an old receipt means replaying its legal moves on the original
  // board. Keep only the small validation result, keyed by the exact snapshot,
  // so a new cut does not regenerate up to eighty unchanged full gardens.
  const checkedSessions = new Map();
  function inspectSession(saved) {
    const key = JSON.stringify(saved);
    let info = checkedSessions.get(key);
    if (info) checkedSessions.delete(key);
    else {
      // Validate the recorded position independently of when it is being read.
      // Only a locked clock transaction can turn a deadline into a rating result.
      const game = restoreGame(saved, 0);
      if (!game) return null;
      info = { edges: game.board.edges.length, legalMoves: legalMoves(game.board, initialEdges(game.board), game.firstSide).length,
        family: game.board.family, victor: game.victor };
    }
    checkedSessions.set(key, info);
    if (checkedSessions.size > HISTORY_PER_VARIANT * variants.length + 1) checkedSessions.delete(checkedSessions.keys().next().value);
    return info;
  }

  function read() {
    if (!storage) return emptyLedger('unavailable');
    let raw;
    try { raw = storage.getItem(RATING_KEY); } catch { return emptyLedger('unavailable'); }
    try { return decode(raw, inspectSession); } catch { return emptyLedger('invalid'); }
  }

  async function locked(work) {
    if (!storage) return failed('unavailable', emptyLedger('unavailable'));
    try {
      if (locks?.request) return await locks.request(RATING_KEY, work);
      if (dbApi?.open) return await withDatabaseLock(dbApi, work);
      // Storage-only environments can still serialize every writer in this JS
      // realm. The production GitHub Pages context supports cross-tab locks.
      const previous = sameRealmWrites.get(storage) ?? Promise.resolve();
      const pending = previous.then(work, work);
      sameRealmWrites.set(storage, pending.catch(() => {}));
      return await pending;
    } catch { return failed('unavailable', read()); }
  }

  function write(state, extra) {
    const { status, ...data } = state;
    try { storage.setItem(RATING_KEY, JSON.stringify(data)); }
    catch { return failed('unavailable', read()); }
    scheduleAssessments();
    return success(state, extra);
  }

  async function start(variant, level, settings = {}) {
    const { signal } = settings;
    const before = read();
    if (signal?.aborted) return failed('cancelled', before);
    if (before.status !== 'ok') return failed(before.status, before);
    if (!variants.includes(variant) || (!isRatedBot(level) && !(before.active && level === before.active.level))) return failed('ineligible', before);
    if (before.active) return resume(before.active.id);
    if (before.issued >= MAP_COUNT) return failed('exhausted', before);
    if (!entropy?.getRandomValues) return failed('unavailable', before);
    let draw, game, opening, forecast, bot;
    try {
      draw = nextMapSeed(before.stream, entropy);
      game = createRatedGame(variant, level, draw.seed, randomId(entropy));
      opening = pendingOpening(game);
      if (!validOpening(opening, game) || opening.edges !== game.live.length ||
          opening.legalMoves !== legalMoves(game.board, game.live, game.firstSide).length) return failed('prepare-failed', before);
      forecast = forecastOpening(before.pools[variant], game, opening);
      bot = ratedBotSummary(variant, level);
      if (!validMoment(forecast.win) || !validMoment(forecast.loss) || !validBot(bot, level)) return failed('prepare-failed', before);
    } catch { return failed(signal?.aborted ? 'cancelled' : 'prepare-failed', before); }
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      if (signal?.aborted) return failed('cancelled', state);
      if (state.active) return success(state);
      if (state.epoch !== before.epoch || state.issued !== before.issued) return failed('stale', state);
      if (!state.epoch) state.epoch = randomId(entropy);
      state.issued++;
      state.stream = draw.state;
      const startedAt = clock();
      game = startTurnClock(game, startedAt + RATED_OPENING_MS);
      state.active = { id: game.matchId, seed: game.seed, variant, level, seat: game.seat, firstSide: game.firstSide,
        boardVersion: game.boardVersion, difficulty: game.difficulty, family: game.board.family, timed: game.timed, game: saveData(game),
        startedAt, bot, opening, forecast, expected: forecast.expected, assessmentPending: true, assessmentReady: false, assessmentWork: 0 };
      return write(state);
    });
  }

  function matches(game) {
    if (!validId(game?.matchId)) return false;
    const { active, history } = read();
    return Boolean(sameAssignment(active, game) || history.some(r => r.id === game.matchId && sameAssignment(r, game)));
  }

  function settle(state, game, reason, endedAt = clock()) {
    const active = state.active, pool = state.pools[active.variant];
    const won = game.victor === active.seat;
    const { rated, model, calibration } = active.forecast;
    const outcome = won ? 'win' : 'loss';
    const next = active.forecast[outcome];
    const { forecast, ...assignment } = active;
    const record = { ...assignment, game: saveData({ ...game, deadline: null }), endedAt, reason, won, rated, model, calibration,
      nuisanceSd: forecast.nuisanceSd, transferSd: forecast.transferSd,
      before: pool.rating, after: next.rating, delta: forecast.deltas?.[outcome] ?? next.rating - pool.rating,
      rdBefore: pool.rd, rdAfter: next.rd, ...(active.assessmentPending === undefined ? {} : { assessmentPending: active.assessmentPending && !active.assessmentReady }) };
    const ratedGames = pool.ratedGames + Number(rated);
    state.pools[active.variant] = { ...next, games: pool.games + 1, ratedGames, wins: pool.wins + Number(won),
      losses: pool.losses + Number(!won), provisional: isProvisional(ratedGames, next.rd) };
    state.history = trimHistory([record, ...state.history]);
    state.active = null;
    return write(state, { record });
  }

  function priceActive(state, entry) {
    entry.forecast = forecastOpening(state.pools[entry.variant], entry.game, entry.opening);
    entry.expected = entry.forecast.expected;
  }

  function repriceFrom(state, index) {
    const first = state.history[index], pool = state.pools[first.variant];
    let moment = { rating: first.before, rd: first.rdBefore };
    for (let i = index; i >= 0; i--) {
      const row = state.history[i];
      if (row.variant !== first.variant) continue;
      const forecast = forecastOpening(moment, row.game, row.opening);
      pool.ratedGames += Number(forecast.rated) - Number(row.rated);
      const after = forecast[row.won ? 'win' : 'loss'];
      Object.assign(row, { before: moment.rating, rdBefore: moment.rd, after: after.rating, rdAfter: after.rd,
        delta: after.rating - moment.rating, rated: forecast.rated, expected: forecast.expected,
        nuisanceSd: forecast.nuisanceSd, transferSd: forecast.transferSd });
      moment = after;
    }
    Object.assign(pool, moment, { provisional: isProvisional(pool.ratedGames, moment.rd) });
    if (state.active?.variant === first.variant) priceActive(state, state.active);
    state.history = trimHistory(state.history);
  }

  function saveEvidence(id, opening, progress) {
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      const active = state.active?.id === id;
      const index = active ? -1 : state.history.findIndex(row => row.id === id);
      const entry = active ? state.active : state.history[index];
      if (!entry?.assessmentPending || progress.positions < entry.assessmentWork ||
          (!active && !progress.ready) || !validOpening(opening, entry) ||
          opening.edges !== entry.opening.edges || opening.legalMoves !== entry.opening.legalMoves) return success(state);
      entry.opening = opening;
      entry.assessmentWork = progress.positions;
      entry.assessmentReady = progress.ready;
      entry.assessmentPending = active ? !progress.complete : false;
      if (active) priceActive(state, entry);
      else repriceFrom(state, index);
      const result = write(state, { updated: true });
      if (result.ok) options.onAssessmentChange?.(entry.id);
      return result;
    });
  }

  // At most one live game and one older receipt use workers in this tab.
  // Reconstructing from the deal (never the saved moves) also handles reloads.
  function assessPending() {
    const state = read();
    const oldest = state.history.findLast(row => row.assessmentPending);
    const entries = [state.active, oldest].filter(entry => entry?.assessmentPending);
    const ids = new Set(entries.map(entry => entry.id));
    for (const [id, job] of jobs) if (!ids.has(id)) job.abort();
    for (const entry of entries) {
      if (jobs.has(entry.id)) continue;
      const control = new AbortController();
      jobs.set(entry.id, control);
      const original = createRatedGame(entry.variant, entry.level, entry.seed, entry.id, entry.boardVersion, entry.timed);
      let lastKey = '', lastWork = 0;
      const change = (progress, opening) => {
        if (control.signal.aborted) return;
        lastWork = progress.positions;
        options.onAssessmentProgress?.(entry.id, progress);
        const key = [progress.ready, progress.complete, opening.information, opening.winner, opening.lower, opening.upper,
          opening.winningMoves, opening.losingMoves].join('|');
        if (key === lastKey) return;
        lastKey = key;
        void saveEvidence(entry.id, opening, progress);
      };
      Promise.resolve().then(() => prepare(original, { signal: control.signal, onProgress: change,
        settleWhenReady: entry !== state.active })).then(async opening => {
        if (control.signal.aborted) return;
        if (opening.information === 'unresolved') throw new Error('Opening still pending');
        const saved = await saveEvidence(entry.id, opening, { ready: true, complete: true,
          positions: Math.max(lastWork, opening.searchNodes) });
        if (!saved.ok) throw new Error('Opening could not be saved');
      }).catch(() => {
        if (!control.signal.aborted) setTimeout(scheduleAssessments, 2000);
      }).finally(() => {
        if (jobs.get(entry.id) === control) jobs.delete(entry.id);
      });
    }
  }

  function assignmentResult(state, id) {
    if (state.status !== 'ok') return failed(state.status, state);
    if (state.active?.id === id) return success(state);
    const record = state.history.find(row => row.id === id);
    return record ? success(state, { record }) : failed('ineligible', state);
  }

  function saveCut(state, game, cutAt, observedAt) {
    if (game.victor) return settle(state, game, game.victor === state.active.seat ? 'win' : 'loss', cutAt);
    const armed = startTurnClock(game, cutAt);
    if (armed.timed && armed.side === armed.seat && observedAt >= armed.deadline) {
      return settle(state, expireTurn(armed, observedAt), 'timeout', armed.deadline);
    }
    state.active.game = saveData(armed);
    return write(state);
  }

  async function resume(id) {
    const found = assignmentResult(read(), id);
    if (!found.ok || found.record) return found;
    if (found.active.timed) return refreshClock(id);
    // Existing untimed assignments retain their original map, moves and price.
    // Their first clock begins only when the player actually returns to the board.
    return locked(() => {
      const latest = assignmentResult(read(), id);
      if (!latest.ok || latest.record || latest.active.timed) return latest;
      const active = latest.active;
      const game = restoreGame({ ...active.game, timed: true }, 0);
      if (!game) return failed('invalid', latest.state);
      active.timed = true;
      active.game = saveData(startTurnClock(game, clock() + (game.moves.length ? 0 : RATED_OPENING_MS)));
      return write(latest.state);
    });
  }

  async function refreshClock(id) {
    const found = assignmentResult(read(), id);
    if (!found.ok || found.record) return found;
    const active = found.active;
    const due = ratedClockEvent(active);
    if (due === null || clock() < due) return found;
    const game = restoreGame(active.game, 0);
    const botTurn = game.side !== game.seat;
    let decision;
    if (botTurn) {
      // Reconstruct the deterministic reply when a tab was asleep. Charge the
      // bot for its search, without making browser timer throttling a free win.
      try { decision = await chooseBot(game, game.deadline - due); } catch { return failed('bot-failed', found.state); }
      if (!Number.isFinite(decision?.elapsedMs) || decision.elapsedMs < 0) return failed('bot-failed', found.state);
    }
    return locked(() => {
      const latest = assignmentResult(read(), id);
      if (!latest.ok || latest.record) return latest;
      const current = latest.active.game;
      if (current.moves.length !== game.moves.length || current.deadline !== game.deadline) return latest;
      if (!botTurn) return settle(latest.state, expireTurn(game, due), 'timeout', due);
      const cutAt = due + Math.ceil(decision.elapsedMs);
      if (cutAt >= game.deadline) return settle(latest.state, expireTurn(game, game.deadline), 'timeout', game.deadline);
      const next = playCut(game, decision.edgeId, cutAt);
      if (!next) return failed('bot-failed', latest.state);
      return saveCut(latest.state, next, cutAt, clock());
    });
  }

  function advance(candidate, finish) {
    const receivedAt = clock();
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      const active = state.active;
      if (!sameAssignment(active, candidate)) {
        const record = state.history.find(r => sameAssignment(r, candidate));
        return record ? success(state, { record }) : failed('ineligible', state);
      }
      const before = active.game.moves, moves = candidate.moves;
      if (!Array.isArray(moves) || moves.length < before.length || moves.length > before.length + 1 ||
          !before.every((id, i) => moves[i] === id)) return failed('stale', state);
      let game = restoreGame(active.game, 0);
      if (!game) return failed('invalid', state);
      if (game.timed && receivedAt >= game.deadline) {
        if (game.side === game.seat) return settle(state, expireTurn(game, receivedAt), 'timeout', game.deadline);
        return failed('stale', state);
      }
      if (moves.length === before.length + 1) {
        const id = moves.at(-1);
        if (game.side !== game.seat && ratedBotMove(game.board, game.live, game.side, active.level,
          game.seed, before.length).edgeId !== id) return failed('ineligible', state);
        game = playCut(game, id, receivedAt);
        if (!game) return failed('ineligible', state);
      }
      if (game.victor !== candidate.victor) return failed('ineligible', state);
      if (finish && !game.victor) return failed('unfinished', state);
      if (before.length === moves.length) return success(state);
      return saveCut(state, game, receivedAt, clock());
    });
  }

  async function forfeit(id) {
    const result = await refreshClock(id);
    if (!result.ok || result.record) return result;
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      if (!state.active || state.active.id !== id) {
        const record = state.history.find(r => r.id === id);
        return record ? success(state, { record }) : failed('ineligible', state);
      }
      const game = restoreGame(state.active.game, 0);
      if (!game) return failed('invalid', state);
      if (game.timed && game.side === game.seat && clock() >= game.deadline) {
        return settle(state, expireTurn(game, game.deadline), 'timeout', game.deadline);
      }
      return settle(state, game, game.victor ? (game.victor === game.seat ? 'win' : 'loss') : 'forfeit');
    });
  }

  function reset() {
    return locked(() => {
      const existing = read();
      if (existing.status === 'newer') return failed('newer', existing);
      if (!entropy?.getRandomValues) return failed('unavailable', existing);
      const state = emptyLedger();
      state.epoch = randomId(entropy);
      return write(state);
    });
  }

  return { read, start, resume, refreshClock, matches, assessPending, checkpoint: game => advance(game, false), finish: game => advance(game, true),
    forfeit, reset };
}
