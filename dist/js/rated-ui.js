import { computerLevelLabel } from './opponents.js';
import { ratedBotSummary } from './rating.js';

const variantNames = {green: 'Green', redblue: 'Red–Blue'};
const statusMessages = {
  unavailable: 'Browser storage is unavailable. Allow local storage to save a rated match.',
  invalid: 'The saved ratings could not be read. Reset rated history to start a new record.',
  newer: 'These ratings use a newer format. Open the latest version of Groundwork to continue.'
};
const dateFormat = new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'});
const svgNS = 'http://www.w3.org/2000/svg';

export function signedRating(value) {
  const rounded = Math.round(value);
  return rounded > 0 ? '+' + rounded : rounded < 0 ? '−' + Math.abs(rounded) : '0';
}

export function winPercent(probability) {
  if (!(probability >= 0 && probability <= 1) || probability === null) return 'Undetermined';
  if (probability > 0 && probability < 0.01) return '<1%';
  if (probability > 0.99 && probability < 1) return '>99%';
  return Math.round(probability * 100) + '%';
}

export function difficultyRange(opening) {
  if (!opening || !Number.isFinite(opening.lower) || !Number.isFinite(opening.upper)) return 'Unassessed';
  const low = Math.floor(opening.lower);
  const high = Math.ceil(opening.upper);
  return (low === high ? String(low) : low + '–' + high) + ' / 100';
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attrs, content) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (content !== undefined) el.textContent = content;
  return el;
}

function renderChart(host, records, games) {
  if (!records.length) {
    host.replaceChildren(make('p', 'rated-chart__empty', 'Your first result will start this chart.'));
    return;
  }
  const entries = records.slice(0, 40).reverse();
  const points = [{rating: entries[0].before, rd: entries[0].rdBefore},
    ...entries.map(record => ({rating: record.after, rd: record.rdAfter}))];
  const low = Math.floor(Math.min(...points.map(p => p.rating - p.rd)) / 50) * 50;
  const high = Math.max(low + 100, Math.ceil(Math.max(...points.map(p => p.rating + p.rd)) / 50) * 50);
  const x = i => 42 + i * 372 / (points.length - 1);
  const y = value => 115 - 103 * (value - low) / (high - low);
  const coords = (i, value) => x(i).toFixed(2) + ',' + y(value).toFixed(2);
  const svg = svgNode('svg', {viewBox: '0 0 430 142', role: 'img', 'aria-label':
    'Rating and one rating deviation over the last ' + entries.length + ' matches. From ' +
    Math.round(points[0].rating) + ' to ' + Math.round(points.at(-1).rating) + '.'});
  const upper = points.map((p, i) => coords(i, p.rating + p.rd));
  const lower = points.map((p, i) => coords(i, p.rating - p.rd)).reverse();
  svg.append(svgNode('polygon', {class: 'rated-chart__band', points: [...upper, ...lower].join(' ')}));
  for (const grid of [low, (low + high) / 2, high]) {
    svg.append(svgNode('line', {x1: 40, x2: 415, y1: y(grid), y2: y(grid), class: 'rated-chart__grid'}),
      svgNode('text', {x: 33, y: y(grid) + 4, 'text-anchor': 'end'}, String(grid)));
  }
  svg.append(svgNode('polyline', {points: points.map((p, i) => coords(i, p.rating)).join(' '), class: 'rated-chart__line'}));
  points.forEach((p, i) => {
    const dot = svgNode('circle', {cx: x(i), cy: y(p.rating), r: i === points.length - 1 ? 4 : 2.5, class: 'rated-chart__dot'});
    dot.append(svgNode('title', {}, 'After ' + (games - entries.length + i) + ' matches: ' + Math.round(p.rating) + ' ± ' + Math.round(p.rd)));
    svg.append(dot);
  });
  svg.append(svgNode('text', {x: 42, y: 137}, 'Match ' + (games - entries.length)),
    svgNode('text', {x: 414, y: 137, 'text-anchor': 'end'}, 'Match ' + games));
  host.replaceChildren(svg);
}

export function createRatedDesk(dialog, {read, onStart, onForfeit, onReset, onReplay}) {
  dialog.innerHTML = `
    <header class="rated-desk__header">
      <div><h2 id="rated-title">Rated play</h2><p>Untimed bot matches · Saved on this device</p></div>
      <button class="icon-button" type="button" data-rated="close" aria-label="Close rated play"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button>
    </header>
    <div class="rated-desk__body">
      <div class="rated-switch" role="group" aria-label="Rating pool">
        <button type="button" data-pool="redblue" aria-pressed="true">Red–Blue</button>
        <button type="button" data-pool="green" aria-pressed="false">Green</button>
      </div>
      <section class="rated-summary" aria-label="Player statistics">
        <div><h3>Your rating</h3><strong data-rated="rating"></strong><span data-rated="provisional"></span></div>
        <dl><div><dt>Uncertainty (RD)</dt><dd data-rated="rd"></dd></div><div><dt>Wins / losses</dt><dd data-rated="results"></dd></div></dl>
      </section>
      <section class="rated-deal" aria-labelledby="rated-next">
        <h3 id="rated-next">Play a match</h3>
        <p data-rated="deal-info">Your garden, seat and opening player are drawn when you start.</p>
        <div class="rated-deal__controls">
          <label>Bot opponent<select data-rated="level"><option value="easy">Easy</option><option value="standard" selected>Standard</option><option value="expert">Expert</option></select></label>
          <button type="button" class="primary" data-rated="start">Draw rated match</button>
        </div>
        <p class="rated-calibration" data-rated="bot"></p>
        <button class="rated-text-button" type="button" data-rated="forfeit" hidden>Resign this match</button>
      </section>
      <p class="rated-notice" data-rated="notice" role="status" aria-live="polite"></p>
      <div class="rated-confirm" data-rated="confirm" hidden>
        <p data-rated="confirm-text"></p>
        <button class="secondary" type="button" data-rated="cancel">Cancel</button>
        <button class="primary" type="button" data-rated="accept">Confirm</button>
      </div>
      <section class="rated-chart" aria-labelledby="rated-chart-title">
        <div class="rated-section-head"><h3 id="rated-chart-title">Rating progression</h3><span data-rated="chart-legend" hidden>Band ±1 RD</span></div>
        <div data-rated="graph"></div>
      </section>
      <section class="rated-recent" aria-labelledby="rated-recent-title">
        <div class="rated-section-head"><h3 id="rated-recent-title">Recent matches</h3><span data-rated="count"></span></div>
        <div data-rated="history"></div>
      </section>
      <details class="rated-help"><summary>How ratings work</summary>
        <p>Each ruleset starts at the same reference rating. A prediction uses your rating, the calibrated opponent, the opening advantage and the structural difficulty of the deal. An unexpected result usually moves your rating farther.</p>
        <p>RD measures uncertainty about your rating. The shaded band spans one RD on either side of your estimate. Standard anchors each bot ladder at 1000. An opening where the result is forced against the assigned bot contributes zero rating evidence. An unresolved eligibility check also gives zero change. Only completed rated games and resignations enter this history.</p>
      </details>
      <button class="rated-text-button rated-reset" data-rated="reset" type="button">Reset rated history</button>
    </div>`;
  const field = name => dialog.querySelector('[data-rated="' + name + '"]');
  const switches = [...dialog.querySelectorAll('[data-pool]')];
  let variant = 'redblue';
  let busy = false;
  let confirmation = null;

  function refresh() {
    const state = read();
    const pool = state.status === 'ok' ? state.pools[variant] : null;
    const active = state.active;
    for (const btn of switches) {
      btn.setAttribute('aria-pressed', String(btn.dataset.pool === variant));
      btn.disabled = busy;
    }
    field('rating').textContent = pool ? Math.round(pool.rating) : '—';
    field('rd').textContent = pool ? '±' + Math.round(pool.rd) : '—';
    field('results').textContent = pool ? pool.wins + ' / ' + pool.losses : '—';
    field('provisional').textContent = pool?.provisional ? 'Provisional' : '';
    field('deal-info').textContent = active ? 'Your ' + variantNames[active.variant] + ' match against ' +
      computerLevelLabel(active.level) + ' is saved at cut ' + active.game.moves.length + '.' :
      'Your garden, seat and opening player are drawn when you start.';
    const bot = active?.bot ?? ratedBotSummary(variant, field('level').value);
    if (active) field('level').value = active.level;
    field('level').disabled = busy || !!active;
    field('start').disabled = busy || state.status !== 'ok';
    field('start').textContent = busy ? 'Working…' : active ? 'Resume rated match' : 'Draw rated match';
    field('bot').textContent = bot ? computerLevelLabel(bot.level) + ' · overall benchmark ' + Math.round(bot.rating) +
      (bot.level === 'standard' ? ' · reference bot' : ' · calibration SD ' + Math.round(bot.sd)) +
      (bot.provisional ? ' · provisional' : '') : '';
    field('forfeit').hidden = !active;
    field('forfeit').disabled = busy;
    field('reset').disabled = busy || state.status === 'newer' || state.status === 'unavailable';
    if (statusMessages[state.status]) field('notice').textContent = statusMessages[state.status];
    const records = (state.history || []).filter(row => row.variant === variant);
    field('count').textContent = pool ? pool.games + ' played' : '';
    field('chart-legend').hidden = !records.length;
    renderChart(field('graph'), records, pool?.games ?? 0);
    const history = field('history');
    history.replaceChildren();
    if (!records.length) {
      history.append(make('p', 'rated-empty', 'No completed ' + variantNames[variant] + ' matches yet.'));
      return;
    }
    const list = make('ol', 'rated-history');
    for (const row of records.slice(0, 12)) {
      const item = make('li', 'rated-history__row');
      const outcome = row.reason === 'forfeit' ? 'Resigned' : row.won ? 'Win' : 'Loss';
      const detail = make('details');
      const summary = make('summary');
      summary.append(make('strong', '', outcome + ' · ' + computerLevelLabel(row.level)),
        make('small', '', dateFormat.format(new Date(row.endedAt)) + ' · ' + row.seed + (row.rated ? '' : ' · no rating evidence')));
      const evidence = row.opening.information === 'forced' ? 'The outcome was forced against this bot.'
        : row.opening.information === 'unresolved' ? 'The search did not certify both outcomes against this bot.'
        : 'Both a win and a loss were possible against this bot.';
      detail.append(summary,
        make('p', '', 'Rating ' + Math.round(row.before) + ' → ' + Math.round(row.after) +
          ' · RD ' + Math.round(row.rdBefore) + ' → ' + Math.round(row.rdAfter) + '.'),
        make('p', '', 'Perfect play favored ' + (row.opening.winner === row.seat ? 'you' : 'the bot') +
          '. Your opening win estimate was ' + winPercent(row.expected) + '. ' + evidence),
        make('p', '', 'Bot benchmark ' + Math.round(row.bot.rating) + ' · Opening structural difficulty ' + difficultyRange(row.opening) + '.'));
      const change = make('span', 'rated-history__delta', signedRating(row.delta));
      change.title = Math.round(row.before) + ' to ' + Math.round(row.after);
      item.append(detail, change);
      if (row.game && row.reason !== 'forfeit') {
        const replay = make('button', 'rated-review', 'Analyze');
        replay.type = 'button';
        replay.setAttribute('aria-label', 'Analyze ' + variantNames[variant] + ' match ' + row.seed);
        replay.addEventListener('click', () => onReplay(row));
        item.append(replay);
      }
      list.append(item);
    }
    history.append(list);
  }

  function ask(action) {
    const state = read();
    confirmation = {action, id: state.active?.id};
    const reset = action === 'reset';
    field('confirm-text').textContent = reset ?
      'Delete both rating histories and any unfinished rated match on this device?' :
      'Resign this rated match? It will be recorded as a loss.';
    field('accept').textContent = reset ? 'Delete ratings' : 'Resign match';
    field('confirm').hidden = false;
    field('cancel').focus();
  }

  function dismiss() {
    confirmation = null;
    field('confirm').hidden = true;
  }

  async function run(action, message) {
    if (busy) return;
    busy = true;
    field('notice').textContent = message;
    refresh();
    try {
      const note = await action();
      field('notice').textContent = note || '';
    } catch (error) {
      field('notice').textContent = error.message || 'The rated action could not be saved.';
    } finally {
      busy = false;
      refresh();
    }
  }

  for (const btn of switches) btn.addEventListener('click', () => {
    variant = btn.dataset.pool;
    dismiss();
    refresh();
  });
  field('level').addEventListener('change', refresh);
  field('start').addEventListener('click', () => {
    dismiss();
    run(() => onStart(variant, field('level').value), 'Preparing your match…');
  });
  field('forfeit').addEventListener('click', () => ask('forfeit'));
  field('reset').addEventListener('click', () => ask('reset'));
  field('accept').addEventListener('click', () => {
    if (!confirmation) return;
    const {action, id} = confirmation;
    dismiss();
    run(action === 'reset' ? onReset : () => onForfeit(id), 'Saving…');
  });
  field('cancel').addEventListener('click', () => {
    const button = confirmation?.action === 'reset' ? 'reset' : 'forfeit';
    dismiss();
    field(button).focus();
  });
  field('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', dismiss);
  return {
    open(selected) {
      variant = read().active?.variant ?? (Object.hasOwn(variantNames, selected) ? selected : variant);
      field('notice').textContent = '';
      refresh();
      if (!dialog.open) dialog.showModal();
    },
    refresh() { if (dialog.open) refresh(); }
  };
}
