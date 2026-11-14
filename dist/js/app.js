import { createBoard } from './board.js';
import { freshSeed } from './generator.js';
import { createGuide } from './guide.js';
import { copyText, decodeTurn, encodeTurn } from './linkplay.js';
import { createPlayers } from './players.js';
import { timeBoardPreview } from './preview.js';
import { otherSide } from './rules.js';
import { canUndo, createGame, isHumanTurn, matchKey, playCut, receiveLink, restoreGame, saveData, undoTurn } from './session.js';
import { chooseMove } from './strategy.js';

const $ = id => document.getElementById(id);
const currentKey = 'groundwork.hackenbush.match.v1';
const linkGamesKey = 'groundwork.hackenbush.linkGames.v1';
const openingKey = 'groundwork.hackenbush.opening.v2';
const colors = { green: 'Green', red: 'Red', blue: 'Blue' };
const sizes = { small: 'Small', standard: 'Standard', large: 'Large' };
const variantNames = { green: 'Green', redblue: 'Red–Blue', mixed: 'Red–Blue + green' };
const guide = createGuide($('guide-dialog'));
const playerForm = createPlayers($('players-view'), { onStart: startMatch, onChange: saveSeatChoices });
const boardView = createBoard($('board'), {
  onCut(id) { if (phase === 'playing' && isHumanTurn(game)) makeMove(id); }
});

let game = null;
let phase = 'ready';
let opening = null;
let hintId = null;
let computerTimer = null;
let previewFrame = null;
let cancelClock = null;

function readStorage(key, tabOnly = false) {
  try { return JSON.parse((tabOnly ? sessionStorage : localStorage).getItem(key)); } catch { return null; }
}
function writeStorage(key, data, tabOnly = false) {
  try {
    const storage = tabOnly ? sessionStorage : localStorage;
    if (data === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(data));
  } catch { /* Private or full storage still allows a match in memory. */ }
}
function recentLinkGames() {
  const saved = readStorage(linkGamesKey);
  return Array.isArray(saved) ? saved.filter(item => item && typeof item === 'object') : [];
}
function persist() {
  const data = saveData(game);
  writeStorage(currentKey, data);
  if (game.opponent === 'link') {
    const others = recentLinkGames().filter(item => matchKey(item) !== matchKey(game));
    writeStorage(linkGamesKey, [data, ...others].slice(0, 24));
  }
}
function setHash(hash) {
  if (location.hash === hash) return;
  const url = new URL(location.href);
  url.hash = hash;
  history.replaceState(null, '', url);
}
function feedback(text = '') {
  $('board-feedback').textContent = text;
  $('board-feedback').hidden = !text;
}
function announce(text) { $('announcer').textContent = text; }
function cancelTimers() {
  clearTimeout(computerTimer);
  computerTimer = null;
  cancelAnimationFrame(previewFrame);
  previewFrame = null;
  cancelClock?.();
  cancelClock = null;
}
function settingsOf(source) {
  return { seed: source.seed, variant: source.variant, difficulty: source.difficulty, boardVersion: source.boardVersion };
}
function validOpening(value) {
  return value && typeof value.seed === 'string' && value.seed.length <= 256 &&
    Object.hasOwn(variantNames, value.variant) && Object.hasOwn(sizes, value.difficulty) &&
    (value.boardVersion === 1 || value.boardVersion === 2);
}
function setZoom(zoomed) {
  $('board-scroll').dataset.zoom = String(zoomed);
  $('zoom').setAttribute('aria-pressed', String(zoomed));
  $('zoom').querySelector('span').textContent = zoomed ? 'Fit board' : 'Zoom board';
  if (!zoomed) $('board-scroll').scrollLeft = 0;
}
function variantControls(value) {
  $('variant-green').setAttribute('aria-pressed', String(value.variant === 'green'));
  $('variant-redblue').setAttribute('aria-pressed', String(value.variant !== 'green'));
  const locked = phase === 'preview' || phase === 'seats';
  $('variant-green').disabled = locked;
  $('variant-redblue').disabled = locked;
  $('mixed-row').hidden = value.variant === 'green';
  $('mixed-toggle').checked = value.variant === 'mixed';
  $('difficulty').value = value.difficulty;
}

function showKey(variant) {
  const key = $('edge-key');
  key.replaceChildren();
  const kinds = variant === 'green' ? ['green'] : variant === 'mixed' ? ['blue','red','green'] : ['blue','red'];
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

function setOpeningView(nextPhase) {
  phase = nextPhase;
  const ready = phase === 'ready';
  const preview = phase === 'preview';
  $('game-table').dataset.phase = phase;
  $('ready-view').hidden = !ready;
  $('field').hidden = !preview;
  $('board-tools').hidden = true;
  $('history-panel').hidden = true;
  $('setup-panel').hidden = !ready;
  $('settings-fields').hidden = !ready;
  $('match-players').hidden = true;
  $('link-area').hidden = true;
  $('share-turn').hidden = true;
  $('resume').hidden = !game;
  $('new-game').hidden = ready;
  $('guide-nav').disabled = preview;
  $('setup-title').textContent = 'Board settings';
  $('turn-card').dataset.variant = opening.variant;
  $('turn-card').dataset.state = 'opening';
  $('turn-card').removeAttribute('data-side');
  $('turn-label').textContent = 'Game rules';
  $('turn-name').textContent = variantNames[opening.variant];
  $('turn-help').textContent = opening.variant === 'green'
    ? 'Either player can cut any green branch. Player 1 goes first.'
    : opening.variant === 'mixed'
      ? 'Each player cuts their own color or green. Either color can go first.'
      : 'Each player cuts their own color. Either color can go first.';
  $('board-caption').textContent = ready ? 'Match setup' : preview ? '2 seconds' : 'Board covered';
  $('field-label').textContent = preview ? 'Study the board' : 'Playing field';
  variantControls(opening);
  if (phase !== 'seats') playerForm.close();
  feedback();
}
function readyForGame(config = {}) {
  cancelTimers();
  const previous = opening || game;
  opening = {
    seed: config.seed ?? freshSeed(),
    variant: config.variant ?? previous?.variant ?? 'redblue',
    difficulty: config.difficulty ?? previous?.difficulty ?? 'standard',
    boardVersion: config.boardVersion ?? 2
  };
  hintId = null;
  setZoom(false);
  if (location.hash.startsWith('#turn=')) setHash('');
  setOpeningView('ready');
  announce('Choose the board settings, then reveal the board.');
  writeStorage(openingKey, { ...opening, phase }, true);
}
function saveSeatChoices(choices) {
  if (phase !== 'seats') return;
  opening.choices = choices;
  writeStorage(openingKey, { ...opening, phase }, true);
}
function choosePlayers() {
  cancelTimers();
  setOpeningView('seats');
  writeStorage(openingKey, { ...opening, phase }, true);
  playerForm.open({ ...(opening.choices || game), variant: opening.variant });
  if (!$('guide-dialog').open) $('players-view').focus({ preventScroll: true });
  announce('Board covered. Choose the names, controllers, and turn order.');
}
function revealBoard() {
  if (phase !== 'ready') return;
  const position = createGame({ ...opening });
  setOpeningView('preview');
  // Reloading a preview returns to seat selection without exposing a second look.
  writeStorage(openingKey, { ...opening, phase: 'seats' }, true);
  showKey(opening.variant);
  boardView.update({ board: position.board, live: position.live, side: position.side, locked: true, reset: true });
  $('field').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  announce('Two-second board preview.');
  // Start after one painted frame with the whole board visible.
  previewFrame = requestAnimationFrame(() => {
    previewFrame = requestAnimationFrame(() => {
      if (phase !== 'preview') return;
      cancelClock = timeBoardPreview(seconds => {
        $('board-caption').textContent = seconds + (seconds === 1 ? ' second' : ' seconds');
      }, choosePlayers);
    });
  });
}
function startMatch(assignments) {
  if (phase !== 'seats') return;
  activate(createGame({ ...settingsOf(opening), ...assignments }));
}

function seatName(side) { return game.players[side].name; }
function seatLabel(side) { return side === game.firstSide ? 'Player 1' : 'Player 2'; }
function seatDetails(side) {
  const parts = [seatLabel(side)];
  if (game.variant !== 'green') parts.push(colors[side]);
  parts.push(game.players[side].kind === 'computer' ? 'Computer' : 'Human');
  return parts.join(' · ');
}
function renderRoster() {
  const list = $('match-players');
  list.replaceChildren();
  for (const side of [game.firstSide, otherSide(game.firstSide)]) {
    const item = document.createElement('li');
    item.className = 'roster-seat';
    item.dataset.side = game.variant === 'green' ? 'green' : side;
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
    item.append(number, details);
    list.append(item);
  }
}
function renderHistory() {
  const content = $('history-content');
  content.replaceChildren();
  if (!game.rows.length) {
    const message = document.createElement('p');
    message.className = 'empty-history';
    message.textContent = 'The first move will appear here.';
    content.append(message);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'history-list';
  list.reversed = true;
  for (const row of [...game.rows].reverse()) {
    const item = document.createElement('li');
    item.className = 'history-row';
    const chip = document.createElement('i');
    chip.className = 'move-chip ' + row.color;
    chip.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = seatName(row.side);
    const description = document.createElement('span');
    description.append(name, document.createTextNode(' cut ' + row.color + ' branch #' + row.branch + '.'));
    item.append(chip, description);
    list.append(item);
  }
  content.append(list);
}
function turnMessage() {
  if (game.victor) return seatName(game.victor) + ' wins. ' + seatName(game.side) + ' has no move.';
  return seatName(game.side) + ' to move. ' + seatDetails(game.side) + '.';
}
function renderMatch(animation = {}) {
  const human = isHumanTurn(game);
  const won = Boolean(game.victor);
  const side = game.victor ?? game.side;
  const linked = game.opponent === 'link';
  const waiting = linked && !human && !won;
  const invite = waiting && game.moves.length === 0;
  const card = $('turn-card');
  card.dataset.state = won ? 'won' : 'playing';
  card.dataset.side = side;
  card.dataset.variant = game.variant;
  $('turn-label').textContent = won ? 'Winner' : waiting ? 'Waiting for' : linked ? 'Your turn' : 'To move';
  $('turn-name').textContent = seatName(side);
  $('turn-help').textContent = seatDetails(side) + (won ? ' · ' + seatName(game.side) + ' has no move.' : '');
  $('share-turn').hidden = !linked || (!waiting && !won);
  $('share-turn').querySelector('span').textContent = won ? 'Share result' : invite ? 'Invite Player 1' : 'Share turn link';
  $('link-area').hidden = !linked;
  if (linked) {
    $('link-explain').textContent = invite ? 'Invite the first player, then open their reply on this device.'
      : waiting ? 'Send the turn link to the other player. Open their reply to take your next turn.'
        : won ? 'The final link includes the result and move history.' : 'Make a cut, then send the turn link to the other player.';
  }
  $('board-caption').textContent = sizes[game.difficulty] + ' board';
  $('field-label').textContent = won ? 'Final position' : 'Playing field';
  $('hint').hidden = !Object.values(game.players).some(player => player.kind === 'computer') || linked;
  $('hint').disabled = !human;
  $('hint').setAttribute('aria-pressed', String(!!hintId));
  $('undo').hidden = linked || Object.values(game.players).every(player => player.kind === 'computer');
  $('undo').disabled = !canUndo(game);
  $('restart').title = 'Preview this board again and choose new seats';
  variantControls(game);
  showKey(game.variant);
  renderRoster();
  if ($('history-panel').open) renderHistory();
  boardView.update({ board: game.board, live: game.live, side: game.side, locked: !human, hintId, ...animation });
}

function scheduleComputer() {
  clearTimeout(computerTimer);
  if (phase !== 'playing' || game.victor || game.opponent === 'link' || game.players[game.side].kind !== 'computer') return;
  const pending = game;
  computerTimer = setTimeout(() => {
    if (phase !== 'playing' || game !== pending) return;
    const move = chooseMove(game.board, game.live, game.side);
    if (move.edgeId !== null) makeMove(move.edgeId);
  }, 750);
}
function makeMove(id) {
  if (phase !== 'playing') return;
  if (game.opponent === 'link') {
    const latest = recentLinkGames().find(item => matchKey(item) === matchKey(game));
    if (latest && latest.moves?.length >= game.moves.length && JSON.stringify(latest.moves) !== JSON.stringify(game.moves)) {
      const shared = restoreGame(latest);
      if (shared) { activate(shared, 'The shared game advanced in another tab.'); return; }
    }
  }
  const next = playCut(game, id);
  if (!next) return;
  game = next;
  hintId = null;
  const last = game.rows.at(-1);
  feedback();
  persist();
  if (game.opponent === 'link') setHash(encodeTurn(game));
  renderMatch({ removed: last.fallen, cutId: last.edgeId });
  announce(seatName(last.side) + ' cut branch ' + last.branch + '. ' + turnMessage());
  scheduleComputer();
}
function activate(next, note = '') {
  cancelTimers();
  playerForm.close();
  phase = 'playing';
  opening = null;
  game = next;
  hintId = null;
  writeStorage(openingKey, null, true);
  persist();
  if (game.opponent === 'link') setHash(encodeTurn(game));
  else if (location.hash.startsWith('#turn=')) setHash('');
  $('game-table').dataset.phase = phase;
  $('ready-view').hidden = true;
  $('field').hidden = false;
  $('board-tools').hidden = false;
  $('history-panel').hidden = false;
  $('setup-panel').hidden = false;
  $('settings-fields').hidden = true;
  $('match-players').hidden = false;
  $('new-game').hidden = false;
  $('guide-nav').disabled = false;
  $('setup-title').textContent = 'Players';
  feedback(note);
  renderMatch({ reset: true });
  announce(note || turnMessage());
  scheduleComputer();
}
function loadLocation() {
  const savedData = readStorage(currentKey);
  const savedGame = savedData && (savedData.boardVersion || savedData.moves?.length) ? restoreGame(savedData) : null;
  if (location.hash.startsWith('#turn=')) {
    const linked = decodeTurn(location.hash);
    if (linked) {
      const known = recentLinkGames().find(item => matchKey(item) === matchKey(linked));
      const incoming = receiveLink(linked, known);
      if (incoming.game) { activate(incoming.game, incoming.note); return; }
    }
    setHash('');
    if (savedGame) activate(savedGame);
    else readyForGame();
    feedback('This turn link is incomplete or invalid. Ask the sender for the full link.');
    return;
  }
  if (opening || game) return;
  const pending = readStorage(openingKey, true);
  if (validOpening(pending)) {
    game = savedGame;
    readyForGame(settingsOf(pending));
    if (pending.phase === 'seats') {
      opening.choices = pending.choices;
      choosePlayers();
    }
  } else if (savedGame) activate(savedGame);
  else readyForGame();
}

$('new-game').addEventListener('click', () => readyForGame());
$('reveal').addEventListener('click', revealBoard);
$('resume').addEventListener('click', () => { if (game) activate(game); });
$('variant-green').addEventListener('click', () => {
  if ((opening || game).variant !== 'green') readyForGame({ variant: 'green' });
});
$('variant-redblue').addEventListener('click', () => {
  if ((opening || game).variant === 'green') readyForGame({ variant: 'redblue' });
});
$('mixed-toggle').addEventListener('change', event => {
  if (phase === 'ready') readyForGame({ variant: event.currentTarget.checked ? 'mixed' : 'redblue' });
});
$('difficulty').addEventListener('change', event => {
  if (phase === 'ready') readyForGame({ difficulty: event.currentTarget.value });
});
$('restart').addEventListener('click', () => {
  if (phase !== 'playing') return;
  readyForGame(settingsOf(game));
  revealBoard();
});
$('undo').addEventListener('click', () => {
  if (phase !== 'playing' || !canUndo(game)) return;
  activate(undoTurn(game), 'Turn taken back.');
});
$('zoom').addEventListener('click', () => setZoom($('zoom').getAttribute('aria-pressed') !== 'true'));
$('history-panel').addEventListener('toggle', () => {
  if (phase === 'playing' && $('history-panel').open) renderHistory();
});
$('hint').addEventListener('click', () => {
  if (phase !== 'playing' || !isHumanTurn(game)) return;
  if (hintId) { hintId = null; feedback(); renderMatch(); return; }
  const move = chooseMove(game.board, game.live, game.side);
  if (move.edgeId === null) return;
  hintId = move.edgeId;
  const index = game.board.edges.findIndex(edge => edge.id === hintId) + 1;
  const text = move.proven && move.winning ? 'Branch #' + index + ' is a winning cut with perfect play.'
    : 'Try the highlighted branch, #' + index + '.';
  feedback(text);
  renderMatch();
});
$('guide-nav').addEventListener('click', () => guide.open((opening || game).variant));
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
$('share-turn').addEventListener('click', () => {
  const base = location.hostname.endsWith('.chatgpt.site') ? 'https://sodium-qed.github.io/hackenbush/' : location.href;
  const url = new URL(base);
  url.hash = encodeTurn(game);
  $('share-url').value = url.href;
  const invite = !game.moves.length && !game.victor;
  $('share-title').textContent = game.victor ? 'Share the result' : invite ? 'Invite Player 1' : 'Pass the turn';
  $('share-description').textContent = game.victor ? 'The link includes the final board and both players’ moves.'
    : 'Send this link to ' + seatName(game.side) + ' (' + seatDetails(game.side) + '). They can open it, make their cut, and send the turn back.';
  $('share-note').textContent = '';
  shareDialog.showModal();
  $('copy-link').focus();
});
$('copy-link').addEventListener('click', async () => {
  const input = $('share-url');
  if (await copyText(input.value)) $('share-note').textContent = 'Game link copied.';
  else { input.focus(); input.select(); $('share-note').textContent = 'Select Copy to copy the highlighted link.'; }
});

document.addEventListener('visibilitychange', () => {
  if (phase === 'preview' && document.hidden) choosePlayers();
});
window.addEventListener('hashchange', loadLocation);
loadLocation();
