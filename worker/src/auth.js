// 인증/서명 유틸: Worker가 서명하는 토큰(세션, 라운드), Firebase ID 토큰 검증, 서비스 계정 액세스 토큰.
// 모두 Web Crypto API만 사용한다.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const FIREBASE_PROJECT_ID = 'arrow-game-19120';

export function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

// ---------------------------------------------------------------
// Worker가 발급하는 서명 토큰: base64url(payload).base64url(HMAC-SHA256)
// ---------------------------------------------------------------
export async function signToken(secret, payload, ttlMs) {
  const body = base64UrlEncode(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(body));
  return `${body}.${base64UrlEncode(sig)}`;
}

export async function verifyToken(secret, token) {
  if (!secret || typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), base64UrlDecode(sig), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(body)));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// Firebase ID 토큰 검증 (RS256, Google 공개키)
// ---------------------------------------------------------------
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, exp: 0 };

async function getFirebaseKeys() {
  if (jwksCache.keys && jwksCache.exp > Date.now()) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Failed to load Firebase public keys');
  const { keys } = await res.json();
  jwksCache = { keys, exp: Date.now() + 60 * 60 * 1000 };
  return keys;
}

export async function verifyFirebaseIdToken(token, projectId = FIREBASE_PROJECT_ID) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const now = Math.floor(Date.now() / 1000);
    if (
      payload.aud !== projectId ||
      payload.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.exp <= now ||
      payload.iat > now + 60
    ) {
      return null;
    }

    const jwk = (await getFirebaseKeys()).find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`)
    );
    return valid ? { uid: payload.sub } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// 서비스 계정 액세스 토큰 (Firestore 서버 권한 쓰기용)
// ---------------------------------------------------------------
let serviceTokenCache = { token: null, exp: 0 };

function pemToArrayBuffer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  return base64UrlDecode(body.replace(/\+/g, '-').replace(/\//g, '_')).buffer;
}

export async function getServiceAccountToken(env) {
  if (serviceTokenCache.token && serviceTokenCache.exp > Date.now() + 60 * 1000) return serviceTokenCache.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${claims}`));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64UrlEncode(signature)}`,
    }).toString(),
  });
  if (!res.ok) throw new Error('Failed to get service account token');
  const data = await res.json();
  serviceTokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}
