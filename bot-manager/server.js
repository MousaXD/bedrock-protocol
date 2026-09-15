const http = require('http')
const fs = require('fs')
const path = require('path')
const bedrock = require('..')

const HOST = '127.0.0.1'
const PORT = Number(process.env.BOT_MANAGER_PORT || 3210)
const ROOT = path.resolve(__dirname, '..')
const PUBLIC_ROOT = path.join(__dirname, 'public')
const PROFILES_ROOT = path.join(ROOT, 'profiles')
const CONFIG_PATH = path.join(ROOT, '.bedrock-bot-manager.json')
const MAX_BODY_BYTES = 64 * 1024
const MAX_LOG_LINES = 150

const defaultConfig = {
  server: {
    host: 'tahasmp.net',
    port: 19132
  },
  target: {
    x: -65,
    y: -26,
    z: -14
  },
  accounts: [
    { id: 'account1', label: 'Account 1' },
    { id: 'account2', label: 'Account 2' }
  ]
}

const runtimes = new Map()
let config = loadConfig()

function loadConfig () {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read bot manager config:', error.message)
    return JSON.parse(JSON.stringify(defaultConfig))
  }
}

function normalizeConfig (input) {
  if (!input || typeof input !== 'object') throw new Error('Config must be an object')

  const host = String(input.server?.host || '').trim()
  const port = Number(input.server?.port)
  if (!host || host.length > 253) throw new Error('Server host is required')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Server port must be between 1 and 65535')

  const target = {
    x: finiteNumber(input.target?.x, 'target.x'),
    y: finiteNumber(input.target?.y, 'target.y'),
    z: finiteNumber(input.target?.z, 'target.z')
  }

  if (!Array.isArray(input.accounts)) throw new Error('accounts must be an array')
  const seen = new Set()
  const accounts = input.accounts.map((account, index) => {
    const id = String(account?.id || '').trim()
    const label = String(account?.label || id || `Account ${index + 1}`).trim()
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      throw new Error('Account IDs may only use letters, numbers, _ and - (max 32)')
    }
    if (seen.has(id)) throw new Error(`Duplicate account ID: ${id}`)
    seen.add(id)
    if (!label || label.length > 80) throw new Error(`Invalid label for ${id}`)
    return { id, label }
  })

  return {
    server: { host, port },
    target,
    accounts
  }
}

function finiteNumber (value, name) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`)
  return number
}

function saveConfig () {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  try {
    fs.chmodSync(CONFIG_PATH, 0o600)
  } catch {}
}

function runtimeFor (account) {
  let runtime = runtimes.get(account.id)
  if (!runtime) {
    runtime = {
      id: account.id,
      status: 'disconnected',
      gamertag: null,
      deviceCode: null,
      position: null,
      lastError: null,
      logs: [],
      client: null
    }
    runtimes.set(account.id, runtime)
  }
  return runtime
}

function log (runtime, message) {
  const stamp = new Date().toLocaleTimeString()
  runtime.logs.push(`[${stamp}] ${message}`)
  if (runtime.logs.length > MAX_LOG_LINES) runtime.logs.splice(0, runtime.logs.length - MAX_LOG_LINES)
  console.log(`[${runtime.id}] ${message}`)
}

function publicRuntime (account) {
  const runtime = runtimeFor(account)
  return {
    id: account.id,
    label: account.label,
    status: runtime.status,
    gamertag: runtime.gamertag,
    deviceCode: runtime.deviceCode,
    position: runtime.position,
    lastError: runtime.lastError,
    logs: runtime.logs
  }
}

function stateSnapshot () {
  return {
    config,
    accounts: config.accounts.map(publicRuntime)
  }
}

function accountById (id) {
  return config.accounts.find(account => account.id === id)
}

function setPosition (runtime, position) {
  if (!position) return
  const x = Number(position.x)
  const y = Number(position.y)
  const z = Number(position.z)
  if ([x, y, z].every(Number.isFinite)) runtime.position = { x, y, z }
}

function connectAccount (id) {
  const account = accountById(id)
  if (!account) throw new Error('Unknown account')
  const runtime = runtimeFor(account)

  if (runtime.client && !['disconnected', 'error'].includes(runtime.status)) return

  runtime.status = 'connecting'
  runtime.gamertag = null
  runtime.deviceCode = null
  runtime.position = null
  runtime.lastError = null
  log(runtime, `Connecting to ${config.server.host}:${config.server.port}`)

  const profilesFolder = path.join(PROFILES_ROOT, account.id)
  fs.mkdirSync(profilesFolder, { recursive: true, mode: 0o700 })

  const client = bedrock.createClient({
    host: config.server.host,
    port: config.server.port,
    username: account.id,
    profilesFolder,
    offline: false,
    raknetBackend: 'auto',
    conLog: null,
    onMsaCode (data) {
      runtime.status = 'authentication-required'
      runtime.deviceCode = {
        userCode: data.user_code || null,
        verificationUri: data.verification_uri || data.verification_uri_complete || null,
        message: data.message || null
      }
      log(runtime, 'Microsoft device-code sign-in required')
    }
  })

  runtime.client = client

  client.on('session', profile => {
    runtime.gamertag = profile.name
    runtime.status = 'authenticated'
    runtime.deviceCode = null
    log(runtime, `Authenticated as ${profile.name}`)
  })

  client.on('join', () => {
    runtime.status = 'joined'
    log(runtime, 'Joined server')
  })

  client.on('start_game', packet => {
    setPosition(runtime, packet.player_position)
  })

  client.on('move_player', packet => {
    if (client.entityId != null && String(packet.runtime_id) === String(client.entityId)) {
      setPosition(runtime, packet.position)
    }
  })

  client.on('correct_player_move_prediction', packet => {
    setPosition(runtime, packet.position)
  })

  client.on('spawn', () => {
    runtime.status = 'spawned'
    runtime.deviceCode = null
    log(runtime, 'Spawned successfully')
  })

  client.on('kick', packet => {
    const message = packet?.message || 'Server kicked the client'
    runtime.lastError = message
    log(runtime, `Kicked: ${message}`)
  })

  client.on('error', error => {
    runtime.status = 'error'
    runtime.lastError = error.message
    log(runtime, `Error: ${error.message}`)
  })

  client.on('close', () => {
    runtime.status = 'disconnected'
    runtime.client = null
    log(runtime, 'Connection closed')
  })
}

function disconnectAccount (id) {
  const account = accountById(id)
  if (!account) throw new Error('Unknown account')
  const runtime = runtimeFor(account)
  if (!runtime.client) {
    runtime.status = 'disconnected'
    return
  }

  log(runtime, 'Disconnect requested')
  try {
    runtime.client.disconnect('Client leaving')
  } catch {
    try {
      runtime.client.close()
    } catch {}
  }
}

function applyConfig (input) {
  const next = normalizeConfig(input)
  const nextIds = new Set(next.accounts.map(account => account.id))

  for (const current of config.accounts) {
    if (!nextIds.has(current.id)) {
      const runtime = runtimes.get(current.id)
      if (runtime?.client) {
        try {
          runtime.client.disconnect('Account removed from bot manager')
        } catch {}
      }
      runtimes.delete(current.id)
    }
  }

  config = next
  saveConfig()
}

function json (res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readJson (req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      reject(new Error('Content-Type must be application/json'))
      return
    }

    let size = 0
    const chunks = []

    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })

    req.on('error', reject)
  })
}

function allowedOrigin (req) {
  const origin = req.headers.origin
  if (!origin) return true
  return origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`
}

function serveStatic (pathname, res) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8']
  }

  const target = files[pathname]
  if (!target) return false

  const content = fs.readFileSync(path.join(PUBLIC_ROOT, target[0]))
  res.writeHead(200, {
    'Content-Type': target[1],
    'Content-Length': content.length,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  })
  res.end(content)
  return true
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)

    if (req.method === 'GET' && url.pathname === '/api/state') {
      json(res, 200, stateSnapshot())
      return
    }

    if (req.method === 'POST') {
      if (!allowedOrigin(req)) {
        json(res, 403, { error: 'Cross-origin requests are not allowed' })
        return
      }

      if (url.pathname === '/api/config') {
        const body = await readJson(req)
        applyConfig(body)
        json(res, 200, stateSnapshot())
        return
      }

      if (url.pathname === '/api/accounts/connect-all') {
        config.accounts.forEach((account, index) => {
          setTimeout(() => {
            try {
              connectAccount(account.id)
            } catch (error) {
              const runtime = runtimeFor(account)
              runtime.status = 'error'
              runtime.lastError = error.message
              log(runtime, `Error: ${error.message}`)
            }
          }, index * 2500)
        })
        json(res, 202, { ok: true })
        return
      }

      if (url.pathname === '/api/accounts/disconnect-all') {
        for (const account of config.accounts) disconnectAccount(account.id)
        json(res, 200, { ok: true })
        return
      }

      const match = url.pathname.match(/^\/api\/accounts\/([A-Za-z0-9_-]{1,32})\/(connect|disconnect)$/)
      if (match) {
        if (match[2] === 'connect') connectAccount(match[1])
        else disconnectAccount(match[1])
        json(res, 200, { ok: true })
        return
      }
    }

    if (req.method === 'GET' && serveStatic(url.pathname, res)) return

    json(res, 404, { error: 'Not found' })
  } catch (error) {
    json(res, 400, { error: error.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('Bedrock Bot Manager')
  console.log(`Open http://${HOST}:${PORT}`)
  console.log('Auth profiles stay local in ./profiles and are ignored by Git.')
  console.log('')
})

process.on('SIGINT', () => {
  for (const account of config.accounts) {
    try {
      disconnectAccount(account.id)
    } catch {}
  }
  server.close(() => process.exit(0))
})
