// 디스코드 액티비티 전용: 방 단위 WebSocket 중계 클라이언트.
// 게임 중 진행도/실수를 폴링보다 빠르게 받기 위한 보조 채널이며, 연결에 실패해도
// 기존 RTDB 폴링이 그대로 동작하므로 실패는 조용히 무시한다.

const PING_INTERVAL_MS = 5000;
const MAX_FAILURES = 5;

export function openRoomSocket(roomId, userId, { onMessage, onRtt } = {}) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const bases = [
    `${proto}://${window.location.host}/.proxy/api/ws`,
    `${proto}://${window.location.host}/api/ws`,
  ];
  const query = `?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(userId)}`;

  let socket = null;
  let closed = false;
  let baseIndex = 0;
  let failures = 0;
  let pingTimer = null;
  let retryTimer = null;

  const stopPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  };

  const scheduleRetry = (opened) => {
    stopPing();
    if (closed) return;
    // 한 번도 열리지 못했다면 다음 경로(/api/ws)를 시도
    if (!opened) baseIndex = (baseIndex + 1) % bases.length;
    failures += 1;
    if (failures > MAX_FAILURES) return;
    retryTimer = setTimeout(connect, Math.min(1000 * failures, 5000));
  };

  function connect() {
    if (closed) return;
    let opened = false;
    try {
      socket = new WebSocket(bases[baseIndex] + query);
    } catch {
      scheduleRetry(false);
      return;
    }
    const current = socket;

    current.onopen = () => {
      opened = true;
      const ping = () => {
        if (current.readyState === 1) current.send(JSON.stringify({ t: 'ping', c: performance.now() }));
      };
      ping();
      pingTimer = setInterval(ping, PING_INTERVAL_MS);
    };
    current.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        failures = 0; // 서버와 실제로 통신이 확인된 뒤에만 실패 횟수를 초기화 (열자마자 닫히는 서버에서 무한 재연결 방지)
        if (onRtt) onRtt(performance.now() - msg.c);
        return;
      }
      if (onMessage) onMessage(msg);
    };
    current.onclose = () => scheduleRetry(opened);
    current.onerror = () => {}; // 재시도는 onclose에서 처리
  }

  connect();

  return {
    send(payload) {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify(payload));
      }
    },
    close() {
      closed = true;
      stopPing();
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) socket.close();
    },
  };
}
