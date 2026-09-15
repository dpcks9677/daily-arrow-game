import { DiscordSDK } from '@discord/embedded-app-sdk';

let discordSdkInstance = null;

/**
 * 현재 실행 환경이 디스코드 액티비티(Iframe) 내부인지 판별합니다.
 * 디스코드는 액티비티 실행 시 frame_id 혹은 instance_id 쿼리 파라미터를 주입합니다.
 */
export function isDiscordActivity() {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has('frame_id') || params.has('instance_id');
  } catch (e) {
    return false;
  }
}

/**
 * 현재 활성화된 DiscordSDK 인스턴스를 반환합니다.
 */
export function getDiscordSdk() {
  return discordSdkInstance;
}

/**
 * Discord Activity SDK 초기화 및 무클릭 자동 OAuth2 인증을 수행합니다.
 */
export async function initDiscordActivity() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  if (!clientId) {
    throw new Error('VITE_DISCORD_CLIENT_ID가 설정되지 않았습니다.');
  }

  // 1. SDK 인스턴스 생성 및 핸드셰이크 준비 완료 대기
  discordSdkInstance = new DiscordSDK(clientId);
  await discordSdkInstance.ready();

  // 2. 디스코드 클라이언트로부터 일회용 인가 코드(code) 자동 획득
  const { code } = await discordSdkInstance.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'applications.commands'],
  });

  // 3. 백엔드(/api/discord-auth)로 code 전송하여 access_token 및 프로필 획득
  const response = await fetch('/api/discord-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`토큰 교환 실패: ${errText}`);
  }

  const data = await response.json();
  if (!data.success || !data.access_token) {
    throw new Error(data.error || 'Discord API 인증 실패');
  }

  // 4. 발급받은 access_token으로 Discord SDK 세션 최종 인증
  const auth = await discordSdkInstance.commands.authenticate({
    access_token: data.access_token,
  });

  return {
    discordUser: data.user,
    channelId: discordSdkInstance.channelId,
    guildId: discordSdkInstance.guildId,
    instanceId: discordSdkInstance.instanceId,
    auth,
  };
}
