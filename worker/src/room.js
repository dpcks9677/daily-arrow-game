// 멀티플레이 방 상태 로직 (순수 함수). RoomRelay Durable Object가 방 상태의 기준(source of truth)으로 쓴다.
// 방/플레이어 데이터 모양은 기존 RTDB 방과 같다. (null 값은 RTDB처럼 필드를 생략한다)

export const MAX_PLAYERS = 4;
export const COUNTDOWN_DURATION_MS = 4000;
export const MAX_NICKNAME_LENGTH = 50;
// 한 판이 끝난 뒤 다시하기를 누르지 않은 플레이어를 정리하기까지의 유예 시간
export const REPLAY_KICK_AFTER_MS = 14000;
// 완료 시간 검증: 서버 측정과의 허용 오차(네트워크 지연, 시계 오차)와 최소 소요 시간
const MAX_TIME_SKEW_SECONDS = 3;
const MIN_FINISH_SECONDS = 2;

const clamp = (v, min, max) => Math.min(Math.max(Number.isFinite(v) ? v : 0, min), max);

export function cleanNickname(value, fallback = 'Guest') {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NICKNAME_LENGTH);
  return cleaned || fallback;
}

function newPlayer(nickname, isReady) {
  return { nickname, isReady, progress: 0, mistakes: 0, shake: 0, isDisconnected: false };
}

function pickNextHost(room, ids) {
  return ids.find((id) => room.players[id]?.wantsReplay) || ids[0];
}

// 플레이어 제거 + 방장 승계. 아무도 남지 않으면 null(방 삭제)을 돌려준다.
export function removePlayer(room, pid) {
  if (!room.players[pid]) return room;
  delete room.players[pid];
  const remaining = Object.keys(room.players);
  if (remaining.length === 0) return null;
  if (room.host === pid) {
    const nextHost = pickNextHost(room, remaining);
    room.host = nextHost;
    room.players[nextHost].isReady = true;
  }
  return room;
}

// 방 생성/입장. create나 voice일 때만 방을 만든다.
export function join(room, me, { nickname, create, voice, channelId }, now, seed) {
  const name = cleanNickname(nickname);

  const makeRoom = () => {
    const created = {
      host: me,
      status: 'waiting',
      seed,
      createdAt: now,
      players: { [me]: newPlayer(name, true) },
    };
    if (voice) {
      created.isDiscordVoiceRoom = true;
      if (typeof channelId === 'string') created.channelId = channelId.slice(0, 32);
    }
    return created;
  };

  if (!room) {
    if (create || voice) return { room: makeRoom() };
    return { room: null, error: '존재하지 않는 방입니다.' };
  }

  // 이미 참가 중이면 재접속으로 처리
  if (room.players[me]) {
    room.players[me].isDisconnected = false;
    return { room };
  }

  // 끝난 음성 채널 방은 새 방으로 다시 만든다
  if (voice && room.status === 'finished') return { room: makeRoom() };

  if (create) return { room, error: '이미 사용 중인 방 코드입니다. 다시 시도해 주세요.' };

  if (room.status !== 'waiting') {
    return {
      room,
      error: voice
        ? '음성 통화방에서 이미 게임이 진행 중입니다. 라운드가 끝난 후 입장해 주세요.'
        : '이미 게임이 시작되었거나 종료된 방입니다.',
    };
  }
  if (Object.keys(room.players).length >= MAX_PLAYERS) {
    return { room, error: voice ? '방 정원(최대 4명)이 가득 찼습니다.' : '방 인원이 꽉 찼습니다. (최대 4명)' };
  }
  room.players[me] = newPlayer(name, false);
  return { room };
}

export function setReady(room, me, value) {
  const player = room.players[me];
  if (!player) return { room, error: '방에 참가 중이 아닙니다.' };
  player.isReady = value === true;
  return { room };
}

export function startGame(room, me, now, seed) {
  if (room.host !== me) return { room, error: '방장만 게임을 시작할 수 있습니다.' };
  if (room.status !== 'waiting') return { room, error: '이미 게임이 시작되었습니다.' };
  room.status = 'playing';
  room.seed = seed;
  room.startedAt = now;
  room.countdownDuration = COUNTDOWN_DURATION_MS;
  delete room.replayStartedAt;
  for (const player of Object.values(room.players)) delete player.wantsReplay;
  return { room };
}

// 카운트다운이 끝나기 전의 진행도는 받지 않는다(약간의 시계 오차 허용)
function isRoundLive(room, now) {
  return room.status === 'playing' && now >= (room.startedAt || 0) + (room.countdownDuration || COUNTDOWN_DURATION_MS) - 500;
}

export function applyProgress(room, me, { p, at }, now) {
  const player = room.players[me];
  if (!player || !isRoundLive(room, now) || player.finishedAt) return false;
  const progress = clamp(p, 0, 50);
  if (progress <= (player.progress || 0)) return false;
  player.progress = progress;
  if (Number.isFinite(at)) player.progressAt = at;
  return true;
}

export function applyMistake(room, me, { m, s }, now) {
  const player = room.players[me];
  if (!player || !isRoundLive(room, now) || player.finishedAt) return false;
  const mistakes = clamp(m, 0, 9999);
  if (mistakes <= (player.mistakes || 0)) return false;
  player.mistakes = mistakes;
  if (Number.isFinite(s)) player.shake = s;
  return true;
}

export function finishGame(room, me, { time, mistakes }, now) {
  const player = room.players[me];
  if (!player) return { room, error: '방에 참가 중이 아닙니다.' };
  if (room.status !== 'playing' || player.finishedAt) return { room };
  // 완료 시간은 서버가 잰 경과 시간(카운트다운 종료 ~ 완료 메시지 도착)과 크게 다르면 서버 값을 쓴다.
  // 카운트다운이 끝나기도 전이거나 사람이 낼 수 없는 시간이면 완료로 인정하지 않는다.
  const elapsedSec = (now - ((room.startedAt || 0) + (room.countdownDuration || COUNTDOWN_DURATION_MS))) / 1000;
  if (elapsedSec < MIN_FINISH_SECONDS) return { room, error: '완료 시간이 올바르지 않습니다.' };
  let finalTime = clamp(Number(time), 0, 3600);
  if (Math.abs(elapsedSec - finalTime) > MAX_TIME_SKEW_SECONDS) finalTime = Math.round(clamp(elapsedSec, 0, 3600) * 100) / 100;

  const finished = Object.values(room.players).filter((p) => p.finishedAt).length;
  player.progress = 50;
  player.finishedAt = now;
  player.finalTime = finalTime;
  player.mistakes = clamp(Number(mistakes), 0, 9999);
  player.rank = finished + 1;
  return { room };
}

export function giveUp(room, me, now) {
  const player = room.players[me];
  if (!player) return { room, error: '방에 참가 중이 아닙니다.' };
  player.isDisconnected = true;
  player.gaveUpAt = now;
  player.rank = Object.keys(room.players).length;
  return { room };
}

// 로비로 돌아가기(다시하기)
export function playAgain(room, me, nickname, now) {
  const player = room.players[me];
  if (!player) return { room, error: '방에 참가 중이 아닙니다.' };
  const isHost = room.host === me;
  room.players[me] = {
    nickname: player.nickname || cleanNickname(nickname),
    isReady: isHost,
    progress: 0,
    mistakes: 0,
    shake: 0,
    wantsReplay: true,
    ...(player.isDisconnected ? { isDisconnected: true } : {}),
  };

  if (room.status !== 'waiting') {
    // 연결이 끊긴/포기한 플레이어를 정리하고 대기 상태로 돌린다
    let current = room;
    for (const pid of Object.keys(room.players)) {
      if (current && room.players[pid]?.isDisconnected) current = removePlayer(current, pid);
    }
    if (!current) return { room: null };
    current.status = 'waiting';
    current.replayStartedAt = now;
    return { room: current };
  }
  return { room };
}

// 나가기. target이 다른 사람이면 연결이 끊긴 플레이어나 다시하기 유예 시간이 지난 플레이어만 내보낼 수 있다.
export function leave(room, me, target, now) {
  if (!room.players[me]) return { room };
  const pid = target || me;
  if (pid !== me) {
    const victim = room.players[pid];
    if (!victim) return { room };
    const kickable =
      victim.isDisconnected ||
      (room.status === 'waiting' &&
        room.replayStartedAt &&
        now - room.replayStartedAt >= REPLAY_KICK_AFTER_MS &&
        victim.finishedAt &&
        !victim.wantsReplay);
    if (!kickable) return { room, error: '다른 플레이어를 내보낼 수 없습니다.' };
  }
  return { room: removePlayer(room, pid) };
}
