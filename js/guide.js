import { createBoard } from './board.js';
import { beginLesson, guideVariants, lessonQuestion, takeLessonCut } from './guide-lessons.js';
import { legalMoves, otherSide } from './rules.js';
import { chooseMove } from './strategy.js';

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
      <h3 id="hb-guide-practice-title">Practice cuts</h3>
      <p>A branch stays if it can reach the ground through branches of any color.</p>
      <fieldset class="hb-guide-options">
        <legend class="hb-guide-sr">Choose a practice lesson</legend>
        <label><input type="radio" name="hb-guide-position" value="one" checked><span>One support</span></label>
        <label><input type="radio" name="hb-guide-position" value="two"><span>Two supports</span></label>
        <label><input type="radio" name="hb-guide-position" value="flower"><span>Flower loop</span></label>
        <label><input type="radio" name="hb-guide-position" value="endgame"><span>Endgame</span></label>
      </fieldset>
      <div class="hb-guide-example" data-guide="example">
        <div class="hb-guide-caption">
          <p class="hb-guide-turn" data-guide="turn"></p>
          <button type="button" class="hb-guide-reset" data-guide="reset" hidden>Start over</button>
        </div>
        <div class="hb-guide-diagram" data-guide="diagram"></div>
        <div class="hb-guide-action-row">
          <div role="status" aria-live="polite" aria-atomic="true">
            <span class="hb-guide-sr" data-guide="spoken-turn"></span>
            <p class="hb-guide-feedback" data-guide="feedback" hidden></p>
            <p class="hb-guide-question" id="hb-guide-question" data-guide="question"></p>
          </div>
          <div class="hb-guide-buttons" data-guide="controls" role="group" aria-labelledby="hb-guide-question"></div>
          <p class="hb-guide-instruction" data-guide="instruction"></p>
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
  const diagram = part('diagram');
  const controls = part('controls');
  const options = dialog.querySelector('.hb-guide-options');
  const oneSupport = options.querySelector('[value="one"]');
  const events = new AbortController();
  const eventOptions = { signal: events.signal };
  const view = createBoard(diagram, { onCut: id => playCut(id) });
  let variant = 'green';
  let lesson = null;
  let opener = null;

  function resetExample() {
    lesson = beginLesson(options.querySelector('input:checked').value, variant);
    renderLesson({ reset: true });
  }

  function playCut(id, predictFall = null, computer = false) {
    if (!dialog.open || !lesson || lesson.finished) return;
    if (lesson.mode === 'endgame' && (lesson.side === 'red') !== computer) return;
    const next = takeLessonCut(lesson, id, predictFall);
    if (!next) return;
    lesson = next;
    const { part: branchPart, fallen } = lesson.lastCut;
    renderLesson({ cutId: id, removed: fallen });
    onCut?.({ part: branchPart, fallen: fallen.length });
  }

  function button(label, handler, primary = false) {
    const element = dialog.ownerDocument.createElement('button');
    element.type = 'button';
    element.className = 'hb-guide-action' + (primary ? ' hb-guide-action--primary' : '');
    element.textContent = label;
    element.addEventListener('click', handler);
    controls.append(element);
  }

  function addActions() {
    if (lesson.finished) {
      const lessons = [...options.querySelectorAll('input')];
      const next = lessons[lessons.findIndex(input => input.checked) + 1];
      if (next) button('Next · ' + next.labels[0].textContent, () => {
        next.checked = true;
        resetExample();
      }, true);
      button(lesson.mode === 'endgame' ? 'Play again' : 'Try again', resetExample, !next);
    } else if (lesson.mode !== 'endgame') {
      const singular = lesson.mode === 'flower';
      button(singular ? 'It stays' : 'They stay', () => playCut(lesson.target, false));
      button(singular ? 'It falls' : 'They fall', () => playCut(lesson.target, true));
    } else if (lesson.side === 'red') {
      button('Play the computer’s reply', () => {
        const { edgeId } = chooseMove(lesson.board, lesson.live, lesson.side);
        playCut(edgeId, null, true);
      }, true);
    } else {
      for (const id of legalMoves(lesson.board, lesson.live, lesson.side)) {
        const edge = lesson.board.edges.find(branch => branch.id === id);
        button('Cut ' + edge.part, () => playCut(id));
      }
    }
  }

  function turnLabel() {
    const { side, mode, finished, victor, turn } = lesson;
    const sideName = side === 'blue' ? 'Blue' : 'Red';
    if (mode !== 'endgame') {
      if (finished) return turn === 1 ? 'After one cut' : 'After two cuts';
      const step = turn ? 'Second cut' : 'First cut';
      return variant === 'green' ? step : step + ' · ' + sideName;
    }
    if (victor) return victor === 'blue' ? 'You win' : 'The computer wins';
    const actor = side === 'blue' ? 'Your turn' : 'Computer’s turn';
    return variant === 'green' ? actor : actor + ' · ' + sideName;
  }

  function instructions() {
    if (lesson.finished || lesson.turn) return '';
    if (lesson.mode !== 'endgame') return 'Choose a prediction to make the marked cut, or cut a branch in the diagram.';
    if (variant === 'green') return 'The left stalk has two green branches. The short stalk on the right has one. You play first.';
    const tipColor = variant === 'mixed' ? 'green' : 'blue';
    return 'A ' + tipColor + ' tip sits on a red support at left. The short stem at right is blue. You play Blue.';
  }

  function showText(key, text) {
    const element = part(key);
    element.textContent = text;
    element.hidden = !text;
  }

  function renderLesson(animation) {
    const active = dialog.ownerDocument.activeElement;
    const wasOnControls = controls.contains(active) || active === part('reset');
    const wasOnBoard = diagram.contains(active);
    const locked = lesson.finished || (lesson.mode === 'endgame' && lesson.side === 'red');
    view.update({ board: lesson.board, live: lesson.live, side: lesson.side, locked, hintId: lesson.target, ...animation });
    const turn = turnLabel();
    const question = lessonQuestion(lesson);
    const instruction = instructions();
    const actor = lesson.finished ? otherSide(lesson.side) : lesson.side;
    part('spoken-turn').textContent = turn + '. ';
    part('turn').textContent = turn;
    part('turn').dataset.color = variant === 'green' ? 'green' : actor;
    part('reset').hidden = !lesson.turn || lesson.finished;
    part('example').classList.toggle('hb-guide-predicting', !!lesson.target);
    showText('feedback', lesson.feedback);
    showText('question', question);
    showText('instruction', instruction);
    const svg = diagram.querySelector('svg');
    svg.setAttribute('aria-label', (lesson.title + '. ' + turn + '. ' + (question || lesson.feedback) + ' ' + instruction).trim());
    controls.setAttribute('aria-labelledby', question ? 'hb-guide-question' : 'hb-guide-practice-title');
    controls.replaceChildren();
    addActions();
    if (wasOnControls || (wasOnBoard && locked)) controls.firstElementChild.focus({ preventScroll: true });
    else if (wasOnBoard && lesson.target) {
      diagram.querySelector(`[data-edge-id="${lesson.target}"]`).focus({ preventScroll: true });
    }
  }

  function restoreFocus() {
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  function open(rules = 'green', timed = true) {
    variant = Object.hasOwn(guideVariants, rules) ? rules : 'green';
    const green = variant === 'green';
    part('turn-rule').textContent = timed
      ? 'You have 10 seconds each turn to cut one eligible branch. At zero, the other player wins.'
      : 'Take turns cutting one eligible branch.';
    part('clock-note').hidden = !timed;
    part('timed-links').hidden = !timed;
    part('untimed-links').hidden = timed;
    part('green-rule').hidden = !green;
    for (const side of ['blue', 'red']) {
      part(side + '-rule').hidden = green;
      part(side + '-branches').textContent = variant === 'mixed' ? side + ' or green' : side;
    }
    part('variant-note').textContent = guideVariants[variant].note;
    part('variant-note').hidden = !timed && variant !== 'mixed';
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
  part('reset').addEventListener('click', resetExample, eventOptions);
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
