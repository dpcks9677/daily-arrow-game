import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight } from 'lucide-react';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { generateDailyArrows, getKSTDateString } from '../utils';
import { updateProgress, triggerMistake, finishGame, giveUpGame, playAgain, leaveRoom } from '../multiplayerUtils';
import MultiplayerBoard from './MultiplayerBoard';

export default function MultiplayerGameScreen({ onHome, onReplay, userProfile, multiplayerData, saveProfile }) {
  const { roomId, seed } = multiplayerData;
  const userId = userProfile?.id;
  
  const [roomData, setRoomData] = useState(null);
  const [arrows, setArrows] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameStatus, setGameStatus] = useState('countdown'); // 'countdown', 'playing', 'finished'
  const [countdown, setCountdown] = useState(3);
  const [startTime, setStartTime] = useState(null);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isStunned, setIsStunned] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [isAllFinished, setIsAllFinished] = useState(false);
  const [statsSaved, setStatsSaved] = useState(false);

  const timerRef = useRef(null);

  // RTDB Listener
  useEffect(() => {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setRoomData(data);
        
        // Check if all players are finished or disconnected
        const players = data.players || {};
        const allDone = Object.values(players).every(p => p.finishedAt !== null || p.isDisconnected);
        if (allDone && gameStatus === 'finished') {
          setIsAllFinished(true);
        }
      } else {
        // Room destroyed
        onHome();
      }
    });
    return () => unsubscribe();
  }, [roomId, gameStatus, onHome]);

  // Initial Setup & Countdown
  useEffect(() => {
    setArrows(generateDailyArrows(50, seed));
    
    // Countdown logic
    let count = 3;
    setCountdown(count);
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else if (count === 0) {
        setCountdown('Go!');
      } else {
        clearInterval(interval);
        setCountdown(null);
        setGameStatus('playing');
        setStartTime(performance.now());
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [seed]);

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
    if (isAllFinished && roomData && !statsSaved && userProfile && userProfile.backupCode) {
      setStatsSaved(true);
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
  }, [isAllFinished, roomData, statsSaved, userProfile, saveProfile, userId, roomId, seed]);

  const handleKeyDown = useCallback(async (e) => {
    if (isStunned || gameStatus !== 'playing') return;
    
    const key = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

    e.preventDefault();

    const expectedArrow = arrows[currentIndex];

    if (key === expectedArrow) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      
      // Update progress in RTDB
      updateProgress(roomId, userId, nextIndex).catch(console.error);

      if (nextIndex >= arrows.length) {
        setGameStatus('finished');
        const finalTime = Number(((performance.now() - startTime) / 1000).toFixed(2));
        finishGame(roomId, userId, finalTime, mistakes).catch(console.error);
      }
    } else {
      setIsStunned(true);
      const newMistakes = mistakes + 1;
      setMistakes(newMistakes);
      
      // Trigger mistake in RTDB for shake animation
      triggerMistake(roomId, userId, newMistakes).catch(console.error);

      setTimeout(() => {
        setIsStunned(false);
      }, 500);
    }
  }, [arrows, currentIndex, gameStatus, isStunned, roomId, userId, startTime, mistakes]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleHomeClick = async () => {
    if (gameStatus === 'playing') {
      const confirmGiveUp = window.confirm('게임을 포기하고 나가시겠습니까? 꼴찌로 기록됩니다.');
      if (!confirmGiveUp) return;
      
      await giveUpGame(roomId, userId);
      
      // Update stats for unplug
      if (userProfile && userProfile.backupCode) {
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
          <div className="progress">{currentIndex} / {arrows.length}</div>
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
          {arrows.map((arrow, idx) => {
            let statusClass = 'pending';
            if (idx < currentIndex) statusClass = 'correct';
            if (idx === currentIndex && !countdown) statusClass = 'current';
            if (idx === currentIndex && isStunned) statusClass = 'error';

            return (
              <div key={idx} className={`arrow-box ${statusClass}`}>
                {getLucideIcon(arrow)}
              </div>
            )
          })}
        </div>

        {/* Multiplayer Board (Mini Grid) */}
        <MultiplayerBoard roomData={roomData} myUserId={userId} />

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
                            <span style={{ color: '#64748b' }}>플레이 중...</span>
                          ) : p.isDisconnected ? (
                            <span style={{ color: '#ef4444' }}>포기</span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: 'rgba(255,255,255,0.2)', paddingLeft: '5px' }}>|</span>
                              <span style={{ display: 'inline-block', width: '65px', textAlign: 'center' }}>{p.finalTime}초</span>
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
