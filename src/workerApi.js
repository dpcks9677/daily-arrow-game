// Worker(Cloudflare) 호출 헬퍼. Firestore 쓰기(프로필, 점수, 멀티플레이 로그)는 모두 Worker를 거친다.
// 요청마다 신원 확인용 헤더를 붙인다:
//  - Authorization: Bearer <Discord access_token>  (디스코드 액티비티)
//  - X-Session: <Worker 세션 토큰>                   (웹에서 Discord 로그인한 경우)
//  - X-Firebase-Token: <Firebase 익명 로그인 ID 토큰> (웹)
import { auth } from './firebase';
import { isDiscordActivity, getWorkerAuthHeaders } from './discordActivity';

const SESSION_KEY = 'arrow_game_discord_session';

export function saveStoredSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, session);
  } catch (e) {
    console.error('Failed to save session:', e);
  }
}

export function getStoredSession() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error('Failed to clear session:', e);
  }
}

export async function getIdentityHeaders() {
  const headers = { ...getWorkerAuthHeaders() };
  const session = getStoredSession();
  if (session) headers['X-Session'] = session;
  try {
    const user = auth.currentUser;
    if (user) headers['X-Firebase-Token'] = await user.getIdToken();
  } catch (e) {
    console.warn('Failed to get Firebase ID token:', e);
  }
  return headers;
}

function endpointsFor(path) {
  const base = import.meta.env.VITE_AUTH_SERVER_URL ? import.meta.env.VITE_AUTH_SERVER_URL.replace(/\/$/, '') : '';
  const list = isDiscordActivity()
    ? [`/api${path}`, `/.proxy/api${path}`, base ? `${base}/api${path}` : null]
    : [base ? `${base}/api${path}` : null, `/api${path}`];
  return list.filter(Boolean);
}

/**
 * Worker API 호출. JSON 응답을 주는 첫 엔드포인트의 결과를 { ok, status, data }로 돌려준다.
 * (Discord 프록시/직접 주소 등 후보를 차례로 시도하며, 모두 실패하면 예외를 던진다)
 */
export async function callWorker(path, { method = 'POST', body } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(await getIdentityHeaders()) };
  let lastError = null;
  for (const endpoint of endpointsFor(path)) {
    try {
      const res = await fetch(endpoint, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!(res.headers.get('content-type') || '').includes('application/json')) continue;
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.success !== false, status: res.status, data };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('서버와 통신할 수 없습니다.');
}
