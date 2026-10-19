// 디스코드 액티비티 전용: 방 단위 WebSocket 연결 관리.
// 방 상태의 기준은 Worker의 Durable Object(RoomRelay)이며, 이 모듈은 하나의 방에 대한 연결을 유지하면서
// 상태 스냅샷(state)과 상대의 진행도/실수(progress, mistake) 이벤트를 화면 쪽에 전달한다.
// 연결이 끊기면 자동으로 재접속하고 마지막 join 요청을 다시 보내 같은 방에 복귀한다.
import { getDiscordAccessToken } from './discordActivity';

const PING_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
const OPEN_TIMEOUT_MS = 8000;
const MAX_FAILURES = 6;

let current = null; // { roomId, userId, socket, opened, joinMsg, ... }
let latestRoom; // undefined: 아직 상태를 못 받음, null: 방이 사라짐, object: 방 상태
let lastRtt = null;
let lastPongAt = 0;
let nextRequestId = 1;
const pending = new Map(); // 요청 id -> { resolve, reject, timer }
const pongWaiters = new Map(); // ping 식별값 -> resolve
const stateListeners = new Set();
const eventListeners = new Set();
const rttListeners = new Set();

function wsBases() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return [
    `${proto}://${window.location.host}/.proxy/api/ws`,
    `${proto}://${window.location.host}/api/ws`,
  ];
}

function emitState(room) {
  latestRoom = room;
  for (const listener of stateListeners) listener(room);
}

function failPending(message) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
    pending.delete(id);
  }
}

function handleMessage(conn, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.t) {
    case 'state':
      emitState(msg.room || null);
      break;
    case 'ack':
    case 'error': {
      const entry = pending.get(msg.id);
      if (!entry) break;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.t === 'ack') entry.resolve();
      else entry.reject(new Error(msg.message || '요청을 처리하지 못했습니다.'));
      break;
    }
    case 'pong': {
      lastPongAt = Date.now();
      conn.failures = 0; // 서버와 실제로 통신이 확인된 뒤에만 실패 횟수를 초기화
      const waiter = pongWaiters.get(msg.c);
      if (waiter) {
        pongWaiters.delete(msg.c);
        waiter(msg.ts);
      }
      lastRtt = performance.now() - msg.c;
      for (const listener of rttListeners) listener(lastRtt);
      break;
    }
    case 'progress':
    case 'mistake':
      for (const listener of eventListeners) listener(msg);
      break;
    default:
  }
}

function connect(conn) {
  if (conn.closed) return;
  let socket;
  try {
    const token = getDiscordAccessToken();
    const query = `?room=${encodeURIComponent(conn.roomId)}&user=${encodeURIComponent(conn.userId)}&token=${encodeURIComponent(token || '')}`;
    socket = new WebSocket(wsBases()[conn.baseIndex] + query);
  } catch {
    scheduleRetry(conn, false);
    return;
  }
  conn.socket = socket;
  let opened = false;

  socket.onopen = () => {
    opened = true;
    const ping = () => {
      if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'ping', c: performance.now() }));
    };
    ping();
    conn.pingTimer = setInterval(ping, PING_INTERVAL_MS);
    if (conn.joinMsg) {
      // 재접속: 같은 방에 다시 참가시킨다 (서버가 재접속으로 처리)
      socket.send(JSON.stringify(conn.joinMsg));
    }
    if (conn.onOpen) {
      conn.onOpen();
      conn.onOpen = null;
    }
  };
  socket.onmessage = (e) => handleMessage(conn, e.data);
  socket.onclose = () => {
    clearInterval(conn.pingTimer);
    scheduleRetry(conn, opened);
  };
  socket.onerror = () => {}; // 재시도는 onclose에서 처리
}

function scheduleRetry(conn, opened) {
  clearInterval(conn.pingTimer);
  if (conn.closed) return;
  // 한 번도 열리지 못했다면 다음 경로(/api/ws)를 시도
  if (!opened) conn.baseIndex = (conn.baseIndex + 1) % wsBases().length;
  conn.failures += 1;
  if (conn.failures > MAX_FAILURES) {
    // 복구할 수 없으면 방이 끊어진 것으로 알려 화면이 로비로 돌아가게 한다
    emitState(null);
    return;
  }
  conn.retryTimer = setTimeout(() => connect(conn), Math.min(1000 * conn.failures, 5000));
}

/** 현재 방 연결을 닫고 상태를 초기화한다. */
export function closeRoomConnection() {
  if (!current) return;
  const conn = current;
  current = null;
  conn.closed = true;
  clearInterval(conn.pingTimer);
  clearTimeout(conn.retryTimer);
  if (conn.socket) {
    try {
      conn.socket.close();
    } catch {
      // 이미 닫힌 연결
    }
  }
  failPending('연결이 종료되었습니다.');
  latestRoom = undefined;
}

function ensureOpen(roomId, userId) {
  if (current && current.roomId === roomId && current.userId === userId && !current.closed) {
    if (current.socket && current.socket.readyState === 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('실시간 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.')), OPEN_TIMEOUT_MS);
      const prev = current.onOpen;
      current.onOpen = () => {
        clearTimeout(timer);
        if (prev) prev();
        resolve();
      };
    });
  }
  closeRoomConnection();
  const conn = { roomId, userId, socket: null, baseIndex: 0, failures: 0, closed: false, joinMsg: null, onOpen: null };
  current = conn;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      closeRoomConnection();
      reject(new Error('실시간 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    }, OPEN_TIMEOUT_MS);
    conn.onOpen = () => {
      clearTimeout(timer);
      resolve();
    };
    connect(conn);
  });
}

/** 메시지를 보내고 서버의 ack/error를 기다린다. */
export function requestRoom(message) {
  const conn = current;
  if (!conn || !conn.socket || conn.socket.readyState !== 1) {
    return Promise.reject(new Error('방과 연결되어 있지 않습니다.'));
  }
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('서버 응답 시간 초과'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    conn.socket.send(JSON.stringify({ ...message, id }));
  });
}

/** 응답이 필요 없는 메시지(진행도, 실수 등)를 보낸다. 연결이 없으면 무시한다. */
export function sendRoom(message) {
  const conn = current;
  if (conn && conn.socket && conn.socket.readyState === 1) {
    conn.socket.send(JSON.stringify(message));
  }
}

/** 방에 연결하고 참가(또는 생성)한다. 실패하면 서버가 준 한국어 메시지로 예외를 던진다. */
export async function enterRoom(roomId, userId, { nickname, create = false, voice = false, channelId } = {}) {
  await ensureOpen(roomId, userId);
  latestRoom = undefined;
  try {
    await requestRoom({ t: 'join', nickname, create, voice, channelId });
  } catch (e) {
    closeRoomConnection();
    throw e;
  }
  // 재접속 시에는 새로 만들지 않고 같은 방에 다시 참가만 한다
  if (current) current.joinMsg = { t: 'join', nickname, voice, channelId };
}

export function getCurrentRoomId() {
  return current ? current.roomId : null;
}

export function getLatestRoom() {
  return latestRoom;
}

/** 방 상태 구독. 이미 받은 상태가 있으면 즉시 한 번 전달한다. */
export function subscribeRoomState(callback) {
  stateListeners.add(callback);
  if (latestRoom !== undefined) callback(latestRoom);
  return () => stateListeners.delete(callback);
}

/** 상대의 progress/mistake 이벤트 구독 */
export function subscribeRoomEvents(callback) {
  eventListeners.add(callback);
  return () => eventListeners.delete(callback);
}

export function subscribeRtt(callback) {
  rttListeners.add(callback);
  return () => rttListeners.delete(callback);
}

/** 최근 pong을 받았다면 중계 연결이 정상이다. */
export function isRoomConnectionHealthy() {
  return Date.now() - lastPongAt < PING_INTERVAL_MS * 2 + 2000;
}

/** 서버 시각 - 클라이언트 시각 차이(ms)를 ping 왕복으로 측정한다. 가장 빠른 왕복의 샘플을 쓴다. */
export async function measureServerOffset(samples = 5) {
  const conn = current;
  if (!conn || !conn.socket || conn.socket.readyState !== 1) return null;
  let best = null;
  for (let i = 0; i < samples; i++) {
    const sentAt = performance.now();
    const wallBefore = Date.now();
    const serverTs = await new Promise((resolve) => {
      const key = sentAt;
      pongWaiters.set(key, resolve);
      setTimeout(() => {
        if (pongWaiters.delete(key)) resolve(null);
      }, 2000);
      try {
        conn.socket.send(JSON.stringify({ t: 'ping', c: key }));
      } catch {
        resolve(null);
      }
    });
    if (typeof serverTs !== 'number') continue;
    const rtt = performance.now() - sentAt;
    if (!best || rtt < best.rtt) best = { rtt, offset: serverTs - (wallBefore + rtt / 2) };
  }
  return best ? best.offset : null;
}
