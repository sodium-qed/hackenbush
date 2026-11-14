import { defaultNickname, entrantName } from './draw.js';

let formNumber = 0;
const letters = ['A', 'B'];

function icon(symbol) {
  return `<svg class="hb-players__icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${symbol}"></use></svg>`;
}

function slotMarkup(prefix, letter) {
  const id = `${prefix}-${letter}`;
  return `
    <fieldset class="hb-players__slot">
      <legend>Entrant ${letter}</legend>
      <div class="hb-players__fields">
        <div class="hb-players__field">
          <label for="${id}-name"><span class="hb-players__sr">Entrant ${letter} </span><span id="${id}-label">Name</span></label>
          <input id="${id}-name" name="entrant${letter}Name" type="text" dir="auto"
            autocomplete="off" enterkeyhint="${letter === 'A' ? 'next' : 'go'}" spellcheck="false" required>
        </div>
        <div class="hb-players__field" id="${id}-controller-field">
          <label for="${id}-kind"><span class="hb-players__sr">Entrant ${letter} </span>Controller</label>
          <div class="hb-players__select">
            <select id="${id}-kind" name="entrant${letter}Kind">
              <option value="human">Human</option><option value="computer">Computer</option>
            </select>${icon('chevron')}
          </div>
        </div>
      </div>
    </fieldset>`;
}

function limitDraft(input) {
  // maxlength counts UTF-16 code units, including both halves of an emoji.
  if (Array.from(input.value).length <= 24) return;
  const limited = Array.from(input.value.normalize('NFC')).slice(0, 24).join('');
  const start = Math.min(input.selectionStart ?? limited.length, limited.length);
  const end = Math.min(input.selectionEnd ?? start, limited.length);
  input.value = limited;
  input.setSelectionRange(start, end);
}

export function createPlayers(container, { onStart, onChange } = {}) {
  const prefix = `hb-players-${++formNumber}`;
  const wasHidden = container.hidden;
  const form = container.ownerDocument.createElement('form');
  form.className = 'hb-players';
  form.setAttribute('aria-labelledby', `${prefix}-title`);
  form.setAttribute('aria-describedby', `${prefix}-draw-note`);
  form.innerHTML = `
    <div class="hb-players__inner">
      <div class="hb-players__header">
        <h2 id="${prefix}-title">Who’s playing?</h2>
        <fieldset class="hb-players__format">
          <legend class="hb-players__sr">Play mode</legend>
          <label><input class="hb-players__sr" type="radio" name="playMode" id="${prefix}-local" value="local" checked>
            <span>${icon('people')}One device</span></label>
          <label><input class="hb-players__sr" type="radio" name="playMode" id="${prefix}-link" value="link">
            <span>${icon('link')}Turn links</span></label>
        </fieldset>
      </div>
      <p id="${prefix}-draw-note" class="hb-players__intro"></p>
      <div class="hb-players__slots">${letters.map(letter => slotMarkup(prefix, letter)).join('')}</div>
      <div class="hb-players__footer">
        <div class="hb-players__device" id="${prefix}-device-wrap" hidden>
          <label for="${prefix}-device">On this device</label>
          <div class="hb-players__select">
            <select id="${prefix}-device" name="hostIndex">
              <option value="0">Entrant A</option><option value="1">Entrant B</option>
            </select>${icon('chevron')}
          </div>
        </div>
        <button type="submit" class="hb-players__submit">${icon('die')}Draw seats &amp; reveal</button>
      </div>
    </div>`;
  container.hidden = true;
  container.append(form);

  const find = suffix => form.querySelector(`#${prefix}-${suffix}`);
  const local = find('local');
  const link = find('link');
  const device = find('device');
  const deviceWrap = find('device-wrap');
  const note = find('draw-note');
  const slots = letters.map(letter => ({
    input: find(`${letter}-name`), kind: find(`${letter}-kind`), label: find(`${letter}-label`),
    kindField: find(`${letter}-controller-field`), localKind: 'human'
  }));
  function pending() {
    const entrants = slots.map(slot => ({ name: slot.input.value, kind: link.checked ? 'human' : slot.localKind }));
    const opponent = link.checked ? 'link' : entrants.some(e => e.kind === 'computer') ? 'computer' : 'local';
    return { entrants, opponent, hostIndex: device.value === '1' ? 1 : 0 };
  }

  function validate(slot, index) {
    const missing = slot.input.required && !entrantName(slot.input.value);
    slot.input.setCustomValidity(missing ? `Enter a name for Entrant ${letters[index]}.` : '');
  }

  function updateHostNames() {
    const names = slots.map(slot => entrantName(slot.input.value));
    names.forEach((name, index) => {
      device.options[index].textContent = !name ? `Entrant ${letters[index]}`
        : name === names[1 - index] ? `${name} (${letters[index]})` : name;
    });
  }

  function refresh() {
    form.classList.toggle('hb-players--linked', link.checked);
    note.textContent = link.checked ? 'Enter both names and choose who is using this device.'
      : 'Enter a name for each human player.';
    slots.forEach((slot, index) => {
      const kind = link.checked ? 'human' : slot.localKind;
      slot.kind.disabled = link.checked;
      slot.kindField.hidden = link.checked;
      slot.kind.value = kind;
      slot.input.required = kind === 'human';
      slot.label.textContent = kind === 'human' ? 'Name' : 'Nickname';
      slot.input.placeholder = kind === 'human' ? 'Enter a name' : defaultNickname(index);
      validate(slot, index);
    });
    deviceWrap.hidden = !link.checked;
    device.disabled = !link.checked;
    updateHostNames();
  }

  slots.forEach((slot, index) => {
    function nameEdited(composing) {
      if (!composing) limitDraft(slot.input);
      validate(slot, index);
      updateHostNames();
      onChange?.(pending());
    }
    slot.input.addEventListener('input', event => nameEdited(event.isComposing));
    slot.input.addEventListener('compositionend', () => nameEdited(false));
    slot.kind.addEventListener('change', () => {
      if (!link.checked) slot.localKind = slot.kind.value;
      refresh();
      onChange?.(pending());
    });
  });
  for (const control of [link, local, device]) control.addEventListener('change', () => {
    refresh();
    onChange?.(pending());
  });

  function open({ entrants, opponent = 'local', hostIndex = 0 } = {}) {
    link.checked = opponent === 'link';
    local.checked = !link.checked;
    device.value = hostIndex === 1 ? '1' : '0';
    slots.forEach((slot, index) => {
      const supplied = entrants?.[index];
      const fallback = opponent === 'computer' && index === 1 ? 'computer' : 'human';
      slot.localKind = (supplied?.kind ?? fallback) === 'computer' ? 'computer' : 'human';
      slot.input.value = typeof supplied?.name === 'string' ? supplied.name : '';
      limitDraft(slot.input);
    });
    form.classList.remove('hb-players--submitted');
    refresh();
    container.hidden = false;
  }

  function close() { container.hidden = true; }

  form.addEventListener('invalid', () => {
    form.classList.add('hb-players--submitted');
  }, true);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (container.hidden) return;
    slots.forEach((slot, index) => {
      slot.input.value = entrantName(slot.input.value);
      validate(slot, index);
    });
    if (!form.reportValidity()) return;
    const config = pending();
    onChange?.(config);
    close();
    onStart?.(config);
  });

  return { open, close, destroy() { form.remove(); container.hidden = wasHidden; } };
}
