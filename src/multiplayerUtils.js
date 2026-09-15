import { ref, set, get, update, remove, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import { rtdb } from "./firebase";
import { isDiscordActivity } from "./discordActivity";

// ============================================================
// 카운트다운 상수 (서버 타임스탬프 기반 동기화용)
// ============================================================
export const COUNTDOWN_DURATION_MS = 4000; // 3초(3→2→1) + 1초(Go!)

// ============================================================
// 클라이언트 ↔ 서버 시계 차이 측정 (방법 A)
// ============================================================
let _clockOffset = 0; // serverTime - clientTime
let _clockOffsetMeasured = false;

/**
 * Firebase 서버와 클라이언트 간 시계 차이를 측정합니다.
 * clockOffset = serverTime - clientTime
 * (양수: 서버가 앞섬, 음수: 클라이언트가 앞섬)
 */
export async function measureClockOffset() {
  if (_clockOffsetMeasured) return _clockOffset;
  try {
    if (isDiscordActivity()) {
      // 프록시를 통해 서버 타임스탬프를 기록하고 읽어 차이를 계산
      const before = Date.now();
      await rtdbFetch('_clock_sync/probe', 'PUT', {".sv": "timestamp"});
      const serverTs = await rtdbFetch('_clock_sync/probe', 'GET');
      const after = Date.now();
      if (typeof serverTs === 'number') {
        const rtt = after - before;
        _clockOffset = serverTs - (before + rtt / 2);
      }
    } else {
      // Firebase SDK: .info/serverTimeOffset 사용 (정확도 높음)
      const offsetRef = ref(rtdb, '.info/serverTimeOffset');
      const snap = await get(offsetRef);
      _clockOffset = snap.val() || 0;
    }
    _clockOffsetMeasured = true;
  } catch (e) {
    console.warn('Clock offset measurement failed:', e);
    _clockOffset = 0;
  }
  return _clockOffset;
}

/**
 * 현재 서버 시각을 추정합니다. (measureClockOffset 호출 이후 사용)
 */
export function getServerNow() {
  return Date.now() + _clockOffset;
}

// 6자리 랜덤 방 코드 생성기
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

let workingRtdbBase = null;

/**
 * Cloudflare Worker를 통한 Firebase Realtime Database REST API 프록시 호출
 * (디스코드 액티비티의 CSP WebSocket 차단 우회용)
 */
async function rtdbFetch(path, method = 'GET', data = undefined) {
  const baseAuthUrl = import.meta.env.VITE_AUTH_SERVER_URL 
    ? import.meta.env.VITE_AUTH_SERVER_URL.replace(/\/$/, '') 
    : 'https://daily-arrow-auth.daily-arrow.workers.dev';

  const candidates = workingRtdbBase 
    ? [workingRtdbBase]
    : [
        '/.proxy/api/rtdb',
        '/api/rtdb',
        `${baseAuthUrl}/api/rtdb`
      ];

  const cleanPath = path.replace(/^\//, '').replace(/\.json$/, '');
  const body = data !== undefined ? JSON.stringify(data) : undefined;

  let lastError = null;
  for (const base of candidates) {
    try {
      const url = `${base}?path=${encodeURIComponent(cleanPath)}`;
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-HTTP-Method-Override': method
        },
        body
      });
      if (res.ok) {
        workingRtdbBase = base;
        return await res.json();
      }
    } catch (e) {
      lastError = e;
    }
  }
  if (workingRtdbBase) {
    workingRtdbBase = null;
    return rtdbFetch(path, method, data);
  }
  throw lastError || new Error(`RTDB fetch failed for ${path}`);
}

/**
 * 방 데이터 단일 조회
 */
export async function getRoomData(roomId) {
  if (!roomId) return null;
  if (isDiscordActivity()) {
    try {
      return await rtdbFetch(`rooms/${roomId}`, 'GET');
    } catch (e) {
      console.warn("getRoomData error:", e);
      return null;
    }
  } else {
    try {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const snap = await get(roomRef);
      return snap.exists() ? snap.val() : null;
    } catch (e) {
      console.warn("getRoomData SDK error:", e);
      return null;
    }
  }
}

/**
 * 방 플레이어 목록 조회 (킥 타임아웃 등)
 */
export async function getRoomPlayers(roomId) {
  if (!roomId) return {};
  if (isDiscordActivity()) {
    try {
      const players = await rtdbFetch(`rooms/${roomId}/players`, 'GET');
      return players || {};
    } catch (e) {
      return {};
    }
  } else {
    try {
      const snap = await get(ref(rtdb, `rooms/${roomId}/players`));
      return snap.exists() ? (snap.val() || {}) : {};
    } catch (e) {
      return {};
    }
  }
}

/**
 * 방 데이터 실시간 구독
 * - 웹: Firebase SDK의 네이티브 onValue (WebSocket)
 * - 디스코드: 적응형 HTTP 폴링 (게임 중 250ms, 대기 중 600ms)
 *   + Discord URL Mapping WebSocket 프록시 우선 시도 → 실패 시 폴링 fallback
 */
export function subscribeRoom(roomId, callback, options = {}) {
  if (!roomId) return () => {};

  const {
    playingIntervalMs = 250,  // 게임 중 폴링 주기 (방법 B)
    waitingIntervalMs = 600   // 대기 중 폴링 주기
  } = typeof options === 'number' ? { waitingIntervalMs: options } : options;

  if (isDiscordActivity()) {
    // === 방법 C: Discord URL Mapping WebSocket 프록시 시도 ===
    let wsSuccess = false;
    let wsUnsub = null;
    let pollUnsub = null;
    let wsTimeoutId = null;

    // WebSocket 프록시 시도 (/.proxy/rtdb/ 경로)
    // 현재 Discord URL Mapping의 WebSocket 프록시는 안정성이 보장되지 않으므로
    // 바로 적응형 HTTP 폴링으로 진행합니다.
    // Discord에서 RTDB WebSocket 프록시가 안정적으로 지원되면 이 부분을 활성화합니다.
    try {
      // TODO: Discord URL Mapping WebSocket 프록시 활성화 시 여기에 구현
      throw new Error('Skip WS proxy — use adaptive polling');
    } catch (wsErr) {
      // === 방법 B: 적응형 HTTP 폴링 (Adaptive Polling) ===
      let active = true;
      let timer = null;
      let currentInterval = waitingIntervalMs;

      const poll = async () => {
        if (!active) return;
        try {
          const data = await rtdbFetch(`rooms/${roomId}`, 'GET');
          if (active) {
            // 적응형 주기 전환: playing 상태면 빠르게, 아니면 느리게
            if (data?.status === 'playing') {
              currentInterval = playingIntervalMs;
            } else {
              currentInterval = waitingIntervalMs;
            }
            callback(data);
          }
        } catch (e) {
          console.warn('[Multiplayer Polling Error]:', e);
        }
        if (active) {
          timer = setTimeout(poll, currentInterval);
        }
      };

      // 첫 데이터 즉시 조회
      poll();

      pollUnsub = () => {
        active = false;
        if (timer) clearTimeout(timer);
      };
    }

    return () => {
      if (wsTimeoutId) clearTimeout(wsTimeoutId);
      if (wsUnsub) wsUnsub();
      if (pollUnsub) pollUnsub();
    };
  } else {
    // 일반 웹 환경: 네이티브 Firebase onValue (WebSocket)
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.val());
      } else {
        callback(null);
      }
    }, (err) => {
      console.warn("RTDB onValue error:", err);
    });

    return unsubscribe;
  }
}

// 방 생성 (Host)
export async function createRoom(hostUserId, hostNickname) {
  const roomId = generateRoomCode();
  const finalUserId = hostUserId || ('user_' + Math.random().toString(36).substring(2, 9));
  const finalNickname = hostNickname || 'Guest 1';
  const randomSeed = Math.random().toString(36).substring(2, 10);

  const roomData = {
    host: finalUserId,
    status: 'waiting', // waiting, playing, finished
    seed: randomSeed,
    createdAt: Date.now(),
    players: {
      [finalUserId]: {
        nickname: finalNickname,
        isReady: true,
        progress: 0,
        mistakes: 0,
        shake: 0,
        finishedAt: null,
        finalTime: null,
        rank: null,
        isDisconnected: false
      }
    }
  };

  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}`, 'PUT', roomData);
    return roomId;
  } else {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const setPromise = set(roomRef, roomData);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('서버 응답 시간 초과 (네트워크 또는 권한 오류)')), 7000)
    );
    await Promise.race([setPromise, timeoutPromise]);
    
    try {
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${finalUserId}`);
      onDisconnect(playerRef).update({ isDisconnected: true });
    } catch (discErr) {
      console.warn("onDisconnect setup warning:", discErr);
    }

    return roomId;
  }
}

// 디스코드 음성 채널 전용 자동 방 생성/입장
export async function getOrCreateVoiceChannelRoom(channelId, userId, nickname) {
  if (!channelId) throw new Error('음성 채널 정보가 없습니다.');
  const safeChannel = channelId.replace(/[^a-zA-Z0-9]/g, '');
  const roomId = `VC${safeChannel.slice(-6).toUpperCase()}`;
  const finalNickname = nickname || 'Player';

  const currentRoom = await getRoomData(roomId);

  if (!currentRoom || currentRoom.status === 'finished') {
    const randomSeed = Math.random().toString(36).substring(2, 10);
    const roomData = {
      host: userId,
      status: 'waiting',
      seed: randomSeed,
      isDiscordVoiceRoom: true,
      channelId: channelId,
      createdAt: Date.now(),
      players: {
        [userId]: {
          nickname: finalNickname,
          isReady: true,
          progress: 0,
          mistakes: 0,
          shake: 0,
          finishedAt: null,
          finalTime: null,
          rank: null,
          isDisconnected: false
        }
      }
    };
    if (isDiscordActivity()) {
      await rtdbFetch(`rooms/${roomId}`, 'PUT', roomData);
    } else {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await set(roomRef, roomData);
      try {
        const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
        onDisconnect(playerRef).update({ isDisconnected: true });
      } catch (e) {}
    }
    return roomId;
  } else {
    const players = currentRoom.players || {};
    if (players[userId]) {
      return roomId;
    }

    if (currentRoom.status !== 'waiting') {
      throw new Error('음성 통화방에서 이미 게임이 진행 중입니다. 라운드가 끝난 후 입장해 주세요.');
    }

    if (Object.keys(players).length >= 4) {
      throw new Error('방 정원(최대 4명)이 가득 찼습니다.');
    }

    const newPlayerData = {
      nickname: finalNickname,
      isReady: false,
      progress: 0,
      mistakes: 0,
      shake: 0,
      finishedAt: null,
      finalTime: null,
      rank: null,
      isDisconnected: false
    };

    if (isDiscordActivity()) {
      await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PUT', newPlayerData);
    } else {
      const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
      await set(playerRef, newPlayerData);
      try {
        onDisconnect(playerRef).update({ isDisconnected: true });
      } catch (e) {}
    }
    return roomId;
  }
}

// 방 입장 (Guest)
export async function joinRoom(roomId, userId, nickname) {
  const roomData = await getRoomData(roomId);

  if (!roomData) {
    throw new Error('존재하지 않는 방입니다.');
  }
  
  if (roomData.status !== 'waiting') {
    throw new Error('이미 게임이 시작되었거나 종료된 방입니다.');
  }

  const players = roomData.players || {};
  const playerCount = Object.keys(players).length;

  if (playerCount >= 4) {
    throw new Error('방 인원이 꽉 찼습니다. (최대 4명)');
  }

  let finalNickname = nickname;
  if (!finalNickname) {
    let anonCount = 0;
    for (const pid in players) {
      if (players[pid].nickname && players[pid].nickname.startsWith('Guest')) {
        anonCount++;
      }
    }
    finalNickname = `Guest ${anonCount + 1}`;
  }

  const newPlayerData = {
    nickname: finalNickname,
    isReady: false,
    progress: 0,
    mistakes: 0,
    shake: 0,
    finishedAt: null,
    finalTime: null,
    rank: null,
    isDisconnected: false
  };

  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PUT', newPlayerData);
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await set(playerRef, newPlayerData);
    try {
      onDisconnect(playerRef).update({ isDisconnected: true });
    } catch (e) {}
  }

  return roomId;
}

// 준비 상태 토글
export async function toggleReady(roomId, userId, isReady) {
  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', { isReady });
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, { isReady });
  }
}

// 방 나가기
export async function leaveRoom(roomId, userId) {
  const roomData = await getRoomData(roomId);
  
  if (roomData) {
    const players = roomData.players || {};
    const remainingUserIds = Object.keys(players).filter(id => id !== userId);
    
    if (remainingUserIds.length === 0) {
      // 아무도 남지 않으면 방 삭제
      if (isDiscordActivity()) {
        await rtdbFetch(`rooms/${roomId}`, 'DELETE');
      } else {
        await remove(ref(rtdb, `rooms/${roomId}`));
      }
      return;
    }

    if (isDiscordActivity()) {
      await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'DELETE');
      if (roomData.host === userId) {
        let nextHost = remainingUserIds.find(id => players[id]?.wantsReplay);
        if (!nextHost) nextHost = remainingUserIds[0];
        await rtdbFetch(`rooms/${roomId}`, 'PATCH', { host: nextHost });
        await rtdbFetch(`rooms/${roomId}/players/${nextHost}`, 'PATCH', { isReady: true });
      }
    } else {
      const roomRef = ref(rtdb, `rooms/${roomId}`);
      const updates = {};
      updates[`players/${userId}`] = null;
      if (roomData.host === userId) {
        let nextHost = remainingUserIds.find(id => players[id]?.wantsReplay);
        if (!nextHost) nextHost = remainingUserIds[0];
        updates[`host`] = nextHost;
        updates[`players/${nextHost}/isReady`] = true;
      }
      await update(roomRef, updates);
    }
  } else {
    if (isDiscordActivity()) {
      await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'DELETE').catch(() => {});
    } else {
      await remove(ref(rtdb, `rooms/${roomId}/players/${userId}`)).catch(() => {});
    }
  }
}

// 게임 시작 (방법 A: 서버 타임스탬프 기반)
export async function startGame(roomId) {
  const randomSeed = Math.random().toString(36).substring(2, 10);

  if (isDiscordActivity()) {
    // 디스코드 프록시 환경: RTDB REST API의 서버 타임스탬프 사용
    // 먼저 서버 타임스탬프를 기록한 뒤 읽어옴
    const startUpdates = { 
      status: 'playing',
      seed: randomSeed,
      startedAt: {".sv": "timestamp"},
      countdownDuration: COUNTDOWN_DURATION_MS,
      replayStartedAt: null
    };
    await rtdbFetch(`rooms/${roomId}`, 'PATCH', startUpdates);
    const roomData = await getRoomData(roomId);
    if (roomData && roomData.players) {
      for (const pid in roomData.players) {
        if (roomData.players[pid]?.wantsReplay) {
          await rtdbFetch(`rooms/${roomId}/players/${pid}`, 'PATCH', { wantsReplay: null });
        }
      }
    }
  } else {
    // 일반 웹 환경: Firebase SDK serverTimestamp 사용
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    await update(roomRef, {
      status: 'playing',
      seed: randomSeed,
      startedAt: serverTimestamp(),
      countdownDuration: COUNTDOWN_DURATION_MS,
      replayStartedAt: null
    });
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      const players = snapshot.val().players || {};
      const updates = {};
      for (const pid in players) {
        updates[`players/${pid}/wantsReplay`] = null;
      }
      await update(roomRef, updates);
    }
  }
}

// 인게임 진행도 실시간 전송 (Coalesced Batching)
let pendingProgress = null;
let isUpdatingProgress = false;

export async function updateProgress(roomId, userId, progress) {
  if (isDiscordActivity()) {
    pendingProgress = progress;
    if (isUpdatingProgress) return;
    isUpdatingProgress = true;
    try {
      while (pendingProgress !== null) {
        const toSend = pendingProgress;
        pendingProgress = null;
        await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', { progress: toSend });
      }
    } catch (e) {
      console.warn("updateProgress error:", e);
    } finally {
      isUpdatingProgress = false;
    }
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, { progress });
  }
}

// 인게임 실수(오답) 전송
export async function triggerMistake(roomId, userId, currentMistakes) {
  const mistakeData = { 
    mistakes: currentMistakes,
    shake: Date.now()
  };
  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', mistakeData).catch(() => {});
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, mistakeData).catch(() => {});
  }
}

// 개인 게임 완료 (Rank 배정 로직 포함)
export async function finishGame(roomId, userId, finalTime, mistakes) {
  const roomData = await getRoomData(roomId);
  if (!roomData) return;

  const players = roomData.players || {};
  let finishedCount = 0;
  for (const pid in players) {
    if (players[pid]?.finishedAt) {
      finishedCount++;
    }
  }
  
  const myRank = finishedCount + 1;
  const finishData = {
    progress: 50,
    finishedAt: Date.now(),
    finalTime,
    mistakes,
    rank: myRank
  };

  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', finishData);
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, finishData);
  }
}

// 자발적 게임 포기
export async function giveUpGame(roomId, userId) {
  const roomData = await getRoomData(roomId);
  if (!roomData) return;
  
  const players = roomData.players || {};
  const totalPlayers = Object.keys(players).length;

  const giveUpData = {
    isDisconnected: true,
    gaveUpAt: Date.now(),
    rank: totalPlayers
  };

  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', giveUpData);
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, giveUpData);
  }
}

// 로비로 돌아가기 (다시하기)
export async function playAgain(roomId, userId, nickname) {
  const roomData = await getRoomData(roomId);
  if (!roomData) return;

  const isHost = roomData.host === userId;
  let finalNickname = nickname || 'Guest';
  if (roomData.players?.[userId]?.nickname) {
    finalNickname = roomData.players[userId].nickname;
  }

  const replayPlayerData = {
    nickname: finalNickname,
    isReady: isHost,
    progress: 0,
    mistakes: 0,
    shake: 0,
    finishedAt: null,
    finalTime: null,
    rank: null,
    wantsReplay: true
  };

  if (isDiscordActivity()) {
    await rtdbFetch(`rooms/${roomId}/players/${userId}`, 'PATCH', replayPlayerData);
    if (roomData.status !== 'waiting') {
      const currentPlayers = roomData.players || {};
      for (const pid in currentPlayers) {
        if (currentPlayers[pid]?.isDisconnected) {
          await leaveRoom(roomId, pid);
        }
      }
      await rtdbFetch(`rooms/${roomId}`, 'PATCH', { 
        status: 'waiting',
        replayStartedAt: Date.now()
      });
    }
  } else {
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await update(playerRef, replayPlayerData);

    if (roomData.status !== 'waiting') {
      const currentPlayers = roomData.players || {};
      for (const pid in currentPlayers) {
        if (currentPlayers[pid]?.isDisconnected) {
          await leaveRoom(roomId, pid);
        }
      }

      const roomRef = ref(rtdb, `rooms/${roomId}`);
      await update(roomRef, { 
        status: 'waiting',
        replayStartedAt: Date.now()
      });
    }
  }
}
