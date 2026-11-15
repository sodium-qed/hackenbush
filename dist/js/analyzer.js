import { createBoard } from './board.js';
import { dailyOpening } from './daily.js';
import { renderLandscape } from './landscape.js';
import { isDailySeed, TEXT_BOARD_VERSION } from './map-seed.js';
import { cutEdge, initialEdges, otherSide } from './rules.js';
import { analyzePosition, dyadicChange } from './analysis-values.js?v=8';

const variants = { green: 'Green', redblue: 'Red–Blue', mixed: 'Mixed' };
const sideNames = { blue: 'Blue', red: 'Red' };
let nextId = 0;

// Replaying the same cut rule preserves the ground, multiple-root attachments,
// and every fallen branch, including matches restored from earlier versions.
export function replayPositions(game) {
  if (!game?.victor) return [];
  const edges = new Map(game.board.edges.map((edge, index) => [edge.id, { edge, branch: index + 1 }]));
  const history = game.moves?.length ? game.moves : (game.rows || []).map(row => row.edgeId);
  const frames = [{ side: game.firstSide, live: initialEdges(game.board), move: null }];
  for (const edgeId of history) {
    const before = frames.at(-1);
    const change = cutEdge(game.board, before.live, edgeId, before.side);
    if (!change) throw new Error('The recorded cut is unavailable in this position.');
    const { edge, branch } = edges.get(edgeId);
    frames.push({ live: change.live, side: otherSide(before.side),
      move: { side: before.side, edgeId, branch, color: edge.color, part: edge.part, fallen: change.fallen } });
  }
  return frames;
}

// Outward rounding preserves the certified interval even when its exact
// dyadic endpoints have dozens of digits. Full endpoints remain available.
function outward(value, lower) {
  const [n, d = 1n] = value.split('/').map(BigInt);
  const scaled = n * 100n;
  let cents = scaled / d;
  if (scaled % d && (lower ? n < 0n : n > 0n)) cents += lower ? -1n : 1n;
  const absolute = cents < 0n ? -cents : cents;
  const digits = String(absolute % 100n).padStart(2, '0').replace(/0+$/, '');
  return (cents < 0n ? '-' : '') + absolute / 100n + (digits ? '.' + digits : '');
}

function longBounds(result) {
  return result.lower !== undefined && result.lower.length + result.upper.length > 16;
}

function scoreOf(result, concise = false) {
  if (result.kind === 'green') return '*' + result.nimber;
  if (result.exact) {
    if (!result.nimber) return result.number;
    return (result.number === '0' ? '' : result.number + ' + ') + '*' + result.nimber;
  }
  if (result.lower !== undefined) {
    const round = concise && longBounds(result);
    const lower = round ? outward(result.lower, true) : result.lower;
    const upper = round ? outward(result.upper, false) : result.upper;
    return lower + (result.lowerOpen ? ' < ' : ' ≤ ') + 'v' + (result.upperOpen ? ' < ' : ' ≤ ') + upper;
  }
  return 'Unresolved';
}

function readoutLabel(result) {
  if (result.kind === 'green') return 'Green nimber';
  if (result.kind === 'mixed') return result.lower !== undefined ? 'Bounds on the numeric part' : 'Mixed game value';
  return result.exact ? 'Red–Blue value' : 'Proven Red–Blue bounds';
}

function explanation(result) {
  if (result.kind === 'green') return result.nimber
    ? 'A nonzero nimber gives the player to move a winning cut.'
    : 'At zero, the player to move loses under perfect play.';
  if (!result.exact) {
    if (result.lower !== undefined) {
      const addend = result.nimber ? ' A separate green nimber of *' + result.nimber + ' is added.' : '';
      return 'The exact number is unresolved.' + (longBounds(result) ? ' The displayed bounds are rounded outward.' : '') + addend;
    }
    return 'Some green and colored branches support one another. Their combined game value is unresolved.';
  }
  if (result.number === '0') {
    if (result.nimber) return 'The colored branches cancel. The green nimber favors the player to move.';
    return 'At zero, the player to move loses under perfect play.';
  }
  return result.number.startsWith('-') ? 'Negative values favor Red, whichever side moves first.'
    : 'Positive values favor Blue, whichever side moves first.';
}

function branches(count) { return count + (count === 1 ? ' branch' : ' branches'); }

function player(game, side) {
  const name = game.players?.[side]?.name || sideNames[side];
  if (game.variant !== 'green') return name === sideNames[side] ? name : name + ' (' + sideNames[side] + ')';
  const duplicate = name === game.players?.[otherSide(side)]?.name;
  return duplicate ? name + ' (Player ' + (side === game.firstSide ? '1' : '2') + ')' : name;
}

function icon(name) {
  return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}

export function createAnalyzer(dialog) {
  const id = 'hb-analysis-' + ++nextId;
  dialog.classList.add('hb-analyzer');
  dialog.setAttribute('aria-labelledby', id + '-title');
  dialog.innerHTML = `
    <div class="hb-analyzer__sheet">
      <header class="hb-analyzer__header">
        <div>
          <p class="hb-analyzer__map" data-analysis="map"></p>
          <h2 id="${id}-title" tabindex="-1" data-analysis="title">Value Analyzer</h2>
        </div>
        <button class="hb-analyzer__close" type="button" aria-label="Close Value Analyzer" data-analysis="close">${icon('close')}</button>
      </header>
      <p class="hb-analyzer__result">${icon('trophy')}<span data-analysis="result"></span></p>
      <div class="hb-analyzer__layout">
        <section class="hb-analyzer__replay" aria-labelledby="${id}-position">
          <div class="hb-analyzer__position">
            <h3 id="${id}-position" data-analysis="position"></h3>
            <span data-analysis="count"></span>
          </div>
          <div class="hb-analyzer__diagram" role="img" data-analysis="diagram"><div data-analysis="drawing" aria-hidden="true" inert></div></div>
          <div class="hb-analyzer__transport">
            <button type="button" data-analysis="previous" aria-label="Previous position">${icon('arrow')}<span>Previous</span></button>
            <label class="hb-analyzer__slider"><span class="sr-only">Replay position</span>
              <input type="range" min="0" step="1" data-analysis="slider" aria-describedby="${id}-step">
            </label>
            <button type="button" data-analysis="next" aria-label="Next position"><span>Next</span>${icon('arrow')}</button>
          </div>
          <p class="hb-analyzer__step" id="${id}-step" data-analysis="step"></p>
        </section>
        <section class="hb-analyzer__reading" aria-label="Position analysis">
          <h3 class="hb-analyzer__label" data-analysis="value-label">Position value</h3>
          <p class="hb-analyzer__value" data-analysis="value"></p>
          <p class="hb-analyzer__explain" data-analysis="explain"></p>
          <details class="hb-analyzer__exact" data-analysis="details" hidden>
            <summary>Exact bounds</summary><p data-analysis="endpoints"></p>
          </details>
          <dl class="hb-analyzer__facts">
            <div><dt>To move</dt><dd data-analysis="turn"></dd></div>
            <div><dt>Untimed winner with perfect play</dt><dd data-analysis="winner"></dd></div>
            <div data-analysis="change-row"><dt>Change on this cut</dt><dd class="hb-analyzer__change" data-analysis="change"></dd></div>
          </dl>
        </section>
      </div>
      <p class="sr-only" role="status" aria-atomic="true" data-analysis="status"></p>
    </div>`;

  const view = {};
  for (const el of dialog.querySelectorAll('[data-analysis]')) view[el.dataset.analysis] = el;
  const slider = view.slider;
  let game = null, frames = [], topology = null, renderer = null;
  let index = 0, worker = null, timer = null, generation = 0;
  const cache = new Map();
  let edgeColors = new Map();

  function stopWork() {
    generation++;
    worker?.terminate();
    worker = null;
    clearTimeout(timer);
    timer = null;
  }

  function release() {
    stopWork();
    renderer?.destroy();
    renderer = null;
    game = null;
    frames = [];
    topology = null;
    cache.clear();
    edgeColors.clear();
  }

  function moveLabel() {
    if (!index) return 'Opening position';
    return index === frames.length - 1 ? 'Final position' : 'After move ' + index;
  }

  function describeMove() {
    const move = frames[index].move;
    if (!move) return frames.length === 1 ? 'No cuts were played.' : 'Before move 1 of ' + (frames.length - 1) + '.';
    const label = move.part || 'branch';
    const fallen = move.fallen.length;
    const fall = fallen ? ' ' + branches(fallen) + ' fell with it.' : '';
    return 'Move ' + index + ' of ' + (frames.length - 1) + ' · ' + player(game, move.side) +
      ' cut the ' + move.color + ' ' + label + ' #' + move.branch + '.' + fall;
  }

  function showAnalysis() {
    const current = cache.get(index);
    const previous = cache.get(index - 1);
    const frame = frames[index];
    view['change-row'].hidden = !index;
    if (current) {
      view['value-label'].textContent = readoutLabel(current);
      view.value.textContent = scoreOf(current, true);
      view.value.dataset.compact = String(!current.exact || view.value.textContent.length > 9);
      view.explain.textContent = explanation(current);
      view.details.hidden = !longBounds(current);
      if (!view.details.hidden) view.endpoints.textContent = scoreOf(current);
      view.winner.textContent = current.winner ? player(game, current.winner) : 'Unresolved';
      view.winner.dataset.side = game.variant === 'green' ? '' : current.winner || '';
      view.status.textContent = moveLabel() + '. ' + readoutLabel(current) + ' ' + scoreOf(current, true) + '. ' +
        (current.winner ? player(game, current.winner) + ' can force a win.' : 'Untimed winner unresolved.');
    } else {
      view['value-label'].textContent = 'Position value';
      view.value.textContent = 'Calculating…';
      view.value.dataset.compact = 'true';
      view.explain.textContent = '';
      view.details.hidden = true;
      view.winner.textContent = 'Calculating…';
      view.winner.dataset.side = '';
      view.status.textContent = moveLabel() + '. Calculating position value.';
    }
    if (index) {
      if (!current || !previous) view.change.textContent = 'Comparing positions…';
      else {
        let description = scoreOf(previous, true) + ' → ' + scoreOf(current, true);
        if (previous.kind === 'redblue' && current.kind === 'redblue' && previous.exact && current.exact) {
          description += ' (Δ ' + dyadicChange(previous.number, current.number) + ')';
        } else if (previous.kind === 'mixed' && !previous.exact && current.kind === 'mixed' && !current.exact &&
                   previous.lower === undefined && current.lower === undefined) {
          description = 'Values unresolved on both sides of this cut.';
        }
        view.change.textContent = description;
      }
    }
    view.turn.textContent = player(game, frame.side);
  }

  function startWork() {
    const token = generation;
    const positions = [index, index - 1].filter(i => i >= 0 && !cache.has(i))
      .map(i => ({ index: i, live: frames[i].live, side: frames[i].side }));
    if (!positions.length) return;

    function active() { return token === generation && game && dialog.open; }
    function received(i, result) {
      if (!active()) return;
      if (i === 0 && !result.winner && game.boardVersion === TEXT_BOARD_VERSION && isDailySeed(game.seed)) {
        const opening = dailyOpening(game.seed);
        if (opening.variant === game.variant && opening.firstSide === game.firstSide) result = { ...result, winner: opening.humanSide };
      }
      cache.set(i, result);
      showAnalysis();
    }
    function fallback() {
      worker?.terminate();
      worker = null;
      // Browsers that disallow module workers can still price trees and Green
      // boards and show certified intervals without a long main-thread search.
      const queue = positions.filter(p => !cache.has(p.index));
      function next() {
        if (!active() || !queue.length) return;
        const p = queue.shift();
        received(p.index, analyzePosition(topology, p.live, p.side, game.variant, { budgetMs: 8 }));
        if (queue.length) timer = setTimeout(next, 0);
      }
      timer = setTimeout(next, 0);
    }

    if (typeof Worker !== 'function') { fallback(); return; }
    try {
      worker = new Worker(new URL('./analysis-worker.js?v=8', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (!active()) return;
        received(data.index, data.result);
        if (positions.every(p => cache.has(p.index))) {
          worker.terminate();
          worker = null;
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        if (active()) fallback();
      };
      worker.postMessage({ board: topology, variant: game.variant, positions });
    } catch { fallback(); }
  }

  function select(next) {
    if (!game || next < 0 || next >= frames.length) return;
    stopWork();
    index = next;
    const frame = frames[index];
    const last = frames.length - 1;
    view.details.open = false;
    view.position.textContent = moveLabel();
    view.count.textContent = branches(frame.live.length);
    view.step.textContent = describeMove();
    view.previous.disabled = index === 0;
    view.next.disabled = index === last;
    slider.disabled = !last;
    slider.max = String(last);
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', moveLabel() + ', ' + index + ' of ' + last + ' cuts');
    const counts = { green: 0, blue: 0, red: 0 };
    for (const edgeId of frame.live) counts[edgeColors.get(edgeId)]++;
    const colors = Object.entries(counts).filter(([, n]) => n).map(([color, n]) => n + ' ' + color);
    const contents = colors.length ? colors.join(', ') + (frame.live.length === 1 ? ' branch.' : ' branches.') : 'No branches remain.';
    view.diagram.setAttribute('aria-label', moveLabel() + '. ' + contents);
    renderer.update({ board: game.board, live: frame.live, side: frame.side, locked: true, reset: true });
    showAnalysis();
    timer = setTimeout(startWork, 0);
  }

  function open(match) {
    if (!match?.victor) {
      if (dialog.open) close();
      return false;
    }
    release();
    game = match;
    frames = replayPositions(match);
    edgeColors = new Map(match.board.edges.map(edge => [edge.id, edge.color]));
    topology = {
      nodes: match.board.nodes.map(({ id, ground }) => ({ id, ground })),
      edges: match.board.edges.map(({ id, a, b, color }) => ({ id, a, b, color }))
    };
    const mapName = [variants[match.variant] || 'Hackenbush', match.board.family, match.board.mapSeed].filter(Boolean);
    view.map.textContent = mapName.join(' · ');
    view.result.textContent = player(match, match.victor) + ' won ' + (match.timedOut
      ? 'on time. ' + player(match, match.timedOut) + ' ran out of time.'
      : 'the match. ' + player(match, match.side) + ' had no legal cut.');
    if (!dialog.open) dialog.showModal();
    renderer = createBoard(view.drawing);
    renderLandscape(renderer.landscape, match.board.world, match.board.mapSeed || 'A35D7E');
    select(0);
    view.title.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return true;
  }

  function close() {
    if (dialog.open) dialog.close();
    release();
  }

  view.close.addEventListener('click', close);
  view.previous.addEventListener('click', () => select(index - 1));
  view.next.addEventListener('click', () => select(index + 1));
  slider.addEventListener('input', () => select(Number(slider.value)));
  dialog.addEventListener('keydown', event => {
    if (event.target === slider || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      select(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  dialog.addEventListener('close', () => { if (!dialog.open) release(); });
  return { open, close };
}
