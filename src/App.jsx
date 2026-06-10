import { useState, useEffect, useCallback, useRef } from 'react'
import confetti from 'canvas-confetti'
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight, HelpCircle, Sun, Moon, User, Pencil, Check, Flame, Trophy, BarChart } from 'lucide-react'
import { generateDailyArrows, getByteLength, getDailySeed, generateBackupCode } from './utils'
import { collection, doc, setDoc, getDocs, getDoc, query, orderBy, limit, serverTimestamp, where } from 'firebase/firestore'
import { db, auth } from './firebase'
import { signInAnonymously } from 'firebase/auth'
import './App.css'

export const ACHIEVEMENTS = [
  { id: 'first_clear', title: '첫 걸음', desc: '게임을 1회 완료하세요.' },
  { id: 'leaderboard_entry', title: '입장샷', desc: '리더보드에 기록을 올리세요.' },
  { id: 'streak_2', title: '두 번은 쉽지', desc: '2일 연속으로 게임을 완료하세요.' },
  { id: 'streak_3', title: '작심삼일', desc: '3일 연속으로 게임을 완료하세요.' },
  { id: 'streak_7', title: '보시기에 심히 좋았더라', desc: '일주일 연속으로 게임을 완료하세요.' },
  { id: 'top_1', title: 'Veni, vidi, vici', desc: '리더보드에서 1등을 기록하세요. (5개 이상의 기록이 있을 때)' },
  { id: 'speed_15s', title: '15초는 뭐...', desc: '게임을 15초 이내로 완료하세요.' },
  { id: 'speed_12s', title: '좀 치네', desc: '게임을 12초 이내로 완료하세요.' },
  { id: 'speed_9_8s', title: '중력가속도처럼 빠르게', desc: '게임을 9.8초 이내로 완료하세요.' },
  { id: 'flawless', title: '무결점', desc: '한 번의 실수도 없이 게임을 완료하세요.' },
  { id: 'play_5', title: '반복은 기본이다', desc: '하루 안에 게임을 5번 완료하세요.' },
  { id: 'play_10', title: '열번 찍어 안 넘어가는 나무 없다', desc: '하루 안에 게임을 10번 완료하세요.' }
];

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

const getStreakStatus = (userProfile) => {
  if (!userProfile || !userProfile.lastPlayedDate) {
    return { isActive: false, streak: 0 };
  }
  const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kstNow.toISOString().split('T')[0];
  const today = new Date(todayStr);
  const last = new Date(userProfile.lastPlayedDate);
  const diffDaysStr = Math.round((today - last) / (1000 * 60 * 60 * 24));
  
  if (diffDaysStr <= 1) {
    return { isActive: true, streak: userProfile.currentStreak || 1 };
  } else {
    return { isActive: false, streak: 0 };
  }
};

function AchievementPopupContainer({ popups, setPopups }) {
  if (!popups || popups.length === 0) return null;

  const handleClose = (id) => {
    setPopups(prev => prev.filter(p => p !== id));
  };

  const handleCloseSummary = () => {
    setPopups(prev => prev.slice(0, 2)); // keep only the first 2, remove the rest
  };

  const displayPopups = [];
  if (popups.length <= 3) {
    displayPopups.push(...popups);
  } else {
    displayPopups.push(popups[0], popups[1]);
  }

  const remainingCount = popups.length > 3 ? popups.length - 2 : 0;

  return (
    <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '0.8rem', pointerEvents: 'none' }}>
      {displayPopups.map((achId) => {
        const ach = ACHIEVEMENTS.find(a => a.id === achId);
        if (!ach) return null;
        return (
          <div key={ach.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(30, 58, 138, 0.95)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.5)', width: '300px', boxShadow: '0 4px 6px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s ease-out forwards', pointerEvents: 'auto' }}>
            <button onClick={() => handleClose(ach.id)} style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', width: '20px', height: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>✕</button>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
              <Trophy size={20} color="#f59e0b" />
            </div>
            <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.85rem', color: '#f59e0b' }}>도전과제 달성!</p>
              <p style={{ margin: 0, fontSize: '0.95rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{ach.title}</p>
            </div>
          </div>
        );
      })}
      {remainingCount > 0 && (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(30, 58, 138, 0.95)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.5)', width: '300px', boxShadow: '0 4px 6px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s ease-out forwards', pointerEvents: 'auto' }}>
          <button onClick={handleCloseSummary} style={{ position: 'absolute', top: '0.3rem', right: '0.3rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', width: '20px', height: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>✕</button>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <Trophy size={20} color="#f59e0b" />
          </div>
          <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.2rem', justifyContent: 'center', height: '100%' }}>
            <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.95rem', color: '#f59e0b' }}>+{remainingCount}개의 도전과제 달성!</p>
          </div>
        </div>
      )}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function App() {
  const [currentScreen, setCurrentScreen] = useState('start') // 'start', 'game', 'leaderboard'
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('arrow_game_theme');
    if (saved !== null) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [userProfile, setUserProfile] = useState(null);
  const [unlockedPopups, setUnlockedPopups] = useState([]);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    if (currentScreen === 'start') {
      setUnlockedPopups([]);
    }
  }, [currentScreen]);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      if (localStorage.getItem('arrow_game_theme') === null) {
        setIsDarkMode(e.matches);
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);

  useEffect(() => {
    const initUser = async () => {
      try {
        const userCredential = await signInAnonymously(auth);
        const deviceId = userCredential.user.uid;
        
        const userRef = doc(db, 'users', deviceId);
        const userSnap = await getDoc(userRef);

        const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
        const todayStr = kstNow.toISOString().split('T')[0];

        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserProfile({ 
            id: deviceId, 
            totalPlayCount: data.totalPlayCount || 0,
            longestStreak: data.longestStreak || data.currentStreak || 1,
            gameStartDate: data.gameStartDate || todayStr,
            bestRecords: data.bestRecords || [],
            ...data 
          });
        } else {
          const newProfile = {
            backupCode: null,
            nickname: localStorage.getItem('arrow_game_nickname') || '',
            currentStreak: 1,
            lastPlayedDate: '',
            achievements: [],
            totalPlayCount: 0,
            longestStreak: 1,
            gameStartDate: todayStr,
            bestRecords: []
          };
          setUserProfile({ id: deviceId, ...newProfile, isNew: true });
        }
      } catch (error) {
        console.error("Anonymous auth failed:", error);
        alert("인증에 실패했습니다. 파이어베이스 콘솔에서 익명 로그인을 활성화해주세요.");
      } finally {
        setIsAuthLoading(false);
      }
    };
    initUser();
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const nextTheme = !prev;
      localStorage.setItem('arrow_game_theme', nextTheme ? 'dark' : 'light');
      return nextTheme;
    });
  };

  if (isAuthLoading) {
    return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#f8fafc' }}><h3>서버 연결 중...</h3></div>;
  }

  return (
    <div className="app-container">
      {unlockedPopups.length > 0 && (
        <AchievementPopupContainer popups={unlockedPopups} setPopups={setUnlockedPopups} />
      )}
      {currentScreen === 'start' && <StartScreen onPlay={() => setCurrentScreen('game')} onLeaderboard={() => setCurrentScreen('leaderboard')} isDarkMode={isDarkMode} toggleTheme={toggleTheme} userProfile={userProfile} setUserProfile={setUserProfile} setUnlockedPopups={setUnlockedPopups} />}
      {currentScreen === 'game' && <GameScreen onHome={() => setCurrentScreen('start')} onLeaderboard={() => setCurrentScreen('leaderboard')} userProfile={userProfile} setUserProfile={setUserProfile} setUnlockedPopups={setUnlockedPopups} />}
      {currentScreen === 'leaderboard' && <LeaderboardScreen onHome={() => setCurrentScreen('start')} />}
    </div>
  )
}

function StartScreen({ onPlay, onLeaderboard, isDarkMode, toggleTheme, userProfile, setUserProfile, setUnlockedPopups }) {
  const [showHelp, setShowHelp] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [recoverCode, setRecoverCode] = useState('');
  const [isRecovering, setIsRecovering] = useState(false);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState('');
  const [debugTime, setDebugTime] = useState(9.5);
  const [debugMistakes, setDebugMistakes] = useState(0);
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
      const deviceId = userProfile.id;
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
      const deviceId = userProfile.id;
      
      // 백업 코드를 발급받는 유저는 계속 플레이할 진성 유저일 확률이 높으므로,
      // 데이터베이스 구조의 일관성을 위해 나머지 기본 요소들도 함께 생성해줍니다.
      const fullProfile = {
        backupCode: newCode,
        nickname: userProfile?.nickname || '',
        currentStreak: userProfile?.currentStreak || 1,
        lastPlayedDate: userProfile?.lastPlayedDate || '',
        achievements: userProfile?.achievements || [],
        totalPlayCount: userProfile?.totalPlayCount || 0,
        longestStreak: userProfile?.longestStreak || userProfile?.currentStreak || 1,
        gameStartDate: userProfile?.gameStartDate || new Date(new Date().getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0],
        bestRecords: userProfile?.bestRecords || [],
        createdAt: serverTimestamp() // 최초 등록 시간 기록
      };

      await setDoc(doc(db, 'users', deviceId), fullProfile, { merge: true });
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
        const oldData = matchedDoc.data();
        
        const deviceId = userProfile.id;
        // 현재 인증된 내 계정(deviceId) 덮어쓰기
        await setDoc(doc(db, 'users', deviceId), oldData, { merge: true });
        
        setUserProfile({ id: deviceId, ...oldData });
        alert("계정 데이터가 성공적으로 복구되었습니다!");
        setShowProfile(false);
      }
    } catch (e) {
      console.error(e);
      alert("복구 중 오류가 발생했습니다.");
    } finally {
      setIsRecovering(false);
    }
  };

  const { isActive, streak } = getStreakStatus(userProfile);

  return (
    <div className="start-screen">
      <div style={{ width: '100%', maxWidth: '600px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }}>
          <Flame size={32} color={isActive ? '#ef4444' : '#64748b'} fill={isActive ? '#f97316' : 'transparent'} />
          <span style={{ fontWeight: 900, fontSize: '1.4rem', color: isActive ? '#f97316' : '#64748b', letterSpacing: '-1px' }}>
            {isActive ? `DAY ${streak}` : 'NO STREAK'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button 
            className="icon-btn"
            onClick={() => setShowAchievements(true)}
            style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          >
            <Trophy size={24} />
          </button>
          <button 
            className="icon-btn"
            onClick={() => setShowStatistics(true)}
            style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
          >
            <BarChart size={24} />
          </button>
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
      </div>
      <h1 style={{ marginTop: '60px' }}>Daily Arrow</h1>
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

      {import.meta.env.DEV && (
        <div style={{ position: 'fixed', bottom: '1rem', left: '1rem', background: 'rgba(0,0,0,0.8)', padding: '1rem', borderRadius: '8px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.75rem', maxHeight: '50vh', overflowY: 'auto', border: '1px solid #fbbf24', textAlign: 'left', minWidth: '320px' }}>
          <div style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: '0.5rem', textAlign: 'center' }}>Event Triggers</div>
          <button onClick={async () => {
             const deviceId = userProfile.id;
             const resetData = { achievements: [], currentStreak: 1, todayClearCount: 0, lastPlayedDate: '', todayClearDate: '', totalPlayCount: 0, longestStreak: 1, bestRecords: [] };
             await setDoc(doc(db, 'users', deviceId), resetData, { merge: true });
             setUserProfile(p => ({...p, ...resetData}));
          }} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '0.4rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
            모든 데이터 초기화
          </button>
          
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={async () => {
               const deviceId = userProfile.id;
               const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
               const todayStr = kstNow.toISOString().split('T')[0];
               const timeSec = Number(debugTime); 
               const mistakes = Number(debugMistakes); 
               let newTodayCount = 1;
               if (userProfile?.todayClearDate === todayStr) {
                 newTodayCount = (userProfile?.todayClearCount || 0) + 1;
               }
               const newUnlocked = [];
               if (timeSec <= 15) newUnlocked.push('speed_15s');
               if (timeSec <= 12) newUnlocked.push('speed_12s');
               if (timeSec <= 9.8) newUnlocked.push('speed_9_8s');
               if (mistakes === 0) newUnlocked.push('flawless');
               if (newTodayCount >= 5) newUnlocked.push('play_5');
               if (newTodayCount >= 10) newUnlocked.push('play_10');
               newUnlocked.push('first_clear');

               const currentAchievements = userProfile?.achievements || [];
               const actualNew = newUnlocked.filter(id => !currentAchievements.includes(id));
               const updatedAchievements = [...currentAchievements, ...actualNew];

               const newTotalPlayCount = (userProfile?.totalPlayCount || 0) + 1;
               const updates = { 
                 todayClearDate: todayStr, 
                 todayClearCount: newTodayCount, 
                 achievements: updatedAchievements,
                 totalPlayCount: newTotalPlayCount
               };
               await setDoc(doc(db, 'users', deviceId), updates, { merge: true });
               setUserProfile(p => ({...p, ...updates}));
               if (actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...actualNew]);
            }} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', padding: '0.4rem', cursor: 'pointer', flex: 1, whiteSpace: 'nowrap' }}>
              게임 완료 트리거
            </button>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', color: '#cbd5e1' }}>
              <input type="number" step="0.1" value={debugTime} onChange={e => setDebugTime(e.target.value)} style={{ width: '40px', padding: '0.2rem', borderRadius: '4px', border: 'none', fontSize: '0.75rem', textAlign: 'center' }} title="기록(초)" />초
              <input type="number" value={debugMistakes} onChange={e => setDebugMistakes(e.target.value)} style={{ width: '30px', padding: '0.2rem', borderRadius: '4px', border: 'none', fontSize: '0.75rem', textAlign: 'center', marginLeft: '0.25rem' }} title="실수 횟수" />회
            </div>
          </div>

          <button onClick={async () => {
             const deviceId = userProfile.id;
             const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
             const todayStr = kstNow.toISOString().split('T')[0];
             let newStreak = (userProfile?.currentStreak || 1) + 1;
             
             const newUnlocked = ['leaderboard_entry'];
             if (newStreak >= 2) newUnlocked.push('streak_2');
             if (newStreak >= 3) newUnlocked.push('streak_3');
             if (newStreak >= 7) newUnlocked.push('streak_7');

             const currentAchievements = userProfile?.achievements || [];
             const actualNew = newUnlocked.filter(id => !currentAchievements.includes(id));
             const updatedAchievements = [...currentAchievements, ...actualNew];

             const newLongestStreak = Math.max(userProfile?.longestStreak || 1, newStreak);

             const timeSec = Number(debugTime) || 10;
             const mistakes = Number(debugMistakes) || 0;
             const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
             const newBestRecords = [...(userProfile?.bestRecords || []), currentRecord]
               .sort((a, b) => {
                 if (a.time !== b.time) return a.time - b.time;
                 return a.mistakes - b.mistakes;
               }).slice(0, 3);

             const updates = { currentStreak: newStreak, lastPlayedDate: todayStr, achievements: updatedAchievements, longestStreak: newLongestStreak, bestRecords: newBestRecords };
             await setDoc(doc(db, 'users', deviceId), updates, { merge: true });
             setUserProfile(p => ({...p, ...updates}));
             if (actualNew.length > 0) setUnlockedPopups(prev => [...prev, ...actualNew]);
          }} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '0.4rem', cursor: 'pointer' }}>
            점수 등록 트리거 (스트릭 +1 강제 반영)
          </button>
        </div>
      )}

      {showAchievements && (
        <div className="modal-overlay" onClick={() => setShowAchievements(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: '2.5rem', maxWidth: '440px', width: '90%' }}>
              <button className="close-btn" onClick={() => setShowAchievements(false)}>✕</button>
              <h2 style={{ fontSize: '1.87rem', marginBottom: '1.5rem' }}>도전과제</h2>
              
              <div className="modal-info-box" style={{ 
                background: 'rgba(30, 58, 138, 0.3)', 
                padding: '1.5rem', 
                borderRadius: '12px', 
                border: '1px solid rgba(59, 130, 246, 0.2)', 
                marginBottom: '1.5rem',
                height: '316px', // 아이템 높이 약 82px * 3개 + gap 16px * 2 + padding = 약 316px (3개 렌더링 시 최적)
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                {ACHIEVEMENTS.map(ach => {
                  const isUnlocked = userProfile?.achievements?.includes(ach.id);
                  const iconColor = isUnlocked ? '#f59e0b' : '#94a3b8';
                  const bg = isUnlocked ? 'rgba(245, 158, 11, 0.2)' : 'rgba(148, 163, 184, 0.2)';
                  const border = isUnlocked ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(148, 163, 184, 0.5)';
                  const titleColor = isUnlocked ? '#f8fafc' : '#94a3b8';
                  const descColor = isUnlocked ? '#94a3b8' : '#64748b';

                  return (
                    <div key={ach.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', flexShrink: 0 }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: bg, border: border, display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                        <Trophy size={24} color={iconColor} />
                      </div>
                      <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <p style={{ margin: 0, fontWeight: 'bold', fontSize: '1rem', color: titleColor }}>{ach.title}</p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: descColor }}>{ach.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
        </div>
      )}

      {showStatistics && (
        <div className="modal-overlay" onClick={() => setShowStatistics(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: '2.5rem', maxWidth: '440px', width: '90%' }}>
              <button className="close-btn" onClick={() => setShowStatistics(false)}>✕</button>
              <h2 style={{ fontSize: '1.87rem', marginBottom: '1.5rem' }}>통계</h2>
              
              {!userProfile ? (
                <p>로딩 중...</p>
              ) : (
                <>
                  <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>주요 통계 요약</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>{userProfile.totalPlayCount || 0}</span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>완료한 게임 수</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', justifyContent: 'center' }}>
                          <Flame size={20} color={(userProfile.longestStreak || userProfile.currentStreak || 0) > 0 ? '#ef4444' : '#64748b'} fill={(userProfile.longestStreak || userProfile.currentStreak || 0) > 0 ? '#f97316' : 'transparent'} />
                          <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>{userProfile.longestStreak || userProfile.currentStreak || 0}</span>
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최장 스트릭</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f59e0b', marginTop: '0.3rem' }}>{userProfile.gameStartDate ? userProfile.gameStartDate.substring(2).replace(/-/g, '.') : 'N/A'}</span>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>가입일</span>
                      </div>
                    </div>
                  </div>

                  <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>역대 최고 기록 Top 3</h3>
                    {(!userProfile.bestRecords || userProfile.bestRecords.length === 0) ? (
                      <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '1rem 0' }}>아직 등록된 기록이 없습니다.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        {userProfile.bestRecords.map((record, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                              <span style={{ fontSize: '1.4rem', width: '24px', textAlign: 'center', lineHeight: '1' }}>{['🥇', '🥈', '🥉'][idx]}</span>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f8fafc' }}>{record.time.toFixed(2)}초</span>
                                <span style={{ fontSize: '0.8rem', color: record.mistakes === 0 ? '#10b981' : '#ef4444' }}>
                                  {record.mistakes === 0 ? '실수 없음' : `실수 ${record.mistakes}회`}
                                </span>
                              </div>
                            </div>
                            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{record.date}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
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

function GameScreen({ onHome, onLeaderboard, userProfile, setUserProfile, setUnlockedPopups }) {
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

          const newUnlocked = [];
          if (timeSec <= 15) newUnlocked.push('speed_15s');
          if (timeSec <= 12) newUnlocked.push('speed_12s');
          if (timeSec <= 9.8) newUnlocked.push('speed_9_8s');
          if (mistakes === 0) newUnlocked.push('flawless');
          if (newTodayCount >= 5) newUnlocked.push('play_5');
          if (newTodayCount >= 10) newUnlocked.push('play_10');
          newUnlocked.push('first_clear');

          const currentAchievements = userProfile.achievements || [];
          const actualNew = newUnlocked.filter(id => !currentAchievements.includes(id));
          const updatedAchievements = [...currentAchievements, ...actualNew];

          const newTotalPlayCount = (userProfile.totalPlayCount || 0) + 1;
          const updates = {
            todayClearDate: todayStr,
            todayClearCount: newTodayCount,
            achievements: updatedAchievements,
            totalPlayCount: newTotalPlayCount
          };

          await setDoc(doc(db, 'users', deviceId), updates, { merge: true });
          setUserProfile(prev => ({ ...prev, ...updates }));
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
        timestamp: serverTimestamp()
      });

      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const todayStr = kstNow.toISOString().split('T')[0];
      let newStreak = 1;

      if (userProfile && userProfile.lastPlayedDate) {
        const today = new Date(todayStr);
        const last = new Date(userProfile.lastPlayedDate);
        const diffDays = Math.round((today - last) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
          newStreak = userProfile.currentStreak || 1;
        } else if (diffDays === 1) {
          newStreak = (userProfile.currentStreak || 1) + 1;
        } else {
          newStreak = 1;
        }
      }

      const newUnlocked = ['leaderboard_entry'];
      if (newStreak >= 2) newUnlocked.push('streak_2');
      if (newStreak >= 3) newUnlocked.push('streak_3');
      if (newStreak >= 7) newUnlocked.push('streak_7');

      try {
        const qList = query(scoresRef, orderBy('time', 'asc'), limit(5));
        const snap = await getDocs(qList);
        if (snap.size >= 5 && snap.docs[0].id === newDocRef.id) {
          newUnlocked.push('top_1');
        }
      } catch(err) { console.error('Error checking top_1:', err); }

      const currentAchievements = userProfile?.achievements || [];
      const actualNew = newUnlocked.filter(id => !currentAchievements.includes(id));
      const updatedAchievements = [...currentAchievements, ...actualNew];

      const newLongestStreak = Math.max(userProfile?.longestStreak || 1, newStreak);

      const timeSec = Number((timeElapsed / 1000).toFixed(2));
      const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
      const newBestRecords = [...(userProfile?.bestRecords || []), currentRecord]
        .sort((a, b) => {
          if (a.time !== b.time) return a.time - b.time;
          return a.mistakes - b.mistakes;
        })
        .slice(0, 3);

      const updates = {
        nickname: nickname.trim(),
        currentStreak: newStreak,
        lastPlayedDate: todayStr,
        achievements: updatedAchievements,
        longestStreak: newLongestStreak,
        bestRecords: newBestRecords
      };

      await setDoc(doc(db, 'users', deviceId), updates, { merge: true });

      setUserProfile(prev => ({ 
        ...prev, 
        ...updates
      }));
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
