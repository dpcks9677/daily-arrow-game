import CryptoJS from 'crypto-js';
import confetti from 'canvas-confetti';

export function getByteLength(str) {
  let byteLen = 0;
  for (let i = 0; i < str.length; i++) {
    byteLen += str.charCodeAt(i) > 127 ? 2.5 : 1;
  }
  return byteLen;
}

export function getDailySeed() {
    const today = new Date();
    // Use local time for daily seed: YYYYMMDD
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    return seed;
}

export function getKSTDate() {
    return new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
}

export function getKSTDateString() {
    return getKSTDate().toISOString().split('T')[0];
}

export function processGameCompletion(userProfile, timeSec, mistakes) {
    if (!userProfile) return null;
    const todayStr = getKSTDateString();
    
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
    const actualNew = userProfile.backupCode ? newUnlocked.filter(id => !currentAchievements.includes(id)) : [];
    const updatedAchievements = [...currentAchievements, ...actualNew];

    const newTotalPlayCount = (userProfile.totalPlayCount || 0) + 1;
    const newTotalLongestStreak = Math.max(userProfile.totalLongestStreak || userProfile.longestStreak || 0, newStreak);

    const currentRecord = { time: timeSec, mistakes: mistakes, date: todayStr };
    const newTotalBestRecords = [...(userProfile.totalBestRecords || userProfile.bestRecords || []), currentRecord]
      .sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        return a.mistakes - b.mistakes;
      })
      .slice(0, 3);

    const newTotalPlayTime = Number(((userProfile.totalPlayTime || 0) + timeSec).toFixed(2));
    const newTotalMistakes = (userProfile.totalMistakes || 0) + mistakes;
    const newTotalPerfectClear = (userProfile.totalPerfectClear || 0) + (mistakes === 0 ? 1 : 0);

    const dailyRecs = userProfile.dailyRecords || {};
    const todayDaily = dailyRecs[todayStr] || { todayPlayCount: 0, todayBestTime: Infinity, todayBestMistakes: Infinity, todayPlayTime: 0, todayMistakes: 0, todayTrials: 0 };
    const newDailyRecords = {
      ...dailyRecs,
      [todayStr]: {
        ...todayDaily,
        todayPlayCount: (todayDaily.todayPlayCount || 0) + 1,
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

    return { updates, actualNew };
}

export const triggerConfetti = () => {
  const commonOptions = {
    particleCount: 80,
    spread: 70,
    scalar: 1.8,
    colors: ['#ef4444', '#3b82f6', '#facc15'],
    startVelocity: 50
  };

  confetti({
    ...commonOptions,
    angle: 60,
    origin: { x: 0, y: 0.45 }
  });

  confetti({
    ...commonOptions,
    angle: 120,
    origin: { x: 1, y: 0.45 }
  });
};

export const getStreakStatus = (userProfile) => {
  if (!userProfile || !userProfile.lastPlayedDate) {
    return { isActive: false, streak: 0, isPlayedToday: false };
  }
  const todayStr = getKSTDateString();
  const today = new Date(todayStr);
  const last = new Date(userProfile.lastPlayedDate);
  const diffDaysStr = Math.round((today - last) / (1000 * 60 * 60 * 24));
  
  const isPlayedToday = diffDaysStr === 0;

  if (diffDaysStr <= 1) {
    return { isActive: true, streak: userProfile.currentStreak || 0, isPlayedToday };
  } else {
    return { isActive: false, streak: 0, isPlayedToday: false };
  }
};

// Seeded PRNG (Mulberry32)
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

export function generateDailyArrows(count = 50, customSeed = null) {
    let seed;
    if (customSeed !== null) {
        if (typeof customSeed === 'string') {
            let hash = 0;
            for (let i = 0; i < customSeed.length; i++) {
                const char = customSeed.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            seed = hash;
        } else {
            seed = customSeed;
        }
    } else {
        seed = getDailySeed();
    }
    const prng = mulberry32(seed);
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const result = [];
    for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(prng() * arrows.length);
        result.push(arrows[randomIndex]);
    }
    return result;
}

export function getArrowSymbol(key) {
    switch (key) {
        case 'ArrowUp': return '↑';
        case 'ArrowDown': return '↓';
        case 'ArrowLeft': return '←';
        case 'ArrowRight': return '→';
        default: return '';
    }
}

export function generateBackupCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result.slice(0, 4) + '-' + result.slice(4);
}

const SECRET_KEY = import.meta.env.VITE_APP_SECRET || 'daily_arrow_secure_key_2026_!@#';

export function saveSecureProfile(profile) {
    try {
        const jsonStr = JSON.stringify(profile);
        const hash = CryptoJS.HmacSHA256(jsonStr, SECRET_KEY).toString();
        const ciphertext = CryptoJS.AES.encrypt(jsonStr, SECRET_KEY).toString();
        
        const payload = {
            data: ciphertext,
            hash: hash
        };
        localStorage.setItem('arrow_game_profile', JSON.stringify(payload));
    } catch (e) {
        console.error("Failed to secure profile:", e);
    }
}

export function loadSecureProfile() {
    try {
        const payloadStr = localStorage.getItem('arrow_game_profile');
        if (!payloadStr) return null;

        const payload = JSON.parse(payloadStr);
        if (!payload || !payload.data || !payload.hash) return null;

        const bytes = CryptoJS.AES.decrypt(payload.data, SECRET_KEY);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        
        if (!decryptedStr) return null;

        const calculatedHash = CryptoJS.HmacSHA256(decryptedStr, SECRET_KEY).toString();
        
        if (calculatedHash === payload.hash) {
            return migrateProfileData(JSON.parse(decryptedStr));
        } else {
            console.error("Profile integrity check failed! Data tampered.");
            localStorage.removeItem('arrow_game_profile');
            return null;
        }
    } catch (e) {
        console.error("Failed to load secure profile:", e);
        localStorage.removeItem('arrow_game_profile');
        return null;
    }
}

export function migrateProfileData(profile) {
  if (!profile) return profile;
  const migrated = { ...profile };

  if (migrated.playCount !== undefined) {
    migrated.totalPlayCount = migrated.playCount;
    delete migrated.playCount;
  }
  if (migrated.perfectClearCount !== undefined) {
    migrated.totalPerfectClear = migrated.perfectClearCount;
    delete migrated.perfectClearCount;
  }
  if (migrated.bestRecords !== undefined) {
    migrated.totalBestRecords = migrated.bestRecords;
    delete migrated.bestRecords;
  }
  if (migrated.longestStreak !== undefined) {
    migrated.totalLongestStreak = migrated.longestStreak;
    delete migrated.longestStreak;
  }

  if (migrated.dailyRecords) {
    for (const date in migrated.dailyRecords) {
      const daily = migrated.dailyRecords[date];
      if (daily.playCount !== undefined) {
        daily.todayPlayCount = daily.playCount;
        delete daily.playCount;
      }
      if (daily.bestTime !== undefined) {
        daily.todayBestTime = daily.bestTime;
        delete daily.bestTime;
      }
      if (daily.bestMistakes !== undefined) {
        daily.todayBestMistakes = daily.bestMistakes;
        delete daily.bestMistakes;
      }
      if (daily.totalTime !== undefined) {
        daily.todayPlayTime = daily.totalTime;
        delete daily.totalTime;
      }
      if (daily.totalMistakes !== undefined) {
        daily.todayMistakes = daily.totalMistakes;
        delete daily.totalMistakes;
      }
    }
  }

  return migrated;
}
