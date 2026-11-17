import {createBoard} from './board.js';
import {generateBoard} from './generator.js';
import {renderLandscape} from './landscape.js';
import {otherSide} from './rules.js';
import {entrantName} from './draw.js';
import {mountOnlineDialog} from './online-view.js';
import {normalizeRoomCode, onlineApiBase, readOnlineIntent, requestOnline, roomInviteUrl} from './online-session.js';

const dialog = document.querySelector('#online-dialog');
const fields = mountOnlineDialog(dialog);
const title = dialog.querySelector('#online-title');
const setupTitle = dialog.querySelector('#online-setup-title');
const modeButtons = [...dialog.querySelectorAll('[data-mode]')];
const variantButtons = [...dialog.querySelectorAll('[data-variant]')];
const variants = {green: 'Green', redblue: 'Red–Blue'};
const colors = {blue: 'Blue', red: 'Red'};
const elo = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0});
const tokenKey = 'groundwork.hackenbush.online.token.v1';
const activeKey = 'groundwork.hackenbush.online.active.v1';
const empty = {profile: null, match: null, queue: null, room: null};
const meta = document.querySelector('meta[name="hackenbush-api"]')?.content;
const api = onlineApiBase(location.href, meta);

function browserStorage() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const store = window[name];
      const probe = tokenKey + '.probe';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    } catch { /* Try tab storage when local storage is unavailable. */ }
  }
  return null;
}

const store = browserStorage();
function saved(key) { try { return store?.getItem(key); } catch { return null; } }
function save(key, value) {
  try {
    if (value) store?.setItem(key, value);
    else store?.removeItem(key);
  } catch { /* The current tab can still play. */ }
}
function put(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

let token = saved(tokenKey);
let state = empty;
let mode = 'ranked';
let variant = 'redblue';
let connection = 'connecting';
let note = '';
let editing = false;
let confirming = false;
let clockOffset = 0;
let pendingRead = null;
let operation = '';
let pendingClose = null;
let invited = false;
let joiningCode = null;
let pollTimer = 0;
let clockTimer = 0;
let failures = 0;
let boardView = null;
let board = null;
let boardMatch = null;
let paintedVersion = -1;
let paintedMoves = -1;
let paintedLock = null;
let winnerShown = false;
let zoom = false;

function writeZoom(value) {
  zoom = value;
  fields.zoom.setAttribute('aria-pressed', String(zoom));
  fields['board-scroll'].dataset.zoom = String(zoom);
  if (!zoom) fields['board-scroll'].scrollLeft = 0;
}

function accept({payload, clockOffset: offset}) {
  const prev = state;
  clockOffset = offset;
  if (payload.token) {
    token = payload.token;
    save(tokenKey, token);
  }
  state = payload;
  connection = 'connected';
  failures = 0;
  const active = state.match || state.queue || state.room;
  save(activeKey, active ? '1' : null);
  if (active) {
    variant = active.variant;
    mode = state.match ? (state.match.rated ? 'ranked' : 'rooms') : state.queue ? 'ranked' : 'rooms';
    editing = false;
  } else if (invited) {
    mode = 'rooms';
  }
  if (state.match && !state.match.rated && joiningCode) {
    invited = false;
    joiningCode = null;
    clearRoomParam();
  }
  if (prev.room?.code !== state.room?.code) put(fields['copy-note'], '');
  if (prev.match?.id !== state.match?.id) {
    confirming = false;
    note = '';
  }
  if (state.match?.result) confirming = false;
  if (!operation && !active && prev.queue) note = 'Your search expired. Find an opponent to rejoin the queue.';
  if (!operation && !active && prev.room) note = 'That room has closed. Create a new room to invite a friend.';
}

function forgetSession() {
  token = null;
  state = empty;
  save(tokenKey, null);
  save(activeKey, null);
  note = 'Your guest session expired. A new profile will be created for this browser.';
}

function schedule(delay) {
  clearTimeout(pollTimer);
  if (!dialog.open || pendingRead || operation) return;
  if (delay === undefined) {
    if (connection === 'offline') delay = Math.min(1000 * 2 ** Math.min(failures, 3), 8000);
    else if (state.match && !state.match.result) delay = document.hidden ? 3000 : 700;
    else if (state.room || state.queue) delay = document.hidden ? 3000 : 900;
    else return;
  }
  pollTimer = setTimeout(synchronize, delay);
}

async function synchronize() {
  if (pendingRead || operation || !dialog.open) return;
  const controller = new AbortController();
  pendingRead = controller;
  try {
    let response;
    if (token) {
      try {
        response = await requestOnline(api, '/api/state', {token, controller});
      } catch (error) {
        if (pendingRead !== controller || error.status !== 401) throw error;
        forgetSession();
      }
    }
    if (!response && pendingRead === controller) response = await obtainGuest(controller);
    if (pendingRead === controller) accept(response);
  } catch {
    if (pendingRead === controller) { connection = 'offline'; failures++; }
  } finally {
    if (pendingRead === controller) {
      pendingRead = null;
      refresh();
      schedule();
    }
  }
}

// A pair of tabs opening for the first time should share one identity. Save
// the issued token before releasing the origin-wide lock when available.
async function obtainGuest(controller) {
  async function obtain() {
    if (pendingRead !== controller) return;
    const existing = saved(tokenKey);
    if (existing) {
      token = existing;
      return requestOnline(api, '/api/state', {token, controller});
    }
    const response = await requestOnline(api, '/api/profile', {method: 'POST', body: {}, controller});
    if (pendingRead !== controller) return;
    const concurrent = saved(tokenKey);
    if (concurrent) {
      token = concurrent;
      return requestOnline(api, '/api/state', {token, controller});
    }
    token = response.payload.token;
    save(tokenKey, token);
    return response;
  }
  if (store && navigator.locks?.request) return navigator.locks.request(tokenKey, {signal: controller.signal}, obtain);
  return obtain();
}

// An action supersedes an in-flight poll. A slow snapshot can never roll
// the board back after a cut, room cancellation, or match dismissal.
async function act(label, path, method, body) {
  if (operation || !token || connection !== 'connected') return false;
  const previous = pendingRead;
  pendingRead = null;
  previous?.abort();
  clearTimeout(pollTimer);
  operation = label;
  const credential = token;
  note = '';
  if (['find', 'create', 'join'].includes(label)) save(activeKey, '1');
  refresh();
  let succeeded = false;
  try {
    const response = await requestOnline(api, path, {token: credential, method, body});
    if (credential === token) { accept(response); succeeded = true; }
  } catch (error) {
    if (credential !== token) {
      // Another tab switched identities. Its authoritative state follows.
    } else if (error.status === 401) {
      forgetSession();
      connection = 'connecting';
    } else if (!error.status || error.status >= 500) {
      connection = 'offline';
      failures++;
    } else {
      note = error.message;
    }
  } finally {
    operation = '';
    refresh();
    schedule(succeeded ? undefined : 0);
    if (pendingClose) {
      const priorMatch = pendingClose.matchId;
      pendingClose = null;
      if (!state.match || state.match.id === priorMatch) closeView();
    }
  }
  return succeeded;
}

function clockPhase(match) {
  if (match.result) return 'done';
  const now = Date.now() + clockOffset;
  if (now < match.turnStartsAt) return 'preview';
  if (now >= match.deadline) return 'elapsed';
  return match.side === match.seat ? 'own' : 'opponent';
}

function updateBoard(match, phase) {
  const newBoard = boardMatch !== match.id;
  if (newBoard) {
    board = generateBoard(match.seed, match.variant, match.difficulty, match.boardVersion);
    if (!boardView) boardView = createBoard(fields.board, {onCut: cut});
    renderLandscape(boardView.landscape, board.world, board.mapSeed || match.seed);
    boardMatch = match.id;
    paintedVersion = -1;
    paintedMoves = -1;
    winnerShown = false;
    writeZoom(false);
    put(fields.garden, board.family || 'Match garden');
  }
  const locked = phase !== 'own' || connection !== 'connected' || !!operation;
  if (paintedVersion !== match.version || paintedLock !== locked) {
    const cutId = match.moves.at(-1) ?? null;
    boardView.update({board, live: match.live, side: match.side, locked, cutId, reset: paintedVersion === -1});
    paintedLock = locked;
    paintedVersion = match.version;
    paintedMoves = match.moves.length;
  }
  if (newBoard && phase !== 'done') {
    const target = fields.board.querySelector('[data-edge-id][tabindex="0"]') || fields.board.querySelector('svg[role="group"]');
    target?.focus({preventScroll: true});
  }
  if (!winnerShown && phase === 'done') {
    winnerShown = true;
    fields['result-title'].focus({preventScroll: true});
    if (match.result.winner === match.seat) boardView.celebrate(match.variant === 'green' ? 'green' : match.seat);
  }
}

function cut(edgeId) {
  const match = state.match;
  if (match && clockPhase(match) === 'own') {
    act('cut', '/api/matches/' + match.id + '/move', 'POST', {version: match.version, edgeId});
  }
}

function showSeat(who, match, side) {
  const player = match.players[side];
  fields[who + '-seat'].dataset.side = match.variant === 'green' ? 'green' : side;
  fields[who + '-seat'].dataset.active = String(!match.result && side === match.side);
  put(fields[who + '-side'], ' · ' + (match.variant === 'green' ? (side === match.firstSide ? 'Player 1' : 'Player 2') : colors[side]));
  put(fields[who + '-name'], player.name);
  put(fields[who + '-rating'], elo.format(player.rating) + ' Elo');
}

function showResult(match) {
  const won = match.result.winner === match.seat;
  const subject = won ? 'Your opponent' : 'You';
  const reasons = {timeout: ' ran out of time.', resign: ' resigned.', 'no-moves': won ? ' has no legal cut.' : ' have no legal cut.'};
  put(fields['result-title'], won ? 'You won' : 'You lost');
  put(fields['result-reason'], subject + reasons[match.result.reason]);
  if (match.rated) {
    const delta = match.result.delta[match.seat];
    const signed = delta > 0 ? '+' + delta : delta < 0 ? '−' + Math.abs(delta) : '±0';
    const rating = state.profile.ratings[match.variant];
    put(fields['result-rating'], variants[match.variant] + ' human Elo  ' + elo.format(rating) + ' (' + signed + ')');
  } else put(fields['result-rating'], 'Unrated private match');
  fields.result.dataset.won = String(won);
}

function tick() {
  if (!dialog.open) return;
  const now = Date.now() + clockOffset;
  if (state.queue) {
    const elapsed = Math.max(0, Math.floor((now - state.queue.since) / 1000));
    put(fields['queue-clock'], Math.floor(elapsed / 60) + ':' + String(elapsed % 60).padStart(2, '0'));
  }
  const match = state.match;
  if (!match) return;
  const phase = clockPhase(match);
  updateBoard(match, phase);
  if (phase === 'done') return;
  const preview = phase === 'preview';
  const duration = preview ? match.turnStartsAt - match.startedAt : match.deadline - match.turnStartsAt;
  const left = Math.max(0, (preview ? match.turnStartsAt : match.deadline) - now);
  const fraction = Math.min(1, left / Math.max(1, duration));
  const heading = {preview: 'Study the garden', own: 'Your turn', opponent: 'Opponent’s turn', elapsed: 'Checking the result…'};
  const help = {
    preview: match.firstSide === match.seat ? 'You have the first cut.' : 'Your opponent has the first cut.',
    own: match.variant === 'green' ? 'Cut any green branch.' : 'Cut a ' + match.seat + ' branch.',
    opponent: 'Your opponent is choosing a branch.', elapsed: 'Waiting for the server to confirm the clock.'
  };
  put(fields.turn, heading[phase]);
  put(fields['turn-help'], operation === 'cut' ? 'Sending your cut…' : help[phase]);
  put(fields.clock, String(Math.ceil(left / 1000)));
  fields['time-bar'].style.transform = 'scaleX(' + fraction.toFixed(3) + ')';
  fields['turn-panel'].dataset.phase = phase;
  fields['turn-panel'].dataset.low = String(!preview && left <= 3000);
}

function refresh() {
  const {match, queue, room, profile} = state;
  const locked = !!operation || connection !== 'connected' || !profile;
  const waiting = !!(queue || room);
  const networkError = connection === 'offline';
  dialog.dataset.view = match ? 'match' : 'lobby';
  put(title, match ? (match.rated ? 'Ranked match' : 'Private match') : 'Online play');
  const captions = {connected: 'Connected', connecting: 'Connecting', offline: 'Reconnecting'};
  put(fields.connection, captions[connection]);
  fields.connection.dataset.state = connection;
  fields['notice-box'].hidden = !networkError && !note;
  fields.retry.hidden = !networkError;
  fields.retry.disabled = !!pendingRead;
  put(fields.notice, networkError ? 'Live play lost its connection. Trying to reconnect…' : note);
  fields.lobby.hidden = !!match;
  fields.game.hidden = !match;
  const closeLabel = match && !match.result ? 'Hide match (the clock keeps running)' :
    queue ? 'Cancel search and close' : room ? 'Cancel room and close' : 'Close online play';
  fields.close.setAttribute('aria-label', closeLabel);
  fields.close.title = closeLabel;
  if (match) {
    showSeat('home', match, match.seat);
    showSeat('away', match, otherSide(match.seat));
    fields['turn-panel'].hidden = !!match.result;
    fields.result.hidden = !match.result;
    fields.confirm.hidden = !confirming || !!match.result;
    fields.resign.hidden = confirming || !!match.result;
    fields.resign.disabled = fields['confirm-resign'].disabled = fields.done.disabled = locked;
    if (match.result) showResult(match);
    put(fields.branches, match.live.length + (match.live.length === 1 ? ' branch' : ' branches'));
    put(fields['board-meta'], variants[match.variant] + ' · Seed ' + match.seed);
    put(fields['cut-count'], match.moves.length + (match.moves.length === 1 ? ' cut played' : ' cuts played'));
  } else {
    const inviteForm = invited && mode === 'rooms';
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
      button.disabled = waiting || !!operation;
    }
    for (const button of variantButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.variant === variant));
      button.disabled = !!operation;
    }
    put(setupTitle, mode === 'ranked' ? 'Find an opponent' : inviteForm ? 'Join a private room' : 'Play a friend');
    put(fields.intro, mode === 'ranked' ? 'Meet another player in the ranked queue. The result counts toward your human Elo.' : inviteForm ?
      'Your friend invited you to play. Joining starts the opening look for both players.' :
      'Open an unrated room for two, or enter a friend’s room code.');
    fields.setup.hidden = waiting;
    fields.queue.hidden = !queue;
    fields.room.hidden = !room;
    fields['ranked-controls'].hidden = mode !== 'ranked';
    fields['room-controls'].hidden = mode !== 'rooms';
    fields['variant-picker'].hidden = fields.create.hidden = inviteForm;
    fields['create-instead'].hidden = !inviteForm;
    fields['join-form'].classList.toggle('ol-invited', inviteForm);
    fields.join.classList.toggle('ol-primary', inviteForm);
    fields.join.classList.toggle('ol-secondary', !inviteForm);
    for (const key of ['find', 'create', 'join', 'cancel-queue', 'cancel-room', 'save-name']) fields[key].disabled = locked;
    fields.edit.disabled = locked || waiting;
    put(fields['display-name'], profile?.name || 'Guest');
    for (const id of Object.keys(variants)) put(fields['elo-' + id], profile ? elo.format(profile.ratings[id]) : '—');
    fields['edit-form'].hidden = !editing;
    fields.edit.hidden = editing;
    if (queue) put(fields['queue-info'], variants[queue.variant] + ' · The garden opens here when another player joins.');
    if (room) {
      put(fields['room-info'], variants[room.variant] + ' · Share the link or code. When your friend joins, both players see the garden.');
      put(fields['room-code'], room.code);
      fields.invite.value = roomInviteUrl(location.href, room.code);
    }
  }
  tick();
  clearInterval(clockTimer);
  if (dialog.open && (queue || (match && !match.result))) clockTimer = setInterval(tick, 125);
}

function openView(selected = 'ranked') {
  if (!state.match && !state.queue && !state.room) mode = selected === 'rooms' ? 'rooms' : 'ranked';
  if (!dialog.open) dialog.showModal();
  refresh();
  synchronize();
}

async function closeView() {
  if (operation) { pendingClose = {matchId: state.match?.id}; return; }
  if ((state.queue || state.room) && connection === 'connected') {
    const ok = state.queue ? await act('cancel', '/api/queue', 'DELETE') : await act('cancel', '/api/rooms', 'DELETE');
    if (!ok || state.match) return;
  }
  if (dialog.open) dialog.close();
}

function clearCodeError() {
  fields.code.removeAttribute('aria-invalid');
  fields['code-error'].hidden = true;
}
function codeError(message) {
  fields.code.setAttribute('aria-invalid', 'true');
  fields['code-error'].hidden = false;
  put(fields['code-error'], message);
}
function clearRoomParam() {
  const current = new URL(location.href);
  if (current.searchParams.has('room')) {
    current.searchParams.delete('room');
    history.replaceState(history.state, '', current);
  }
}

for (const opener of document.querySelectorAll('[data-open-online]')) {
  opener.addEventListener('click', event => { event.preventDefault(); openView(opener.dataset.openOnline); });
}
for (const button of modeButtons) button.addEventListener('click', () => {
  mode = button.dataset.mode; note = ''; clearCodeError();
  if (mode === 'ranked' && invited) { invited = false; clearRoomParam(); }
  refresh();
});
for (const button of variantButtons) button.addEventListener('click', () => { variant = button.dataset.variant; refresh(); });
fields.close.addEventListener('click', closeView);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeView(); });
dialog.addEventListener('close', () => {
  clearTimeout(pollTimer); clearInterval(clockTimer); editing = false; confirming = false;
});
fields.retry.addEventListener('click', synchronize);
fields.find.addEventListener('click', () => act('find', '/api/queue', 'POST', {variant}));
fields.create.addEventListener('click', () => act('create', '/api/rooms', 'POST', {variant}));
fields['cancel-room'].addEventListener('click', () => act('cancel', '/api/rooms', 'DELETE'));
fields['cancel-queue'].addEventListener('click', () => act('cancel', '/api/queue', 'DELETE'));
fields.code.addEventListener('input', clearCodeError);
fields['create-instead'].addEventListener('click', () => {
  invited = false; joiningCode = null; fields.code.value = ''; clearRoomParam(); clearCodeError(); refresh();
  fields.create.focus();
});
fields['join-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const code = normalizeRoomCode(fields.code.value);
  if (!code) { codeError('Enter the six-character code from your friend’s room.'); fields.code.focus(); return; }
  fields.code.value = code;
  clearCodeError();
  joiningCode = code;
  if (await act('join', '/api/rooms/join', 'POST', {code})) {
    fields.code.value = ''; invited = false; joiningCode = null; clearRoomParam();
  }
});
fields.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(fields.invite.value);
    put(fields['copy-note'], 'Invitation link copied.');
  } catch {
    fields.invite.focus(); fields.invite.select();
    put(fields['copy-note'], 'Copy the selected invitation link.');
  }
});
fields.edit.addEventListener('click', () => {
  editing = true; fields.name.value = state.profile.name; fields.name.setCustomValidity(''); refresh();
  fields.name.focus(); fields.name.select();
});
fields['cancel-name'].addEventListener('click', () => { editing = false; refresh(); fields.edit.focus(); });
fields.name.addEventListener('input', () => fields.name.setCustomValidity(''));
fields['edit-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const name = entrantName(fields.name.value);
  if (!name) { fields.name.setCustomValidity('Enter a display name.'); fields.name.reportValidity(); return; }
  if (await act('name', '/api/profile', 'POST', {name})) {
    editing = false; refresh(); fields.edit.focus();
  }
});
fields.zoom.addEventListener('click', () => writeZoom(!zoom));
fields.resign.addEventListener('click', () => { confirming = true; refresh(); fields['keep-playing'].focus(); });
fields['keep-playing'].addEventListener('click', () => { confirming = false; refresh(); fields.resign.focus(); });
fields['confirm-resign'].addEventListener('click', () => {
  if (state.match && !state.match.result) act('resign', '/api/matches/' + state.match.id + '/resign', 'POST', {});
});
fields.done.addEventListener('click', async () => {
  if (state.match?.result && await act('done', '/api/matches/' + state.match.id, 'DELETE')) title.focus();
});
window.addEventListener('online', synchronize);
window.addEventListener('offline', () => { connection = 'offline'; refresh(); schedule(); });
window.addEventListener('pageshow', event => { if (event.persisted) synchronize(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) synchronize(); });
window.addEventListener('storage', event => {
  if (event.key === tokenKey || event.key === null) {
    const credential = saved(tokenKey);
    if (credential === token) return;
    const previous = pendingRead;
    pendingRead = null; previous?.abort();
    token = credential; state = empty; connection = 'connecting'; refresh();
    if (dialog.open) synchronize();
  } else if (event.key === activeKey && dialog.open) synchronize();
});

// This entry runs before the offline game can rewrite a seed or turn link.
const intent = readOnlineIntent(location.href);
if (intent.hasRoom) {
  invited = true;
  fields.code.value = intent.code || '';
  if (!intent.code) codeError('This invitation needs a six-character room code.');
  openView('rooms');
} else if (intent.resumeAllowed && token && saved(activeKey)) openView();
