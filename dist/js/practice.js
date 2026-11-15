import { createBoard } from './board.js';
import { cutEdge, initialEdges } from './rules.js';

function makeSunflower() {
  const groundY = 202;
  const nodes = [
    { id: 'foot', x: 451, y: groundY, ground: true },
    { id: 'stalk', x: 445, y: 156 },
    { id: 'leaf-tip', x: 499, y: 131 },
  ];
  const edges = [];
  const lengths = [59, 65, 63, 70, 64, 70, 66, 63, 69, 62, 57];
  const petals = lengths.length;
  const step = 2 * Math.PI / petals;
  const diskRadius = 17;
  const polar = (angle, distance, bend = 0) => ({
    x: 448 + distance * Math.cos(angle) - bend * Math.sin(angle),
    y: 81 + distance * Math.sin(angle) + bend * Math.cos(angle),
  });
  function link(id, a, b, part, control) {
    edges.push({ id, a, b, part, control, color: 'green' });
  }

  // Each petal shares one arc with the seed disk. Removing any of its
  // three boundaries opens the wash as well as changing the position.
  for (let i = 0; i < petals; i++) {
    const angle = Math.PI / 2 + step * i;
    nodes.push({ id: 'disk-' + i, ...polar(angle, diskRadius) });
  }
  for (let j = 0; j < petals; j++) {
    // The opening keyboard selection is the upright petal.
    const i = (Math.floor(petals / 2) + j) % petals;
    const angle = Math.PI / 2 + step * (i + 0.5);
    const reach = lengths[i];
    const bend = Math.sin(i * 2.4) * 2.2;
    const width = reach * 0.23;
    const a = 'disk-' + i;
    const b = 'disk-' + ((i + 1) % petals);
    const tip = 'tip-' + i;
    nodes.push({ id: tip, ...polar(angle, reach, bend) });
    link('petal-' + i + '-out', a, tip, 'petal', polar(angle, reach * 0.9, -width));
    link('petal-' + i + '-back', tip, b, 'petal', polar(angle, reach * 0.84, width));
    link('rim-' + i, a, b, 'flower center', polar(angle, diskRadius / Math.cos(step / 2)));
  }
  link('stem', 'stalk', 'disk-0', 'stem', { x: 448, y: 126 });
  link('root', 'foot', 'stalk', 'root', { x: 448, y: 179 });
  link('leaf-upper', 'stalk', 'leaf-tip', 'leaf margin', { x: 468, y: 126 });
  link('leaf-lower', 'leaf-tip', 'stalk', 'leaf margin', { x: 483, y: 164 });
  link('leaf-vein', 'stalk', 'leaf-tip', 'leaf vein', { x: 475, y: 144 });
  return { nodes, edges, height: 219, groundY };
}

export const practiceSunflower = makeSunflower();
const edges = new Map(practiceSunflower.edges.map(edge => [edge.id, edge]));
const opening = initialEdges(practiceSunflower);
const invitation = 'Try a petal edge, then the stem. Practice is untimed.';

function describeCut(edge, before, move) {
  if (!move.live.length) return 'The garden is clear. Regrow the sunflower to try another cut.';
  if (edge.id === 'stem' && move.fallen.length) {
    return 'The flower head fell. Its stem was the last path to the soil.';
  }
  if (move.fallen.length) {
    return move.fallen.length === 1 ? 'One more branch lost its path to the soil and fell.'
      : move.fallen.length + ' more branches lost their path to the soil and fell.';
  }
  if (edge.part === 'petal') {
    const prefix = edge.id.slice(0, edge.id.lastIndexOf('-'));
    const rim = prefix.replace('petal-', 'rim-');
    if (before.includes(prefix + '-out') && before.includes(prefix + '-back') && before.includes(rim)) {
      return 'The petal opened. Its other edge still connects the tip to the stem.';
    }
  }
  if (edge.part === 'flower center' && opening.every(id => !id.startsWith('rim-') || before.includes(id))) {
    return 'The seed disk opened. Its remaining edges are still rooted.';
  }
  if (edge.part.startsWith('leaf') && ['leaf-upper', 'leaf-lower', 'leaf-vein'].every(id => before.includes(id))) {
    return edge.part === 'leaf vein' ? 'The leaf lost its central vein. Its two outer edges remain.'
      : 'One side of the leaf opened. Its vein still connects the tip to the stalk.';
  }
  return 'Only the cut branch came away. The others still reach the soil.';
}

export function createPractice(container, { onCut } = {}) {
  const garden = document.createElement('div');
  garden.className = 'hb-practice';
  garden.innerHTML = `
    <header class="hb-practice__heading">
      <h2>Practice garden</h2>
      <button class="hb-practice__regrow" type="button" aria-label="Regrow the sunflower" disabled>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8.3 8.3 0 1 1 .9 6M4 4.7v5.6h5.6"/></svg>
        Regrow
      </button>
    </header>
    <div class="hb-practice__bed"></div>
    <p class="hb-practice__note" role="status" aria-live="polite" aria-atomic="true"></p>`;
  container.append(garden);
  const bed = garden.querySelector('.hb-practice__bed');
  const regrow = garden.querySelector('.hb-practice__regrow');
  const note = garden.querySelector('.hb-practice__note');
  const view = createBoard(bed, { onCut: cut });
  bed.querySelector('svg').setAttribute('aria-label', 'Practice sunflower, cut any branch');
  let live = opening;

  function render(changes = {}) {
    view.update({ board: practiceSunflower, live, side: 'green', ...changes });
  }
  function cut(id) {
    const move = cutEdge(practiceSunflower, live, id, 'green');
    if (!move) return;
    const edge = edges.get(id);
    const description = describeCut(edge, live, move);
    live = move.live;
    regrow.disabled = false;
    render({ removed: move.fallen, cutId: id });
    note.textContent = description;
    if (!live.length && bed.contains(document.activeElement)) regrow.focus({ preventScroll: true });
    onCut?.({ part: edge.part, fallen: move.fallen.length });
  }
  function reset() {
    live = opening;
    render({ reset: true });
    regrow.disabled = true;
    note.textContent = invitation;
  }
  function regrowFlower(event) {
    reset();
    if (!event.detail) bed.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  regrow.addEventListener('click', regrowFlower);
  reset();
  return {
    reset,
    destroy() {
      regrow.removeEventListener('click', regrowFlower);
      view.destroy();
      garden.remove();
    },
  };
}
