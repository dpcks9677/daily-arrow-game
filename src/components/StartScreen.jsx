import React, { useState, useEffect } from 'react';
import { ArrowUp as LucideUp, ArrowDown as LucideDown, ArrowLeft as LucideLeft, ArrowRight as LucideRight, HelpCircle, Sun, Moon, User, Pencil, Check, Flame, Trophy, BarChart, AlertCircle } from 'lucide-react';
import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getByteLength, generateBackupCode, saveSecureProfile, getKSTDate, getKSTDateString, processGameCompletion, getStreakStatus } from '../utils';
import { ACHIEVEMENTS } from '../constants';

export default function StartScreen({ onPlay, onLeaderboard, isDarkMode, toggleTheme, userProfile, setUserProfile, saveProfile, setUnlockedPopups }) {

const [showHelp, setShowHelp] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showStatistics, setShowStatistics] = useState(false);
  const [statsPage, setStatsPage] = useState(0);
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
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
      await saveProfile(userProfile, { nickname: trimmed });
      localStorage.setItem('arrow_game_nickname', trimmed);
      setIsEditingNickname(false);
      setNicknameError('');
    } catch (e) {
      console.error(e);
      alert("닉네임 저장에 실패했습니다.");
    }
  };

  const handleIssueBackupCode = async () => {
    try {
      let newCode;
      let isUnique = false;
      const usersRef = collection(db, 'users');
      
      while (!isUnique) {
        newCode = generateBackupCode();
        const q = query(usersRef, where('backupCode', '==', newCode));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          isUnique = true;
        }
      }

      const deviceId = userProfile.id;
      const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
      const issuedDateStr = kstNow.toISOString().split('T')[0];
      
      // 백업 코드를 발급받는 유저는 계속 플레이할 진성 유저일 확률이 높으므로,
      // 데이터베이스 구조의 일관성을 위해 나머지 기본 요소들도 함께 생성해줍니다.
      const fullProfile = {
        id: deviceId,
        backupCode: newCode,
        backupCodeIssuedAt: issuedDateStr,
        nickname: userProfile?.nickname || '',
        currentStreak: userProfile?.currentStreak || 0,
        lastPlayedDate: userProfile?.lastPlayedDate || '',
        achievements: userProfile?.achievements || [],
        totalPlayCount: userProfile?.totalPlayCount || 0,
        totalLongestStreak: userProfile?.totalLongestStreak || userProfile?.currentStreak || 0,
        gameStartDate: userProfile?.gameStartDate || issuedDateStr,
        totalBestRecords: userProfile?.totalBestRecords || [],
        totalPlayTime: userProfile?.totalPlayTime || 0,
        totalMistakes: userProfile?.totalMistakes || 0,
        totalPerfectClear: userProfile?.totalPerfectClear || 0,
        createdAt: serverTimestamp() // 최초 등록 시간 기록
      };

      await setDoc(doc(db, 'users', deviceId), fullProfile, { merge: true });
      setUserProfile(fullProfile);
      saveSecureProfile(fullProfile);
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
        // 현재 인증된 내 계정(deviceId) 덮어쓰기 (기존 테스트 데이터가 섞이지 않도록 완전히 덮어씌움)
        await setDoc(doc(db, 'users', deviceId), oldData);
        
        const newProfile = { ...oldData, id: deviceId };
        setUserProfile(newProfile);
        saveSecureProfile(newProfile);
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

  const { isActive, streak, isPlayedToday } = getStreakStatus(userProfile);

  return (
    <div className="start-screen">
<div style={{ width: '100%', maxWidth: '600px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'default' }}>
          <Flame size={32} color={isPlayedToday ? '#ef4444' : '#64748b'} fill={isPlayedToday ? '#f97316' : 'transparent'} className={isPlayedToday ? 'flame-burning' : ''} />
          <span style={{ fontWeight: 900, fontSize: '1.4rem', color: isPlayedToday ? '#f97316' : '#64748b', letterSpacing: '-1px' }}>
            {isActive ? `DAY ${streak}` : 'NO STREAK'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!userProfile?.backupCode ? (
            <div className="custom-tooltip-wrapper">
              <button 
                className="icon-btn"
                style={{ 
                  width: '40px', height: '40px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: '#475569', 
                  cursor: 'default', 
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  opacity: 0.4
                }}
              >
                <Trophy size={24} />
              </button>
              <span className="custom-tooltip">프로필을 생성하고 도전과제 시스템을 활성화 하세요.</span>
            </div>
          ) : (
            <div className="custom-tooltip-wrapper">
              <button 
                className="icon-btn"
                onClick={() => setShowAchievements(true)}
                style={{ 
                  width: '40px', height: '40px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: '#cbd5e1', 
                  cursor: 'pointer', 
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  opacity: 1
                }}
              >
                <Trophy size={24} />
              </button>
              <span className="custom-tooltip">도전과제</span>
            </div>
          )}

          {!userProfile?.backupCode ? (
            <div className="custom-tooltip-wrapper">
              <button 
                className="icon-btn"
                style={{ 
                  width: '40px', height: '40px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: '#475569', 
                  cursor: 'default', 
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  opacity: 0.4
                }}
              >
                <BarChart size={24} />
              </button>
              <span className="custom-tooltip">프로필을 생성하고 통계 시스템을 활성화 하세요.</span>
            </div>
          ) : (
            <div className="custom-tooltip-wrapper">
              <button 
                className="icon-btn"
                onClick={() => setShowStatistics(true)}
                style={{ 
                  width: '40px', height: '40px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: '#cbd5e1', 
                  cursor: 'pointer', 
                  display: 'flex', justifyContent: 'center', alignItems: 'center',
                  opacity: 1
                }}
              >
                <BarChart size={24} />
              </button>
              <span className="custom-tooltip">통계</span>
            </div>
          )}
          <div className="custom-tooltip-wrapper">
            <button 
              className="icon-btn"
              onClick={() => setShowProfile(true)}
              style={{ position: 'relative', width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              <User size={24} />
              {(!userProfile?.backupCode && userProfile) && (
                <div style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#1e293b', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '2px' }}>
                  <AlertCircle size={16} color="#fbbf24" fill="#1e293b" />
                </div>
              )}
            </button>
            <span className="custom-tooltip">내 프로필</span>
          </div>
          
          <div className="custom-tooltip-wrapper">
            <button 
              className="icon-btn"
              onClick={toggleTheme}
              style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              {isDarkMode ? <Sun size={24} /> : <Moon size={24} />}
            </button>
            <span className="custom-tooltip">{isDarkMode ? '라이트 테마' : '다크 테마'}</span>
          </div>
          
          <div className="custom-tooltip-wrapper">
            <button 
              className="icon-btn"
              onClick={() => setShowHelp(true)}
              style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: '#cbd5e1', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
            >
              <HelpCircle size={24} />
            </button>
            <span className="custom-tooltip">게임 도움말</span>
          </div>
        </div>
      </div>
      <h1 style={{ marginTop: '60px' }}>
        Daily Arrow
      </h1>
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
             const resetData = { achievements: [], currentStreak: 0, todayClearCount: 0, lastPlayedDate: '', todayClearDate: '', totalPlayCount: 0, longestStreak: 0, bestRecords: [], totalLongestStreak: 0, totalBestRecords: [], totalPlayTime: 0, totalMistakes: 0, totalPerfectClear: 0, dailyRecords: {} };
             await saveProfile(userProfile, resetData);
          }} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '0.4rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
            모든 데이터 초기화
          </button>
          
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={async () => {
               const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
               const todayStr = kstNow.toISOString().split('T')[0];
               const timeSec = Number(debugTime); 
               const mistakes = Number(debugMistakes); 
               let newTodayCount = 1;
               if (userProfile?.todayClearDate === todayStr) {
                 newTodayCount = (userProfile?.todayClearCount || 0) + 1;
               }
               let newStreak = 1;
               if (userProfile?.lastPlayedDate) {
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

               const currentAchievements = userProfile?.achievements || [];
               const actualNew = userProfile?.backupCode ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
               const updatedAchievements = [...currentAchievements, ...actualNew];

               const newTotalPlayCount = (userProfile?.totalPlayCount || 0) + 1;
               const newTotalLongestStreak = Math.max(userProfile?.totalLongestStreak || userProfile?.longestStreak || 0, newStreak);

               const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
               const newTotalBestRecords = [...(userProfile?.totalBestRecords || userProfile?.bestRecords || []), currentRecord]
                 .sort((a, b) => {
                   if (a.time !== b.time) return a.time - b.time;
                   return a.mistakes - b.mistakes;
                 }).slice(0, 3);

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
            }} style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', padding: '0.4rem', cursor: 'pointer', flex: 1, whiteSpace: 'nowrap' }}>
              게임 완료 트리거
            </button>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', color: '#cbd5e1' }}>
              <input type="number" step="0.1" value={debugTime} onChange={e => setDebugTime(e.target.value)} style={{ width: '40px', padding: '0.2rem', borderRadius: '4px', border: 'none', fontSize: '0.75rem', textAlign: 'center' }} title="기록(초)" />초
              <input type="number" value={debugMistakes} onChange={e => setDebugMistakes(e.target.value)} style={{ width: '30px', padding: '0.2rem', borderRadius: '4px', border: 'none', fontSize: '0.75rem', textAlign: 'center', marginLeft: '0.25rem' }} title="실수 횟수" />회
            </div>
          </div>

          <button onClick={async () => {
             const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
             const todayStr = kstNow.toISOString().split('T')[0];
             let newStreak = (userProfile?.currentStreak || 1) + 1;
             
             const newUnlocked = ['leaderboard_entry'];
             if (newStreak >= 2) newUnlocked.push('streak_2');
             if (newStreak >= 3) newUnlocked.push('streak_3');
             if (newStreak >= 7) newUnlocked.push('streak_7');

             const currentAchievements = userProfile?.achievements || [];
             const actualNew = userProfile?.backupCode ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
             const updatedAchievements = [...currentAchievements, ...actualNew];

             const newTotalLongestStreak = Math.max(userProfile?.totalLongestStreak || userProfile?.longestStreak || 0, newStreak);

             const timeSec = Number(debugTime) || 10;
             const mistakes = Number(debugMistakes) || 0;
             const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
             const newTotalBestRecords = [...(userProfile?.totalBestRecords || userProfile?.bestRecords || []), currentRecord]
               .sort((a, b) => {
                 if (a.time !== b.time) return a.time - b.time;
                 return a.mistakes - b.mistakes;
               }).slice(0, 3);
               
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
               currentStreak: newStreak, 
               lastPlayedDate: todayStr, 
               achievements: updatedAchievements, 
               totalLongestStreak: newTotalLongestStreak, 
               totalBestRecords: newTotalBestRecords,
               totalPlayTime: newTotalPlayTime,
               totalMistakes: newTotalMistakes,
               totalPerfectClear: newTotalPerfectClear,
               dailyRecords: newDailyRecords,
               totalPlayCount: (userProfile?.totalPlayCount || 0) + 1
             };
             await saveProfile(userProfile, updates);
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
                    <div key={ach.id} className="inner-box" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', flexShrink: 0 }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: bg, border: border, display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                        <Trophy size={24} color={iconColor} />
                      </div>
                      <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        <p className="ach-title" style={{ margin: 0, fontWeight: 'bold', fontSize: '1rem', color: titleColor }}>{ach.title}</p>
                        <p className="ach-desc" style={{ margin: 0, fontSize: '0.8rem', color: descColor }}>{ach.desc}</p>
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
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: '2.5rem', maxWidth: '510px', width: '95%', position: 'relative' }}>
              <button className="close-btn" onClick={() => setShowStatistics(false)}>✕</button>

              <h2 style={{ fontSize: '1.87rem', marginBottom: '1.5rem' }}>{statsPage === 0 ? '통계' : '날짜 별 기록'}</h2>

              {/* Pagination Arrows */}
              {statsPage > 0 && (
                <button onClick={() => setStatsPage(p => p - 1)} style={{ position: 'absolute', left: '15px', top: '55%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', color: '#f8fafc', cursor: 'pointer', width: '40px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
                  <LucideLeft size={24} />
                </button>
              )}
              {statsPage < 1 && (
                <button onClick={() => setStatsPage(p => p + 1)} style={{ position: 'absolute', right: '15px', top: '55%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', color: '#f8fafc', cursor: 'pointer', width: '40px', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
                  <LucideRight size={24} />
                </button>
              )}
              
              {!userProfile ? (
                <p>로딩 중...</p>
              ) : (
                <>
                  {statsPage === 0 ? (
                    <div style={{ width: '90%', margin: '0 auto', height: '675px', display: 'flex', flexDirection: 'column' }}>
                      <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>주요 통계 요약</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <span className="stat-number" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>{userProfile.totalPlayCount || 0}</span>
                            <span className="stat-label" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>완료한 게임 수</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', justifyContent: 'center' }}>
                              <Flame size={20} color={(userProfile.totalLongestStreak || userProfile.currentStreak || 0) > 0 ? '#ef4444' : '#64748b'} fill={(userProfile.totalLongestStreak || userProfile.currentStreak || 0) > 0 ? '#f97316' : 'transparent'} />
                              <span className="stat-number" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: (userProfile.totalLongestStreak || userProfile.currentStreak || 0) > 0 ? '#f59e0b' : '#94a3b8' }}>{userProfile.totalLongestStreak || userProfile.currentStreak || 0}</span>
                            </div>
                            <span className="stat-label" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최장 스트릭</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            <span className="stat-number" style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f59e0b', marginTop: '0.3rem' }}>{(userProfile.backupCodeIssuedAt || userProfile.gameStartDate) ? (userProfile.backupCodeIssuedAt || userProfile.gameStartDate).substring(2).replace(/-/g, '.') : 'N/A'}</span>
                            <span className="stat-label" style={{ fontSize: '0.8rem', color: '#94a3b8' }}>가입일</span>
                          </div>
                        </div>
                      </div>

                      <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>오늘의 기록</h3>
                        {(() => {
                          const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
                          const todayStr = kstNow.toISOString().split('T')[0];
                          const dailyRecs = userProfile.dailyRecords || {};
                          const todayDaily = dailyRecs[todayStr] || { todayPlayCount: 0, todayMistakes: 0, todayPlayTime: 0, todayTrials: 0 };
                          
                          const avgMistakes = todayDaily.todayPlayCount > 0 ? (todayDaily.todayMistakes / todayDaily.todayPlayCount).toFixed(1) : 0;
                          const totalTimeSec = todayDaily.todayPlayTime || 0;
                          const mins = Math.floor(totalTimeSec / 60);
                          const secs = Math.floor(totalTimeSec % 60);
                          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span className="stat-number" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#fbbf24' }}>{todayDaily.todayTrials || 0}</span>
                                <span className="stat-label" style={{ fontSize: '0.75rem', color: '#94a3b8', wordBreak: 'keep-all' }}>시도한<br />게임 수</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span className="stat-number" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#10b981' }}>{todayDaily.todayPlayCount}</span>
                                <span className="stat-label" style={{ fontSize: '0.75rem', color: '#94a3b8', wordBreak: 'keep-all' }}>완료한<br />게임 수</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <span className="stat-number" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f97316' }}>{avgMistakes}</span>
                                <span className="stat-label" style={{ fontSize: '0.75rem', color: '#94a3b8', wordBreak: 'keep-all' }}>틀린 횟수 평균</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', justifyContent: 'center' }}>
                                <span className="stat-number" style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#3b82f6', marginTop: '0.3rem' }}>{todayDaily.todayPlayCount > 0 ? timeStr : '-'}</span>
                                <span className="stat-label" style={{ fontSize: '0.75rem', color: '#94a3b8', wordBreak: 'keep-all' }}>플레이타임</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.2rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', flexDirection: 'column', gap: '0.8rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>역대 최고 기록 Top 3</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', margin: 'auto 0' }}>
                          {[0, 1, 2].map((idx) => {
                            const record = userProfile.totalBestRecords ? userProfile.totalBestRecords[idx] : null;
                            return (
                              <div key={idx} className="inner-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                  <span style={{ fontSize: '1.4rem', width: '24px', textAlign: 'center', lineHeight: '1' }}>{['🥇', '🥈', '🥉'][idx]}</span>
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    {record ? (
                                      <>
                                        <span className="stat-highlight" style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f8fafc' }}>{record.time.toFixed(2)}s</span>
                                        <span style={{ fontSize: '0.8rem', color: record.mistakes === 0 ? '#10b981' : '#ef4444' }}>
                                          {record.mistakes === 0 ? '실수 없음' : `실수 ${record.mistakes}회`}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="stat-highlight" style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#94a3b8' }}>기록 없음</span>
                                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>-</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <span className="stat-date" style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{record ? record.date : '-'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '90%', margin: '0 auto', height: '675px' }}>
                      <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', flexDirection: 'column', gap: '1rem', height: '420px' }}>
                        <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>최근 7일 기록</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                          {(() => {
                            const dailyRecs = userProfile.dailyRecords || {};
                            const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
                            const list = [];
                            for(let i=0; i<7; i++) {
                              const d = new Date(kstNow.getTime() - i * 24 * 60 * 60 * 1000);
                              const dateStr = d.toISOString().split('T')[0];
                              const rec = dailyRecs[dateStr];
                              if (rec) {
                                list.push({ dateStr, rec });
                              }
                            }
                            if (list.length === 0) return <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0.5rem 0' }}>최근 7일간의 기록이 없습니다.</p>;
                            
                            const header = (
                              <div key="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.2rem 0.4rem 0.2rem', borderBottom: '1px solid rgba(255, 255, 255, 0.2)', marginBottom: '0.2rem' }}>
                                <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 'bold' }}>날짜</span>
                                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 'bold', width: '70px', textAlign: 'right', whiteSpace: 'nowrap' }}>플레이 횟수</span>
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 'bold', width: '70px', textAlign: 'right', whiteSpace: 'nowrap' }}>최고 기록</span>
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 'bold', width: '45px', textAlign: 'right', whiteSpace: 'nowrap' }}>실수</span>
                                </div>
                              </div>
                            );

                            return [header, ...list.map((item, idx) => (
                              <div key={item.dateStr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 0.2rem', borderBottom: idx < list.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none' }}>
                                <span style={{ color: '#e2e8f0', fontWeight: 'bold', fontSize: '0.9rem' }}>{item.dateStr.substring(5).replace('-','.')}</span>
                                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem', width: '70px', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.rec.todayPlayCount || 0}회</span>
                                  <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '0.9rem', width: '70px', textAlign: 'right', whiteSpace: 'nowrap' }}>{(item.rec.todayBestTime || 0).toFixed(2)}s</span>
                                  <span style={{ color: item.rec.todayBestMistakes === 0 ? '#10b981' : '#ef4444', fontSize: '0.75rem', width: '45px', textAlign: 'right', whiteSpace: 'nowrap' }}>{item.rec.todayBestMistakes === 0 ? '0회' : `${item.rec.todayBestMistakes}회`}</span>
                                </div>
                              </div>
                            ))];
                          })()}
                        </div>
                      </div>

                      <div className="modal-info-box" style={{ background: 'rgba(30, 58, 138, 0.3)', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minHeight: 0 }}>
                        {(() => {
                          const kstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
                          const todayDow = kstNow.getDay();
                          const N_WEEKS = 26; // Half a year
                          const totalDays = N_WEEKS * 7 + (todayDow + 1);

                          const dailyRecs = userProfile.dailyRecords || {};

                          const getGrassStyle = (count) => {
                            if (!count || count === 0) return { backgroundColor: 'rgba(255, 255, 255, 0.05)' };
                            if (count <= 2) return { backgroundColor: '#065f46' }; // 어두운 초록
                            if (count <= 5) return { backgroundColor: '#059669' }; // 중간 초록
                            if (count <= 9) return { backgroundColor: '#10b981' }; // 밝은 에메랄드
                            return { backgroundColor: '#34d399', boxShadow: '0 0 6px rgba(52, 211, 153, 0.8)' }; // 형광 네온 그린 + 빛바램
                          };

                          const cells = [];
                          for (let i = 0; i < totalDays; i++) {
                            const d = new Date(kstNow.getTime() - (totalDays - 1 - i) * 24 * 60 * 60 * 1000);
                            const dateStr = d.toISOString().split('T')[0];
                            const count = dailyRecs[dateStr]?.todayPlayCount || 0;
                            const customStyle = getGrassStyle(count);
                            const tooltip = `${dateStr} : ${count}판`;
                            cells.push(
                              <div key={dateStr} title={tooltip} style={{ width: '12px', height: '12px', borderRadius: '2px', border: '1px solid rgba(255,255,255,0.05)', ...customStyle }} />
                            );
                          }

                          const monthLabels = [];
                          let lastPlacedCol = -1;
                          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                          let prevMonth = -1;
                          for (let i = 0; i < totalDays; i++) {
                            const d = new Date(kstNow.getTime() - (totalDays - 1 - i) * 24 * 60 * 60 * 1000);
                            const m = d.getMonth();
                            const colIndex = Math.floor(i / 7);
                            if (m !== prevMonth) {
                              if (i !== 0 || d.getDate() <= 7) {
                                if (colIndex > lastPlacedCol + 1) {
                                  monthLabels.push(
                                    <span key={`month-${i}`} style={{ position: 'absolute', left: `${colIndex * 16}px`, fontSize: '0.65rem', color: '#94a3b8', bottom: 0, lineHeight: '14px' }}>
                                      {monthNames[m]}
                                    </span>
                                  );
                                  lastPlacedCol = colIndex;
                                }
                              }
                              prevMonth = m;
                            }
                          }

                          return (
                            <>
                              <h3 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0, textAlign: 'left' }}>잔디 기록</h3>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flex: 1 }}>
                                <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 12px)', gap: '4px', paddingRight: '0.2rem', paddingTop: '18px' }}>
                                  <span />
                                  <span style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: '12px' }}>Mon</span>
                                  <span />
                                  <span style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: '12px' }}>Wed</span>
                                  <span />
                                  <span style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: '12px' }}>Fri</span>
                                  <span />
                                </div>
                                <div className="custom-scroll" style={{ overflowX: 'auto', paddingBottom: '0.5rem', direction: 'rtl', flex: 1 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', direction: 'ltr', width: 'max-content', paddingBottom: '12px' }}>
                                    <div style={{ position: 'relative', height: '14px', marginBottom: '4px' }}>
                                      {monthLabels}
                                    </div>
                                    <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 12px)', gap: '4px' }}>
                                      {cells}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
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
                      {userProfile.backupCode ? '이 코드를 복사하여 기기를 변경하거나 기록이 지워졌을 때 복구할 수 있습니다.' : (
                        <>코드를 발급받아 내 기록을 안전하게 백업하고<br/>통계 및 도전과제 시스템을 이용해보세요.</>
                      )}
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