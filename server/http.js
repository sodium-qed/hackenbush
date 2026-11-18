import { handleArena } from './arena.js';

// A guest supplies a bearer token explicitly. The public Pages frontend can
// reach this API without cross-site cookies or an external sign-in.
const apiHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Groundwork-Token',
  'Access-Control-Max-Age': '600',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export async function serveGame(request, env, serveAsset, execution) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: apiHeaders});
    let result;
    try {
      if (pathname === '/api/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1 AS ok').first();
        result = Response.json({status: 'ok'});
      } else {
        result = await handleArena(request, env, execution);
      }
    } catch (error) {
      console.error('Groundwork API error', error?.message);
      result = Response.json({error: 'The game server is temporarily unavailable.'}, {status: 503});
    }
    const headers = new Headers(result.headers);
    for (const [name, value] of Object.entries(apiHeaders)) headers.set(name, value);
    return new Response(result.body, {status: result.status, headers});
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
  }
  const path = pathname === '/' ? '/index.html' : pathname;
  return await serveAsset(path, request) || new Response('Page not found.', {status: 404});
}
