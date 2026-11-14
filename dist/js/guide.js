import { cutEdge, initialEdges } from './rules.js';

const examples = {
  green: {
    note: 'In Green, both players can cut any standing branch.',
    primary: 'green', left: 'green', right: 'green', secondary: 'green',
  },
  redblue: {
    note: 'In Red–Blue, each player can cut only their own color.',
    primary: 'blue', left: 'red', right: 'blue', secondary: 'red',
  },
  mixed: {
    note: 'This Red–Blue game also includes shared green branches.',
    primary: 'green', left: 'red', right: 'blue', secondary: 'red',
  },
};

const sampleNodes = [
  { id: 'ground-left', ground: true },
  { id: 'ground-right', ground: true },
  { id: 'fork' }, { id: 'top-left' }, { id: 'top-right' },
];

function makeExample(colors, twoSupports) {
  const edges = [
    { id: 'primary', a: 'ground-left', b: 'fork', color: colors.primary },
    { id: 'left', a: 'fork', b: 'top-left', color: colors.left },
    { id: 'right', a: 'fork', b: 'top-right', color: colors.right },
  ];
  if (twoSupports) {
    edges.push({ id: 'secondary', a: 'ground-right', b: 'fork', color: colors.secondary });
  }
  return { nodes: sampleNodes, edges };
}

const sheet = `
  <div class="hb-guide-sheet">
    <header class="hb-guide-header">
      <h2 id="hb-guide-title" tabindex="-1">How to play</h2>
      <button type="button" class="hb-guide-close" aria-label="Close guide" data-guide="close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
      </button>
    </header>
    <p class="hb-guide-intro">Take turns cutting one branch. If you start a turn with no legal cut,
      you lose, even if the other player still has branches.</p>

    <div class="hb-guide-players" role="group" aria-label="Which branches each player can cut">
      <div><span class="hb-guide-swatch" data-color="blue" aria-hidden="true"></span>
        <span><strong>Blue</strong> can cut blue or green.</span></div>
      <div><span class="hb-guide-swatch" data-color="red" aria-hidden="true"></span>
        <span><strong>Red</strong> can cut red or green.</span></div>
    </div>
    <p data-guide="variant-note" class="hb-guide-variant"></p>

    <section class="hb-guide-practice" aria-labelledby="hb-guide-practice-title">
      <h3 id="hb-guide-practice-title">Which branches fall?</h3>
      <p>A branch stays if it still has a path to the ground. That path can follow branches of any color.</p>
      <div class="hb-guide-example">
        <fieldset class="hb-guide-options">
          <legend class="hb-guide-sr">Number of supports in the practice position</legend>
          <label><input type="radio" name="hb-guide-supports" value="one" checked>
            <span>One support</span></label>
          <label><input type="radio" name="hb-guide-supports" value="two">
            <span>Two supports</span></label>
        </fieldset>

        <svg class="hb-guide-diagram" viewBox="0 0 340 145" role="img" aria-labelledby="hb-guide-diagram-title hb-guide-diagram-desc">
          <title id="hb-guide-diagram-title">Practice position</title>
          <desc id="hb-guide-diagram-desc" data-guide="description"></desc>
          <g aria-hidden="true">
            <path class="hb-guide-earth" d="M16 119H324"/>
            <path class="hb-guide-hatch" d="m28 120-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5"/>
            <text class="hb-guide-ground-label" x="324" y="139" text-anchor="end">Ground</text>
            <g data-guide="second-support">
              <path data-edge="secondary" d="M224 118 166 72"/>
              <circle class="hb-guide-root" cx="224" cy="118" r="3.6"/>
            </g>
            <g data-guide="first-support">
              <path data-edge="primary" d="M112 118 166 72"/>
              <path class="hb-guide-hit" d="M112 118 166 72"/>
              <circle class="hb-guide-root" cx="112" cy="118" r="3.6"/>
            </g>
            <g data-guide="crown">
              <path data-edge="left" d="M166 72 137 30"/>
              <path data-edge="right" d="M166 72 211 43"/>
              <circle class="hb-guide-joint" cx="137" cy="30" r="3.3"/>
              <circle class="hb-guide-joint" cx="211" cy="43" r="3.3"/>
              <circle class="hb-guide-joint" cx="166" cy="72" r="4.1"/>
            </g>
            <g class="hb-guide-cue" data-guide="mark">
              <text x="40" y="77">Cut here</text>
              <path d="M87 74q25-1 45 16m-8-1 8 1-2-7"/>
            </g>
          </g>
        </svg>
        <div class="hb-guide-action-row">
          <button type="button" class="hb-guide-action" data-guide="action">Cut marked branch</button>
          <p class="hb-guide-feedback" role="status" aria-live="polite" aria-atomic="true" data-guide="feedback"></p>
        </div>
      </div>
    </section>
  </div>
`;

export function createGuide(dialog) {
  dialog.innerHTML = sheet;
  const previousLabel = dialog.getAttribute('aria-labelledby');
  dialog.setAttribute('aria-labelledby', 'hb-guide-title');
  const part = (key) => dialog.querySelector(`[data-guide="${key}"]`);
  const title = dialog.querySelector('#hb-guide-title');
  const action = part('action');
  const primary = part('first-support');
  const crown = part('crown');
  const second = part('second-support');
  const mark = part('mark');
  const feedback = part('feedback');
  const description = part('description');
  const options = dialog.querySelector('.hb-guide-options');
  const oneSupport = options.querySelector('[value="one"]');
  const twoSupport = options.querySelector('[value="two"]');
  const edges = [...dialog.querySelectorAll('[data-edge]')];
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  let colors = examples.green;
  let board;
  let hasCut = false;
  let opener = null;

  function resetExample() {
    const two = twoSupport.checked;
    board = makeExample(colors, two);
    hasCut = false;
    primary.classList.remove('hb-guide-gone');
    mark.classList.remove('hb-guide-gone');
    crown.classList.remove('hb-guide-fallen');
    second.classList.toggle('hb-guide-gone', !two);
    for (const edge of edges) edge.dataset.color = colors[edge.dataset.edge];
    action.textContent = 'Cut marked branch';
    const player = colors === examples.green ? 'Player 1' : 'Blue';
    feedback.textContent = `${player} to move. Try the marked cut.`;
    description.textContent = two
      ? 'Two upper branches meet at a fork. Two supports connect the fork to the ground. The left support is marked.'
      : 'Two upper branches meet at a fork. One marked support connects the fork to the ground.';
  }

  function cutExample() {
    const result = cutEdge(board, initialEdges(board), 'primary', 'blue');
    if (!result) return;
    hasCut = true;
    primary.classList.add('hb-guide-gone');
    mark.classList.add('hb-guide-gone');
    crown.classList.toggle('hb-guide-fallen', result.fallen.length > 0);
    action.textContent = 'Reset example';
    if (result.fallen.length) {
      feedback.textContent = 'Both upper branches fall. Their only path to the ground is gone.';
      description.textContent = 'The marked support was cut. The two upper branches fell, leaving the ground bare.';
    } else {
      feedback.textContent = 'Both upper branches stay. The right support still connects them to the ground.';
      description.textContent = 'The left support was cut. The right support and both upper branches are still standing.';
    }
  }

  function restoreFocus() {
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function open(variant = 'green') {
    colors = examples[variant] || examples.green;
    part('variant-note').textContent = colors.note;
    oneSupport.checked = true;
    resetExample();
    if (!dialog.open) {
      opener = dialog.ownerDocument.activeElement;
      dialog.showModal();
    }
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
  action.addEventListener('click', () => (hasCut ? resetExample() : cutExample()), eventOptions);
  primary.addEventListener('click', () => { if (!hasCut) cutExample(); }, eventOptions);
  part('close').addEventListener('click', close, eventOptions);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  }, eventOptions);
  dialog.addEventListener('close', () => { if (!dialog.open) restoreFocus(); }, eventOptions);
  let startedOutside = false;
  function outsideDialog(event) {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  dialog.addEventListener('pointerdown', (event) => { startedOutside = outsideDialog(event); }, eventOptions);
  dialog.addEventListener('click', (event) => {
    if (startedOutside && outsideDialog(event)) close();
    startedOutside = false;
  }, eventOptions);

  function destroy() {
    close();
    events.abort();
    dialog.replaceChildren();
    if (previousLabel === null) dialog.removeAttribute('aria-labelledby');
    else dialog.setAttribute('aria-labelledby', previousLabel);
  }
  return { open, close, destroy };
}
