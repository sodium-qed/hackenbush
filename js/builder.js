import {
  COLUMNS, ROWS, MAX_BRANCHES, MAX_TITLE, pointName, branchIssue, isDrawing, floatingBranches,
  readCustomDrawing, writeCustomBoard,
} from './custom-board.js';

const svgNS = 'http://www.w3.org/2000/svg';
const colors = { green: 'Green', blue: 'Blue', red: 'Red' };
const draftPrefix = 'groundwork.hackenbush.drawing.v1.';
let instances = 0;

function icon(path) {
  return `<svg class="hb-builder-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${path}"/></svg>`;
}

function sheet(id) {
  return `
    <div class="hb-builder-sheet">
      <header class="hb-builder-head">
        <h2 id="${id}-title" tabindex="-1">Board builder</h2>
        <button type="button" class="hb-builder-close" aria-label="Close board builder" data-builder="close">${icon('m6 6 12 12M18 6 6 18')}</button>
      </header>
      <label class="hb-builder-name">Board name <input type="text" data-builder="name" placeholder="Custom garden" maxlength="${MAX_TITLE}" autocomplete="off"></label>
      <div class="hb-builder-pad">
        <div class="hb-builder-tools">
          <div class="hb-builder-pens" role="group" aria-label="Drawing tools">
            ${Object.entries(colors).map(([color, label]) => `
              <button type="button" data-color="${color}" aria-pressed="false" aria-label="Draw ${color} branches">
                <i class="hb-builder-swatch" aria-hidden="true"></i>${label}
              </button>`).join('')}
            <button type="button" data-builder="erase" aria-pressed="false">${icon('m5 14 8.5-9a2 2 0 0 1 3 0L20 8.5a2 2 0 0 1 0 3L12 20H9l-4-4a1.5 1.5 0 0 1 0-2Zm4.5-4.5 7 7M12 20h8')}Erase</button>
          </div>
          <div class="hb-builder-edit" role="group" aria-label="Edit drawing">
            <button type="button" data-builder="undo" title="Undo last drawing change">${icon('m8 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12')}Undo</button>
            <button type="button" data-builder="clear">Clear</button>
          </div>
        </div>
        <svg data-builder="canvas" role="group" aria-label="Drawing grid" aria-describedby="${id}-keys"></svg>
        <p id="${id}-keys" class="sr-only">In draw mode, use arrow keys to move between dots and Enter or Space to choose one. In erase mode, arrow keys select a branch and Enter erases it. Escape ends a path.</p>
        <div class="hb-builder-prompt">
          <p role="status" aria-atomic="true" data-builder="prompt"></p>
          <button type="button" data-builder="end">End path</button>
        </div>
      </div>
      <details class="hb-builder-help" data-builder="help">
        <summary>Drawing help</summary>
        <p>Choose two dots to draw a branch. Keep choosing dots to extend the path. Choose its last dot again or use <strong>End path</strong> to start elsewhere. Connect back to an existing joint to make a loop.</p>
        <p>Every branch must reach the ground through its endpoints. Separate plants can each have their own root. Branches can meet at end dots only. To add a joint in the middle, erase the long branch and draw two shorter ones. A board holds up to ${MAX_BRANCHES} branches.</p>
        <p data-builder="color-help">To recolor a branch, choose a color and draw over the same two endpoints.</p>
        <p>Use the arrow keys to move, Enter or Space to draw or erase, and Escape to end a path. Undo restores an erased branch or a cleared drawing. Each ruleset keeps its own draft on this device.</p>
      </details>
      <footer class="hb-builder-footer">
        <div class="hb-builder-readout" aria-live="polite" aria-atomic="true">
          <strong data-builder="count"></strong><span data-builder="validity"></span>
        </div>
        <button type="button" class="hb-builder-use" data-builder="use">Use this board ${icon('M4 12h15m-6-6 6 6-6 6')}</button>
      </footer>
    </div>`;
}

function svg(tag, attributes = {}) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
}

const branchCount = count => count + (count === 1 ? ' branch' : ' branches');

export function createBuilder(dialog, { onUse } = {}) {
  const id = 'hb-builder-' + ++instances;
  dialog.classList.add('hb-builder');
  dialog.setAttribute('aria-labelledby', id + '-title');
  dialog.innerHTML = sheet(id);
  const part = key => dialog.querySelector(`[data-builder="${key}"]`);
  const canvas = part('canvas');
  const name = part('name');
  const prompt = part('prompt');
  const pens = [...dialog.querySelectorAll('[data-color]')];
  const title = dialog.querySelector('h2');
  const memory = new Map();

  const defs = svg('defs');
  const hatch = svg('pattern', { id: id + '-soil', width: 13, height: 8, patternUnits: 'userSpaceOnUse' });
  hatch.append(svg('path', { class: 'hb-builder-hatch', d: 'M-2 6 3 1m5 4 3-4m1 8 5-6' }));
  defs.append(hatch);
  const paper = svg('g', { 'aria-hidden': 'true' });
  const lines = svg('g', { class: 'hb-builder-branches' });
  const preview = svg('line', { class: 'hb-builder-preview', 'aria-hidden': 'true' });
  const dots = svg('g', { class: 'hb-builder-points' });
  canvas.append(defs, paper, lines, preview, dots);

  let variant = 'green', pen = 'green', erasing = false;
  let edges = [], source = null, history = [], loose = new Set();
  let anchor = null, hover = null, cursor = 4, selectedEdge = 0;
  let opener = null, points = [];
  let cellWidth = 0, cellHeight = 0;
  const pointViews = Array.from({ length: COLUMNS * ROWS }, (_, point) => {
    const group = svg('g', { role: 'button', 'data-point': point, tabindex: '-1' });
    const hit = svg('rect', { class: 'hb-builder-point-hit' });
    group.append(hit, svg('circle', { class: 'hb-builder-ring', r: 9 }), svg('circle', { class: 'hb-builder-dot' }));
    dots.append(group);
    return group;
  });

  function saveDraft() {
    const draft = { title: name.value, source, edges };
    memory.set(variant, draft);
    try { localStorage.setItem(draftPrefix + variant, JSON.stringify(draft)); } catch { /* Keep this open tab's draft. */ }
  }

  function loadDraft() {
    let draft = memory.get(variant);
    if (!draft) {
      try { draft = JSON.parse(localStorage.getItem(draftPrefix + variant)); } catch { /* Start a fresh drawing. */ }
    }
    return draft && typeof draft.title === 'string' && isDrawing(variant, draft.edges) ? draft : null;
  }

  function instruction() {
    if (erasing) return edges.length ? 'Choose a branch to erase.' : 'Choose a drawing color to add a branch.';
    if (anchor !== null) return `Drawing from ${pointName(anchor)}. Choose the next dot.`;
    return edges.length ? 'Choose a dot to start another path.' : 'Choose a ground dot, then a second dot to draw.';
  }

  function viewForEdge(index) { return lines.querySelector(`[data-branch="${index}"]`); }

  function selectedView() {
    return erasing && edges.length ? viewForEdge(selectedEdge) : pointViews[cursor];
  }

  function updatePreview() {
    const to = hover ?? (dots.contains(dialog.ownerDocument.activeElement) ? cursor : null);
    const show = !erasing && anchor !== null && to !== null && anchor !== to && points[anchor] && points[to];
    preview.style.display = show ? '' : 'none';
    if (!show) return;
    const a = points[anchor], b = points[to];
    preview.setAttribute('x1', a.x); preview.setAttribute('y1', a.y);
    preview.setAttribute('x2', b.x); preview.setAttribute('y2', b.y);
    preview.style.setProperty('--hb-pen', `var(--${pen})`);
  }

  function updateSelection() {
    canvas.dataset.mode = erasing ? 'erase' : 'draw';
    const occupied = new Set(edges.flatMap(({ a, b }) => [a, b]));
    for (const [point, group] of pointViews.entries()) {
      const ground = point < COLUMNS, joint = occupied.has(point);
      group.classList.toggle('is-root', ground);
      group.classList.toggle('is-joint', joint);
      group.classList.toggle('is-anchor', anchor === point);
      group.setAttribute('tabindex', !erasing && point === cursor ? '0' : '-1');
      group.setAttribute('aria-pressed', String(anchor === point));
      group.setAttribute('aria-label', `${pointName(point)}, ${ground ? 'ground dot' : joint ? 'joint' : 'dot'}`);
      group.lastChild.setAttribute('r', joint ? 4.1 : ground ? 3.4 : 2);
    }
    dots.setAttribute('aria-hidden', String(erasing));
    lines.setAttribute('aria-hidden', String(!erasing));
    for (const group of lines.children) {
      group.setAttribute('tabindex', erasing && Number(group.dataset.branch) === selectedEdge ? '0' : '-1');
    }
    for (const button of pens) {
      button.hidden = variant === 'green' ? button.dataset.color !== 'green' : button.dataset.color === 'green';
      button.setAttribute('aria-pressed', String(!erasing && button.dataset.color === pen));
    }
    part('erase').setAttribute('aria-pressed', String(erasing));
    part('erase').disabled = !edges.length;
    part('end').disabled = anchor === null;
    part('undo').disabled = !history.length;
    part('clear').disabled = !edges.length;
    updatePreview();
  }

  function drawEdges() {
    const groups = edges.map(({ a, b, color }, index) => {
      const start = points[a], end = points[b];
      const d = `M${start.x} ${start.y}L${end.x} ${end.y}`;
      const group = svg('g', {
        class: 'hb-builder-edge' + (loose.has(index) ? ' is-loose' : ''),
        role: 'button', tabindex: '-1', 'data-branch': index, 'data-ink': color,
        'aria-label': `Erase ${color} branch from ${pointName(a)} to ${pointName(b)}`,
      });
      group.append(svg('path', { class: 'hb-builder-edge-hit', d }), svg('path', { class: 'hb-builder-edge-glow', d }),
        svg('path', { class: 'hb-builder-stroke', d }));
      if (color !== 'green') {
        const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2;
        const rotation = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
        group.append(svg('path', {
          class: 'hb-builder-stripes', transform: `translate(${x} ${y}) rotate(${rotation})`,
          d: color === 'blue' ? 'M-2 -2v4m4 -4v4' : 'M0 -2v4',
        }));
      }
      return group;
    });
    lines.replaceChildren(...groups);
  }

  function checkDrawing() {
    loose = floatingBranches(edges);
    const count = part('count'), validity = part('validity');
    count.textContent = branchCount(edges.length);
    validity.classList.toggle('is-loose', !!loose.size);
    if (!edges.length) validity.textContent = 'Draw a rooted branch to begin.';
    else if (loose.size) validity.textContent = `${branchCount(loose.size)} ${loose.size === 1 ? 'needs' : 'need'} a path to the ground.`;
    else if (variant === 'redblue' && edges.every(edge => edge.color === edges[0].color)) {
      validity.textContent = `Only ${colors[edges[0].color]} has an opening move.`;
    } else validity.textContent = 'All branches reach the ground.';
    part('use').disabled = !edges.length || !!loose.size;
  }

  function layout() {
    if (!dialog.open) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const { width, height } = bounds;
    const margin = Math.max(25, Math.min(width * .065, 40));
    const ground = height - 30;
    cellWidth = (width - 2 * margin) / (COLUMNS - 1);
    cellHeight = (ground - 21) / (ROWS - 1);
    points = pointViews.map((group, index) => {
      const x = margin + (index % COLUMNS) * cellWidth;
      const y = ground - Math.floor(index / COLUMNS) * cellHeight;
      group.setAttribute('transform', `translate(${x} ${y})`);
      const hit = group.firstChild;
      hit.setAttribute('x', -cellWidth / 2); hit.setAttribute('width', cellWidth);
      hit.setAttribute('y', -cellHeight / 2); hit.setAttribute('height', cellHeight);
      return { x, y };
    });
    let guides = '';
    const labels = [];
    for (let column = 0; column < COLUMNS; column++) {
      const x = points[column].x;
      guides += `M${x} 21V${ground}`;
      const label = svg('text', { x, y: ground + 21, 'text-anchor': 'middle' });
      label.textContent = pointName(column)[0];
      labels.push(label);
    }
    for (let row = 0; row < ROWS; row++) {
      const y = points[row * COLUMNS].y;
      if (row) guides += `M${margin} ${y}H${width - margin}`;
      const label = svg('text', { x: margin - 14, y: y + 3.4, 'text-anchor': 'end' });
      label.textContent = row + 1;
      labels.push(label);
    }
    paper.replaceChildren(
      svg('rect', { class: 'hb-builder-soil', x: 0, y: ground, width, height: 30 }),
      svg('rect', { x: 0, y: ground + 1, width, height: 7, fill: `url(#${id}-soil)` }),
      svg('path', { class: 'hb-builder-guides', d: guides }),
      svg('path', { class: 'hb-builder-ground', d: `M0 ${ground}H${width}` }),
      ...labels,
    );
    const restoreEdgeFocus = lines.contains(dialog.ownerDocument.activeElement);
    drawEdges();
    updateSelection();
    if (restoreEdgeFocus) selectedView()?.focus({ preventScroll: true });
  }

  function refresh(message = instruction()) {
    checkDrawing();
    if (points.length) drawEdges();
    updateSelection();
    prompt.textContent = message;
  }

  function replaceEdges(next, message) {
    history.push(edges);
    if (history.length > 100) history.shift();
    edges = next;
    selectedEdge = Math.max(0, Math.min(selectedEdge, next.length - 1));
    if (!edges.length) erasing = false;
    saveDraft();
    refresh(message);
  }

  function endPath() {
    anchor = hover = null;
    updateSelection();
    prompt.textContent = instruction();
  }

  function drawPoint(point) {
    cursor = point;
    hover = null;
    if (anchor === point) { endPath(); return; }
    if (anchor === null) {
      anchor = point;
      updateSelection();
      prompt.textContent = instruction();
      return;
    }
    const a = anchor, b = point;
    const existing = edges.findIndex(edge => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
    if (existing >= 0 && edges[existing].color !== pen) {
      anchor = point;
      replaceEdges(edges.map((edge, i) => i === existing ? { ...edge, color: pen } : edge),
        `Recolored ${pointName(a)}–${pointName(b)} ${pen}. Continue from ${pointName(b)}.`);
      return;
    }
    const issue = branchIssue(edges, a, b);
    if (issue) { updateSelection(); prompt.textContent = issue; return; }
    anchor = point;
    replaceEdges([...edges, { a, b, color: pen }],
      `Added ${pointName(a)}–${pointName(b)}. Continue from ${pointName(b)} or end the path.`);
  }

  function eraseEdge(index) {
    const edge = edges[index];
    if (!edge) return;
    selectedEdge = index;
    const next = edges.filter((_, i) => i !== index);
    replaceEdges(next, `Erased ${pointName(edge.a)}–${pointName(edge.b)}. ${next.length ? 'Choose another branch or a drawing color.' : 'Choose a dot to draw.'}`);
  }

  function undo() {
    if (!history.length) return;
    edges = history.pop();
    anchor = hover = null;
    selectedEdge = Math.max(0, Math.min(selectedEdge, edges.length - 1));
    if (!edges.length) erasing = false;
    saveDraft();
    refresh('Last drawing change undone. ' + instruction());
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  function open(requestedVariant = 'green', code = null) {
    const imported = readCustomDrawing(code);
    variant = imported?.variant ?? (requestedVariant === 'redblue' ? 'redblue' : 'green');
    const saved = loadDraft();
    const draft = imported && saved?.source !== code ? { ...imported, source: code } : saved;
    edges = draft?.edges ?? [];
    source = draft?.source ?? null;
    name.value = draft?.title.slice(0, MAX_TITLE) ?? '';
    history = [];
    anchor = hover = null;
    selectedEdge = 0; cursor = 4;
    pen = variant === 'redblue' ? 'blue' : 'green';
    erasing = false;
    part('color-help').hidden = variant === 'green';
    part('help').open = false;
    if (!dialog.open) {
      opener = dialog.ownerDocument.activeElement;
      dialog.showModal();
    }
    checkDrawing();
    layout();
    prompt.textContent = instruction();
    dialog.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  name.addEventListener('input', saveDraft);
  for (const button of pens) {
    button.addEventListener('click', () => {
      pen = button.dataset.color;
      erasing = false;
      updateSelection();
      prompt.textContent = instruction();
    });
  }
  part('erase').addEventListener('click', () => {
    erasing = true;
    endPath();
  });
  part('end').addEventListener('click', () => { endPath(); selectedView()?.focus({ preventScroll: true }); });
  part('undo').addEventListener('click', () => {
    undo();
    if (part('undo').disabled) selectedView()?.focus({ preventScroll: true });
  });
  part('clear').addEventListener('click', () => {
    anchor = hover = null;
    replaceEdges([], 'Drawing cleared. Undo restores it.');
    part('undo').focus({ preventScroll: true });
  });
  part('use').addEventListener('click', () => {
    const code = writeCustomBoard(variant, name.value, edges);
    if (!code) { refresh(); return; }
    source = code;
    saveDraft();
    close();
    onUse?.(code, variant);
  });
  part('close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('cancel', event => {
    if (anchor !== null) { event.preventDefault(); endPath(); }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });

  canvas.addEventListener('click', event => {
    const target = event.target.closest(erasing ? '[data-branch]' : '[data-point]');
    if (!target) return;
    if (erasing) eraseEdge(Number(target.dataset.branch));
    else drawPoint(Number(target.dataset.point));
    selectedView()?.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', event => {
    if (erasing || anchor === null || event.pointerType === 'touch') return;
    const target = event.target.closest('[data-point]');
    const next = target ? Number(target.dataset.point) : null;
    if (next !== hover) { hover = next; updatePreview(); }
  });
  canvas.addEventListener('pointerleave', () => { hover = null; updatePreview(); });
  canvas.addEventListener('focusin', event => {
    const target = event.target.closest(erasing ? '[data-branch]' : '[data-point]');
    if (!target) return;
    // Assistive technology can move focus directly to a non-roving item.
    if (erasing) selectedEdge = Number(target.dataset.branch);
    else cursor = Number(target.dataset.point);
    updateSelection();
  });
  canvas.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (event.repeat) return;
      if (erasing) eraseEdge(selectedEdge); else drawPoint(cursor);
    } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      hover = null;
      const x = cursor % COLUMNS, y = Math.floor(cursor / COLUMNS);
      if (erasing) {
        const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
        if (key === 'Home') selectedEdge = 0;
        else if (key === 'End') selectedEdge = edges.length - 1;
        else selectedEdge = (selectedEdge + step + edges.length) % edges.length;
      } else if (key === 'ArrowLeft' && x > 0) cursor--;
      else if (key === 'ArrowRight' && x < COLUMNS - 1) cursor++;
      else if (key === 'ArrowUp' && y < ROWS - 1) cursor += COLUMNS;
      else if (key === 'ArrowDown' && y > 0) cursor -= COLUMNS;
      else if (key === 'Home') cursor -= x;
      else if (key === 'End') cursor += COLUMNS - 1 - x;
      updateSelection();
    } else return;
    selectedView()?.focus({ preventScroll: true });
    updatePreview();
  });
  if (globalThis.ResizeObserver) new ResizeObserver(layout).observe(canvas);
  else globalThis.addEventListener('resize', layout);
  return { open };
}
