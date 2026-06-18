import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight } from 'lucide-react';
import { doc, setDoc, serverTimestamp, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { generateDailyArrows, processGameCompletion, getDailySeed, getByteLength, getKSTDateString } from '../utils';
import { triggerConfetti } from '../utils';
import MobileDPad from './MobileDPad';

export default function GameScreen({ onHome, onLeaderboard, userProfile, setUserProfile, saveProfile, setUnlockedPopups }) {
  const [arrows, setArrows] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [gameStatus, setGameStatus] = useState('waiting') // 'waiting', 'playing', 'finished'
  const [startTime, setStartTime] = useState(null)
  const [timeElapsed, setTimeElapsed] = useState(0)
  const [isStunned, setIsStunned] = useState(false)
  const [mistakes, setMistakes] = useState(0)
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
  }, [gameStatus]);

  const processInput = useCallback((key) => {
    if (isStunned || gameStatus === 'finished') return;

    if (gameStatus === 'waiting') {
      setGameStatus('playing')
      setStartTime(performance.now())

      if (userProfile && userProfile.backupCode) {
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
  }, [arrows, currentIndex, gameStatus, isStunned, userProfile, saveProfile])

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
    if (gameStatus === 'playing' && userProfile && userProfile.backupCode) {
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
      const deviceId = userProfile.id;
      const dailySeed = getDailySeed().toString();
      localStorage.setItem('arrow_game_nickname', nickname.trim());
      
      const scoresRef = collection(db, 'leaderboard', dailySeed, 'scores');
      const newDocRef = doc(scoresRef); // 고유 ID 자동 생성 (중복 등록 허용)
      await setDoc(newDocRef, {
        deviceId: deviceId,
        nickname: nickname.trim(),
        time: Number((timeElapsed / 1000).toFixed(2)),
        mistakes: mistakes,
        hasBackupCode: !!userProfile.backupCode,
        timestamp: serverTimestamp()
      });

      const newUnlocked = ['leaderboard_entry'];
      try {
        const qList = query(scoresRef, orderBy('time', 'asc'), limit(5));
        const snap = await getDocs(qList);
        if (snap.size >= 5 && snap.docs[0].id === newDocRef.id) {
          newUnlocked.push('top_1');
        }
      } catch(err) { console.error('Error checking top_1:', err); }

      const currentAchievements = userProfile?.achievements || [];
      const actualNew = userProfile?.backupCode ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
      
      const updates = {
        nickname: nickname.trim()
      };
      if (actualNew.length > 0) {
        updates.achievements = [...currentAchievements, ...actualNew];
      }
      
      await saveProfile(userProfile, updates);
      if (actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...actualNew]);

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