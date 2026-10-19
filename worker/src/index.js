import { DurableObject } from 'cloudflare:workers';
import { join, setReady, startGame, applyProgress, applyMistake, finishGame, giveUp, playAgain, leave, removePlayer } from './room.js';

function parseFirestoreFields(fields) {
  if (!fields) return {};
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) result[key] = val.stringValue;
    else if ('integerValue' in val) result[key] = Number(val.integerValue);
    else if ('doubleValue' in val) result[key] = Number(val.doubleValue);
    else if ('booleanValue' in val) result[key] = Boolean(val.booleanValue);
    else if ('timestampValue' in val) result[key] = val.timestampValue;
    else if ('nullValue' in val) result[key] = null;
    else if ('arrayValue' in val) {
      result[key] = (val.arrayValue.values || []).map((item) => {
        if ('stringValue' in item) return item.stringValue;
        if ('integerValue' in item) return Number(item.integerValue);
        if ('doubleValue' in item) return Number(item.doubleValue);
        if ('booleanValue' in item) return Boolean(item.booleanValue);
        if ('mapValue' in item) return parseFirestoreFields(item.mapValue.fields);
        return item;
      });
    } else if ('mapValue' in val) {
      result[key] = parseFirestoreFields(val.mapValue.fields);
    }
  }
  return result;
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || key === 'id') continue;
    if (val === null) fields[key] = { nullValue: null };
    else if (typeof val === 'string') fields[key] = { stringValue: val };
    else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
    else if (typeof val === 'number') {
      if (Number.isInteger(val)) fields[key] = { integerValue: String(val) };
      else fields[key] = { doubleValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number')
              return Number.isInteger(item)
                ? { integerValue: String(item) }
                : { doubleValue: item };
            if (typeof item === 'boolean') return { booleanValue: item };
            if (item && typeof item === 'object')
              return { mapValue: { fields: toFirestoreFields(item) } };
            return { stringValue: String(item) };
          }),
        },
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
  }
  return fields;
}

// ============================================================
// 공통 보안 유틸
// ============================================================
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents';
const RTDB_BASE = 'https://arrow-game-19120-default-rtdb.asia-southeast1.firebasedatabase.app';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_NICKNAME_LENGTH = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DISCORD_ID_PATTERN = /^\d{5,25}$/;
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{4,12}$/;
const SEED_PATTERN = /^\d{8}$/;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://daily-arrow.web.app',
  'https://daily-arrow.firebaseapp.com',
  'http://localhost:5173',
];
// Discord Activity iframe의 origin (<application id>.discordsays.com)
const DISCORD_ORIGIN_PATTERN = /^https:\/\/\d+\.discordsays\.com$/;

function isAllowedOrigin(origin, env) {
  if (DISCORD_ORIGIN_PATTERN.test(origin)) return true;
  const extra = (env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  return DEFAULT_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin);
}

// Origin 헤더가 없는 요청(Discord 프록시 서버 경유 등)은 CORS 대상이 아니므로 통과시킨다.
function buildCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  if (!isAllowedOrigin(origin, env)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-HTTP-Method-Override',
    'Access-Control-Max-Age': '86400',
  };
}

// 같은 isolate 안에서만 유효한 best-effort 레이트 리미터 (Worker 인스턴스가 여러 개면 한도가 인스턴스별로 적용된다)
const rateBuckets = new Map();
function isRateLimited(key, limit, windowMs) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset <= now) {
    if (rateBuckets.size > 5000) {
      for (const [k, b] of rateBuckets) if (b.reset <= now) rateBuckets.delete(k);
      if (rateBuckets.size > 5000) rateBuckets.clear();
    }
    bucket = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > limit;
}

// Cloudflare Rate Limiting 바인딩(wrangler.toml의 [[ratelimits]])이 있으면 그것을 쓰고,
// 없거나 호출에 실패하면 위의 isolate 메모리 리미터로 대신한다.
async function isLimited(env, binding, key, limit, windowMs) {
  const limiter = env[binding];
  if (limiter && typeof limiter.limit === 'function') {
    try {
      const { success } = await limiter.limit({ key });
      return !success;
    } catch {
      // 바인딩 오류 시 메모리 리미터로 폴백
    }
  }
  return isRateLimited(`${binding}:${key}`, limit, windowMs);
}

// Discord access_token으로 요청자의 Discord 사용자 ID를 서버에서 직접 확인한다.
const tokenCache = new Map();
async function verifyDiscordToken(token) {
  if (!token || token.length > 256) return null;
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.id;
  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !DISCORD_ID_PATTERN.test(String(user.id))) return null;
    if (tokenCache.size > 500) tokenCache.clear();
    tokenCache.set(token, { id: String(user.id), exp: Date.now() + 5 * 60 * 1000 });
    return String(user.id);
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// 문자열 길이 제한 + 제어문자 제거
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

async function readJsonBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    return { value: text ? JSON.parse(text) : {}, text };
  } catch {
    return { invalid: true };
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Firestore 규칙(firestore.rules)과 같은 기준으로 프로필 필드를 검증한다.
const PROFILE_KEY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const PROFILE_COUNTER_LIMITS = {
  currentStreak: 10000,
  totalLongestStreak: 10000,
  totalPlayCount: 1000000,
  multiplayerPlays: 1000000,
  multiplayerWins: 1000000,
  multiplayerCompletions: 1000000,
};
function validateProfile(profile) {
  if (!isPlainObject(profile)) return '프로필 형식이 올바르지 않습니다.';
  const keys = Object.keys(profile);
  if (keys.length > 40) return '프로필 필드가 너무 많습니다.';
  for (const key of keys) {
    if (!PROFILE_KEY_PATTERN.test(key)) return `허용되지 않는 필드: ${key}`;
  }
  // 폐기된 백업 코드 필드는 저장하지 않는다 (공개 읽기 문서에 계정 복구 비밀값이 노출되던 문제)
  if ('backupCode' in profile) return '허용되지 않는 필드: backupCode';
  for (const [key, max] of Object.entries(PROFILE_COUNTER_LIMITS)) {
    if (key in profile && !(typeof profile[key] === 'number' && profile[key] >= 0 && profile[key] <= max)) {
      return `${key} 값이 올바르지 않습니다.`;
    }
  }
  if ('nickname' in profile && !(typeof profile.nickname === 'string' && profile.nickname.length <= MAX_NICKNAME_LENGTH)) {
    return '닉네임이 올바르지 않습니다.';
  }
  if ('achievements' in profile && !(Array.isArray(profile.achievements) && profile.achievements.length <= 100)) {
    return 'achievements 값이 올바르지 않습니다.';
  }
  if ('totalBestRecords' in profile && !(Array.isArray(profile.totalBestRecords) && profile.totalBestRecords.length <= 200)) {
    return 'totalBestRecords 값이 올바르지 않습니다.';
  }
  if ('dailyRecords' in profile && !(isPlainObject(profile.dailyRecords) && Object.keys(profile.dailyRecords).length <= 2000)) {
    return 'dailyRecords 값이 올바르지 않습니다.';
  }
  return null;
}

// RTDB 프록시에서 허용하는 경로만 통과시킨다.
function parseRtdbPath(rawPath) {
  const clean = rawPath.replace(/^\/+/, '').replace(/\.json$/, '');
  if (clean === '_clock_sync/probe') return { kind: 'clock', clean };
  let m = clean.match(/^rooms\/([A-Za-z0-9]{4,12})$/);
  if (m) return { kind: 'room', room: m[1], clean };
  m = clean.match(/^rooms\/([A-Za-z0-9]{4,12})\/players$/);
  if (m) return { kind: 'players', room: m[1], clean };
  m = clean.match(/^rooms\/([A-Za-z0-9]{4,12})\/players\/([A-Za-z0-9_-]{1,64})$/);
  if (m) return { kind: 'player', room: m[1], pid: m[2], clean };
  return null;
}

// 방 단위 Durable Object. 방 상태(참가자, 준비, 시작, 진행도, 결과)의 기준이며 WebSocket으로 모든 참가자에게 중계한다.
// 상태 변경은 모두 이 객체 안에서 검증하므로(방장만 시작, 본인 항목만 수정 등) 클라이언트가 RTDB를 직접 쓰지 않는다.
// 구조적 변경(참가/준비/시작/완료 등)만 저장소에 기록하고, 진행도는 메모리에만 두어 쓰기 횟수를 줄인다.
const MAX_SOCKETS_PER_ROOM = 8;
const MAX_MESSAGES_PER_SECOND = 40;
const MAX_MESSAGE_LENGTH = 1024;
// 연결이 끊긴 플레이어를 정리하기 전 재접속을 기다리는 시간
const DISCONNECT_GRACE_MS = 8000;

function randomSeed() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export class RoomRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.disconnected = {};
    this.rate = new WeakMap();
    // 하이버네이션 후 깨어날 때 저장된 방 상태를 복원한다
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
      this.disconnected = (await ctx.storage.get('disconnected')) || {};
    });
  }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    // user는 Worker 진입점에서 Discord 토큰으로 검증한 값만 전달된다
    const userId = (new URL(request.url).searchParams.get('user') || '').slice(0, 64);
    if (!userId) {
      return new Response('user is required', { status: 400 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_ROOM) {
      return new Response('room is full', { status: 429 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(payload, except) {
    const out = JSON.stringify(payload);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === except) continue;
      try {
        peer.send(out);
      } catch {
        // 이미 닫힌 연결은 무시
      }
    }
  }

  async saveRoom() {
    if (this.room) await this.ctx.storage.put('room', this.room);
    else await this.ctx.storage.delete('room');
  }

  async saveDisconnected() {
    await this.ctx.storage.put('disconnected', this.disconnected);
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) return;

    // 연결당 초당 메시지 수 제한
    const now = Date.now();
    let state = this.rate.get(ws);
    if (!state || now - state.start >= 1000) {
      state = { start: now, count: 0 };
      this.rate.set(ws, state);
    }
    state.count += 1;
    if (state.count > MAX_MESSAGES_PER_SECOND) return;

    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment();
    if (!attachment || !data || typeof data !== 'object') return;
    const me = attachment.userId;

    // 왕복 시간(RTT) 측정, 연결 유지, 서버 시각 동기화(ts)
    if (data.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: Number(data.c) || 0, ts: now }));
      return;
    }

    const reply = (error) => {
      if (data.id === undefined) return;
      ws.send(JSON.stringify(error ? { t: 'error', id: data.id, message: error } : { t: 'ack', id: data.id }));
    };

    // 진행도/실수: 상태에 반영하고 다른 참가자에게 즉시 중계 (저장은 하지 않는다)
    if (data.t === 'progress' || data.t === 'mistake') {
      if (!this.room) return;
      const changed =
        data.t === 'progress' ? applyProgress(this.room, me, data, now) : applyMistake(this.room, me, data, now);
      if (!changed) return;
      const player = this.room.players[me];
      this.broadcast(
        {
          t: data.t,
          u: me,
          g: this.room.startedAt || 0, // 게임 라운드 식별자(방의 startedAt)
          p: player.progress || 0,
          m: player.mistakes || 0,
          s: player.shake || 0,
          at: Number.isFinite(data.at) ? data.at : 0, // 보낸 시각(서버 시각 기준, 지연 계측용)
        },
        ws
      );
      return;
    }

    const noRoom = { room: null, error: '존재하지 않는 방입니다.' };
    let result;
    switch (data.t) {
      case 'join':
        result = join(this.room, me, data, now, randomSeed());
        break;
      case 'ready':
        result = this.room ? setReady(this.room, me, data.v) : noRoom;
        break;
      case 'start':
        result = this.room ? startGame(this.room, me, now, randomSeed()) : noRoom;
        break;
      case 'finish':
        result = this.room ? finishGame(this.room, me, data, now) : noRoom;
        break;
      case 'giveup':
        result = this.room ? giveUp(this.room, me, now) : noRoom;
        break;
      case 'replay':
        result = this.room ? playAgain(this.room, me, data.nickname, now) : noRoom;
        break;
      case 'leave':
        result = this.room ? leave(this.room, me, typeof data.target === 'string' ? data.target : undefined, now) : { room: null };
        break;
      default:
        return;
    }

    if (result.error) {
      reply(result.error);
      return;
    }

    this.room = result.room;
    if (data.t === 'join' && this.disconnected[me]) {
      delete this.disconnected[me];
      await this.saveDisconnected();
    }
    await this.saveRoom();
    reply();
    this.broadcast({ t: 'state', room: this.room });
    if (!this.room) await this.ctx.storage.deleteAll();
  }

  async webSocketClose(ws, code) {
    try {
      // 1005/1006/1015 같은 예약 코드는 close()에 쓸 수 없으므로 정상 종료(1000)로 바꾼다
      ws.close(code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000);
    } catch {
      // 이미 닫힌 연결
    }
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws) {
    try {
      ws.close(1011);
    } catch {
      // 이미 닫힌 연결
    }
    await this.handleDisconnect(ws);
  }

  // 같은 사용자의 다른 연결이 없으면 재접속 유예 시간을 두고 정리 대상으로 표시한다
  async handleDisconnect(ws) {
    const me = ws.deserializeAttachment()?.userId;
    if (!me || !this.room?.players[me]) return;
    const stillConnected = this.ctx
      .getWebSockets()
      .some((peer) => peer !== ws && peer.deserializeAttachment()?.userId === me);
    if (stillConnected) return;
    this.disconnected[me] = Date.now();
    await this.saveDisconnected();
    await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_GRACE_MS);
  }

  async alarm() {
    const now = Date.now();
    const connected = new Set(this.ctx.getWebSockets().map((peer) => peer.deserializeAttachment()?.userId));
    let changed = false;
    let pending = false;

    for (const [me, since] of Object.entries(this.disconnected)) {
      if (connected.has(me) || !this.room?.players[me]) {
        delete this.disconnected[me];
        continue;
      }
      if (now - since < DISCONNECT_GRACE_MS - 500) {
        pending = true;
        continue;
      }
      delete this.disconnected[me];
      changed = true;
      if (this.room.status === 'waiting') {
        this.room = removePlayer(this.room, me);
        if (!this.room) break;
      } else {
        this.room.players[me].isDisconnected = true;
      }
    }

    // 아무도 접속해 있지 않으면 방을 정리한다
    if (this.ctx.getWebSockets().length === 0) this.room = null;

    if (changed || !this.room) {
      await this.saveRoom();
      this.broadcast({ t: 'state', room: this.room });
    }
    if (!this.room) {
      await this.ctx.storage.deleteAll();
      this.disconnected = {};
      return;
    }
    await this.saveDisconnected();
    if (pending) await this.ctx.storage.setAlarm(now + DISCONNECT_GRACE_MS);
  }
}

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);
    if (corsHeaders === null) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Discord 프록시를 거치면 IP가 공유되므로 IP 한도는 넉넉하게 두고, 세부 한도는 사용자(Discord ID/deviceId) 기준으로 건다.
    if (await isLimited(env, 'RL_IP', clientIp, 3000, 60 * 1000)) {
      return json({ error: 'Too many requests' }, 429);
    }

    // 0. Multiplayer WebSocket Relay (Durable Object, 방 단위)
    // (디스코드 URL 매핑은 /api 접두사를 떼고 전달하므로 /ws 로 들어온다)
    if (url.pathname === '/ws' || url.pathname.endsWith('/api/ws')) {
      const roomId = url.searchParams.get('room') || '';
      if (!ROOM_ID_PATTERN.test(roomId)) {
        return new Response('invalid room', { status: 400, headers: corsHeaders });
      }
      // WebSocket은 헤더를 붙일 수 없으므로 토큰을 쿼리로 받는다
      const discordId = await verifyDiscordToken(url.searchParams.get('token') || '');
      if (!discordId) {
        return new Response('unauthorized', { status: 401, headers: corsHeaders });
      }
      const verifiedUrl = new URL(request.url);
      verifiedUrl.searchParams.delete('token');
      verifiedUrl.searchParams.set('user', `discord_${discordId}`);
      return env.ROOM_RELAY.get(env.ROOM_RELAY.idFromName(roomId)).fetch(new Request(verifiedUrl, request));
    }

    // 1. Leaderboard Read Proxy
    if (url.pathname.includes('leaderboard')) {
      const seed = url.searchParams.get('seed') || '20260915';
      if (!SEED_PATTERN.test(seed)) {
        return json({ error: 'Invalid seed' }, 400);
      }
      try {
        // 목록 API는 정렬 없이 문서 ID 순으로 100개만 주므로, 웹 SDK(LeaderboardScreen)와 같게 time 오름차순 상위 50개를 질의한다.
        const firestoreRes = await fetch(
          `${FIRESTORE_BASE}/leaderboard/${encodeURIComponent(seed)}:runQuery`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'scores' }],
                orderBy: [{ field: { fieldPath: 'time' }, direction: 'ASCENDING' }],
                limit: 50,
              },
            }),
          }
        );
        if (!firestoreRes.ok) {
          return json({ success: true, scores: [] });
        }
        const data = await firestoreRes.json();
        const fetchedScores = (data || []).filter((item) => item.document).map(({ document: doc }) => {
          const f = doc.fields || {};
          return {
            id: doc.name.split('/').pop(),
            deviceId: f.deviceId?.stringValue || '',
            nickname: f.nickname?.stringValue || '익명',
            time: Number(f.time?.doubleValue ?? f.time?.integerValue ?? 0),
            mistakes: Number(f.mistakes?.integerValue ?? 0),
            hasBackupCode: !!f.hasBackupCode?.booleanValue,
            timestamp: f.timestamp?.timestampValue || null,
          };
        });

        fetchedScores.forEach((item, idx) => {
          item.rank = idx + 1;
        });

        return json({ success: true, scores: fetchedScores });
      } catch {
        return json({ success: false, error: 'Failed to load leaderboard', scores: [] }, 500);
      }
    }

    // 2. Score Save Proxy
    if (url.pathname.includes('save-score')) {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }

      try {
        const parsed = await readJsonBody(request);
        if (parsed.tooLarge) return json({ error: 'Payload too large' }, 413);
        if (parsed.invalid || !isPlainObject(parsed.value)) return json({ error: 'Invalid JSON' }, 400);
        const { seed, deviceId, nickname, time, mistakes, hasBackupCode } = parsed.value;

        const cleanNickname = cleanText(nickname, MAX_NICKNAME_LENGTH);
        const cleanDeviceId = typeof deviceId === 'string' && ID_PATTERN.test(deviceId) ? deviceId : 'unknown';
        const timeSec = Number(time);
        const mistakeCount = mistakes == null ? 0 : Number(mistakes);

        if (typeof seed !== 'string' || !SEED_PATTERN.test(seed) || !cleanNickname || !Number.isFinite(timeSec)) {
          return json({ error: 'Missing or invalid score parameters' }, 400);
        }
        // 클라이언트 시간대 차이(±14시간)를 고려해 오늘 기준 ±2일 이내의 시드만 허용한다
        const seedDate = Date.UTC(Number(seed.slice(0, 4)), Number(seed.slice(4, 6)) - 1, Number(seed.slice(6, 8)));
        if (Number.isNaN(seedDate) || Math.abs(seedDate - Date.now()) > 2 * 24 * 60 * 60 * 1000) {
          return json({ error: 'Invalid seed date' }, 400);
        }
        if (timeSec < 2 || timeSec > 3600 || !Number.isInteger(mistakeCount) || mistakeCount < 0 || mistakeCount > 9999) {
          return json({ error: 'Invalid score values' }, 400);
        }
        if (await isLimited(env, 'RL_SCORE', `${clientIp}:${cleanDeviceId}`, 10, 60 * 1000)) {
          return json({ error: 'Too many requests' }, 429);
        }

        const firestorePost = await fetch(
          `${FIRESTORE_BASE}/leaderboard/${seed}/scores`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                deviceId: { stringValue: cleanDeviceId },
                nickname: { stringValue: cleanNickname },
                time: { doubleValue: timeSec },
                mistakes: { integerValue: String(mistakeCount) },
                hasBackupCode: { booleanValue: hasBackupCode === true },
                timestamp: { timestampValue: new Date().toISOString() },
              },
            }),
          }
        );

        const postData = await firestorePost.json();
        if (!firestorePost.ok) {
          return json({ error: 'Failed to write to Firestore' }, firestorePost.status);
        }

        return json({
          success: true,
          id: postData.name ? postData.name.split('/').pop() : null,
        });
      } catch {
        return json({ error: 'Failed to save score' }, 500);
      }
    }

    // 3. User Profile Read & Write Proxy (for Discord Activity CSP safety)
    if (url.pathname.includes('user-profile')) {
      // GET: Query user by discordId or document ID
      if (request.method === 'GET') {
        const discordId = url.searchParams.get('discordId');
        const docId = url.searchParams.get('id');

        if (!discordId && !docId) {
          return json({ error: 'discordId or id is required' }, 400);
        }
        if ((discordId && !DISCORD_ID_PATTERN.test(discordId)) || (docId && !ID_PATTERN.test(docId))) {
          return json({ error: 'Invalid identifier' }, 400);
        }

        try {
          if (discordId) {
            const queryRes = await fetch(
              `${FIRESTORE_BASE}:runQuery`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  structuredQuery: {
                    from: [{ collectionId: 'users' }],
                    where: {
                      fieldFilter: {
                        field: { fieldPath: 'discordId' },
                        op: 'EQUAL',
                        value: { stringValue: discordId },
                      },
                    },
                    limit: 20,
                  },
                }),
              }
            );

            const queryData = await queryRes.json();
            const docs = (queryData || [])
              .filter((item) => item.document && item.document.fields)
              .map((item) => {
                const parsed = parseFirestoreFields(item.document.fields);
                parsed.id = item.document.name.split('/').pop();
                return parsed;
              });

            docs.sort((a, b) => (b.totalPlayCount || 0) - (a.totalPlayCount || 0));
            const bestDoc = docs[0] || null;

            return json({ success: true, profile: bestDoc });
          } else {
            const docRes = await fetch(`${FIRESTORE_BASE}/users/${docId}`);
            if (!docRes.ok) {
              return json({ success: true, profile: null });
            }
            const docData = await docRes.json();
            const parsed = parseFirestoreFields(docData.fields);
            parsed.id = docId;
            return json({ success: true, profile: parsed });
          }
        } catch {
          return json({ error: 'Failed to load profile' }, 500);
        }
      }

      // POST: Save/Merge user profile (Discord 토큰으로 본인 확인 필요)
      if (request.method === 'POST') {
        try {
          const discordId = await verifyDiscordToken(getBearerToken(request));
          if (!discordId) {
            return json({ error: 'Unauthorized' }, 401);
          }
          if (await isLimited(env, 'RL_PROFILE', discordId, 60, 60 * 1000)) {
            return json({ error: 'Too many requests' }, 429);
          }

          const parsed = await readJsonBody(request);
          if (parsed.tooLarge) return json({ error: 'Payload too large' }, 413);
          if (parsed.invalid || !isPlainObject(parsed.value)) return json({ error: 'Invalid JSON' }, 400);
          const body = parsed.value;
          const docId = body.id || url.searchParams.get('id');
          const profile = body.profile || body;

          if (typeof docId !== 'string' || !ID_PATTERN.test(docId)) {
            return json({ error: 'User id is required' }, 400);
          }
          // 다른 Discord 계정 전용 문서 ID(discord_<id>)는 쓸 수 없다
          if (docId.startsWith('discord_') && docId !== `discord_${discordId}`) {
            return json({ error: 'Forbidden' }, 403);
          }

          const profileFields = { ...profile };
          delete profileFields.id;
          const invalid = validateProfile(profileFields);
          if (invalid) return json({ error: invalid }, 400);
          if (profileFields.discordId !== undefined && String(profileFields.discordId) !== discordId) {
            return json({ error: 'Forbidden' }, 403);
          }

          // 이미 다른 Discord 계정에 연동된 문서는 덮어쓸 수 없다
          const existingRes = await fetch(`${FIRESTORE_BASE}/users/${encodeURIComponent(docId)}`);
          if (existingRes.ok) {
            const existing = parseFirestoreFields((await existingRes.json()).fields);
            if (existing.discordId && String(existing.discordId) !== discordId) {
              return json({ error: 'Forbidden' }, 403);
            }
          }

          // 검증된 Discord ID를 문서에 항상 기록해 소유자를 고정한다
          const fields = toFirestoreFields({ ...profileFields, discordId });
          const fieldPaths = Object.keys(fields);

          // updateMask 없이 PATCH하면 문서 전체가 교체되므로, 전달된 최상위 필드만 갱신한다.
          const maskQuery = fieldPaths
            .map((k) => `updateMask.fieldPaths=${encodeURIComponent('`' + k.replace(/[\\`]/g, '\\$&') + '`')}`)
            .join('&');
          const updateRes = await fetch(
            `${FIRESTORE_BASE}/users/${encodeURIComponent(docId)}?${maskQuery}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields }),
            }
          );

          if (!updateRes.ok) {
            return json({ error: 'Firestore update failed' }, updateRes.status);
          }

          return json({ success: true, id: docId });
        } catch {
          return json({ error: 'Failed to save profile' }, 500);
        }
      }
    }

    // 4. Realtime Database Proxy (for Multiplayer in Discord Activity)
    if (url.pathname.includes('rtdb')) {
      const discordId = await verifyDiscordToken(getBearerToken(request));
      if (!discordId) {
        return json({ error: 'Unauthorized' }, 401);
      }
      // 폴링(250ms)과 진행도 전송이 겹치므로 사용자당 분당 1500회(초당 약 25회)까지 허용한다
      if (await isLimited(env, 'RL_RTDB', discordId, 1500, 60 * 1000)) {
        return json({ error: 'Too many requests' }, 429);
      }

      const target = parseRtdbPath(url.searchParams.get('path') || '');
      if (!target) {
        return json({ error: 'Invalid path' }, 400);
      }

      const method = request.method;
      const me = `discord_${discordId}`;
      const targetUrl = `${RTDB_BASE}/${target.clean}.json`;

      try {
        if (method === 'GET') {
          const rRes = await fetch(targetUrl);
          return json(await rRes.json());
        }

        if (method === 'PUT' || method === 'PATCH') {
          const parsed = await readJsonBody(request);
          if (parsed.tooLarge) return json({ error: 'Payload too large' }, 413);
          if (parsed.invalid) return json({ error: 'Invalid JSON' }, 400);
          const body = parsed.value;

          if (target.kind === 'clock') {
            // 서버 시각 측정용 서버 타임스탬프 플레이스홀더만 허용
            if (method !== 'PUT' || !isPlainObject(body) || body['.sv'] !== 'timestamp') {
              return json({ error: 'Forbidden' }, 403);
            }
          } else if (target.kind === 'players') {
            return json({ error: 'Forbidden' }, 403);
          } else {
            const roomRes = await fetch(`${RTDB_BASE}/rooms/${target.room}.json`);
            const room = roomRes.ok ? await roomRes.json() : null;
            const isMember = !!room?.players?.[me];
            const isHost = room?.host === me;

            if (target.kind === 'room') {
              if (!isPlainObject(body)) return json({ error: 'Invalid body' }, 400);
              if (method === 'PUT') {
                // 방 생성(또는 끝난 음성 채널 방 재생성)은 본인을 방장으로 해서만 가능
                const canCreate = !room || room.status === 'finished' || isHost;
                if (!canCreate || body.host !== me) return json({ error: 'Forbidden' }, 403);
              } else if (!isMember && !isHost) {
                return json({ error: 'Forbidden' }, 403);
              }
            } else if (target.pid !== me && !isMember) {
              // 다른 플레이어 항목은 같은 방 참가자만 수정할 수 있다 (연결 끊긴 플레이어 정리, 방장 승계 등)
              return json({ error: 'Forbidden' }, 403);
            }
          }

          const pRes = await fetch(targetUrl, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: parsed.text || '{}',
          });
          if (!pRes.ok) {
            return json({ error: 'Realtime Database rejected the write' }, pRes.status);
          }
          return json(await pRes.json());
        }

        if (method === 'DELETE') {
          if (target.kind === 'clock' || target.kind === 'players') {
            return json({ error: 'Forbidden' }, 403);
          }
          const roomRes = await fetch(`${RTDB_BASE}/rooms/${target.room}.json`);
          const room = roomRes.ok ? await roomRes.json() : null;
          if (room && !room.players?.[me] && room.host !== me && target.pid !== me) {
            return json({ error: 'Forbidden' }, 403);
          }
          await fetch(targetUrl, { method: 'DELETE' });
          return json({ success: true });
        }

        return json({ error: 'Method not allowed' }, 405);
      } catch {
        return json({ error: 'Realtime Database request failed' }, 500);
      }
    }

    // 5. Discord OAuth2 Token Exchange
    if (request.method === 'POST' && (url.pathname.includes('discord-auth') || url.pathname === '/api' || url.pathname === '/')) {
      try {
        const parsed = await readJsonBody(request);
        if (parsed.tooLarge) return json({ error: 'Payload too large' }, 413);
        if (parsed.invalid || !isPlainObject(parsed.value)) return json({ error: 'Invalid JSON' }, 400);
        const { code, redirectUri } = parsed.value;
        const clientId = env.DISCORD_CLIENT_ID;
        const clientSecret = env.DISCORD_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return json({ error: 'Server is not configured' }, 500);
        }

        if (typeof code !== 'string' || !code || code.length > 256) {
          return json({ error: 'Authorization code is required' }, 400);
        }
        if (redirectUri !== undefined && (typeof redirectUri !== 'string' || redirectUri.length > 512)) {
          return json({ error: 'Invalid redirectUri' }, 400);
        }

        const tokenParams = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: code,
        });
        if (redirectUri) {
          tokenParams.append('redirect_uri', redirectUri);
        }

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: tokenParams.toString(),
        });

        if (!tokenRes.ok) {
          return json({ error: 'Failed to exchange token with Discord' }, tokenRes.status);
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!userRes.ok) {
          return json({ error: 'Failed to fetch user from Discord' }, userRes.status);
        }

        const userData = await userRes.json();

        // 필요한 공개 프로필 필드만 돌려준다 (access_token은 Activity SDK 인증과 Worker 본인 확인에 쓰인다)
        return json({
          success: true,
          access_token: accessToken,
          user: {
            id: userData.id,
            username: userData.username,
            global_name: userData.global_name || userData.username,
            avatar: userData.avatar,
          },
        });
      } catch {
        return json({ error: 'Failed to authenticate with Discord' }, 500);
      }
    }

    return json({
      ok: true,
      message: 'Daily Arrow Discord Auth & Firestore Proxy Worker is active',
    });
  },
};
