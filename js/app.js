import { createBoard } from './board.js';
import { freshSeed } from './generator.js';
import { createGuide } from './guide.js';
import { copyText, decodeTurn, encodeTurn } from './linkplay.js';
import { legalMoves } from './rules.js';
import { chooseMove } from './strategy.js';
import { createGame, isHumanTurn, matchKey, playCut, receiveLink, restoreGame, saveData, undoTurn } from './session.js';

const $ = id => document.getElementById(id);
const currentKey = 'groundwork.hackenbush.match.v1';
const linkGamesKey = 'groundwork.hackenbush.linkGames.v1';
const colors = { green: 'Green', red: 'Red', blue: 'Blue' };
const guide = createGuide($('guide-dialog'));
const boardView = createBoard($('board'), { onCut: id => { if (isHumanTurn(game)) makeMove(id); } });
let game;
let hintId = null;
let computerTimer = null;

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function writeStorage(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* Play continues in memory. */ }
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
function replaceHash(hash) {
  if (location.hash === hash) return;
  const url = new URL(location.href);
  url.hash = hash;
  history.replaceState(null, '', url);
}
function setFeedback(text) {
  $('board-feedback').textContent = text;
  $('board-feedback').hidden = !text;
}
function announce(text) { $('announcer').textContent = text; }
function plural(n, one, many = one + 's') { return n + ' ' + (n === 1 ? one : many); }
function seatName(side) {
  if (game.opponent === 'computer') return side === 'blue' ? 'You' : 'Computer';
  if (game.variant !== 'green') return colors[side];
  return side === 'blue' ? 'Player 1' : 'Player 2';
}
function permissionText() {
  if (game.variant === 'green') return 'Choose any green branch to cut.';
  const choices = game.variant === 'mixed' ? game.side + ' or green' : game.side;
  return 'Choose a ' + choices + ' branch to cut.';
}
function winTitle() {
  return seatName(game.victor) + (seatName(game.victor) === 'You' ? ' win!' : ' wins!');
}
function outcomeText() {
  return seatName(game.side) + (seatName(game.side) === 'You' ? ' have' : ' has') + ' no legal cut left.';
}

function showKey() {
  const key = $('edge-key');
  key.replaceChildren();
  const kinds = game.variant === 'green' ? [['green', 'Shared']] : [['blue', 'Blue'], ['red', 'Red']];
  if (game.variant === 'mixed') kinds.push(['green', 'Shared']);
  for (const [color, label] of kinds) {
    const item = document.createElement('span');
    item.className = 'key-item';
    const swatch = document.createElement('i');
    swatch.className = 'key-stroke ' + color;
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(label));
    key.append(item);
  }
}
function renderHistory() {
  const content = $('history-content');
  $('history-count').textContent = plural(game.rows.length, 'move');
  content.replaceChildren();
  if (!game.rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-history';
    empty.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-history"/></svg><span>Your cuts will appear here.</span>';
    content.append(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'history-list';
  list.reversed = true;
  list.start = game.rows.length;
  for (let i = game.rows.length - 1; i >= 0; i--) {
    const row = game.rows[i];
    const item = document.createElement('li');
    item.className = 'history-row';
    const number = document.createElement('span');
    number.className = 'move-no';
    number.textContent = String(i + 1).padStart(2, '0');
    const chip = document.createElement('i');
    chip.className = 'move-chip ' + row.color;
    chip.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    const actor = document.createElement('strong');
    actor.textContent = seatName(row.side);
    text.append(actor, document.createTextNode(' cut ' + row.color + ' #' + row.branch));
    const falls = document.createElement('span');
    falls.className = 'fall-count';
    falls.textContent = row.fallen.length ? '+' + row.fallen.length + ' fell' : '0 fell';
    item.append(number, chip, text, falls);
    list.append(item);
  }
  content.append(list);
}
function renderLinkPanel(waiting) {
  const linked = game.opponent === 'link';
  $('link-area').hidden = !linked;
  if (!linked) return;
  const canShare = !!game.victor || waiting;
  $('share-turn').hidden = !canShare;
  $('share-turn').querySelector('span').textContent = game.victor ? 'Share result' : 'Share turn link';
  let detail = 'Make one cut, then send the turn link to your opponent.';
  if (waiting) detail = 'Send the turn link. Open the reply here for your next move.';
  if (game.victor) detail = 'Send the final position so both players can see the result.';
  $('link-explain').textContent = 'You are ' + seatName(game.seat) + '. ' + detail;
}
function render(animation = {}) {
  const human = isHumanTurn(game);
  const waiting = !game.victor && game.opponent === 'link' && !human;
  const computer = !game.victor && game.opponent === 'computer' && !human;
  const card = $('turn-card');
  card.dataset.side = game.victor ?? game.side;
  card.dataset.state = game.victor ? 'won' : 'playing';
  $('turn-label').textContent = game.victor ? 'Game over' : waiting ? 'Waiting for' : game.opponent === 'link' ? 'Your turn' : 'Current turn';
  $('turn-name').textContent = game.victor ? winTitle() : seatName(game.side);
  $('turn-help').textContent = game.victor ? outcomeText() : waiting ? 'Share the link to pass the turn.' : computer ? 'Considering the next cut…' : permissionText();
  $('branch-count').textContent = game.live.length;
  $('legal-count').textContent = legalMoves(game.board, game.live, game.side).length;
  $('variant-green').setAttribute('aria-pressed', String(game.variant === 'green'));
  $('variant-redblue').setAttribute('aria-pressed', String(game.variant !== 'green'));
  $('mixed-row').hidden = game.variant === 'green';
  $('mixed-toggle').checked = game.variant === 'mixed';
  $('opponent').value = game.opponent;
  $('difficulty').value = game.difficulty;
  $('seed-value').textContent = game.seed || '(empty)';
  $('seed-open').title = 'Puzzle seed ' + game.seed + '. View or enter a seed.';
  $('hint').disabled = !human;
  $('hint').setAttribute('aria-pressed', String(!!hintId));
  $('undo').disabled = !game.moves.length || game.opponent === 'link';
  $('undo').title = game.opponent === 'link' ? 'Turn links preserve the shared move history.' : 'Take back the last turn';
  $('restart').disabled = !game.moves.length || game.opponent === 'link';
  $('restart').title = game.opponent === 'link' ? 'Choose New puzzle to start another linked match.' : 'Replay this puzzle from the opening';
  renderLinkPanel(waiting);
  showKey();
  renderHistory();
  boardView.update({ board: game.board, live: game.live, side: game.side, locked: !human, hintId, ...animation });
}
function cancelComputer() {
  clearTimeout(computerTimer);
  computerTimer = null;
}
function scheduleComputer() {
  cancelComputer();
  if (game.opponent !== 'computer' || game.victor || game.side !== 'red') return;
  const pending = game;
  computerTimer = setTimeout(() => {
    computerTimer = null;
    if (game !== pending) return;
    const move = chooseMove(game.board, game.live, game.side);
    if (move.edgeId !== null) makeMove(move.edgeId);
  }, 540);
}
function makeMove(id) {
  const next = playCut(game, id);
  if (!next) return;
  game = next;
  hintId = null;
  const last = game.rows.at(-1);
  setFeedback('');
  persist();
  if (game.opponent === 'link') replaceHash(encodeTurn(game));
  render({ removed: last.fallen, cutId: last.edgeId });
  announce(seatName(last.side) + ' cut branch ' + last.branch + '. ' + plural(last.fallen.length, 'other branch', 'other branches') + ' fell. ' +
    (game.victor ? winTitle() + ' ' + outcomeText() : seatName(game.side) + ' to move.'));
  scheduleComputer();
}
function activate(next, note = '') {
  cancelComputer();
  game = next;
  hintId = null;
  setFeedback(note);
  persist();
  if (game.opponent === 'link' && game.moves.length) replaceHash(encodeTurn(game));
  else if (location.hash.startsWith('#turn=')) replaceHash('');
  render({ reset: true });
  scheduleComputer();
}
function restartWith(settings, note) {
  activate(createGame({ ...saveData(game), seat: 'blue', ...settings }), note);
  announce(note || 'New puzzle. ' + seatName(game.side) + ' to move.');
}
function processLocation() {
  if (location.hash.startsWith('#turn=')) {
    const decoded = decodeTurn(location.hash);
    if (decoded) {
      const saved = recentLinkGames().find(item => matchKey(item) === matchKey(decoded));
      const imported = receiveLink(decoded, saved);
      if (imported.game) { activate(imported.game, imported.note); return; }
    }
    activate(restoreGame(readStorage(currentKey)) || createGame({ seed: freshSeed() }), 'This turn link is incomplete or invalid. Ask the sender to copy the full link.');
    return;
  }
  if (!game) activate(restoreGame(readStorage(currentKey)) || createGame({ seed: freshSeed() }));
}

$('new-puzzle').addEventListener('click', () => restartWith({ seed: freshSeed() }, ''));
$('variant-green').addEventListener('click', () => {
  if (game.variant !== 'green') restartWith({ variant: 'green' }, 'Green game. Either player can cut any branch.');
});
$('variant-redblue').addEventListener('click', () => {
  if (game.variant === 'green') restartWith({ variant: 'redblue' }, 'Red–Blue game. Blue moves first.');
});
$('mixed-toggle').addEventListener('change', event => {
  restartWith({ variant: event.currentTarget.checked ? 'mixed' : 'redblue' }, event.currentTarget.checked ? 'Green branches are shared. Blue moves first.' : 'Red–Blue game. Blue moves first.');
});
$('opponent').addEventListener('change', event => restartWith({ opponent: event.currentTarget.value }, ''));
$('difficulty').addEventListener('change', event => restartWith({ difficulty: event.currentTarget.value }, ''));
$('restart').addEventListener('click', () => { if (!$('restart').disabled) restartWith({}, 'Puzzle restarted.'); });
$('undo').addEventListener('click', () => {
  const before = undoTurn(game);
  if (before !== game) activate(before, 'Turn taken back.');
});
$('hint').addEventListener('click', () => {
  if (!isHumanTurn(game)) return;
  if (hintId) { hintId = null; setFeedback(''); render(); return; }
  const result = chooseMove(game.board, game.live, game.side);
  if (result.edgeId === null) return;
  hintId = result.edgeId;
  const branch = game.board.edges.findIndex(edge => edge.id === hintId) + 1;
  let note = 'Suggested cut: branch ' + branch + '.';
  if (result.proven && result.winning) note = 'Branch ' + branch + ' is a winning cut with perfect play.';
  if (result.proven && !result.winning) note = 'There is no forced win here. Branch ' + branch + ' is one possible cut.';
  setFeedback(note + ' Look for the dotted outline.');
  render();
});
$('guide-nav').addEventListener('click', () => guide.open(game.variant));
for (const anchor of document.querySelectorAll('a[href="#game-table"]')) {
  anchor.addEventListener('click', event => {
    event.preventDefault();
    $('game-table').focus({ preventScroll: true });
    $('game-table').scrollIntoView({ block: 'start' });
  });
}

const seedDialog = $('seed-dialog');
const shareDialog = $('share-dialog');
for (const dialog of [seedDialog, shareDialog]) {
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
}
$('seed-open').addEventListener('click', () => {
  $('seed-input').value = game.seed;
  $('seed-input').setCustomValidity('');
  $('seed-note').textContent = '';
  seedDialog.showModal();
  $('seed-input').focus();
  $('seed-input').select();
});
$('seed-input').addEventListener('input', () => $('seed-input').setCustomValidity(''));
$('seed-form').addEventListener('submit', event => {
  event.preventDefault();
  const seed = $('seed-input').value.trim();
  if (!seed) {
    $('seed-input').setCustomValidity('Enter a puzzle seed.');
    $('seed-input').reportValidity();
    return;
  }
  seedDialog.close();
  restartWith({ seed }, 'Puzzle loaded from seed.');
});
$('copy-seed').addEventListener('click', async () => {
  const input = $('seed-input');
  if (await copyText(input.value)) $('seed-note').textContent = 'Seed copied.';
  else { input.focus(); input.select(); $('seed-note').textContent = 'Select Copy to copy the highlighted seed.'; }
});
$('share-turn').addEventListener('click', () => {
  const url = new URL(location.href);
  url.hash = encodeTurn(game);
  $('share-url').value = url.href;
  $('share-title').textContent = game.victor ? 'Share the result' : 'Pass the turn';
  $('share-description').textContent = game.victor ? 'Send the final board and move history to your opponent.' : 'Send this link to your opponent. They can open the board on their device, cut a branch, and send the next turn back.';
  $('share-note').textContent = '';
  shareDialog.showModal();
  $('copy-link').focus();
});
$('copy-link').addEventListener('click', async () => {
  const input = $('share-url');
  if (await copyText(input.value)) $('share-note').textContent = 'Game link copied.';
  else { input.focus(); input.select(); $('share-note').textContent = 'Select Copy to copy the highlighted link.'; }
});
window.addEventListener('hashchange', processLocation);
processLocation();
