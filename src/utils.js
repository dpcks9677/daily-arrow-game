import CryptoJS from 'crypto-js';

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

// Seeded PRNG (Mulberry32)
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

export function generateDailyArrows(count = 50) {
    const seed = getDailySeed();
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
            return JSON.parse(decryptedStr);
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
