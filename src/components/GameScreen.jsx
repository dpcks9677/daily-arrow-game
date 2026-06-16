import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight } from 'lucide-react';
import { doc, setDoc, serverTimestamp, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { generateDailyArrows, processGameCompletion, getDailySeed, getByteLength } from '../utils';
import { triggerConfetti } from '../utils';

export default function GameScreen({ onHome, onLeaderboard, userProfile, setUserProfile, saveProfile, setUnlockedPopups }) {
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

  useEffect(() => {
    if (gameStatus === 'finished' && userProfile) {
      const processClearAchievements = async () => {
        try {
          const deviceId = userProfile.id;
          const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
          const todayStr = kstNow.toISOString().split('T')[0];
          const timeSec = Number((timeElapsed / 1000).toFixed(2));
          
          let newTodayCount = 1;
          if (userProfile.todayClearDate === todayStr) {
            newTodayCount = (userProfile.todayClearCount || 0) + 1;
          }

          let newStreak = 1;
          if (userProfile.lastPlayedDate) {
            const today = new Date(todayStr);
            const last = new Date(userProfile.lastPlayedDate);
            const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) {
              newStreak = userProfile.currentStreak || 0;
            } else if (diffDays === 1) {
              newStreak = (userProfile.currentStreak || 0) + 1;
            }
          }

          const newUnlocked = [];
          if (timeSec <= 15) newUnlocked.push('speed_15s');
          if (timeSec <= 12) newUnlocked.push('speed_12s');
          if (timeSec <= 9.8) newUnlocked.push('speed_9_8s');
          if (mistakes === 0) newUnlocked.push('flawless');
          if (newTodayCount >= 5) newUnlocked.push('play_5');
          if (newTodayCount >= 10) newUnlocked.push('play_10');
          newUnlocked.push('first_clear');
          
          if (newStreak >= 2) newUnlocked.push('streak_2');
          if (newStreak >= 3) newUnlocked.push('streak_3');
          if (newStreak >= 7) newUnlocked.push('streak_7');

          const currentAchievements = userProfile.achievements || [];
          const actualNew = userProfile?.backupCode ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
          const updatedAchievements = [...currentAchievements, ...actualNew];

          const newTotalPlayCount = (userProfile.totalPlayCount || 0) + 1;
          const newTotalLongestStreak = Math.max(userProfile?.totalLongestStreak || 0, newStreak);

          const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
          const newTotalBestRecords = [...(userProfile?.totalBestRecords || []), currentRecord]
            .sort((a, b) => {
              if (a.time !== b.time) return a.time - b.time;
              return a.mistakes - b.mistakes;
            })
            .slice(0, 3);

          const newTotalPlayTime = Number(((userProfile?.totalPlayTime || 0) + timeSec).toFixed(2));
          const newTotalMistakes = (userProfile?.totalMistakes || 0) + mistakes;
          const newTotalPerfectClear = (userProfile?.totalPerfectClear || 0) + (mistakes === 0 ? 1 : 0);

          const dailyRecs = userProfile?.dailyRecords || {};
          const todayDaily = dailyRecs[todayStr] || { todayPlayCount: 0, todayBestTime: Infinity, todayBestMistakes: Infinity, todayPlayTime: 0, todayMistakes: 0 };
          const newDailyRecords = {
            ...dailyRecs,
            [todayStr]: {
              todayPlayCount: todayDaily.todayPlayCount + 1,
              todayBestTime: timeSec < todayDaily.todayBestTime ? timeSec : (timeSec === todayDaily.todayBestTime ? Math.min(todayDaily.todayBestMistakes, mistakes) : todayDaily.todayBestTime),
              todayBestMistakes: timeSec < todayDaily.todayBestTime ? mistakes : (timeSec === todayDaily.todayBestTime ? Math.min(todayDaily.todayBestMistakes, mistakes) : todayDaily.todayBestMistakes),
              todayPlayTime: (todayDaily.todayPlayTime || 0) + timeSec,
              todayMistakes: (todayDaily.todayMistakes || 0) + mistakes
            }
          };

          const updates = {
            todayClearDate: todayStr,
            todayClearCount: newTodayCount,
            achievements: updatedAchievements,
            totalPlayCount: newTotalPlayCount,
            currentStreak: newStreak,
            lastPlayedDate: todayStr,
            totalLongestStreak: newTotalLongestStreak,
            totalBestRecords: newTotalBestRecords,
            totalPlayTime: newTotalPlayTime,
            totalMistakes: newTotalMistakes,
            totalPerfectClear: newTotalPerfectClear,
            dailyRecords: newDailyRecords
          };

          await saveProfile(userProfile, updates);
          if (actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...actualNew]);
        } catch (e) {
          console.error('Error updating clear achievements:', e);
        }
      };
      processClearAchievements();
    }
  }, [gameStatus]);

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