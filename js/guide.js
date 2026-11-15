import { createBoard } from './board.js';
import { cutEdge, initialEdges } from './rules.js';

const examples = {
  green: {
    note: 'In Green, the draw decides who opens.',
    primary: 'green', left: 'green', right: 'green', secondary: 'green',
  },
  redblue: {
    note: 'The opening draw is independent of the color draw.',
    primary: 'blue', left: 'red', right: 'blue', secondary: 'red',
  },
  mixed: {
    note: 'Both players can cut green branches in this match.',
    primary: 'green', left: 'red', right: 'blue', secondary: 'red',
  },
};

function makeExample(colors, mode) {
  const groundY = 142;
  function edge(id, a, b, part, control) {
    return { id, a, b, color: colors[id], part, control };
  }
  if (mode === 'flower') {
    return {
      height: 161, groundY,
      nodes: [
        { id: 'ground', x: 449, y: groundY, ground: true },
        { id: 'base', x: 445, y: 99 }, { id: 'bend', x: 414, y: 69 },
        { id: 'tip', x: 460, y: 16 },
      ],
      edges: [
        edge('primary', 'base', 'bend', 'petal', { x: 416, y: 93 }),
        edge('left', 'bend', 'tip', 'petal', { x: 407, y: 40 }),
        edge('right', 'tip', 'base', 'petal', { x: 491, y: 62 }),
        edge('secondary', 'ground', 'base', 'stem', { x: 442, y: 122 }),
      ],
    };
  }
  const nodes = [
    { id: 'ground-left', x: 398, y: groundY, ground: true },
    { id: 'fork', x: 450, y: 84 }, { id: 'left-tip', x: 408, y: 26 },
    { id: 'right-tip', x: 509, y: 39 },
  ];
  const edges = [
    edge('primary', 'ground-left', 'fork', 'support', { x: 420, y: 106 }),
    edge('left', 'fork', 'left-tip', 'branch', { x: 438, y: 50 }),
    edge('right', 'fork', 'right-tip', 'branch', { x: 487, y: 68 }),
  ];
  if (mode === 'two') {
    nodes.push({ id: 'ground-right', x: 509, y: groundY, ground: true });
    edges.push(edge('secondary', 'ground-right', 'fork', 'support', { x: 482, y: 104 }));
  }
  return { height: 161, groundY, nodes, edges };
}

const prompts = {
  one: 'Will the two upper branches fall if you cut their only support?',
  two: 'Will the two upper branches fall if you cut the left support?',
  flower: 'Will the petal tip fall if you cut its lower-left edge?',
};

function explain(mode, id, move) {
  if (mode === 'flower') {
    return move.fallen.length ? 'The whole petal fell. Its stem was its only path to the ground.'
      : 'The petal opened. Its tip still reaches the stem through the other side.';
  }
  if (move.fallen.length) return 'Both upper branches fell. Their only path to the ground was cut.';
  if (id === 'primary' || id === 'secondary') {
    return 'Both upper branches stayed. The other support still connects them to the ground.';
  }
  return 'Only the cut branch came away. The other branches still have a path to the ground.';
}

const sheet = `
  <div class="hb-guide-sheet">
    <header class="hb-guide-header">
      <h2 id="hb-guide-title" tabindex="-1">How to play</h2>
      <button type="button" class="hb-guide-close" aria-label="Close guide" data-guide="close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </header>
    <p class="hb-guide-intro"><span data-guide="turn-rule"></span>
      If you start a turn with no legal cut, the other player wins.</p>
    <div class="hb-guide-players" role="group" aria-label="Which branches each player can cut">
      <div data-guide="green-rule" hidden><span class="hb-guide-swatch" data-color="green" aria-hidden="true"></span>
        <span><strong>Either player</strong> can cut any green branch.</span></div>
      <div data-guide="blue-rule"><span class="hb-guide-swatch" data-color="blue" aria-hidden="true"></span>
        <span><strong>Blue</strong> cuts <span data-guide="blue-branches">blue</span> branches.</span></div>
      <div data-guide="red-rule"><span class="hb-guide-swatch" data-color="red" aria-hidden="true"></span>
        <span><strong>Red</strong> cuts <span data-guide="red-branches">red</span> branches.</span></div>
    </div>
    <p data-guide="variant-note" class="hb-guide-variant"></p>
    <p class="hb-guide-clock" data-guide="clock-note">During a match the clock keeps running while this guide is open or the game is in a background tab.</p>

    <section class="hb-guide-practice" aria-labelledby="hb-guide-practice-title">
      <h3 id="hb-guide-practice-title">Which branches fall?</h3>
      <p>A branch stays if it can reach the ground through branches of any color. Try the marked cut or choose another edge.<span data-guide="practice-side"></span></p>
      <div class="hb-guide-example">
        <fieldset class="hb-guide-options">
          <legend class="hb-guide-sr">Practice position</legend>
          <label><input type="radio" name="hb-guide-position" value="one" checked><span>One support</span></label>
          <label><input type="radio" name="hb-guide-position" value="two"><span>Two supports</span></label>
          <label><input type="radio" name="hb-guide-position" value="flower"><span>Flower loop</span></label>
        </fieldset>
        <div class="hb-guide-diagram" data-guide="diagram"></div>
        <div class="hb-guide-action-row">
          <button type="button" class="hb-guide-action" data-guide="action">Cut marked branch</button>
          <p class="hb-guide-feedback" role="status" aria-live="polite" aria-atomic="true" data-guide="feedback"></p>
        </div>
      </div>
    </section>

    <details class="hb-guide-setup">
      <summary>Starting a match</summary>
      <ol>
        <li>Choose the rules and controllers, then enter the players’ names. You can also name a computer.</li>
        <li>In Red–Blue, one draw assigns colors and a separate draw picks the opener. In Green, only the opener is drawn.</li>
        <li><strong>Draw seats &amp; reveal</strong> shows the players and the full board for two seconds. The opening turn starts when the preview ends.</li>
      </ol>
    </details>
    <details class="hb-guide-setup">
      <summary>Replaying a map seed</summary>
      <p>Open <strong>Map seed</strong> during setup. Enter six digits using 0–9 or A–F, or leave it blank for a random garden.
        The whole code determines the terrain, plants and paths that connect them to the ground.</p>
      <p>Share the seed beneath the board to give someone the same map. <strong>Rematch</strong> keeps the layout and draws fresh seats.</p>
    </details>
    <details class="hb-guide-setup">
      <summary>Playing with turn links</summary>
      <div data-guide="timed-links">
        <p>Enter both names and choose yours under <strong>On this device</strong> before the draw. If you open, make the first cut. If your opponent opens, send the invitation. They get a two-second preview before their clock starts.</p>
        <p>Send a new link after each cut. The recipient’s 10 seconds start when they open it. If your clock runs out, send the result link to your opponent.</p>
      </div>
      <p data-guide="untimed-links" hidden>Send the new turn link after each cut. The link carries the board, players and move history.</p>
    </details>
  </div>`;

export function createGuide(dialog, { onCut } = {}) {
  dialog.innerHTML = sheet;
  const previousLabel = dialog.getAttribute('aria-labelledby');
  dialog.setAttribute('aria-labelledby', 'hb-guide-title');
  const part = key => dialog.querySelector(`[data-guide="${key}"]`);
  const title = dialog.querySelector('#hb-guide-title');
  const action = part('action');
  const feedback = part('feedback');
  const diagram = part('diagram');
  const options = dialog.querySelector('.hb-guide-options');
  const oneSupport = options.querySelector('[value="one"]');
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  const view = createBoard(diagram, { onCut: cutExample });
  let colors = examples.green;
  let board;
  let live;
  let mode;
  let hasCut = false;
  let opener = null;

  function resetExample() {
    mode = options.querySelector('input:checked').value;
    board = makeExample(colors, mode);
    live = initialEdges(board);
    hasCut = false;
    view.update({ board, live, side: 'blue', hintId: 'primary', reset: true });
    diagram.querySelector('svg').setAttribute('aria-label', 'Practice example. ' + prompts[mode]);
    action.textContent = 'Cut marked branch';
    feedback.textContent = prompts[mode];
  }

  function cutExample(id) {
    if (hasCut || !board) return;
    const move = cutEdge(board, live, id, 'blue');
    if (!move) return;
    hasCut = true;
    live = move.live;
    const explanation = explain(mode, id, move);
    view.update({ board, live, side: 'blue', locked: true, cutId: id, removed: move.fallen });
    action.textContent = 'Reset example';
    feedback.textContent = explanation;
    diagram.querySelector('svg').setAttribute('aria-label', explanation);
    if (diagram.contains(dialog.ownerDocument.activeElement)) action.focus({ preventScroll: true });
    onCut?.({ part: board.edges.find(edge => edge.id === id).part, fallen: move.fallen.length });
  }

  function restoreFocus() {
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function open(variant = 'green', timed = true) {
    colors = examples[variant] || examples.green;
    const green = colors === examples.green;
    part('turn-rule').textContent = timed
      ? 'You have 10 seconds each turn to cut one eligible branch. At zero, the other player wins.'
      : 'Take turns cutting one eligible branch.';
    part('clock-note').hidden = !timed;
    part('timed-links').hidden = !timed;
    part('untimed-links').hidden = timed;
    part('green-rule').hidden = !green;
    for (const side of ['blue', 'red']) {
      part(side + '-rule').hidden = green;
      part(side + '-branches').textContent = colors === examples.mixed ? side + ' or green' : side;
    }
    part('variant-note').textContent = colors.note;
    part('variant-note').hidden = !timed && colors !== examples.mixed;
    part('practice-side').textContent = green ? '' : ' You play as Blue in this example.';
    if (!dialog.open) {
      opener = dialog.ownerDocument.activeElement;
      dialog.showModal();
    }
    oneSupport.checked = true;
    resetExample();
    dialog.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function close() {
    if (dialog.open) {
      dialog.close();
      restoreFocus();
    }
  }

  options.addEventListener('change', resetExample, eventOptions);
  action.addEventListener('click', () => hasCut ? resetExample() : cutExample('primary'), eventOptions);
  part('close').addEventListener('click', close, eventOptions);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, eventOptions);
  dialog.addEventListener('close', () => { if (!dialog.open) restoreFocus(); }, eventOptions);
  let startedOutside = false;
  function outsideDialog(event) {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  dialog.addEventListener('pointerdown', event => { startedOutside = outsideDialog(event); }, eventOptions);
  dialog.addEventListener('click', event => {
    if (startedOutside && outsideDialog(event)) close();
    startedOutside = false;
  }, eventOptions);

  function destroy() {
    close();
    events.abort();
    view.destroy();
    dialog.replaceChildren();
    if (previousLabel === null) dialog.removeAttribute('aria-labelledby');
    else dialog.setAttribute('aria-labelledby', previousLabel);
  }
  return { open, close, destroy };
}
