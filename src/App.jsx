import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInAnonymously } from 'firebase/auth';
import { loadSecureProfile, saveSecureProfile, getKSTDateString } from './utils';

import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';
import MultiplayerGameScreen from './components/MultiplayerGameScreen';
import LeaderboardScreen from './components/LeaderboardScreen';
import MultiplayerLobby from './components/MultiplayerLobby';
import AchievementPopupContainer from './components/AchievementPopupContainer';

import './App.css';

function App() {
  const [currentScreen, setCurrentScreen] = useState('start') // 'start', 'game', 'leaderboard', 'multiplayer'
  const [multiplayerData, setMultiplayerData] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('arrow_game_theme');
    if (saved !== null) return saved === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [userProfile, setUserProfile] = useState(() => {
    const localData = loadSecureProfile();
    return localData || null;
  });
  const [unlockedPopups, setUnlockedPopups] = useState([]);
  const [isAuthLoading, setIsAuthLoading] = useState(true);



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
        
        const todayStr = getKSTDateString();

        const localData = loadSecureProfile();
        const userRef = doc(db, 'users', deviceId);

        const fetchAndMerge = async (fallbackProfile) => {
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const data = userSnap.data();
            const merged = { totalPlayCount: data.totalPlayCount || 0, totalLongestStreak: data.totalLongestStreak || data.currentStreak || 0, gameStartDate: data.gameStartDate || todayStr, totalBestRecords: data.totalBestRecords || [], totalPlayTime: data.totalPlayTime || 0, totalMistakes: data.totalMistakes || 0, totalPerfectClear: data.totalPerfectClear || 0, ...data, id: deviceId };
            setUserProfile(merged);
            saveSecureProfile(merged);
          } else {
            setUserProfile(fallbackProfile);
            saveSecureProfile(fallbackProfile);
          }
        };

        if (localData && localData.backupCode) {
          await fetchAndMerge({ ...localData, id: deviceId });
        } else if (localData) {
          setUserProfile({ ...localData, id: deviceId });
        } else {
          const newProfile = {
            id: deviceId,
            backupCode: null,
            nickname: localStorage.getItem('arrow_game_nickname') || '',
            currentStreak: 0,
            lastPlayedDate: '',
            achievements: [],
            totalPlayCount: 0,
            totalLongestStreak: 0,
            gameStartDate: todayStr,
            totalBestRecords: [],
            totalPlayTime: 0,
            totalMistakes: 0,
            totalPerfectClear: 0,
            isNew: true
          };
          setUserProfile(newProfile);
          saveSecureProfile(newProfile);
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

  const saveProfile = async (currentProfile, updates) => {
    const newProfile = { ...currentProfile, ...updates };
    setUserProfile(newProfile);
    saveSecureProfile(newProfile);
    if (newProfile.backupCode) {
      setDoc(doc(db, 'users', newProfile.id), updates, { merge: true }).catch(e => console.error("DB Sync error:", e));
    }
  };

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const nextTheme = !prev;
      localStorage.setItem('arrow_game_theme', nextTheme ? 'dark' : 'light');
      return nextTheme;
    });
  };

  // Full-screen loader removed to implement Optimistic UI

  const handlePlay = async () => {
    setCurrentScreen('game');
  };

  return (
    <div className="app-container">
      {unlockedPopups.length > 0 && (
        <AchievementPopupContainer popups={unlockedPopups} setPopups={setUnlockedPopups} />
      )}
      {(currentScreen === 'start' || currentScreen === 'multiplayer') && <StartScreen onPlay={handlePlay} onMultiplayer={() => setCurrentScreen('multiplayer')} onLeaderboard={() => setCurrentScreen('leaderboard')} isDarkMode={isDarkMode} toggleTheme={toggleTheme} userProfile={userProfile} setUserProfile={setUserProfile} saveProfile={saveProfile} setUnlockedPopups={setUnlockedPopups} isAuthLoading={isAuthLoading} />}
      {currentScreen === 'game' && !multiplayerData && <GameScreen onHome={() => setCurrentScreen('start')} onLeaderboard={() => setCurrentScreen('leaderboard')} userProfile={userProfile} setUserProfile={setUserProfile} saveProfile={saveProfile} setUnlockedPopups={setUnlockedPopups} />}
      {currentScreen === 'game' && multiplayerData && <MultiplayerGameScreen onHome={() => { setCurrentScreen('start'); setMultiplayerData(null); }} onReplay={() => setCurrentScreen('multiplayer')} userProfile={userProfile} multiplayerData={multiplayerData} saveProfile={saveProfile} />}
      {currentScreen === 'multiplayer' && <MultiplayerLobby onHome={() => { setCurrentScreen('start'); setMultiplayerData(null); }} initialRoomId={multiplayerData?.roomId} onGameStart={(roomId, seed) => { setMultiplayerData({ roomId, seed }); setCurrentScreen('game'); }} userProfile={userProfile} />}
      {currentScreen === 'leaderboard' && <LeaderboardScreen onHome={() => setCurrentScreen('start')} />}
    </div>
  )
}

export default App;
