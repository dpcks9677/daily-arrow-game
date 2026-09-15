import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: './',
    server: {
      host: true,
      allowedHosts: true
    },
    plugins: [
      react(),
      {
        name: 'discord-auth-middleware',
        configureServer(server) {
          server.middlewares.use('/api/discord-auth', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Method not allowed' }))
              return
            }

            let body = ''
            req.on('data', chunk => {
              body += chunk
            })
            req.on('end', async () => {
              try {
                const { code, redirectUri } = JSON.parse(body || '{}')
                const clientId = env.VITE_DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID
                const clientSecret = env.DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET

                if (!clientId || !clientSecret) {
                  res.statusCode = 500
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({
                    error: 'Discord credentials are not configured in .env file (VITE_DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET required)'
                  }))
                  return
                }

                if (!code) {
                  res.statusCode = 400
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Authorization code is required' }))
                  return
                }

                // 1. Exchange code for access_token with Discord OAuth2
                const tokenParams = new URLSearchParams({
                  client_id: clientId,
                  client_secret: clientSecret,
                  grant_type: 'authorization_code',
                  code: code,
                })
                if (redirectUri) {
                  tokenParams.append('redirect_uri', redirectUri)
                }

                const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: tokenParams.toString()
                })

                if (!tokenRes.ok) {
                  const errData = await tokenRes.text()
                  res.statusCode = tokenRes.status
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Failed to exchange token with Discord', details: errData }))
                  return
                }

                const tokenData = await tokenRes.json()
                const accessToken = tokenData.access_token

                // 2. Fetch user profile from Discord
                const userRes = await fetch('https://discord.com/api/users/@me', {
                  headers: {
                    Authorization: `Bearer ${accessToken}`
                  }
                })

                if (!userRes.ok) {
                  const errData = await userRes.text()
                  res.statusCode = userRes.status
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Failed to fetch Discord user profile', details: errData }))
                  return
                }

                const userData = await userRes.json()

                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({
                  success: true,
                  access_token: accessToken,
                  user: {
                    id: userData.id,
                    username: userData.username,
                    global_name: userData.global_name || userData.username,
                    avatar: userData.avatar
                  }
                }))
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err.message }))
              }
            })
          })
        }
      }
    ]
  }
})

