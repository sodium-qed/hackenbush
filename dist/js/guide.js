import { cutEdge, initialEdges } from './rules.js';

const examples = {
  green: {
    note: 'In Green, the draw decides who opens.',
    primary: 'green', left: 'green', right: 'green', secondary: 'green',
  },
  redblue: {
    note: 'The draw for the opening turn is independent of the color draw.',
    primary: 'blue', left: 'red', right: 'blue', secondary: 'red',
  },
  mixed: {
    note: 'The green branches in this match are shared.',
    primary: 'green', left: 'red', right: 'blue', secondary: 'red',
  },
};

const sampleNodes = [
  { id: 'ground-left', ground: true },
  { id: 'ground-right', ground: true },
  { id: 'fork' }, { id: 'top-left' }, { id: 'top-right' },
];

const flowerNodes = [
  { id: 'ground', ground: true }, { id: 'base' }, { id: 'left-bend' }, { id: 'tip' },
];

const descriptions = {
  one: 'Two upper branches meet at a fork. One marked support connects the fork to the ground.',
  two: 'Two upper branches meet at a fork. Two supports connect the fork to the ground. The left support is marked.',
  flower: 'A stem supports a petal. Its left and right sides meet at the tip, forming a loop. The lower-left branch is marked.',
};

function makeExample(colors, mode) {
  if (mode === 'flower') {
    return {
      nodes: flowerNodes,
      edges: [
        { id: 'primary', a: 'base', b: 'left-bend', color: colors.primary },
        { id: 'left', a: 'left-bend', b: 'tip', color: colors.left },
        { id: 'right', a: 'tip', b: 'base', color: colors.right },
        { id: 'secondary', a: 'ground', b: 'base', color: colors.secondary },
      ],
    };
  }
  const edges = [
    { id: 'primary', a: 'ground-left', b: 'fork', color: colors.primary },
    { id: 'left', a: 'fork', b: 'top-left', color: colors.left },
    { id: 'right', a: 'fork', b: 'top-right', color: colors.right },
  ];
  if (mode === 'two') {
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
    <p class="hb-guide-intro"><span data-guide="turn-rule"></span>
      If you start a turn with no legal cut, you lose, even if branches are still standing.</p>
    <p class="hb-guide-clock" data-guide="clock-note">The turn clock keeps running while this guide is open or the game is in a background tab.</p>

    <div class="hb-guide-players" role="group" aria-label="Which branches each player can cut">
      <div data-guide="green-rule" hidden><span class="hb-guide-swatch" data-color="green" aria-hidden="true"></span>
        <span><strong>Either player</strong> can cut any green branch.</span></div>
      <div data-guide="blue-rule"><span class="hb-guide-swatch" data-color="blue" aria-hidden="true"></span>
        <span><strong>Blue</strong> cuts <span data-guide="blue-branches">blue</span> branches.</span></div>
      <div data-guide="red-rule"><span class="hb-guide-swatch" data-color="red" aria-hidden="true"></span>
        <span><strong>Red</strong> cuts <span data-guide="red-branches">red</span> branches.</span></div>
    </div>
    <p data-guide="variant-note" class="hb-guide-variant"></p>

    <details class="hb-guide-setup">
      <summary>Starting a new match</summary>
      <ol>
        <li>Choose the rules and controllers, then enter the human players’ names. You can also name a computer.
          The Expert garden stays hidden until the draw.</li>
        <li>In Red–Blue, one random draw assigns colors and a separate draw picks the opener. In Green, only the opener is drawn.</li>
        <li><strong>Draw seats &amp; reveal</strong> shows the assignments and the whole board for two seconds.
          The opening turn starts automatically when the look ends.</li>
      </ol>
    </details>
    <details class="hb-guide-setup">
      <summary>Replaying a map seed</summary>
      <p>Open <strong>Map seed</strong> before the draw. Enter six digits using 0–9 or A–F, or leave it blank for a random map.
        Each digit chooses one of 16 cuttable landmarks from left to right. Changing a digit also changes the landscape.</p>
      <p>Use <strong>Seed</strong> beneath the board to share the map for a fresh match. <strong>Rematch</strong> plays the same layout with another seat draw.</p>
    </details>
    <details class="hb-guide-setup">
      <summary>Playing with turn links</summary>
      <div data-guide="timed-links">
        <p>Enter both names and choose yours under <strong>On this device</strong> before the draw.
          If you draw the first turn, make the opening cut. If your opponent opens, send the invitation.
          They get their own two-second look before their clock starts.</p>
        <p>Send a new link after each cut. From then on, the recipient’s 10 seconds start when they open their link.
          Time in transit is free. If your clock runs out, send the result link to your opponent.</p>
      </div>
      <p data-guide="untimed-links" hidden>After each cut, send the new turn link to your opponent.
        The link carries the board, players and move history.</p>
    </details>

    <section class="hb-guide-practice" aria-labelledby="hb-guide-practice-title">
      <h3 id="hb-guide-practice-title">Which branches fall?</h3>
      <p>A branch stays if it has a path to the ground through branches of any color.
        On a trellis or around a flower petal, look for a second path.</p>
      <div class="hb-guide-example">
        <fieldset class="hb-guide-options">
          <legend class="hb-guide-sr">Practice position</legend>
          <label><input type="radio" name="hb-guide-position" value="one" checked>
            <span>One support</span></label>
          <label><input type="radio" name="hb-guide-position" value="two">
            <span>Two supports</span></label>
          <label><input type="radio" name="hb-guide-position" value="flower">
            <span>Flower loop</span></label>
        </fieldset>

        <svg class="hb-guide-diagram" viewBox="0 0 340 145" role="img" aria-labelledby="hb-guide-diagram-title hb-guide-diagram-desc">
          <title id="hb-guide-diagram-title">Practice position</title>
          <desc id="hb-guide-diagram-desc" data-guide="description"></desc>
          <g aria-hidden="true">
            <path class="hb-guide-earth" d="M16 119H324"/>
            <path class="hb-guide-hatch" d="m28 120-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5m20-5-5 5"/>
            <text class="hb-guide-ground-label" x="324" y="139" text-anchor="end">Ground</text>
            <g data-guide="fork">
              <g data-guide="second-support">
                <path data-edge="secondary" d="M224 118 166 72"/>
                <circle class="hb-guide-root" cx="224" cy="118" r="3.6"/>
              </g>
              <g class="hb-guide-target" data-guide="first-support">
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
            <g data-guide="flower" class="hb-guide-gone">
              <path data-edge="secondary" d="M166 118V78"/>
              <path data-edge="left" d="M133 52Q131 32 160 21"/>
              <path data-edge="right" d="M160 21C187 32 191 62 166 78"/>
              <g class="hb-guide-target" data-guide="petal-side">
                <path data-edge="primary" d="M166 78Q141 77 133 52"/>
                <path class="hb-guide-hit" d="M166 78Q141 77 133 52"/>
              </g>
              <circle class="hb-guide-root" cx="166" cy="118" r="3.6"/>
              <circle class="hb-guide-joint" cx="166" cy="78" r="4.1"/>
              <circle class="hb-guide-joint" cx="133" cy="52" r="3.3"/>
              <circle class="hb-guide-joint" cx="160" cy="21" r="3.3"/>
              <g class="hb-guide-cue" data-guide="petal-mark">
                <text x="38" y="61">Cut here</text>
                <path d="M85 58q27-3 51 10m-8 1 8-1-3-7"/>
              </g>
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
  const petalSide = part('petal-side');
  const crown = part('crown');
  const second = part('second-support');
  const fork = part('fork');
  const flower = part('flower');
  const feedback = part('feedback');
  const description = part('description');
  const options = dialog.querySelector('.hb-guide-options');
  const oneSupport = options.querySelector('[value="one"]');
  const edges = [...dialog.querySelectorAll('[data-edge]')];
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  let colors = examples.green;
  let board;
  let mode = 'one';
  let target = primary;
  let mark = part('mark');
  let hasCut = false;
  let opener = null;

  function resetExample() {
    mode = options.querySelector('input:checked').value;
    const isFlower = mode === 'flower';
    board = makeExample(colors, mode);
    target = isFlower ? petalSide : primary;
    mark = part(isFlower ? 'petal-mark' : 'mark');
    hasCut = false;
    fork.classList.toggle('hb-guide-gone', isFlower);
    flower.classList.toggle('hb-guide-gone', !isFlower);
    target.classList.remove('hb-guide-gone');
    mark.classList.remove('hb-guide-gone');
    crown.classList.remove('hb-guide-fallen');
    second.classList.toggle('hb-guide-gone', mode !== 'two');
    for (const edge of edges) edge.dataset.color = colors[edge.dataset.edge];
    action.textContent = 'Cut marked branch';
    feedback.textContent = isFlower ? 'Will the petal tip fall if you cut this side?' : 'Will the upper branches stay after this cut?';
    description.textContent = descriptions[mode];
  }

  function cutExample() {
    const result = cutEdge(board, initialEdges(board), 'primary', 'blue');
    if (!result) return;
    hasCut = true;
    target.classList.add('hb-guide-gone');
    mark.classList.add('hb-guide-gone');
    crown.classList.toggle('hb-guide-fallen', result.fallen.length > 0);
    action.textContent = 'Reset example';
    if (result.fallen.length) {
      feedback.textContent = 'Both upper branches fall. Their only path to the ground is gone.';
      description.textContent = 'The marked support was cut. The two upper branches fell, leaving the ground bare.';
    } else if (mode === 'flower') {
      feedback.textContent = 'The petal opens. Its tip still reaches the stem through the other side.';
      description.textContent = 'The lower-left branch is gone. The open petal stays attached to the stem through its right side.';
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
    const note = part('variant-note');
    note.textContent = colors.note;
    note.hidden = !timed && colors !== examples.mixed;
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
  for (const branch of [primary, petalSide]) {
    branch.addEventListener('click', () => {
      if (!hasCut && target === branch) cutExample();
    }, eventOptions);
  }
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
