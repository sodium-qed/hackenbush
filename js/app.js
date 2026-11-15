import { createAudio } from './audio.js';
import { createAnalyzer } from './analyzer.js';
import { createBuilder } from './builder.js';
import { CUSTOM_BOARD_VERSION, readCustomBoard } from './custom-board.js';
import { renderLandscape } from './landscape.js';
import { createPractice } from './practice.js';
import { createBoard } from './board.js';
import { drawSeats } from './draw.js';
import { CURRENT_BOARD_VERSION, nextMapSeed, normalizeMapSeed, usesMapSeed } from './map-seed.js';
import { createGuide } from './guide.js';
import { copyText, decodeTurn, encodeTurn } from './linkplay.js';
import { createPlayers } from './players.js';
import { timeBoardPreview } from './preview.js';
import { otherSide } from './rules.js';
import { TURN_MS, canUndo, createGame, expireTurn, isHumanTurn, matchKey, playCut, receiveLink,
  restoreGame, saveData, startTurnClock, undoTurn } from './session.js';
import { chooseComputerMove, computerLevelLabel } from './opponents.js';

const $ = id => document.getElementById(id);
const currentKey = 'groundwork.hackenbush.match.v1';
const linksKey = 'groundwork.hackenbush.linkGames.v1';
const lobbyKey = 'groundwork.hackenbush.lobby.v3';
const entrantsKey = 'groundwork.hackenbush.entrants.v3';
const dealKey = 'groundwork.hackenbush.map-deal.v4';
const sceneryKey = 'groundwork.hackenbush.scenery.v1';
const colors = { green: 'Green', red: 'Red', blue: 'Blue' };
const rules = { green: 'Green', redblue: 'Red–Blue', mixed: 'Red–Blue + green' };
const audio = createAudio({ button: $('sound-nav'), dialog: $('sound-dialog') });
const practiceOptions = { onCut: details => audio.cut(details) };
const guide = createGuide($('guide-dialog'), practiceOptions);
const analyzer = createAnalyzer($('analyzer-dialog'));
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
let dealing = false;
let localDealState = null;
let paintedBoard = null;

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
  const data = saveData(game);
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
  if (seed && usesMapSeed(boardVersion)) {
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
function enterLobby({ variant, seed, choices, legacySeed, boardVersion, customCode } = {}) {
  cancelTimers();
  if ($('analyzer-dialog').open) $('analyzer-dialog').close();
  const previous = lobby || game;
  const candidate = customCode ?? (boardVersion === CUSTOM_BOARD_VERSION ? seed : null);
  const custom = candidate ? readCustomBoard(candidate) : null;
  const selected = custom?.variant ?? variant ?? previous?.variant;
  lobby = {
    format: CURRENT_BOARD_VERSION,
    boardVersion: boardVersion === 4 ? 4 : CURRENT_BOARD_VERSION,
    variant: selected === 'green' ? 'green' : 'redblue',
    choices: choices ?? lobby?.choices ?? readStorage(entrantsKey)
  };
  if (custom) lobby.customCode = candidate;
  if (typeof legacySeed === 'string') lobby.legacySeed = legacySeed;
  else if (typeof seed === 'string' && boardVersion === 3) lobby.legacySeed = seed;
  else if (typeof seed === 'string' && boardVersion !== CUSTOM_BOARD_VERSION) lobby.seed = seed;
  $('map-seed').value = lobby.seed || '';
  $('map-seed').setCustomValidity('');
  $('seed-entry').open = !!lobby.seed;
  updateSeedSummary();
  paintedBoard = null;
  previewUntil = 0;
  setZoom(false);
  if (location.hash.startsWith('#turn=')) setHash('');
  setPhase('ready');
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
    setSeedQuery(normalizeMapSeed(lobby.seed), lobby.boardVersion);
    updateBoardSource();
    feedback('Switched to generated maps for ' + rules[variant] + '.');
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
  const seed = normalizeMapSeed($('map-seed').value);
  $('seed-summary').textContent = seed || (lobby?.legacySeed ? 'Previous garden' : 'Random · 16,777,216 maps');
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
  const requested = lobby.customCode ? '' : input.value.trim();
  const code = normalizeMapSeed(requested);
  if (requested && !code) {
    $('seed-entry').open = true;
    input.setCustomValidity('Enter exactly six digits using 0–9 or A–F.');
    input.focus();
    input.reportValidity();
    return;
  }
  const draft = lobby;
  const legacy = !requested && typeof draft.legacySeed === 'string';
  const customCode = draft.customCode;
  const variant = draft.variant;
  const boardVersion = customCode ? CUSTOM_BOARD_VERSION : legacy ? 3 : draft.boardVersion;
  dealing = true;
  try {
    let seed = customCode ?? (legacy ? draft.legacySeed : code);
    if (seed == null) {
      seed = navigator.locks ? await navigator.locks.request(dealKey, drawMap) : drawMap();
    }
    if (lobby !== draft || phase !== 'ready' || draft.variant !== variant || draft.customCode !== customCode
        || draft.choices !== choices || (!customCode && input.value.trim() !== requested)) return;
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
function paintScenery() {
  if (paintedBoard === game.board) return;
  paintedBoard = game.board;
  const { board } = game;
  renderLandscape(boardView.landscape, board.world, board.mapSeed || 'A35D7E');
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
  details.push(player.kind === 'computer' ? computerLevelLabel(player.level) + ' computer' : 'Human');
  return details.join(' · ');
}
function cutInstruction() {
  if (game.variant === 'green') return 'Cut any green branch.';
  if (game.variant === 'mixed') return 'Cut a ' + game.side + ' or green branch.';
  return 'Cut a ' + game.side + ' branch.';
}
function outcome() {
  return seatName(game.side) + (game.timedOut ? ' ran out of time.' : ' has no legal cut.');
}
function turnMessage() {
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
    item.textContent = outcome() + ' ' + seatName(game.victor) + ' wins.';
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
  const card = $('turn-card');
  card.dataset.state = won ? 'won' : phase;
  card.dataset.side = game.variant === 'green' ? 'green' : side;
  $('turn-label').textContent = won ? 'Winner' : preview ? 'Drawn to open' : waiting ? 'Waiting for' : linked ? 'Your turn' : 'To move';
  $('turn-name').textContent = seatName(side);
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
  $('garden-name').textContent = game.board.family || 'Game board';
  const custom = game.boardVersion === CUSTOM_BOARD_VERSION;
  const code = usesMapSeed(game.boardVersion) ? game.seed : null;
  paintScenery();
  $('field-branches').textContent = game.live.length + (game.live.length === 1 ? ' branch' : ' branches');
  $('history-count').textContent = String(game.moves.length);
  $('share-map').hidden = !code && !custom;
  $('share-map-label').textContent = custom ? 'Share board' : 'Seed';
  $('map-code').textContent = code || '';
  $('map-code').hidden = !code;
  $('share-map').setAttribute('aria-label', custom ? 'Share custom board' : 'Share map seed ' + (code || ''));
  if (!preview) $('board-caption').textContent = rules[game.variant];
  $('field-label').textContent = won ? 'Final position' : preview ? 'Opening look' : custom ? 'Custom board' : game.boardVersion >= 3 ? 'Expert map' : 'Playing field';
  $('undo').hidden = game.timed || linked || Object.values(game.players).every(player => player.kind === 'computer');
  $('undo').disabled = !canUndo(game);
  showKey();
  renderRoster();
  if ($('history-panel').open) renderHistory();
  boardView.update({ board: game.board, live: game.live, side: game.side, locked: preview || !human, ...animation });
}
function sameMoves(a, b) { return a.length === b.length && a.every((id, i) => id === b[i]); }
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
  const updated = newerStoredPosition();
  if (!updated) return false;
  activate(updated, { note: 'The match advanced in another tab.' });
  return true;
}
function checkDeadline(now) {
  const resolved = expireTurn(game, now);
  if (resolved === game) return false;
  if (syncPosition()) return true;
  activate(resolved);
  audio.end({ timedOut: true });
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
  tick();
  if (phase !== 'playing' || game.victor || game.opponent === 'link' || game.players[game.side].kind !== 'computer') return;
  const position = game;
  computerTimer = setTimeout(() => {
    if (phase !== 'playing' || game !== position || checkDeadline(Date.now())) return;
    const move = chooseComputerMove(game.board, game.live, game.side, game.players[game.side].level);
    if (move.edgeId !== null) makeMove(move.edgeId);
  }, 700);
}
function makeMove(id) {
  if (phase !== 'playing' || game.victor || syncPosition()) return;
  const now = Date.now();
  if (checkDeadline(now)) return;
  const next = playCut(game, id, now);
  if (!next) return;
  game = startTurnClock(next, now);
  const last = game.rows.at(-1);
  feedback();
  saveMatch();
  renderMatch({ removed: last.fallen, cutId: last.edgeId });
  const edge = game.board.edges[last.branch - 1];
  const a = game.board.nodes.find(node => node.id === edge.a);
  const b = game.board.nodes.find(node => node.id === edge.b);
  audio.cut({ part: edge.part, fallen: last.fallen.length, position: (a.x + b.x) / 1800 });
  if (game.victor) audio.end({ timedOut: false });
  announce(seatName(last.side) + ' cut branch ' + last.branch + '. ' + turnMessage());
  scheduleTurn();
}
function endPreview() {
  if (phase !== 'preview') return;
  activate(game);
}
function activate(next, { note = '', previewEnd = 0, scroll = false } = {}) {
  cancelTimers();
  const now = Date.now();
  game = expireTurn(next, now);
  setSeedQuery();
  previewUntil = !game.victor && Number.isSafeInteger(previewEnd) && previewEnd > now ? Math.min(previewEnd, now + 2000) : 0;
  game = startTurnClock(game, previewUntil || now);
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
  renderMatch({ reset: true });
  if (scroll) {
    $('game-table').focus({ preventScroll: true });
    $('game-table').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  if (previewUntil) {
    announce(seatName(game.firstSide) + ' drew the first move. Two seconds to study the garden.');
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
  const pending = readStorage(lobbyKey, true);
  const query = new URL(location.href).searchParams;
  if (query.has('board')) {
    const code = query.get('board');
    const custom = readCustomBoard(code);
    enterLobby({ variant: custom?.variant, customCode: custom && code, choices: pending?.choices });
    if (!custom) {
      setSeedQuery();
      feedback('This custom board link is incomplete or invalid. Ask for a fresh board link.');
    }
  } else if (query.has('seed')) {
    const requested = query.get('seed');
    const seed = normalizeMapSeed(requested);
    const boardVersion = query.get('v') === '4' ? 4 : CURRENT_BOARD_VERSION;
    enterLobby({ variant: pending?.variant, choices: pending?.choices, seed: seed || requested, boardVersion });
    if (seed) setSeedQuery(seed, boardVersion);
    if (!seed) {
      $('seed-entry').open = true;
      feedback('This map link needs a six-digit seed using 0–9 or A–F.');
    }
  } else if (pending && ['redblue','green'].includes(pending.variant)) {
    // Unversioned lobby drafts from v3 only carried a seed when rematching.
    if (pending.seed && !pending.format && !pending.legacySeed) enterLobby({ ...pending, boardVersion: 3 });
    else enterLobby(pending);
  } else if (game?.boardVersion >= 3 && (game.boardVersion >= CURRENT_BOARD_VERSION || !game.victor)) {
    activate(game, { previewEnd: saved.previewUntil });
  } else {
    enterLobby();
  }
}

$('new-game').addEventListener('click', () => enterLobby());
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
  setSeedQuery(normalizeMapSeed(lobby.seed), lobby.boardVersion);
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
  lobby.boardVersion = CURRENT_BOARD_VERSION;
  $('map-seed').setCustomValidity('');
  feedback();
  updateSeedSummary();
  setSeedQuery(normalizeMapSeed(lobby.seed));
  writeStorage(lobbyKey, lobby, true);
});
$('restart').addEventListener('click', () => {
  if (phase === 'playing') enterLobby({ variant: game.variant, seed: game.boardVersion >= 3 ? game.seed : undefined, boardVersion: game.boardVersion });
});
$('undo').addEventListener('click', () => {
  if (phase === 'playing' && canUndo(game)) activate(undoTurn(game), { note: 'Turn taken back.' });
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
  if (!game || game.boardVersion < 4) return;
  const url = gameUrl();
  if (game.boardVersion === CUSTOM_BOARD_VERSION) {
    url.searchParams.set('board', game.seed);
    openShare(url, 'Share this board', game.board.family + ' · ' + rules[game.variant] + '. This link opens the original layout for a new match.');
    return;
  }
  url.searchParams.set('seed', game.seed);
  url.searchParams.set('v', String(game.boardVersion));
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
  if (!game || phase === 'ready' || syncPosition()) return;
  if (phase === 'preview' && Date.now() >= previewUntil) endPreview();
  else if (phase === 'playing') tick();
}
document.addEventListener('visibilitychange', refreshTime);
window.addEventListener('pageshow', refreshTime);
window.addEventListener('storage', event => {
  if (event.key === sceneryKey) setScenery(readStorage(sceneryKey) !== false);
  if (game && phase !== 'ready' && (event.key === currentKey || event.key === linksKey)) syncPosition();
});
window.addEventListener('hashchange', loadLocation);
setScenery(readStorage(sceneryKey) !== false);
loadLocation();
