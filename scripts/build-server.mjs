import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, copyFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { contentTypes } from '../server/mime.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const assets = {};

// Embed exactly the public client in one portable Worker. The same dist/
// remains directly publishable to Pages, including all relative asset URLs.
async function collect(directory = '') {
  for (const entry of await readdir(join(dist, directory), {withFileTypes: true})) {
    if (entry.name.startsWith('.') || (!directory && entry.name === 'server')) continue;
    const rel = directory ? directory + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { await collect(rel); continue; }
    const type = contentTypes[extname(entry.name)];
    if (!type || !entry.isFile()) throw new Error('Unknown public asset: ' + rel);
    const bytes = await readFile(join(dist, rel));
    assets['/' + rel] = {type, hash: createHash('sha256').update(bytes).digest('hex').slice(0, 20), data: bytes.toString('base64')};
  }
}
await collect();
await mkdir(join(dist, '.openai'), {recursive: true});
await copyFile(join(root, '.openai', 'hosting.json'), join(dist, '.openai', 'hosting.json'));
await build({
  absWorkingDir: root,
  entryPoints: ['server/worker.js'], outfile: 'dist/server/index.js',
  format: 'esm', platform: 'browser', target: 'es2022', bundle: true,
  plugins: [{
    name: 'groundwork-assets',
    setup(builder) {
      builder.onResolve({filter: /^groundwork:public-assets$/}, () => ({path: 'public', namespace: 'groundwork'}));
      builder.onLoad({filter: /.*/, namespace: 'groundwork'}, () => ({contents: JSON.stringify(assets), loader: 'json'}));
    }
  }]
});
console.log('Built game server with ' + Object.keys(assets).length + ' public files.');
