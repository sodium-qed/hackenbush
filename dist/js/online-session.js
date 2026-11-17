const roomPattern = /^[A-HJ-NP-Z2-9]{6}$/;

export function onlineApiBase(locationHref, configured) {
  const page = new URL(locationHref);
  // The static Pages mirror shares the hosted service. Every server-backed
  // copy, including a phone opening its host's LAN address, uses its own API.
  return page.hostname.endsWith('.github.io') && configured ? new URL(configured, page).href : page.origin;
}

export function normalizeRoomCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return roomPattern.test(code) ? code : null;
}

export function roomInviteUrl(locationHref, code) {
  const url = new URL(locationHref);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', normalizeRoomCode(code) ?? '');
  return url.href;
}

export function readOnlineIntent(locationHref) {
  const url = new URL(locationHref);
  const hasRoom = url.searchParams.has('room');
  const offline = ['seed', 'daily', 'board', 'rules', 'v', 'bot'].some(key => url.searchParams.has(key));
  return {hasRoom, code: normalizeRoomCode(url.searchParams.get('room')), resumeAllowed: !offline && !url.hash};
}

export class OnlineRequestError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function requestOnline(base, path, {method = 'GET', token, body, controller = new AbortController()} = {}) {
  const headers = {Accept: 'application/json'};
  if (token) headers['X-Groundwork-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const timeout = setTimeout(() => controller.abort(), 10000);
  const start = Date.now();
  try {
    const response = await fetch(new URL(path, base), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new OnlineRequestError(payload.error || 'The server could not complete that action.', response.status);
    }
    if (!payload.profile || !Number.isFinite(payload.serverNow)) throw new Error('Invalid state');
    const clockOffset = payload.serverNow - (start + Date.now()) / 2;
    return {payload, clockOffset};
  } catch (error) {
    if (error instanceof OnlineRequestError) throw error;
    throw new OnlineRequestError('The live server could not be reached.');
  } finally {
    clearTimeout(timeout);
  }
}
