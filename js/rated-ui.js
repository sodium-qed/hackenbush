import { normalizeMapSeed } from './map-seed.js';
import { computerLevelLabel } from './opponents.js';
import { DEFAULT_RATED_BOT, RATED_BOTS, RATED_BOT_BY_ID } from './rated-bots.js';
import { RATED_BOARD_VERSION } from './rated-deal.js';
import { INITIAL_RATING } from './rating-model.js';

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

export function ratedOpponentLabel(level, snapshot) {
  const profile = RATED_BOT_BY_ID[level];
  const rating = Math.round(snapshot?.rating ?? profile?.elo);
  const label = profile?.name ?? computerLevelLabel(level);
  if (!Number.isFinite(rating)) return label;
  return label + ' (' + rating + (profile ? ' Elo)' : ' Groundwork)');
}

export function openingSummary({opening, seat, expected}, completed) {
  const lines = [];
  if (completed) {
    lines.push(opening.winner ? 'Perfect play favored ' + (opening.winner === seat ? 'you.' : 'the bot.') :
      'The perfect-play winner is unknown.');
  }
  if (opening.information === 'forced') {
    const outcome = opening.forcedWinner === seat ? 'a win' : 'a loss';
    lines.push('Against this bot, every sequence of your legal cuts from the opening gives you ' + outcome + '. No rating change.');
  } else {
    if (Number.isFinite(expected)) lines.push('Your estimated opening win chance was ' + winPercent(expected) + '.');
    if (opening.information === 'unresolved') {
      lines.push(opening.certificate === 'assessment-stopped'
        ? 'Play began before rating eligibility was settled. This match carries no rating change.'
        : 'The search could not establish whether both results were possible against this bot. No rating change.');
    } else if (completed) {
      lines.push('Both a win and a loss were possible against this bot.');
    }
  }
  return lines.join(' ');
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

export function createRatedDesk(dialog, {read, onStart, onForfeit, onReset, onReplay, onPractice, readIndefinite, saveIndefinite}) {
  dialog.innerHTML = `
    <header class="rated-desk__header">
      <div><h2 id="rated-title">Rated play</h2><p>Bot matches · 10 seconds per cut · Saved on this device</p></div>
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
        <p data-rated="deal-info"></p>
        <div class="rated-deal__controls">
          <label>Bot opponent<select data-rated="level" aria-describedby="rated-bot-description"></select></label>
          <button type="button" class="primary" data-rated="start">Draw rated match</button>
        </div>
        <p class="rated-bot-description" id="rated-bot-description"><span data-rated="bot"></span> <a data-rated="bot-source" target="_blank" rel="noopener">Chess.com profile</a></p>
        <div class="rated-assessment-setting" data-rated="assessment-setting">
          <label><input type="checkbox" data-rated="indefinite" aria-describedby="assessment-help">Keep assessing indefinitely</label>
          <p id="assessment-help" data-rated="assessment-help"></p>
        </div>
        <div class="rated-assessment" data-rated="assessment" hidden>
          <p data-rated="assessment-status" role="status"></p>
          <p data-rated="assessment-count"></p>
          <button type="button" class="secondary" data-rated="finish-assessment">Play now</button>
        </div>
        <details class="rated-seed" data-rated="practice-seed">
          <summary>Practice a seed</summary>
          <form class="rated-deal__controls" data-rated="practice-form" novalidate>
            <label for="rated-seed">Map seed<input id="rated-seed" data-rated="seed" type="text" placeholder="A35D7E" required autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="rated-seed-help"></label>
            <button type="submit" class="secondary" data-rated="practice-start">Play unrated</button>
          </form>
          <p id="rated-seed-help">Enter a six-digit hex seed to play this garden against the selected bot without a clock.</p>
        </details>
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
        <p>Your Green and Red–Blue ratings each start at ${INITIAL_RATING}. The named bots use their published Chess.com Elo as an initial estimate of their Hackenbush strength. Each plays its own Hackenbush strategy.</p>
        <p>Your rating can change when both a win and a loss are possible against the assigned bot. The opening assessment checks this before the clock starts. If every line has the same outcome, the rating change is zero. RD measures uncertainty about your rating. The chart shades one RD on either side of your estimate.</p>
      </details>
      <button class="rated-text-button rated-reset" data-rated="reset" type="button">Reset rated history</button>
    </div>`;
  const field = name => dialog.querySelector('[data-rated="' + name + '"]');
  const switches = [...dialog.querySelectorAll('[data-pool]')];
  const levels = field('level');
  for (const profile of RATED_BOTS) {
    levels.add(new Option(ratedOpponentLabel(profile.id), profile.id));
  }
  let selection = DEFAULT_RATED_BOT;
  let variant = 'redblue';
  let busy = false;
  let confirmation = null;
  let assessment = null;
  const indefinite = field('indefinite');
  indefinite.checked = readIndefinite();
  const assessmentHelp = () => {
    field('assessment-help').textContent = indefinite.checked
      ? 'Refine the Elo forecast until you choose Play now. The clock waits.'
      : 'The match starts automatically once its rating check is settled.';
  };
  assessmentHelp();
  indefinite.addEventListener('change', () => {
    saveIndefinite(indefinite.checked);
    assessmentHelp();
  });

  function displayProgress(progress) {
    const status = field('assessment-status');
    let message = 'Checking whether this match can affect Elo…';
    if (progress.information === 'forced') message = 'Forced outcome proved. This match carries no rating change.';
    else if (progress.complete) message = 'Assessment complete. The clock starts when play begins.';
    else if (progress.ready) message = 'Rating eligibility settled. Refining the Elo forecast…';
    else if (progress.information === 'skill') message = 'Both results are possible. Checking the opening cuts…';
    if (status.textContent !== message) status.textContent = message;
    const counts = [progress.positions.toLocaleString() + ' positions checked',
      progress.screened + ' / ' + progress.legalMoves + ' opening cuts screened'];
    if (progress.information === 'unresolved') {
      counts.push(progress.outcomes + ' / 2 outcomes witnessed', 'Starting now leaves Elo unchanged.');
    } else if (progress.information === 'skill') counts.push('Opening difficulty ' + difficultyRange(progress));
    field('assessment-count').textContent = counts.join(' · ');
  }

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
    if (active) {
      const cuts = active.game.moves.length;
      field('deal-info').textContent = [variantNames[active.variant], active.family, 'Seed ' + active.seed,
        cuts + (cuts === 1 ? ' cut played' : ' cuts played'), active.timed ? 'Clock running' : 'Clock starts on return'].filter(Boolean).join(' · ');
    } else {
      field('deal-info').textContent = 'Study the opening for two seconds, then make each cut within ten. The clock keeps running if you leave the board.';
    }
    // A saved classic match keeps its original opponent until it is finished.
    levels.querySelector('[data-legacy]')?.remove();
    if (active && !RATED_BOT_BY_ID[active.level]) {
      const legacy = new Option(ratedOpponentLabel(active.level, active.bot), active.level);
      legacy.dataset.legacy = '';
      levels.add(legacy);
    }
    levels.value = active?.level ?? selection;
    levels.disabled = busy || !!active;
    const profile = RATED_BOT_BY_ID[levels.value];
    field('bot').textContent = profile ? profile.style : 'This saved match uses the original Groundwork opponent.';
    const source = field('bot-source');
    source.hidden = !profile;
    if (profile) source.href = profile.source;
    else source.removeAttribute('href');
    field('practice-seed').hidden = !profile;
    field('seed').disabled = busy;
    field('practice-start').disabled = busy;
    field('start').disabled = busy || state.status !== 'ok';
    field('start').textContent = assessment ? 'Assessing…' : busy ? 'Working…' : active ? 'Resume rated match' : 'Draw rated match';
    field('assessment-setting').hidden = !!active;
    indefinite.disabled = busy;
    field('assessment').hidden = !assessment;
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
      const outcome = row.reason === 'forfeit' ? 'Resigned' : (row.won ? 'Win' : 'Loss') + (row.reason === 'timeout' ? ' on time' : '');
      const detail = make('details');
      const summary = make('summary');
      summary.append(make('strong', '', outcome + ' · ' + ratedOpponentLabel(row.level, row.bot)),
        make('small', '', [dateFormat.format(new Date(row.endedAt)), row.family, 'Seed ' + row.seed,
          row.rated ? '' : 'no rating change'].filter(Boolean).join(' · ')));
      detail.append(summary,
        make('p', '', 'Rating ' + Math.round(row.before) + ' → ' + Math.round(row.after) +
          ' · RD ' + Math.round(row.rdBefore) + ' → ' + Math.round(row.rdAfter) + '.'),
        make('p', '', openingSummary(row, true)),
        make('p', '', 'Opening structural difficulty · ' + difficultyRange(row.opening) + '.'));
      const change = make('span', 'rated-history__delta', signedRating(row.delta));
      change.title = Math.round(row.before) + ' to ' + Math.round(row.after);
      const actions = make('div', 'rated-history__actions');
      const practice = make('button', 'rated-review', 'Practice');
      practice.type = 'button';
      practice.disabled = busy;
      practice.dataset.ratedPractice = row.seed;
      practice.setAttribute('aria-label', 'Practice ' + variantNames[variant] + ' seed ' + row.seed);
      practice.addEventListener('click', () => onPractice(row));
      actions.append(practice);
      if (row.game && row.reason !== 'forfeit') {
        const replay = make('button', 'rated-review', 'Analyze');
        replay.type = 'button';
        replay.disabled = busy;
        replay.setAttribute('aria-label', 'Analyze ' + variantNames[variant] + ' match ' + row.seed);
        replay.addEventListener('click', () => onReplay(row));
        actions.append(replay);
      }
      item.append(detail, change, actions);
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
  levels.addEventListener('change', () => {
    selection = levels.value;
    refresh();
  });
  const seedInput = field('seed');
  seedInput.addEventListener('input', () => seedInput.setCustomValidity(''));
  field('practice-form').addEventListener('submit', event => {
    event.preventDefault();
    if (busy || !RATED_BOT_BY_ID[levels.value]) return;
    const seed = normalizeMapSeed(seedInput.value);
    if (!seed) {
      seedInput.setCustomValidity('Use six hexadecimal digits, 0–9 or A–F.');
      seedInput.reportValidity();
      return;
    }
    seedInput.value = seed;
    onPractice({seed, variant, boardVersion: RATED_BOARD_VERSION, level: levels.value});
  });
  field('start').addEventListener('click', () => {
    dismiss();
    if (read().active) { run(() => onStart(variant, levels.value), 'Opening match…'); return; }
    assessment = new AbortController();
    field('finish-assessment').disabled = false;
    field('assessment-status').textContent = 'Preparing the opening assessment…';
    field('assessment-count').textContent = '';
    run(async () => {
      try {
        await onStart(variant, levels.value, { indefinite: indefinite.checked,
          finishSignal: assessment.signal, onProgress: displayProgress });
      } finally { assessment = null; }
    }, '');
  });
  field('finish-assessment').addEventListener('click', () => {
    field('finish-assessment').disabled = true;
    assessment?.abort();
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
      if (!busy) { indefinite.checked = readIndefinite(); assessmentHelp(); }
      variant = read().active?.variant ?? (Object.hasOwn(variantNames, selected) ? selected : variant);
      field('notice').textContent = '';
      refresh();
      if (!dialog.open) dialog.showModal();
    },
    refresh() { if (dialog.open) refresh(); }
  };
}
