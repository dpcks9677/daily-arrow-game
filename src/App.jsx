import { useState, useEffect, useCallback, useRef } from 'react'
import confetti from 'canvas-confetti'
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight, HelpCircle, Sun, Moon, User, Pencil, Check } from 'lucide-react'
import { generateDailyArrows, getOrCreateDeviceId, getByteLength, getDailySeed, generateBackupCode } from './utils'
import { collection, doc, setDoc, getDocs, getDoc, query, orderBy, limit, serverTimestamp, where } from 'firebase/firestore'
import { db } from './firebase'
import './App.css'

const triggerConfetti = () => {
  const commonOptions = {
    particleCount: 80,
    spread: 70,
    scalar: 1.8, // 파티클 크기 1.8배
    colors: ['#ef4444', '#3b82f6', '#facc15'], // 빨강, 파랑, 노랑
    startVelocity: 50
  };

  // 왼쪽에서 한 번 발사 (y: 0.45)
  confetti({
    ...commonOptions,
    angle: 60,
    origin: { x: 0, y: 0.45 }
  });

  // 오른쪽에서 한 번 발사 (y: 0.45)
  confetti({
    ...commonOptions,
    angle: 120,
    origin: { x: 1, y: 0.45 }
  });
};

function App() {
  const [currentScreen, setCurrentScreen] = useState('start') // 'start', 'game', 'leaderboard'
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const initUser = async () => {
      const deviceId = getOrCreateDeviceId();
      const userRef = doc(db, 'users', deviceId);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        setUserProfile({ id: deviceId, ...userSnap.data() });
      } else {
        const newProfile = {
          backupCode: null,
          nickname: localStorage.getItem('arrow_game_nickname') || '',
          createdAt: serverTimestamp(),
          // v.0.3.0 placeholders
          currentStreak: 1,
          lastPlayedDate: '',
          achievements: []
        };
        await setDoc(userRef, newProfile);
        setUserProfile({ id: deviceId, ...newProfile, isNew: true });
      }
    };
    initUser();
  }, []);

  const toggleTheme = () => setIsDarkMode(prev => !prev);

  return (
    <div className="app-container">
      {currentScreen === 'start' && <StartScreen onPlay={() => setCurrentScreen('game')} onLeaderboard={() => setCurrentScreen('leaderboard')} isDarkMode={isDarkMode} toggleTheme={toggleTheme} userProfile={userProfile} setUserProfile={setUserProfile} />}
      {currentScreen === 'game' && <GameScreen onHome={() => setCurrentScreen('start')} onLeaderboard={() => setCurrentScreen('leaderboard')} />}
      {currentScreen === 'leaderboard' && <LeaderboardScreen onHome={() => setCurrentScreen('start')} />}
    </div>
  )
}

function StartScreen({ onPlay, onLeaderboard, isDarkMode, toggleTheme, userProfile, setUserProfile }) {
  const [showHelp, setShowHelp] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [recoverCode, setRecoverCode] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState('');
  const [nicknameError, setNicknameError] = useState('');

  const handleRecoverCodeChange = (e) => {
    let val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (val.length > 4) {
      val = val.slice(0, 4) + '-' + val.slice(4, 8);
    }
    setRecoverCode(val.slice(0, 9));
  };

  useEffect(() => {
    if (showProfile && userProfile) {
      if (!userProfile.nickname) {
        setIsEditingNickname(true);
      } else {
        setIsEditingNickname(false);
      }
      setEditNicknameValue(userProfile.nickname || '');
      setNicknameError('');
    }
  }, [showProfile, userProfile]);

  const handleEditNicknameChange = (e) => {
    const val = e.target.value;
    setEditNicknameValue(val);
    
    const isValidChar = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_. ]*$/.test(val);
    if (getByteLength(val) > 20) {
      setNicknameError("한글은 8글자까지, 영어는 20자까지 가능합니다");
    } else if (!isValidChar) {
      setNicknameError("특수문자(언더바 및 마침표 제외) 및 아이콘은 사용할 수 없습니다.");
    } else {
      setNicknameError('');
    }
  };

  const handleSaveNickname = async () => {
    const trimmed = editNicknameValue.trim();
    if (!trimmed) {
      setNicknameError("공백으로 설정할 수 없습니다.");
      return;
    }
    const isValidChar = /^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_. ]+$/.test(trimmed);
    if (!isValidChar) {
      setNicknameError("특수문자(언더바 및 마침표 제외) 및 아이콘은 사용할 수 없습니다.");
      return;
    }
    if (getByteLength(trimmed) > 20) {
      setNicknameError("한글은 8글자까지, 영어는 20자까지 가능합니다");
      return;
    }
    try {
      const deviceId = getOrCreateDeviceId();
      await setDoc(doc(db, 'users', deviceId), { nickname: trimmed }, { merge: true });
      localStorage.setItem('arrow_game_nickname', trimmed);
      setUserProfile(prev => ({ ...prev, nickname: trimmed }));
      setIsEditingNickname(false);
      setNicknameError('');
    } catch (e) {
      console.error(e);
      alert("닉네임 저장에 실패했습니다.");
    }
  };

  const handleIssueBackupCode = async () => {
    try {
      const newCode = generateBackupCode();
      const deviceId = getOrCreateDeviceId();
      await setDoc(doc(db, 'users', deviceId), { backupCode: newCode }, { merge: true });
      setUserProfile(prev => ({ ...prev, backupCode: newCode }));
    } catch (e) {
      console.error(e);
      alert("백업 코드 발급에 실패했습니다.");
    }
  };

  const handleRecover = async () => {
    if (!recoverCode.trim()) return alert("백업 코드를 입력해주세요.");
    setIsRecovering(true);
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('backupCode', '==', recoverCode.trim().toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert("일치하는 계정을 찾을 수 없습니다. 코드를 확인해주세요.");
      } else {
        const matchedDoc = querySnapshot.docs[0];
        localStorage.setItem('arrow_game_device_id', matchedDoc.id);
        alert("계정이 성공적으로 복구되었습니다! 페이지를 새로고침합니다.");
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
      alert("복구 중 오류가 발생했습니다.");
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="start-screen">
      <div style={{ width: '100%', maxWidth: '600px', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
        <button 
          className="icon-btn"
          onClick={() => setShowProfile(true)}
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <User size={24} />
        </button>
        <button 
          className="icon-btn"
          onClick={toggleTheme}
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          {isDarkMode ? <Sun size={24} /> : <Moon size={24} />}
        </button>
        <button 
          className="icon-btn"
          onClick={() => setShowHelp(true)}
          style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        >
          <HelpCircle size={24} />
        </button>
      </div>
      <h1>Daily Arrow</h1>
      <p className="subtitle">50개의 방향키를 가장 빠르게 입력하세요! (매일 자정 갱신)</p>
      
      <div className="button-group">
        <button className="primary-btn" onClick={onPlay}>Play</button>
        <button className="secondary-btn" onClick={onLeaderboard}>Leaderboard</button>
      </div>

      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: '2.5rem', maxWidth: '440px', width: '90%' }}>
              <button className="close-btn" onClick={() => setShowHelp(false)}>✕</button>
              <h2 style={{ fontSize: '1.87rem' }}>게임 도움말</h2>
              <div className="modal-info-box" style={{ textAlign: 'left', color: '#cbd5e1', lineHeight: '1.7', marginTop: '1.5rem', fontSize: '0.85rem', background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                <ul style={{ paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <li>키보드의 방향키(↑, ↓, ←, →)를 사용하여 화면의 화살표를 똑같이 입력하세요.</li>
                  <li>방향키를 잘못 누르면 0.5초 동안 입력할 수 없게 됩니다.</li>
                  <li>매일 자정마다 화살표 세트가 바뀝니다.</li>
                  <li>실수 없이 가장 빠르게 클리어하여 랭킹에 도전해 보세요!</li>
                </ul>
              </div>
            </div>
        </div>
      )}

      {showProfile && (
        <div className="modal-overlay" onClick={() => setShowProfile(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: '2.5rem', maxWidth: '440px', width: '90%' }}>
              <button className="close-btn" onClick={() => setShowProfile(false)}>✕</button>
              <h2 style={{ fontSize: '1.87rem', marginBottom: '0.5rem' }}>내 프로필</h2>
              
              {!userProfile ? (
                <p>로딩 중...</p>
              ) : (
                <>
                  <div style={{ position: 'relative', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <p className="modal-section-label" style={{ fontSize: '0.9rem', margin: 0 }}>저장 닉네임</p>
                      {!isEditingNickname ? (
                        <button onClick={() => setIsEditingNickname(true)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }} title="닉네임 수정">
                          <Pencil size={14} />
                        </button>
                      ) : (
                        <button onClick={handleSaveNickname} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', padding: 0, display: 'flex' }} title="저장">
                          <Pencil size={14} />
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', width: '100%', maxWidth: '240px' }}>
                        <input 
                          type="text" 
                          value={isEditingNickname ? editNicknameValue : userProfile.nickname} 
                          onChange={handleEditNicknameChange} 
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNickname(); }}
                          placeholder="한글 8자, 영문 20자 내외"
                          className="nickname-input profile-nickname-text"
                          readOnly={!isEditingNickname}
                          style={{ 
                            flex: 1, 
                            minWidth: 0, 
                            padding: '0.4rem 0.6rem', 
                            fontSize: '0.9rem', 
                            textAlign: 'center',
                            outline: 'none',
                            width: '100%',
                            cursor: isEditingNickname ? 'text' : 'default',
                            opacity: isEditingNickname ? 1 : 0.85
                          }}
                        />
                      </div>
                      <p style={{ position: 'absolute', bottom: '-1.3rem', color: '#ef4444', fontSize: '0.75rem', margin: 0, visibility: nicknameError ? 'visible' : 'hidden', width: '100%', textAlign: 'center' }}>
                        {nicknameError || "안내 멘트 영역"}
                      </p>
                    </div>
                  </div>
                  
                  <div className="modal-info-box" style={{ textAlign: 'center', background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '1.5rem' }}>
                    <p style={{ fontSize: '0.9rem', color: '#cbd5e1', margin: '0 0 0.5rem 0' }}>나의 백업 코드</p>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', minHeight: '2.5rem' }}>
                      {userProfile.backupCode ? (
                        <span className="backup-code-text" style={{ fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '2px' }}>{userProfile.backupCode}</span>
                      ) : (
                        <button onClick={handleIssueBackupCode} className="primary-btn" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem', borderRadius: '8px' }}>
                          코드 발급 받기
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.5rem 0 0 0' }}>
                      {userProfile.backupCode ? '이 코드를 복사하여 기기를 변경하거나 기록이 지워졌을 때 복구할 수 있습니다.' : '코드를 발급받아 내 기록을 안전하게 백업하세요.'}
                    </p>
                  </div>

                  <div className="nickname-section" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                    <p className="modal-section-label" style={{ fontSize: '0.9rem', margin: '0 0 0.5rem 0' }}>계정 불러오기</p>
                    <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                      <input 
                        type="text" 
                        value={recoverCode} 
                        onChange={handleRecoverCodeChange} 
                        placeholder="백업 코드 입력"
                        className="nickname-input"
                        maxLength={9}
                        style={{ flex: 1, textTransform: 'uppercase', minWidth: '0' }}
                      />
                      <button onClick={handleRecover} disabled={isRecovering} className="primary-btn" style={{ padding: '0.75rem 1rem', fontSize: '1rem', borderRadius: '8px' }}>
                        복구
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
        </div>
      )}
    </div>
  )
}

function GameScreen({ onHome, onLeaderboard }) {
  const [arrows, setArrows] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [gameStatus, setGameStatus] = useState('waiting') // 'waiting', 'playing', 'finished'
  const [startTime, setStartTime] = useState(null)
  const [timeElapsed, setTimeElapsed] = useState(0)
  const [isStunned, setIsStunned] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const [showModal, setShowModal] = useState(false)
  
  // 닉네임 및 리더보드 등록 상태
  const [nickname, setNickname] = useState(() => localStorage.getItem('arrow_game_nickname') || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [showNicknameWarning, setShowNicknameWarning] = useState(false)
  
  const timerRef = useRef(null)

  const handleDebugSkip = () => {
    setCurrentIndex(arrows.length);
    setGameStatus('finished');
    setShowModal(true);
    triggerConfetti();
  };

  useEffect(() => {
    setArrows(generateDailyArrows(50))
  }, [])

  useEffect(() => {
    if (gameStatus === 'playing') {
      timerRef.current = setInterval(() => {
        setTimeElapsed(performance.now() - startTime)
      }, 10)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [gameStatus, startTime])

  const handleKeyDown = useCallback((e) => {
    if (isStunned || gameStatus === 'finished') return;
    
    const key = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;

    e.preventDefault();

    if (gameStatus === 'waiting') {
      setGameStatus('playing')
      setStartTime(performance.now())
    }

    const expectedArrow = arrows[currentIndex];

    if (key === expectedArrow) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      if (nextIndex >= arrows.length) {
        setGameStatus('finished');
        setShowModal(true);
        triggerConfetti();
      }
    } else {
      setIsStunned(true);
      setMistakes(prev => prev + 1);
      setTimeout(() => {
        setIsStunned(false);
      }, 500);
    }
  }, [arrows, currentIndex, gameStatus, isStunned])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown])

  const shareResult = () => {
    const timeSec = (timeElapsed / 1000).toFixed(2);
    const scoreText = mistakes === 0 ? '✨ Perfect Clear!' : `🎯 ${50 - mistakes}/50 (Mistakes: ${mistakes})`;
    const text = `Daily Arrow\n⏱️ ${timeSec}초\n${scoreText}\nhttps://yourdomain.com`;
    
    navigator.clipboard.writeText(text).then(() => {
        alert('결과가 클립보드에 복사되었습니다!');
    }).catch(err => {
        console.error('Failed to copy', err);
    });
  }

  const handleNicknameChange = (e) => {
    const val = e.target.value;
    if (getByteLength(val) <= 20) {
      setNickname(val);
      setShowNicknameWarning(false);
    } else {
      setShowNicknameWarning(true);
    }
  }

  const saveScore = async () => {
    if (!nickname.trim()) return alert("닉네임을 입력해주세요!");
    setIsSubmitting(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const dailySeed = getDailySeed().toString();
      localStorage.setItem('arrow_game_nickname', nickname.trim());
      
      const scoresRef = collection(db, 'leaderboard', dailySeed, 'scores');
      const newDocRef = doc(scoresRef); // 고유 ID 자동 생성 (중복 등록 허용)
      await setDoc(newDocRef, {
        deviceId: deviceId,
        nickname: nickname.trim(),
        time: Number((timeElapsed / 1000).toFixed(2)),
        mistakes: mistakes,
        timestamp: serverTimestamp()
      });
      setIsSaved(true);
      alert("점수가 성공적으로 등록되었습니다!");
      onLeaderboard();
    } catch (e) {
      console.error(e);
      alert("등록에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const getLucideIcon = (key) => {
    const size = 30; // 기본 크기(24px)에서 약 1.2배 확대
    switch (key) {
        case 'ArrowUp': return <LucideUp size={size} />;
        case 'ArrowDown': return <LucideDown size={size} />;
        case 'ArrowLeft': return <LucideLeft size={size} />;
        case 'ArrowRight': return <LucideRight size={size} />;
        default: return null;
    }
  }

  return (
    <div className="game-screen">
      <div className={`game-content ${isStunned ? 'stunned' : ''}`} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="game-header" style={{ justifyContent: 'space-between' }}>
        <button className="back-btn" onClick={onHome}>← Home</button>
        {import.meta.env.DEV && (
          <button className="back-btn" style={{ color: '#fbbf24' }} onClick={handleDebugSkip}>Skip (Debug)</button>
        )}
      </div>

      <div className="status-bar">
        <div className="timer">{(timeElapsed / 1000).toFixed(2)}s</div>
        <div className="progress">{currentIndex} / {arrows.length}</div>
      </div>
      
      <div className="grid-container">
        {arrows.map((arrow, idx) => {
          let statusClass = 'pending';
          if (idx < currentIndex) statusClass = 'correct';
          if (idx === currentIndex) statusClass = 'current';
          if (idx === currentIndex && isStunned) statusClass = 'error';

          return (
            <div key={idx} className={`arrow-box ${statusClass}`}>
              {getLucideIcon(arrow)}
            </div>
          )
        })}
      </div>

      {showModal && (
        <div className="modal-overlay">
            <div className="modal">
              <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
              <h2>Game Clear! 🎉</h2>
              <p>기록: {(timeElapsed / 1000).toFixed(2)}초</p>
              {mistakes > 0 && <p style={{ fontSize: '1rem', marginTop: '-1rem' }}>실수: {mistakes}회</p>}
              
              {!isSaved && (
                <div className="nickname-section">
                  <input 
                    type="text" 
                    value={nickname} 
                    onChange={handleNicknameChange} 
                    placeholder="닉네임 (한글 8자, 영문 20자)"
                    className="nickname-input"
                  />
                  <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: 0, minHeight: '1.2rem', visibility: showNicknameWarning ? 'visible' : 'hidden' }}>
                    한글은 8글자까지, 영어는 20자까지 입력 가능합니다
                  </p>
                  <button onClick={saveScore} disabled={isSubmitting || !nickname.trim()} className="primary-btn submit-btn">
                    {isSubmitting ? '등록 중...' : '점수 등록하기'}
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
                <button onClick={shareResult} className="share-btn">공유하기</button>
                {isSaved && <button onClick={onLeaderboard} className="secondary-btn" style={{ margin: 0 }}>Leaderboard</button>}
              </div>
            </div>
        </div>
      )}
      </div>
    </div>
  )
}

function LeaderboardScreen({ onHome }) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const dailySeed = getDailySeed().toString();
        const scoresRef = collection(db, 'leaderboard', dailySeed, 'scores');
        // 시간 오름차순 (가장 짧은 시간이 1등) 정렬
        const q = query(scoresRef, orderBy('time', 'asc'), limit(50));
        const snapshot = await getDocs(q);
        
        const fetchedScores = [];
        let rank = 1;
        snapshot.forEach((doc) => {
          fetchedScores.push({ id: doc.id, rank: rank++, ...doc.data() });
        });
        setScores(fetchedScores);
      } catch (e) {
        console.error("Error fetching leaderboard:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, []);

  return (
    <div className="leaderboard-screen">
      <div className="game-header">
        <button className="back-btn" onClick={onHome}>← Home</button>
      </div>
      
      <h1>Global Leaderboard</h1>
      <p className="subtitle">Today's Top Players</p>

      <div className="leaderboard-container">
        {loading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8' }}>Loading...</p>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Rank</th>
                <th style={{ width: '40%' }}>Name</th>
                <th>Time</th>
                <th>Mistakes</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((player) => {
                const getMedal = (rank) => {
                  if (rank === 1) return '🥇';
                  if (rank === 2) return '🥈';
                  if (rank === 3) return '🥉';
                  return '';
                };
                
                return (
                  <tr key={player.id}>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '60px' }}>
                        <span style={{ fontSize: '1.2em' }}>{getMedal(player.rank)}</span>
                        <span>{player.rank}</span>
                      </div>
                    </td>
                    <td>{player.nickname}</td>
                    <td>{Number(player.time).toFixed(2)}s</td>
                    <td>{player.mistakes}</td>
                  </tr>
                );
              })}
              {scores.length === 0 && (
                <tr><td colSpan="4" style={{textAlign:'center'}}>아직 등록된 기록이 없습니다!</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default App
