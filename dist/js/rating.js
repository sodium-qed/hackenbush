import { MAP_COUNT, nextMapSeed } from './map-seed.js';
import { COMPUTER_LEVELS, computerLevelLabel } from './opponents.js';
import { ratedBotMove, ratedDeal } from './rated-deal.js';
import { createGame, playCut, restoreGame, saveData } from './session.js';
import { otherSide } from './rules.js';
import { forecastOpening, isProvisional, newPool, ratedBotSummary } from './rating-model.js';
import { prepareRatedOpening } from './rating-opening.js';

export { prepareRatedOpening, ratedBotSummary };
export const RATING_KEY = 'groundwork.hackenbush.ratings';
export const HISTORY_PER_VARIANT = 40;
const FORMAT = 2;
const variants = ['green', 'redblue'];
const sides = ['blue', 'red'];
const sameRealmWrites = new WeakMap();
const safeCount = n => Number.isSafeInteger(n) && n >= 0;
const inRange = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
const validDate = n => safeCount(n) && n <= 8_640_000_000_000_000;
const isLevel = name => typeof name === 'string' && Object.hasOwn(COMPUTER_LEVELS, name);
const validId = id => typeof id === 'string' && /^rated-[0-9a-f]{32}$/.test(id);

function emptyLedger(status = 'ok') {
  return { status, version: FORMAT, epoch: null, issued: 0, stream: null,
    pools: { green: newPool(), redblue: newPool() }, active: null, history: [] };
}

function validMoment(value) {
  return value && inRange(value.rating, -100000, 100000) && Number.isFinite(value.rd) && value.rd > 0 && value.rd <= 1000;
}

function validPool(pool) {
  return validMoment(pool) && safeCount(pool.games) && safeCount(pool.ratedGames) &&
    pool.ratedGames <= pool.games && safeCount(pool.wins) && safeCount(pool.losses) &&
    pool.wins + pool.losses === pool.games && pool.provisional === isProvisional(pool.ratedGames, pool.rd);
}

function validOpening(o) {
  return o && sides.includes(o.winner) && ['skill', 'forced', 'unresolved'].includes(o.information) &&
    (o.information === 'forced' ? sides.includes(o.forcedWinner) : o.forcedWinner === null) &&
    typeof o.model === 'string' && typeof o.certificate === 'string' && safeCount(o.searchNodes) &&
    inRange(o.score, 0, 100) && inRange(o.lower, 0, o.score) && inRange(o.upper, o.score, 100) && inRange(o.coverage, 0, 1) &&
    [o.legalMoves, o.winningMoves, o.losingMoves, o.unknownMoves, o.edges].every(safeCount) &&
    o.legalMoves === o.winningMoves + o.losingMoves + o.unknownMoves && o.legalMoves <= o.edges && o.edges <= 22;
}

function validBot(bot, level) {
  return bot?.level === level && Number.isFinite(bot.rating) && inRange(bot.sd, 0, 10000) &&
    Number.isFinite(bot.modelRating) && inRange(bot.modelSd, 0, 10000) && typeof bot.calibration === 'string';
}

function sameAssignment(a, game) {
  return a && game && game.matchId === a.id && game.opponent === 'computer' && game.timed === false &&
    game.timedOut === null && game.deadline === null && game.seed === a.seed && game.variant === a.variant &&
    game.seat === a.seat && game.firstSide === a.firstSide && game.boardVersion === a.boardVersion &&
    game.difficulty === a.difficulty && game.players?.[a.seat]?.kind === 'human' &&
    game.players?.[otherSide(a.seat)]?.kind === 'computer' && game.players[otherSide(a.seat)].level === a.level;
}

function validAssignment(a) {
  if (!a || !validId(a.id) || !variants.includes(a.variant) || !isLevel(a.level) ||
      typeof a.seed !== 'string' || !/^[0-9A-F]{6}$/.test(a.seed) || !sides.includes(a.seat) || !sides.includes(a.firstSide) ||
      !validOpening(a.opening) || !validBot(a.bot, a.level) || !inRange(a.expected, 0, 1) ||
      !sameAssignment(a, a.game) || !Array.isArray(a.game.moves) || a.game.moves.length > a.opening.edges ||
      !a.game.moves.every(id => typeof id === 'string' && /^e(?:0|[1-9]\d?)$/.test(id) && Number(id.slice(1)) < a.opening.edges)) return false;
  const deal = ratedDeal(a.seed);
  return a.seat === deal.seat && a.firstSide === deal.firstSide &&
    a.boardVersion === deal.boardVersion && a.difficulty === deal.difficulty;
}

function validRecord(r) {
  return validAssignment(r) && validDate(r.startedAt) && validDate(r.endedAt) && typeof r.won === 'boolean' &&
    typeof r.rated === 'boolean' && r.rated === (r.opening.information === 'skill') &&
    (r.won ? r.reason === 'win' : ['loss', 'forfeit'].includes(r.reason)) &&
    validMoment({ rating: r.before, rd: r.rdBefore }) && validMoment({ rating: r.after, rd: r.rdAfter }) &&
    Number.isFinite(r.delta) && typeof r.model === 'string';
}

function validActive(a) {
  return validAssignment(a) && validDate(a.startedAt) && restoreGame(a.game) !== null && validMoment(a.forecast?.win) && validMoment(a.forecast?.loss) &&
    a.forecast.expected === a.expected && a.forecast.rated === (a.opening.information === 'skill') &&
    typeof a.forecast.model === 'string' && typeof a.forecast.calibration === 'string';
}

function trimHistory(history) {
  const counts = { green: 0, redblue: 0 };
  return history.filter(record => ++counts[record.variant] <= HISTORY_PER_VARIANT);
}

// The v1 interchange layout kept the same receipts in per-variant lists.
// Merge on read. Commit the migration only with a successful later mutation.
function decode(raw) {
  if (raw === null) return emptyLedger();
  if (raw.length > 1_000_000) return emptyLedger('invalid');
  const data = JSON.parse(raw);
  if (Number.isInteger(data?.version) && data.version > FORMAT) return emptyLedger('newer');
  if (data?.version === 1 && variants.every(v => Array.isArray(data.pools?.[v]?.history))) {
    const records = variants.flatMap(v => data.pools[v].history);
    data.history = records.sort((a, b) => b.endedAt - a.endedAt);
    for (const v of variants) delete data.pools[v].history;
    data.version = FORMAT;
  }
  if (data?.version !== FORMAT || !validId(data.epoch) || !safeCount(data.issued) || data.issued > MAP_COUNT ||
      !variants.every(v => validPool(data.pools?.[v])) || !Array.isArray(data.history) ||
      data.history.length > HISTORY_PER_VARIANT * variants.length || !data.history.every(validRecord) ||
      !(data.active === null || validActive(data.active))) return emptyLedger('invalid');
  const stream = data.stream;
  if (data.issued === 0 ? stream !== null : !stream || !safeCount(stream.current) || stream.current >= MAP_COUNT ||
      !safeCount(stream.step) || stream.step >= MAP_COUNT || !(stream.step & 1)) return emptyLedger('invalid');
  if (data.issued !== data.pools.green.games + data.pools.redblue.games + Number(data.active !== null)) return emptyLedger('invalid');
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

/** The single pending assignment, deck cursor, ratings and receipts share one
 * atomic storage value. Board preparation is outside every write lock. */
export function createRatingStore(options = {}) {
  const storage = 'storage' in options ? options.storage : browserValue('localStorage');
  const locks = 'locks' in options ? options.locks : browserValue('navigator')?.locks;
  const dbApi = 'indexedDB' in options ? options.indexedDB : browserValue('indexedDB');
  const entropy = options.entropy ?? browserValue('crypto');
  const clock = options.clock ?? Date.now;
  const prepare = options.prepareOpening ?? prepareRatedOpening;

  function read() {
    if (!storage) return emptyLedger('unavailable');
    let raw;
    try { raw = storage.getItem(RATING_KEY); } catch { return emptyLedger('unavailable'); }
    try { return decode(raw); } catch { return emptyLedger('invalid'); }
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
    return success(state, extra);
  }

  function newGame(variant, level, seed, id) {
    const deal = ratedDeal(seed), bot = otherSide(deal.seat);
    return createGame({ ...deal, variant, matchId: id, opponent: 'computer', timed: false,
      players: { [deal.seat]: { kind: 'human', name: 'You' },
        [bot]: { kind: 'computer', name: computerLevelLabel(level), level } } });
  }

  async function start(variant, level) {
    const before = read();
    if (before.status !== 'ok') return failed(before.status, before);
    if (!variants.includes(variant) || !isLevel(level)) return failed('ineligible', before);
    if (before.active) return success(before);
    if (before.issued >= MAP_COUNT) return failed('exhausted', before);
    if (!entropy?.getRandomValues) return failed('unavailable', before);
    let draw, game, opening, forecast, bot;
    try {
      draw = nextMapSeed(before.stream, entropy);
      game = newGame(variant, level, draw.seed, randomId(entropy));
      opening = await prepare(game);
      if (!validOpening(opening)) return failed('prepare-failed', before);
      forecast = forecastOpening(before.pools[variant], game, opening);
      bot = ratedBotSummary(variant, level);
      if (!validMoment(forecast.win) || !validMoment(forecast.loss) || !validBot(bot, level)) return failed('prepare-failed', before);
    } catch { return failed('prepare-failed', before); }
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      if (state.active) return success(state);
      if (state.epoch !== before.epoch || state.issued !== before.issued) return failed('stale', state);
      if (!state.epoch) state.epoch = randomId(entropy);
      state.issued++;
      state.stream = draw.state;
      state.active = { id: game.matchId, seed: game.seed, variant, level, seat: game.seat, firstSide: game.firstSide,
        boardVersion: game.boardVersion, difficulty: game.difficulty, timed: false, game: saveData(game),
        startedAt: clock(), bot, opening, forecast, expected: forecast.expected };
      return write(state);
    });
  }

  function matches(game) {
    if (!validId(game?.matchId)) return false;
    const { active, history } = read();
    return Boolean(sameAssignment(active, game) || history.some(r => r.id === game.matchId && sameAssignment(r, game)));
  }

  function settle(state, game, reason) {
    const active = state.active, pool = state.pools[active.variant];
    const won = reason === 'win';
    const { rated, model, calibration } = active.forecast;
    const next = won ? active.forecast.win : active.forecast.loss;
    const { forecast, ...assignment } = active;
    const record = { ...assignment, game: saveData(game), endedAt: clock(), reason, won, rated, model, calibration,
      nuisanceSd: forecast.nuisanceSd, transferSd: forecast.transferSd,
      before: pool.rating, after: next.rating, delta: next.rating - pool.rating, rdBefore: pool.rd, rdAfter: next.rd };
    const ratedGames = pool.ratedGames + Number(rated);
    state.pools[active.variant] = { ...next, games: pool.games + 1, ratedGames, wins: pool.wins + Number(won),
      losses: pool.losses + Number(!won), provisional: isProvisional(ratedGames, next.rd) };
    state.history = trimHistory([record, ...state.history]);
    state.active = null;
    return write(state, { record });
  }

  function advance(candidate, finish) {
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
      let game = restoreGame(active.game);
      if (!game) return failed('invalid', state);
      if (moves.length === before.length + 1) {
        const id = moves.at(-1);
        if (game.side !== game.seat && ratedBotMove(game.board, game.live, game.side, active.level,
          game.seed, before.length).edgeId !== id) return failed('ineligible', state);
        game = playCut(game, id);
        if (!game) return failed('ineligible', state);
      }
      if (game.victor !== candidate.victor) return failed('ineligible', state);
      if (finish && !game.victor) return failed('unfinished', state);
      if (game.victor) return settle(state, game, game.victor === game.seat ? 'win' : 'loss');
      if (before.length === moves.length) return success(state);
      active.game = saveData(game);
      return write(state);
    });
  }

  function forfeit(id) {
    return locked(() => {
      const state = read();
      if (state.status !== 'ok') return failed(state.status, state);
      if (!state.active || state.active.id !== id) {
        const record = state.history.find(r => r.id === id);
        return record ? success(state, { record }) : failed('ineligible', state);
      }
      const game = restoreGame(state.active.game);
      if (!game) return failed('invalid', state);
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

  return { read, start, matches, checkpoint: game => advance(game, false), finish: game => advance(game, true), forfeit, reset };
}
