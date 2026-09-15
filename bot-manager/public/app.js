/* global document, fetch, confirm, structuredClone, setInterval, clearTimeout */
let currentState = null
let initializedInputs = false

const $ = id => document.getElementById(id)

async function api (path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function toast (message) {
  const node = $('toast')
  node.textContent = message
  node.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { node.hidden = true }, 3500)
}

function setInputValues () {
  if (!currentState || initializedInputs) return
  const { server, target } = currentState.config
  $('server-host').value = server.host
  $('server-port').value = server.port
  $('target-x').value = target.x
  $('target-y').value = target.y
  $('target-z').value = target.z
  initializedInputs = true
}

function positionText (position) {
  if (!position) return 'unknown'
  return [position.x, position.y, position.z].map(value => Number(value).toFixed(2)).join(', ')
}

function addText (parent, tag, text, className) {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  parent.appendChild(node)
  return node
}

function makeButton (text, onClick, className) {
  const button = document.createElement('button')
  button.textContent = text
  if (className) button.className = className
  button.addEventListener('click', onClick)
  return button
}

function renderAccounts () {
  const root = $('accounts')
  root.replaceChildren()

  for (const account of currentState.accounts) {
    const card = document.createElement('article')
    card.className = 'account-card'

    const top = document.createElement('div')
    top.className = 'account-top'
    const identity = document.createElement('div')
    addText(identity, 'h3', account.label)
    addText(identity, 'p', account.id, 'muted')
    top.appendChild(identity)
    addText(top, 'span', account.status, `status ${account.status}`)
    card.appendChild(top)

    const meta = document.createElement('div')
    meta.className = 'meta'

    const gamer = document.createElement('div')
    gamer.className = 'meta-item'
    addText(gamer, 'span', 'Gamertag')
    addText(gamer, 'strong', account.gamertag || 'not authenticated')
    meta.appendChild(gamer)

    const position = document.createElement('div')
    position.className = 'meta-item'
    addText(position, 'span', 'Position')
    addText(position, 'strong', positionText(account.position))
    meta.appendChild(position)
    card.appendChild(meta)

    if (account.deviceCode) {
      const auth = document.createElement('div')
      auth.className = 'device-code'
      addText(auth, 'strong', 'Microsoft sign-in required')
      if (account.deviceCode.message) addText(auth, 'p', account.deviceCode.message, 'muted')
      if (account.deviceCode.userCode) {
        addText(auth, 'code', account.deviceCode.userCode)
        auth.appendChild(document.createElement('br'))
      }
      if (account.deviceCode.verificationUri) {
        const link = document.createElement('a')
        link.href = account.deviceCode.verificationUri
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.textContent = 'Open Microsoft sign-in'
        auth.appendChild(link)
      }
      card.appendChild(auth)
    }

    if (account.lastError) addText(card, 'p', account.lastError, 'error-text')

    const actions = document.createElement('div')
    actions.className = 'card-actions'

    const active = !['disconnected', 'error'].includes(account.status)
    const connect = makeButton('Connect', async () => {
      try {
        await api(`/api/accounts/${encodeURIComponent(account.id)}/connect`, { method: 'POST', body: '{}' })
        await refresh()
      } catch (error) {
        toast(error.message)
      }
    }, 'primary')
    connect.disabled = active
    actions.appendChild(connect)

    const disconnect = makeButton('Disconnect', async () => {
      try {
        await api(`/api/accounts/${encodeURIComponent(account.id)}/disconnect`, { method: 'POST', body: '{}' })
        await refresh()
      } catch (error) {
        toast(error.message)
      }
    })
    disconnect.disabled = !active
    actions.appendChild(disconnect)

    actions.appendChild(makeButton('Remove', async () => {
      if (!confirm(`Remove ${account.label} from this manager? The cached profile folder is kept on disk.`)) return
      const next = structuredClone(currentState.config)
      next.accounts = next.accounts.filter(item => item.id !== account.id)
      try {
        currentState = await api('/api/config', { method: 'POST', body: JSON.stringify(next) })
        renderAccounts()
      } catch (error) {
        toast(error.message)
      }
    }, 'danger'))

    card.appendChild(actions)

    const logs = document.createElement('div')
    logs.className = 'logs'
    logs.textContent = account.logs.length ? account.logs.join('\n') : 'No events yet.'
    card.appendChild(logs)

    root.appendChild(card)
  }
}

async function refresh () {
  try {
    currentState = await api('/api/state')
    setInputValues()
    renderAccounts()
  } catch (error) {
    toast(error.message)
  }
}

async function saveConfig () {
  const next = structuredClone(currentState.config)
  next.server.host = $('server-host').value.trim()
  next.server.port = Number($('server-port').value)
  next.target.x = Number($('target-x').value)
  next.target.y = Number($('target-y').value)
  next.target.z = Number($('target-z').value)

  currentState = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify(next)
  })
  toast('Settings saved')
  renderAccounts()
}

$('save-config').addEventListener('click', () => {
  saveConfig().catch(error => toast(error.message))
})

$('connect-all').addEventListener('click', async () => {
  try {
    await api('/api/accounts/connect-all', { method: 'POST', body: '{}' })
    toast('Connecting accounts with a short stagger')
    await refresh()
  } catch (error) {
    toast(error.message)
  }
})

$('disconnect-all').addEventListener('click', async () => {
  try {
    await api('/api/accounts/disconnect-all', { method: 'POST', body: '{}' })
    await refresh()
  } catch (error) {
    toast(error.message)
  }
})

$('add-account').addEventListener('click', async () => {
  const id = $('new-account-id').value.trim()
  const label = $('new-account-label').value.trim() || id
  if (!id) {
    toast('Enter an account ID')
    return
  }

  const next = structuredClone(currentState.config)
  next.accounts.push({ id, label })

  try {
    currentState = await api('/api/config', {
      method: 'POST',
      body: JSON.stringify(next)
    })
    $('new-account-id').value = ''
    $('new-account-label').value = ''
    renderAccounts()
  } catch (error) {
    toast(error.message)
  }
})

refresh()
setInterval(refresh, 1500)
