const preferencesKey = 'groundwork.hackenbush.sound.v1';
const defaults = { effects: true, ambience: false, volume: 65 };
const mounted = new WeakMap();

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
  master.connect(context.destination);
  const effects = new Map();
  const birds = new Map();
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

  function voice(bank, nodes, start, duration, peak, attack, offset) {
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
    envelope.connect(master);
    const release = () => {
      source.onended = null;
      bank.delete(source);
      for (const node of nodes) node.disconnect();
    };
    bank.set(source, release);
    source.onended = release;
    if (offset === undefined) source.start(start);
    else source.start(start, offset);
    source.stop(start + duration + .009);
  }

  function scatter(start, duration, frequency, finish, peak, attack = .004) {
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = .82;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(finish, start + duration);
    voice(effects, [noiseSource(), filter], start, duration, peak, attack, random() * noise.duration);
  }

  function tone(start, duration, frequency, finish, peak, type = 'sine') {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(finish, start + duration);
    voice(effects, [oscillator], start, duration, peak, .004);
  }

  function cut({ part = '', fallen = 0 } = {}) {
    const start = context.currentTime + .008;
    const variation = .94 + random() * .12;
    const leafy = /petal|leaf|lily pad|frond|reed|vein|silk|web|plume|spray|plant|gill/i.test(part);
    const hard = /glass|stone|glazing|chain|cable/i.test(part);

    // A blade brushing past its mate, followed by the sound of the material.
    scatter(start, .044, 3800 * variation, 1550, .54);
    scatter(start + .026, leafy ? .10 : .055, (leafy ? 2700 : 1850) * variation, 820, leafy ? .42 : .51);
    const body = (leafy ? 640 : hard ? 820 : 380) * variation;
    tone(start + .026, hard ? .105 : .07, body, body * (hard ? .96 : .61), leafy ? .065 : .14, 'triangle');

    if (!Number.isFinite(fallen) || fallen < 1) return;
    const weight = Math.min(1, Math.log2(fallen + 1) / 5);
    const layers = 1 + Math.ceil(weight * 4);
    const landing = start + .26 + weight * .14;
    for (let i = 0; i < layers; i++) {
      const time = start + .078 + i * .046 + random() * .019;
      scatter(time, .095 + weight * .095, 2350 + random() * 720, 870, .15 + weight * .18, .014);
    }
    scatter(landing, .13 + weight * .09, 750 - weight * 250, 275, .32 + weight * .20);
    tone(landing, .12 + weight * .12, 183 - weight * 50, 87 - weight * 18, .10 + weight * .13);
  }

  // A wooden tine with a short-lived, inharmonic overtone.
  function pluck(start, frequency, duration, level) {
    tone(start, duration, frequency * 1.004, frequency, level);
    tone(start, duration * .32, frequency * 2.72, frequency * 2.68, level * .24);
  }

  function reveal() {
    const now = context.currentTime + .012;
    pluck(now, 293.66, .42, .19);
    pluck(now + .15, 440, .59, .15);
  }

  function end({ timedOut = false } = {}) {
    const now = context.currentTime + (timedOut ? .028 : .31);
    if (timedOut) {
      pluck(now, 293.66, .32, .17);
      pluck(now + .19, 220, .64, .15);
    } else {
      pluck(now, 369.99, .44, .17);
      pluck(now + .135, 440, .46, .16);
      pluck(now + .32, 587.33, .72, .15);
    }
  }

  function stopVoices(bank) {
    for (const [source, release] of bank) {
      source.stop();
      release();
    }
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
    cut, reveal, end, ambience,
    volume(value) { master.gain.setTargetAtTime((value / 100) ** 1.45 * .92, context.currentTime, .016); },
    stopEffects() { stopVoices(effects); },
    destroy() { stopVoices(effects); ambience(false, true); master.disconnect(); }
  };
}

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
      <button class="sound-test" type="button" data-audio="test">
        <svg class="icon" aria-hidden="true"><use href="#i-sound"></use></svg>Test cut
      </button>
      <p class="sound-unavailable" data-audio="unavailable" role="status" hidden>Audio is unavailable in this browser.</p>
    </div>
  </div>`;

/** Play cues once per accepted action. fallen is the count of detached edges, excluding the cut edge. */
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
  const preview = control('test');
  const navIcon = button.querySelector('use');

  function paint() {
    effects.checked = settings.effects;
    ambience.checked = settings.ambience;
    volume.value = String(settings.volume);
    volume.setAttribute('aria-valuetext', settings.volume + ' percent');
    volume.style.setProperty('--sound-volume', settings.volume + '%');
    control('reading').textContent = settings.volume + '%';
    for (const input of [effects, ambience, volume]) input.disabled = unavailable;
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
    for (const { cue, data, requested } of waitingCues) {
      if (settings.effects && now - requested < 550) sounds[cue](data);
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

  function play(cue, data) {
    if (!wantsAudio() || !settings.effects || !sounds) return;
    if (context.state === 'running' && !sleeping) {
      sounds[cue](data);
      return;
    }
    // Unlocking a new context can finish just after the first keyboard or touch cut.
    // Drop the cue if the tab is hidden, muted, or slow to resume.
    const requested = view.performance.now();
    waitingCues = waitingCues.filter(item => requested - item.requested < 550);
    waitingCues.push({ cue, data, requested });
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
  preview.addEventListener('click', () => play('cut', { part: 'branch', fallen: 2 }), options);

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
      button.setAttribute('aria-expanded', 'false');
      button.focus({ preventScroll: true });
    }
  }
  control('close').addEventListener('click', close, options);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape' && typeof dialog.close !== 'function') close();
  }, options);
  dialog.addEventListener('close', () => button.setAttribute('aria-expanded', 'false'), options);
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
