const preferencesKey = 'groundwork.hackenbush.sound.v1';
const defaults = { effects: true, ambience: false, volume: 65 };
const mounted = new WeakMap();

function materialOf(part) {
  if (/stone|rock|ridgeline|masonry|brick|foundation|aqueduct|coral/i.test(part)) return 'stone';
  if (/metal|iron|steel|wire|chain|cable|hanger|mullion|glazing bar|glasshouse (sill|column)/i.test(part)) return 'metal';
  if (/glass|glazing|pane|window/i.test(part)) return 'glass';
  if (/leaf|petal|flower center|stamen|lily pad|cactus pad|frond|pinna|fern|vein|reed|cattail|blade|needle|canopy|crown|tassel|silk|web|plume|spray|trailing plant|gill|canvas sail/i.test(part)) return 'leaf';
  return 'wood';
}

function readPreferences(view) {
  try {
    const saved = JSON.parse(view.localStorage.getItem(preferencesKey));
    return {
      effects: typeof saved?.effects === 'boolean' ? saved.effects : defaults.effects,
      ambience: typeof saved?.ambience === 'boolean' ? saved.ambience : defaults.ambience,
      volume: Number.isFinite(saved?.volume) ? Math.min(100, Math.max(0, Math.round(saved.volume))) : defaults.volume
    };
  } catch {
    return { ...defaults };
  }
}

function gardenSounds(context, view) {
  const master = context.createGain();
  master.gain.value = 0;
  // Leave individual cues alone and catch the peaks of overlapping cuts.
  const limiter = context.createDynamicsCompressor?.();
  if (limiter) {
    limiter.threshold.value = -5;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = .002;
    limiter.release.value = .10;
    master.connect(limiter);
    limiter.connect(context.destination);
  } else master.connect(context.destination);
  const effects = new Set();
  const birds = new Map();
  let preview;
  let lastLanding = 0;
  let breeze;
  let birdTimer;
  let fadeTimer;

  // The garden's random variation has its own stream, independent of the draw.
  let seed = (Date.now() >>> 0) || 132791;
  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 2.7), context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;

  function noiseSource() {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    return source;
  }

  function voice(bank, nodes, start, duration, peak, attack, { offset, output = master, onEnd } = {}) {
    const source = nodes[0];
    const envelope = context.createGain();
    const gain = envelope.gain;
    gain.setValueAtTime(0, start);
    gain.linearRampToValueAtTime(peak, start + attack);
    gain.exponentialRampToValueAtTime(peak * .22, start + attack + (duration - attack) * .38);
    gain.exponentialRampToValueAtTime(.00006, start + duration);
    gain.linearRampToValueAtTime(0, start + duration + .008);
    nodes.push(envelope);
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    envelope.connect(output);
    const release = () => {
      source.onended = null;
      bank.delete(source);
      for (const node of nodes) node.disconnect();
      onEnd?.();
    };
    bank.set(source, release);
    source.onended = release;
    if (offset === undefined) source.start(start);
    else source.start(start, offset);
    source.stop(start + duration + .009);
  }

  function stopVoices(bank) {
    for (const [source, release] of bank) {
      source.stop();
      release();
    }
  }

  // One output per cue keeps all its layers together on the board and lets a
  // second preview fade the first without silencing an actual match result.
  function instrument(position, isPreview) {
    const sources = new Map();
    const output = context.createGain();
    const pan = Number.isFinite(position) ? (Math.min(1, Math.max(0, position)) - .5) * .8 : 0;
    const panner = context.createStereoPanner?.();
    if (panner) {
      panner.pan.value = pan;
      output.connect(panner);
      panner.connect(master);
    } else output.connect(master);
    const now = context.currentTime + .008;
    const group = {
      stop() { stopVoices(sources); },
      fade() {
        output.gain.setTargetAtTime(0, context.currentTime, .004);
        for (const source of sources.keys()) source.stop(context.currentTime + .025);
      }
    };
    // Repeated input can arrive faster than a ring's decay.
    if (effects.size >= 12) effects.values().next().value.stop();
    effects.add(group);
    if (isPreview) preview = group;

    function onEnd() {
      if (sources.size) return;
      output.disconnect();
      panner?.disconnect();
      effects.delete(group);
      if (preview === group) preview = undefined;
    }
    function tone(at, duration, from, to, peak, type = 'sine') {
      const start = now + at;
      const source = context.createOscillator();
      source.type = type;
      source.frequency.setValueAtTime(from, start);
      source.frequency.exponentialRampToValueAtTime(to, start + duration);
      voice(sources, [source], start, duration, peak, .003, { output, onEnd });
    }
    function brush(at, duration, from, to, peak, attack = .003, resonance = .82) {
      const start = now + at;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = resonance;
      filter.frequency.setValueAtTime(from, start);
      filter.frequency.exponentialRampToValueAtTime(to, start + duration);
      voice(sources, [noiseSource(), filter], start, duration, peak, attack,
        { offset: random() * noise.duration, output, onEnd });
    }
    return { tone, brush };
  }

  function stopPreview() {
    preview?.fade();
    preview = undefined;
  }

  function cutMaterial({ tone, brush }, material, pitch) {
    // The blades slide past each other before the material releases.
    brush(0, .037, 1550 * pitch, 4100 * pitch, .32, .008);
    switch (material) {
      case 'leaf':
        // Two light, papery flutters after the nip.
        brush(.024, .049, 3900 * pitch, 1750, .56, .002, .67);
        brush(.057, .061, 2210, 3900 * pitch, .34, .009);
        brush(.102, .045, 3450 * pitch, 1400, .16, .006);
        break;
      case 'wood':
        // Fibres crack apart around a short, hollow knock.
        brush(.023, .028, 1700 * pitch, 900, .68, .001, .55);
        tone(.024, .135, 349 * pitch, 219 * pitch, .23, 'triangle');
        tone(.024, .064, 835 * pitch, 675 * pitch, .11);
        brush(.044, .048, 3650 * pitch, 1340, .36, .001);
        break;
      case 'glass':
        brush(.021, .031, 4950 * pitch, 2480, .33, .001);
        tone(.022, .46, 991 * pitch, 988 * pitch, .21);
        tone(.022, .27, 2514 * pitch, 2509 * pitch, .115);
        tone(.022, .13, 3790 * pitch, 3780 * pitch, .056);
        tone(.094, .15, 1670 * pitch, 1662 * pitch, .048);
        break;
      case 'stone':
        brush(.022, .070, 1360 * pitch, 615, .64, .001, .54);
        tone(.022, .099, 563 * pitch, 485 * pitch, .21, 'triangle');
        tone(.023, .073, 1036 * pitch, 920 * pitch, .12);
        brush(.081, .051, 2850 * pitch, 1330, .39, .001, .64);
        tone(.082, .052, 937 * pitch, 862 * pitch, .078);
        break;
      case 'metal':
        // Tension drops as the cable rings. Glass holds its pitch.
        brush(.020, .055, 2340 * pitch, 708, .40, .002);
        tone(.021, .61, 477 * pitch, 416 * pitch, .20, 'triangle');
        tone(.021, .39, 1338 * pitch, 1240 * pitch, .12);
        tone(.021, .24, 2180 * pitch, 2023 * pitch, .071);
        tone(.068, .11, 1048 * pitch, 836 * pitch, .054);
        break;
    }
  }

  function cascade({ tone, brush }, count) {
    const weight = Math.min(1, Math.log2(count + 1) / 5);
    const pieces = 1 + Math.ceil(weight * 4);
    const flight = .14 + weight * .27;
    for (let i = 0; i < pieces; i++) {
      const progress = (i + .4) / pieces;
      const at = .072 + flight * Math.sqrt(progress) + random() * .014;
      brush(at, .095 + weight * .044, 3700 - progress * 1300 + 230 * random(), 1010,
        .20 + .14 * weight, .009 + random() * .006);
      if (i % 2 === 1) tone(at + .008, .045, 930 - 340 * progress, 565, .055, 'triangle');
    }
    const landing = .10 + flight;
    brush(landing, .10 + weight * .10, 880 - weight * 230, 235, .36 + weight * .28, .003, .60);
    tone(landing, .13 + weight * .16, 212 - weight * 59, 97 - weight * 33, .095 + weight * .17);
    // A few lighter pieces settle after the main impact.
    if (pieces > 2) {
      brush(landing + .065, .073, 1980, 830, .27);
      brush(landing + .132, .061, 1510, 610, .16);
    }
    return landing;
  }

  function cut(sound, { part = '', fallen = 0 }, isPreview) {
    cutMaterial(sound, materialOf(part), .94 + random() * .12);
    const landing = Number.isFinite(fallen) && fallen >= 1 ? cascade(sound, fallen) : .02;
    if (!isPreview) lastLanding = context.currentTime + landing;
  }

  function pluck({ tone }, at, frequency, duration, level) {
    tone(at, duration, frequency * 1.004, frequency, level);
    tone(at, duration * .36, frequency * 2.73, frequency * 2.68, level * .28);
  }

  function reveal(sound) {
    pluck(sound, 0, 293.66, .38, .18);
    pluck(sound, .14, 440, .54, .16);
  }

  function end(sound, { timedOut = false }, isPreview) {
    if (timedOut) {
      // A dry tick-tock, then two low settling notes.
      for (const [at, hz] of [[0, 1080], [.148, 795]]) {
        sound.brush(at, .026, 1900, 980, .40, .001);
        sound.tone(at, .047, hz, hz * .80, .13, 'triangle');
      }
      pluck(sound, .30, 220, .36, .17);
      pluck(sound, .51, 146.83, .68, .19);
      return;
    }
    // Leave room for the final branch to land before the ascending D major arpeggio.
    const at = isPreview ? 0 : Math.max(.12, lastLanding + .12 - context.currentTime);
    pluck(sound, at, 293.66, .41, .16);
    pluck(sound, at + .13, 369.99, .40, .16);
    pluck(sound, at + .26, 440, .44, .17);
    pluck(sound, at + .43, 587.33, .76, .18);
    pluck(sound, at + .44, 293.66, .68, .10);
  }

  const cues = { cut, reveal, end };
  function play(cue, data = {}, isPreview = false) {
    if (isPreview || cue === 'end') stopPreview();
    cues[cue](instrument(data.position, isPreview), data, isPreview);
  }

  function stopEffects() {
    for (const group of effects) group.stop();
    lastLanding = 0;
  }

  function callFromTree(start, hz, pan) {
    const bird = context.createOscillator();
    bird.frequency.setValueAtTime(hz * .84, start);
    bird.frequency.exponentialRampToValueAtTime(hz * 1.04, start + .055);
    bird.frequency.exponentialRampToValueAtTime(hz * .90, start + .14);
    const nodes = [bird];
    if (context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      nodes.push(panner);
    }
    voice(birds, nodes, start, .17, .037, .021);
  }

  function birdsong() {
    birdTimer = undefined;
    if (!breeze || fadeTimer !== undefined || context.state !== 'running') return;
    const now = context.currentTime + .02;
    const pitch = 1630 + random() * 490;
    const pan = random() * 1.1 - .55;
    callFromTree(now, pitch, pan);
    callFromTree(now + .18 + random() * .08, pitch * .89, pan);
    birdTimer = view.setTimeout(birdsong, 11000 + random() * 14000);
  }

  function startBreeze() {
    const wind = noiseSource();
    const leaves = context.createBiquadFilter();
    leaves.type = 'lowpass';
    leaves.frequency.value = 850;
    leaves.Q.value = .36;
    const sway = context.createOscillator();
    sway.frequency.value = .061;
    const depth = context.createGain();
    depth.gain.value = 470;
    const level = context.createGain();
    level.gain.value = 0;
    sway.connect(depth);
    depth.connect(leaves.frequency);
    wind.connect(leaves);
    leaves.connect(level);
    level.connect(master);
    wind.start(0, random() * noise.duration);
    sway.start();
    return {
      level,
      stop() {
        wind.stop();
        sway.stop();
        for (const node of [wind, leaves, sway, depth, level]) node.disconnect();
      }
    };
  }

  function stopBreeze() {
    view.clearTimeout(fadeTimer);
    fadeTimer = undefined;
    breeze?.stop();
    breeze = undefined;
  }

  function ambience(enabled, immediate = false) {
    if (enabled) {
      if (breeze && fadeTimer === undefined) return;
      view.clearTimeout(fadeTimer);
      fadeTimer = undefined;
      breeze ??= startBreeze();
      breeze.level.gain.setTargetAtTime(.19, context.currentTime, .28);
      birdTimer = view.setTimeout(birdsong, 2500 + random() * 3200);
    } else {
      view.clearTimeout(birdTimer);
      birdTimer = undefined;
      stopVoices(birds);
      if (immediate) stopBreeze();
      else if (breeze && fadeTimer === undefined) {
        breeze.level.gain.setTargetAtTime(0, context.currentTime, .032);
        fadeTimer = view.setTimeout(stopBreeze, 175);
      }
    }
  }

  return {
    play, ambience, stopEffects, stopPreview,
    volume(value) { master.gain.setTargetAtTime((value / 100) ** 1.45 * .92, context.currentTime, .016); },
    destroy() { stopEffects(); ambience(false, true); master.disconnect(); limiter?.disconnect(); }
  };
}

const previewCues = {
  leaf: { label: 'Leaf snip', cue: 'cut', data: { part: 'leaf' } },
  wood: { label: 'Branch snap', cue: 'cut', data: { part: 'branch' } },
  glass: { label: 'Glass ping', cue: 'cut', data: { part: 'glass roof' } },
  stone: { label: 'Stone chip', cue: 'cut', data: { part: 'rock face' } },
  metal: { label: 'Cable twang', cue: 'cut', data: { part: 'suspension cable' } },
  cascade: { label: 'Falling branches', cue: 'cut', data: { part: 'branch', fallen: 15 } },
  reveal: { label: 'First-player draw', cue: 'reveal' },
  victory: { label: 'Winning cut', cue: 'end' },
  timeout: { label: 'Time expired', cue: 'end', data: { timedOut: true } }
};

const settingsPanel = `
  <div class="sound-sheet">
    <header class="sound-heading">
      <h2 id="sound-heading">Sound settings</h2>
      <button type="button" data-audio="close" aria-label="Close sound settings">
        <svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </header>
    <div class="sound-controls">
      <label class="sound-option">
        <span><strong id="sound-effects-label">Game sounds</strong><small id="sound-effects-note">Clippers, falling branches and match cues.</small></span>
        <input data-audio="effects" type="checkbox" role="switch" aria-labelledby="sound-effects-label" aria-describedby="sound-effects-note">
        <span class="sound-switch" aria-hidden="true"></span>
      </label>
      <label class="sound-option">
        <span><strong id="sound-ambience-label">Garden ambience</strong><small id="sound-ambience-note">Rustling leaves and distant birdsong.</small></span>
        <input data-audio="ambience" type="checkbox" role="switch" aria-labelledby="sound-ambience-label" aria-describedby="sound-ambience-note">
        <span class="sound-switch" aria-hidden="true"></span>
      </label>
      <div class="sound-volume">
        <label for="sound-volume">Volume</label>
        <output for="sound-volume" data-audio="reading" aria-hidden="true"></output>
        <input id="sound-volume" data-audio="volume" type="range" min="0" max="100" step="1">
      </div>
      <div class="sound-preview">
        <label for="sound-sample">Preview a sound</label>
        <select id="sound-sample" data-audio="sample">
          ${Object.entries(previewCues).map(([name, cue]) => `<option value="${name}">${cue.label}</option>`).join('')}
        </select>
        <button class="sound-test" type="button" data-audio="test" aria-label="Play sound preview">
          <svg class="icon" aria-hidden="true"><use href="#i-sound"></use></svg>Play
        </button>
      </div>
      <p class="sound-unavailable" data-audio="unavailable" role="status" hidden>Audio is unavailable in this browser.</p>
    </div>
  </div>`;

/** A cut takes its part, its detached edge count (excluding the cut edge), and an optional left-to-right position from 0 to 1. */
export function createAudio({ button, dialog }) {
  if (mounted.has(dialog)) return mounted.get(dialog);
  const doc = dialog.ownerDocument;
  const view = doc.defaultView;
  const Audio = view.AudioContext || view.webkitAudioContext;
  const events = new AbortController();
  const options = { signal: events.signal };
  let settings = readPreferences(view);
  let unavailable = !Audio;
  let unlocked = false;
  let parked = false;
  let destroyed = false;
  let waitingCues = [];
  let context;
  let sounds;
  let waking;
  let sleeping;

  dialog.innerHTML = settingsPanel;
  dialog.setAttribute('aria-labelledby', 'sound-heading');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', dialog.id);
  button.setAttribute('aria-expanded', 'false');
  const control = name => dialog.querySelector('[data-audio="' + name + '"]');
  const effects = control('effects');
  const ambience = control('ambience');
  const volume = control('volume');
  const sample = control('sample');
  const preview = control('test');
  const navIcon = button.querySelector('use');

  function paint() {
    effects.checked = settings.effects;
    ambience.checked = settings.ambience;
    volume.value = String(settings.volume);
    volume.setAttribute('aria-valuetext', settings.volume + ' percent');
    volume.style.setProperty('--sound-volume', settings.volume + '%');
    control('reading').textContent = settings.volume + '%';
    for (const input of [effects, ambience, volume, sample]) input.disabled = unavailable;
    preview.disabled = unavailable || !settings.effects || settings.volume === 0;
    control('unavailable').hidden = !unavailable;
    const muted = unavailable || !settings.volume || (!settings.effects && !settings.ambience);
    navIcon?.setAttribute('href', muted ? '#i-muted' : '#i-sound');
  }

  function wantsAudio() {
    return !destroyed && !unavailable && unlocked && !parked && !doc.hidden &&
      settings.volume > 0 && (settings.effects || settings.ambience);
  }

  function applyLevels() {
    sounds.volume(settings.volume);
    if (!settings.effects) sounds.stopEffects();
    sounds.ambience(settings.ambience);
    const now = view.performance.now();
    for (const { cue, data, requested, isPreview } of waitingCues) {
      if (settings.effects && now - requested < 550) sounds.play(cue, data, isPreview);
    }
    waitingCues = [];
  }

  function sleep() {
    waitingCues = [];
    if (!sounds) return;
    sounds.stopEffects();
    sounds.ambience(false, true);
    if (context.state === 'running' && !sleeping) {
      sleeping = context.suspend().catch(() => {}).finally(() => {
        sleeping = null;
        if (wantsAudio()) wake();
      });
    }
  }

  function wake(gestureRetry = false) {
    if (!wantsAudio() || sleeping) return;
    if (!context) {
      try {
        context = new Audio({ latencyHint: 'interactive' });
        sounds = gardenSounds(context, view);
        context.addEventListener('statechange', () => {
          if (context.state === 'running' && !sleeping) {
            if (wantsAudio()) applyLevels();
            else sleep();
          } else if (context.state === 'interrupted') {
            waitingCues = [];
            sounds.stopEffects();
            sounds.ambience(false, true);
          }
        }, options);
      } catch {
        unavailable = true;
        if (context && context.state !== 'closed') context.close().catch(() => {});
        paint();
        return;
      }
    }
    if (context.state === 'running') {
      applyLevels();
    } else if (context.state !== 'closed') {
      if (!waking) {
        waking = context.resume().then(() => {
          if (!wantsAudio()) { sleep(); return; }
          if (context.state === 'running' && !sleeping) applyLevels();
        }).catch(() => {}).finally(() => { waking = null; });
      } else if (gestureRetry) {
        // Some touch browsers grant audio during the click following pointerup.
        context.resume().catch(() => {});
      }
    }
  }

  function sync() {
    if (wantsAudio()) wake();
    else sleep();
  }

  function clearPreview() {
    waitingCues = waitingCues.filter(item => !item.isPreview);
    sounds?.stopPreview();
  }

  function play(cue, data, isPreview = false) {
    if (!wantsAudio() || !settings.effects || !sounds) return;
    if (context.state === 'running' && !sleeping) {
      sounds.play(cue, data, isPreview);
      return;
    }
    // Unlocking a new context can finish just after the first keyboard or touch cut.
    // Drop the cue if the tab is hidden, muted, or slow to resume.
    const requested = view.performance.now();
    waitingCues = waitingCues.filter(item => requested - item.requested < 550 && (!isPreview || !item.isPreview));
    waitingCues.push({ cue, data, requested, isPreview });
    wake();
  }

  function gesture(event) {
    if (!event.isTrusted || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.type === 'pointerdown' && event.pointerType !== 'mouse') return;
    if (view.navigator.userActivation && !view.navigator.userActivation.hasBeenActive) return;
    unlocked = true;
    if (!context || context.state !== 'running') wake(true);
  }
  const capture = { signal: events.signal, capture: true, passive: true };
  for (const name of ['pointerdown', 'pointerup', 'keydown', 'click']) doc.addEventListener(name, gesture, capture);
  doc.addEventListener('visibilitychange', sync, options);
  view.addEventListener('storage', event => {
    if (event.key !== preferencesKey && event.key !== null) return;
    settings = readPreferences(view);
    if (!settings.effects || !settings.volume) waitingCues = [];
    paint();
    sync();
  }, options);

  function change() {
    settings = { effects: effects.checked, ambience: ambience.checked, volume: Number(volume.value) };
    if (!settings.effects || !settings.volume) waitingCues = [];
    try { view.localStorage.setItem(preferencesKey, JSON.stringify(settings)); } catch { /* Keep in memory. */ }
    paint();
    sync();
  }
  effects.addEventListener('change', change, options);
  ambience.addEventListener('change', change, options);
  volume.addEventListener('input', change, options);
  preview.addEventListener('click', () => {
    const selection = previewCues[sample.value];
    if (selection) play(selection.cue, selection.data, true);
  }, options);

  button.addEventListener('click', () => {
    if (dialog.hasAttribute('open')) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.dataset.soundFallback = '';
      dialog.setAttribute('open', '');
      control('close').focus({ preventScroll: true });
    }
    button.setAttribute('aria-expanded', 'true');
  }, options);
  function close() {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      clearPreview();
      button.setAttribute('aria-expanded', 'false');
      button.focus({ preventScroll: true });
    }
  }
  control('close').addEventListener('click', close, options);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && typeof dialog.close !== 'function') close();
  }, options);
  dialog.addEventListener('close', () => {
    clearPreview();
    button.setAttribute('aria-expanded', 'false');
  }, options);
  let pressedBackdrop = false;
  dialog.addEventListener('pointerdown', event => { pressedBackdrop = event.target === dialog; }, options);
  dialog.addEventListener('click', event => {
    if (pressedBackdrop && event.target === dialog && dialog.hasAttribute('open')) close();
    pressedBackdrop = false;
  }, options);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    waitingCues = [];
    if (dialog.hasAttribute('open')) close();
    button.setAttribute('aria-expanded', 'false');
    events.abort();
    sounds?.destroy();
    if (context && context.state !== 'closed') context.close().catch(() => {});
    mounted.delete(dialog);
  }
  view.addEventListener('pagehide', event => {
    if (event.persisted) { parked = true; sleep(); }
    else destroy();
  }, options);
  view.addEventListener('pageshow', () => { parked = false; sync(); }, options);
  paint();
  const api = { cut: data => play('cut', data), reveal: () => play('reveal'), end: data => play('end', data), destroy };
  mounted.set(dialog, api);
  return api;
}
