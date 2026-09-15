// Discord OAuth2 클라이언트 헬퍼

const DISCORD_SESSION_KEY = 'arrow_game_discord_user';

/**
 * 공식 디스코드 로고 SVG 컴포넌트
 */
export function DiscordIcon({ size = 20, className = '', color = 'currentColor' }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill={color} 
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}

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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, redirectUri }),
    });
  } catch (err) {
    console.error('exchangeDiscordCode fetch error:', err);
    throw new Error(`토큰 서버 통신 오류 (${err.message}). 광고 차단기(AdBlock)나 브라우저 보호 기능이 활성화되어 있다면 해제 후 다시 시도해 주세요.`);
  }

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || '디스코드 인증에 실패했습니다.');
  }

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
  } catch (e) {
    console.error("Failed to clear Discord user session:", e);
  }
}
