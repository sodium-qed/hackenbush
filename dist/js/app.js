import { createAudio } from './audio.js';
import { createAnalyzer } from './analyzer.js';
import { createBuilder } from './builder.js';
import { CUSTOM_BOARD_VERSION, readCustomBoard } from './custom-board.js';
import { createDailyGame, dailySeed } from './daily.js';
import { dailyProgress, recordDailyResult } from './daily-progress.js';
import { renderLandscape } from './landscape.js';
import { createPractice } from './practice.js';
import { createBoard } from './board.js';
import { drawSeats } from './draw.js';
import { freshSeed } from './generator.js';
import { CURRENT_BOARD_VERSION, TEXT_BOARD_VERSION, isDailySeed, nextMapSeed, normalizeMapSeed, normalizeTextSeed, usesMapSeed } from './map-seed.js';
import { createGuide } from './guide.js';
import { copyText, decodeTurn, encodeTurn } from './linkplay.js';
import { createPlayers } from './players.js';
import { timeBoardPreview } from './preview.js';
import { otherSide } from './rules.js';
import { TURN_MS, canUndo, createGame, expireTurn, isHumanTurn, matchKey, playCut, receiveLink,
  restoreGame, saveData, startTurnClock, undoTurn } from './session.js';
import { COMPUTER_LEVELS, chooseComputerMove, computerLevelLabel, normalizeComputerLevel } from './opponents.js';
import { RATED_BOT_BY_ID } from './rated-bots.js';
import { RATED_BOARD_VERSION, ratedBotMove } from './rated-deal.js';
import { createRatedGame, createRatingStore, ratedClockEvent, RATING_KEY } from './rating.js';
import { createRatedDesk, difficultyRange, openingSummary, ratedOpponentLabel, signedRating } from './rated-ui.js';

const $ = id => document.getElementById(id);
const currentKey = 'groundwork.hackenbush.match.v1';
const linksKey = 'groundwork.hackenbush.linkGames.v1';
const lobbyKey = 'groundwork.hackenbush.lobby.v3';
const entrantsKey = 'groundwork.hackenbush.entrants.v3';
const dealKey = 'groundwork.hackenbush.map-deal.v4';
const dailyLevelKey = 'groundwork.hackenbush.daily-level.v1';
const sceneryKey = 'groundwork.hackenbush.scenery.v1';
const ratedViewKey = 'groundwork.hackenbush.rated-view.v1';
const ratedAssessmentKey = 'groundwork.hackenbush.rated-assessment.indefinite';
const dailyDateFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const colors = { green: 'Green', red: 'Red', blue: 'Blue' };
const rules = { green: 'Green', redblue: 'Red–Blue', mixed: 'Red–Blue + green' };
const audio = createAudio({ button: $('sound-nav'), dialog: $('sound-dialog') });
const practiceOptions = { onCut: details => audio.cut(details) };
const guide = createGuide($('guide-dialog'), practiceOptions);
const analyzer = createAnalyzer($('analyzer-dialog'));
const ratings = createRatingStore({ prepareOpening: (match, settings) => runRatedWorker('prepare', match, 0, settings),
  chooseBot: typeof Worker === 'function' ? (match, budget) => runRatedWorker('move', match, budget) : undefined });
const ratedDesk = createRatedDesk($('rated-dialog'), {
  read: () => ratings.read(), onStart: startRated, onForfeit: resignRated, onReset: resetRatings,
  onReplay: reviewRated, onPractice: playGardenPractice,
  readIndefinite: () => readStorage(ratedAssessmentKey) === true,
  saveIndefinite: enabled => writeStorage(ratedAssessmentKey, enabled)
});
const builder = createBuilder($('builder-dialog'), { onUse: applyCustomBoard });
createPractice($('practice-garden'), practiceOptions);
const playerForm = createPlayers($('players-view'), { onStart: deal, onChange: saveDraft });
const boardView = createBoard($('board'), {
  onCut(id) { if (phase === 'playing' && isHumanTurn(game)) makeMove(id); }
});

let game = null;
let phase = 'ready';
let lobby = null;
let previewUntil = 0;
let cancelPreview = null;
let computerTimer = null;
let displayTimer = null;
let dailyCardTimer = null;
let dealing = false;
let localDealState = null;
let paintedBoard = null;
let ratedMatch = null;
let ratedMovePending = false;
let ratedClockTimer;
let ratedClockPending = null;

function readStorage(key, tabOnly = false) {
  try { return JSON.parse((tabOnly ? sessionStorage : localStorage).getItem(key)); } catch { return null; }
}
function writeStorage(key, data, tabOnly = false) {
  try {
    const storage = tabOnly ? sessionStorage : localStorage;
    if (data === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(data));
  } catch { /* Direct play also works when browser storage is unavailable. */ }
}
function linkGames() {
  const saved = readStorage(linksKey);
  return Array.isArray(saved) ? saved.filter(item => item && typeof item === 'object') : [];
}
function persist() {
  if (ratedMatch) {
    writeStorage(ratedViewKey, ratedMatch.id, true);
    return;
  }
  const data = saveData(game);
  if (game.victor) recordDailyResult(game);
  if (previewUntil) data.previewUntil = previewUntil;
  writeStorage(currentKey, data);
  if (game.opponent === 'link') {
    const rest = linkGames().filter(item => matchKey(item) !== matchKey(game));
    writeStorage(linksKey, [data, ...rest].slice(0, 24));
  }
}
function setHash(hash) {
  if (location.hash === hash) return;
  const url = new URL(location.href);
  url.hash = hash;
  history.replaceState(null, '', url);
}
function setSeedQuery(seed = null, boardVersion = CURRENT_BOARD_VERSION) {
  const url = new URL(location.href);
  url.searchParams.delete('board');
  url.searchParams.delete('daily');
  url.searchParams.delete('rules');
  url.searchParams.delete('bot');
  if (seed && (usesMapSeed(boardVersion) || boardVersion === TEXT_BOARD_VERSION)) {
    url.searchParams.set('seed', seed);
    url.searchParams.set('v', String(boardVersion));
  } else {
    url.searchParams.delete('seed');
    url.searchParams.delete('v');
    if (seed && boardVersion === CUSTOM_BOARD_VERSION) url.searchParams.set('board', seed);
  }
  if (url.href !== location.href) history.replaceState(null, '', url);
}
function saveMatch() {
  persist();
  if (game.opponent === 'link') setHash(encodeTurn(game));
  else if (location.hash.startsWith('#turn=')) setHash('');
}
function feedback(message = '') {
  $('board-feedback').textContent = message;
  $('board-feedback').hidden = !message;
}
function announce(message) { $('announcer').textContent = message; }
function cancelTimers() {
  clearTimeout(computerTimer);
  clearTimeout(displayTimer);
  clearTimeout(dailyCardTimer);
  cancelPreview?.();
  cancelPreview = null;
}
function setZoom(zoomed) {
  $('board-scroll').dataset.zoom = String(zoomed);
  $('zoom').setAttribute('aria-pressed', String(zoomed));
  $('zoom').querySelector('span').textContent = zoomed ? 'Fit board' : 'Zoom board';
  if (!zoomed) $('board-scroll').scrollLeft = 0;
}
function setScenery(visible) {
  $('field').dataset.scenery = visible ? 'on' : 'off';
  const toggle = $('scenery-toggle');
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.title = visible ? 'Hide scenery' : 'Show scenery';
}
function paintClock(remaining) {
  const seconds = String(Math.ceil(Math.max(0, remaining) / 1000));
  if ($('clock-value').textContent !== seconds) $('clock-value').textContent = seconds;
  const progress = Math.max(0, Math.min(1, remaining / TURN_MS));
  $('clock-arc').style.strokeDashoffset = String((1 - progress) * 100);
  $('clock').dataset.urgent = String(remaining <= 3000);
}
function setPhase(next) {
  phase = next;
  document.body.dataset.phase = next;
  $('game-table').dataset.phase = next;
  const ready = phase === 'ready';
  const playing = phase === 'playing';
  $('variants').hidden = !ready;
  $('board-source').hidden = !ready;
  $('garden-title').hidden = ready;
  $('opening-rules').hidden = !ready;
  $('match-players').hidden = ready;
  $('field').hidden = ready;
  $('new-game').hidden = !playing;
  $('board-tools').hidden = !playing;
  $('history-panel').hidden = !playing;
  $('guide-nav').disabled = phase === 'preview';
  $('analyze-game').hidden = true;
  $('resume').hidden = !ready || !game;
  $('setup-title').textContent = ready ? 'Table rules' : 'Players';
  if (!ready) playerForm.close();
}
function updateRules() {
  $('variant-green').setAttribute('aria-pressed', String(lobby.variant === 'green'));
  $('variant-redblue').setAttribute('aria-pressed', String(lobby.variant === 'redblue'));
  $('color-rule').textContent = lobby.variant === 'green'
    ? 'Both players can cut any green branch. The draw decides who opens.'
    : 'Red cuts red. Blue cuts blue. Colors and the opening player are drawn at random.';
}
function enterLobby({ variant, seed, choices, legacySeed, boardVersion, customCode, dailyDate } = {}) {
  cancelTimers();
  if (ratedMatch) {
    ratedMatch = null;
    game = restoreGame(readStorage(currentKey));
  }
  writeStorage(ratedViewKey, null, true);
  $('rated-receipt').hidden = true;
  $('rated-retry').hidden = true;
  if ($('analyzer-dialog').open) $('analyzer-dialog').close();
  const previous = lobby || game;
  const candidate = customCode ?? (boardVersion === CUSTOM_BOARD_VERSION ? seed : null);
  const custom = candidate ? readCustomBoard(candidate) : null;
  const selected = custom?.variant ?? variant ?? previous?.variant;
  lobby = {
    format: CURRENT_BOARD_VERSION,
    boardVersion: boardVersion === 4 || boardVersion === TEXT_BOARD_VERSION ? boardVersion : CURRENT_BOARD_VERSION,
    variant: selected === 'green' ? 'green' : 'redblue',
    choices: choices ?? lobby?.choices ?? readStorage(entrantsKey)
  };
  if (custom) lobby.customCode = candidate;
  if (isDailySeed(dailyDate)) lobby.dailyDate = dailyDate;
  if (typeof legacySeed === 'string') lobby.legacySeed = legacySeed;
  else if (typeof seed === 'string' && boardVersion === 3) lobby.legacySeed = seed;
  else if (typeof seed === 'string' && boardVersion !== CUSTOM_BOARD_VERSION) lobby.seed = seed;
  $('map-seed').value = lobby.seed || '';
  $('map-seed').setCustomValidity('');
  $('map-seed').removeAttribute('aria-invalid');
  $('seed-entry').open = !!lobby.seed;
  updateSeedSummary();
  paintedBoard = null;
  previewUntil = 0;
  setZoom(false);
  if (location.hash.startsWith('#turn=')) setHash('');
  setPhase('ready');
  $('daily-match-label').hidden = true;
  $('daily-level').value = normalizeComputerLevel(readStorage(dailyLevelKey));
  refreshDailyCard();
  $('turn-card').dataset.state = 'ready';
  $('turn-card').removeAttribute('data-side');
  $('turn-label').textContent = 'Per turn';
  $('turn-name').textContent = 'Turn clock';
  $('turn-help').textContent = 'Make your cut within ten seconds. At zero, your opponent wins.';
  $('turn-action').hidden = true;
  $('link-area').hidden = true;
  $('share-turn').hidden = true;
  $('clock').hidden = false;
  $('result-mark').hidden = true;
  updateBoardSource(custom);
  updateRules();
  paintClock(TURN_MS);
  playerForm.open({ ...lobby.choices, variant: lobby.variant });
  writeStorage(lobbyKey, lobby, true);
  feedback();
  announce('Enter the players’ names before drawing seats.');
}
function saveDraft(choices) {
  if (phase !== 'ready' || !lobby) return;
  lobby.choices = choices;
  writeStorage(lobbyKey, lobby, true);
}
function chooseRules(variant) {
  if (!lobby || lobby.variant === variant) return;
  lobby.variant = variant;
  if (lobby.customCode) {
    delete lobby.customCode;
    setSeedQuery(normalizeTextSeed(lobby.seed), lobby.boardVersion);
    updateBoardSource();
    feedback('Switched to generated maps for ' + rules[variant] + '.');
  }
  const url = new URL(location.href);
  if (url.searchParams.has('seed')) {
    url.searchParams.set('rules', variant);
    history.replaceState(null, '', url);
  }
  updateRules();
  playerForm.open({ ...lobby.choices, variant });
  writeStorage(lobbyKey, lobby, true);
}
function updateBoardSource(custom = null) {
  $('seed-entry').hidden = !!custom;
  $('custom-selection').hidden = !custom;
  $('build-board').querySelector('span').textContent = custom ? 'Edit board' : 'Build a board';
  $('board-caption').textContent = custom ? 'Custom board' : 'Expert';
  if (custom) {
    $('custom-name').textContent = custom.board.family;
    const count = custom.board.edges.length;
    $('custom-count').textContent = 'Custom board · ' + count + (count === 1 ? ' branch' : ' branches');
  }
}
function applyCustomBoard(code, variant) {
  const custom = readCustomBoard(code);
  if (!lobby || !custom || custom.variant !== variant) return;
  lobby.customCode = code;
  lobby.variant = variant;
  updateRules();
  updateBoardSource(custom);
  setSeedQuery(code, CUSTOM_BOARD_VERSION);
  feedback();
  writeStorage(lobbyKey, lobby, true);
}
function updateSeedSummary() {
  const raw = $('map-seed').value;
  const seed = normalizeTextSeed(raw);
  $('seed-summary').textContent = seed || (raw.trim() ? 'Invalid seed' : lobby?.legacySeed ? 'Previous garden' : 'Random · 16,777,216 maps');
  $('seed-summary').title = seed || '';
}
function seedError(raw) {
  return /daily/i.test(raw) ? 'DAILY is reserved. Use the Daily Challenge to play the date’s puzzle.'
    : 'Use a seed of up to 64 characters without control characters.';
}
function seedVersion(seed, version = CURRENT_BOARD_VERSION) {
  if (!seed) return CURRENT_BOARD_VERSION;
  if (version === TEXT_BOARD_VERSION || !normalizeMapSeed(seed)) return TEXT_BOARD_VERSION;
  return version === 4 ? 4 : CURRENT_BOARD_VERSION;
}
function drawMap() {
  const next = nextMapSeed(readStorage(dealKey) || localDealState);
  localDealState = next.state;
  writeStorage(dealKey, next.state);
  return next.seed;
}
async function deal(choices) {
  if (phase !== 'ready' || !lobby || dealing) return;
  const input = $('map-seed');
  const requested = lobby.customCode ? '' : input.value;
  const code = normalizeTextSeed(requested);
  if (requested.trim() && !code) {
    $('seed-entry').open = true;
    input.setCustomValidity(seedError(requested));
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.reportValidity();
    return;
  }
  const draft = lobby;
  const legacy = !requested.trim() && typeof draft.legacySeed === 'string';
  const customCode = draft.customCode;
  const variant = draft.variant;
  const boardVersion = customCode ? CUSTOM_BOARD_VERSION : legacy ? 3 : seedVersion(code, draft.boardVersion);
  dealing = true;
  try {
    let seed = customCode ?? (legacy ? draft.legacySeed : code);
    if (seed == null) {
      seed = navigator.locks ? await navigator.locks.request(dealKey, drawMap) : drawMap();
    }
    if (lobby !== draft || phase !== 'ready' || draft.variant !== variant || draft.customCode !== customCode
        || draft.choices !== choices || (!customCode && input.value !== requested)) return;
    const seats = drawSeats(choices, variant);
    const next = createGame({ seed, variant, boardVersion, ...seats });
    writeStorage(entrantsKey, choices);
    audio.reveal();
    activate(next, { previewEnd: Date.now() + 2000, scroll: true });
    if (next.victor) audio.end({ timedOut: false });
  } finally {
    dealing = false;
  }
}
function isDailyMatch(match) {
  return match?.boardVersion === TEXT_BOARD_VERSION && isDailySeed(match.seed);
}
function dailyMatchLevel(match) {
  return normalizeComputerLevel(match.players[otherSide(match.seat)].level);
}
function dateForSeed(seed) {
  const [, month, day, year] = seed.split('-');
  return year + '-' + month + '-' + day;
}
function dailyDateLabel(seed) {
  return dailyDateFormat.format(new Date(dateForSeed(seed) + 'T12:00:00Z'));
}
function refreshDailyCard() {
  clearTimeout(dailyCardTimer);
  if (phase !== 'ready' || !lobby) return;
  const now = new Date();
  const seed = lobby.dailyDate || dailySeed(now);
  const level = $('daily-level').value;
  const active = isDailyMatch(game) && game.seed === seed && dailyMatchLevel(game) === level;
  if (active) {
    game = newerStoredPosition() || expireTurn(game, now.getTime());
    if (game.victor) recordDailyResult(game);
  }
  const progress = dailyProgress(seed, level);
  const resume = active && !game.victor;
  const label = computerLevelLabel(level);
  const date = $('daily-date');
  date.textContent = dailyDateLabel(seed);
  date.setAttribute('datetime', dateForSeed(seed));
  $('daily-status').textContent = progress?.won ? 'Solved on ' + label + ' on this device.'
    : resume ? 'Your ' + label + ' match is in progress.'
    : progress ? 'Played on ' + label + '. Try again for a win.' : '';
  $('play-daily').querySelector('span').textContent = resume ? 'Resume challenge' : progress ? 'Play again' : 'Play challenge';

  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const runningHumanClock = resume && game.side === game.seat && game.deadline;
  const nextUpdate = Math.min(lobby.dailyDate ? Infinity : midnight.getTime(), runningHumanClock || Infinity);
  if (Number.isFinite(nextUpdate)) dailyCardTimer = setTimeout(refreshDailyCard, Math.max(1, nextUpdate - now.getTime() + 1));
}
function startDailyChallenge(seed, level) {
  const next = createDailyGame(seed, level);
  writeStorage(dailyLevelKey, level);
  audio.reveal();
  activate(next, { previewEnd: Date.now() + 2000, scroll: true });
}
function runRatedWorker(operation, match, clockBudget = 0, { signal, finishSignal, indefinite, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(new URL('./rated-worker.js?v=12', import.meta.url), { type: 'module' });
    let running = false, interrupted = false;
    let timer = operation === 'prepare' ? null : setTimeout(() => stop(false), 30_000);
    const finish = () => worker.postMessage({operation: 'finish-assessment'});
    const cancel = () => { cleanUp(); reject(signal.reason); };
    function cleanUp() {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      signal?.removeEventListener('abort', cancel);
      finishSignal?.removeEventListener('abort', finish);
      worker.terminate();
    }
    function stop(success, value) {
      cleanUp();
      if (success) resolve(value);
      else reject(new Error('The bot calculation stopped. Retry from the current position.'));
    }
    function visibilityChanged() {
      if (!running) return;
      if (document.hidden) {
        interrupted = true;
        clearTimeout(timer);
      } else if (interrupted) {
        // Re-run an unfinished background search so suspension cannot consume
        // its allowance. The saved turn still has its original start time.
        cleanUp();
        resolve(runRatedWorker(operation, match, clockBudget));
      }
    }
    if (clockBudget) document.addEventListener('visibilitychange', visibilityChanged);
    worker.onmessage = ({data}) => {
      if (data.progress) onProgress?.(data.progress);
      else if (data.searchStarted) {
        running = true;
        interrupted = document.hidden;
        clearTimeout(timer);
        if (!interrupted) timer = setTimeout(() => stop(true, { edgeId: null, elapsedMs: clockBudget }), clockBudget);
      } else if (clockBudget && interrupted && data.ok && data.result.elapsedMs >= clockBudget) {
        // A background worker's wall-clock measurement may include time asleep.
        // Defer a fresh measurement until this tab becomes visible.
        worker.terminate();
      } else stop(data.ok, data.result);
    };
    worker.onerror = () => stop(false);
    worker.onmessageerror = () => stop(false);
    signal?.addEventListener('abort', cancel, {once: true});
    finishSignal?.addEventListener('abort', finish, {once: true});
    worker.postMessage({operation, game: match, clockBudget, indefinite});
    if (finishSignal?.aborted) finish();
  });
}
function ratedFailure(reason) {
  const descriptions = {
    unavailable: 'Rated play needs writable local browser storage.',
    invalid: 'The rated record could not be read. Open Rated play to reset it.',
    newer: 'This saved record needs a newer version of Groundwork.',
    stale: 'Another tab changed this match. Reopen Rated play for the latest position.',
    'prepare-failed': 'The rated worker could not prepare this garden. Retry to draw your match.',
    'bot-failed': 'The bot calculation stopped. Retrying its move…',
    exhausted: 'This device has completed every deal in this rating pool.'
  };
  return descriptions[reason] || 'The rated action could not be saved. Reopen Rated play to try again.';
}
function enterRated(entry, scroll = false) {
  const match = restoreGame(entry?.game, 0);
  if (!match || match.matchId !== entry.id) throw new Error('The saved rated match could not be restored.');
  ratedMatch = entry;
  $('rated-retry').hidden = true;
  const previewEnd = entry.timed && !match.moves.length && match.deadline !== null ? match.deadline - TURN_MS : 0;
  activate(match, {scroll, previewEnd});
}
async function startRated(variant, level, settings) {
  if (typeof Worker !== 'function') throw new Error('Rated play needs a browser with Web Worker support.');
  const dialog = $('rated-dialog');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  dialog.addEventListener('close', cancel);
  let result;
  try { result = await ratings.start(variant, level, { ...settings, signal: controller.signal }); }
  finally { dialog.removeEventListener('close', cancel); }
  if (result.reason === 'cancelled') return;
  if (!result.ok) throw new Error(ratedFailure(result.reason));
  watchRatedClock();
  if (!dialog.open) return;
  dialog.close();
  audio.reveal();
  enterRated(result.record ?? result.active, true);
}
async function resignRated(id) {
  const result = await ratings.forfeit(id);
  if (!result.ok) throw new Error(ratedFailure(result.reason));
  watchRatedClock();
  if (ratedMatch?.id === id) enterLobby({variant: ratedMatch.variant});
  const message = result.record.reason === 'forfeit' ? 'Resignation recorded.' : 'This match had already ended.';
  return message + ' Rating change ' + signedRating(result.record.delta) + '.';
}
async function resetRatings() {
  const result = await ratings.reset();
  if (!result.ok) throw new Error(ratedFailure(result.reason));
  watchRatedClock();
  if (ratedMatch) enterLobby();
  return 'Both rating histories have been reset.';
}
function reviewRated(record) {
  const replay = restoreGame(record.game);
  if (!replay?.victor) return;
  $('rated-dialog').close();
  analyzer.open(replay);
}
function isGardenPractice(match) {
  return match?.opponent === 'computer' && !match.timed && match.matchId?.startsWith('practice-');
}
function playGardenPractice({variant, level, seed, boardVersion}, scroll = true) {
  const id = 'practice-' + freshSeed() + freshSeed() + freshSeed();
  const practice = createRatedGame(variant, level, seed, id, boardVersion, false);
  if ($('rated-dialog').open) $('rated-dialog').close();
  if (scroll) audio.reveal();
  activate(practice, {scroll});
}
function renderRatedReceipt() {
  const receipt = $('rated-receipt');
  receipt.hidden = !ratedMatch;
  if (!ratedMatch) return;
  const completed = typeof ratedMatch.won === 'boolean';
  const label = ratedOpponentLabel(ratedMatch.level, ratedMatch.bot);
  $('rated-receipt-title').textContent = completed ? 'Rating result' : 'Rated match';
  $('rated-match-opponent').textContent = 'Opponent · ' + label;
  $('rated-match-opponent').hidden = !completed;
  $('rated-match-rating').textContent = completed ? 'Your rating ' + Math.round(ratedMatch.before) + ' → ' +
    Math.round(ratedMatch.after) + ' (' + signedRating(ratedMatch.delta) + ')' :
    label;
  $('rated-match-odds').textContent = openingSummary(ratedMatch, completed);
  $('rated-match-difficulty').textContent = 'Opening structural difficulty · ' + difficultyRange(ratedMatch.opening);
  $('rated-practice').hidden = !completed;
}
function paintScenery() {
  if (paintedBoard === game.board) return;
  paintedBoard = game.board;
  const { board } = game;
  renderLandscape(boardView.landscape, board.world, board.mapSeed || (ratedMatch || isGardenPractice(game) ? game.seed : 'A35D7E'));
  // Archived six-landmark boards retain their aligned captions. New landscapes
  // use the entire board and have no fixed horizontal column assignments.
  const legend = $('landmarks');
  legend.hidden = game.boardVersion !== 4;
  legend.replaceChildren();
  if (!legend.hidden) {
    for (const name of board.landmarks) {
      const item = document.createElement('li');
      item.textContent = name;
      legend.append(item);
    }
  }
}
function seatName(side) { return game.players[side].name; }
function seatLabel(side) { return side === game.firstSide ? 'Player 1' : 'Player 2'; }
function seatDetails(side) {
  const details = [seatLabel(side)];
  if (game.variant !== 'green') details.push(colors[side]);
  const player = game.players[side];
  if (player.kind === 'computer') {
    const profile = RATED_BOT_BY_ID[player.level];
    details.push(profile ? profile.elo + ' Elo bot' : computerLevelLabel(player.level) + ' computer');
  } else {
    details.push('Human');
  }
  return details.join(' · ');
}
function cutInstruction() {
  if (game.variant === 'green') return 'Cut any green branch.';
  if (game.variant === 'mixed') return 'Cut a ' + game.side + ' or green branch.';
  return 'Cut a ' + game.side + ' branch.';
}
function outcome() {
  if ((ratedMatch || isGardenPractice(game) || isDailyMatch(game)) && game.side === game.seat) {
    return game.timedOut ? 'You ran out of time.' : 'You have no legal cut.';
  }
  return seatName(game.side) + (game.timedOut ? ' ran out of time.' : ' has no legal cut.');
}
function turnMessage() {
  if (game.victor && isDailyMatch(game) && game.victor === game.seat) return 'Daily challenge solved. ' + outcome();
  if (game.victor && (ratedMatch || isGardenPractice(game)) && game.victor === game.seat) return 'You win. ' + outcome();
  if (game.victor) return seatName(game.victor) + ' wins. ' + outcome();
  return seatName(game.side) + ' to move. ' + seatDetails(game.side) + '.';
}
function showKey() {
  const key = $('edge-key');
  key.replaceChildren();
  const kinds = game.variant === 'green' ? ['green'] : game.variant === 'mixed' ? ['blue', 'red', 'green'] : ['blue', 'red'];
  for (const color of kinds) {
    const item = document.createElement('span');
    item.className = 'key-item';
    const swatch = document.createElement('i');
    swatch.className = 'key-stroke ' + color;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(color === 'green' ? 'Shared' : colors[color]));
    key.append(item);
  }
}
function renderRoster() {
  const list = $('match-players');
  list.replaceChildren();
  for (const side of [game.firstSide, otherSide(game.firstSide)]) {
    const row = document.createElement('li');
    row.className = 'roster-seat';
    row.dataset.side = game.variant === 'green' ? 'green' : side;
    row.dataset.active = String(!game.victor && side === game.side);
    if (row.dataset.active === 'true') row.setAttribute('aria-current', 'true');
    const number = document.createElement('span');
    number.className = 'roster-token';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = side === game.firstSide ? '1' : '2';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.className = 'roster-name';
    name.textContent = seatName(side);
    const role = document.createElement('span');
    role.className = 'roster-role';
    role.textContent = seatDetails(side) + (game.opponent === 'link' && game.seat === side ? ' · this device' : '');
    details.append(name, role);
    row.append(number, details);
    list.append(row);
  }
}
function renderHistory() {
  const container = $('history-content');
  container.replaceChildren();
  if (!game.rows.length && !game.timedOut) {
    const empty = document.createElement('p');
    empty.className = 'empty-history';
    empty.textContent = 'The first cut will appear here.';
    container.append(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'history-list';
  list.reversed = true;
  if (game.timedOut) {
    const item = document.createElement('li');
    item.className = 'history-row';
    const result = (ratedMatch || isDailyMatch(game)) && game.victor === game.seat ? 'You win.' : seatName(game.victor) + ' wins.';
    item.textContent = outcome() + ' ' + result;
    list.append(item);
  }
  for (const row of [...game.rows].reverse()) {
    const item = document.createElement('li');
    item.className = 'history-row';
    const chip = document.createElement('i');
    chip.className = 'move-chip ' + row.color;
    chip.setAttribute('aria-hidden', 'true');
    const description = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = seatName(row.side);
    const part = game.board.edges[row.branch - 1]?.part || 'branch';
    const count = row.fallen.length;
    const fall = count ? ' ' + count + (count === 1 ? ' more branch fell.' : ' more branches fell.') : '';
    description.append(name, document.createTextNode(' cut the ' + row.color + ' ' + part + '.' + fall));
    item.append(chip, description);
    list.append(item);
  }
  container.append(list);
}
function renderMatch(animation = {}) {
  const preview = phase === 'preview';
  const human = isHumanTurn(game);
  const won = Boolean(game.victor);
  const side = game.victor ?? game.side;
  const linked = game.opponent === 'link';
  const waiting = linked && !won && !human;
  const invite = waiting && !game.moves.length;
  const daily = isDailyMatch(game);
  const practice = isGardenPractice(game);
  const card = $('turn-card');
  card.dataset.state = won ? 'won' : phase;
  card.dataset.side = game.variant === 'green' ? 'green' : side;
  $('turn-label').textContent = won ? (daily ? 'Daily result' : 'Winner') : preview ? (daily ? 'Opening player' : 'Drawn to open') : waiting ? 'Waiting for' : linked ? 'Your turn' : 'To move';
  $('turn-name').textContent = daily && won ? (game.victor === game.seat ? 'Puzzle solved!' : 'Computer wins') : seatName(side);
  const count = game.moves.length;
  $('turn-help').textContent = won
    ? rules[game.variant] + ' · ' + count + (count === 1 ? ' cut played' : ' cuts played')
    : seatDetails(side);
  const action = won ? outcome() : preview ? 'Study the garden before the first cut.' : waiting ? '' : cutInstruction();
  $('turn-action').textContent = action;
  $('turn-action').hidden = !action;
  $('clock').hidden = !game.timed || (waiting && !preview) || won;
  $('result-mark').hidden = !won;
  $('analyze-game').hidden = !won;
  paintClock(game.timedOut ? 0 : game.deadline === null || preview ? TURN_MS : game.deadline - Date.now());
  $('share-turn').hidden = preview || !linked || (!waiting && !won);
  $('share-turn').querySelector('span').textContent = won ? 'Share result' : invite ? 'Invite Player 1' : 'Share turn link';
  $('link-area').hidden = !linked || preview;
  if (linked) {
    $('link-explain').textContent = won ? 'Send the final result to the other player.' : waiting
      ? 'Send the link to ' + seatName(game.side) + '. Their turn starts when they open it.'
      : 'Make a cut, then send the new turn link to the other player.';
  }
  $('garden-name').textContent = game.board.family || (ratedMatch || practice ? 'Classic garden' : 'Game board');
  $('daily-match-label').hidden = !daily && !ratedMatch && !practice;
  if (daily) $('daily-match-label').textContent = 'Daily Challenge · ' + dailyDateLabel(game.seed) + ' · ' + computerLevelLabel(dailyMatchLevel(game));
  if (ratedMatch || practice) {
    const level = game.players[otherSide(game.seat)].level;
    $('daily-match-label').textContent = (ratedMatch ? 'Rated' : 'Unrated practice') + ' · ' +
      ratedOpponentLabel(level, ratedMatch?.bot) + (game.timed ? ' · 10s per cut' : ' · Untimed');
  }
  $('new-game').querySelector('span').textContent = ratedMatch && !won ? 'Leave board' : 'New game';
  $('new-game').title = ratedMatch && game.timed && !won ? 'Leave the board. The rated clock keeps running.' : '';
  $('restart').hidden = Boolean(ratedMatch && !won);
  renderRatedReceipt();
  const custom = game.boardVersion === CUSTOM_BOARD_VERSION;
  const code = ratedMatch || practice || usesMapSeed(game.boardVersion) || game.boardVersion === TEXT_BOARD_VERSION ? game.seed : null;
  paintScenery();
  $('field-branches').textContent = game.live.length + (game.live.length === 1 ? ' branch' : ' branches');
  $('history-count').textContent = String(game.moves.length);
  $('share-map').hidden = !code && !custom;
  $('share-map-label').textContent = daily ? 'Share puzzle' : custom ? 'Share board' : 'Seed';
  $('map-code').textContent = code || '';
  $('map-code').hidden = !code;
  $('share-map').title = code || '';
  $('share-map').setAttribute('aria-label', daily ? 'Share daily challenge ' + code : custom ? 'Share custom board' : 'Share map seed ' + (code || ''));
  $('restart').querySelector('span').textContent = ratedMatch ? 'Rated play' : practice ? 'Restart practice' :
    daily ? (won ? 'Replay challenge' : 'Restart challenge') : 'Rematch';
  if (!preview) $('board-caption').textContent = rules[game.variant];
  $('field-label').textContent = won ? 'Final position' : preview ? 'Opening look' : daily ? 'Daily puzzle' : custom ? 'Custom board' : game.boardVersion >= 3 ? 'Expert map' : 'Playing field';
  $('undo').hidden = Boolean(ratedMatch) || game.timed || linked || Object.values(game.players).every(player => player.kind === 'computer');
  $('undo').disabled = Boolean(ratedMatch) || !canUndo(game);
  showKey();
  renderRoster();
  if ($('history-panel').open) renderHistory();
  boardView.update({ board: game.board, live: game.live, side: game.side, locked: preview || !human, ...animation });
}
function sameMoves(a, b) { return a.length === b.length && a.every((id, i) => id === b[i]); }
function watchRatedClock() {
  clearTimeout(ratedClockTimer);
  const { active } = ratings.read();
  const due = ratedClockEvent(active);
  if (due === null) return;
  const position = active.id + '/' + active.game.moves.length;
  if (ratedClockPending === position) return;
  ratedClockTimer = setTimeout(async () => {
    ratedClockPending = position;
    const result = await ratings.refreshClock(active.id);
    if (ratedClockPending === position) ratedClockPending = null;
    if (!result.ok && result.reason !== 'ineligible') {
      if (ratedMatch?.id === active.id) feedback(ratedFailure(result.reason));
      ratedClockTimer = setTimeout(watchRatedClock, 1500);
      return;
    }
    if (ratedMatch?.id === active.id) syncPosition();
    ratedDesk.refresh();
    watchRatedClock();
  }, Math.max(0, due - Date.now()));
}
function newerStoredPosition() {
  if (!game.matchId) return null;
  const latest = game.opponent === 'link'
    ? linkGames().find(item => item.matchId === game.matchId) : readStorage(currentKey);
  if (latest?.matchId !== game.matchId || !Array.isArray(latest.moves)) return null;
  const advanced = latest.moves.length > game.moves.length;
  const conflicting = latest.moves.length === game.moves.length && !sameMoves(latest.moves, game.moves);
  const finished = latest.timedOut && !game.timedOut && latest.moves.every((id, i) => game.moves[i] === id);
  if (!advanced && !conflicting && !finished) return null;
  return restoreGame(latest);
}
function syncPosition() {
  if (ratedMatch) {
    const state = ratings.read();
    if (state.status !== 'ok') return false;
    const latest = state.active?.id === ratedMatch.id ? state.active : state.history.find(row => row.id === ratedMatch.id);
    if (!latest || latest.reason === 'forfeit') {
      enterLobby({variant: ratedMatch.variant});
      feedback(latest ? 'This rated match was resigned.' : 'The rated record changed in another tab.');
      return true;
    }
    if (!sameMoves(latest.game.moves, game.moves) || latest.reason !== ratedMatch.reason ||
        latest.game.deadline !== game.deadline || latest.timed !== game.timed) {
      const moves = latest.game.moves;
      if (phase === 'playing' && !latest.game.timedOut && moves.length === game.moves.length + 1 &&
          game.moves.every((id, index) => moves[index] === id)) {
        const next = playCut(game, moves.at(-1), game.deadline === null ? Date.now() : game.deadline - TURN_MS);
        if (next) {
          ratedMatch = latest;
          displayCut({ ...next, deadline: latest.game.deadline });
          return true;
        }
      }
      enterRated(latest);
      if (latest.game.timedOut) {
        audio.end({ timedOut: true });
        boardView.celebrate(game.variant === 'green' ? 'green' : game.victor);
      }
      return true;
    }
    return false;
  }
  const updated = newerStoredPosition();
  if (!updated) return false;
  activate(updated, { note: 'The match advanced in another tab.' });
  return true;
}
function checkDeadline(now) {
  if (ratedMatch?.timed) {
    if (game.deadline === null || now < game.deadline) return false;
    paintClock(0);
    watchRatedClock();
    return true;
  }
  const resolved = expireTurn(game, now);
  if (resolved === game) return false;
  if (syncPosition()) return true;
  activate(resolved);
  if (resolved.timedOut) {
    audio.end({ timedOut: true });
    boardView.celebrate(game.variant === 'green' ? 'green' : game.victor);
  }
  return true;
}
function tick() {
  clearTimeout(displayTimer);
  if (phase !== 'playing' || game.deadline === null) return;
  const now = Date.now();
  if (checkDeadline(now)) return;
  const remaining = game.deadline - now;
  if ($('clock-value').textContent !== '3' && Math.ceil(remaining / 1000) === 3 && isHumanTurn(game)) {
    announce(seatName(game.side) + ' has three seconds left.');
  }
  paintClock(remaining);
  displayTimer = setTimeout(tick, Math.min(100, remaining));
}
function scheduleTurn() {
  clearTimeout(computerTimer);
  const position = game;
  tick();
  if (game !== position || phase !== 'playing' || game.victor || ratedMatch || game.opponent === 'link' || game.players[game.side].kind !== 'computer') return;
  computerTimer = setTimeout(async () => {
    if (phase !== 'playing' || game !== position || checkDeadline(Date.now())) return;
    if (isGardenPractice(position)) {
      try {
        const { board, live, side, players, seed, moves } = position;
        const move = typeof Worker === 'function' ? await runRatedWorker('move', position) :
          ratedBotMove(board, live, side, players[side].level, seed, moves.length);
        if (game === position && phase === 'playing' && move.edgeId !== null) makeMove(move.edgeId);
      } catch (error) {
        if (game === position && phase === 'playing') {
          feedback(error.message);
          $('rated-retry').hidden = false;
        }
      }
      return;
    }
    const move = chooseComputerMove(game.board, game.live, game.side, game.players[game.side].level);
    if (move.edgeId !== null) makeMove(move.edgeId);
  }, 700);
}
async function makeMove(id) {
  if (phase !== 'playing' || game.victor || (ratedMatch && ratedMovePending) || syncPosition()) return;
  const now = Date.now();
  if (checkDeadline(now)) return;
  let next = playCut(game, id, now);
  if (!next) return;
  if (ratedMatch) {
    const previous = game;
    ratedMovePending = true;
    try {
      const result = next.victor ? await ratings.finish(next) : await ratings.checkpoint(next);
      watchRatedClock();
      if (game !== previous || phase !== 'playing') return;
      if (!result.ok) {
        if (!syncPosition()) {
          feedback(ratedFailure(result.reason));
          $('rated-retry').hidden = isHumanTurn(game);
        }
        return;
      }
      if (result.record && (result.record.reason === 'forfeit' || result.record.game.timedOut || !sameMoves(result.record.game.moves, next.moves))) {
        syncPosition();
        return;
      }
      ratedMatch = next.victor ? result.record : result.active;
      next = { ...next, deadline: ratedMatch.game.deadline };
    } catch {
      if (game === previous) {
        feedback('This cut could not be saved. Retry from the current position.');
        $('rated-retry').hidden = isHumanTurn(game);
      }
      return;
    } finally {
      ratedMovePending = false;
    }
  }
  displayCut(ratedMatch ? next : startTurnClock(next, now));
}
function displayCut(next) {
  $('rated-retry').hidden = true;
  game = next;
  const last = game.rows.at(-1);
  feedback();
  saveMatch();
  renderMatch({ removed: last.fallen, cutId: last.edgeId });
  const edge = game.board.edges[last.branch - 1];
  const a = game.board.nodes.find(node => node.id === edge.a);
  const b = game.board.nodes.find(node => node.id === edge.b);
  audio.cut({ part: edge.part, fallen: last.fallen.length, position: (a.x + b.x) / 1800 });
  if (game.victor) {
    audio.end({ timedOut: false });
    boardView.celebrate(game.variant === 'green' ? 'green' : game.victor);
  }
  announce(seatName(last.side) + ' cut branch ' + last.branch + '. ' + turnMessage());
  scheduleTurn();
}
function endPreview() {
  if (phase !== 'preview') return;
  activate(game);
}
function activate(next, { note = '', previewEnd = 0, scroll = false } = {}) {
  cancelTimers();
  if (ratedMatch && ratedMatch.id !== next.matchId) {
    ratedMatch = null;
    writeStorage(ratedViewKey, null, true);
  }
  const now = Date.now();
  game = ratedMatch ? next : expireTurn(next, now);
  $('rated-retry').hidden = true;
  setSeedQuery();
  previewUntil = !game.victor && Number.isSafeInteger(previewEnd) && previewEnd > now ? Math.min(previewEnd, now + 2000) : 0;
  if (!ratedMatch) game = startTurnClock(game, previewUntil || now);
  lobby = null;
  for (const id of ['builder-dialog', 'analyzer-dialog']) {
    if ($(id).open) $(id).close();
  }
  if ($('share-dialog').open) $('share-dialog').close();
  if (game.victor && $('guide-dialog').open) $('guide-dialog').close();
  writeStorage(lobbyKey, null, true);
  setPhase(previewUntil ? 'preview' : 'playing');
  saveMatch();
  feedback(note);
  renderMatch({ reset: true, grow: Boolean(previewUntil) });
  if (scroll) {
    $('game-table').focus({ preventScroll: true });
    $('game-table').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  if (previewUntil) {
    const opening = isDailyMatch(game) ? (game.firstSide === game.seat ? 'You open.' : 'The computer opens.') : seatName(game.firstSide) + ' drew the first move.';
    announce(opening + ' Two seconds to study the garden.');
    cancelPreview = timeBoardPreview(seconds => {
      $('board-caption').textContent = 'First cut in ' + seconds + 's';
    }, endPreview, previewUntil - Date.now());
  } else {
    announce(note || turnMessage());
    scheduleTurn();
  }
}
function loadLocation() {
  const saved = readStorage(currentKey);
  const query = new URL(location.href).searchParams;
  const viewedId = readStorage(ratedViewKey, true);
  if (viewedId && !location.hash.startsWith('#turn=') && !['daily', 'seed', 'board'].some(key => query.has(key))) {
    const state = ratings.read();
    const entry = state.active?.id === viewedId ? state.active : state.history?.find(row => row.id === viewedId);
    if (entry?.game && entry.reason !== 'forfeit') {
      enterRated(entry);
      if (!entry.timed && !entry.reason) ratings.resume(entry.id).then(result => {
        if (ratedMatch?.id === entry.id) {
          if (result.ok) syncPosition();
          else feedback(ratedFailure(result.reason));
        }
        watchRatedClock();
      });
      return;
    }
  }
  ratedMatch = null;
  if (viewedId) writeStorage(ratedViewKey, null, true);
  if (location.hash.startsWith('#turn=')) {
    const packet = decodeTurn(location.hash);
    if (packet) {
      const known = linkGames().find(item => matchKey(item) === matchKey(packet));
      const incoming = receiveLink(packet, known);
      if (incoming.game) {
        const previewEnd = known ? known.previewUntil : incoming.game.timed && !incoming.game.moves.length ? Date.now() + 2000 : 0;
        activate(incoming.game, { note: incoming.note, previewEnd });
        return;
      }
    }
    setHash('');
    game = restoreGame(saved);
    enterLobby();
    feedback('This turn link is incomplete or invalid. Ask the sender for the full link.');
    return;
  }
  game = restoreGame(saved);
  if (game?.victor) recordDailyResult(game);
  const pending = readStorage(lobbyKey, true);
  if (query.has('daily')) {
    const day = query.get('daily');
    enterLobby({ choices: pending?.choices, dailyDate: day });
    if (day && day !== 'today' && !isDailySeed(day)) {
      setSeedQuery();
      feedback('This puzzle date is invalid. Today’s challenge is ready to play.');
    }
  } else if (query.has('board')) {
    const code = query.get('board');
    const custom = readCustomBoard(code);
    enterLobby({ variant: custom?.variant, customCode: custom && code, choices: pending?.choices });
    if (!custom) {
      setSeedQuery();
      feedback('This custom board link is incomplete or invalid. Ask for a fresh board link.');
    }
  } else if (query.has('seed')) {
    const requested = query.get('seed');
    const seed = normalizeTextSeed(requested);
    const version = Number(query.get('v'));
    const boardVersion = seedVersion(seed, version);
    const variant = ['redblue', 'green'].includes(query.get('rules')) ? query.get('rules') : pending?.variant;
    const bot = query.get('bot');
    if (bot && normalizeMapSeed(seed) && ['green', 'redblue'].includes(variant) &&
        ((version === RATED_BOARD_VERSION && Object.hasOwn(RATED_BOT_BY_ID, bot)) ||
         (version === 1 && Object.hasOwn(COMPUTER_LEVELS, bot)))) {
      playGardenPractice({seed, boardVersion: version, variant, level: bot}, false);
      return;
    }
    enterLobby({ variant, choices: pending?.choices, seed: seed || requested, boardVersion });
    if (!seed) {
      $('seed-entry').open = true;
      $('map-seed').setCustomValidity(seedError(requested));
      $('map-seed').setAttribute('aria-invalid', 'true');
      feedback(seedError(requested));
    } else if (bot) {
      feedback('This bot practice link is incomplete. The seed is ready for a regular match.');
    }
  } else if (pending && ['redblue','green'].includes(pending.variant)) {
    // Unversioned lobby drafts from v3 only carried a seed when rematching.
    if (pending.seed && !pending.format && !pending.legacySeed) enterLobby({ ...pending, boardVersion: 3 });
    else enterLobby({ ...pending, dailyDate: undefined });
  } else if (isDailyMatch(game) && game.victor && dailySeed() !== game.seed) {
    enterLobby();
  } else if (isGardenPractice(game) || (game?.boardVersion >= 3 && (game.boardVersion >= CURRENT_BOARD_VERSION || !game.victor))) {
    activate(game, { previewEnd: saved.previewUntil });
  } else {
    enterLobby();
  }
}

$('new-game').addEventListener('click', () => enterLobby());
for (const id of ['rated-nav', 'open-rated', 'match-ratings']) {
  $(id).addEventListener('click', () => ratedDesk.open(ratedMatch?.variant ?? lobby?.variant ?? game?.variant));
}
$('rated-retry').addEventListener('click', () => {
  $('rated-retry').hidden = true;
  if ((ratedMatch || isGardenPractice(game)) && !game.victor) scheduleTurn();
});
$('rated-practice').addEventListener('click', () => {
  if (ratedMatch && typeof ratedMatch.won === 'boolean') playGardenPractice(ratedMatch);
});
$('today-puzzle').addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
  event.preventDefault();
  const here = new URL(location.href);
  here.search = '?daily=today';
  here.hash = '';
  history.replaceState(null, '', here);
  enterLobby();
  $('daily-level').focus({ preventScroll: true });
  $('play-daily').scrollIntoView({ block: 'center', behavior: 'instant' });
});
$('daily-level').addEventListener('change', () => {
  writeStorage(dailyLevelKey, $('daily-level').value);
  refreshDailyCard();
});
$('play-daily').addEventListener('click', () => {
  if (!lobby || phase !== 'ready' || dealing) return;
  refreshDailyCard();
  const seed = lobby.dailyDate || dailySeed();
  const level = $('daily-level').value;
  if (isDailyMatch(game) && game.seed === seed && dailyMatchLevel(game) === level && !game.victor) {
    activate(game, { previewEnd: readStorage(currentKey)?.previewUntil, scroll: true });
  } else {
    startDailyChallenge(seed, level);
  }
});
$('resume').addEventListener('click', () => {
  if (game) activate(newerStoredPosition() || restoreGame(saveData(game)) || game);
});
$('variant-green').addEventListener('click', () => chooseRules('green'));
$('variant-redblue').addEventListener('click', () => chooseRules('redblue'));
$('build-board').addEventListener('click', () => {
  if (phase === 'ready') builder.open(lobby.variant, lobby.customCode);
});
$('use-map').addEventListener('click', () => {
  if (!lobby) return;
  delete lobby.customCode;
  updateBoardSource();
  setSeedQuery(normalizeTextSeed(lobby.seed), lobby.boardVersion);
  writeStorage(lobbyKey, lobby, true);
  $('seed-entry').querySelector('summary').focus();
});
$('analyze-game').addEventListener('click', () => {
  if (phase === 'playing' && game?.victor) analyzer.open(game);
});
$('map-seed').addEventListener('input', () => {
  if (!lobby) return;
  lobby.seed = $('map-seed').value;
  delete lobby.legacySeed;
  const seed = normalizeTextSeed(lobby.seed);
  lobby.boardVersion = seedVersion(seed);
  const error = lobby.seed.trim() && !seed ? seedError(lobby.seed) : '';
  $('map-seed').setCustomValidity(error);
  if (error) $('map-seed').setAttribute('aria-invalid', 'true');
  else $('map-seed').removeAttribute('aria-invalid');
  feedback(error);
  updateSeedSummary();
  setSeedQuery(seed, lobby.boardVersion);
  writeStorage(lobbyKey, lobby, true);
});
$('restart').addEventListener('click', () => {
  if (phase !== 'playing') return;
  if (ratedMatch) ratedDesk.open(ratedMatch.variant);
  else if (isGardenPractice(game)) playGardenPractice({...game, level: game.players[otherSide(game.seat)].level});
  else if (isDailyMatch(game)) startDailyChallenge(game.seed, dailyMatchLevel(game));
  else enterLobby({ variant: game.variant, seed: game.boardVersion >= 3 ? game.seed : undefined, boardVersion: game.boardVersion });
});
$('undo').addEventListener('click', () => {
  if (phase === 'playing' && !ratedMatch && canUndo(game)) activate(undoTurn(game), { note: 'Turn taken back.' });
});
$('zoom').addEventListener('click', () => setZoom($('zoom').getAttribute('aria-pressed') !== 'true'));
$('scenery-toggle').addEventListener('click', () => {
  const visible = $('scenery-toggle').getAttribute('aria-pressed') !== 'true';
  setScenery(visible);
  writeStorage(sceneryKey, visible);
});
$('history-panel').addEventListener('toggle', () => {
  if (phase === 'playing' && $('history-panel').open) renderHistory();
});
function openGuide() { guide.open((lobby || game).variant, lobby ? true : game.timed); }
$('guide-nav').addEventListener('click', openGuide);
$('practice').addEventListener('click', openGuide);
for (const anchor of document.querySelectorAll('a[href="#game-table"]')) {
  anchor.addEventListener('click', event => {
    event.preventDefault();
    $('game-table').focus({ preventScroll: true });
    $('game-table').scrollIntoView({ block: 'start' });
  });
}

const shareDialog = $('share-dialog');
shareDialog.querySelector('[data-close]').addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('click', event => { if (event.target === shareDialog) shareDialog.close(); });
function gameUrl() {
  const base = location.hostname.endsWith('.chatgpt.site') ? 'https://sodium-qed.github.io/hackenbush/' : location.href;
  const url = new URL(base);
  url.hash = '';
  url.search = '';
  return url;
}
function openShare(url, title, description) {
  $('share-url').value = url.href;
  $('share-title').textContent = title;
  $('share-description').textContent = description;
  $('share-note').textContent = '';
  shareDialog.showModal();
  $('copy-link').focus();
}
$('share-map').addEventListener('click', () => {
  if (!game) return;
  const url = gameUrl();
  if (ratedMatch || isGardenPractice(game)) {
    url.searchParams.set('seed', game.seed);
    url.searchParams.set('v', String(game.boardVersion));
    url.searchParams.set('rules', game.variant);
    url.searchParams.set('bot', game.players[otherSide(game.seat)].level);
    openShare(url, 'Share a practice game', (game.board.family || 'Classic garden') + ' · Seed ' + game.seed +
      '. Play the same opening against ' + seatName(otherSide(game.seat)) + ' in an unrated game.');
    return;
  }
  if (game.boardVersion < 4) return;
  if (isDailyMatch(game)) {
    url.searchParams.set('daily', game.seed);
    openShare(url, 'Share this daily puzzle', dailyDateLabel(game.seed) + ' · The same garden and starting seat for everyone. Each player chooses their own computer difficulty.');
    return;
  }
  if (game.boardVersion === CUSTOM_BOARD_VERSION) {
    url.searchParams.set('board', game.seed);
    openShare(url, 'Share this board', game.board.family + ' · ' + rules[game.variant] + '. This link opens the original layout for a new match.');
    return;
  }
  url.searchParams.set('seed', game.seed);
  url.searchParams.set('v', String(game.boardVersion));
  url.searchParams.set('rules', game.variant);
  openShare(url, 'Share this map', game.board.family + ' · ' + game.seed +
    '. Open this link to play the same terrain and branches with a fresh draw and clock.');
});
$('share-turn').addEventListener('click', () => {
  const url = gameUrl();
  url.hash = encodeTurn(game);
  const title = game.victor ? 'Share the result' : game.moves.length ? 'Pass the turn' : 'Invite Player 1';
  const description = game.victor ? turnMessage()
    : 'Send this link to ' + seatName(game.side) + ' (' + seatDetails(game.side) + '). ' +
    (game.timed ? 'Open it when ready to play. Time in transit is free.' : 'Open it, make a cut, and send the turn back.');
  openShare(url, title, description);
});
$('copy-link').addEventListener('click', async () => {
  const input = $('share-url');
  if (await copyText(input.value)) $('share-note').textContent = 'Game link copied.';
  else { input.focus(); input.select(); $('share-note').textContent = 'Copy the highlighted link.'; }
});

function refreshTime() {
  watchRatedClock();
  if (phase === 'ready') { refreshDailyCard(); return; }
  if (!game || syncPosition()) return;
  if (phase === 'preview' && Date.now() >= previewUntil) endPreview();
  else if (phase === 'playing') tick();
}
document.addEventListener('visibilitychange', refreshTime);
window.addEventListener('pageshow', refreshTime);
window.addEventListener('storage', event => {
  if (event.key === RATING_KEY || event.key === null) {
    watchRatedClock();
    if (ratedMatch) syncPosition();
    ratedDesk.refresh();
  }
  if (event.key === sceneryKey) setScenery(readStorage(sceneryKey) !== false);
  if (phase === 'ready') refreshDailyCard();
  if (game && phase !== 'ready' && (event.key === currentKey || event.key === linksKey)) syncPosition();
});
window.addEventListener('hashchange', loadLocation);
setScenery(readStorage(sceneryKey) !== false);
loadLocation();
watchRatedClock();
