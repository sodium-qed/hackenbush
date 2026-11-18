import { liveOpening } from './opening-assessment.js';
import { freshSeed, generateBoard } from '../dist/js/generator.js';
import { ratedDeal } from '../dist/js/rated-deal.js';
import { cutEdge, initialEdges, otherSide, winner } from '../dist/js/rules.js';
import { cleanName, TURN_MS } from '../dist/js/session.js';

const OPENING_MS = 4_000;
const QUEUE_LEASE = 45_000;
const ROOM_LIFETIME = 15 * 60_000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VARIANTS = ['green', 'redblue'];
const MAX_BODY = 4096;
const UNAUTHORIZED = 'Your guest session could not be found.';

class ArenaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function response(payload, serverNow, status = 200) {
  return new Response(JSON.stringify({ ...payload, serverNow }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readBody(request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '', size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new ArenaError(413, 'body-too-large', 'This request is too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) return {};
  try {
    const data = JSON.parse(text);
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* The same error describes malformed and non-object JSON. */ }
  throw new ArenaError(400, 'invalid-json', 'Send a JSON object.');
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function playerId(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

function variantOf(value) {
  if (!VARIANTS.includes(value)) {
    throw new ArenaError(400, 'invalid-variant', 'Choose Green or Red–Blue.');
  }
  return value;
}

function roomCode() {
  // This 32-character alphabet divides each random byte into equal-sized buckets.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

function stateRow({ db, id, now }) {
  return db.prepare(`
    SELECT m.*, p.name AS profile_name, p.green_rating AS profile_green,
           p.redblue_rating AS profile_redblue, w.kind AS waiting_kind, w.variant AS waiting_variant,
           w.started_at AS waiting_since, w.expires_at AS waiting_until, w.code AS waiting_code,
           w.ticket AS waiting_ticket
    FROM arena_players p
    LEFT JOIN arena_matches m ON m.id = p.match_id
    LEFT JOIN arena_waiting w ON w.player_id = p.id AND w.expires_at > ?
    WHERE p.id = ?
  `).bind(now(), id).first();
}

function matchView(row, player) {
  const opening = row.rated && (row.opening_trials != null || !row.winner) ? liveOpening(row) : null;
  return {
    id: row.id, variant: row.variant, rated: Boolean(row.rated),
    seed: row.seed, boardVersion: row.board_version, difficulty: 'expert',
    firstSide: row.first_side, seat: row.blue_id === player ? 'blue' : 'red',
    players: {
      blue: { name: row.blue_name, rating: row.blue_rating },
      red: { name: row.red_name, rating: row.red_rating },
    },
    openingAssessment: opening ? { trials: opening.trials, ready: opening.ready,
      ...(opening.ready ? { blueDelta: opening.delta } : {}) } : null,
    moves: JSON.parse(row.moves), live: JSON.parse(row.live), side: row.side, version: row.version,
    startedAt: row.started_at, turnStartsAt: row.turn_starts_at, deadline: row.deadline,
    result: row.winner && {
      winner: row.winner, reason: row.reason,
      delta: { blue: row.blue_delta, red: -row.blue_delta },
    },
  };
}

function view(ctx, row) {
  return {
    profile: { name: row.profile_name, ratings: { green: row.profile_green, redblue: row.profile_redblue } },
    queue: row.waiting_kind === 'queue' ? { variant: row.waiting_variant, since: row.waiting_since } : null,
    room: row.waiting_kind === 'room'
      ? { code: row.waiting_code, variant: row.waiting_variant, expiresAt: row.waiting_until } : null,
    match: row.id ? matchView(row, ctx.id) : null,
  };
}

// Match ratings are frozen when the seats are assigned. A terminal transaction
// writes the two absolute post-game ratings, so replaying it cannot add Elo twice.
async function finish(ctx, match, winningSide, update, opening) {
  if (!match.rated) return update.run();
  const delta = opening.delta[winningSide];
  const column = match.variant === 'green' ? 'green_rating' : 'redblue_rating';
  const ratings = ctx.db.prepare(`
    UPDATE arena_players
    SET ${column} = CASE id WHEN ? THEN ? ELSE ? END
    WHERE match_id = ? AND EXISTS (SELECT 1 FROM arena_matches WHERE id = ? AND winner = ?)
  `).bind(match.blue_id, match.blue_rating + delta, match.red_rating - delta,
    match.id, match.id, winningSide);
  const [result] = await ctx.db.batch([update, ratings]);
  return result;
}

async function finishWithoutCut(ctx, match, winningSide, reason, decisionTime) {
  // A resignation applies to the current match even if the other player just
  // cut. A timeout applies only to the exact turn whose deadline was observed.
  const guard = reason === 'timeout' ? 'version = ? AND deadline <= ?' : 'deadline > ?';
  const args = reason === 'timeout' ? [match.version, decisionTime] : [decisionTime];
  const opening = match.rated ? liveOpening(match, Infinity) : null;
  const update = ctx.db.prepare(`
    UPDATE arena_matches SET winner = ?, reason = ?, blue_delta = ?, version = version + 1,
                             turn_starts_at = NULL, deadline = NULL, opening_trials = ?, opening_blue_wins = ?
    WHERE id = ? AND winner IS NULL AND ${guard}
  `).bind(winningSide, reason, opening?.delta[winningSide] ?? 0, opening?.trials ?? null, opening?.wins ?? 0, match.id, ...args);
  await finish(ctx, match, winningSide, update, opening);
}

async function expireIfDue(ctx, match) {
  const time = ctx.now();
  if (!match.id || match.winner || match.deadline > time) return false;
  await finishWithoutCut(ctx, match, otherSide(match.side), 'timeout', time);
  return true;
}

async function current(ctx) {
  let row = await stateRow(ctx);
  if (!row) throw new ArenaError(401, 'unauthorized', UNAUTHORIZED);
  if (await expireIfDue(ctx, row)) row = await stateRow(ctx);
  return row;
}

function closest(ctx, ticket) {
  const time = ctx.now();
  return ctx.db.prepare(`
    SELECT peer.player_id, peer.ticket
    FROM arena_waiting own JOIN arena_waiting peer ON peer.variant = own.variant AND peer.kind = 'queue'
    WHERE own.player_id = ? AND own.ticket = ? AND own.kind = 'queue' AND own.expires_at > ?
      AND peer.player_id <> own.player_id AND peer.expires_at > ?
      AND abs(own.rating - peer.rating) <= 100 + 50 * CAST((? - min(own.started_at, peer.started_at)) / 5000 AS INTEGER)
    ORDER BY abs(own.rating - peer.rating), peer.started_at, peer.player_id
    LIMIT 1
  `).bind(ctx.id, ticket, time, time, time).first();
}

async function pair(ctx, variant, ownTicket, peer, code = null) {
  const deal = ratedDeal(freshSeed());
  const board = generateBoard(deal.seed, variant, deal.difficulty, deal.boardVersion);
  const live = JSON.stringify(initialEdges(board));
  const id = crypto.randomUUID();
  const time = ctx.now();
  const start = time + OPENING_MS;
  const blueId = deal.seat === 'blue' ? ctx.id : peer.player_id;
  const redId = deal.seat === 'red' ? ctx.id : peer.player_id;
  const column = variant === 'green' ? 'green_rating' : 'redblue_rating';
  const ownGuard = ownTicket
    ? 'EXISTS (SELECT 1 FROM arena_waiting WHERE player_id = ? AND ticket = ? AND expires_at > ?)'
    : 'NOT EXISTS (SELECT 1 FROM arena_waiting WHERE player_id = ? AND expires_at > ?)';
  const ownArgs = ownTicket ? [ctx.id, ownTicket, time] : [ctx.id, time];

  // Ticket identity prevents a delayed claim from consuming a replacement
  // invitation or a re-entered queue. D1 executes all three statements atomically.
  const claim = ctx.db.prepare(`
    INSERT INTO arena_matches (
      id, variant, rated, room_code, seed, board_version, first_side,
      blue_id, red_id, blue_name, red_name, blue_rating, red_rating,
      live, side, started_at, turn_starts_at, deadline, opening_trials
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, b.id, r.id, b.name, r.name, b.${column}, r.${column},
           ?, ?, ?, ?, ?, ?
    FROM arena_players b, arena_players r
    WHERE b.id = ? AND r.id = ? AND b.id <> r.id
      AND (b.match_id IS NULL OR EXISTS (SELECT 1 FROM arena_matches WHERE id = b.match_id AND winner IS NOT NULL))
      AND (r.match_id IS NULL OR EXISTS (SELECT 1 FROM arena_matches WHERE id = r.match_id AND winner IS NOT NULL))
      AND EXISTS (SELECT 1 FROM arena_waiting WHERE player_id = ? AND ticket = ? AND expires_at > ?)
      AND ${ownGuard}
  `).bind(id, variant, code === null ? 1 : 0, code, deal.seed, deal.boardVersion, deal.firstSide,
    live, deal.firstSide, time, start, start + TURN_MS, code === null ? 0 : null, blueId, redId,
    peer.player_id, peer.ticket, time, ...ownArgs);
  const seat = ctx.db.prepare(`
    UPDATE arena_players SET match_id = ? WHERE id IN (?, ?) AND EXISTS (SELECT 1 FROM arena_matches WHERE id = ?)
  `).bind(id, blueId, redId, id);
  const clear = ctx.db.prepare(`
    DELETE FROM arena_waiting WHERE player_id IN (?, ?) AND EXISTS (SELECT 1 FROM arena_matches WHERE id = ?)
  `).bind(blueId, redId, id);
  await ctx.db.batch([claim, seat, clear]);
  if (code === null) scheduleLiveOpening(ctx, id);
}

// Progress is independent of turns and guarded by its own counter. Simultaneous
// polls or another isolate can only write the same deterministic prefix.
async function advanceLiveOpening(ctx, row) {
  if (!row.rated || row.winner || liveOpening(row).ready) return row;
  const next = liveOpening(row, 8);
  const update = await ctx.db.prepare(`
    UPDATE arena_matches SET opening_trials = ?, opening_blue_wins = ?
    WHERE id = ? AND winner IS NULL AND coalesce(opening_trials, 0) < ?
  `).bind(next.trials, next.wins, row.id, next.trials).run();
  if (!update.meta?.changes) return stateRow(ctx);
  return { ...row, opening_trials: next.trials, opening_blue_wins: next.wins };
}

const workingOpenings = new Map();
function scheduleLiveOpening(ctx, id) {
  if (!ctx.execution || workingOpenings.has(id)) return;
  const work = (async () => {
    for (;;) {
      const row = await ctx.db.prepare('SELECT * FROM arena_matches WHERE id = ?').bind(id).first();
      if (!row?.rated || row.winner || liveOpening(row).ready) return;
      await advanceLiveOpening(ctx, row);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  })().catch(() => { /* A later poll resumes the saved prefix. */ }).finally(() => workingOpenings.delete(id));
  workingOpenings.set(id, work);
  ctx.execution.waitUntil(work);
}

async function poll(ctx, row) {
  if (row.waiting_kind !== 'queue') {
    if (ctx.execution && row.rated && !row.winner && !liveOpening(row).ready) {
      scheduleLiveOpening(ctx, row.id);
      return view(ctx, row);
    }
    return view(ctx, await advanceLiveOpening(ctx, row));
  }
  const time = ctx.now();
  if (row.waiting_until - time < QUEUE_LEASE - 10_000) {
    await ctx.db.prepare(`
      UPDATE arena_waiting SET expires_at = max(expires_at, ?)
      WHERE player_id = ? AND ticket = ? AND expires_at > ?
    `).bind(time + QUEUE_LEASE, ctx.id, row.waiting_ticket, time).run();
  }
  const opponent = await closest(ctx, row.waiting_ticket);
  if (!opponent) return view(ctx, row);
  await pair(ctx, row.waiting_variant, row.waiting_ticket, opponent);
  return view(ctx, await current(ctx));
}

function busy() {
  throw new ArenaError(409, 'already-playing', 'Finish your current match or cancel your waiting activity first.');
}

async function waitForOpponent(ctx, row, kind, variant) {
  if (row.id && !row.winner) {
    if (row.variant === variant && Boolean(row.rated) === (kind === 'queue')) return view(ctx, row);
    busy();
  }
  if (row.waiting_kind) {
    if (row.waiting_kind === kind && row.waiting_variant === variant) return poll(ctx, row);
    busy();
  }
  // An ignored insert may indicate a room-code collision. A repeated request
  // for the same waiting activity instead keeps its original ticket and age.
  for (let attempt = 0; attempt < 4; attempt++) {
    const ticket = crypto.randomUUID();
    const time = ctx.now();
    const expires = time + (kind === 'queue' ? QUEUE_LEASE : ROOM_LIFETIME);
    const column = variant === 'green' ? 'green_rating' : 'redblue_rating';
    const trim = ctx.db.prepare('DELETE FROM arena_waiting WHERE expires_at <= ?').bind(time);
    const insert = ctx.db.prepare(`
      INSERT OR IGNORE INTO arena_waiting (player_id, ticket, kind, variant, rating, started_at, expires_at, code)
      SELECT p.id, ?, ?, ?, p.${column}, ?, ?, ? FROM arena_players p
      WHERE p.id = ? AND (p.match_id IS NULL OR EXISTS (
        SELECT 1 FROM arena_matches WHERE id = p.match_id AND winner IS NOT NULL
      ))
    `).bind(ticket, kind, variant, time, expires, kind === 'room' ? roomCode() : null, ctx.id);
    const release = ctx.db.prepare(`
      UPDATE arena_players SET match_id = NULL WHERE id = ? AND match_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM arena_waiting WHERE ticket = ?)
    `).bind(ctx.id, ticket);
    await ctx.db.batch([trim, insert, release]);
    row = await current(ctx);
    if (row.waiting_kind === kind && row.waiting_variant === variant) return poll(ctx, row);
    if (row.id && !row.winner && row.variant === variant && Boolean(row.rated) === (kind === 'queue')) {
      return view(ctx, row);
    }
    if (row.waiting_kind || (row.id && !row.winner)) busy();
  }
  throw new ArenaError(503, 'room-unavailable', 'Please try opening a room again.');
}

async function joinRoom(ctx, row, input) {
  const code = typeof input === 'string' ? input.trim().toUpperCase() : '';
  if (code.length !== 6 || !Array.from(code).every(letter => ROOM_ALPHABET.includes(letter))) {
    throw new ArenaError(400, 'invalid-code', 'Enter the six-character room code.');
  }
  if (row.id && !row.winner) {
    if (row.room_code === code) return view(ctx, row);
    busy();
  }
  if (row.waiting_kind === 'room' && row.waiting_code === code) {
    throw new ArenaError(409, 'own-room', 'Share this code with the other player.');
  }
  if (row.waiting_kind) busy();
  const peer = await ctx.db.prepare(`
    SELECT player_id, ticket, variant FROM arena_waiting WHERE kind = 'room' AND code = ? AND expires_at > ?
  `).bind(code, ctx.now()).first();
  if (peer && peer.player_id !== ctx.id) await pair(ctx, peer.variant, null, peer, code);
  row = await current(ctx);
  if (row.id && !row.rated && row.room_code === code) return view(ctx, row);
  if (row.waiting_kind || (row.id && !row.winner)) busy();
  throw new ArenaError(404, 'room-unavailable', 'This room is full, closed, or expired.');
}

function participantMatch(ctx, matchId) {
  return ctx.db.prepare(`
    SELECT * FROM arena_matches WHERE id = ? AND (blue_id = ? OR red_id = ?)
  `).bind(matchId, ctx.id, ctx.id).first();
}

function previousCut(match, seat, version, edge) {
  if (version >= match.version) return false;
  const actingSide = version % 2 ? otherSide(match.first_side) : match.first_side;
  return actingSide === seat && JSON.parse(match.moves)[version] === edge;
}

function conflict(code, message) {
  throw new ArenaError(409, code, message);
}

async function move(ctx, match, data) {
  const { version, edgeId } = data;
  if (!Number.isSafeInteger(version) || version < 0 || typeof edgeId !== 'string' || !/^e\d{1,4}$/.test(edgeId)) {
    throw new ArenaError(400, 'invalid-move', 'Send the turn version and an edge ID.');
  }
  const seat = match.blue_id === ctx.id ? 'blue' : 'red';
  if (previousCut(match, seat, version, edgeId)) return;
  if (match.winner) conflict('match-finished', 'This match has ended.');
  if (version !== match.version) conflict('stale-version', 'The board has changed. Refresh the current turn.');
  if (seat !== match.side) conflict('wrong-turn', 'It is the other player’s turn.');
  if (ctx.now() < match.turn_starts_at) conflict('opening', 'The opening look is still running.');
  const board = generateBoard(match.seed, match.variant, 'expert', match.board_version);
  const change = cutEdge(board, JSON.parse(match.live), edgeId, seat);
  if (!change) throw new ArenaError(422, 'illegal-cut', 'Choose a standing edge you can cut.');
  const next = otherSide(seat);
  const victor = winner(board, change.live, next);
  const time = ctx.now();
  if (time >= match.deadline) {
    await finishWithoutCut(ctx, match, next, 'timeout', time);
    conflict('time-expired', 'The turn clock expired.');
  }
  const moves = JSON.parse(match.moves);
  moves.push(edgeId);
  const opening = victor && match.rated ? liveOpening(match, Infinity) : null;
  const update = ctx.db.prepare(`
    UPDATE arena_matches SET moves = ?, live = ?, side = ?, version = version + 1,
      turn_starts_at = ?, deadline = ?, winner = ?, reason = ?, blue_delta = ?,
      opening_trials = coalesce(?, opening_trials), opening_blue_wins = coalesce(?, opening_blue_wins)
    WHERE id = ? AND winner IS NULL AND side = ? AND version = ? AND turn_starts_at <= ? AND deadline > ?
  `).bind(JSON.stringify(moves), JSON.stringify(change.live), next, victor ? null : time, victor ? null : time + TURN_MS,
    victor, victor ? 'no-moves' : null, opening?.delta[victor] ?? 0, opening?.trials ?? null, opening?.wins ?? null, match.id, seat, version, time, time);
  const result = victor ? await finish(ctx, match, victor, update, opening) : await update.run();
  if (!result.meta?.changes) {
    const actual = await participantMatch(ctx, match.id);
    if (!previousCut(actual, seat, version, edgeId)) conflict('stale-version', 'The board has changed. Refresh the current turn.');
  }
}

async function matchAction(ctx, row, matchId, action, method, data) {
  let match = row.id === matchId ? row : await participantMatch(ctx, matchId);
  if (!match) throw new ArenaError(404, 'match-unavailable', 'This match could not be found.');
  if (await expireIfDue(ctx, match)) match = await participantMatch(ctx, matchId);
  if (!action && method === 'GET') {
    return { ...view(ctx, await current(ctx)), queue: null, room: null, match: matchView(match, ctx.id) };
  }
  if (action === 'move' && method === 'POST') {
    await move(ctx, match, data);
  } else if (action === 'resign' && method === 'POST') {
    if (!match.winner) {
      const seat = match.blue_id === ctx.id ? 'blue' : 'red';
      await finishWithoutCut(ctx, match, otherSide(seat), 'resign', ctx.now());
    }
  } else if (!action && method === 'DELETE') {
    if (!match.winner) conflict('match-in-progress', 'Finish or resign this match before leaving.');
    await ctx.db.prepare('UPDATE arena_players SET match_id = NULL WHERE id = ? AND match_id = ?')
      .bind(ctx.id, matchId).run();
  } else {
    throw new ArenaError(405, 'method', 'This match action does not support that method.');
  }
  return view(ctx, await current(ctx));
}

async function dispatch(request, ctx) {
  const path = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  // The hosting gateway can use Authorization for its own credentials. Guests
  // can send a dedicated header or the original bearer-token representation.
  const bearer = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('Authorization') || '');
  const credential = request.headers.get('X-Groundwork-Token') ?? bearer?.[1] ?? null;
  if (path === '/api/profile' && method === 'POST' && credential === null) {
    const data = await readBody(request);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    ctx.id = await playerId(token);
    const name = cleanName(data.name) || 'Guest ' + ctx.id.slice(0, 4).toUpperCase();
    await ctx.db.prepare('INSERT INTO arena_players (id, name) VALUES (?, ?)').bind(ctx.id, name).run();
    return { token, ...view(ctx, await current(ctx)) };
  }
  if (!credential || !/^[a-f0-9]{64}$/i.test(credential)) throw new ArenaError(401, 'unauthorized', UNAUTHORIZED);
  ctx.id = await playerId(credential);
  const row = await current(ctx);
  const data = method === 'POST' ? await readBody(request) : {};
  if (path === '/api/state' && method === 'GET') return poll(ctx, row);
  if (path === '/api/profile' && method === 'POST') {
    const name = cleanName(data.name);
    if (!name) throw new ArenaError(400, 'invalid-name', 'Enter a guest name.');
    await ctx.db.prepare('UPDATE arena_players SET name = ? WHERE id = ?').bind(name, ctx.id).run();
    return view(ctx, await current(ctx));
  }
  if (path === '/api/queue' || path === '/api/rooms') {
    const kind = path === '/api/queue' ? 'queue' : 'room';
    if (method === 'POST') return waitForOpponent(ctx, row, kind, variantOf(data.variant));
    if (method === 'DELETE') {
      await ctx.db.prepare('DELETE FROM arena_waiting WHERE player_id = ? AND kind = ?').bind(ctx.id, kind).run();
      return view(ctx, await current(ctx));
    }
  }
  if (path === '/api/rooms/join' && method === 'POST') return joinRoom(ctx, row, data.code);
  const route = /^\/api\/matches\/([a-f0-9-]{36})(?:\/(move|resign))?$/.exec(path);
  if (route) return matchAction(ctx, row, route[1], route[2], method, data);
  throw new ArenaError(404, 'not-found', 'This arena endpoint could not be found.');
}

/** HTTP entry point shared by the production worker and the local SQLite server. */
export async function handleArena(request, env, execution) {
  const now = typeof env?.now === 'function' ? env.now : Date.now;
  try {
    if (!env?.DB) throw new ArenaError(503, 'unavailable', 'The arena database is unavailable.');
    const result = await dispatch(request, { db: env.DB, now, id: null, execution });
    return response(result, now());
  } catch (error) {
    if (error instanceof ArenaError) return response({ error: error.message, code: error.code }, now(), error.status);
    console.error('Arena request failed', error instanceof Error ? error.message : 'Unknown database error');
    return response({ error: 'The arena is temporarily unavailable. Please reconnect.', code: 'unavailable' }, now(), 503);
  }
}
