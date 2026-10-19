import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight } from 'lucide-react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { generateDailyArrows } from '../utils';
import { updateProgress, triggerMistake, finishGame, giveUpGame, playAgain, leaveRoom, subscribeRoom, getServerNow, COUNTDOWN_DURATION_MS } from '../multiplayerUtils';
import MultiplayerBoard from './MultiplayerBoard';
import MobileDPad from './MobileDPad';
import { isDiscordActivity } from '../discordActivity';
import { openRoomSocket } from '../roomSocket';

const LATENCY_FLAG_KEY = 'arrow_debug_latency';
const LATENCY_SAMPLES = 30;

// 지연 계측: 최근 샘플의 평균/최대 (ms)
function summarizeSamples(samples) {
  if (samples.length === 0) return null;
  const sum = samples.reduce((a, b) => a + b, 0);
  return { n: samples.length, avg: Math.round(sum / samples.length), max: Math.round(Math.max(...samples)) };
}

function formatSamples(stat) {
  return stat ? `${stat.avg}ms (최대 ${stat.max}, ${stat.n}건)` : '--';
}

export default function MultiplayerGameScreen({ onHome, onReplay, userProfile, multiplayerData, saveProfile }) {
  const { roomId, seed } = multiplayerData;
  const userId = userProfile?.id;
  
  const [roomData, setRoomData] = useState(null);
  const arrows = useMemo(() => generateDailyArrows(50, seed), [seed]);
  
  const currentIndexRef = useRef(0);
  const [currentIndex, _setCurrentIndex] = useState(0);
  const setCurrentIndex = useCallback((val) => { currentIndexRef.current = val; _setCurrentIndex(val); }, []);

  const gameStatusRef = useRef('countdown');
  const [gameStatus, _setGameStatus] = useState('countdown'); // 'countdown', 'playing', 'finished'
  const setGameStatus = useCallback((val) => { gameStatusRef.current = val; _setGameStatus(val); }, []);
  
  const [countdown, setCountdown] = useState(3);
  const [startTime, setStartTime] = useState(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  
  const isStunnedRef = useRef(false);
  const [isStunned, _setIsStunned] = useState(false);
  const setIsStunned = useCallback((val) => { isStunnedRef.current = val; _setIsStunned(val); }, []);
  
  const mistakesRef = useRef(0);
  const [, _setMistakes] = useState(0);
  const setMistakes = useCallback((val) => { mistakesRef.current = val; _setMistakes(val); }, []);
  const [isAllFinished, setIsAllFinished] = useState(false);
  const statsSavedRef = useRef(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 디스코드 액티비티: WebSocket으로 폴링보다 먼저 받은 상대 상태 (key: 상대 userId)
  const [live, setLive] = useState({});
  const socketRef = useRef(null);
  // 지연 계측 (진행 카운터를 5번 연속 탭하면 표시)
  const latencyRef = useRef({ ws: [], poll: [], rtt: null });
  const polledProgressRef = useRef({});
  const tapsRef = useRef([]);
  const [showLatency, setShowLatency] = useState(() => {
    try { return localStorage.getItem(LATENCY_FLAG_KEY) === '1'; } catch { return false; }
  });
  const [latencyStats, setLatencyStats] = useState(null);

  const timerRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // RTDB Listener (Web & Discord Activity compliant)
  useEffect(() => {
    const unsubscribe = subscribeRoom(roomId, (data) => {
      if (!data) {
        // Room deleted
        onHome();
        return;
      }
      
      // 만약 내 데이터가 사라졌다면(방에서 강퇴당했거나 다른 탭에서 나갔다면) 로비로 튕기게 처리
      if (!data.players || !data.players[userId]) {
        onHome();
        return;
      }

      setRoomData(data);

      // 폴링 경로 지연 계측: 상대 진행도가 늘어난 순간, 상대가 입력한 시각(progressAt)과의 차이
      for (const [id, p] of Object.entries(data.players || {})) {
        if (id === userId) continue;
        if ((p.progress || 0) > (polledProgressRef.current[id] || 0) && p.progressAt) {
          const ms = getServerNow() - p.progressAt;
          if (Math.abs(ms) < 60000) {
            latencyRef.current.poll = [...latencyRef.current.poll, ms].slice(-LATENCY_SAMPLES);
          }
        }
        polledProgressRef.current[id] = p.progress || 0;
      }

      // Check if all players are finished or disconnected
      const players = data.players || {};
      const allDone = Object.values(players).every(p => p.finishedAt !== null || p.isDisconnected);
      if (allDone && gameStatus === 'finished') {
        setIsAllFinished(true);
      }
    }, 400);

    return () => unsubscribe();
  }, [roomId, gameStatus, onHome, userId]);

  // 디스코드 액티비티: 방 단위 WebSocket 중계로 상대의 진행도/실수를 폴링보다 먼저 받는다.
  // 연결에 실패해도 위의 RTDB 폴링이 그대로 동작한다.
  useEffect(() => {
    if (!isDiscordActivity() || !roomId || !userId) return;
    const socket = openRoomSocket(roomId, userId, {
      onMessage: (m) => {
        if (m.at > 0) {
          const ms = getServerNow() - m.at;
          if (Math.abs(ms) < 60000) {
            latencyRef.current.ws = [...latencyRef.current.ws, ms].slice(-LATENCY_SAMPLES);
          }
        }
        setLive((prev) => {
          const cur = prev[m.u];
          const base = cur && cur.g === m.g ? cur : { g: m.g, p: 0, m: 0, s: 0 };
          return { ...prev, [m.u]: { g: m.g, p: Math.max(base.p, m.p), m: Math.max(base.m, m.m), s: Math.max(base.s, m.s) } };
        });
      },
      onRtt: (ms) => { latencyRef.current.rtt = ms; },
    });
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [roomId, userId]);

  // 보드에는 RTDB 데이터에 WebSocket으로 먼저 받은 값을 덮어 표시 (진행도/실수/흔들림은 항상 증가하므로 max 병합)
  const boardData = useMemo(() => {
    if (!roomData?.players) return roomData;
    const players = { ...roomData.players };
    for (const [id, l] of Object.entries(live)) {
      const p = players[id];
      if (!p || id === userId || l.g !== roomData.startedAt) continue;
      players[id] = {
        ...p,
        progress: Math.max(p.progress || 0, l.p),
        mistakes: Math.max(p.mistakes || 0, l.m),
        shake: Math.max(p.shake || 0, l.s),
      };
    }
    return { ...roomData, players };
  }, [roomData, live, userId]);

  // 지연 계측 표시 갱신 (켜져 있을 때만)
  useEffect(() => {
    if (!showLatency) return;
    const timer = setInterval(() => {
      const { ws, poll, rtt } = latencyRef.current;
      setLatencyStats({ ws: summarizeSamples(ws), poll: summarizeSamples(poll), rtt });
    }, 1000);
    return () => clearInterval(timer);
  }, [showLatency]);

  const handleProgressTap = () => {
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((t) => now - t < 2000), now];
    if (tapsRef.current.length < 5) return;
    tapsRef.current = [];
    const next = !showLatency;
    setShowLatency(next);
    try { localStorage.setItem(LATENCY_FLAG_KEY, next ? '1' : '0'); } catch { /* 저장 실패는 무시 */ }
  };

  // 서버 타임스탬프 기반 카운트다운 (방법 A)
  // roomData.startedAt (서버 시각)을 기준으로 남은 시간을 매 프레임 역산하여
  // 모든 클라이언트에서 카운트다운 종료 시점이 동일하도록 보장합니다.
  useEffect(() => {
    if (!roomData?.startedAt) return;

    const serverStartedAt = roomData.startedAt;
    const countdownMs = roomData.countdownDuration || COUNTDOWN_DURATION_MS;
    // 서버 시각 기준으로 "카운트다운이 끝나는 절대 시각" 계산
    const gameStartsAt = serverStartedAt + countdownMs;

    let rafId;
    const tick = () => {
      const serverNow = getServerNow();
      const remaining = gameStartsAt - serverNow;

      if (remaining > 3000) {
        setCountdown(3);
      } else if (remaining > 2000) {
        setCountdown(3);
      } else if (remaining > 1000) {
        setCountdown(2);
      } else if (remaining > 0) {
        setCountdown(remaining > 500 ? 1 : 'Go!');
      } else {
        // 카운트다운 완료 → 게임 시작
        setCountdown(null);
        if (gameStatusRef.current === 'countdown') {
          setGameStatus('playing');
          setStartTime(performance.now());
        }
        return; // rAF 루프 중단
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [roomData?.startedAt, roomData?.countdownDuration, setGameStatus]);

  // Timer
  useEffect(() => {
    if (gameStatus === 'playing') {
      timerRef.current = setInterval(() => {
        setTimeElapsed(performance.now() - startTime);
      }, 10);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [gameStatus, startTime]);

  // Update Stats when all finished
  useEffect(() => {
    if (isAllFinished && roomData && !statsSavedRef.current && userProfile && (userProfile.backupCode || userProfile.discordId)) {
      statsSavedRef.current = true;
      const players = roomData.players;
      const myData = players[userId];
      
      if (myData && !myData.isDisconnected) {
        const isWin = myData.rank === 1;
        const finalTime = myData.finalTime;
        
        const currentBest = userProfile.multiplayerBestTime || Infinity;
        const newBest = finalTime < currentBest ? finalTime : currentBest;
        
        const updates = {
          multiplayerPlays: (userProfile.multiplayerPlays || 0) + 1,
          multiplayerWins: (userProfile.multiplayerWins || 0) + (isWin ? 1 : 0),
          multiplayerBestTime: newBest,
          multiplayerCompletions: (userProfile.multiplayerCompletions || 0) + 1
        };
        
        saveProfile(userProfile, updates).catch(console.error);

        // 방장이면 글로벌 로그 기록
        if (roomData.host === userId) {
          const logRef = doc(collection(db, 'multiplayer_logs'));
          setDoc(logRef, {
            roomId,
            seed,
            timestamp: serverTimestamp(),
            players: players
          }).catch(console.error);
        }
      }
    }
  }, [isAllFinished, roomData, userProfile, saveProfile, userId, roomId, seed]);

  const gameId = roomData?.startedAt || 0; // 라운드 식별자: 이전 라운드의 WebSocket 값이 섞이지 않게 함

  const processInput = useCallback((key) => {
    if (isStunnedRef.current || gameStatusRef.current !== 'playing') return;
    
    const expectedArrow = arrows[currentIndexRef.current];

    if (key === expectedArrow) {
      const nextIndex = currentIndexRef.current + 1;
      setCurrentIndex(nextIndex);
      
      // Update progress in RTDB (+ 디스코드 액티비티는 WebSocket으로 즉시 중계)
      updateProgress(roomId, userId, nextIndex).catch(console.error);
      if (socketRef.current) socketRef.current.send({ t: 'progress', g: gameId, p: nextIndex, at: getServerNow() });

      if (nextIndex >= arrows.length) {
        setGameStatus('finished');
        const finalTime = Number(((performance.now() - startTime) / 1000).toFixed(2));
        finishGame(roomId, userId, finalTime, mistakesRef.current).catch(console.error);
      }
    } else {
      setIsStunned(true);
      const newMistakes = mistakesRef.current + 1;
      setMistakes(newMistakes);
      
      // Trigger mistake in RTDB for shake animation (RTDB와 WebSocket에 같은 shake 값을 보내 이중 흔들림 방지)
      const shakeAt = Date.now();
      triggerMistake(roomId, userId, newMistakes, shakeAt).catch(console.error);
      if (socketRef.current) socketRef.current.send({ t: 'mistake', g: gameId, m: newMistakes, s: shakeAt, at: getServerNow() });

      setTimeout(() => {
        setIsStunned(false);
      }, 500);
    }
  }, [arrows, startTime, roomId, userId, gameId, setCurrentIndex, setGameStatus, setIsStunned, setMistakes]);

  const handleKeyDown = useCallback((e) => {
    const key = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    processInput(key);
  }, [processInput]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleHomeClick = async () => {
    if (gameStatus === 'playing') {
      let confirmGiveUp;
      try {
        confirmGiveUp = window.confirm('게임을 포기하고 나가시겠습니까? 꼴찌로 기록됩니다.');
      } catch {
        confirmGiveUp = true;
      }
      if (!confirmGiveUp) return;
      
      await giveUpGame(roomId, userId);
      
      // Update stats for unplug
      if (userProfile && (userProfile.backupCode || userProfile.discordId)) {
        saveProfile(userProfile, {
          multiplayerPlays: (userProfile.multiplayerPlays || 0) + 1
          // completions is NOT incremented
        });
      }
    }
    onHome();
  };

  const handleReplayClick = async () => {
    await playAgain(roomId, userId, userProfile?.nickname || '');
    if (onReplay) onReplay();
  };

  const handleLeaveClick = async () => {
    await leaveRoom(roomId, userId);
    onHome();
  };

  const getLucideIcon = (key) => {
    const size = 30;
    switch (key) {
        case 'ArrowUp': return <LucideUp size={size} />;
        case 'ArrowDown': return <LucideDown size={size} />;
        case 'ArrowLeft': return <LucideLeft size={size} />;
        case 'ArrowRight': return <LucideRight size={size} />;
        default: return null;
    }
  };

  return (
    <div className="game-screen">
      <div className={`game-content ${isStunned ? 'stunned' : ''}`} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="game-header" style={{ justifyContent: 'space-between' }}>
          <button className="back-btn" onClick={handleHomeClick}>← Home</button>
        </div>

        <div className="status-bar">
          <div className="timer">{(timeElapsed / 1000).toFixed(2)}s</div>
          <div className="progress" onClick={handleProgressTap}>{currentIndex} / {arrows.length}</div>
        </div>
        
        <div className="grid-container" style={{ position: 'relative' }}>
          {countdown && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.5)', zIndex: 20,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              fontSize: '4rem', fontWeight: 'bold', color: '#fbbf24',
              borderRadius: '12px'
            }}>
              {countdown}
            </div>
          )}
          {isMobile ? (
            [...Array(25)].map((_, v) => {
              const completedRows = Math.floor(currentIndex / 5);
              const rowInView = Math.floor(v / 5);
              
              let logicalRow = rowInView;
              if (completedRows > rowInView) {
                logicalRow = rowInView + 5;
              }
              
              const idx = logicalRow * 5 + (v % 5);

              const arrow = arrows[idx];
              let statusClass = 'pending';
              if (idx < currentIndex) statusClass = 'correct';
              if (idx === currentIndex && !countdown) statusClass = 'current';
              if (idx === currentIndex && isStunned) statusClass = 'error';

              return (
                <div key={idx} className={`arrow-box ${statusClass} animate-fade-in`}>
                  {getLucideIcon(arrow)}
                </div>
              );
            })
          ) : (
            arrows.map((arrow, idx) => {
              let statusClass = 'pending';
              if (idx < currentIndex) statusClass = 'correct';
              if (idx === currentIndex && !countdown) statusClass = 'current';
              if (idx === currentIndex && isStunned) statusClass = 'error';

              return (
                <div key={idx} className={`arrow-box ${statusClass}`}>
                  {getLucideIcon(arrow)}
                </div>
              );
            })
          )}
        </div>

        <MobileDPad onDirectionPress={processInput} />

        {/* Multiplayer Board (Mini Grid) */}
        <MultiplayerBoard roomData={boardData} myUserId={userId} />

        {showLatency && (
          <div style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 9999, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.75)', color: '#a7f3d0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5, pointerEvents: 'none' }}>
            <div>WebSocket {latencyStats ? formatSamples(latencyStats.ws) : '--'}</div>
            <div>폴링 {latencyStats ? formatSamples(latencyStats.poll) : '--'}</div>
            <div>WS 왕복 {latencyStats?.rtt != null ? `${Math.round(latencyStats.rtt)}ms` : '연결 안 됨'}</div>
          </div>
        )}

        {/* Result Modal */}
        {gameStatus === 'finished' && (
          <div className="modal-overlay">
            <div className="modal" style={{ width: '90%', maxWidth: '500px' }}>
              <button className="close-btn" onClick={onHome}>✕</button>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>멀티플레이 결과 🏆</h2>
              {!isAllFinished && <p style={{ color: '#fbbf24', marginTop: '0', fontSize: '0.9rem' }}>다른 플레이어들을 기다리는 중입니다...</p>}
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '15px' }}>
                {Object.entries(roomData?.players || {})
                  .sort((a, b) => {
                    const rankA = a[1].rank || 99;
                    const rankB = b[1].rank || 99;
                    if (rankA !== rankB) return rankA - rankB;
                    
                    const gaveUpA = a[1].gaveUpAt || Infinity;
                    const gaveUpB = b[1].gaveUpAt || Infinity;
                    return gaveUpA - gaveUpB;
                  })
                  .map(([pid, p]) => {
                    const isFinished = !!p.finishedAt || p.isDisconnected;
                    let rankText = '';
                    if (isFinished && p.rank) {
                      rankText = ['🥇', '🥈', '🥉', '4등'][p.rank - 1] || `${p.rank}등`;
                    }

                    return (
                      <div key={pid} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 16px', background: 'var(--bg-color)',
                        border: pid === userId ? '2px solid #fbbf24' : '1px solid var(--border-color)',
                        borderRadius: '8px', opacity: p.isDisconnected ? 0.5 : 1
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontSize: '1rem', color: pid === userId ? '#fbbf24' : 'var(--text-color)' }}>
                          <span style={{ display: 'inline-block', width: '35px', textAlign: 'left' }}>{rankText}</span> 
                          {p.nickname} {pid === userId && '(나)'}
                        </div>
                        <div style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>
                          {!isFinished ? (
                            p.wantsReplay ? (
                              <span style={{ color: '#64748b' }}>로비로 이동함</span>
                            ) : (
                              <span style={{ color: '#64748b' }}>플레이 중...</span>
                            )
                          ) : p.isDisconnected ? (
                            <span style={{ color: '#ef4444' }}>포기</span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: 'rgba(255,255,255,0.2)', paddingLeft: '5px' }}>|</span>
                              <span style={{ display: 'inline-block', width: '65px', textAlign: 'center' }}>{Number(p.finalTime).toFixed(2)}s</span>
                              <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                              <span style={{ display: 'inline-block', width: '55px', textAlign: 'left', color: '#94a3b8' }}>실수: {p.mistakes}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              <div style={{ marginTop: '25px', display: 'flex', gap: '10px' }}>
                <button onClick={handleReplayClick} className="primary-btn submit-btn" style={{ flex: 2, fontSize: '1.1rem', padding: '12px' }}>
                  다시하기
                </button>
                <button onClick={handleLeaveClick} className="secondary-btn" style={{ flex: 1, fontSize: '1.1rem', padding: '12px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-color)', border: '1px solid rgba(255,255,255,0.2)' }}>
                  나가기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
