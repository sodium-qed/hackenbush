import { serveGame } from './http.js';
import assets from 'groundwork:public-assets';

function serveAsset(path, request) {
  if (!Object.hasOwn(assets, path)) return null;
  const {type, hash, data} = assets[path];
  const headers = {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'ETag': '"' + hash + '"',
    'X-Content-Type-Options': 'nosniff'
  };
  if (request.headers.get('If-None-Match') === headers.ETag) {
    return new Response(null, {status: 304, headers});
  }
  const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(data), c => c.charCodeAt(0));
  return new Response(body, {headers});
}

export default {
  fetch(request, env) { return serveGame(request, env, serveAsset); }
};
