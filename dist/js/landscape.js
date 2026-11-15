import { normalizeMapSeed, permuteMapNumber } from './map-seed.js';

const WIDTH = 900;
const HEIGHT = 340;
const mounted = new WeakMap();
let nextPlate = 0;

// The darkest inks are reserved for small edge details and the bottom of the print.
const PALETTES = {
  //           sky        horizon    distance   middle     field      bank       ink        accent     water
  meadow:   ['#f6efd6', '#f4e4b2', '#cbd1a0', '#a4b37e', '#ded6a3', '#8e9f6e', '#47664b', '#bd7048', '#bbcda4'],
  orchard:  ['#f9eddb', '#f7d9b8', '#d4c8a0', '#abb37f', '#e4d1a2', '#8c9d6c', '#4d6948', '#bd775a', '#b5c59e'],
  wetland:  ['#e7f0e4', '#e5e9cd', '#b7cdbe', '#95b3a1', '#d6d8a9', '#829f80', '#466d5f', '#a67d4f', '#adcfc2'],
  highland: ['#e1edf1', '#e9ebdc', '#bbcbd1', '#9bb3b8', '#d7d6b5', '#90a48f', '#506f69', '#a98060', '#afcdc7'],
  woodland: ['#eaf0df', '#e6e6c4', '#bacbb3', '#98b297', '#d0d4a4', '#829f7d', '#456953', '#a88350', '#b7c9ad'],
  coast:    ['#e4f0ed', '#eee8cf', '#bed0c5', '#9fb9ad', '#e9d2a3', '#849f92', '#4d7370', '#ad8359', '#a8ccc7'],
  canyon:   ['#faecd4', '#f6d6a9', '#dcbb9f', '#caa184', '#eacd9e', '#bc916b', '#8b624a', '#b4694b', '#c1c29c'],
  terrace:  ['#ebefda', '#efe7bc', '#bdcbaa', '#a3b98f', '#ddd39a', '#8fa372', '#547451', '#ac8542', '#c5d1a0'],
};

const MOODS = ['morning', 'clear', 'wind', 'mist', 'evening', 'after-rain'];

function mix(a, b, fraction) {
  const channel = i => {
    const first = parseInt(a.slice(i, i + 2), 16);
    const second = parseInt(b.slice(i, i + 2), 16);
    return Math.round(first + (second - first) * fraction).toString(16).padStart(2, '0');
  };
  return '#' + channel(1) + channel(3) + channel(5);
}

function palette(biome, mood) {
  let [sky, air, far, middle, field, bank, ink, accent, water] = PALETTES[biome];
  if (mood === 'evening') {
    sky = mix(sky, '#c8cada', 0.64);
    air = mix(air, '#f0d5bb', 0.52);
    far = mix(far, '#b8b1ba', 0.32);
  } else if (mood === 'morning') {
    sky = mix(sky, '#fae4cc', 0.48);
    air = mix(air, '#f2d6b0', 0.40);
  } else if (mood === 'after-rain') {
    sky = mix(sky, '#cddfe0', 0.62);
    far = mix(far, '#b4c5be', 0.25);
    water = mix(water, '#a9c9c8', 0.24);
  } else if (mood === 'mist') {
    far = mix(far, air, 0.32);
    middle = mix(middle, air, 0.16);
  }
  const cloud = mix('#fff9e7', sky, 0.23);
  const glint = mix(cloud, field, 0.37);
  const shade = mix(middle, bank, 0.57);
  const sun = mix('#e8bb60', accent, mood === 'morning' ? 0.49 : 0.22);
  return { sky, air, far, middle, field, bank, ink, accent, water, cloud, glint, shade, sun };
}

function randomRange(seed) {
  let state = permuteMapNumber(parseInt(seed, 16)) ^ 0x41c6ce57;
  return (min = 0, max = 1) => {
    state = (state + 0x6d2b79f5) | 0;
    let word = Math.imul(state ^ (state >>> 15), 1 | state);
    word ^= word + Math.imul(word ^ (word >>> 7), 61 | word);
    return min + (((word ^ (word >>> 14)) >>> 0) / 4294967296) * (max - min);
  };
}

const round = value => Math.round(value * 100) / 100;
const point = (x, y) => round(x) + ' ' + round(y);
const silhouette = (d, color) => `<path d="${d}" fill="${color}"/>`;
const line = (d, color, w = 1) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${round(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ellipse = (x, y, rx, ry, color) => `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(rx)}" ry="${round(ry)}" fill="${color}"/>`;
const group = (transform, contents) => `<g transform="${transform}">${contents}</g>`;
const stamp = (x, y, sx, sy, contents) => group(`translate(${point(x, y)}) scale(${point(sx, sy)})`, contents);
// Ambient motion is styled in landscape.css and never changes the geometry.
const moving = (name, slot, contents) => `<g class="hb-landscape__${name}" style="--slot:${slot}">${contents}</g>`;
const below = (ridge, color) => silhouette(ridge + ' L912 346 H-12Z', color);
const angular = points => 'M' + points.map(([x, y]) => point(x, y)).join(' L');

function curve(points) {
  let d = 'M' + point(...points[0]);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[i + 1];
    const e = points[Math.min(i + 2, points.length - 1)];
    d += ' C' + point(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6) +
      ' ' + point(c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6) + ' ' + point(...c);
  }
  return d;
}

function rolling(r, y, amplitude, count) {
  const points = [];
  for (let i = 0; i <= count; i++) {
    const x = i === 0 ? -12 : i === count ? 912 : i * WIDTH / count + r(-21, 21);
    points.push([x, y + r(-amplitude, amplitude)]);
  }
  return curve(points);
}

function skyMarks(r, p, mood, h, sunX, wind, biome) {
  let marks = '';
  let rainCloud;
  const count = { clear: 2, morning: 3, evening: 2, wind: 4, mist: 3, 'after-rain': 5 }[mood];
  for (let i = 0; i < count; i++) {
    const raining = mood === 'after-rain' && i === count - 1;
    const x = raining ? (sunX < WIDTH / 2 ? r(716, 834) : r(67, 182)) : i === 0 ? sunX + r(-47, 29) : r(15, 850);
    const y = raining ? h - r(42, 70) : i === 0 ? r(49, 94) : r(28, h - 35);
    if (raining) rainCloud = { x, y };
    const w = r(0.42, 1.28) * (mood === 'wind' || mood === 'mist' ? 1.4 : 1);
    const tall = r(0.55, 1.05) * (mood === 'after-rain' ? 1.35 : 1);
    const cloudInk = mood === 'after-rain' && (i % 2 || raining) ? mix(p.sky, p.far, 0.41) : p.cloud;
    const top = r() < 0.5
      ? 'M-59 4 Q-49 1 -39 1 Q-36 -4 -29 -3 Q-27 -9 -18 -8 Q-11 -15 2 -13 Q13 -13 16 -7 Q24 -10 32 -5 Q40 -6 43 -1 Q53 -1 61 3 Q26 4 6 3 Q-25 6 -59 4Z'
      : 'M-68 3 Q-42 -1 -22 0 Q-16 -6 -7 -5 Q0 -9 12 -8 Q22 -7 27 -4 Q44 -5 55 -1 L69 1 Q57 3 35 2 Q14 5 -6 3 Q-25 5 -68 3Z';
    marks += moving('cloud', i * wind, stamp(x, y, w * wind, tall, silhouette(top, cloudInk) +
      line('M-36 7 Q-20 6 -10 7 M7 7 Q24 5 37 6', mix(cloudInk, p.sky, 0.4), 0.85)));
  }
  if (mood === 'wind') {
    marks += stamp(sunX, h - r(43, 70), wind, 1,
      line('M-56 1 Q-37 -5 -17 -2 M-31 5 Q-12 1 1 3 M18 -4 Q31 -6 43 -5', mix(p.cloud, p.far, 0.34), 1));
  }
  if (rainCloud) {
    let rain = '';
    for (let i = 0; i < 9; i++) {
      const offset = r(-33, 29);
      const y = r(0, 6);
      rain += `M${point(offset, y)}l${point(-wind * r(9, 13), r(14, 21))}`;
    }
    marks += moving('rain', 0, stamp(rainCloud.x, rainCloud.y + 4, 1, 1, line(rain, mix(p.sky, p.far, 0.55), 0.85)));
  }
  if (biome === 'coast' || biome === 'wetland' || r() < 0.38) {
    const x = r() < 0.5 ? r(64, 235) : r(656, 826);
    const y = r(47, h - 56);
    const flock = biome === 'coast' ? Math.floor(r(3, 7)) : Math.floor(r(2, 5));
    let birds = '';
    for (let i = 0; i < flock; i++) {
      const size = r(0.48, 0.95);
      birds += stamp(x + i * r(10, 14), y + i * r(-3.5, 3), size * wind, size,
        silhouette('M-7 -2 Q-3 -3.4 0 -0.5 Q2.7 -3.6 7 -3 Q3 -2.3 0 1 Q-2.6 -1 -7 -2Z', mix(p.ink, p.sky, 0.37)));
    }
    marks += moving('flock', wind, birds);
  }
  return marks;
}

function celestial(r, p, mood, x, id) {
  const y = mood === 'morning' ? r(10, 21) : r(2, 14);
  const size = r(11, 15);
  let disk = '';
  if (mood === 'evening') {
    disk = silhouette('M9 -24 C-2 -18 -7 -3 0 10 Q5 20 17 22 C1 28 -18 20 -23 5 C-28 -10 -16 -26 0 -27 Q5 -27 9 -24Z', p.cloud);
    disk += silhouette('M28 -15 l0.9 3.8 3.3 0.9 -3.3 0.8 -0.9 3.5 -0.8 -3.5 -3.4 -0.8 3.4 -0.9Z', p.cloud);
  } else {
    const sun = mood === 'mist' || mood === 'after-rain' ? mix(p.sun, p.cloud, 0.48) : p.sun;
    disk = `<circle class="hb-landscape__glow" r="74" fill="url(#${id}-glow)"/>` + ellipse(0, 0, 23, 23, sun);
    for (const level of [9, 13.8, 18.2]) {
      const chord = Math.sqrt(23 ** 2 - level ** 2);
      disk += line('M' + point(-chord, level) + ' Q' + point(-chord * 0.2, level - 0.35) + ' ' +
        point(chord * r(0.35, 0.82), level), mix(sun, p.air, 0.65), r(0.65, 1.1));
    }
  }
  // Its own viewport keeps the sun circular on a narrow, unzoomed board.
  const halo = mood === 'evening' ? p.cloud : mix(p.sun, '#fff3c4', 0.55);
  const glow = `<defs><radialGradient id="${id}-glow"><stop offset=".28" stop-color="${halo}" stop-opacity=".5"/><stop offset=".55" stop-color="${halo}" stop-opacity=".17"/><stop offset="1" stop-color="${halo}" stop-opacity="0"/></radialGradient></defs>`;
  if (mood === 'evening') disk = `<circle class="hb-landscape__glow" r="74" fill="url(#${id}-glow)" opacity=".7"/>` + disk;
  return `<svg x="${round(x / 9 - size / 2)}%" y="${round(y)}%" width="${round(size)}%" height="24%" viewBox="-34 -34 68 68" preserveAspectRatio="xMidYMid meet" overflow="visible">${glow}${disk}</svg>`;
}

function deciduous(x, y, scale, main, detail, fruit) {
  let crown = silhouette('M-2 0 L-1.6 -6 C-7 -5 -10 -8 -9 -11 Q-12 -15 -8 -18 Q-8 -22 -4 -23 Q-1 -27 3 -24 Q8 -26 10 -21 Q14 -19 12 -15 Q15 -10 9 -8 Q6 -5 2 -6 L2 0Z', main);
  if (detail) {
    crown += line('M-7 -16 Q-5 -20 -2 -19 M-1 -21 Q1 -23 3 -21 M4 -17 Q7 -20 9 -17 M0 -9 Q2 -11 4 -11', detail, 0.8);
  }
  if (fruit) crown += ellipse(-5, -14, 1.6, 1.7, fruit) + ellipse(5.8, -11, 1.4, 1.5, fruit);
  return stamp(x, y, scale, scale, crown);
}

function evergreen(x, y, width, height, main, detail) {
  let tree = silhouette('M-1 0 l0.2 -6 -8 0.1 4.8 -6.3 -4 0.5 4.7 -6.8 -3.1 0.7 4.1 -7.2 -2.4 0.6 4.9 -11.1 4.3 11.2 -2.1 -0.5 3.6 7 -2.5 -0.7 4.3 6.5 -3.4 -0.8 4.7 7.1 -8.2 -0.5 0.5 6Z', main);
  if (detail) {
    tree += silhouette('M0 -32 Q-0.7 -25 -3 -20 l2.9 -1.2 -4.4 7 3.6 -1.5 -5 7.8 5.7 -2.6 -2.5 4.4 4 -1.7 -1.7 3.5 1.8 -0.5Z', detail);
    tree += line('M2 -21 l1.2 2.4 M2.2 -16 l2.6 3 M2 -10 l3 2', detail, 0.47);
  }
  return stamp(x, y, width / 18, height / 36, tree);
}

function cottage(x, y, scale, p) {
  const walls = silhouette('M-13 0 v-6 l7 -7 9 2 7 5 v6Z', p.glint) +
    silhouette('M-1 -6 l12 .4 v5.6 H-1Z', mix(p.glint, p.bank, 0.35));
  const roof = silhouette('M-16 -6 l9 -9 11 1 10 8 -15 -1 -5 -5 -6 6Z', mix(p.shade, p.ink, 0.45));
  const detail = silhouette('M7 -12 v-5 h2.4 v7ZM-9 0 v-4 h2.5 v4ZM2 -4 v-2.3 h2.5 v2.3Z', p.ink);
  return stamp(x, y, scale, scale, walls + roof + detail);
}

function grass(r, x, y, w, h, ink, wind) {
  let leaves = '';
  for (let i = 0; i < 11; i++) {
    const foot = r(-w * 0.42, w * 0.42);
    const tip = foot + r(-w * 0.72, w * 0.72) + wind * w * 0.14;
    const tall = r(h * 0.24, h);
    leaves += `M${point(foot - 1.2, 0)}Q${point(foot - 1, -tall * 0.52)} ${point(tip, -tall)}Q${point(foot + 2.2, -tall * 0.37)} ${point(foot + 2, 0)}Z`;
  }
  return moving('sway', Math.round(x) % 7, stamp(x, y, 1, 1, silhouette(leaves, ink)));
}

function reeds(r, x, y, scale, p, wind) {
  let cluster = grass(r, 0, 0, 17, 25, p.bank, wind);
  for (let i = 0; i < 3; i++) {
    const root = r(-8, 7);
    const top = root + wind * r(1, 7);
    const height = r(21, 37);
    cluster += line('M' + point(root, 0) + ' Q' + point(root, -height * 0.68) + ' ' + point(top, -height), p.ink, 1.1);
    cluster += line('M' + point(top - wind * 0.8, -height + 3) + ' l' + point(wind * 1.8, -6.8), p.accent, 2.9);
  }
  return stamp(x, y, scale, scale, cluster);
}

function ripples(r, x, y, width, depth, count, color) {
  let hatching = '';
  for (let i = 0; i < count; i++) {
    const left = x + r(0, width);
    const top = y + r(0, depth);
    const length = r(5, 30);
    hatching += `M${point(left, top)}q${point(length * 0.42, -1.2)} ${point(length, -0.2)}q${point(-length * 0.42, 0.8)} ${point(-length, 0.2)}Z`;
  }
  return silhouette(hatching, color);
}

// A handful of alternating relief cuts describe the face of a rock or a bank.
function gouges(r, x, y, count, length, spacing, angle, color) {
  let cuts = '';
  for (let i = 0; i < count; i++) {
    const start = r(-2, 3);
    const top = i * spacing;
    const w = length * r(0.55, 1.22);
    const rise = r(-1.3, 0.7);
    cuts += `M${point(start, top)}q${point(w * 0.45, rise - 0.8)} ${point(w, rise)}q${point(-w * 0.42, 1.4)} ${point(-w, -rise)}Z`;
  }
  return group(`translate(${point(x, y)}) rotate(${round(angle)})`, silhouette(cuts, color));
}

function edgeGround(r, p, lift = 0) {
  const ridge = curve([[-12, 292 - lift], [43, r(298, 306) - lift / 2], [136, r(315, 323)],
    [306, r(327, 333)], [541, r(326, 333)], [738, r(318, 324)], [851, r(308, 315)], [912, 298]]);
  const shelf = curve([[-12, 312], [67, r(318, 323)], [213, 335], [418, 339],
    [670, 333], [799, r(323, 329)], [912, 317]]);
  let turf = below(ridge, mix(p.field, p.bank, 0.48)) + below(shelf, mix(p.bank, p.field, 0.12));
  for (let i = 0; i < 9; i++) {
    const x = i < 5 ? r(-12, 103) : r(775, 908);
    const y = i < 5 ? 311 + x * 0.14 : 314 + (900 - x) * 0.12;
    turf += gouges(r, x, y, 4, r(6, 16), r(1.8, 2.8), i < 5 ? r(4, 12) : r(-10, -2), mix(p.bank, p.field, 0.73));
  }
  return turf + ripples(r, -12, 329, 900, 9, 36, mix(p.field, p.bank, 0.48));
}

function poppy(r, x, y, scale, p, wind) {
  const h = r(17, 28);
  const bend = wind * r(2, 6);
  const stalk = line(`M0 0 Q${point(-bend, -h * 0.55)} ${point(bend, -h)}`, p.ink, 1.3);
  const leaf = silhouette('M0 -4 Q-7 -5 -8 -11 Q-2 -9 0 -4Z M0 -8 Q2 -15 7 -15 Q5 -10 0 -8Z', p.ink);
  const cup = silhouette('M-5.8 -3 Q-4.8 -5 -3 -3.6 Q-2 -6 0 -4 Q2 -5.8 3 -3.9 Q5 -6 6 -4 Q5 0.4 0 1.2 Q-4.7 1 -5.8 -3Z', p.accent);
  return moving('sway', Math.round(x + 3) % 7, stamp(x, y, scale, scale, stalk + leaf + stamp(bend, -h, 1, 1, cup)));
}

function meadow(r, p, h, wind) {
  let land = below(rolling(r, h + 4, 18, 6), p.far);
  const banks = curve([[-12, h + 21], [133, h + r(17, 26)], [283, h + 47],
    [450, h + 33], [617, h + 45], [769, h + 14], [912, h + 28]]);
  land += below(banks, p.middle);
  const copse = r(30, 67);
  for (let i = 0; i < 13; i++) {
    land += deciduous(copse + i * r(5.8, 7.8), h + r(24, 30), r(0.35, 0.74), mix(p.middle, p.bank, 0.39));
  }
  const swale = curve([[-12, h + 36], [104, h + 45], [267, h + 58], [482, h + 52],
    [660, h + 35], [774, h + 41], [912, h + 57]]);
  land += below(swale, p.field);
  const vanish = r(487, 673);
  for (let i = 0; i < 8; i++) {
    const x = i * 152 - 96 + r(-17, 16);
    const e = vanish + (x - vanish) * 0.28;
    const d = `M${point(x, 345)} Q${point((x + e) / 2 - 21, h + 61)} ${point(e, h + 54)} Q${point((x + e) / 2 - 11, h + 67)} ${point(x + 13, 345)}Z`;
    land += silhouette(d, mix(p.field, p.bank, 0.25));
  }
  if (r() < 0.59) {
    const hay = mix(p.field, p.sun, 0.41);
    for (let i = 0; i < 3; i++) {
      const x = 34 + i * r(23, 32);
      const y = h + 54 + i * r(-1, 2);
      const s = r(0.68, 1.15);
      land += stamp(x, y, s, s, silhouette('M-8 1 Q-5.8 -2.8 -5 -5 Q-2 -9 2 -8 Q6 -7 7 -2 L9 1 Q1 3 -8 1Z', hay) +
        line('M-4 -2 q1 -3 3 -4 M-1 -2 q1 -3 2 -4 M2 0 q2 -2 2 -4', mix(hay, p.bank, 0.58), 0.72));
    }
  }
  land += edgeGround(r, p);
  for (const x of [-2, 11, 29, 40, 842, 865, 887, 906]) {
    const y = x < 90 ? 297 + x * 0.2 : 302 + (900 - x) * 0.16;
    land += grass(r, x, y + 4, r(11, 22), r(13, 26), mix(p.bank, p.ink, 0.46), wind);
    if (r() > 0.28) land += poppy(r, x + r(-4, 3), y + 1, r(0.8, 1.23), p, wind);
  }
  return land;
}

function orchard(r, p, h, wind) {
  let land = below(rolling(r, h - 1, 14, 7), p.far);
  const treeLine = mix(p.far, p.middle, 0.65);
  const rowStart = r(-16, 38);
  for (let i = 0; i < 14; i++) {
    const x = rowStart + i * 14 + r(-2, 2);
    land += deciduous(x, h + 13 + Math.sin(x / 97) * 5, r(0.38, 0.62), treeLine);
  }
  const orchardSlope = curve([[-12, h + 9], [105, h + 19], [244, h + 30], [405, h + 25],
    [541, h + 34], [740, h + 8], [912, h + 16]]);
  land += below(orchardSlope, mix(p.middle, p.field, 0.28));
  const houseX = r(76, 113);
  land += cottage(houseX, h + 28, r(0.77, 1.08), p);
  const furrows = curve([[-12, h + 49], [176, h + 39], [352, h + 58], [592, h + 44],
    [752, h + 32], [912, h + 43]]);
  land += below(furrows, p.field);
  for (let row = 0; row < 3; row++) {
    const count = 7 - row;
    const first = 729 - row * 21;
    const y0 = h + 41 + row * 14;
    const bed = `M${point(first - 12, y0 + 1)} Q${point(first + 30, y0 + 9)} ${point(first + 82, y0 + 4)} T${point(918, y0 + 2)} Q${point(first + 129, y0 + 6)} ${point(first + 70, y0 + 7)} T${point(first - 12, y0 + 1)}Z`;
    land += silhouette(bed, mix(p.field, p.bank, 0.31));
    for (let i = 0; i < count; i++) {
      const x = 729 + i * (19 + row * 5) - row * 21 + r(-2.5, 2.5);
      const y = h + 41 + row * 14 + Math.sin((x - 700) / 57) * 4;
      const s = r(0.51, 0.67) + row * 0.12;
      const color = row === 0 ? mix(p.field, p.middle, 0.74) : mix(p.bank, p.middle, 0.35);
      land += ellipse(x + 2, y, s * 11, s * 1.7, mix(p.field, p.bank, 0.39));
      land += deciduous(x, y, s, color, row === 2 ? p.middle : null);
    }
  }
  for (let i = 0; i < 4; i++) {
    const y = h + 56 + i * 13;
    land += line(`M-5 ${round(y)}Q116 ${round(y - i * 3)} 260 ${round(h + 45 + i * 3)}`, mix(p.field, p.bank, 0.31), 1.1 + i * 0.15);
  }
  land += edgeGround(r, p, 4);
  land += deciduous(r(-4, 6), 296, r(1.9, 2.5), p.bank, p.glint, p.accent);
  land += deciduous(r(21, 39), 300, r(1.23, 1.7), mix(p.bank, p.ink, 0.23), p.middle, p.accent);
  land += grass(r, 27, 304, 35, 13, mix(p.ink, p.bank, 0.52), wind);
  return land;
}

function heron(x, y, scale, p) {
  const ink = mix(p.ink, p.middle, 0.22);
  const bird = line('M-2 -5 L-2 0 l-5 1 M2 -5 L3 -1 l5 1', ink, 0.85) +
    silhouette('M-12 -8 Q-5 -14 1 -12 Q6 -11 4 -16 C1 -21 4 -26 9 -25 L16 -23.2 l-7 -0.4 Q6 -23.5 6 -21 C6 -18 10 -13 6 -9 Q4 -4 -1 -5 Q-4 -7 -12 -7Z', ink) +
    line('M-6 -9 Q-1 -12 2 -10', p.middle, 0.75);
  return stamp(x, y, scale, scale, bird);
}

function wetland(r, p, h, wind) {
  let land = below(rolling(r, h + 4, 5, 8), p.far);
  const islands = curve([[-12, h + 5], [70, h + 12], [126, h + 9], [195, h + 21],
    [302, h + 23], [362, h + 28], [630, h + 27], [741, h + 12], [830, h + 17], [912, h + 8]]);
  land += below(islands, p.middle);
  for (let i = 0; i < 13; i++) {
    const x = i < 7 ? r(-6, 91) : r(758, 917);
    land += grass(r, x, h + 19, r(8, 16), r(5, 15), p.middle, wind);
  }
  const waterline = curve([[-12, h + 24], [105, h + 27], [209, h + 24], [360, h + 30],
    [541, h + 27], [696, h + 26], [854, h + 28], [912, h + 25]]);
  land += below(waterline, p.water);
  land += ripples(r, -16, h + 32, 920, 66, 68, mix(p.water, p.glint, 0.54));
  const spit = `M-10 ${h + 39} Q41 ${h + 30} 91 ${h + 39} Q116 ${h + 43} 169 ${h + 44} Q130 ${h + 49} 98 ${h + 46} Q45 ${h + 47} -10 ${h + 51}Z`;
  land += silhouette(spit, mix(p.bank, p.field, 0.34));
  land += heron(r(75, 108), h + 43, r(0.72, 1.02), p);
  land += ripples(r, 4, h + 48, 145, 8, 15, mix(p.water, p.bank, 0.36));
  const mudflat = r(631, 754);
  const flatY = h + r(39, 52);
  land += stamp(mudflat, flatY, r(0.78, 1.27), 1, silhouette('M-30 1 Q-18 -0.7 -8 -0.4 Q0 -3.9 12 -2 Q23 -2.7 34 -0.7 Q47 0.5 62 1.5 Q41 3.3 19 2.3 Q0 3.7 -19 2.8Z', mix(p.bank, p.field, 0.35)) +
    grass(r, 12, -0.7, 17, 9, mix(p.bank, p.middle, 0.45), wind));
  for (let i = 0; i < 12; i++) {
    const x = i < 7 ? r(14, 124) : r(768, 891);
    const y = r(271, 305);
    const s = r(0.51, 1.3);
    land += stamp(x, y, s, s, silhouette('M10 0 C10 2.2 5 3.4 -1 3.2 C-7 3 -11 1.8 -10 -0.4 C-9 -2.7 1 -3.6 6 -2.1 L1 0Z', mix(p.water, p.bank, 0.72)));
  }
  land += edgeGround(r, p, 4);
  for (const x of [-4, 15, 37, 847, 874, 902]) {
    const y = x < 60 ? 292 + x * 0.27 : 302 + (899 - x) * 0.18;
    land += reeds(r, x, y + 3, r(0.77, 1.2), p, wind);
  }
  return land;
}

function mountainRange(r, h, p) {
  const tops = [[r(65, 126), h - r(80, 114)], [r(175, 243), h - r(46, 79)],
    [r(314, 386), h - r(22, 54)], [r(445, 529), h - r(17, 36)],
    [r(623, 710), h - r(36, 59)], [r(770, 849), h - r(56, 82)]];
  const cols = [[-12, h - r(10, 29)]];
  for (let i = 1; i < tops.length; i++) {
    cols.push([(tops[i - 1][0] + tops[i][0]) / 2 + r(-13, 13), Math.max(tops[i - 1][1], tops[i][1]) + r(11, 28)]);
  }
  cols.push([912, h - 6]);
  const skyline = [cols[0]];
  let faces = '';
  for (let i = 0; i < tops.length; i++) {
    const [x, y] = tops[i];
    const left = cols[i];
    const right = cols[i + 1];
    const shoulder = [x + (right[0] - x) * 0.54, y + (right[1] - y) * 0.63];
    const spur = [x + (left[0] - x) * 0.38, y + (left[1] - y) * r(0.29, 0.43)];
    skyline.push([x + (left[0] - x) * 0.72, y + (left[1] - y) * 0.78],
      [spur[0] - 3.7, spur[1] - 1.2], spur, [x - 4.5, y + 6], [x, y], shoulder,
      [shoulder[0] + (right[0] - shoulder[0]) * 0.46, shoulder[1] + (right[1] - shoulder[1]) * 0.39], right);
    faces += silhouette(angular([[x, y], shoulder, right, [x + (right[0] - x) * 0.72, h + 13],
      [x + (right[0] - x) * 0.16, y + (h - y) * 0.68], [x + (right[0] - x) * 0.24, y + (h - y) * 0.40]]) + 'Z', mix(p.far, p.middle, 0.64));
    if (y < h - 45) {
      const cap = Math.min(21, (left[1] - y) * 0.43, (right[1] - y) * 0.41);
      const a = x + (left[0] - x) * cap / (left[1] - y);
      const b = x + (shoulder[0] - x) * cap / (shoulder[1] - y);
      const snow = [[a, y + cap], [x, y], [b, y + cap], [x + (b - x) * 0.53, y + cap * 0.68],
        [x + 1, y + cap * 1.31], [x - (x - a) * 0.3, y + cap * 0.68], [a + 2, y + cap * 1.14]];
      faces += silhouette(angular(snow) + 'Z', mix(p.cloud, p.sky, 0.2));
      faces += gouges(r, x + (right[0] - x) * 0.31, y + (h - y) * 0.62, 4, r(9, 16), 2.1, 49, mix(p.middle, p.far, 0.54));
    }
    faces += gouges(r, x - (x - left[0]) * 0.55, y + (h - y) * 0.76, 4, r(7, 14), 2.2, -42, mix(p.far, p.sky, 0.32));
  }
  return below(angular(skyline), p.far) + faces;
}

function highland(r, p, h, wind) {
  let land = mountainRange(r, h, p);
  const moor = curve([[-12, h - 23], [70, h - 14], [156, h + 17], [288, h + 26],
    [405, h + 15], [575, h + 24], [705, h + 3], [824, h - 6], [912, h - 14]]);
  land += below(moor, p.middle);
  const loch = curve([[-12, h + 35], [159, h + 45], [321, h + 36], [620, h + 39], [797, h + 31], [912, h + 32]]);
  land += below(loch, p.water);
  land += ripples(r, 27, h + 46, 854, 51, 40, mix(p.water, p.glint, 0.62));
  const slope = curve([[-12, h + 5], [81, h + 24], [150, h + 53], [302, h + 75],
    [470, h + 78], [626, h + 68], [792, h + 51], [912, h + 31]]);
  land += below(slope, p.field);
  for (let i = 0; i < 12; i++) {
    const x = -6 + i * 9 + r(-3, 3);
    land += evergreen(x, h + 9 + x * 0.28, r(4, 8), r(9, 20), mix(p.bank, p.middle, 0.51));
  }
  land += edgeGround(r, p, 5);
  for (let i = 0; i < 8; i++) {
    const x = i < 5 ? r(-14, 70) : r(833, 912);
    const base = x < 90 ? 295 + x * 0.25 : 302 + (900 - x) * 0.17;
    const s = r(0.55, 1.25);
    land += stamp(x, base, s, s, silhouette('M-15 0 l5 -6 8 -4 9 2 6 7 -7 2 -14 -0.5Z', p.bank) +
      silhouette('M-10 -6 l8 -4 8 2 -9 2 -4 3Z', p.field));
    if (i % 3 === 0) land += grass(r, x, base + 3, 13, 13, mix(p.bank, p.ink, 0.42), wind);
  }
  return land;
}

function forestBelt(r, y, height, swell, color) {
  const phase = r(0, 6);
  let x = -16;
  let ridge = 'M-16 ' + round(y);
  while (x < 912) {
    const step = r(3.5, 8.8);
    const base = y + Math.sin(phase + x / 104) * swell + Math.sin(x / 47) * swell * 0.29;
    const top = base - r(height * 0.34, height);
    ridge += ' L' + point(x, base - 1) + ' ' + point(x + step * 0.28, top + (base - top) * 0.43) +
      ' ' + point(x + step * 0.16, top + (base - top) * 0.48) + ' ' + point(x + step * 0.49, top) +
      ' ' + point(x + step * 0.89, top + (base - top) * 0.63) + ' ' + point(x + step * 0.73, top + (base - top) * 0.58) +
      ' ' + point(x + step, base);
    x += step;
  }
  return below(ridge, color);
}

function woodland(r, p, h, wind) {
  let land = below(rolling(r, h - 14, 17, 7), mix(p.far, p.air, 0.26));
  land += forestBelt(r, h + 10, 12, 13, p.far);
  const fog = curve([[-12, h + 11], [115, h + 5], [283, h + 17], [472, h + 17],
    [670, h + 5], [765, h + 13], [912, h + 10]]);
  land += below(fog, mix(p.far, p.air, 0.52));
  land += forestBelt(r, h + 44, 22, 14, p.middle);
  const clearing = curve([[-12, h + 28], [74, h + 40], [199, h + 55], [362, h + 66],
    [569, h + 55], [726, h + 53], [840, h + 37], [912, h + 32]]);
  land += below(clearing, mix(p.field, p.middle, 0.16));
  const clearingLight = mix(p.field, p.glint, 0.39);
  land += gouges(r, 71, h + 55, 5, 32, 2.5, 5, clearingLight) +
    gouges(r, 684, h + 66, 6, 21, 2.2, -5, clearingLight);
  for (let i = 0; i < 9; i++) {
    const x = 750 + i * 21 + r(-7, 7);
    land += evergreen(x, h + 57 - (x - 750) * 0.095, r(6, 12), r(14, 27), mix(p.bank, p.middle, 0.51));
  }
  for (const x of [-8, 8, 35, 59, 82]) {
    const y = h + 65 + x * 0.21;
    const tall = r(41, 74) - x * 0.23;
    land += evergreen(x + r(-4, 4), y, tall * r(0.34, 0.48), tall, p.bank, mix(p.bank, p.middle, 0.53));
  }
  land += edgeGround(r, p, 5);
  land += evergreen(r(-9, 1), 302, 38, r(80, 103), mix(p.ink, p.bank, 0.34), p.bank);
  for (const x of [9, 28, 50, 850, 876, 897]) {
    const y = x < 90 ? 294 + x * 0.3 : 304 + (900 - x) * 0.15;
    land += grass(r, x, y + 5, 18, 13, mix(p.bank, p.ink, 0.35), wind);
  }
  return land;
}

function seaStack(x, y, w, h, main, face, highlight) {
  const rock = silhouette('M0 0 l8 -8 7 -3 4 -19 6 -3 6 -13 10 -2 7 5 6 0 3 20 10 9 3 7 9 5 -30 2Z', main) +
    silhouette('M40 -47 l8 4 6 0 3 20 10 9 3 7 9 5 -30 1 2 -7 -6 -10 1 -15Z', face) +
    line('M25 -32 l7 -3 5 0 M21 -24 l9 -3 M16 -11 l10 -4', highlight, 1);
  return stamp(x, y, w / 80, h / 49, rock);
}

function lighthouse(x, y, scale, p) {
  const tower = silhouette('M-5 0 l2.2 -16 h5.2 L5 0Z', mix(p.glint, p.field, 0.3)) +
    silhouette('M0 -16 h2.4 L5 0 H1.4Z', mix(p.glint, p.bank, 0.61)) +
    line('M-4.8 0 l2.1 -16', mix(p.shade, p.ink, 0.48), 0.85) +
    silhouette('M-3.8 -16 v-1.7 h7.8 v1.7ZM-3 -17.6 v-4.7 l3.1 -2.7 3.2 2.7 v4.7ZM-4 -5.2 l0.45 -3.2 h7.1 l0.55 3.2Z', mix(p.shade, p.ink, 0.48)) +
    line('M-1.3 -20 v1.7 M1 -20 v1.7', p.cloud, 0.9);
  return stamp(x, y, scale, scale, tower);
}

function coast(r, p, h, wind) {
  const horizon = h + r(5, 12);
  let land = below(rolling(r, h + 6, 2.8, 6), p.far);
  land += below(`M-12 ${round(horizon)}Q254 ${round(horizon - 1.4)} 468 ${round(horizon)}T912 ${round(horizon)}`, p.water);
  const promontory = [[-12, h - 37], [24, h - 33], [45, h - 27], [77, h - 26],
    [91, h - 24], [108, h - 26], [145, h - 20], [150, h - 11], [161, h - 9], [165, h - 2],
    [190, h + 2], [209, h + 9], [240, h + 11], [241, h + 14], [172, h + 14], [131, h + 16], [-12, h + 18]];
  land += silhouette(angular(promontory) + 'Z', p.middle);
  land += silhouette(angular([[44, h - 26], [79, h - 22], [92, h - 15], [126, h - 15],
    [145, h - 20], [149, h - 11], [164, h - 7], [163, h], [195, h + 8], [104, h + 9], [93, h - 4], [58, h - 10]]) + 'Z', mix(p.middle, p.bank, 0.42));
  land += r() < 0.78 ? lighthouse(r(80, 96), h - 23, r(0.83, 1.08), p) : cottage(90, h - 23, 0.76, p);
  land += gouges(r, 140, h - 7, 5, 20, 1.7, 3, mix(p.middle, p.glint, 0.42)) +
    gouges(r, 34, h - 14, 6, 19, 2.1, 12, mix(p.middle, p.glint, 0.4));
  land += ripples(r, -9, horizon + 9, 911, 72, 51, mix(p.water, p.cloud, 0.55));
  const stackX = r(681, 759);
  land += seaStack(stackX + 56, h + 27, r(22, 34), r(12, 21), p.middle, p.bank, p.glint);
  land += seaStack(stackX, h + 33, r(45, 63), r(28, 44), p.middle, p.bank, p.glint);
  land += ripples(r, stackX - 8, h + 34, 99, 6, 9, mix(p.water, p.middle, 0.79));
  const beach = curve([[-12, h + 51], [88, h + 60], [194, h + 73], [335, h + 75], [514, h + 70],
    [669, h + 57], [825, h + 61], [912, h + 49]]);
  land += below(beach, p.field);
  land += line(beach, p.cloud, 2.5);
  land += group('translate(0 -4)', line(beach, mix(p.cloud, p.water, 0.28), 1));
  land += edgeGround(r, p);
  for (const x of [-3, 19, 46, 846, 873, 896]) {
    const y = x < 60 ? 296 + x * 0.3 : 301 + (900 - x) * 0.19;
    land += grass(r, x, y + 4, r(10, 25), r(14, 31), mix(p.bank, p.ink, 0.32), wind);
  }
  return land;
}

function mesa(x, y, w, h, main, shade, lithology, split) {
  const crest = split
    ? 'M0 0 l11 -6 7 -9 6 -3 4 -22 9 -1 2 -9 9 0 2 5 3 0 1 -4 8 1 1 12 8 2 4 18 6 4 5 7 14 5Z'
    : 'M0 0 l9 -6 10 -5 8 -16 5 -2 2 -15 15 -1 5 -4 17 1 2 7 7 0 2 17 6 3 4 13 8 8Z';
  const flank = split
    ? 'M48 -50 l2 5 3 0 1 -4 8 1 1 12 8 2 4 18 6 4 5 7 14 5 -32 0 -4 -6 -2 -6 -7 -7 -2 -14 -3 -2Z'
    : 'M70 -48 l2 7 8 0 2 17 6 3 4 13 8 8 -28 0 -9 -9 1 -8 -7 -6 1 -14Z';
  const strata = split ? 'M29 -33 l13 -1 M27 -28 l18 -1 M22 -16 l18 0 10 -2 M17 -10 l12 0' :
    'M35 -37 l24 -1 M33 -32 l15 0 M28 -24 l21 -1 M27 -20 l12 0 M21 -11 l22 -1 5 -2';
  return stamp(x, y, w / 100, h / 50, silhouette(crest, main) + silhouette(flank, shade) + line(strata, lithology, 0.85));
}

function pricklyPear(x, y, scale, p) {
  const pad = silhouette('M-1 0 Q-4 -1 -4 -6 C-8 -8 -11 -14 -8 -17 C-6 -19 -2 -15 -3 -11 Q-2 -9 -1 -9 C-3 -17 -2 -25 1 -26 C5 -27 7 -21 5 -16 C8 -21 13 -20 13 -16 Q13 -11 7 -9 Q6 -3 3 0Z', p.ink);
  const marks = line('M0 -21 l0.6 2 M2 -15 l0.7 1.8 M8.3 -14 l0.6 1.1 M-6.5 -13 l0.6 1.5', p.bank, 0.9);
  return stamp(x, y, scale, scale, pad + marks);
}

function canyon(r, p, h, wind) {
  const ridge = angular([[-12, h - 18], [58, h - 29], [94, h - 29], [103, h - 39],
    [157, h - 37], [174, h - 20], [254, h - 7], [296, h - 21], [323, h - 21],
    [337, h - 31], [385, h - 30], [400, h - 13], [482, h - 6], [584, h - 17],
    [604, h - 31], [649, h - 31], [662, h - 13], [720, h - 18], [754, h - 31], [846, h - 29], [912, h - 15]]);
  let land = below(ridge, mix(p.far, p.air, 0.29));
  const x = r(5, 67);
  land += mesa(x, h + 29, r(133, 189), r(67, 97), p.middle, mix(p.middle, p.ink, 0.32), mix(p.far, p.field, 0.35), r() < 0.35);
  land += mesa(x + r(124, 175), h + 30, r(72, 99), r(49, 69), mix(p.middle, p.far, 0.28), p.middle, p.far, true);
  land += mesa(r(668, 750), h + 18, r(90, 152), r(36, 58), p.far, mix(p.far, p.middle, 0.54), mix(p.air, p.far, 0.56), true);
  const basin = curve([[-12, h + 4], [96, h + 18], [181, h + 28], [283, h + 32],
    [454, h + 27], [596, h + 34], [773, h + 22], [912, h + 20]]);
  land += below(basin, p.field);
  const arroyo = `M574 ${h + 30} Q484 ${h + 39} 514 ${h + 47} T475 ${h + 70} Q421 ${h + 82} 392 344 H329 Q353 ${h + 86} 438 ${h + 70} Q512 ${h + 55} 492 ${h + 48} Q458 ${h + 36} 574 ${h + 30}Z`;
  land += silhouette(arroyo, mix(p.field, p.glint, 0.61));
  land += gouges(r, 734, h + 43, 6, 29, 2.1, -6, mix(p.field, p.bank, 0.49));
  for (let i = 0; i < 4; i++) {
    const dy = i * 4;
    land += line(`M-8 ${h + 23 + dy} Q51 ${h + 26 + dy} 80 ${h + 37 + dy} T183 ${h + 49 + dy}`, mix(p.field, p.bank, 0.42), 0.8 + i * 0.08);
  }
  land += edgeGround(r, p, 1);
  land += pricklyPear(13, 300, r(0.88, 1.25), p) + pricklyPear(r(25, 38), 305, r(0.45, 0.75), p);
  for (const x2 of [-6, 45, 853, 878, 903]) {
    const y2 = x2 < 90 ? 298 + x2 * 0.25 : 302 + (900 - x2) * 0.17;
    land += grass(r, x2, y2 + 5, r(9, 18), r(9, 18), mix(p.bank, p.ink, 0.48), wind);
  }
  return land;
}

function terrace(r, p, h, wind) {
  let land = below(rolling(r, h - 11, 25, 7), p.far);
  const upland = curve([[-12, h - 26], [93, h - 20], [181, h - 4], [319, h + 7],
    [475, h + 6], [644, h - 12], [785, h - 7], [912, h - 17]]);
  land += below(upland, p.middle);
  const hutX = r(73, 98);
  land += cottage(hutX, h - 17, r(0.7, 0.9), p);
  for (let i = 0; i < 7; i++) {
    const x = hutX + 18 + i * 6 + r(-2, 2);
    land += evergreen(x, h - 15 + i * 1.2, r(3.5, 5.5), r(10, 18), mix(p.middle, p.bank, 0.68));
  }
  const turn = r(120, 180);
  const fields = [p.field, p.water, mix(p.field, p.bank, 0.21), mix(p.water, p.glint, 0.25), p.field, p.water, p.field, p.water];
  let y = h - 8;
  for (let i = 0; i < fields.length; i++) {
    y += 5 + i * 1.8;
    const sway = i * 7;
    const steps = curve([[-12, y - 6], [turn - 53 + sway, y - 2], [turn + sway, y + 4],
      [turn + 37 + sway, y + 12 + i * 1.4], [310 + sway, y + 17 + i * 1.1],
      [416 + sway, y + 10], [533 + sway, y - 1 - i], [659 + sway, y + 1],
      [727 + sway, y + 8], [828 + sway * 0.45, y + 4 + i], [912, y - 3]]);
    land += below(steps, fields[i]);
    land += line(steps, mix(p.bank, p.field, 0.30), 1.1 + i * 0.27);
    land += group(`translate(0 ${round(1.5 + i * 0.35)})`, line(steps, mix(p.glint, fields[i], 0.36), 0.85 + i * 0.12));
    if (i === 1 || i === 4 || i === 6) {
      const left = i === 4 ? 690 : -8;
      const vines = [];
      for (let j = 0; j < 16; j++) {
        const vx = left + (7 + i * 0.52) * j;
        const vy = i === 4 ? y + 4 + Math.max(0, 8 - Math.abs(vx - 765) * 0.09) : y - 5 + (vx + 12) * 0.043;
        const s = 0.5 + i * 0.095;
        vines.push(stamp(vx, vy, s, s, silhouette('M-2.8 0 l0.4 -2.3 1.4 -0.4 0.6 -1.8 2 0.6 1.4 -0.7 1.5 2 -0.6 2.5 -2.6 -0.3 -0.5 1.6 -1.1 -0.1 -0.3 -1.4Z', mix(p.bank, p.middle, 0.5))));
      }
      land += vines.join('');
    }
  }
  land += edgeGround(r, p);
  for (const x of [-3, 15, 42, 856, 878, 901]) {
    const y2 = x < 60 ? 296 + x * 0.3 : 303 + (900 - x) * 0.16;
    land += grass(r, x, y2 + 4, r(10, 15), r(12, 21), mix(p.bank, p.ink, 0.43), wind);
  }
  return land;
}

const terrains = { meadow, orchard, wetland, highland, woodland, coast, canyon, terrace };

function fitPlate(contents) {
  return `<svg width="100%" height="100%" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">${contents}</svg>`;
}

/** Paint one decorative background; the next call for the same board is a no-op. */
export function renderLandscape(container, world, seed) {
  if (!container) return;
  const biome = Object.hasOwn(terrains, world?.biome) ? world.biome : 'meadow';
  const mapSeed = normalizeMapSeed(seed) ?? normalizeMapSeed(world?.mapSeed) ?? 'A35D7E';
  const focus = Number.isFinite(world?.focus) ? Math.min(1, Math.max(0, world.focus)) : 0.5;
  const horizon = Number.isFinite(world?.horizon) ? Math.min(0.75, Math.max(0.35, world.horizon)) : 0.55;
  const wind = world?.wind < 0 ? -1 : 1;
  const key = [mapSeed, biome, focus, horizon, wind].join('|');
  const previous = mounted.get(container);
  if (previous?.key === key && previous.svg.parentNode === container) return;

  const r = randomRange(mapSeed);
  const mood = MOODS[Math.floor(r(0, MOODS.length))];
  const p = palette(biome, mood);
  const mirrored = focus < 0.43 || (focus < 0.57 && r() < 0.5);
  const h = Math.round(193 + (horizon - 0.55) * 92 + r(-10, 11));
  const sunX = mirrored ? r(682, 821) : r(76, 219);
  const id = previous?.id ?? 'hb-landscape-sky-' + ++nextPlate;
  const sky = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${p.sky}"/><stop offset=".78" stop-color="${p.air}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#${id})"/>`;
  const light = celestial(r, p, mood, sunX, id);
  const clouds = skyMarks(r, p, mood, h, sunX, wind, biome);
  let land = terrains[biome](r, p, h, mirrored ? -wind : wind);
  if (mirrored) land = group('translate(900 0) scale(-1 1)', land);
  const svg = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Every interpolated SVG value comes from a fixed ink, an internal ID, or numeric geometry.
  svg.innerHTML = sky + light + fitPlate(clouds + land);
  container.classList.add('hb-landscape');
  container.setAttribute('aria-hidden', 'true');
  container.dataset.biome = biome;
  container.dataset.weather = mood;
  container.replaceChildren(svg);
  mounted.set(container, { key, id, svg });
}
