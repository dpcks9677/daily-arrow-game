function parseFirestoreFields(fields) {
  if (!fields) return {};
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    if ('stringValue' in val) result[key] = val.stringValue;
    else if ('integerValue' in val) result[key] = Number(val.integerValue);
    else if ('doubleValue' in val) result[key] = Number(val.doubleValue);
    else if ('booleanValue' in val) result[key] = Boolean(val.booleanValue);
    else if ('timestampValue' in val) result[key] = val.timestampValue;
    else if ('nullValue' in val) result[key] = null;
    else if ('arrayValue' in val) {
      result[key] = (val.arrayValue.values || []).map((item) => {
        if ('stringValue' in item) return item.stringValue;
        if ('integerValue' in item) return Number(item.integerValue);
        if ('doubleValue' in item) return Number(item.doubleValue);
        if ('booleanValue' in item) return Boolean(item.booleanValue);
        if ('mapValue' in item) return parseFirestoreFields(item.mapValue.fields);
        return item;
      });
    } else if ('mapValue' in val) {
      result[key] = parseFirestoreFields(val.mapValue.fields);
    }
  }
  return result;
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || key === 'id') continue;
    if (val === null) fields[key] = { nullValue: null };
    else if (typeof val === 'string') fields[key] = { stringValue: val };
    else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
    else if (typeof val === 'number') {
      if (Number.isInteger(val)) fields[key] = { integerValue: String(val) };
      else fields[key] = { doubleValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number')
              return Number.isInteger(item)
                ? { integerValue: String(item) }
                : { doubleValue: item };
            if (typeof item === 'boolean') return { booleanValue: item };
            if (item && typeof item === 'object')
              return { mapValue: { fields: toFirestoreFields(item) } };
            return { stringValue: String(item) };
          }),
        },
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
  }
  return fields;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 1. Leaderboard Read Proxy
    if (url.pathname.includes('leaderboard')) {
      const seed = url.searchParams.get('seed') || '20260915';
      try {
        const firestoreRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents/leaderboard/${seed}/scores`
        );
        if (!firestoreRes.ok) {
          return new Response(JSON.stringify({ success: true, scores: [] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const data = await firestoreRes.json();
        const fetchedScores = (data.documents || []).map((doc) => {
          const f = doc.fields || {};
          return {
            id: doc.name.split('/').pop(),
            deviceId: f.deviceId?.stringValue || '',
            nickname: f.nickname?.stringValue || '익명',
            time: Number(f.time?.doubleValue ?? f.time?.integerValue ?? 0),
            mistakes: Number(f.mistakes?.integerValue ?? 0),
            hasBackupCode: !!f.hasBackupCode?.booleanValue,
            timestamp: f.timestamp?.timestampValue || null,
          };
        });

        fetchedScores.sort((a, b) => a.time - b.time);
        fetchedScores.forEach((item, idx) => {
          item.rank = idx + 1;
        });

        return new Response(JSON.stringify({ success: true, scores: fetchedScores }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message, scores: [] }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 2. Score Save Proxy
    if (url.pathname.includes('save-score')) {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const body = await request.json().catch(() => ({}));
        const { seed, deviceId, nickname, time, mistakes, hasBackupCode } = body;

        if (!seed || !nickname || time == null) {
          return new Response(JSON.stringify({ error: 'Missing required score parameters' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const firestorePost = await fetch(
          `https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents/leaderboard/${seed}/scores`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                deviceId: { stringValue: deviceId || 'unknown' },
                nickname: { stringValue: nickname.trim() },
                time: { doubleValue: Number(time) },
                mistakes: { integerValue: Number(mistakes || 0) },
                hasBackupCode: { booleanValue: !!hasBackupCode },
                timestamp: { timestampValue: new Date().toISOString() },
              },
            }),
          }
        );

        const postData = await firestorePost.json();
        if (!firestorePost.ok) {
          return new Response(JSON.stringify({ error: 'Failed to write to Firestore', details: postData }), {
            status: firestorePost.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(
          JSON.stringify({
            success: true,
            id: postData.name ? postData.name.split('/').pop() : null,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. User Profile Read & Write Proxy (for Discord Activity CSP safety)
    if (url.pathname.includes('user-profile')) {
      // GET: Query user by discordId or document ID
      if (request.method === 'GET') {
        const discordId = url.searchParams.get('discordId');
        const docId = url.searchParams.get('id');

        if (!discordId && !docId) {
          return new Response(JSON.stringify({ error: 'discordId or id is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        try {
          if (discordId) {
            const queryRes = await fetch(
              'https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents:runQuery',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  structuredQuery: {
                    from: [{ collectionId: 'users' }],
                    where: {
                      fieldFilter: {
                        field: { fieldPath: 'discordId' },
                        op: 'EQUAL',
                        value: { stringValue: discordId },
                      },
                    },
                  },
                }),
              }
            );

            const queryData = await queryRes.json();
            const docs = (queryData || [])
              .filter((item) => item.document && item.document.fields)
              .map((item) => {
                const parsed = parseFirestoreFields(item.document.fields);
                parsed.id = item.document.name.split('/').pop();
                return parsed;
              });

            docs.sort((a, b) => (b.totalPlayCount || 0) - (a.totalPlayCount || 0));
            const bestDoc = docs[0] || null;

            return new Response(
              JSON.stringify({ success: true, profile: bestDoc }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            const docRes = await fetch(
              `https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents/users/${docId}`
            );
            if (!docRes.ok) {
              return new Response(JSON.stringify({ success: true, profile: null }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
            const docData = await docRes.json();
            const parsed = parseFirestoreFields(docData.fields);
            parsed.id = docId;
            return new Response(JSON.stringify({ success: true, profile: parsed }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // POST: Save/Merge user profile
      if (request.method === 'POST') {
        try {
          const body = await request.json().catch(() => ({}));
          const docId = body.id || url.searchParams.get('id');
          const profile = body.profile || body;

          if (!docId) {
            return new Response(JSON.stringify({ error: 'User id is required' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const fields = toFirestoreFields(profile);
          const updateRes = await fetch(
            `https://firestore.googleapis.com/v1/projects/arrow-game-19120/databases/(default)/documents/users/${docId}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields }),
            }
          );

          const updateData = await updateRes.json();
          if (!updateRes.ok) {
            return new Response(JSON.stringify({ error: 'Firestore update failed', details: updateData }), {
              status: updateRes.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({ success: true, id: docId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // 4. Realtime Database Proxy (for Multiplayer in Discord Activity)
    if (url.pathname.includes('rtdb')) {
      const dbPath = url.searchParams.get('path') || '';
      const cleanPath = dbPath.replace(/^\//, '').replace(/\.json$/, '');
      const targetUrl = `https://arrow-game-19120-default-rtdb.asia-southeast1.firebasedatabase.app/${cleanPath}.json`;

      let method = request.method;
      const overrideMethod = request.headers.get('X-HTTP-Method-Override') || url.searchParams.get('_method');
      if (overrideMethod) {
        method = overrideMethod.toUpperCase();
      }

      try {
        if (method === 'GET') {
          const rRes = await fetch(targetUrl);
          const rData = await rRes.json();
          return new Response(JSON.stringify(rData), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
          const body = await request.text();
          const pRes = await fetch(targetUrl, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body || '{}',
          });
          const pData = await pRes.json();
          return new Response(JSON.stringify(pData), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (method === 'DELETE') {
          const dRes = await fetch(targetUrl, { method: 'DELETE' });
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 5. Discord OAuth2 Token Exchange
    if (request.method === 'POST' && (url.pathname.includes('discord-auth') || url.pathname === '/api' || url.pathname === '/')) {
      try {
        const body = await request.json().catch(() => ({}));
        const { code, redirectUri } = body;
        const clientId = env.DISCORD_CLIENT_ID;
        const clientSecret = env.DISCORD_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({ error: 'Missing Discord credentials in Worker' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (!code) {
          return new Response(JSON.stringify({ error: 'Authorization code is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const tokenParams = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: code,
        });
        if (redirectUri) {
          tokenParams.append('redirect_uri', redirectUri);
        }

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: tokenParams.toString(),
        });

        if (!tokenRes.ok) {
          const errData = await tokenRes.text();
          return new Response(JSON.stringify({ error: 'Failed to exchange token with Discord', details: errData }), {
            status: tokenRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!userRes.ok) {
          const errData = await userRes.text();
          return new Response(JSON.stringify({ error: 'Failed to fetch user from Discord', details: errData }), {
            status: userRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const userData = await userRes.json();

        return new Response(
          JSON.stringify({
            success: true,
            access_token: accessToken,
            user: userData,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: 'Daily Arrow Discord Auth & Firestore Proxy Worker is active',
        path: url.pathname,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  },
};
