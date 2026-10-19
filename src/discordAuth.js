// Discord OAuth2 클라이언트 헬퍼
import { getIdentityHeaders, saveStoredSession, clearStoredSession } from './workerApi';

const DISCORD_SESSION_KEY = 'arrow_game_discord_user';

/**
 * 디스코드 OAuth2 로그인 인가(Authorization) URL 생성
 */
export function getDiscordAuthUrl() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) {
    console.warn("VITE_DISCORD_CLIENT_ID is not configured in .env");
    return null;
  }
  
  // 현재 접속 중인 도메인 및 포트 기준으로 리다이렉트 URI 설정
  const redirectUri = encodeURIComponent(window.location.origin);
  const scope = encodeURIComponent('identify');

  return `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}`;
}

/**
 * 인가 코드(code)를 백엔드 API에 전달하여 디스코드 유저 정보 획득
 */
export async function exchangeDiscordCode(code) {
  const redirectUri = window.location.origin;
  const baseAuthUrl = import.meta.env.VITE_AUTH_SERVER_URL ? import.meta.env.VITE_AUTH_SERVER_URL.replace(/\/$/, '') : '';
  const endpoint = baseAuthUrl ? `${baseAuthUrl}/api/discord-auth` : '/api/discord-auth';

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      // Firebase 익명 로그인 토큰을 함께 보내면 Worker가 세션 토큰에 내 uid를 묶어 준다
      headers: {
        'Content-Type': 'application/json',
        ...(await getIdentityHeaders()),
      },
      body: JSON.stringify({ code, redirectUri }),
    });
  } catch (err) {
    console.error('exchangeDiscordCode fetch error:', err);
    throw new Error(`토큰 서버 통신 오류 (${err.message}). 광고 차단기(AdBlock)나 브라우저 보호 기능이 활성화되어 있다면 해제 후 다시 시도해 주세요.`, { cause: err });
  }

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || '디스코드 인증에 실패했습니다.');
  }

  saveStoredSession(data.session);
  return data.user;
}

/**
 * 디스코드 유저의 아바타 이미지 URL 반환
 */
export function getDiscordAvatarUrl(discordUser) {
  if (!discordUser || !discordUser.id) return null;
  if (discordUser.avatar) {
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`;
  }
  // 기본 디스코드 아바타 (ID 기반 계산)
  try {
    const defaultIndex = Number((BigInt(discordUser.id) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
  } catch {
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
  }
}

/**
 * 로컬스토리지에 디스코드 세션 저장/조회/삭제
 */
export function saveStoredDiscordUser(user) {
  try {
    localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(user));
  } catch (e) {
    console.error("Failed to save Discord user session:", e);
  }
}

export function getStoredDiscordUser() {
  try {
    const raw = localStorage.getItem(DISCORD_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("Failed to load Discord user session:", e);
    return null;
  }
}

export function clearStoredDiscordUser() {
  try {
    localStorage.removeItem(DISCORD_SESSION_KEY);
    clearStoredSession();
  } catch (e) {
    console.error("Failed to clear Discord user session:", e);
  }
}
