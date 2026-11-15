import { createBoard } from './board.js';
import { cachedDailyWinner } from './daily.js';
import { renderLandscape } from './landscape.js';
import { cutEdge, initialEdges, otherSide } from './rules.js';
import { createAnalysisSession, dyadicChange } from './analysis-values.js?v=10';
import { analysisModes, proofLimit, recentCache } from './analysis-modes.js';

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
  if (result.kind === 'green') return 'Exact Green nimber';
  if (result.kind === 'mixed') return result.lower !== undefined ? 'Certified bounds on the numeric part'
    : result.exact ? 'Exact mixed game value' : 'Mixed game value';
  return result.exact ? 'Exact Red–Blue value' : 'Certified Red–Blue bounds';
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

const numberFormat = new Intl.NumberFormat('en-US');
function duration(ms) {
  if (ms > 0 && ms < 1) return '<1 ms';
  return ms < 1000 ? Math.round(ms) + ' ms' : Number((ms / 1000).toFixed(2)) + ' s';
}

function proofStatus(phase, result, mode, reason, improved) {
  if (phase === 'stopped') return result ? 'Stopped. Your last certificate is shown.' : 'Stopped before the first certificate.';
  if (phase === 'unavailable') return result ? 'Background search unavailable. Showing the last certificate.'
    : 'Background search is unavailable in this browser.';
  if (phase === 'assessing') return 'Assessing legal cuts…';
  if (phase === 'waiting') return 'Starting background analysis…';
  if (phase === 'cached') return result?.exact ? 'Exact value certified earlier in this session.'
    : 'Using the certificate retained for this position.';
  if (phase === 'searching') return result?.winner ? 'Winner proven. Searching for a sharper value…'
    : 'Searching for a winner and tighter bounds…';
  if (reason === 'exact') return 'Exact value certified.';
  if (reason === 'search-complete') return result?.winner ? 'Winner certified. The exact game form is unresolved.'
    : 'Search complete. The value and winner remain unresolved.';
  if (reason === 'node-limit' || reason === 'time-limit') {
    const limit = mode.label + (reason === 'node-limit' ? ' node limit reached.' : ' time limit reached.');
    return improved === false ? limit + ' No stronger certificate found in this pass.' : limit;
  }
  return '';
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
        <div class="hb-analyzer__bench">
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
        <section class="hb-analyzer__controls" aria-label="Search controls">
          <fieldset class="hb-analyzer__modes" aria-describedby="${id}-limits">
            <legend>Analysis depth</legend>
            ${Object.entries(analysisModes).map(([name, mode]) => `<label>
              <input class="sr-only" type="radio" name="${id}-mode" value="${name}" ${name === 'quick' ? 'checked' : ''}>
              <span>${mode.label}</span></label>`).join('')}
          </fieldset>
          <p class="hb-analyzer__limits" id="${id}-limits" data-analysis="limits"></p>
          <div class="hb-analyzer__progress"><p data-analysis="progress"></p>
            <button type="button" data-analysis="stop">Stop search</button></div>
        </section>
        </div>
        <section class="hb-analyzer__reading" aria-label="Position analysis">
          <h3 class="hb-analyzer__label" data-analysis="value-label">Position value</h3>
          <p class="hb-analyzer__value" data-analysis="value"></p>
          <p class="hb-analyzer__explain" data-analysis="explain"></p>
          <details class="hb-analyzer__exact" data-analysis="details" hidden>
            <summary>Exact bounds</summary><p data-analysis="endpoints"></p>
          </details>
          <dl class="hb-analyzer__facts">
            <div><dt>To move</dt><dd data-analysis="turn"></dd></div>
            <div><dt>Untimed, perfect-play winner</dt><dd data-analysis="winner"></dd></div>
            <div><dt>Cumulative proof work</dt><dd data-analysis="effort"
              title="Nodes count search checkpoints. Time includes structural arithmetic."></dd></div>
            <div data-analysis="change-row"><dt>Change on this cut</dt><dd class="hb-analyzer__change" data-analysis="change"></dd></div>
          </dl>
          <section class="hb-analyzer__difficulty" aria-labelledby="${id}-difficulty">
            <h3 class="hb-analyzer__label" id="${id}-difficulty">Structural difficulty estimate</h3>
            <p class="hb-analyzer__index" data-analysis="difficulty"></p>
            <p class="hb-analyzer__cuts" data-analysis="cuts"></p>
            <details class="hb-analyzer__exact" data-analysis="difficulty-details" hidden>
              <summary>Why this score?</summary><p data-analysis="difficulty-note"></p>
            </details>
          </section>
        </section>
      </div>
      <p class="sr-only" role="status" aria-atomic="true" data-analysis="status"></p>
    </div>`;

  const view = {};
  for (const el of dialog.querySelectorAll('[data-analysis]')) view[el.dataset.analysis] = el;
  const slider = view.slider;
  const modes = [...dialog.querySelectorAll('[type="radio"]')];
  const boards = recentCache(3);
  let game = null, frames = [], topology = null, renderer = null, boardRecord = null;
  let index = 0, modeName = 'quick', boardSerial = 0, generation = 0;
  let worker = null, job = null, timer = null, cancelTimer = null, awaitingCancel = null;
  let phase = 'waiting', reason = null, improved;
  let edgeColors = new Map();

  function frameKey(i) {
    const frame = frames[i];
    return frame.key ??= boardRecord.id + '/' + JSON.stringify([frame.side, frame.live]);
  }

  function recordAt(i) {
    return i < 0 ? undefined : boardRecord.snapshots.get(frameKey(i));
  }

  function stopWork() {
    generation++;
    clearTimeout(timer);
    timer = null;
    if (worker && job !== null) {
      const previous = worker;
      awaitingCancel = job;
      try { worker.postMessage({ type: 'cancel', id: job }); }
      catch { previous.terminate(); worker = null; awaitingCancel = null; }
      clearTimeout(cancelTimer);
      // A suspended worker, or an unusually expensive indivisible operation,
      // should not keep running after the user stops a search.
      cancelTimer = setTimeout(() => {
        if (worker === previous && awaitingCancel !== null) {
          worker.terminate();
          worker = null;
          awaitingCancel = null;
        }
      }, 300);
    }
    job = null;
  }

  function release() {
    stopWork();
    renderer?.destroy();
    renderer = null;
    game = null;
    frames = [];
    topology = null;
    boardRecord = null;
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
    const record = recordAt(index);
    const current = record?.result;
    const previous = recordAt(index - 1)?.result;
    const frame = frames[index];
    const mode = analysisModes[modeName];
    const searching = phase === 'waiting' || phase === 'assessing' || phase === 'searching';
    const message = proofStatus(phase, current, mode, reason, improved);
    view.progress.textContent = message;
    view.stop.disabled = !searching && phase !== 'stopped';
    view.stop.textContent = phase === 'stopped' ? 'Resume search' : 'Stop search';
    view.limits.textContent = 'Proof budget ' + duration(mode.budgetMs) + ' or ' + numberFormat.format(mode.nodeLimit) +
      ' nodes. Cut assessment ' + duration(mode.cuts.budgetMs) + '.';
    view['change-row'].hidden = !index;
    if (current) {
      view['value-label'].textContent = readoutLabel(current);
      view.value.textContent = scoreOf(current, true);
      view.value.dataset.compact = String(!current.exact || view.value.textContent.length > 9);
      view.explain.textContent = explanation(current);
      view.details.hidden = !longBounds(current);
      if (!view.details.hidden) view.endpoints.textContent = scoreOf(current);
      view.winner.textContent = current.winner ? player(game, current.winner) + ' · proven' : 'Unresolved';
      view.winner.dataset.side = game.variant === 'green' ? '' : current.winner || '';
      view.effort.textContent = numberFormat.format(current.nodes) + (current.nodes === 1 ? ' node' : ' nodes') +
        ' · ' + duration(current.durationMs);
    } else {
      view['value-label'].textContent = 'Position value';
      view.value.textContent = searching ? 'Calculating…' : 'Unresolved';
      view.value.dataset.compact = 'true';
      view.explain.textContent = '';
      view.details.hidden = true;
      view.winner.textContent = searching ? 'Calculating…' : 'Unresolved';
      view.winner.dataset.side = '';
      view.effort.textContent = '—';
    }
    const grade = record?.difficulty;
    view.difficulty.textContent = grade ? (grade.complete ? grade.score : grade.lower + '–' + grade.upper) + ' / 100' : '—';
    view['difficulty-details'].hidden = !grade;
    if (grade) {
      if (!grade.legalMoves) view.cuts.textContent = 'No legal cuts.';
      else if (grade.unknownMoves === grade.legalMoves) view.cuts.textContent = grade.legalMoves +
        (grade.legalMoves === 1 ? ' legal cut remains unresolved.' : ' legal cuts remain unresolved.');
      else view.cuts.textContent = grade.winningMoves + ' proven winning · ' + grade.losingMoves + ' proven losing' +
        (grade.unknownMoves ? ' · ' + grade.unknownMoves + ' unresolved.' : '.');
      const { instantWins, concealedLosses } = grade.tactics;
      let note = 'The Cut Discrimination Index combines the risk of missing a winning cut with the structure of the graph.';
      if (!grade.legalMoves) note = 'No decision remains for the player to move.';
      else if (grade.winner && grade.winner !== frame.side) note += ' Every legal cut loses here, so only the graph contributes.';
      else if (instantWins) note += ' At least one cut wins immediately.';
      else if (concealedLosses) note += ' A one-reply check misses ' + concealedLosses + ' losing ' +
        (concealedLosses === 1 ? 'cut.' : 'cuts.');
      if (grade.legalMoves && grade.topology.measured) note += ' The grounded graph has ' + grade.topology.bridges +
        (grade.topology.bridges === 1 ? ' bridge' : ' bridges') + ' and cycle rank ' + grade.topology.cycleRank + '.';
      note += ' The cut assessment used ' + numberFormat.format(grade.effort.nodes) +
        (grade.effort.nodes === 1 ? ' node in ' : ' nodes in ') + duration(grade.effort.durationMs) + '.';
      view['difficulty-note'].textContent = note;
    } else view.cuts.textContent = searching ? 'Legal cuts are assessed after the proof search.'
      : phase === 'stopped' ? 'Assessment paused.' : 'Cut assessment unavailable.';
    const announcement = moveLabel() + '. ' + (current ? readoutLabel(current) + ' ' + scoreOf(current, true) + '. ' +
      (current.winner ? player(game, current.winner) + ' can force a win. ' : '') : '') + message;
    // Node totals may change every slice. Announce only certificate and status changes.
    if (view.status.textContent !== announcement) view.status.textContent = announcement;
    if (index) {
      if (!current || !previous) view.change.textContent = searching || job !== null ? 'Comparing positions…' : 'Comparison unavailable.';
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
    if (!game || !dialog.open) return;
    const token = generation;
    const mode = analysisModes[modeName];
    const current = recordAt(index);
    const limit = proofLimit(current?.result, mode);
    const grade = current?.difficulty;
    const cutsReady = grade && (current.difficultyRank >= mode.rank || (grade.complete && grade.coverage === 1)) &&
      (!current.result.winner || current.result.winner === grade.winner);
    const positions = [];
    function add(i, selected) {
      positions.push({ index: i, key: frameKey(i), live: frames[i].live, side: frames[i].side,
        mode: selected ? modeName : 'quick', assessCuts: selected, cached: recordAt(i),
        dailyWinner: i === 0 ? cachedDailyWinner(game.seed, topology, game.variant, game.firstSide) : null });
    }
    if (!limit || !cutsReady) add(index, true);
    else {
      phase = 'cached';
      reason = limit;
      improved = current.improved;
    }
    if (index && !recordAt(index - 1)?.result) add(index - 1, false);
    if (!positions.length) { showAnalysis(); return; }
    job = token;
    clearTimeout(cancelTimer);
    awaitingCancel = null;
    showAnalysis();

    function active() { return job === token && generation === token && game && dialog.open; }

    function fallback() {
      if (!active()) return;
      worker?.terminate();
      worker = null;
      // No recursive search or cut survey on the main thread. Small positions
      // still get exact structural arithmetic; larger positions keep any
      // certificate already returned by a worker.
      function next() {
        if (!active()) return;
        const position = positions.shift();
        const cached = recordAt(position.index) || {};
        let result = cached.result;
        const lowCost = position.live.length <= 64 || (game.variant === 'green' && position.live.length <= 256);
        if (!result && lowCost && topology.edges.length <= 512) {
          try {
            const session = createAnalysisSession(topology, position.live, position.side, game.variant, { maxEntries: 64 });
            result = session.refine({ budgetMs: 0, nodeLimit: 0 });
          } catch { /* Leave the result unresolved if structural evaluation also fails. */ }
        }
        if (!result && game.variant === 'redblue') {
          const started = performance.now();
          const blue = position.live.filter(id => edgeColors.get(id) === 'blue').length;
          const red = position.live.length - blue;
          // Each Red–Blue number lies between the costs of all its red and
          // all its blue edges. These inclusive bounds require no search.
          const value = blue && red ? { exact: false, lower: String(-red), upper: String(blue),
            lowerOpen: false, upperOpen: false, winner: null } : { exact: true, number: String(blue - red),
            winner: blue ? 'blue' : red ? 'red' : otherSide(position.side) };
          result = { ...value, kind: 'redblue', nimber: 0, nodes: 0, cacheHits: 0,
            durationMs: performance.now() - started, status: value.exact ? 'exact' : 'unavailable' };
        }
        if (result && position.dailyWinner && !result.winner) result = { ...result, winner: position.dailyWinner };
        if (result) boardRecord.snapshots.set(position.key, { ...cached, result });
        if (position.index === index) phase = 'unavailable';
        if (positions.length) timer = setTimeout(next, 0);
        else job = null;
        showAnalysis();
      }
      timer = setTimeout(next, 0);
    }

    if (typeof Worker !== 'function') { fallback(); return; }
    try {
      worker ??= new Worker(new URL('./analysis-worker.js?v=10', import.meta.url), { type: 'module' });
      const source = worker;
      worker.onmessage = ({ data }) => {
        if (worker !== source) return;
        if (data.type === 'cancelled') {
          if (awaitingCancel === data.id) { clearTimeout(cancelTimer); awaitingCancel = null; }
          return;
        }
        if (!active() || data.id !== token) return;
        if (data.type === 'error') { fallback(); return; }
        if (data.type === 'done') { job = null; showAnalysis(); return; }
        if (data.type !== 'update' || !positions.some(position => position.index === data.index)) return;
        const stored = { result: data.result, difficulty: data.difficulty, difficultyRank: data.difficultyRank,
          improved: data.improved };
        boardRecord.snapshots.set(frameKey(data.index), stored);
        if (data.index === index) {
          phase = data.phase === 'finished' && data.reused ? 'cached' : data.phase;
          reason = data.reason;
          improved = data.improved;
        }
        showAnalysis();
      };
      worker.onmessageerror = worker.onerror = event => {
        event.preventDefault();
        if (worker === source) {
          worker.terminate();
          worker = null;
          fallback();
        }
      };
      worker.postMessage({ type: 'start', id: token, board: topology, variant: game.variant, positions });
    } catch { fallback(); }
  }

  function queueWork() {
    stopWork();
    phase = 'waiting';
    reason = null;
    improved = undefined;
    showAnalysis();
    timer = setTimeout(startWork, 0);
  }

  function select(next) {
    if (!game || next < 0 || next >= frames.length) return;
    index = next;
    const frame = frames[index];
    const last = frames.length - 1;
    view.details.open = false;
    view['difficulty-details'].open = false;
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
    queueWork();
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
    const signature = JSON.stringify([match.variant, topology]);
    boardRecord = boards.get(signature) || boards.set(signature, { id: ++boardSerial, snapshots: recentCache(64) });
    modeName = 'quick';
    for (const input of modes) input.checked = input.value === modeName;
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

  for (const input of modes) input.addEventListener('change', () => {
    if (!game || !input.checked) return;
    modeName = input.value;
    queueWork();
  });
  view.stop.addEventListener('click', () => {
    if (phase === 'stopped') { queueWork(); return; }
    stopWork();
    phase = 'stopped';
    showAnalysis();
  });
  view.close.addEventListener('click', close);
  view.previous.addEventListener('click', () => select(index - 1));
  view.next.addEventListener('click', () => select(index + 1));
  slider.addEventListener('input', () => select(Number(slider.value)));
  dialog.addEventListener('keydown', event => {
    if (event.target.matches('input, select, textarea') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      select(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  dialog.addEventListener('close', () => { if (!dialog.open) release(); });
  return { open, close };
}
