import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openArenaDB } from '../server/local-db.js';
import { contentTypes } from '../server/mime.js';
import { serveGame } from '../server/http.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = resolve(root, 'dist');
const args = process.argv.slice(2);
function option(flag, fallback) {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
}
const port = Number(option('--port', process.env.PORT || 5173));
const host = option('--host', process.env.HOST || '127.0.0.1');
const databasePath = process.env.ARENA_DB || resolve(root, '.local/arena.sqlite');
if (databasePath !== ':memory:') await mkdir(dirname(databasePath), {recursive: true});
const DB = openArenaDB(databasePath);
const background = new Set();
const execution = { waitUntil(task) { background.add(task); task.finally(() => background.delete(task)); } };

async function serveAsset(path, request) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.')) || decoded.startsWith('/server/')) return null;
  const filename = resolve(dist, '.' + decoded), type = contentTypes[extname(filename)];
  if (!type || !filename.startsWith(dist + sep)) return null;
  try {
    if (!(await stat(filename)).isFile()) return null;
    const body = request.method === 'HEAD' ? null : await readFile(filename);
    return new Response(body, {headers: {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const parts = [];
    let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 8192) {
        outgoing.writeHead(413).end();
        return;
      }
      parts.push(chunk);
    }
    const request = new Request(new URL(incoming.url, 'http://localhost'), {
      method: incoming.method, headers: incoming.headers,
      body: parts.length && !['GET', 'HEAD'].includes(incoming.method) ? Buffer.concat(parts) : undefined
    });
    const response = await serveGame(request, {DB}, serveAsset, execution);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Groundwork request failed', error.message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.listen(port, host, () => console.log('Groundwork listening at http://' + host + ':' + server.address().port));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await Promise.allSettled([...background]); DB.close(); }));
