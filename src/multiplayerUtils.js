import { ref, set, get, update, child, remove, onDisconnect } from "firebase/database";
import { rtdb } from "./firebase";
import { getDailySeed } from "./utils"; // using as a random fallback if needed, or generate random

// 6자리 랜덤 코드 생성기
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 방 생성 (Host)
export async function createRoom(hostUserId, hostNickname) {
  const roomId = generateRoomCode();
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  
  // 방이 우연히 존재할 경우 대비 (거의 희박하지만)
  const snapshot = await get(roomRef);
  if (snapshot.exists()) {
    return createRoom(hostUserId, hostNickname); // 재귀 호출로 다시 생성
  }

  const finalNickname = hostNickname || 'Guest 1';
  
  // 공통 시드 생성 (멀티플레이 전용 랜덤 시드)
  const randomSeed = Math.random().toString(36).substring(2, 10);

  const roomData = {
    host: hostUserId,
    status: 'waiting', // waiting, playing, finished
    seed: randomSeed,
    createdAt: Date.now(),
    players: {
      [hostUserId]: {
        nickname: finalNickname,
        isReady: true, // 방장은 기본 레디 상태
        progress: 0,
        mistakes: 0,
        shake: 0, // 오답 흔들림 트리거
        finishedAt: null,
        finalTime: null,
        rank: null,
        isDisconnected: false
      }
    }
  };

  await set(roomRef, roomData);
  
  // 이탈(Disconnect) 감지 설정: 브라우저가 강제 종료되면 자동으로 isDisconnected = true
  const playerRef = ref(rtdb, `rooms/${roomId}/players/${hostUserId}`);
  onDisconnect(playerRef).update({ isDisconnected: true });

  return roomId;
}

// 방 입장 (Guest)
export async function joinRoom(roomId, userId, nickname) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    throw new Error('존재하지 않는 방입니다.');
  }

  const roomData = snapshot.val();
  
  if (roomData.status !== 'waiting') {
    throw new Error('이미 게임이 시작되었거나 종료된 방입니다.');
  }

  const players = roomData.players || {};
  const playerCount = Object.keys(players).length;

  if (playerCount >= 4) {
    throw new Error('방 인원이 꽉 찼습니다. (최대 4명)');
  }

  // 익명 닉네임 처리
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

  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await set(playerRef, newPlayerData);

  // 이탈(Disconnect) 감지 설정
  onDisconnect(playerRef).update({ isDisconnected: true });

  return roomId;
}

// 준비 상태 토글
export async function toggleReady(roomId, userId, isReady) {
  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await update(playerRef, { isReady });
}

// 방 나가기
export async function leaveRoom(roomId, userId) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  
  if (snapshot.exists()) {
    const roomData = snapshot.val();
    const players = roomData.players || {};
    
    const remainingUserIds = Object.keys(players).filter(id => id !== userId);
    
    if (remainingUserIds.length === 0) {
      // 아무도 남지 않으면 방 폭파
      await remove(roomRef);
      return;
    }

    const updates = {};
    updates[`players/${userId}`] = null; // 플레이어 삭제

    // 나간 사람이 방장이었다면, 다른 사람에게 방장을 넘김
    if (roomData.host === userId) {
      // 우선순위: wantsReplay === true 인 사람, 없으면 첫 번째 사람
      let nextHost = remainingUserIds.find(id => players[id].wantsReplay);
      if (!nextHost) nextHost = remainingUserIds[0];

      // 새로운 방장 위임
      updates[`host`] = nextHost;
      updates[`players/${nextHost}/isReady`] = true; // 새로운 방장은 자동으로 레디 처리
    }

    // 한 번의 호출로 원자적(Atomic) 업데이트
    await update(roomRef, updates);
  } else {
    // 방 데이터가 이미 없으면 그냥 내 플레이어 노드만 삭제 시도
    const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
    await remove(playerRef);
  }
}

// 게임 시작
export async function startGame(roomId) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  
  // 새 게임을 위한 시드 생성
  const randomSeed = Math.random().toString(36).substring(2, 10);
  
  await update(roomRef, { 
    status: 'playing',
    seed: randomSeed,
    startedAt: Date.now(),
    replayStartedAt: null // 타이머 리셋
  });
  
  // 모든 플레이어의 wantsReplay 상태 초기화
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

// 인게임 진행도 실시간 전송
export async function updateProgress(roomId, userId, progress) {
  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await update(playerRef, { progress });
}

// 인게임 실수(오답) 전송 - 미니보드 흔들림 애니메이션용 트리거
export async function triggerMistake(roomId, userId, currentMistakes) {
  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await update(playerRef, { 
    mistakes: currentMistakes,
    shake: Date.now() // 타임스탬프를 넣어 값이 변할 때마다 클라이언트에서 리스닝하여 흔들기 적용
  });
}

// 개인 게임 완료 (Rank 배정 로직 포함)
export async function finishGame(roomId, userId, finalTime, mistakes) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;

  const roomData = snapshot.val();
  const players = roomData.players || {};
  
  // 현재 정상적으로 완료한 사람들의 수를 세어 나의 랭크를 결정
  let finishedCount = 0;
  for (const pid in players) {
    if (players[pid].finishedAt) {
      finishedCount++;
    }
  }
  
  const myRank = finishedCount + 1; // 1등, 2등...
  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await update(playerRef, {
    progress: 50,
    finishedAt: Date.now(),
    finalTime,
    mistakes,
    rank: myRank
  });
}

// 자발적 게임 포기 (도중 이탈과 동일한 처리)
export async function giveUpGame(roomId, userId) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;
  
  const roomData = snapshot.val();
  const players = roomData.players || {};
  const totalPlayers = Object.keys(players).length;

  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  await update(playerRef, {
    isDisconnected: true,
    gaveUpAt: Date.now(),
    rank: totalPlayers // 현재 방 인원수를 기준으로 꼴찌 등수 할당
  });
}

// 로비로 돌아가기 (다시하기)
export async function playAgain(roomId, userId, nickname) {
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists()) return;
  const roomData = snapshot.val();

  const playerRef = ref(rtdb, `rooms/${roomId}/players/${userId}`);
  
  // 방장이면 자동으로 ready
  const isHost = roomData.host === userId;

  let finalNickname = nickname || 'Guest';
  if (roomData.players && roomData.players[userId] && roomData.players[userId].nickname) {
    finalNickname = roomData.players[userId].nickname;
  }

  await update(playerRef, {
    nickname: finalNickname,
    isReady: isHost,
    progress: 0,
    mistakes: 0,
    shake: 0,
    finishedAt: null,
    finalTime: null,
    rank: null,
    wantsReplay: true // 다시하기 버튼을 눌렀음을 표시
  });

  // 상태가 playing/finished 이면 다시 waiting 으로 변경하여 새로운 게임 대기
  if (roomData.status !== 'waiting') {
    const currentPlayers = roomData.players || {};
    for (const pid in currentPlayers) {
      if (currentPlayers[pid].isDisconnected) {
        await leaveRoom(roomId, pid);
      }
    }

    await update(roomRef, { 
      status: 'waiting',
      replayStartedAt: Date.now()
    });
  }
}
