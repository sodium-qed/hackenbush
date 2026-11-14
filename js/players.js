import { otherSide } from './rules.js';
import { normalizePlayers } from './session.js';

let formNumber = 0;

function icon(symbol) {
  return `<svg class="hb-players__icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${symbol}"></use></svg>`;
}

function slotMarkup(prefix, number) {
  const id = `${prefix}-p${number}`;
  const order = number === 1 ? 'first move' : 'second move';
  const picker = number === 1 ? `
    <label class="hb-players__color hb-players__color--picker" id="${id}-picker">
      <span class="hb-players__sr">Player 1 branch color</span>
      <i class="hb-players__swatch" aria-hidden="true"></i>
      <select name="firstSide" id="${id}-color">
        <option value="blue">Blue</option><option value="red">Red</option>
      </select>
      ${icon('chevron')}
    </label>` : '';
  return `
    <fieldset class="hb-players__slot">
      <legend class="hb-players__sr">Player ${number}, ${order}</legend>
      <div class="hb-players__slot-head">
        <div class="hb-players__identity" aria-hidden="true"><strong>Player ${number}</strong><span> · ${order}</span></div>
        ${picker}
        <span class="hb-players__color hb-players__color--fixed" id="${id}-side">
          <i class="hb-players__swatch" aria-hidden="true"></i>
          <span class="hb-players__sr">Branch color </span><span id="${id}-side-name"></span>
        </span>
      </div>
      <div class="hb-players__fields">
        <div class="hb-players__field">
          <label for="${id}-name">Name <span>(optional)</span></label>
          <input type="text" id="${id}-name" name="player${number}Name" dir="auto" autocomplete="off" spellcheck="false">
        </div>
        <div class="hb-players__field">
          <label for="${id}-kind">Controller</label>
          <div class="hb-players__select">
            <select id="${id}-kind" name="player${number}Kind">
              <option value="human">Human</option><option value="computer">Computer</option>
            </select>
            ${icon('chevron')}
          </div>
        </div>
      </div>
    </fieldset>`;
}

function limitName(input) {
  // Native maxlength counts UTF-16 code units and splits the allowance for emoji.
  const text = Array.from(input.value).slice(0, 24).join('');
  if (text === input.value) return;
  const start = Math.min(input.selectionStart ?? text.length, text.length);
  const end = Math.min(input.selectionEnd ?? start, text.length);
  input.value = text;
  input.setSelectionRange(start, end);
}

export function createPlayers(container, { onStart, onChange } = {}) {
  const prefix = `hb-players-${++formNumber}`;
  const wasHidden = container.hidden;
  const form = document.createElement('form');
  form.className = 'hb-players';
  form.setAttribute('aria-labelledby', `${prefix}-title`);
  form.innerHTML = `
    <div class="hb-players__inner">
      <div class="hb-players__header">
        <div>
          <h2 id="${prefix}-title">Choose players</h2>
          <p>The board returns when the match starts.</p>
        </div>
        <fieldset class="hb-players__format">
          <legend class="hb-players__sr">Play mode</legend>
          <label><input class="hb-players__sr" type="radio" name="playMode" id="${prefix}-local" value="local" checked>
            <span>${icon('people')}One device</span></label>
          <label><input class="hb-players__sr" type="radio" name="playMode" id="${prefix}-link" value="link">
            <span>${icon('link')}Turn links</span></label>
        </fieldset>
      </div>
      <div class="hb-players__slots">${slotMarkup(prefix, 1)}${slotMarkup(prefix, 2)}</div>
      <div class="hb-players__footer">
        <div class="hb-players__foot-info">
          <div class="hb-players__device" id="${prefix}-device-wrap" hidden>
            <label for="${prefix}-device">This device</label>
            <div class="hb-players__select">
              <select id="${prefix}-device" name="devicePlayer">
                <option value="0">Player 1</option><option value="1">Player 2</option>
              </select>${icon('chevron')}
            </div>
          </div>
          <p class="hb-players__note" id="${prefix}-note"></p>
        </div>
        <button type="submit" class="hb-players__submit">Start match ${icon('arrow')}</button>
      </div>
    </div>`;
  container.hidden = true;
  container.append(form);

  const find = suffix => form.querySelector(`#${prefix}-${suffix}`);
  const local = find('local');
  const link = find('link');
  const colorPicker = find('p1-picker');
  const firstColor = find('p1-color');
  const deviceWrap = find('device-wrap');
  const device = find('device');
  const note = find('note');
  const slots = [1, 2].map(number => ({
    input: find(`p${number}-name`),
    kind: find(`p${number}-kind`),
    stamp: find(`p${number}-side`),
    colorName: find(`p${number}-side-name`),
    localKind: 'human'
  }));
  let variant = 'green';

  function sides() {
    return [firstColor.value, otherSide(firstColor.value)];
  }

  function assignments(withNames) {
    const players = {};
    const colors = sides();
    slots.forEach((slot, index) => {
      players[colors[index]] = {
        kind: link.checked ? 'human' : slot.localKind,
        name: withNames ? slot.input.value.trim() : ''
      };
    });
    return players;
  }

  function selection() {
    const colors = sides();
    const players = assignments(true);
    const hasComputer = colors.some(side => players[side].kind === 'computer');
    const opponent = link.checked ? 'link' : hasComputer ? 'computer' : 'local';
    const seat = link.checked ? colors[Number(device.value)] : colors.find(side => players[side].kind === 'human') ?? colors[0];
    return { players, firstSide: firstColor.value, opponent, seat };
  }

  function refresh() {
    const colors = sides();
    const colored = variant !== 'green';
    const defaults = normalizePlayers(assignments(false), firstColor.value);
    firstColor.disabled = !colored;
    colorPicker.hidden = !colored;
    colorPicker.dataset.side = firstColor.value;
    slots.forEach((slot, index) => {
      const side = colored ? colors[index] : 'green';
      slot.stamp.hidden = colored && index === 0;
      slot.stamp.dataset.side = side;
      slot.colorName.textContent = side[0].toUpperCase() + side.slice(1);
      slot.kind.disabled = link.checked;
      slot.kind.value = defaults[colors[index]].kind;
      slot.input.placeholder = defaults[colors[index]].name;
    });
    deviceWrap.hidden = !link.checked;
    device.disabled = !link.checked;
    let help = '';
    if (link.checked) {
      help = device.value === '1' ? 'Send the opening link to Player 1.' : 'Send the turn link after your move.';
    } else if (variant === 'green') {
      help = 'Both players can cut green branches.';
    } else if (variant === 'mixed') {
      help = 'Both players can also cut green branches.';
    }
    note.textContent = help;
    note.hidden = !help;
  }

  for (const slot of slots) {
    slot.input.addEventListener('input', event => {
      if (!event.isComposing) limitName(slot.input);
    });
    slot.input.addEventListener('compositionend', () => limitName(slot.input));
    slot.kind.addEventListener('change', () => {
      if (!link.checked) slot.localKind = slot.kind.value;
      refresh();
    });
  }
  for (const control of [local, link, firstColor, device]) control.addEventListener('change', refresh);
  form.addEventListener('input', event => {
    if (event.target.type === 'text' && !event.isComposing) onChange?.(selection());
  });
  form.addEventListener('change', () => onChange?.(selection()));
  form.addEventListener('compositionend', () => onChange?.(selection()));

  function open({ variant: nextVariant = 'green', firstSide = 'blue', players, opponent = 'local', seat = 'blue' } = {}) {
    variant = nextVariant;
    firstColor.value = firstSide === 'red' ? 'red' : 'blue';
    link.checked = opponent === 'link';
    local.checked = !link.checked;
    const colors = sides();
    const resolved = normalizePlayers(players, firstColor.value, opponent);
    device.value = seat === colors[1] ? '1' : '0';
    slots.forEach((slot, index) => { slot.localKind = resolved[colors[index]].kind; });
    refresh();
    slots.forEach((slot, index) => {
      const name = resolved[colors[index]].name;
      slot.input.value = name === slot.input.placeholder ? '' : name;
    });
    container.hidden = false;
  }

  function close() {
    container.hidden = true;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (container.hidden) return;
    for (const slot of slots) limitName(slot.input);
    const result = selection();
    close();
    onStart?.(result);
  });

  return {
    open,
    close,
    destroy() {
      form.remove();
      container.hidden = wasHidden;
    }
  };
}
