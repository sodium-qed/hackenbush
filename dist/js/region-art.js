import { contourPath, findRegions } from './regions.js';

// Each material has an underpainting, a midtone and a lit edge. The branch
// drawn above it always retains its independent Blue, Red or Green ownership.
const materials = {
  petal:     { colors: ['#b9660e', '#f5b526', '#ffe473'], ink: '#ad6812', light: '#fff0a3', veins: true },
  lily:      { colors: ['#b85a77', '#efacb9', '#fff0e6'], ink: '#ac4c71', light: '#fff4ec', veins: true },
  seeds:     { colors: ['#4b2a20', '#6f4228', '#a26a33'], ink: '#321f1d', light: '#dba45b' },
  leaf:      { colors: ['#38734e', '#76a65b', '#b6d074'], ink: '#29583e', light: '#d7e88f', veins: true },
  pad:       { colors: ['#397b6a', '#67a989', '#a7cf91'], ink: '#377660', light: '#d8eeb0', veins: true },
  canopy:    { colors: ['#457451', '#7fa868', '#c2d48b'], grain: 'leaves' },
  evergreen: { colors: ['#386457', '#71947a', '#b3c68f'], grain: 'needles' },
  cone:      { colors: ['#775437', '#a37b52', '#ccac75'], grain: 'scales' },
  fruit:     { colors: ['#efae67', '#ce7952', '#a34c3b'] },
  cap:       { colors: ['#a04a3e', '#d57b55', '#edac77'], grain: 'spots' },
  reed:      { colors: ['#815232', '#ac774b', '#d7ac72'], grain: 'fibers' },
  succulent: { colors: ['#47866b', '#84b285', '#bdcc8e'], grain: 'fibers' },
  coral:     { colors: ['#bd6d61', '#df9985', '#f2bd9d'], grain: 'pores' },
  glass:     { colors: ['#77afa7', '#b4d6c9', '#def0d5'], grain: 'glass', opacity: 0.78 },
  sail:      { colors: ['#bea371', '#e0c999', '#f7e9ba'], grain: 'weave' },
  silk:      { colors: ['#9eb5b7', '#d4e5da', '#f2efd6'], grain: 'silk', opacity: 0.42 },
  water:     { colors: ['#548d93', '#90b9b1', '#ced9be'], grain: 'water' },
  stone:     { colors: ['#9d8d77', '#c2b397', '#e2cda7'], grain: 'stone' },
  timber:    { colors: ['#997456', '#bea182', '#daca9f'], grain: 'fibers' },
  trellis:   { colors: ['#9cb285', '#c2cda7', '#deddb6'], grain: 'weave', opacity: 0.45 },
  earth:     { colors: ['#937753', '#b79a72', '#d4b888'], grain: 'stone', opacity: 0.75 },
};

// Small, clipped marks distinguish paper, bark, foliage and glazing. They have
// no branch-colored strokes, joints, accessibility roles or hit targets.
const grains = {
  leaves: [31, 24, [
    ['M2 8Q5 3 8 4Q7 8 2 8ZM17 18Q19 13 22 13Q22 16 17 18Z', '#355c47', 0.40],
    ['M8 9Q11 5 15 6Q13 9 8 9ZM22 20Q26 16 29 17Q27 20 22 20Z', '#e8edab', 0.68],
  ]],
  needles: [23, 19, [['M4 13l3-8l-2 9Zm3-1l4-7l-3 8Zm8-6l5-6l-4 7Z', '#365e50', 0.4],
    ['M9 13l4-7l-3 8Zm8-5l4-4l-3 5Z', '#dce6b2', 0.65]]],
  scales: [12, 10, [['M0 2l3 1l3-2l-3 4Zm6 5l3 1l3-2l-3 4Z', '#624632', 0.65],
    ['M1 1l2 1l2-1l-2 2Z', '#ecd29c', 0.74]]],
  spots: [24, 20, [
    ['M3 6q1-3 4-2q2 1 1 2q-2 2-5 0Zm13 8q0-2 2-2q3 0 3 2q-3 2-5 0Z', '#ffdfaa', 0.79],
    ['M12 3l2-1l1 2l-2 1ZM5 16l2-1l1 1l-2 1Z', '#ffe8c2', 0.63],
  ]],
  fibers: [17, 24, [
    ['M5 4l.65-2l.2 8l-.9 4Zm6 10l.8-3l-.2 7l-.8 3Z', '#5e6144', 0.36],
    ['M7 5l.7-2l-.2 8l-.7 3Z', '#fff0bd', 0.63],
  ]],
  pores: [14, 18, [['M3 5l1-2l2 1l-1 2Zm7 8l1-1l1 1l-1 1Z', '#974e49', 0.49]]],
  glass: [54, 54, [['M-13 0h10l-26 54h-10ZM27 0h7L8 54H1ZM37 0h2L13 54h-2ZM81 0h7L62 54h-7Z', '#faffec', 0.64]]],
  weave: [12, 11, [['M2 2l4 1v.5l-4-.6Zm7 4l.6 4h-.5l-.7-4Z', '#715e44', 0.29]]],
  silk: [21, 20, [['M6 4l.5 1.4l1.7.4l-1.7.4L6 8l-.4-1.8L4 5.8l1.6-.4Z', '#fffbea', 0.84]]],
  water: [37, 19, [['M2 8q6-2 11-1q-5 1-11 1Zm18 5q5-1.5 10-1q-4.5 1.6-10 1Z', '#eef6da', 0.72]]],
  stone: [19, 17, [['M3 6l2-1l1 1l-2 1Zm11 7l1-1l1.5 1l-2 1Z', '#655c51', 0.42], ['M6 8l3-1v.7l-2.5.8Z', '#f9e6c1', 0.7]]],
};

const round = value => Math.round(value * 100) / 100;
const xy = p => `${round(p.x)},${round(p.y)}`;
const url = id => `url(#${id})`;

function descriptors(region, degrees) {
  const points = [], diskPoints = [];
  let base = region.boundary[0].from;
  for (const { edge, from, to } of region.boundary) {
    if (degrees.get(from.id) > degrees.get(base.id) ||
        (degrees.get(from.id) === degrees.get(base.id) && from.y > base.y)) base = from;
    const c = edge.control;
    for (let i = 0; i < (c ? 8 : 1); i++) {
      const t = i / 8, s = 1 - t;
      const point = c ? { x: s*s*from.x + 2*s*t*c.x + t*t*to.x, y: s*s*from.y + 2*s*t*c.y + t*t*to.y } : from;
      points.push(point);
    }
    if (edge.part === 'flower center') diskPoints.push(c ? {
      x: (from.x + 2*c.x + to.x) / 4, y: (from.y + 2*c.y + to.y) / 4,
    } : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  }
  if (region.material === 'petal' && diskPoints.length) {
    base = { x: diskPoints.reduce((sum, p) => sum + p.x, 0) / diskPoints.length,
      y: diskPoints.reduce((sum, p) => sum + p.y, 0) / diskPoints.length };
  }
  const farthest = (best, p) => (p.x-base.x)**2 + (p.y-base.y)**2 > (best.x-base.x)**2 + (best.y-base.y)**2 ? p : best;
  const tip = points.reduce(farthest, base);
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const width = Math.max(1, right-left), height = Math.max(1, bottom-top);
  const center = { x: (right + left)/2, y: (bottom + top)/2 };
  return { points, base, tip, center, left, top, width, height };
}

function veins(material, shape) {
  const { base, tip, points } = shape;
  const dx = tip.x - base.x, dy = tip.y - base.y, length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length, normalY = dx / length;
  const sides = points.map(p => (p.x - base.x)*normalX + (p.y - base.y)*normalY);
  const low = Math.min(...sides), high = Math.max(...sides);
  const at = (along, side) => {
    const center = (low + high) * 0.28 * Math.sin(Math.PI * along);
    const offset = center + side * (side > 0 ? high : -low);
    return xy({ x: base.x + dx*along + normalX*offset, y: base.y + dy*along + normalY*offset });
  };
  let ink = '', light = '';
  if (material === 'petal' || material === 'lily') {
    for (const side of [-1, 1]) {
      ink += `M${at(.08, side*.12)}Q${at(.39, side*.8)} ${at(.85, side*.20)}`;
      ink += `M${at(.14, side*.02)}Q${at(.36, side*.35)} ${at(.65, side*.16)}`;
      light += `M${at(.22, side*.2)}Q${at(.51, side*.64)} ${at(.83, side*.19)}`;
    }
    light += `M${at(.15, 0)}Q${at(.63, -.08)} ${at(.93, 0)}`;
  } else {
    light = `M${at(.05, 0)}Q${at(.52, .06)} ${at(.94, 0)}`;
    for (const t of [.19, .38, .56]) {
      for (const side of [-1, 1]) ink += `M${at(t, 0)}Q${at(t+.09, side*.42)} ${at(t+.23, side*.72)}`;
    }
  }
  return { ink, light };
}

function seedSpiral({ center, width, height }, area) {
  const count = Math.max(25, Math.min(220, Math.round(area / 9)));
  const size = Math.max(.67, Math.min(1.6, Math.sqrt(area / count) * .43));
  let ink = '', light = '';
  // Golden-angle packing produces the two intersecting spiral families of
  // sunflower seeds, with each kernel turning toward the rim of this disk.
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt((i + .45) / count) * .99;
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const x = center.x + Math.cos(angle) * radius * width/2;
    const y = center.y + Math.sin(angle) * radius * height/2;
    const dx = Math.cos(angle + .6) * size, dy = Math.sin(angle + .6) * size;
    const p = xy({ x: x-dx, y: y-dy }), q = xy({ x: x+dx, y: y+dy });
    ink += `M${p}Q${xy({ x: x-dy, y: y+dx })} ${q}Q${xy({ x: x+dy, y: y-dx })} ${p}Z`;
    const glint = xy({ x: x - dx*.65 + dy*.16, y: y - dy*.65 - dx*.16 });
    light += `M${glint}Q${xy({ x: x + dy*.32, y: y - dx*.32 })} ${xy({ x: x + dx*.38, y: y + dy*.38 })}`;
  }
  return { ink, light };
}

export function createRegionArt(prefix, svgElement) {
  const defs = svgElement('defs');
  const shapes = svgElement('defs');
  const layer = svgElement('g', { class: 'hb-field__regions', 'aria-hidden': true, 'pointer-events': 'none' });
  const fillId = material => `${prefix}-${material}-paint`;
  const grainId = grain => `${prefix}-${grain}-grain`;
  const liftId = `${prefix}-lift`;
  for (const [name, material] of Object.entries(materials)) {
    const radial = name === 'seeds' || name === 'fruit';
    const gradient = svgElement(radial ? 'radialGradient' : 'linearGradient', radial ? {
      id: fillId(name), cx: name === 'fruit' ? '.30' : '.50', cy: name === 'fruit' ? '.28' : '.50', r: '.68',
    } : { id: fillId(name), x1: '.70', y1: '1', x2: '.24', y2: '0' });
    material.colors.forEach((color, i) => gradient.append(svgElement('stop', { offset: [0,.53,1][i], 'stop-color': color })));
    defs.append(gradient);
  }
  for (const [name, [width, height, marks]] of Object.entries(grains)) {
    const grain = svgElement('pattern', { id: grainId(name), patternUnits: 'userSpaceOnUse', width, height });
    for (const [d, fill, opacity] of marks) grain.append(svgElement('path', { d, fill, opacity }));
    defs.append(grain);
  }
  const lift = svgElement('pattern', { id: liftId, patternUnits: 'userSpaceOnUse', width: 9, height: 9 });
  lift.append(svgElement('path', { d: 'M-2 2L2-2M0 9L9 0M7 11L11 7', fill: 'none', stroke: '#fff7d5', 'stroke-width': 1.3 }));
  defs.append(lift);
  let regions = [];

  function build(board) {
    shapes.replaceChildren();
    layer.replaceChildren();
    const degrees = new Map(board.nodes.map(node => [node.id, 0]));
    for (const { a, b } of board.edges) {
      degrees.set(a, degrees.get(a) + 1);
      degrees.set(b, degrees.get(b) + 1);
    }
    regions = findRegions(board).map((region, index) => {
      const { material, ids } = region, recipe = materials[material];
      const shape = descriptors(region, degrees);
      const stem = `${prefix}-region-${index}`;
      const contour = svgElement('path', { id: `${stem}-contour`, d: contourPath(region.boundary) });
      const use = attributes => svgElement('use', { href: `#${stem}-contour`, ...attributes });
      const clip = svgElement('clipPath', { id: `${stem}-clip`, clipPathUnits: 'userSpaceOnUse' });
      clip.append(use({}));
      shapes.append(contour, clip);
      let pigment = fillId(material);
      if (recipe.veins) {
        pigment = `${stem}-paint`;
        shapes.append(svgElement('linearGradient', { id: pigment, href: `#${fillId(material)}`,
          gradientUnits: 'userSpaceOnUse', x1: shape.base.x, y1: shape.base.y, x2: shape.tip.x, y2: shape.tip.y }));
      }
      const group = svgElement('g', { class: `hb-field__region hb-field__region--${material}`,
        'data-material': material, 'data-boundary': ids.join(' ') });
      const art = svgElement('g', { class: 'hb-field__region-art' });
      art.append(use({ class: 'hb-field__pigment', fill: url(pigment), opacity: recipe.opacity ?? 1 }));
      if (recipe.veins || material === 'seeds') {
        const detail = svgElement('g', { 'clip-path': url(`${stem}-clip`) });
        const seeds = material === 'seeds';
        const { ink, light } = seeds ? seedSpiral(shape, region.area) : veins(material, shape);
        detail.append(svgElement('path', seeds ? { d: ink, fill: recipe.ink, opacity: .85 } : {
          d: ink, fill: 'none', stroke: recipe.ink, 'stroke-width': .85, 'stroke-linecap': 'round', opacity: .62,
        }));
        detail.append(svgElement('path', { d: light, fill: 'none', stroke: recipe.light,
          'stroke-width': seeds ? .64 : 1.25, 'stroke-linecap': 'round', opacity: seeds ? .89 : .71 }));
        art.append(detail);
      } else if (material === 'fruit') {
        const glint = svgElement('ellipse', { cx: shape.left + shape.width*.29, cy: shape.top + shape.height*.28,
          rx: shape.width*.055, ry: shape.height*.11, fill: '#ffe8aa', opacity: .67, 'clip-path': url(`${stem}-clip`) });
        art.append(glint);
      } else {
        art.append(use({ fill: url(grainId(recipe.grain)), opacity: recipe.opacity ?? 1 }));
      }
      art.append(use({ class: 'hb-field__cut-wash', fill: url(liftId) }));
      group.append(art);
      layer.append(group);
      return { ...region, shape, group, art, visible: false };
    });
  }

  function project(projection) {
    // Each connected figure lies in a single affine span. Apply exactly the
    // same map as its playable contours, including to the grain and seeds.
    for (const region of regions) {
      const x = region.boundary[0].from.x;
      const offset = projection.x(x) - x * projection.scale;
      region.art.setAttribute('transform', `matrix(${projection.scale} 0 0 1 ${offset} 0)`);
    }
  }

  function setLive(live) {
    for (const region of regions) {
      region.visible = region.ids.every(id => live.has(id));
      region.group.setAttribute('display', region.visible ? 'inline' : 'none');
    }
  }

  function preview(target, falling) {
    for (const region of regions) {
      const opening = region.visible && region.ids.includes(target);
      region.group.classList.toggle('hb-field__region--opening', opening);
      region.group.classList.toggle('hb-field__region--falling', region.visible && !opening && region.ids.some(id => falling.has(id)));
    }
  }

  function copy(region, className) {
    // The originals and the transient pieces share the same immutable SVG
    // resources. Only the copy moves; neighboring cells stay on their joints.
    const ghost = svgElement('g', { class: className, 'data-material': region.material });
    ghost.append(region.art.cloneNode(true));
    return ghost;
  }

  function opened(cutId) {
    return regions.filter(region => region.visible && region.ids.includes(cutId)).map(region => {
      const ghost = copy(region, `hb-field__peel hb-field__peel--${region.material}`);
      const { base, center, left, top, width, height } = region.shape;
      const side = center.x >= base.x ? 1 : -1;
      ghost.style.setProperty('--hb-hinge', `${(base.x-left)*100/width}% ${(base.y-top)*100/height}%`);
      ghost.style.setProperty('--hb-drift', `${side * Math.min(16, width*.17 + 4)}px`);
      ghost.style.setProperty('--hb-spin', `${side * 17}deg`);
      return ghost;
    });
  }

  function detached(ids) {
    return regions.filter(region => region.visible && region.ids.every(id => ids.has(id)))
      .map(region => copy(region, 'hb-field__detached-region'));
  }

  return { defs, shapes, layer, build, project, setLive, preview, opened, detached };
}
