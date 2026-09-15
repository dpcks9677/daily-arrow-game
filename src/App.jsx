import React, { useState, useEffect, useCallback } from 'react';
import { db, auth, doc, setDoc, getDoc, collection, query, where, getDocs } from './firebase';
import { signInAnonymously } from 'firebase/auth';
import { loadSecureProfile, saveSecureProfile, getKSTDateString } from './utils';
import { 
  getDiscordAuthUrl, 
  exchangeDiscordCode, 
  getStoredDiscordUser, 
  saveStoredDiscordUser, 
  clearStoredDiscordUser, 
  getDiscordAvatarUrl 
} from './discordAuth';
import { isDiscordActivity, initDiscordActivity } from './discordActivity';

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
  const [discordUser, setDiscordUser] = useState(() => getStoredDiscordUser());
  const [isActivity, setIsActivity] = useState(() => isDiscordActivity());
  const [channelId, setChannelId] = useState(null);
  const [unlockedPopups, setUnlockedPopups] = useState([]);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [toast]);

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
      const todayStr = getKSTDateString();
      try {
        setIsAuthLoading(true);
        const userCredential = await signInAnonymously(auth);
        const deviceId = userCredential.user.uid;

        let activeDiscordUser = null;

        // 1. 디스코드 액티비티 환경인지 확인 (임베디드 iframe)
        if (isDiscordActivity()) {
          try {
            setIsActivity(true);
            const activityResult = await initDiscordActivity();
            activeDiscordUser = activityResult.discordUser;
            setChannelId(activityResult.channelId);
            saveStoredDiscordUser(activeDiscordUser);
            setDiscordUser(activeDiscordUser);
          } catch (actErr) {
            console.error("Discord Activity initialization error:", actErr);
          }
        } else {
          // 2. 일반 웹 브라우저 OAuth code 확인 (?code=xxxx)
          const params = new URLSearchParams(window.location.search);
          const authCode = params.get('code');
          activeDiscordUser = getStoredDiscordUser();

          if (authCode) {
            window.history.replaceState({}, document.title, window.location.pathname);
            try {
              activeDiscordUser = await exchangeDiscordCode(authCode);
              saveStoredDiscordUser(activeDiscordUser);
              setDiscordUser(activeDiscordUser);
            } catch (oauthErr) {
              console.error("Discord OAuth code exchange failed:", oauthErr);
              showToast("디스코드 로그인 실패: " + oauthErr.message, "error");
            }
          }
        }

        const localData = loadSecureProfile();
        const userRef = doc(db, 'users', deviceId);

        // 2. 디스코드 계정으로 로그인되어 있다면 Firestore에서 기존 연동 기록 조회
        let remoteDiscordData = null;
        if (activeDiscordUser) {
          try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('discordId', '==', activeDiscordUser.id));
            const querySnap = await getDocs(q);
            if (!querySnap.empty) {
              const docs = querySnap.docs.map(d => d.data());
              docs.sort((a, b) => (b.totalPlayCount || 0) - (a.totalPlayCount || 0));
              remoteDiscordData = docs[0];
            }
          } catch (e) {
            console.error("Failed to query user by discordId:", e);
          }
        }

        if (activeDiscordUser) {
          // 디스코드 계정 데이터와 로컬 데이터 병합
          const baseData = remoteDiscordData || localData || {};
          const discordNickname = activeDiscordUser.global_name || activeDiscordUser.username;
          const discordAvatar = getDiscordAvatarUrl(activeDiscordUser);

          const mergedProfile = {
            id: deviceId,
            discordId: activeDiscordUser.id,
            discordUsername: activeDiscordUser.username,
            discordGlobalName: activeDiscordUser.global_name,
            discordAvatar: discordAvatar,
            nickname: baseData.nickname || discordNickname,
            backupCode: baseData.backupCode || null,
            currentStreak: baseData.currentStreak || 0,
            lastPlayedDate: baseData.lastPlayedDate || '',
            achievements: baseData.achievements || [],
            totalPlayCount: baseData.totalPlayCount || 0,
            totalLongestStreak: baseData.totalLongestStreak || baseData.currentStreak || 0,
            gameStartDate: baseData.gameStartDate || todayStr,
            totalBestRecords: baseData.totalBestRecords || [],
            totalPlayTime: baseData.totalPlayTime || 0,
            totalMistakes: baseData.totalMistakes || 0,
            totalPerfectClear: baseData.totalPerfectClear || 0,
            dailyRecords: baseData.dailyRecords || {},
            multiplayerPlays: baseData.multiplayerPlays || 0,
            multiplayerWins: baseData.multiplayerWins || 0,
            multiplayerCompletions: baseData.multiplayerCompletions || 0,
            multiplayerBestTime: baseData.multiplayerBestTime || null,
          };

          setUserProfile(mergedProfile);
          saveSecureProfile(mergedProfile);
          setDoc(userRef, mergedProfile, { merge: true }).catch(e => console.error("Firestore sync error:", e));
        } else {
          // 게스트 / 익명 로그인 로직
          const fetchAndMerge = async (fallbackProfile) => {
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
              const data = userSnap.data();
              const merged = { 
                totalPlayCount: data.totalPlayCount || 0, 
                totalLongestStreak: data.totalLongestStreak || data.currentStreak || 0, 
                gameStartDate: data.gameStartDate || todayStr, 
                totalBestRecords: data.totalBestRecords || [], 
                totalPlayTime: data.totalPlayTime || 0, 
                totalMistakes: data.totalMistakes || 0, 
                totalPerfectClear: data.totalPerfectClear || 0, 
                ...data, 
                id: deviceId 
              };
              setUserProfile(merged);
              saveSecureProfile(merged);
            } else {
              setUserProfile(fallbackProfile);
              saveSecureProfile(fallbackProfile);
            }
          };

          if (localData && (localData.backupCode || localData.discordId)) {
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
        }
      } catch (error) {
        console.error("Auth init failed:", error);
        showToast(`인증 실패 [${error.code || 'ERROR'}]: ${error.message || '인증 서버 연결 실패'}`, "error");

        // 인증 실패 시에도 로컬 플레이가 가능하도록 fallback 프로필 설정
        const fallbackLocal = loadSecureProfile();
        const fallbackId = fallbackLocal?.id || ('guest_' + Math.random().toString(36).substring(2, 9));
        const fallbackProfile = fallbackLocal || {
          id: fallbackId,
          nickname: localStorage.getItem('arrow_game_nickname') || '게스트',
          currentStreak: 0,
          lastPlayedDate: '',
          achievements: [],
          totalPlayCount: 0,
          totalLongestStreak: 0,
          gameStartDate: todayStr || getKSTDateString(),
          totalBestRecords: [],
          totalPlayTime: 0,
          totalMistakes: 0,
          totalPerfectClear: 0,
          isNew: true
        };
        setUserProfile(fallbackProfile);
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
    if (newProfile.backupCode || newProfile.discordId) {
      setDoc(doc(db, 'users', newProfile.id), updates, { merge: true }).catch(e => console.error("DB Sync error:", e));
    }
  };

  const handleDiscordLogin = () => {
    const authUrl = getDiscordAuthUrl();
    if (!authUrl) {
      showToast("디스코드 연동 정보(VITE_DISCORD_CLIENT_ID)가 설정되어 있지 않습니다.", "error");
      return;
    }
    window.location.href = authUrl;
  };

  const handleDiscordLogout = () => {
    if (!window.confirm("로그아웃 하시겠습니까?\n(클라우드에 저장된 스트릭과 기록은 다음 로그인 시 안전하게 복원됩니다)")) return;
    clearStoredDiscordUser();
    setDiscordUser(null);
    setUserProfile(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      delete updated.discordId;
      delete updated.discordUsername;
      delete updated.discordGlobalName;
      delete updated.discordAvatar;
      saveSecureProfile(updated);
      return updated;
    });
    showToast("로그아웃되었습니다.", "info");
  };

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const nextTheme = !prev;
      localStorage.setItem('arrow_game_theme', nextTheme ? 'dark' : 'light');
      return nextTheme;
    });
  };

  const handlePlay = async () => {
    setCurrentScreen('game');
  };

  return (
    <div className="app-container">
      {toast && (
        <div key={toast.id} className={`in-game-toast toast-${toast.type}`}>
          <span>{toast.message}</span>
        </div>
      )}
      {unlockedPopups.length > 0 && (
        <AchievementPopupContainer popups={unlockedPopups} setPopups={setUnlockedPopups} />
      )}
      {(currentScreen === 'start' || currentScreen === 'multiplayer') && (
        <StartScreen 
          onPlay={handlePlay} 
          onMultiplayer={() => setCurrentScreen('multiplayer')} 
          onLeaderboard={() => setCurrentScreen('leaderboard')} 
          isDarkMode={isDarkMode} 
          toggleTheme={toggleTheme} 
          userProfile={userProfile} 
          setUserProfile={setUserProfile} 
          saveProfile={saveProfile} 
          setUnlockedPopups={setUnlockedPopups} 
          isAuthLoading={isAuthLoading}
          discordUser={discordUser}
          isActivity={isActivity}
          onDiscordLogin={handleDiscordLogin}
          onDiscordLogout={handleDiscordLogout}
          showToast={showToast}
        />
      )}
      {currentScreen === 'game' && !multiplayerData && (
        <GameScreen 
          onHome={() => setCurrentScreen('start')} 
          onLeaderboard={() => setCurrentScreen('leaderboard')} 
          userProfile={userProfile} 
          setUserProfile={setUserProfile} 
          saveProfile={saveProfile} 
          setUnlockedPopups={setUnlockedPopups} 
          showToast={showToast}
        />
      )}
      {currentScreen === 'game' && multiplayerData && (
        <MultiplayerGameScreen 
          onHome={() => { setCurrentScreen('start'); setMultiplayerData(null); }} 
          onReplay={() => setCurrentScreen('multiplayer')} 
          userProfile={userProfile} 
          multiplayerData={multiplayerData} 
          saveProfile={saveProfile} 
          showToast={showToast}
        />
      )}
      {currentScreen === 'multiplayer' && (
        <MultiplayerLobby 
          onHome={() => { setCurrentScreen('start'); setMultiplayerData(null); }} 
          initialRoomId={multiplayerData?.roomId} 
          onGameStart={(roomId, seed) => { setMultiplayerData({ roomId, seed }); setCurrentScreen('game'); }} 
          userProfile={userProfile} 
          isActivity={isActivity} 
          channelId={channelId} 
          showToast={showToast}
        />
      )}
      {currentScreen === 'leaderboard' && <LeaderboardScreen onHome={() => setCurrentScreen('start')} />}
    </div>
  )
}

export default App;
