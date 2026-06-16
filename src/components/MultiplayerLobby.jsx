import React, { useState, useEffect } from 'react';
import { Users, LogOut, Play, UserPlus, CheckCircle, Circle, Copy } from 'lucide-react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { createRoom, joinRoom, leaveRoom, toggleReady, startGame } from '../multiplayerUtils';

export default function MultiplayerLobby({ onHome, onGameStart, userProfile, initialRoomId }) {
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [inputCode, setInputCode] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const userId = userProfile?.id;
  const nickname = userProfile?.nickname || '';

  // RTDB Listener for the active room
  useEffect(() => {
    if (!roomId) return;

    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setRoomData(data);

        // If game started, navigate to GameScreen (but pass roomId to indicate multiplayer)
        if (data.status === 'playing') {
          onGameStart(roomId, data.seed);
        }
      } else {
        // Room was deleted or we were kicked
        setRoomId('');
        setRoomData(null);
        setError('방이 종료되었거나 존재하지 않습니다.');
      }
    });

    return () => unsubscribe();
  }, [roomId, onGameStart]);

  // 15초 타임아웃 킥(Kick) 로직
  useEffect(() => {
    if (!roomData || !roomId || roomData.status !== 'waiting') return;
    const replayStartedAt = roomData.replayStartedAt;
    if (!replayStartedAt) return;

    const checkTimeout = () => {
      const players = roomData.players || {};
      const replayIds = Object.keys(players).filter(id => players[id].wantsReplay);
      replayIds.sort();

      // 중복 호출 방지를 위해 다시하기를 누른 첫 번째 유저가 강퇴 처리
      if (replayIds.length > 0 && replayIds[0] === userId) {
        Object.keys(players).forEach(id => {
          const p = players[id];
          // 아직 결정을 안 내렸거나 남아있는 경우
          if (p.finishedAt && !p.wantsReplay) {
            leaveRoom(roomId, id);
          }
        });
      }
    };

    const elapsed = Date.now() - replayStartedAt;
    const timeLeft = 15000 - elapsed;

    if (timeLeft <= 0) {
      checkTimeout();
    } else {
      const timeout = setTimeout(checkTimeout, timeLeft);
      return () => clearTimeout(timeout);
    }
  }, [roomData?.replayStartedAt, roomData?.status, roomId, userId]);

  const handleCreateRoom = async () => {
    setIsLoading(true);
    setError('');
    try {
      const newRoomId = await createRoom(userId, nickname);
      setRoomId(newRoomId);
    } catch (e) {
      console.error('Room creation error:', e);
      setError(`방 생성 중 오류가 발생했습니다: ${e.message || '시간 초과 또는 권한 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (!inputCode || inputCode.length !== 6) {
      setError('6자리 방 코드를 입력해주세요.');
      return;
    }
    
    setIsLoading(true);
    setError('');
    try {
      const joinedRoomId = inputCode.toUpperCase();
      await joinRoom(joinedRoomId, userId, nickname);
      setRoomId(joinedRoomId);
    } catch (e) {
      setError(e.message || '방 입장에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (roomId && userId) {
      await leaveRoom(roomId, userId);
    }
    setRoomId('');
    setRoomData(null);
    setError('');
  };

  const handleToggleReady = async () => {
    if (!roomId || !roomData) return;
    const myData = roomData.players[userId];
    const newReadyState = !myData?.isReady;
    await toggleReady(roomId, userId, newReadyState);
  };

  const handleStartGame = async () => {
    if (!roomId) return;
    await startGame(roomId);
  };

  // 1. Entry Screen (No room joined yet or waiting for data)
  const isEntering = isLoading || (!!roomId && !roomData);

  if (!roomId || !roomData) {
    return (
      <div className="modal-overlay fade-in">
        <div className="modal" style={{ maxWidth: '480px', width: '90%', minHeight: '500px', padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <button className="close-btn" onClick={onHome} style={{ position: 'absolute', top: '15px', right: '15px' }}>✕</button>
          
          <h2 style={{ fontSize: '1.8rem', marginBottom: '25px' }}>멀티플레이 입장</h2>
          
          <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '40px 20px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '80%', alignItems: 'center' }}>
              <button 
                className="primary-btn" 
                onClick={handleCreateRoom}
                disabled={isEntering}
                style={{ width: '100%', padding: '15px' }}
              >
                <UserPlus size={20} style={{ marginRight: '8px' }} />
                방 만들기 (Host)
              </button>

              <div style={{ textAlign: 'center', color: 'var(--text-color)', opacity: 0.5, margin: '15px 0' }}>
                또는 코드로 입장하기
              </div>

              <form onSubmit={handleJoinRoom} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
                <input 
                  type="text" 
                  placeholder="방 코드 6자리" 
                  value={inputCode}
                  onChange={(e) => {
                    setInputCode(e.target.value.toUpperCase().slice(0, 6));
                    if (error) setError('');
                  }}
                  disabled={isEntering}
                  style={{ width: '60%', padding: '15px', borderRadius: '8px', border: '2px solid #3b82f6', background: 'var(--bg-color)', color: 'var(--text-color)', fontSize: '1.1rem', fontFamily: 'var(--font-main)', textTransform: 'uppercase', outline: 'none', textAlign: 'center', fontWeight: 'bold', letterSpacing: '2px' }}
                  onFocus={(e) => { e.target.style.borderColor = '#fbbf24'; e.target.style.boxShadow = '0 0 8px rgba(251, 191, 36, 0.5)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = 'none'; }}
                />
                <button type="submit" className="primary-btn" disabled={isEntering} style={{ width: '60%', padding: '15px', marginTop: '5px' }}>
                  입장
                </button>
              </form>
            </div>
          </div>
          <div style={{ 
            color: '#ef4444', 
            marginTop: '20px', 
            fontSize: '0.95rem', 
            textAlign: 'center', 
            minHeight: '20px',
            visibility: error ? 'visible' : 'hidden'
          }}>
            {error || ' '}
          </div>
        </div>
      </div>
    );
  }

  // 2. Lobby Screen (Joined a room)
  const players = roomData?.players || {};
  const isHost = roomData?.host === userId;
  const amIReady = players[userId]?.isReady || false;
  
  const playerList = Object.entries(players).map(([id, p]) => ({ id, ...p }));
  playerList.sort((a, b) => {
    if (a.id === roomData?.host) return -1;
    if (b.id === roomData?.host) return 1;
    return 0;
  });
  
  const allReady = playerList.every(p => p.isReady);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500); // 1.5초 유지 후 페이드아웃 시작
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  return (
    <div className="modal-overlay fade-in">
      <div className="modal" style={{ maxWidth: '480px', width: '90%', minHeight: '500px', padding: '2rem', display: 'flex', flexDirection: 'column' }}>
        <button className="close-btn" onClick={handleLeaveRoom} style={{ position: 'absolute', top: '15px', right: '15px' }}>✕</button>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px', marginTop: '10px' }}>
          <h2 style={{ fontSize: '1.8rem', margin: 0 }}>로비</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: '#94a3b8' }}>
            <span>Room: <span style={{ color: '#fbbf24', fontWeight: 'bold', letterSpacing: '1px' }}>{roomId}</span></span>
            <button onClick={handleCopyCode} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#60a5fa', display: 'flex', alignItems: 'center', padding: '4px' }} title="방 코드 복사">
              <Copy size={16} />
            </button>
            <span style={{ 
              fontSize: '0.8rem', 
              color: '#10b981', 
              fontWeight: 'bold',
              opacity: copied ? 1 : 0,
              transition: copied ? 'none' : 'opacity 0.5s ease-out',
              pointerEvents: 'none'
            }}>
              코드가 복사되었습니다!
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.9rem', color: '#94a3b8' }}>
            <Users size={16} />
            <span style={{ fontWeight: 'bold' }}>{playerList.length}/4</span>
          </div>
        </div>

        <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', width: '100%', display: 'flex', flexDirection: 'column', flex: 1, marginBottom: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0', flex: 1 }}>
            {Array.from({ length: 4 }).map((_, idx) => {
              const p = playerList[idx];
              const isDeciding = p && p.finishedAt && !p.wantsReplay;

              return (
                <div key={p ? p.id : `empty-${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 10px', borderBottom: idx < 3 ? '1px solid rgba(255,255,255,0.1)' : 'none', minHeight: '56px' }}>
                  {p ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ 
                          fontWeight: p.id === userId ? 'bold' : 'normal', 
                          color: isDeciding ? '#64748b' : (p.id === userId ? '#fbbf24' : 'var(--text-color)'), 
                          fontSize: '1.1rem',
                          fontStyle: isDeciding ? 'italic' : 'normal'
                        }}>
                          {p.id === roomData?.host && '👑 '}
                          {p.nickname} {p.id === userId && '(나)'}
                          {isDeciding && ' ...'}
                        </span>
                      </div>
                      <div style={{ width: '90px' }}>
                        {isDeciding ? (
                          <span style={{ color: '#64748b', fontSize: '1rem', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
                            대기 중...
                          </span>
                        ) : p.isReady ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '1rem', fontWeight: 'bold' }}>
                            <CheckCircle size={18} /> Ready
                          </span>
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '1rem' }}>
                            <Circle size={18} /> Waiting
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ color: 'rgba(255, 255, 255, 0.15)', fontStyle: 'italic', fontSize: '1rem', flex: 1, textAlign: 'center' }}>
                      빈 슬롯
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'auto', paddingTop: '20px' }}>
            {isHost ? (
              <button 
                className="primary-btn" 
                onClick={handleStartGame} 
                disabled={!allReady || playerList.length < 2} // 최소 2명 필요
                style={{ width: '80%', padding: '15px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (!allReady || playerList.length < 2) ? 0.5 : 1 }}
              >
                <Play size={20} />
                게임 시작
              </button>
            ) : (
              <button 
                className="primary-btn" 
                onClick={handleToggleReady} 
                style={{ width: '80%', padding: '15px', fontSize: '1.1rem', background: amIReady ? 'rgba(255,255,255,0.1)' : '#10b981', color: amIReady ? 'var(--text-color)' : '#ffffff', border: amIReady ? '1px solid rgba(255,255,255,0.2)' : '1px solid transparent', boxShadow: amIReady ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.3)' }}
              >
                {amIReady ? '준비 취소' : '준비 완료'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
