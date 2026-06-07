export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem('arrow_game_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('arrow_game_device_id', deviceId);
  }
  return deviceId;
}

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
