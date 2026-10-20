import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight } from 'lucide-react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { generateDailyArrows, processGameCompletion, getDailySeed, getByteLength, getKSTDateString } from '../utils';
import { triggerConfetti } from '../utils';
import MobileDPad from './MobileDPad';
import { callWorker } from '../workerApi';
import { isDiscordActivity } from '../discordActivity';

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export default function GameScreen({ onHome, onLeaderboard, userProfile, saveProfile, setUnlockedPopups, showToast }) {
  const [arrows] = useState(() => generateDailyArrows(50));
  
  const currentIndexRef = useRef(0);
  const [currentIndex, _setCurrentIndex] = useState(0);
  const setCurrentIndex = useCallback((val) => { currentIndexRef.current = val; _setCurrentIndex(val); }, []);
  
  const gameStatusRef = useRef('waiting');
  const [gameStatus, _setGameStatus] = useState('waiting'); // 'waiting', 'playing', 'finished'
  const setGameStatus = useCallback((val) => { gameStatusRef.current = val; _setGameStatus(val); }, []);
  
  const [startTime, setStartTime] = useState(null)
  const [timeElapsed, setTimeElapsed] = useState(0)
  
  const isStunnedRef = useRef(false);
  const [isStunned, _setIsStunned] = useState(false);
  const setIsStunned = useCallback((val) => { isStunnedRef.current = val; _setIsStunned(val); }, []);
  
  const [mistakes, setMistakes] = useState(0)
  // 점수 검증용: 서버가 발급한 라운드 토큰과 입력 기록([키 번호, 첫 입력 이후 ms, 정답 여부])
  const roundRef = useRef(null);
  const runStartRef = useRef(0);
  const runLogRef = useRef([]);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // 닉네임 및 리더보드 등록 상태
  const [nickname, setNickname] = useState(() => userProfile?.nickname || localStorage.getItem('arrow_game_nickname') || '')
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
    if (gameStatus === 'playing') {
      timerRef.current = setInterval(() => {
        setTimeElapsed(performance.now() - startTime)
      }, 10)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [gameStatus, startTime])

  useEffect(() => {
    if (gameStatus === 'finished' && userProfile) {
      const processClearAchievements = async () => {
        try {
          const timeSec = Number((timeElapsed / 1000).toFixed(2));
          const result = processGameCompletion(userProfile, timeSec, mistakes);
          if (result) {
            await saveProfile(userProfile, result.updates);
            if (result.actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...result.actualNew]);
          }
        } catch (e) {
          console.error('Error updating clear achievements:', e);
        }
      };
      processClearAchievements();
    }
    // 게임 종료 시점에 한 번만 실행: saveProfile이 userProfile을 바꾸므로 deps에 넣으면 저장이 무한 반복된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStatus]);

  const processInput = useCallback((key) => {
    if (isStunnedRef.current || gameStatusRef.current === 'finished') return;
    // 입력 시각은 맨 앞에서 한 번만 잰다. 아래 프로필 저장(암호화 등)이 끼어들면 첫 입력 t가 0이 아니게 되어 서버가 기록을 거부한다.
    const now = performance.now();

    if (gameStatusRef.current === 'waiting') {
      setGameStatus('playing')
      setStartTime(now)
      runStartRef.current = now
      // 첫 입력 시 서버에 라운드 시작을 알린다 (서버가 시작 시각을 서명해 돌려줌)
      roundRef.current = callWorker('/start-round', { body: { seed: getDailySeed().toString() } })
        .then((r) => (r.ok ? r.data.round : null))
        .catch(() => null);

      if (userProfile && userProfile.discordId) {
        const todayStr = getKSTDateString();
        const dailyRecs = userProfile.dailyRecords || {};
        const todayDaily = dailyRecs[todayStr] || { todayPlayCount: 0, todayBestTime: Infinity, todayBestMistakes: Infinity, todayPlayTime: 0, todayMistakes: 0, todayTrials: 0 };
        
        const newDailyRecords = {
          ...dailyRecs,
          [todayStr]: {
            ...todayDaily,
            todayTrials: (todayDaily.todayTrials || 0) + 1
          }
        };

        saveProfile(userProfile, {
          totalTrials: (userProfile.totalTrials || 0) + 1,
          dailyRecords: newDailyRecords
        }).catch(e => console.error("Error saving trial count:", e));
      }
    }

    const expectedArrow = arrows[currentIndexRef.current];
    runLogRef.current.push([ARROW_KEYS.indexOf(key), Math.round(now - runStartRef.current), key === expectedArrow ? 1 : 0]);

    if (key === expectedArrow) {
      const nextIndex = currentIndexRef.current + 1;
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
  }, [arrows, userProfile, saveProfile, setCurrentIndex, setGameStatus, setIsStunned])

  const handleKeyDown = useCallback((e) => {
    const key = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
    e.preventDefault();
    processInput(key);
  }, [processInput])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown])

  const handleHomeClick = async () => {
    if (gameStatus === 'playing' && userProfile && userProfile.discordId) {
      const currentAchievements = userProfile.achievements || [];
      if (!currentAchievements.includes('quit_once')) {
        const updatedAchievements = [...currentAchievements, 'quit_once'];
        try {
          await saveProfile(userProfile, { achievements: updatedAchievements });
          setUnlockedPopups(prev => [...prev, 'quit_once']);
        } catch (e) {
          console.error("Failed to unlock quit_once:", e);
        }
      }
    }
    onHome();
  };

  const shareResult = () => {
    const timeSec = (timeElapsed / 1000).toFixed(2);
    const scoreText = mistakes === 0 ? '✨ Perfect Clear!' : `🎯 ${50 - mistakes}/50 (Mistakes: ${mistakes})`;
    const text = `Daily Arrow\n⏱️ ${timeSec}초\n${scoreText}\nhttps://daily-arrow.web.app`;
    
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (showToast) showToast('📋 결과가 클립보드에 복사되었습니다!', 'info');
      }).catch(err => {
        console.error('Failed to copy', err);
        if (showToast) showToast('클립보드 복사 권한이 없습니다.', 'error');
      });
    }
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
    if (!nickname.trim()) {
      setShowNicknameWarning(true);
      if (showToast) showToast("닉네임을 입력해주세요!", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const dailySeed = getDailySeed().toString();
      localStorage.setItem('arrow_game_nickname', nickname.trim());
      
      // 점수는 Worker가 입력 기록을 재생해 시간/실수를 직접 계산해 등록한다 (클라이언트가 보낸 숫자는 쓰지 않음)
      const round = await roundRef.current;
      if (!round) {
        throw new Error('라운드 정보를 확인하지 못했습니다. 로그인/연결 상태를 확인하고 다시 시도해 주세요.');
      }
      const saved = await callWorker('/save-score', {
        body: { seed: dailySeed, nickname: nickname.trim(), round, log: runLogRef.current },
      });
      if (!saved.ok) {
        throw new Error(saved.data?.error || '점수 등록에 실패했습니다.');
      }
      const savedDocId = saved.data.id;
      const baseAuthUrl = import.meta.env.VITE_AUTH_SERVER_URL ? import.meta.env.VITE_AUTH_SERVER_URL.replace(/\/$/, '') : '';

      const newUnlocked = ['leaderboard_entry'];
      try {
        let isTop1 = false;
        let checkedViaWorker = false;
        // 디스코드 액티비티는 CSP로 SDK 조회가 막혀 있어 Worker 리더보드로 판정
        const leaderboardEndpoints = [
          `/api/leaderboard?seed=${dailySeed}`,
          `/.proxy/api/leaderboard?seed=${dailySeed}`,
          baseAuthUrl ? `${baseAuthUrl}/api/leaderboard?seed=${dailySeed}` : null,
        ].filter(Boolean);
        for (const ep of leaderboardEndpoints) {
          try {
            const res = await fetch(ep);
            if (!(res.headers.get('content-type') || '').includes('application/json')) continue;
            const data = await res.json();
            if (data.success) {
              isTop1 = !!savedDocId && data.scores.length >= 5 && data.scores[0].id === savedDocId;
              checkedViaWorker = true;
              break;
            }
          } catch {
            // 다음 엔드포인트 시도
          }
        }
        if (!checkedViaWorker && !isDiscordActivity()) {
          const qList = query(collection(db, 'leaderboard', dailySeed, 'scores'), orderBy('time', 'asc'), limit(5));
          const snap = await getDocs(qList);
          isTop1 = snap.size >= 5 && snap.docs[0].id === savedDocId;
        }
        if (isTop1) newUnlocked.push('top_1');
      } catch(err) { console.error('Error checking top_1:', err); }

      const currentAchievements = userProfile?.achievements || [];
      const actualNew = userProfile?.discordId ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
      
      const updates = {
        nickname: nickname.trim()
      };
      if (actualNew.length > 0) {
        updates.achievements = [...currentAchievements, ...actualNew];
      }
      
      await saveProfile(userProfile, updates);
      if (actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...actualNew]);

      setIsSaved(true);
      if (showToast) {
        showToast("🎉 점수가 성공적으로 등록되었습니다!", "success");
      }
      setTimeout(() => {
        onLeaderboard();
      }, 900);
    } catch (e) {
      console.error(e);
      if (showToast) {
        showToast("등록에 실패했습니다: " + (e.message || "다시 시도해주세요."), "error");
      }
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
        <button className="back-btn" onClick={handleHomeClick}>← Home</button>
        {import.meta.env.DEV && (
          <button className="back-btn" style={{ color: '#fbbf24' }} onClick={handleDebugSkip}>Skip (Debug)</button>
        )}
      </div>

      <div className="status-bar">
        <div className="timer">{(timeElapsed / 1000).toFixed(2)}s</div>
        <div className="progress">{currentIndex} / {arrows.length}</div>
      </div>
      
      <div className="grid-container">
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
            if (idx === currentIndex) statusClass = 'current';
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
            if (idx === currentIndex) statusClass = 'current';
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


      {showModal && (
        <div className="modal-overlay">
            <div className="modal">
              <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
              <h2>Game Clear! 🎉</h2>
              <p>기록: {(timeElapsed / 1000).toFixed(2)}초</p>
              {mistakes > 0 && <p style={{ fontSize: '1rem', marginTop: '-1rem' }}>실수: {mistakes}회</p>}
              
              {!isSaved ? (
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
              ) : (
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '10px', padding: '0.75rem 1rem', color: '#34d399', fontWeight: 'bold', margin: '1rem 0' }}>
                  🎉 점수가 등록되었습니다! 잠시 후 리더보드로 이동합니다...
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