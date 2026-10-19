// 점수 검증: 클라이언트가 보낸 입력 기록(log)을 서버가 시드로 다시 재생해 시간과 실수 횟수를 계산한다.
// 클라이언트가 보낸 "time" 숫자를 믿지 않고, 기록과 서버가 직접 잰 경과 시간으로만 점수를 만든다.

export const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
export const ARROW_COUNT = 50;

// 클라이언트(src/utils.js)의 mulberry32 + generateDailyArrows와 같은 결과를 내야 한다
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateArrows(seed, count = ARROW_COUNT) {
  const prng = mulberry32(Number(seed));
  const result = [];
  for (let i = 0; i < count; i++) result.push(ARROW_KEYS[Math.floor(prng() * ARROW_KEYS.length)]);
  return result;
}

const MIN_GAP_MS = 20; // 연속 입력 최소 간격 (사람이 낼 수 없는 속도 차단)
const MIN_GAP_AFTER_MISTAKE_MS = 450; // 실수 후 기절 시간(500ms) 동안은 입력이 무시된다
const MAX_LOG_LENGTH = 400;
const MAX_TIME_MS = 3600 * 1000;
export const MIN_TIME_SECONDS = 2;

/**
 * log: [[keyIndex, t(ms, 첫 입력 기준), ok(0|1)], ...]
 * 반환: { ok: true, time, mistakes } 또는 { ok: false, error }
 */
export function verifyRun(arrows, log) {
  if (!Array.isArray(log) || log.length < arrows.length || log.length > MAX_LOG_LENGTH) {
    return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
  }

  let next = 0;
  let mistakes = 0;
  let prevT = -Infinity;
  let prevWasMistake = false;

  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    if (!Array.isArray(entry) || entry.length !== 3) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
    const [keyIndex, t, ok] = entry;
    if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 3) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
    if (!Number.isInteger(t) || t < 0 || t > MAX_TIME_MS || (ok !== 0 && ok !== 1)) {
      return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
    }
    if (i === 0 && t !== 0) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
    if (next >= arrows.length) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };

    const gap = t - prevT;
    if (i > 0 && gap < (prevWasMistake ? MIN_GAP_AFTER_MISTAKE_MS : MIN_GAP_MS)) {
      return { ok: false, error: '입력 간격이 올바르지 않습니다.' };
    }

    const isCorrectKey = ARROW_KEYS[keyIndex] === arrows[next];
    if ((ok === 1) !== isCorrectKey) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };

    if (ok === 1) {
      next += 1;
      prevWasMistake = false;
      if (next === arrows.length) {
        if (i !== log.length - 1) return { ok: false, error: '입력 기록이 올바르지 않습니다.' };
        return finalize(t, mistakes);
      }
    } else {
      mistakes += 1;
      prevWasMistake = true;
    }
    prevT = t;
  }
  return { ok: false, error: '완료되지 않은 기록입니다.' };
}

function finalize(lastT, mistakes) {
  const time = Math.round(lastT / 10) / 100; // 소수 둘째 자리 (클라이언트 표시와 동일)
  if (time < MIN_TIME_SECONDS) return { ok: false, error: '기록이 너무 빠릅니다.' };
  return { ok: true, time, mistakes };
}
