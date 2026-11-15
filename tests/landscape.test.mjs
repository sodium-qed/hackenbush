import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLandscape } from '../dist/js/landscape.js';

function mount() {
  return {
    dataset: {}, classList: new Set(), attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    ownerDocument: {
      createElementNS() {
        return { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
      },
    },
    replaceChildren(...children) {
      for (const old of this.children) old.parentNode = null;
      for (const child of children) child.parentNode = this;
      this.children = children;
    },
  };
}

test('a landscape replays across devices, with distinct geometry for each seed digit', () => {
  const a = mount(), b = mount();
  const world = { biome: 'wetland', wind: -1, focus: 0.2, horizon: 0.5 };
  const seed = 'A35D7E';
  renderLandscape(a, world, seed);
  renderLandscape(b, world, seed.toLowerCase());
  const artwork = container => container.children[0].innerHTML.replaceAll(/hb-landscape-sky-\d+/g, 'sky');
  const original = artwork(a);
  assert.equal(original, artwork(b));
  assert.notEqual(a.children[0].innerHTML, b.children[0].innerHTML); // Separate paint-server IDs.
  for (let i = 0; i < seed.length; i++) {
    renderLandscape(b, world, seed.slice(0, i) + 'F' + seed.slice(i + 1));
    assert.notEqual(artwork(b), original);
  }
});

test('board changes replace only the decorative layer; a legacy fallback also renders', () => {
  const layer = mount();
  const biomes = ['meadow', 'orchard', 'wetland', 'highland', 'woodland', 'coast', 'canyon', 'terrace'];
  const prints = new Set();
  for (const biome of biomes) {
    renderLandscape(layer, { biome }, 'AB12CD');
    const [svg] = layer.children;
    assert.equal(layer.children.length, 1);
    assert.equal(layer.dataset.biome, biome);
    assert.equal(svg.attributes['aria-hidden'], 'true');
    assert.equal(svg.attributes.focusable, 'false');
    assert.doesNotMatch(svg.innerHTML, /NaN|Infinity|<image\b/);
    prints.add(svg.innerHTML);
    renderLandscape(layer, { biome }, 'ab12cd');
    assert.equal(layer.children[0], svg);
  }
  assert.equal(prints.size, biomes.length);
  layer.replaceChildren();
  renderLandscape(layer, null, 'historical');
  assert.equal(layer.dataset.biome, 'meadow');
  assert.equal(layer.children.length, 1);
  assert.equal(layer.attributes['aria-hidden'], 'true');
});
