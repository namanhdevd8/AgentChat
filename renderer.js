const $ = s => document.querySelector(s)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const base = p => p.split(/[\\/]/).pop() // Windows paths use backslashes
const MAC = navigator.userAgent.includes('Mac'), MOD = MAC ? '⌘' : 'Ctrl+'
document.body.classList.toggle('mac', MAC) // main hides the title bar on macOS only
const tilde = p => p.replace(/^(?:\/Users|\/home)\/[^/]+(?=\/|$)/, '~') // header only; the full path is in the sidebar tooltip

const AVATAR_PALETTE = [
  '#ff8fab',
  '#7cb4ff',
  '#5fe0b0',
  '#ffa94d',
  '#bb9bff',
  '#ffd23f',
  '#66d9e8',
  '#ff6b6b'
]
const PALETTE_NAMES = {
  '#ff8fab': 'Hồng',
  '#7cb4ff': 'Xanh dương',
  '#5fe0b0': 'Xanh lá',
  '#ffa94d': 'Cam',
  '#bb9bff': 'Tím',
  '#ffd23f': 'Vàng',
  '#66d9e8': 'Xanh ngọc',
  '#ff6b6b': 'Đỏ'
}

function getDefaultAvatar(teamList = [], memberIndex = 0) {
  const colorCounts = new Map(AVATAR_PALETTE.map(c => [c, 0]))
  for (const a of teamList) {
    if (a?.avatar?.color && colorCounts.has(a.avatar.color)) {
      colorCounts.set(a.avatar.color, colorCounts.get(a.avatar.color) + 1)
    }
  }
  let bestColor = AVATAR_PALETTE[0]
  let minColorCount = Infinity
  for (const c of AVATAR_PALETTE) {
    const count = colorCounts.get(c)
    if (count < minColorCount) {
      minColorCount = count
      bestColor = c
    }
  }

  let maleCount = 0
  let femaleCount = 0
  for (const a of teamList) {
    if (a?.avatar?.color === bestColor) {
      if (a.avatar?.gender === 'male') maleCount++
      else if (a.avatar?.gender === 'female') femaleCount++
    }
  }
  let bestGender
  if (maleCount < femaleCount) {
    bestGender = 'male'
  } else if (femaleCount < maleCount) {
    bestGender = 'female'
  } else {
    bestGender = (memberIndex % 2 === 0) ? 'male' : 'female'
  }

  return { gender: bestGender, color: bestColor }
}

function getAgentAvatar(target) {
  let a = null
  if (typeof target === 'object' && target !== null) {
    a = target
  } else if (typeof target === 'string') {
    a = team.find(x => x.name === target) || (typeof draft !== 'undefined' && Array.isArray(draft) ? draft.find(x => x.name === target) : null)
  }
  if (!a) return null
  if (a.avatar && (a.avatar.gender === 'male' || a.avatar.gender === 'female') && AVATAR_PALETTE.includes(a.avatar.color)) {
    return a.avatar
  }
  const list = team.length > 0 ? team : (typeof draft !== 'undefined' && Array.isArray(draft) ? draft : [])
  const idx = list.indexOf(a)
  return getDefaultAvatar(list, idx >= 0 ? idx : 0)
}

// "pm" → PM, "dev" → DV, "review" → RV, "dev-fe" → DF, "dev2" → D2
const initials = name => {
  const parts = String(name || '?').split(/[-_.\s]+/).filter(Boolean), s = parts[0] || '?'
  const second = parts.length > 1 ? parts.at(-1)[0] : /\d$/.test(s) ? s.at(-1) : s.slice(1).match(/[b-df-hj-np-tv-z]/i)?.[0] || s[1] || ''
  return (s[0] + second).toUpperCase()
}

// ponytail: rounded-square initials on a tint of the identity color; avatar.gender stays in agents.json but no longer shows
function paintAvatar(node, name, hex) {
  node.textContent = name === 'user' ? 'B' : initials(name)
  node.style.setProperty('--agent', hex || '#a1a1aa')
  return node
}

const avatar = (target, cls = 'av') => {
  const name = typeof target === 'string' ? target : target?.name || '?'
  const node = paintAvatar(el('div', cls), name, getAgentAvatar(target)?.color)
  if (name !== 'user') node.dataset.agentAvatar = name
  return node
}

function updateAllAgentAvatars() {
  for (const a of team) {
    const hex = getAgentAvatar(a)?.color
    document.querySelectorAll(`[data-agent-avatar="${CSS.escape(a.name)}"]`).forEach(node => node.style.setProperty('--agent', hex))
  }
}

function validateAllowedCommands(commands) {
  if (!Array.isArray(commands)) return { valid: false, message: 'Danh sách lệnh phải là mảng' }
  const tokenRegex = /^[A-Za-z0-9_./:@=+,%-]+$/
  const normalized = []
  const seen = new Set()

  for (const raw of commands) {
    const trimmed = (raw || '').trim()
    if (!trimmed) continue
    if (trimmed.length > 256) {
      return { valid: false, message: `Lệnh vượt quá 256 ký tự: "${trimmed.slice(0, 30)}…"` }
    }
    const tokens = trimmed.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    const exe = tokens[0]
    if (exe.startsWith('-')) {
      return { valid: false, message: `Tên lệnh không được bắt đầu bằng dấu gạch ngang: "${exe}"` }
    }
    if (exe.includes('=')) {
      return { valid: false, message: `Tên lệnh không được chứa dấu bằng: "${exe}"` }
    }
    for (const tok of tokens) {
      if (!tokenRegex.test(tok)) {
        return { valid: false, message: `Lệnh chứa ký tự không hợp lệ hoặc cú pháp shell: "${tok}"` }
      }
    }
    const norm = tokens.join(' ')
    if (!seen.has(norm)) {
      seen.add(norm)
      normalized.push(norm)
    }
  }

  if (normalized.length > 20) {
    return { valid: false, message: 'Tối đa 20 lệnh được phép chạy' }
  }

  return { valid: true, commands: normalized }
}

function validateAllowTools(tools) {
  if (!Array.isArray(tools)) return { valid: true, tools: [] }
  const normalized = []
  const seen = new Set()

  for (const raw of tools) {
    const t = (raw || '').trim()
    if (!t) continue
    if (t.length > 512) {
      return { valid: false, message: `Quy tắc công cụ vượt quá 512 ký tự: "${t.slice(0, 30)}…"` }
    }
    if (/[\x00-\x1f\x7f]/.test(t)) {
      return { valid: false, message: `Quy tắc chứa ký tự điều khiển: "${t}"` }
    }
    const parenIdx = t.indexOf('(')
    let toolName = t
    if (parenIdx !== -1) {
      if (!t.endsWith(')')) {
        return { valid: false, message: `Quy tắc công cụ ngoặc không cân bằng: "${t}"` }
      }
      toolName = t.slice(0, parenIdx)
      const inner = t.slice(parenIdx + 1, -1)
      if (inner.includes('(') || inner.includes(')')) {
        return { valid: false, message: `Quy tắc công cụ chứa ngoặc lồng nhau: "${t}"` }
      }
    }
    if (!/^[A-Za-z0-9_-]+$/.test(toolName) && !toolName.startsWith('mcp__')) {
      return { valid: false, message: `Tên công cụ không hợp lệ: "${toolName}"` }
    }
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__')
      if (parts.length < 3 || !parts[1] || !parts[2] || parts[1] === '*' || parts[1].includes('*')) {
        return { valid: false, message: `Quy tắc MCP phải có tên server cụ thể (mcp__server__tool): "${toolName}"` }
      }
    }
    if (!seen.has(t)) {
      seen.add(t)
      normalized.push(t)
    }
  }

  if (normalized.length > 32) {
    return { valid: false, message: 'Tối đa 32 quy tắc công cụ' }
  }

  return { valid: true, tools: normalized }
}

const hhmm = iso => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const fileIcon = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<path d="M6 2h8l5 5v15H6z M14 2v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>'; return s }
let box = '.chat' // which box of the folder `dir` is shown (.chat, .chat2…); main keeps the same one open
let dir = null, team = [], currentTeamRevision = null, permissionRequests = [], last = null
// generation:seq of every shown message; a message can arrive both in the open() history and as a live event
let seenMsgs = new Set()
const firstSeen = (generation, seq) => {
  const key = generation + ':' + seq
  if (seenMsgs.has(key)) return false
  seenMsgs.add(key)
  if (seenMsgs.size > 1000) seenMsgs.delete(seenMsgs.values().next().value) // ponytail: dups only race around open(), old keys can go
  return true
}
const activeRuns = new Map()
// recent turn lengths per agent (from the loaded log), for the "còn ~N phút" estimate
const turnTimes = new Map()
function noteTurnTime(name, ms) { const list = turnTimes.get(name) || []; list.push(ms); turnTimes.set(name, list.slice(-10)) }
let orphanLocks = []
let openSeq = 0, openingDir = null, pendingEvents = []
const runKey = (d, name) => d + '\0' + name

// Sprint 6 state: paging, search, worktree, totals
let logGeneration = null
let logHasBefore = false
let logHasAfter = false
let newestLiveSeq = -1
let currentTotals = null
let currentSettings = { version: 1, autoSummary: true, worktreesEnabled: false, mergeChecks: ['npm run check'], chainLimit: 12, maxHops: 12, costCeiling: null }
let currentSettingsRevision = null
let worktreeState = null
let searchRequestId = 0
let searchResultsData = []
let searchSelectedIndex = -1
let searchDebounceTimer = null
let unreadNewMessagesCount = 0
let isPagingLoading = false

let projectList = []
async function loadProjects() {
  const list = projectList = await api.projects()
  $('#projects').replaceChildren(...list.map((p, i) => {
    const on = p.dir === dir && p.chat === box
    if (on) $('#title').textContent = p.name
    const b = el('button', 'space' + (on ? ' on' : ''))
    b.title = (p.chat === '.chat' ? p.dir : `${p.dir} (${p.chat})`) + (i < 9 ? ` · ${MOD}${i + 1}` : '')
    b.append(el('span', '', p.name))
    if (!on) setSpaceBadge(b, p.needs)
    b.onclick = () => openProject(p.dir, p.chat)
    return b
  }))
  markActiveBadge()
}

function setSpaceBadge(button, n) {
  let badge = button.querySelector('.space-badge')
  if (!n) return badge?.remove()
  if (!badge) button.append(badge = el('span', 'space-badge'))
  badge.textContent = n
  badge.title = `${n} việc cần bạn`
}

function syncActive(list) {
  if (!dir) return
  for (const k of [...activeRuns.keys()]) {
    if (k.startsWith(dir + '\0')) activeRuns.delete(k)
  }
  for (const r of (list || [])) {
    activeRuns.set(runKey(dir, r.name), {
      name: r.name,
      runId: r.runId,
      label: r.label || 'đang khởi động…',
      stopping: !!r.stopping,
      phase: r.phase || 'running',
      blockedBy: r.blockedBy || [],
      chain: r.chain || null,
      startedAt: r.startedAt || Date.now(),
      activeAt: r.activeAt || Date.now()
    })
  }
}

// the composer's text per box, so a half-typed message never follows you into another space (memory only)
const drafts = new Map()
async function openProject(d, c = d === dir ? box : null) {
  // the input is disabled while a box opens: its text then isn't that box's draft
  if (dir && !$('#input').disabled) drafts.set(dir + '\0' + box, $('#input').value)
  const thisSeq = ++openSeq, prev = { dir, box }
  openingDir = d
  pendingEvents = []
  dir = d; last = null
  closeViewer()
  closeMemberPopover()
  closeSearchResults()
  currentTasks = []
  groupOpenStates.clear()
  renderBoard()
  needs = []
  turnTimes.clear()
  $('#title').textContent = base(d)
  $('#path').textContent = tilde(c && c !== '.chat' ? `${d} · ${c}` : d)
  $('#log').replaceChildren()
  $('#stats-sec').hidden = true
  $('#gear').hidden = true // until this project's team is in
  $('#timeline-btn').hidden = true
  if ($('#timeline').open) $('#timeline').close()
  $('#input').disabled = true
  $('#input').value = ''
  closeMentionPopup()
  $('#search-wrap').hidden = false
  $('#search-input').value = ''
  $('#search-clear').hidden = true
  $('#jump-latest').hidden = true
  $('#log-error-banner').hidden = true
  $('#merge-sec').hidden = true
  unreadNewMessagesCount = 0
  logGeneration = null
  logHasBefore = false
  logHasAfter = false
  newestLiveSeq = -1
  currentTotals = null
  worktreeState = null
  sess = {}
  currentTeamRevision = null
  permissionRequests = []
  renderNeeds()

  let res
  try {
    res = await api.open(d, c)
  } catch (err) {
    if (thisSeq === openSeq) {
      openingDir = null
      showToast(err.message.replace(/^.*?Error: /, ''))
      // e.g. the other box of this folder is still running: go back to what was shown
      if (prev.dir && !(prev.dir === d && prev.box === c)) openProject(prev.dir, prev.box)
    }
    return
  }
  if (thisSeq !== openSeq) return
  openingDir = null
  box = res.chat || '.chat'
  $('#path').textContent = tilde(box !== '.chat' ? `${d} · ${box}` : d)
  team = res.team
  currentTeamRevision = res.teamRevision
  permissionRequests = res.permissionRequests
  sess = res.sessions

  const history = res.history
  seenMsgs = new Set()
  const messages = history.messages.filter(m => firstSeen(history.generation, m.seq))
  logGeneration = history.generation
  logHasBefore = history.hasBefore
  logHasAfter = history.hasAfter
  currentTotals = res.totals
  currentSettings = res.settings
  currentSettingsRevision = res.settingsRevision

  orphanLocks = res.orphanLocks || []
  syncActive(res.active)
  renderOrphanLocks()

  $('#log-error-banner').textContent = history.error ? `⚠️ Lỗi định dạng log: ${history.error.message || history.error.code}` : ''
  $('#log-error-banner').hidden = !history.error

  for (const ev of pendingEvents) {
    if (ev.type === 'status') {
      const key = runKey(d, ev.name)
      if (ev.on) {
        activeRuns.set(key, { name: ev.name, runId: ev.runId, label: 'đang khởi động…', stopping: false, phase: 'running', blockedBy: [], startedAt: Date.now(), activeAt: Date.now() })
      } else {
        const cur = activeRuns.get(key)
        if (cur && (!ev.runId || cur.runId === ev.runId)) activeRuns.delete(key)
      }
    } else if (ev.type === 'progress') {
      const key = runKey(d, ev.name)
      const cur = activeRuns.get(key)
      if (cur && cur.runId === ev.data.runId) {
        cur.label = ev.data.label
        if (ev.data.phase) cur.phase = ev.data.phase
        if (ev.data.blockedBy) cur.blockedBy = ev.data.blockedBy
        if (ev.data.stopping !== undefined) cur.stopping = !!ev.data.stopping
        if (ev.data.label === 'đang dừng…') cur.stopping = true
        if (ev.data.startedAt) Object.assign(cur, { startedAt: ev.data.startedAt, activeAt: ev.data.activeAt })
      }
    } else if (ev.type === 'message') {
      // the log was rewritten while opening (e.g. a repaired tail): this history's seqs no longer match, start over
      if (ev.meta?.generation && ev.meta.generation !== history.generation) return openProject(d)
      if (firstSeen(ev.meta.generation, ev.msg.seq)) messages.push(ev.msg)
    } else if (ev.type === 'locks') {
      orphanLocks = ev.locks || []
      renderOrphanLocks()
    } else if (ev.type === 'sessions-changed') {
      sess = ev.sessions || {}
    } else if (ev.type === 'team-changed') {
      if (ev.data?.revision) currentTeamRevision = ev.data.revision
      if (Array.isArray(ev.data?.team)) team = ev.data.team
    } else if (ev.type === 'permissions-changed') {
      permissionRequests = Array.isArray(ev.data?.requests) ? ev.data.requests : []
    }
  }
  pendingEvents = []

  last = null
  $('#log').replaceChildren(msgFragment(messages))
  markDays()
  trimLogWindow('append')
  $('#log').scrollTop = $('#log').scrollHeight
  updateHeaderStats()
  renderTeam()
  refreshFiles()
  loadProjects()
  loadTasks()
  refreshNeeds()
  loadWorktreeState(d)
  updateSearchSenderDropdown()
  api.watchProject(d, null).catch(() => {})
  $('#input').disabled = false
  $('#input').value = drafts.get(d + '\0' + box) || ''
  $('#input').focus()
  $('#gear').hidden = false
  $('#timeline-btn').hidden = false
  resizeInput()
}

// ---- settings: team roles/scope + session resume, per box ----
let draft = [], sess = {}, accounts = [], modelsOf = {}, sessionsOf = {}
// revisions the open dialog's draft was read at; saving sends these so main refuses to overwrite a newer team/settings
let draftTeamRevision = null, draftSettingsRevision = null
let currentSettingTab = 'general'
const when = iso => new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const sessionCacheKey = (d, agentName, cli, wsId) => `${d || ''}\0${agentName || ''}\0${cli || ''}\0${wsId || ''}`

// core.team() fills these; a member whose saved config is invalid comes without them
function normalizeMember(a, i) {
  if (!a.avatar || !['male', 'female'].includes(a.avatar.gender) || !AVATAR_PALETTE.includes(a.avatar.color)) {
    a.avatar = getDefaultAvatar(draft.slice(0, i), i)
  }
  if (!Array.isArray(a.allowedCommands)) a.allowedCommands = ['npm run check']
  if (!a.permissions || typeof a.permissions !== 'object') a.permissions = { mode: 'edit', allowTools: [], networkAccess: false }
  if (!['edit', 'custom', 'full'].includes(a.permissions.mode)) a.permissions.mode = 'edit'
  if (!Array.isArray(a.permissions.allowTools)) a.permissions.allowTools = []
  a.permissions.networkAccess = !!a.permissions.networkAccess
}

function initSettingsNav() {
  $('#tab-general').onclick = () => { currentSettingTab = 'general'; updateSettingsViews() }
  $('#tab-worktree').onclick = () => { currentSettingTab = 'worktree'; updateSettingsViews() }
  $('#tab-limits').onclick = () => { currentSettingTab = 'limits'; updateSettingsViews() }
  $('#sidebar-add-btn').onclick = () => $('#add').click()
}

function updateSettingsViews() {
  const isAgentTab = typeof currentSettingTab === 'string' && currentSettingTab.startsWith('agent:')
  let agentIdx = -1
  if (isAgentTab) {
    agentIdx = parseInt(currentSettingTab.slice(6), 10)
    if (isNaN(agentIdx) || agentIdx < 0 || agentIdx >= draft.length) {
      agentIdx = draft.length > 0 ? 0 : -1
      currentSettingTab = agentIdx >= 0 ? 'agent:' + agentIdx : 'general'
    }
  }

  const ed = $('#editors')
  $('#pane-general').hidden = currentSettingTab !== 'general'
  $('#pane-worktree').hidden = currentSettingTab !== 'worktree'
  $('#pane-limits').hidden = currentSettingTab !== 'limits'
  ed.hidden = !isAgentTab

  $('#tab-general').classList.toggle('active', currentSettingTab === 'general')
  $('#tab-worktree').classList.toggle('active', currentSettingTab === 'worktree')
  $('#tab-limits').classList.toggle('active', currentSettingTab === 'limits')
  ;[...$('#settings-agent-nav').children].forEach((item, i) => item.classList.toggle('active', currentSettingTab === 'agent:' + i))
  ;[...ed.children].forEach((c, i) => { c.hidden = i !== agentIdx })
}

// lazy per-account lookups; models stay cached (agy is slow), session lists refresh each time settings open
function need(cli, agentName = null, workspaceId = null) {
  if (!cli) return
  if (!(cli in modelsOf)) {
    modelsOf[cli] = null
    api.models(cli).catch(() => ({ models: [] })).then(m => {
      modelsOf[cli] = m
      renderEditors()
    })
  }
  const sKey = sessionCacheKey(dir, agentName, cli, workspaceId)
  if (!(sKey in sessionsOf)) {
    sessionsOf[sKey] = null
    api.cliSessions(cli, dir, agentName).then(s => {
      sessionsOf[sKey] = Array.isArray(s) ? s : []
      renderEditors()
    }).catch(() => {
      sessionsOf[sKey] = []
      renderEditors()
    })
  }
}

// options: [[value, label]]; a saved value missing from the list is kept visible
function select(options, value, onChange) {
  const s = el('select', 'f')
  options.forEach(([v, l]) => s.append(new Option(l, v, false, v === value)))
  if (value && !options.some(([v]) => v === value)) s.append(new Option(value, value, false, true))
  s.onchange = () => onChange(s.value)
  return s
}

function field(tag, value, onInput, attrs = {}) {
  const f = el(tag, 'f')
  Object.assign(f, attrs)
  f.value = (value != null && value !== '') ? value : ''
  f.oninput = () => onInput(f.value)
  return f
}

function renderEditors() {
  // async model/session replies re-render while the user types: put focus + caret back on the same control
  // ponytail: matched by position, which only the clicked control's own card can shift; after an add/delete the
  // position would land in another card (Xoá → the next card's Xoá, one Enter from deleting it), so no restore then
  const controls = () => [...$('#editors').querySelectorAll('input, textarea, select, button')]
  const sameCards = $('#editors').children.length === draft.length
  const focused = document.activeElement, focusAt = sameCards ? controls().indexOf(focused) : -1
  const caret = focusAt >= 0 && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null
  draft.forEach(normalizeMember)
  const navList = $('#settings-agent-nav')
  navList.replaceChildren(...draft.map((a, i) => {
    const btn = el('button', 'settings-nav-item' + (currentSettingTab === 'agent:' + i ? ' active' : ''))
    btn.type = 'button'
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', currentSettingTab === 'agent:' + i ? 'true' : 'false')

    const navAv = paintAvatar(el('span', 'settings-nav-av'), a.name, a.avatar.color)

    const navLabel = el('span', 'settings-nav-label', a.name ? `@${a.name}` : '(chưa có tên)')
    btn.append(navAv, navLabel)

    if (a.scopeNeedsReview) {
      const warn = el('span', 'settings-nav-warn', '⚠️')
      warn.title = 'Phạm vi cũ cần xác nhận'
      btn.append(warn)
    }

    btn.onclick = () => {
      currentSettingTab = 'agent:' + i
      updateSettingsViews()
    }
    return btn
  }))

  $('#editors').replaceChildren(...draft.map((a, i) => {
    const isWorktrees = !!(worktreeState?.enabled)
    const wtAgent = worktreeState?.agents?.find(x => x.name.toLowerCase() === a.name.toLowerCase())
    const workspaceId = (!isWorktrees || a.readOnly) ? null : (wtAgent?.workspaceId || sess[a.name]?.workspaceId || null)
    const card = el('div', 'agent box')
    const top = el('div', 'atop')
    need(a.cli, a.name, workspaceId)
    const cli = select(accounts.map(c => [c, c]), a.cli, v => {
      if (a.cli !== v) {
        a.cli = v
        a.model = a.effort = ''
        a.permissions.mode = 'edit'
        if (!v.startsWith('claude')) a.permissions.allowTools = []
        if (!v.startsWith('codex')) a.permissions.networkAccess = false
        renderEditors()
      }
    })

    const chk = el('label', 'chk')
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = a.resume !== false
    cb.onchange = () => { a.resume = cb.checked; renderEditors() }
    chk.append(cb, 'Nhớ phiên')

    const roLabel = el('label', 'chk')
    const roCb = el('input'); roCb.type = 'checkbox'; roCb.checked = !!a.readOnly
    roCb.onchange = () => { a.readOnly = roCb.checked; renderEditors() }
    roLabel.append(roCb, 'Chỉ đọc')

    const del = el('button', 'box press btn sm danger', 'Xoá')
    del.onclick = () => {
      draft.splice(i, 1)
      if (currentSettingTab === 'agent:' + i) {
        currentSettingTab = draft.length > 0 ? 'agent:' + Math.min(i, draft.length - 1) : 'general'
      } else if (typeof currentSettingTab === 'string' && currentSettingTab.startsWith('agent:')) {
        const curIdx = parseInt(currentSettingTab.slice(6), 10)
        if (curIdx > i) {
          currentSettingTab = 'agent:' + (curIdx - 1)
        }
      }
      renderEditors()
    }

    const topAv = paintAvatar(el('div', 'av'), a.name, a.avatar.color)
    const repaint = () => {
      paintAvatar(topAv, a.name, a.avatar.color)
      paintAvatar(navList.children[i].querySelector('.settings-nav-av'), a.name, a.avatar.color)
    }
    const nameInp = field('input', a.name, v => {
      a.name = v.trim()
      navList.children[i].querySelector('.settings-nav-label').textContent = a.name ? `@${a.name}` : '(chưa có tên)'
      repaint()
    }, { className: 'f name', placeholder: 'tên (vd: dev-fe)' })
    top.append(topAv, nameInp, cli, chk, roLabel, del)

    // identity color: shows on the avatar and the agent's status icons
    const avRow = el('div', 'avatar-row')
    const palDiv = el('div', 'avatar-palette')
    AVATAR_PALETTE.forEach(c => {
      const sw = el('button', 'avatar-swatch' + (a.avatar.color === c ? ' selected' : ''))
      sw.type = 'button'
      sw.style.background = c
      sw.title = `${PALETTE_NAMES[c] || c}: ${c}`
      sw.setAttribute('aria-label', `Chọn màu ${PALETTE_NAMES[c] || c}`)
      sw.setAttribute('aria-pressed', a.avatar.color === c ? 'true' : 'false')
      sw.onclick = () => {
        a.avatar.color = c
        palDiv.querySelectorAll('.avatar-swatch').forEach(s => {
          s.classList.toggle('selected', s === sw)
          s.setAttribute('aria-pressed', s === sw ? 'true' : 'false')
        })
        repaint()
      }
      palDiv.append(sw)
    })
    avRow.append(el('span', 'avatar-label', 'Màu nhận diện'), palDiv)

    const role = el('label', '', 'Vai trò')
    role.append(field('textarea', a.role, v => a.role = v, { className: 'f', placeholder: 'vd: Dev front-end: làm UI theo thiết kế của techlead' }))

    const ownsLines = Array.isArray(a.owns) ? a.owns.join('\n') : (typeof a.owns === 'string' ? a.owns : '')
    const ownsLab = el('label', '', 'Phạm vi phụ trách (mỗi dòng một path/glob)')
    const ownsArea = field('textarea', ownsLines, v => {
      a.owns = v.split('\n').map(s => s.trim()).filter(Boolean)
    }, { className: 'f', rows: 3, placeholder: 'vd:\nindex.html\nreports/**\n(để trống: toàn dự án)' })
    const ownsNote = el('small', '', 'Để trống: toàn dự án. Chỉ đọc: cảnh báo nếu có ghi.')
    ownsNote.style.color = 'var(--muted)'
    ownsLab.append(ownsArea, ownsNote)

    // ---- Group: Quyền ----
    const isClaude = a.cli.startsWith('claude')
    const isCodex = a.cli.startsWith('codex')
    const isAgy = a.cli.startsWith('agy')

    const permGroup = el('div', 'agent-perm-group')

    const permHdr = el('div', 'settings-perm-hdr')
    permHdr.textContent = 'Quyền công cụ của CLI'
    permGroup.append(permHdr)

    const modeOptions = [
      ['edit', 'Mặc định (sửa file + lệnh đã cho phép)'],
      ['custom', isAgy ? 'Tuỳ chỉnh (agy không hỗ trợ)' : 'Tuỳ chỉnh'],
      ['full', 'Toàn quyền']
    ]
    const modeLab = el('label', 'grow', 'Mức quyền')
    const modeSel = select(modeOptions, a.permissions.mode, v => {
      if (isAgy && v === 'custom') {
        a.permissions.mode = 'edit'
      } else {
        a.permissions.mode = v
      }
      renderEditors()
    })
    if (isAgy) modeSel.querySelector('option[value="custom"]').disabled = true
    modeLab.append(modeSel)
    permGroup.append(modeLab)

    if (a.permissions.mode === 'full') {
      const fullWarn = el('div', 'task-error-banner')
      fullWarn.textContent = '⚠️ Cảnh báo Toàn quyền: Agent có thể chạy lệnh, dùng mạng và tác động tới file ngoài dự án theo quyền tài khoản máy. Phạm vi file của app không phải sandbox bảo vệ hệ điều hành.'
      permGroup.append(fullWarn)

      if (isCodex) {
        const codexFullNote = el('small', '', 'Codex Toàn quyền: Mạng không bị giới hạn bởi workspace sandbox (-c sandbox_mode="danger-full-access").')
        codexFullNote.style.color = 'var(--muted)'
        permGroup.append(codexFullNote)
      } else if (isAgy) {
        const agyFullNote = el('small', '', 'agy Toàn quyền: Bỏ hỏi quyền (--dangerously-skip-permissions).')
        agyFullNote.style.color = 'var(--muted)'
        permGroup.append(agyFullNote)
      }
    }

    if (a.permissions.mode === 'custom') {
      if (isClaude) {
        const toolsLines = Array.isArray(a.permissions.allowTools) ? a.permissions.allowTools.join('\n') : ''
        const toolsLab = el('label', '', 'Quy tắc công cụ bổ sung (--allowedTools, mỗi dòng một quy tắc)')
        const toolsArea = field('textarea', toolsLines, v => {
          a.permissions.allowTools = v.split('\n').map(s => s.trim()).filter(Boolean)
        }, {
          className: 'f',
          rows: 3,
          placeholder: 'vd:\nBash(npm test:*)\nBash(git status)\nWebFetch\nmcp__github__get_issue'
        })
        const toolsNote = el('small', '', 'Quy tắc này bổ sung cho cấu hình CLI sẵn có. Mỗi dòng một rule: Tool hoặc Tool(pattern), MCP dạng mcp__server__tool. Tối đa 32 quy tắc.')
        toolsNote.style.color = 'var(--muted)'
        toolsLab.append(toolsArea, toolsNote)
        permGroup.append(toolsLab)

        // Read-only preview of Bash commands from allowedCommands
        const normCmds = Array.isArray(a.allowedCommands) ? a.allowedCommands : []
        const bashRules = normCmds.map(c => `Bash(${c})`).join('\n')
        const bashPreviewLab = el('label', '', 'Quyền Bash tự sinh từ lệnh được phép (chỉ đọc)')
        const bashPreviewArea = field('textarea', bashRules || '(không có lệnh nào)', () => {}, {
          className: 'f',
          rows: Math.min(3, Math.max(1, normCmds.length)),
          disabled: true
        })
        bashPreviewArea.style.opacity = '0.75'
        bashPreviewArea.style.background = 'var(--bg)'
        bashPreviewArea.style.fontFamily = 'ui-monospace, monospace'
        bashPreviewArea.style.fontSize = '11px'
        const bashPreviewNote = el('small', '', 'Tự động cấp vào --allowedTools khi Claude chạy ở mức Mặc định hoặc Tuỳ chỉnh.')
        bashPreviewNote.style.color = 'var(--muted)'
        bashPreviewLab.append(bashPreviewArea, bashPreviewNote)
        permGroup.append(bashPreviewLab)
      } else if (isCodex) {
        const netLab = el('label', 'chk')
        const netCb = el('input'); netCb.type = 'checkbox'; netCb.checked = !!a.permissions.networkAccess
        netCb.onchange = () => { a.permissions.networkAccess = netCb.checked; renderEditors() }
        netLab.append(netCb, 'Cho lệnh trong sandbox truy cập mạng')
        const netNote = el('small', '', 'Codex tự chạy lệnh trong sandbox; danh sách bên dưới chỉ áp dụng khi app chạy hộ.')
        netNote.style.color = 'var(--muted)'
        permGroup.append(netLab, netNote)
      } else if (isAgy) {
        const agyNote = el('small', '', 'agy không hỗ trợ danh sách công cụ tuỳ chỉnh.')
        agyNote.style.color = 'var(--muted)'
        permGroup.append(agyNote)
      }
    }

    // allowedCommands (inside permGroup)
    const cmdLines = Array.isArray(a.allowedCommands) ? a.allowedCommands.join('\n') : ''
    const cmdLab = el('label', '', 'Lệnh được tự chạy (mỗi dòng một lệnh)')
    const cmdArea = field('textarea', cmdLines, v => {
      a.allowedCommands = v.split('\n').map(s => s.trim()).filter(Boolean)
      if (isClaude && a.permissions.mode === 'custom') {
        renderEditors()
      }
    }, { className: 'f', rows: 2, placeholder: 'vd:\nnpm run check\nnode check.js\n(để trống: tắt chạy lệnh)' })
    const cmdNote = el('small', '', 'Để trống: tắt lệnh do app chạy hộ. Claude cũng không được app cấp thêm quyền Bash từ danh sách này. Quyền CLI sẵn có và Toàn quyền vẫn áp dụng.')
    cmdNote.style.color = 'var(--muted)'
    cmdLab.append(cmdArea, cmdNote)
    permGroup.append(cmdLab)

    if (a.permissionConfigError) {
      const permErr = el('div', 'task-error-banner', `⚠️ Lỗi cấu hình quyền: ${a.permissionConfigError}`)
      permGroup.append(permErr)
    }
    if (a.commandConfigError) {
      const cmdErr = el('div', 'task-error-banner', `⚠️ Lỗi cấu hình lệnh: ${a.commandConfigError}`)
      permGroup.append(cmdErr)
    }

    let sessErr = null
    if (a.sessionConfigError) {
      sessErr = el('div', 'task-error-banner', `⚠️ Lỗi cấu hình xoay phiên: ${a.sessionConfigError}`)
    }

    const m = modelsOf[a.cli], models = m?.models || []
    const efforts = models.find(x => x.id === a.model)?.efforts || m?.efforts || models[0]?.efforts || []
    const tune = el('div', 'atop')
    const ml = el('label', 'grow', 'Model')
    ml.append(select([['', m ? 'Mặc định của CLI' : 'Đang tải…'], ...models.map(x => [x.id, x.label || x.id])], a.model || '', v => { a.model = v; renderEditors() }))
    const ef = el('label', '', 'Effort')
    ef.append(select([['', 'Mặc định'], ...efforts.map(e => [e, e])], a.effort || '', v => a.effort = v))
    tune.append(ml, ef)

    const limitsRow = el('div', 'atop')
    const to = el('label', '', 'Giới hạn mỗi lượt (phút)')
    const toVal = a.timeoutMinutes != null ? a.timeoutMinutes : 30
    const toInp = field('input', toVal, v => { a.timeoutMinutes = v }, { type: 'number', min: '1', max: '1440', step: '1', className: 'f', style: 'width: 100px;' })
    to.append(toInp)

    const rotLab = el('label', '', 'Ngưỡng xoay phiên (token vào)')
    const rotVal = (a.sessionTokenLimit != null && a.sessionTokenLimit !== '') ? a.sessionTokenLimit : 150000
    const rotInp = field('input', rotVal, v => { a.sessionTokenLimit = v }, {
      type: 'number', min: '0', step: '1', placeholder: '150000', className: 'f', style: 'width: 140px;',
      title: 'Tự mở phiên mới khi token vào vượt ngưỡng. 0 = tắt.'
    })
    const rotNote = el('small', '', '0 = tắt. Áp dụng cho lượt kế tiếp.')
    rotNote.style.color = 'var(--muted)'
    rotLab.append(rotInp, rotNote)
    limitsRow.append(to, rotLab)

    let reviewCard = null
    if (a.scopeNeedsReview) {
      reviewCard = el('div', 'review-card')
      const txt = el('span', '', `Phạm vi cũ cần xác nhận: "${a.ownsLegacy || (Array.isArray(a.owns) ? a.owns.join(', ') : a.owns) || '—'}"`)
      const btn = el('button', 'btn-stop box press', 'Xác nhận phạm vi này')
      btn.type = 'button'
      btn.onclick = () => {
        a.scopeConfirmed = true
        a.scopeNeedsReview = false
        renderEditors()
      }
      reviewCard.append(txt, btn)
    }

    const line = el('div', 'sess')
    if (a.resume === false) line.append(el('span', '', 'Tắt nhớ phiên: mỗi lượt gửi lại 30 tin gần nhất'))
    else {
      const cur = (sess[a.name]?.cli === a.cli && sess[a.name]?.id) ? sess[a.name] : null
      const sKey = sessionCacheKey(dir, a.name, a.cli, workspaceId)
      const list = sessionsOf[sKey]
      const lab = el('label', 'grow', `Phiên ${a.cli} trong dự án này`)
      lab.append(select([['', list ? 'Phiên mới (tự mở ở lượt tới)' : 'Đang tải…'], ...(list || []).map(s => [s.id, `${when(s.at)} · ${(s.title || s.id).slice(0, 70)}`])],
        cur?.id || '', async v => {
          try {
            const targetDir = dir
            if (v) await api.useSession(targetDir, a.name, a.cli, v, workspaceId); else await api.resetSession(targetDir, a.name)
            if (dir === targetDir) {
              sess = await api.sessions(targetDir)
              renderEditors()
            }
          } catch (e) { $('#err').textContent = e.message.replace(/^.*?Error: /, '') }
        }))
      line.append(lab)
      if (cur) line.append(el('small', '', cur.adopted ? 'Lượt tới gửi kèm bối cảnh nhóm' : `Đã đọc ${cur.seen} tin · ${when(cur.at)}`))
    }
    card.append(top, avRow, tune, limitsRow, role, ownsLab, permGroup, ...(sessErr ? [sessErr] : []), ...(reviewCard ? [reviewCard] : []), line)
    return card
  }))

  updateSettingsViews()
  const refocus = controls()[focusAt]
  if (refocus && refocus.tagName === focused.tagName && refocus.type === focused.type) {
    refocus.focus()
    if (caret) refocus.setSelectionRange(...caret)
  }
}

initSettingsNav()

// Connection test for every agent in the form (unsaved changes included)
$('#probe').onclick = async () => {
  const btn = $('#probe'), out = $('#probe-results'), probeDir = dir
  btn.disabled = true; btn.textContent = 'Đang kiểm tra…'
  out.hidden = false
  out.replaceChildren(el('div', 'probe-row', `Đang gửi câu kiểm tra tới ${draft.length} agent… (có thể mất tới 2 phút)`))
  try {
    const res = await api.probeAgents(probeDir, draft)
    if (dir !== probeDir) return
    if (!res?.ok) { out.replaceChildren(el('div', 'probe-row bad', res?.error?.message || 'Không kiểm tra được')); return }
    out.replaceChildren(...res.results.map(r => {
      const row = el('div', 'probe-row ' + (r.ok ? 'good' : 'bad'))
      row.append(el('b', '', `${r.ok ? '✓' : '✗'} @${r.name}`),
        el('span', '', `${r.cli}${r.model ? ' · ' + r.model : ''} · ${(r.ms / 1000).toFixed(1)} giây${r.ok ? ' · trả lời "' + r.text + '"' : ''}`))
      if (!r.ok) row.append(el('div', 'probe-err', r.error))
      return row
    }))
  } catch (e) { out.replaceChildren(el('div', 'probe-row bad', e.message)) }
  finally { btn.disabled = false; btn.textContent = 'Kiểm tra kết nối' }
}

$('#gear').onclick = async () => {
  if (openingDir) return // `team` still belongs to the project being left
  const reqDir = dir, reqSeq = openSeq
  const [s, acc, pRes, wtRes] = await Promise.all([api.sessions(reqDir), api.accounts(),
    api.projectSettings(reqDir).catch(() => null), api.worktreeState(reqDir).catch(() => null)])
  if (dir !== reqDir || openSeq !== reqSeq) return // switched project meanwhile: never edit A's team under B
  sess = s; accounts = acc
  if (pRes?.ok) { currentSettings = pRes.settings; currentSettingsRevision = pRes.revision }
  if (wtRes?.ok) worktreeState = wtRes.state
  draft = structuredClone(team)
  draftTeamRevision = currentTeamRevision
  draftSettingsRevision = currentSettingsRevision
  sessionsOf = {}
  $('#probe-results').hidden = true
  $('#spath').textContent = dir
  $('#err').textContent = ''

  $('#setting-box-name').value = currentSettings.name || ''
  $('#setting-auto-summary').checked = currentSettings.autoSummary !== false
  $('#setting-worktrees').checked = !!currentSettings.worktreesEnabled
  $('#setting-merge-checks').value = (currentSettings.mergeChecks || ['npm run check']).join('\n')
  $('#setting-chain-limit').value = currentSettings.chainLimit ?? currentSettings.maxHops ?? 12
  $('#setting-cost-ceiling').value = currentSettings.costCeiling != null ? currentSettings.costCeiling : ''

  const isGitRepo = worktreeState && worktreeState.available !== false && worktreeState.reason !== 'NOT_REPO' && worktreeState.reason !== 'GIT_MISSING'
  if (!isGitRepo) {
    $('#btn-init-git').hidden = false
    $('#setting-worktrees').disabled = true
    $('#setting-worktrees').checked = false
    $('#merge-checks-wrap').hidden = true
    $('#git-status-msg').textContent = 'Dự án chưa phải Git repository. Bấm "Khởi tạo Git" để bắt đầu.'
  } else {
    $('#btn-init-git').hidden = true
    $('#setting-worktrees').disabled = false
    $('#git-status-msg').textContent = worktreeState?.targetBranch ? `Nhánh chính: ${worktreeState.targetBranch}` : ''
    $('#merge-checks-wrap').hidden = !$('#setting-worktrees').checked
  }

  $('#setting-worktrees').onchange = () => {
    $('#merge-checks-wrap').hidden = !$('#setting-worktrees').checked
  }
  $('#btn-init-git').onclick = () => openGitInitModal()

  if (!currentSettingTab || (currentSettingTab.startsWith('agent:') && parseInt(currentSettingTab.slice(6), 10) >= draft.length)) {
    currentSettingTab = 'general'
  }
  renderEditors()
  $('#settings').showModal()
}

let gitInitToken = null
let gitInitFiles = []
async function openGitInitModal() {
  const modal = $('#git-init-modal')
  const errBanner = $('#git-init-error')
  const confirmBtn = $('#git-init-confirm')
  errBanner.hidden = true
  confirmBtn.disabled = true
  gitInitToken = null
  gitInitFiles = []
  $('#git-init-path').textContent = dir
  $('#git-init-branch').textContent = 'main'
  $('#git-init-files').replaceChildren(el('div', 'none', 'Đang chuẩn bị danh sách file…'))
  $('#git-init-ignore').textContent = 'Đang tải…'
  modal.showModal()

  try {
    const res = await api.prepareGitInit(dir)
    if (!res || !res.ok) {
      throw new Error(res?.error?.message || 'Không thể chuẩn bị Git init')
    }
    gitInitToken = res.token
    gitInitFiles = Array.isArray(res.files) ? [...res.files] : []
    $('#git-init-branch').textContent = res.branch || 'main'
    $('#git-init-ignore').textContent = res.ignoreText || ''

    const filesEl = $('#git-init-files')
    filesEl.replaceChildren()
    if (!gitInitFiles || gitInitFiles.length === 0) {
      filesEl.append(el('div', 'none', 'Không có file nào để commit'))
      confirmBtn.disabled = true
    } else {
      gitInitFiles.forEach(f => {
        filesEl.append(el('div', '', f))
      })
      confirmBtn.disabled = false
    }
  } catch (e) {
    gitInitToken = null
    gitInitFiles = []
    confirmBtn.disabled = true
    errBanner.textContent = e.message.replace(/^.*?Error: /, '')
    errBanner.hidden = false
  }
}

$('#git-init-cancel').onclick = () => $('#git-init-modal').close()

$('#git-init-confirm').onclick = async () => {
  const btn = $('#git-init-confirm')
  const errBanner = $('#git-init-error')
  if (!gitInitToken || !Array.isArray(gitInitFiles) || gitInitFiles.length === 0) {
    errBanner.textContent = 'Danh sách file commit đầu không hợp lệ'
    errBanner.hidden = false
    return
  }
  btn.disabled = true
  errBanner.hidden = true
  try {
    const res = await api.initGit(dir, { token: gitInitToken, files: gitInitFiles })
    if (!res || !res.ok) {
      throw new Error(res?.error?.message || 'Khởi tạo Git thất bại')
    }
    $('#git-init-modal').close()
    showToast('Đã khởi tạo Git thành công!')
    await loadWorktreeState()
    $('#btn-init-git').hidden = true
    $('#setting-worktrees').disabled = false
    $('#git-status-msg').textContent = 'Đã khởi tạo Git (nhánh main)'
  } catch (e) {
    errBanner.textContent = e.message.replace(/^.*?Error: /, '')
    errBanner.hidden = false
  } finally {
    btn.disabled = false
  }
}

$('#add').onclick = () => {
  const nextAvatar = getDefaultAvatar(draft, draft.length)
  draft.push({
    name: '',
    cli: 'claude',
    role: '',
    owns: [],
    readOnly: false,
    resume: true,
    timeoutMinutes: 30,
    sessionTokenLimit: 150000,
    allowedCommands: ['npm run check'],
    permissions: { mode: 'edit', allowTools: [], networkAccess: false },
    avatar: nextAvatar
  })
  currentSettingTab = 'agent:' + (draft.length - 1)
  renderEditors()
  const lastCard = $('#editors').lastChild
  lastCard.scrollIntoView()
  lastCard.querySelector('input.name').focus()
}
$('#resetAll').onclick = async () => {
  try {
    const targetDir = dir
    await api.resetSession(targetDir, null)
    if (dir === targetDir) {
      sess = await api.sessions(targetDir)
      renderEditors()
    }
  } catch (e) { $('#err').textContent = e.message.replace(/^.*?Error: /, '') }
}
$('#cancel').onclick = () => $('#settings').close()
$('#save').onclick = async () => {
  $('#err').textContent = ''
  for (let idx = 0; idx < draft.length; idx++) {
    const a = draft[idx]
    const val = a.timeoutMinutes == null || a.timeoutMinutes === '' ? 30 : Number(a.timeoutMinutes)
    if (!Number.isInteger(val) || val < 1 || val > 1440) {
      $('#err').textContent = `Giới hạn mỗi lượt của @${a.name || 'agent'} phải là số nguyên từ 1 đến 1440 phút`
      currentSettingTab = 'agent:' + idx
      updateSettingsViews()
      return
    }
    a.timeoutMinutes = val

    const rawLim = a.sessionTokenLimit
    let tokenLim = 150000
    if (rawLim !== '' && rawLim != null) {
      tokenLim = typeof rawLim === 'number' ? rawLim : Number(rawLim)
    }
    if (!Number.isSafeInteger(tokenLim) || tokenLim < 0) {
      $('#err').textContent = `Ngưỡng xoay phiên của @${a.name || 'agent'} phải là số nguyên không âm (>= 0)`
      currentSettingTab = 'agent:' + idx
      updateSettingsViews()
      return
    }
    a.sessionTokenLimit = tokenLim
    delete a.sessionConfigError

    if (!a.avatar || !['male', 'female'].includes(a.avatar.gender) || !AVATAR_PALETTE.includes(a.avatar.color)) {
      $('#err').textContent = `Avatar của @${a.name || 'agent'} không hợp lệ`
      currentSettingTab = 'agent:' + idx
      updateSettingsViews()
      return
    }

    const cmdRes = validateAllowedCommands(a.allowedCommands || [])
    if (!cmdRes.valid) {
      $('#err').textContent = `Lỗi cấu hình lệnh của @${a.name || 'agent'}: ${cmdRes.message}`
      currentSettingTab = 'agent:' + idx
      updateSettingsViews()
      return
    }
    a.allowedCommands = cmdRes.commands
    delete a.commandConfigError

    if (a.cli.startsWith('agy') && a.permissions.mode === 'custom') {
      $('#err').textContent = `agy không hỗ trợ chế độ Tuỳ chỉnh cho @${a.name || 'agent'}`
      currentSettingTab = 'agent:' + idx
      updateSettingsViews()
      return
    }
    if (a.permissions.mode === 'custom') {
      if (a.cli.startsWith('claude')) {
        const toolRes = validateAllowTools(a.permissions.allowTools || [])
        if (!toolRes.valid) {
          $('#err').textContent = `Lỗi quy tắc công cụ của @${a.name || 'agent'}: ${toolRes.message}`
          currentSettingTab = 'agent:' + idx
          updateSettingsViews()
          return
        }
        a.permissions.allowTools = toolRes.tools
        a.permissions.networkAccess = false
      } else if (a.cli.startsWith('codex')) {
        a.permissions.allowTools = []
        a.permissions.networkAccess = !!a.permissions.networkAccess
      } else {
        a.permissions.allowTools = []
        a.permissions.networkAccess = false
      }
    } else if (a.permissions.mode === 'edit') {
      if (!a.cli.startsWith('claude')) a.permissions.allowTools = []
      if (!a.cli.startsWith('codex')) a.permissions.networkAccess = false
    } else if (a.permissions.mode === 'full') {
      if (!a.cli.startsWith('claude')) a.permissions.allowTools = []
      if (!a.cli.startsWith('codex')) a.permissions.networkAccess = false
    }
    delete a.permissionConfigError
  }

  const autoSummary = $('#setting-auto-summary').checked
  const worktreesEnabled = $('#setting-worktrees').checked
  const mergeChecksRaw = $('#setting-merge-checks').value.split('\n').map(s => s.trim()).filter(Boolean)
  let mergeChecks = ['npm run check']

  if (worktreesEnabled) {
    if (mergeChecksRaw.length === 0) {
      $('#err').textContent = 'Phải có ít nhất 1 lệnh kiểm tra khi bật worktree'
      currentSettingTab = 'worktree'
      updateSettingsViews()
      return
    }
    const chkRes = validateAllowedCommands(mergeChecksRaw)
    if (!chkRes.valid) {
      $('#err').textContent = `Lỗi lệnh kiểm tra: ${chkRes.message}`
      currentSettingTab = 'worktree'
      updateSettingsViews()
      return
    }
    mergeChecks = chkRes.commands
  } else if (mergeChecksRaw.length > 0) {
    const chkRes = validateAllowedCommands(mergeChecksRaw)
    if (!chkRes.valid) {
      $('#err').textContent = `Lỗi lệnh kiểm tra: ${chkRes.message}`
      currentSettingTab = 'worktree'
      updateSettingsViews()
      return
    }
    mergeChecks = chkRes.commands
  }

  const rawChainLimit = $('#setting-chain-limit').value.trim()
  const chainLimit = rawChainLimit === '' ? 12 : Number(rawChainLimit)
  if (!Number.isInteger(chainLimit) || chainLimit < 1 || chainLimit > 50) {
    $('#err').textContent = 'Giới hạn chuỗi agent phải là số nguyên từ 1 đến 50 lượt'
    currentSettingTab = 'limits'
    updateSettingsViews()
    return
  }

  const rawCostCeiling = $('#setting-cost-ceiling').value.trim()
  let costCeiling = null
  if (rawCostCeiling !== '') {
    const parsedCost = Number(rawCostCeiling)
    if (isNaN(parsedCost) || parsedCost < 0) {
      $('#err').textContent = 'Trần chi phí mỗi chuỗi phải là số dương hoặc để trống'
      currentSettingTab = 'limits'
      updateSettingsViews()
      return
    }
    costCeiling = Number(parsedCost.toFixed(4))
  }

  const saveDir = dir
  try {
    // main announces the new team (team-changed) before this call returns; that echo of our own save is not
    // an outside change, so the warning below must ignore it
    savingTeam = true
    let saveRes
    // expected revisions are the ones the draft was read at (not the live ones events keep updating), so a team or
    // settings change made while the dialog was open comes back as CONFLICT instead of being silently reverted
    try { saveRes = await api.saveTeam(saveDir, draft, { expectedRevision: draftTeamRevision }) } finally { savingTeam = false }
    if (!saveRes.ok) {
      $('#err').textContent = saveRes.error.message
      return
    }
    team = saveRes.team
    currentTeamRevision = draftTeamRevision = saveRes.revision // the draft is now what is saved: a retry after a settings error must not conflict with it
    const pRes = await api.saveProjectSettings(saveDir, {
      expectedRevision: draftSettingsRevision,
      settings: {
        version: 1,
        autoSummary,
        worktreesEnabled,
        mergeChecks,
        chainLimit,
        maxHops: chainLimit,
        costCeiling,
        name: $('#setting-box-name').value.trim()
      }
    })
    if (!pRes.ok) {
      $('#err').textContent = pRes.error.message
      return
    }
    currentSettings = pRes.settings
    currentSettingsRevision = draftSettingsRevision = pRes.revision

    if (dir === saveDir) {
      updateAllAgentAvatars()
      renderTeam()
      loadWorktreeState(saveDir)
    }
    loadProjects() // box name may have changed
    $('#settings').close()
  } catch (e) { $('#err').textContent = e.message.replace(/^.*?Error: /, '') }
}

let toastTimer = null
function showToast(text) {
  const t = $('#toast')
  t.textContent = text
  t.style.display = 'block'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    t.style.display = 'none'
  }, 4000)
}

async function openSettingsForAgent(agentName) {
  if (!agentName) return
  await $('#gear').onclick()
  const idx = draft.findIndex(a => a.name.toLowerCase() === agentName.toLowerCase())
  if (idx >= 0) {
    currentSettingTab = 'agent:' + idx
    updateSettingsViews()
  }
}

function updateGrantButtonsState() {
  document.querySelectorAll('.btn-grant-perm').forEach(btn => {
    const reqId = btn.dataset.reqId
    const agent = btn.dataset.agent
    const isBusy = !!activeRuns.get(runKey(dir, agent))
    const pReq = permissionRequests.find(r => r.id === reqId)
    if (btn.textContent === 'Đã cấp quyền' || btn.textContent === 'Đã lưu quyền' || btn.textContent === 'Đang cấp quyền…') {
      btn.disabled = true
    } else {
      btn.disabled = isBusy || !pReq
    }
  })
}

let mdInstance = null
function initMarkdown() {
  if (mdInstance) return mdInstance
  if (typeof window.markdownit === 'function') {
    mdInstance = new window.markdownit({ html: false, linkify: false, breaks: true }).disable('image')
    mdInstance.validateLink = (url) => {
      const trimmed = (url || '').trim()
      if (/^(?:javascript|data|vbscript|file):/i.test(trimmed) || /^\/\//.test(trimmed)) return false
      if (/^[a-z0-9+.-]+:/i.test(trimmed) && !/^https?:/i.test(trimmed)) return false
      return true
    }
  }
  return mdInstance
}

function bindLinkHandler(container, context = {}) {
  // agent-written link text can name one place and point at another: hovering shows the real target
  for (const a of container.querySelectorAll('a')) if (/^https?:\/\//i.test(a.getAttribute('href'))) a.title = a.getAttribute('href')
  const handler = async (e) => {
    const a = e.target.closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')
    if (!href) return
    if (/^https?:\/\//i.test(href)) {
      try {
        await api.openLink(context.dir || dir, href, a.textContent) // main confirms when the text differs from the URL
      } catch (err) {
        showToast(err.message.replace(/^.*?Error: /, ''))
      }
    } else {
      openFileViewer(href, context.fromFile || null, context.workspace || null)
    }
  }
  container.addEventListener('click', handler) // Enter on a focused link (all have href) fires this click too
}

function linkifyFiles(root, context = {}) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    if (node.parentElement && (node.parentElement.closest('a') || node.parentElement.closest('pre'))) {
      continue
    }
    textNodes.push(node)
  }
  const regex = /((?:reports|\.chat)\/[\w.\/-]+\w|(?<![\w@])@[\w-]+)/ // file paths, and @mentions (same name rule as core.mentions)
  const members = new Set(team.map(a => a.name.toLowerCase()))
  for (const tNode of textNodes) {
    const parts = tNode.nodeValue.split(regex)
    if (parts.length <= 1) continue
    const frag = document.createDocumentFragment()
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0 || parts[i][0] === '@') {
        if (i % 2 && members.has(parts[i].slice(1).toLowerCase())) frag.append(el('span', 'mention', parts[i]))
        else if (parts[i]) frag.append(document.createTextNode(parts[i]))
      } else {
        const a = el('a', 'file', parts[i])
        a.setAttribute('href', parts[i])
        a.tabIndex = 0
        frag.append(a)
      }
    }
    tNode.parentNode.replaceChild(frag, tNode)
  }
}

function renderMarkdown(text, context = {}) {
  const container = el('div', 'md-content')
  const parser = initMarkdown()
  if (!parser) {
    container.textContent = text
    linkifyFiles(container, context)
    bindLinkHandler(container, context)
    return container
  }
  try {
    container.innerHTML = parser.render(text || '')
  } catch (e) {
    container.textContent = text
    linkifyFiles(container, context)
    bindLinkHandler(container, context)
    return container
  }
  linkifyFiles(container, context)
  bindLinkHandler(container, context)
  return container
}

// 706295 → "706k", 3200 → "3,2k", 135100000 → "135,1M"; exact values stay in the tooltip
const short = n => n < 1e3 ? String(n) : n < 1e6 ? (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: n < 1e4 ? 1 : 0 }) + 'k'
  : (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + 'M'
const usd = n => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: n && n < 0.01 ? 4 : 2 })
const CLI_COUNT_NOTE = 'Theo bộ đếm của CLI; cách tính cache có thể khác nhau'

function usageEl(u) {
  if (!u) return null
  const n = v => v != null ? v.toLocaleString('vi-VN') : '—', sec = u.durationMs != null ? u.durationMs / 1000 : null
  const time = sec == null ? '—' : sec < 60 ? sec.toLocaleString('vi-VN', { maximumFractionDigits: sec < 10 ? 1 : 0 }) + 's'
    : `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, '0')}s`
  const node = el('div', 'usage', [
    `in ${u.inputTokens != null ? short(u.inputTokens) : '—'}`,
    `out ${u.outputTokens != null ? short(u.outputTokens) : '—'}`,
    u.costUsd != null ? '$' + usd(u.costUsd) : '$—',
    time,
    ...(u.partial ? ['chưa đủ dữ liệu'] : [])
  ].join(' · '))
  node.title = `Vào ${n(u.inputTokens)} · Ra ${n(u.outputTokens)} token · USD ${n(u.costUsd)}\n${CLI_COUNT_NOTE}`
  return node
}

function updateHeaderStats() {
  const t = currentTotals
  const row = (k, v) => { const r = el('div', 'kv'); r.append(el('span', '', k), el('b', '', v)); return r }
  const notes = [t.tokensIncomplete && 'token chưa đủ dữ liệu', t.costIncomplete && 'chi phí chưa đủ dữ liệu', t.partialLog && 'log chưa đầy đủ'].filter(Boolean)
  $('#stats').replaceChildren(
    row('Token', t.hasTokens ? short(t.tokens || 0) : t.tokensIncomplete ? '—' : '0'),
    row('USD', t.hasCost ? usd(t.costUsd || 0) : t.costIncomplete ? '—' : '0'),
    ...(notes.length ? [el('small', '', notes.join(' · '))] : []))
  $('#stats').title = `${(t.tokens || 0).toLocaleString('vi-VN')} token · USD ${(t.costUsd || 0).toLocaleString('vi-VN')}\n${CLI_COUNT_NOTE}`
  $('#stats-sec').hidden = false
}

function withPreservedScroll(fn) {
  const log = $('#log')
  const nearBottom = (log.scrollHeight - log.clientHeight - log.scrollTop) <= 48
  fn()
  if (nearBottom) {
    log.scrollTop = log.scrollHeight
  }
}

function createMsgElement(m) {
  const usage = usageEl(m.usage)
  let node = null

  if (m.kind === 'task-status') {
    const sys = el('div', 'sys')
    sys.append(el('div', '', m.text))
    node = sys
  } else if (m.kind === 'scope-warning') {
    // one thin strip, collapsed: the file list is one click away
    const card = el('details', 'scope-warning')
    const paths = Array.isArray(m.paths) ? m.paths : [], who = /@([\w-]+)/.exec(m.text || '')?.[1]
    const turn = who ? ` trong lượt @${who}` : ''
    card.append(el('summary', '', paths.length ? `${paths.length} file ngoài phạm vi thay đổi${turn}` : `Chưa kiểm tra đủ thay đổi file${turn}`),
      el('div', 'scope-warn-text', m.text))
    if (paths.length) {
      const pEl = el('div', 'scope-paths')
      pEl.append(...paths.map(p => el('code', '', p)))
      card.append(pEl)
    }
    node = card
  } else if (m.kind === 'merge') {
    const card = el('div', 'sys')
    const hdr = el('div', '', m.text)
    card.append(hdr)
    if (m.queueId && m.owner && ['CONFLICT', 'CHECK_FAILED', 'CHECK_MUTATED_TREE'].includes(m.error?.code)) {
      const repBtn = el('button', 'box press btn sm primary', `Gọi @${m.owner} sửa`)
      repBtn.type = 'button'
      repBtn.onclick = () => runMergeAction('requestMergeRepair', m.queueId, repBtn, `Đã yêu cầu @${m.owner} sửa xung đột`)
      card.append(repBtn)
    }
    node = card
  } else if (m.kind === 'permission-denied') {
    const card = el('div', 'perm-denied-card')

    const hdr = el('div', 'perm-denied-hdr')
    hdr.append('🚫 CLI báo từ chối quyền của @', el('span', '', m.agent || 'agent'))
    card.append(hdr)

    if (m.text) {
      const desc = el('div', 'perm-denied-desc', m.text)
      card.append(desc)
    }

    const denials = Array.isArray(m.denials) ? m.denials : []
    const reqId = m.permissionRequestId

    const listDiv = el('div', 'perm-denied-list')

    denials.forEach(dItem => {
      const itemRow = el('div', 'perm-denied-item')

      const infoDiv = el('div')
      const toolB = el('b', '', dItem.tool || 'Công cụ')
      infoDiv.append(toolB)
      if (dItem.label) {
        infoDiv.append(': ', el('span', '', dItem.label))
      }
      itemRow.append(infoDiv)

      if (dItem.rule) {
        const rulePre = el('div', '')
        rulePre.append('Quy tắc đề xuất: ', el('code', '', dItem.rule))
        itemRow.append(rulePre)
      }

      if (dItem.reason) {
        const reasonDiv = el('div', 'muted', dItem.reason)
        itemRow.append(reasonDiv)
      }

      const actRow = el('div', 'perm-denied-actions')

      const isBusy = activeRuns.has(runKey(dir, m.agent))
      const pReq = permissionRequests.find(r => r.id === reqId)
      const canGrantNow = !isBusy && !!pReq && !!dItem.canGrant

      if (dItem.canGrant) {
        const grantBtn = el('button', 'box press btn sm primary btn-grant-perm', 'Cho phép và chạy lại')
        grantBtn.type = 'button'
        grantBtn.dataset.reqId = reqId || ''
        grantBtn.dataset.denialId = dItem.id || ''
        grantBtn.dataset.agent = m.agent || ''
        grantBtn.disabled = !canGrantNow
        grantBtn.title = 'Lưu quyền này cho agent và chạy tiếp yêu cầu trước; có thể phát sinh chi phí một lượt'

        grantBtn.onclick = async () => {
          if (!reqId || !dItem.id) return
          grantBtn.disabled = true
          grantBtn.textContent = 'Đang cấp quyền…'
          try {
            const gRes = await api.grantPermissionAndRetry(dir, { requestId: reqId, denialId: dItem.id })
            if (!gRes || !gRes.ok) {
              if (gRes?.error?.permissionSaved) {
                showToast('Đã lưu quyền nhưng chưa chạy lại được lượt mới: ' + (gRes.error.message || ''))
                grantBtn.textContent = 'Đã lưu quyền'
              } else {
                throw new Error(gRes?.error?.message || 'Cấp quyền thất bại')
              }
            } else {
              showToast('Đã cấp quyền và khởi động lại lượt!')
              grantBtn.textContent = 'Đã cấp quyền'
              if (Array.isArray(gRes.team)) {
                team = gRes.team
                renderTeam()
              }
              if (gRes.teamRevision) {
                currentTeamRevision = gRes.teamRevision
              }
            }
          } catch (err) {
            showToast(err.message.replace(/^.*?Error: /, ''))
            grantBtn.disabled = false
            grantBtn.textContent = 'Cho phép và chạy lại'
          }
        }
        actRow.append(grantBtn)
      }

      const openBtn = el('button', 'box press btn sm btn-open-perm', 'Mở mục Quyền')
      openBtn.type = 'button'
      openBtn.onclick = () => {
        openSettingsForAgent(m.agent)
      }
      actRow.append(openBtn)

      itemRow.append(actRow)
      listDiv.append(itemRow)
    })

    if (denials.length > 0) {
      card.append(listDiv)
    } else {
      const noDenials = el('div', 'muted', 'Yêu cầu quyền không có chi tiết.')
      card.append(noDenials)
    }

    node = card
  } else if (m.from === 'system') {
    const sys = el('div', 'sys')
    sys.append(renderMarkdown(m.text, { dir, fromFile: null, workspace: m.workspace || null }))
    if (usage) sys.append(usage)
    // only main's own chain-stop record: its text is agent-influenced, and main refuses a second continue of the same chain
    if (m.kind === 'chain-stop') {
      const btnWrap = el('div')
      const contBtn = el('button', 'box press btn sm primary', 'Tiếp tục')
      contBtn.type = 'button'
      contBtn.title = 'Chạy tiếp chuỗi với bộ đếm mới'
      contBtn.onclick = async () => {
        contBtn.disabled = true
        contBtn.textContent = 'Đang tiếp tục…'
        try {
          const res = await api.continueChain(dir, { messageId: m.seq != null ? m.seq : m.runId })
          if (!res.ok) throw new Error(res.error.message)
          contBtn.textContent = 'Đã tiếp tục'
        } catch (err) {
          showToast(err.message.replace(/^.*?Error: /, ''))
          contBtn.disabled = false
          contBtn.textContent = 'Tiếp tục'
        }
      }
      btnWrap.append(contBtn)
      sys.append(btnWrap)
    }
    node = sys
  } else {
    const cont = last && last.from === m.from && new Date(m.at) - new Date(last.at) < 5 * 60e3 && new Date(m.at).getDate() === new Date(last.at).getDate()
    const row = el('div', 'row' + (m.from === 'user' ? ' me' : '') + (cont ? ' cont' : ''))
    if (cont) row.append(el('div'))
    else {
      const meta = el('div', 'meta')
      meta.append(el('b', '', m.from === 'user' ? 'Bạn' : '@' + m.from))
      const agent = team.find(a => a.name === m.from)
      if (agent) meta.append(el('span', 'cli', agent.cli))
      meta.append(el('time', '', hhmm(m.at)))
      row.append(avatar(agent || m.from), meta)
      row.firstChild.style.gridRow = 'span 2'
    }
    const body = el('div', 'text')
    body.append(renderMarkdown(m.text, { dir, fromFile: null, workspace: m.workspace || null }))
    if (usage) body.append(usage)
    row.append(body)
    node = row
  }

  if (m.seq != null) {
    node.dataset.seq = m.seq
  }
  if (m.at) node.dataset.at = m.at
  return node
}

// rows for consecutive messages in one fragment (one layout per batch); `last` carries the same-sender grouping
function msgFragment(list) {
  const frag = document.createDocumentFragment()
  for (const m of list) {
    if (m.usage?.durationMs > 0 && m.from !== 'user' && m.from !== 'system') noteTurnTime(m.from, m.usage.durationMs)
    frag.append(createMsgElement(m))
    last = (m.from !== 'system' && m.kind !== 'task-status' && m.kind !== 'scope-warning' && m.kind !== 'merge') ? m : null
  }
  return frag
}

// bumped by every full replace of the log window: a paging reply started before one belongs to a window that's gone
let logWindow = 0

function dayLabel(iso, now = new Date()) {
  const d = new Date(iso), days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5)
  if (days === 0) return 'Hôm nay'
  if (days === 1) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) })
}
// a date rule wherever the day changes; redone after every render (the window holds ≤300 rows), which also keeps
// "Hôm nay" true past midnight. Callers measure scroll after it.
function markDays() {
  const log = $('#log')
  log.querySelectorAll(':scope > .day').forEach(n => n.remove())
  let prev = null
  for (const node of log.querySelectorAll(':scope > [data-at]')) {
    const day = new Date(node.dataset.at).toDateString()
    if (day !== prev) { const rule = el('div', 'day'); rule.append(el('span', '', dayLabel(node.dataset.at))); node.before(rule) }
    prev = day
  }
}

function renderLoadedPage(page, mode = 'replace') {
  const log = $('#log')

  logGeneration = page.generation
  for (const m of page.messages) firstSeen(page.generation, m.seq) // its live event may still be on the way
  // a page only tells about the edge it extended (a `before` page always has hasAfter); a live message that
  // arrived while the page was loading lies past page.end, so there is still more after it
  if (mode !== 'append') logHasBefore = page.hasBefore
  if (mode !== 'prepend') logHasAfter = page.hasAfter || page.end <= newestLiveSeq
  if (page.error) {
    $('#log-error-banner').textContent = `⚠️ Lỗi log: ${page.error.message}`
    $('#log-error-banner').hidden = false
  } else {
    $('#log-error-banner').hidden = true
  }

  if (mode === 'replace') {
    logWindow++
    last = null
    log.replaceChildren(msgFragment(page.messages))
    markDays()
    if (!logHasAfter) {
      log.scrollTop = log.scrollHeight
      $('#jump-latest').hidden = true
      unreadNewMessagesCount = 0
    } else {
      $('#jump-latest').hidden = false
    }
  } else if (mode === 'prepend') {
    const oldScrollHeight = log.scrollHeight
    const oldScrollTop = log.scrollTop
    const keep = last
    last = null
    log.prepend(msgFragment(page.messages))
    markDays()
    last = keep
    log.scrollTop = oldScrollTop + (log.scrollHeight - oldScrollHeight)
  } else if (mode === 'append') {
    log.append(msgFragment(page.messages))
    markDays()
  }

  trimLogWindow(mode)
}

function trimLogWindow(mode) {
  const log = $('#log')
  const items = [...log.children].filter(c => c.id !== 'empty' && !c.classList.contains('day'))
  if (items.length <= 300) return

  if (mode === 'prepend') {
    const excess = items.length - 300
    for (let i = items.length - excess; i < items.length; i++) {
      items[i].remove()
    }
    markDays()
    logHasAfter = true
    $('#jump-latest').hidden = false
  } else {
    const excess = items.length - 300
    const oldScrollHeight = log.scrollHeight
    const oldScrollTop = log.scrollTop
    for (let i = 0; i < excess; i++) {
      items[i].remove()
    }
    markDays()
    logHasBefore = true
    log.scrollTop = Math.max(0, oldScrollTop - (oldScrollHeight - log.scrollHeight))
  }
}

// paging replies land after an await: drop them if another project (or a reopen) happened meanwhile
const sameOpen = (reqDir, reqSeq) => dir === reqDir && openSeq === reqSeq

async function loadEarlierPage() {
  const first = document.querySelector('#log [data-seq]')
  if (isPagingLoading || !logHasBefore || !dir || !first) return
  isPagingLoading = true
  const reqDir = dir, reqSeq = openSeq, reqWindow = logWindow
  const res = await api.logPage(reqDir, { generation: logGeneration, before: Number(first.dataset.seq), limit: 100 }).catch(() => null)
  isPagingLoading = false
  if (res?.ok && sameOpen(reqDir, reqSeq) && reqWindow === logWindow) renderLoadedPage(res.page, 'prepend')
}

async function loadLaterPage() {
  const shown = document.querySelectorAll('#log [data-seq]'), latest = shown[shown.length - 1]
  if (isPagingLoading || !logHasAfter || !dir || !latest) return
  isPagingLoading = true
  const reqDir = dir, reqSeq = openSeq, reqWindow = logWindow
  const res = await api.logPage(reqDir, { generation: logGeneration, after: Number(latest.dataset.seq), limit: 100 }).catch(() => null)
  isPagingLoading = false
  if (res?.ok && sameOpen(reqDir, reqSeq) && reqWindow === logWindow) renderLoadedPage(res.page, 'append')
}

$('#log').addEventListener('scroll', () => {
  const log = $('#log')
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight <= 48
  if (nearBottom && !logHasAfter) {
    $('#jump-latest').hidden = true
    unreadNewMessagesCount = 0
  }
  if (log.scrollTop < 60 && logHasBefore) {
    loadEarlierPage()
  } else if (log.scrollHeight - log.scrollTop - log.clientHeight < 60 && logHasAfter) {
    loadLaterPage()
  }
})

$('#jump-latest').onclick = async () => {
  const reqDir = dir, reqSeq = openSeq
  const res = await api.logPage(reqDir, { limit: 100 }).catch(() => null)
  if (!sameOpen(reqDir, reqSeq)) return
  if (res?.ok) return renderLoadedPage(res.page, 'replace')
  $('#log').scrollTop = $('#log').scrollHeight
  $('#jump-latest').hidden = true
  unreadNewMessagesCount = 0
}

// --- Sprint 6: Search history ---
function closeSearchResults() {
  const resEl = $('#search-results')
  resEl.hidden = true
  resEl.replaceChildren()
  $('#search-input').setAttribute('aria-expanded', 'false')
  searchSelectedIndex = -1
  searchResultsData = []
}

function updateSearchSenderDropdown(senders = []) {
  const sel = $('#search-sender')
  const curVal = sel.value
  const allSenders = new Set(['user', ...team.map(a => a.name), ...senders])
  sel.replaceChildren(new Option('Tất cả', ''))
  for (const s of [...allSenders].sort()) {
    if (!s) continue
    sel.append(new Option('@' + s, s, false, s === curVal))
  }
}

function handleSearchInput() {
  clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    executeSearch()
  }, 200)
}

async function executeSearch() {
  const query = $('#search-input').value.trim()
  const sender = $('#search-sender').value
  $('#search-clear').hidden = !query

  if (!query) {
    closeSearchResults()
    return
  }

  const thisId = ++searchRequestId
  const thisDir = dir
  const resEl = $('#search-results')
  resEl.hidden = false
  resEl.replaceChildren(el('div', 'search-status', 'Đang tìm kiếm…'))
  $('#search-input').setAttribute('aria-expanded', 'true')
  searchResultsData = [] // the shown list is gone: Enter must not jump to a result of the previous query
  searchSelectedIndex = -1

  const res = await api.searchLog(thisDir, { generation: logGeneration, query: query.slice(0, 256), from: sender || null, limit: 50 })
    .catch(e => ({ ok: false, error: { message: e.message.replace(/^.*?Error: /, '') } }))
  if (thisId !== searchRequestId || dir !== thisDir) return
  if (!res.ok) return resEl.replaceChildren(el('div', 'search-status', res.error.message))
  updateSearchSenderDropdown(res.senders)
  renderSearchResults(res.results)
}

function renderSearchResults(results) {
  const resEl = $('#search-results')
  resEl.hidden = false
  resEl.replaceChildren()
  searchResultsData = results
  searchSelectedIndex = -1

  if (results.length === 0) {
    resEl.append(el('div', 'search-status', 'Không tìm thấy kết quả'))
    return
  }

  results.forEach((r, idx) => {
    const btn = el('button', 'search-result-item')
    btn.type = 'button'
    btn.setAttribute('role', 'option')
    btn.setAttribute('aria-selected', 'false')

    const meta = el('div', 'search-result-meta')
    const sender = el('span', 'search-result-sender', r.from === 'user' ? 'Bạn' : '@' + r.from)
    const time = el('span', 'search-result-time', when(r.at))
    meta.append(sender, time)
    btn.append(meta)

    const excerptEl = el('div', 'search-result-excerpt')
    const text = r.excerpt || ''
    const matches = (r.matches || []).sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [mStart, mEnd] of matches) {
      if (mStart > cursor) {
        excerptEl.append(document.createTextNode(text.slice(cursor, mStart)))
      }
      const mark = el('mark', '', text.slice(mStart, mEnd))
      excerptEl.append(mark)
      cursor = Math.max(cursor, mEnd)
    }
    if (cursor < text.length) {
      excerptEl.append(document.createTextNode(text.slice(cursor)))
    }
    btn.append(excerptEl)

    btn.onclick = () => jumpToMessage(r.seq)
    btn.onmouseenter = () => selectSearchResultIndex(idx)
    resEl.append(btn)
  })
}

function selectSearchResultIndex(idx) {
  const items = $('#search-results').querySelectorAll('.search-result-item')
  items.forEach((it, i) => {
    it.classList.toggle('selected', i === idx)
    it.setAttribute('aria-selected', i === idx ? 'true' : 'false')
  })
  searchSelectedIndex = idx
  if (idx >= 0 && items[idx]) {
    items[idx].scrollIntoView({ block: 'nearest' })
  }
}

async function jumpToMessage(seq) {
  closeSearchResults()
  if (seq == null) return

  let target = document.querySelector(`[data-seq="${seq}"]`)
  if (!target) {
    const reqDir = dir, reqSeq = openSeq
    const res = await api.logPage(reqDir, { around: seq, limit: 100 }).catch(() => null)
    if (!sameOpen(reqDir, reqSeq)) return
    if (res?.ok) {
      renderLoadedPage(res.page, 'replace')
      target = document.querySelector(`[data-seq="${seq}"]`)
    }
  }

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.remove('highlight-flash')
    void target.offsetWidth
    target.classList.add('highlight-flash')
    setTimeout(() => target.classList.remove('highlight-flash'), 2000)
  } else {
    showToast(`Không tìm thấy tin vị trí ${seq} trong cửa sổ`)
  }
}

$('#search-input').oninput = handleSearchInput
$('#search-sender').onchange = () => executeSearch()
$('#search-clear').onclick = () => {
  $('#search-input').value = ''
  closeSearchResults()
  $('#search-clear').hidden = true
  $('#search-input').focus()
}

$('#search-input').onkeydown = e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (searchResultsData.length > 0) {
      const nextIdx = (searchSelectedIndex + 1) % searchResultsData.length
      selectSearchResultIndex(nextIdx)
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (searchResultsData.length > 0) {
      const prevIdx = (searchSelectedIndex - 1 + searchResultsData.length) % searchResultsData.length
      selectSearchResultIndex(prevIdx)
    }
  } else if (e.key === 'Enter') {
    if (searchSelectedIndex >= 0 && searchResultsData[searchSelectedIndex]) {
      e.preventDefault()
      jumpToMessage(searchResultsData[searchSelectedIndex].seq)
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeSearchResults()
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('#search-wrap')) {
    closeSearchResults()
  }
})

// --- Sprint 6: Worktree & Merge Queue UI ---
const MERGE_STATE_LABELS = {
  'queued': 'Chờ merge',
  'merging': 'Đang merge…',
  'checking': 'Đang chạy check…',
  'publishing': 'Đang cập nhật…',
  'merged': 'Đã gộp',
  'blocked-dirty': 'Thư mục chính có thay đổi',
  'blocked-config': 'Lỗi cấu hình',
  'needs-deps': 'Cần cài dependencies',
  'conflict': 'Xung đột merge',
  'check-failed': 'Check thất bại',
  'paused': 'Tạm dừng',
  'error': 'Lỗi'
}

async function loadWorktreeState(targetDir = dir) {
  if (!targetDir) return
  const thisSeq = openSeq
  try {
    const res = await api.worktreeState(targetDir)
    if (res && res.ok && targetDir === dir && thisSeq === openSeq) {
      worktreeState = res.state
      renderWorktreeUI()
    }
  } catch (_) {}
}

function renderWorktreeUI() {
  const sec = $('#merge-sec')
  if (!worktreeState || !worktreeState.enabled) {
    sec.hidden = true
    return
  }
  sec.hidden = false
  renderMergeQueue(worktreeState.queue || [])
  if (currentPopoverAgent) {
    const agent = team.find(a => a.name === currentPopoverAgent)
    if (agent) updateMemberPopoverContent(agent)
  }
}

async function runMergeAction(action, queueId, button, successMessage = '') {
  const targetDir = dir, thisSeq = openSeq
  button.disabled = true
  try {
    const res = await api[action](targetDir, { queueId })
    if (targetDir !== dir || thisSeq !== openSeq) return
    if (!res?.ok) throw new Error(res?.error?.message || 'Không thực hiện được thao tác gộp')
    if (successMessage) showToast(successMessage)
    await loadWorktreeState(targetDir)
  } catch (e) {
    if (targetDir === dir && thisSeq === openSeq) showToast(e.message.replace(/^.*?Error: /, ''))
  } finally {
    button.disabled = false
  }
}

function renderMergeQueue(queue) {
  queue = queue.filter(item => item.state !== 'merged')
  const listEl = $('#merge-queue')
  const emptyEl = $('#merge-empty')
  const countEl = $('#merge-count')

  countEl.textContent = queue.length
  if (queue.length === 0) {
    listEl.replaceChildren()
    emptyEl.hidden = false
    return
  }
  emptyEl.hidden = true

  listEl.replaceChildren(...queue.map(item => {
    const card = el('div', 'merge-card')
    const hdr = el('div', 'merge-card-hdr')

    const agentWrap = el('div', 'merge-card-agent')
    agentWrap.append(avatar(item.agent, 'sq'), el('span', '', `@${item.agent}`))
    if (item.headSha) {
      agentWrap.append(el('span', 'merge-card-sha', item.headSha.slice(0, 7)))
    }

    const stClass = item.state === 'merged' ? 'merge-state-merged' :
                   item.state.startsWith('blocked') || item.state === 'conflict' || item.state === 'check-failed' || item.state === 'error' ? 'merge-state-error' :
                   item.state === 'queued' ? 'merge-state-queued' : 'merge-state-running'
    const stBadge = el('span', 'merge-state-badge ' + stClass, item.label || MERGE_STATE_LABELS[item.state] || item.state)
    hdr.append(agentWrap, stBadge)
    card.append(hdr)

    if (item.error) {
      const errDiv = el('div', 'merge-card-err')
      errDiv.append(el('span', '', item.error.message || 'Lỗi merge'))
      if (item.error.files && item.error.files.length > 0) {
        const filesDiv = el('div', '', 'File xung đột: ')
        item.error.files.forEach((f, idx) => {
          if (idx > 0) filesDiv.append(', ')
          filesDiv.append(el('code', '', f))
        })
        errDiv.append(filesDiv)
      }
      if (item.error.log) {
        const pre = el('pre', 'merge-err-log', item.error.log.slice(0, 300))
        errDiv.append(pre)
      }
      card.append(errDiv)
    }

    const actions = el('div', 'merge-card-actions')
    if (item.canRetry) {
      const retryBtn = el('button', 'box press btn sm', 'Thử gộp lại')
      retryBtn.type = 'button'
      retryBtn.onclick = () => runMergeAction('retryMerge', item.id, retryBtn)
      actions.append(retryBtn)
    }

    if (item.canRepair) {
      const repairBtn = el('button', 'box press btn sm primary', 'Gọi agent sửa')
      repairBtn.type = 'button'
      repairBtn.onclick = () => runMergeAction('requestMergeRepair', item.id, repairBtn, `Đã yêu cầu @${item.agent} sửa xung đột`)
      actions.append(repairBtn)
    }

    if (item.canStop) {
      const stopBtn = el('button', 'btn-stop box press', 'Dừng')
      stopBtn.type = 'button'
      stopBtn.onclick = () => runMergeAction('stopMerge', item.id, stopBtn)
      actions.append(stopBtn)
    }

    if (actions.children.length > 0) card.append(actions)
    return card
  }))
}

function resizeInput() {
  const inp = $('#input')
  const main = $('main')
  const maxH = Math.max(44, Math.floor(main.clientHeight / 4))
  inp.style.height = 'auto'
  const scrollH = inp.scrollHeight
  if (scrollH > maxH) {
    inp.style.height = maxH + 'px'
    inp.style.overflowY = 'auto'
  } else {
    inp.style.height = Math.max(44, scrollH) + 'px'
    inp.style.overflowY = 'hidden'
  }
}

let mentionState = {
  open: false,
  tokenStart: -1,
  tokenEnd: -1,
  matches: [],
  index: 0
}
let isComposing = false

function getMentionContext() {
  const inp = $('#input')
  if (isComposing || !dir || team.length === 0) return null
  const val = inp.value
  const start = inp.selectionStart
  const end = inp.selectionEnd
  if (start !== end) return null

  let atIdx = -1
  for (let i = start - 1; i >= 0; i--) {
    const ch = val[i]
    if (ch === '@') {
      atIdx = i
      break
    }
    if (!/[A-Za-z0-9_-]/.test(ch)) {
      break
    }
  }
  if (atIdx === -1) return null

  if (atIdx > 0) {
    const prev = val[atIdx - 1]
    if (!/[\s(]/.test(prev)) return null
  }

  let endIdx = start
  while (endIdx < val.length && /[A-Za-z0-9_-]/.test(val[endIdx])) {
    endIdx++
  }

  const query = val.substring(atIdx + 1, start)
  return {
    tokenStart: atIdx,
    tokenEnd: endIdx,
    query
  }
}

function renderMentionPopup() {
  const popup = $('#mention-popup')
  const inp = $('#input')
  if (!mentionState.open) {
    popup.hidden = true
    popup.replaceChildren()
    inp.setAttribute('aria-expanded', 'false')
    inp.removeAttribute('aria-activedescendant')
    return
  }

  popup.hidden = false
  inp.setAttribute('aria-expanded', 'true')
  popup.replaceChildren()

  if (mentionState.matches.length === 0) {
    const empty = el('div', 'mention-empty', 'Không có thành viên phù hợp')
    popup.append(empty)
    inp.removeAttribute('aria-activedescendant')
    return
  }

  mentionState.matches.forEach((agent, i) => {
    const optId = `mention-opt-${i}`
    const isSelected = i === mentionState.index
    const item = el('button', 'mention-item' + (isSelected ? ' selected' : ''))
    item.type = 'button'
    item.id = optId
    item.setAttribute('role', 'option')
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false')
    item.append(avatar(agent.name), el('span', '', `@${agent.name}`))
    if (agent.role) {
      const r = el('small', '', agent.role.slice(0, 30))
      r.style.color = 'var(--muted)'
      item.append(r)
    }

    item.onmousedown = (e) => {
      e.preventDefault()
    }
    item.onclick = (e) => {
      e.preventDefault()
      applyMentionSelect(agent)
    }
    popup.append(item)

    if (isSelected) {
      inp.setAttribute('aria-activedescendant', optId)
      item.scrollIntoView({ block: 'nearest' })
    }
  })
}

function closeMentionPopup() {
  mentionState.open = false
  mentionState.tokenStart = -1
  mentionState.tokenEnd = -1
  mentionState.matches = []
  mentionState.index = 0
  renderMentionPopup()
}

function updateMentionPopup() {
  const ctx = getMentionContext()
  if (!ctx) {
    if (mentionState.open) closeMentionPopup()
    return
  }
  const q = ctx.query.toLowerCase()
  const matches = team.filter(a => a.name.toLowerCase().startsWith(q))
  mentionState.open = true
  mentionState.tokenStart = ctx.tokenStart
  mentionState.tokenEnd = ctx.tokenEnd
  mentionState.matches = matches
  if (mentionState.index >= matches.length) {
    mentionState.index = 0
  }
  renderMentionPopup()
}

function applyMentionSelect(agent) {
  const inp = $('#input')
  if (!agent) return
  const val = inp.value
  const { tokenStart, tokenEnd } = mentionState
  if (tokenStart < 0 || tokenEnd < tokenStart) return

  const hasSpaceAfter = val[tokenEnd] === ' '
  const replaceEnd = hasSpaceAfter ? tokenEnd + 1 : tokenEnd
  const insertText = `@${agent.name} `

  inp.setRangeText(insertText, tokenStart, replaceEnd, 'end')
  closeMentionPopup()
  inp.focus()
  resizeInput()
}

function insertMentionAtCursor(name) {
  const inp = $('#input')
  const ctx = getMentionContext()
  const val = inp.value
  const insertText = `@${name} `
  if (ctx) {
    const hasSpaceAfter = val[ctx.tokenEnd] === ' '
    const replaceEnd = hasSpaceAfter ? ctx.tokenEnd + 1 : ctx.tokenEnd
    inp.setRangeText(insertText, ctx.tokenStart, replaceEnd, 'end')
  } else {
    const start = inp.selectionStart ?? val.length
    const end = inp.selectionEnd ?? val.length
    const needsPrefixSpace = start > 0 && !/\s/.test(val[start - 1])
    const toInsert = (needsPrefixSpace ? ' ' : '') + insertText
    inp.setRangeText(toInsert, start, end, 'end')
  }
  closeMentionPopup()
  inp.focus()
  resizeInput()
}

async function stopAgent(name, runId) {
  if (!dir) return
  const key = runKey(dir, name)
  const run = activeRuns.get(key)
  if (!run || run.runId !== runId) return
  run.stopping = true
  patchRun(run)
  // not accepted = the run already ended; its status/progress events update the UI either way
  try {
    await api.stop(dir, name, runId)
  } catch (err) {
    run.stopping = false
    patchRun(run)
    showToast(err.message.replace(/^.*?Error: /, ''))
  }
}

function renderOrphanLocks() {
  withPreservedScroll(() => {
    const banner = $('#orphan-banner')
    if (!dir || orphanLocks.length === 0) {
      banner.hidden = true
      banner.replaceChildren()
      return
    }
    banner.hidden = false
    banner.replaceChildren()
    const list = el('div')
    orphanLocks.forEach(lock => {
      const row = el('div')
      const stateText = lock.state === 'alive' ? 'tiến trình còn chạy' : 'chưa xác minh'
      row.textContent = `Agent @${lock.name} đang giữ khóa từ phiên trước (${stateText}).`
      list.append(row)
    })
    banner.append(list)

    const unknownLocks = orphanLocks.filter(l => l.state === 'unknown')
    if (unknownLocks.length > 0) {
      const btn = el('button', 'btn-stop box press', 'Giải phóng khóa chưa xác minh')
      btn.type = 'button'
      btn.onclick = async () => {
        for (const l of unknownLocks) {
          try {
            const res = await api.releaseLock(dir, l.runId)
            if (!res?.released) {
              showToast(`Không thể giải phóng khóa của @${l.name}`)
            }
          } catch (err) {
            showToast(err.message.replace(/^.*?Error: /, ''))
          }
        }
      }
      banner.append(btn)
    }
  })
}

let currentPopoverAgent = null
let popoverCloseTimer = null

function scheduleCloseMemberPopover() {
  clearTimeout(popoverCloseTimer)
  popoverCloseTimer = setTimeout(() => {
    closeMemberPopover()
  }, 150)
}

function cancelCloseMemberPopover() {
  clearTimeout(popoverCloseTimer)
}

function closeMemberPopover() {
  cancelCloseMemberPopover()
  const pop = $('#member-popover')
  if (pop.hidden) return
  pop.hidden = true
  if (currentPopoverAgent) {
    const btn = document.querySelector(`.stack-btn[data-agent="${CSS.escape(currentPopoverAgent)}"]`)
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }
  currentPopoverAgent = null
}

function openMemberPopover(agentName, anchorEl) {
  cancelCloseMemberPopover()
  const agent = team.find(a => a.name === agentName)
  if (!agent) return
  currentPopoverAgent = agentName

  document.querySelectorAll('.stack-btn').forEach(btn => {
    btn.setAttribute('aria-expanded', btn.dataset.agent === agentName ? 'true' : 'false')
  })

  const pop = $('#member-popover')
  pop.hidden = false
  updateMemberPopoverContent(agent)

  if (dir) {
    const reqDir = dir, reqSeq = openSeq
    api.sessions(reqDir).then(s => {
      if (dir === reqDir && openSeq === reqSeq && s) {
        sess = s
        if (currentPopoverAgent === agentName) {
          const ag = team.find(a => a.name === agentName)
          if (ag) updateMemberPopoverContent(ag)
        }
      }
    }).catch(() => {})
  }
}

function updateMemberPopoverContent(agent) {
  const pop = $('#member-popover')
  if (pop.hidden) return

  const key = runKey(dir, agent.name)
  const run = activeRuns.get(key)

  pop.replaceChildren()

  const hdr = el('div', 'mp-hdr')
  const av = avatar(agent)
  const nw = el('div', 'mp-name-wrap')
  nw.append(el('b', '', '@' + agent.name))
  const cliParts = [agent.cli, agent.model || 'Mặc định', agent.effort || 'Mặc định'].filter(Boolean).join(' · ')
  nw.append(el('small', '', cliParts))
  hdr.append(av, nw)
  pop.append(hdr)

  if (agent.role) {
    pop.append(el('div', 'mp-role', agent.role))
  }

  const sc = el('div', 'mp-scope')
  sc.append(el('b', '', 'Phạm vi: '))
  if (agent.readOnly) {
    const ro = el('span', '', ' [Chỉ đọc]')
    ro.style.fontWeight = '700'
    sc.append(ro)
  }
  if (agent.owns && (Array.isArray(agent.owns) ? agent.owns.length > 0 : agent.owns)) {
    const ownsText = Array.isArray(agent.owns) ? agent.owns.join(', ') : agent.owns
    sc.append(' ', el('code', '', ownsText))
  } else if (!agent.readOnly) {
    sc.append(' Toàn dự án')
  }
  pop.append(sc)

  const wtAgent = worktreeState?.agents?.find(x => x.name === agent.name)
  if (wtAgent) {
    const wtDiv = el('div', 'mp-worktree')
    wtDiv.append(el('b', '', 'Nhánh git: '), el('code', '', wtAgent.branch))
    if (wtAgent.ahead > 0) {
      wtDiv.append(el('span', 'mp-ahead', ` (${wtAgent.ahead} commit chưa gộp)`))
    }
    pop.append(wtDiv)
  }

  if (agent.scopeNeedsReview) {
    const warn = el('div', 'task-error-banner', '⚠️ Cần xác nhận phạm vi trong Cài đặt')
    pop.append(warn)
  }

  const sRecord = sess[agent.name]
  const s = (sRecord && sRecord.cli && sRecord.cli !== agent.cli) ? null : sRecord
  const lastTurn = s?.lastTurn
  const rawTokens = lastTurn?.inputTokens
  const hasTokens = typeof rawTokens === 'number'
  const limit = s?.sessionTokenLimit != null ? s.sessionTokenLimit : (agent.sessionTokenLimit != null ? Number(agent.sessionTokenLimit) : 150000)
  const isPending = (s?.rotationPending != null) ? !!s.rotationPending : (
    agent.resume !== false &&
    !!s?.id &&
    limit > 0 &&
    hasTokens &&
    rawTokens > limit
  )

  let sessionText = ''
  if (agent.resume === false) {
    sessionText = (hasTokens ? `${rawTokens.toLocaleString('vi-VN')} · ` : '') + 'Không nhớ phiên'
  } else if (!hasTokens) {
    sessionText = 'Chưa có số đo' + (limit === 0 ? ' · Tự xoay: tắt' : '')
  } else if (limit === 0) {
    sessionText = `${rawTokens.toLocaleString('vi-VN')} · Tự xoay: tắt`
  } else {
    sessionText = `${rawTokens.toLocaleString('vi-VN')} / ${limit.toLocaleString('vi-VN')}`
    if (isPending) {
      sessionText += ' · Sẽ mở phiên mới ở lượt kế tiếp'
    }
  }

  const sessDiv = el('div', 'mp-status')
  sessDiv.textContent = `Token vào lượt gần nhất: ${sessionText}`
  sessDiv.title = 'Số token vào CLI báo cho lượt gần nhất, có thể gồm nhiều bước gọi model.' + (lastTurn?.partial ? ' (Chưa đủ dữ liệu)' : '')
  pop.append(sessDiv)

  pop.append(el('div', 'mp-status mp-run', memberStatusText(run)))

  const actions = el('div', 'mp-actions')
  const mentionBtn = el('button', 'box press btn sm primary', '@ Gọi')
  mentionBtn.type = 'button'
  mentionBtn.onclick = () => {
    closeMemberPopover()
    insertMentionAtCursor(agent.name)
  }
  actions.append(mentionBtn)

  if (run) {
    const stopBtn = el('button', 'btn-stop box press')
    stopBtn.type = 'button'
    setStopButton(stopBtn, run)
    stopBtn.onclick = () => stopAgent(agent.name, run.runId)
    actions.append(stopBtn)
  }
  pop.append(actions)
}

function memberStatusText(run) {
  if (!run) return 'Trạng thái: Rảnh (sẵn sàng)'
  if (run.stopping) return 'Trạng thái: Đang dừng…'
  if (run.phase === 'queued') {
    return run.blockedBy && run.blockedBy.length > 0
      ? `Trạng thái: Chờ @${run.blockedBy[0].name} (${run.blockedBy[0].path})`
      : `Trạng thái: Đang xếp hàng… (${run.label})`
  }
  if (run.phase === 'checking') return 'Trạng thái: Đang kiểm tra file…'
  return `Trạng thái: ${run.label || 'Đang làm…'}`
}

function typingText(run) {
  let statusText = run.label || 'đang làm…'
  if (run.stopping) {
    statusText = 'đang dừng…'
  } else if (run.phase === 'queued') {
    if (run.blockedBy && run.blockedBy.length > 0) {
      statusText = `chờ ${run.blockedBy[0].name} (${run.blockedBy[0].path})`
    } else {
      statusText = run.label || 'đang xếp hàng…'
    }
  } else if (run.phase === 'checking') {
    statusText = 'đang kiểm tra file…'
  }
  const chainTxt = run.chain ? `lượt ${run.chain.turns} (tối đa ${run.chain.limit}) · ` : '' // agent turns since your last message
  return `@${run.name} · ${chainTxt}${statusText}`
}

const QUIET_MS = 120e3
const clock = ms => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// time since the turn started (same clock as its timeout); then "im lặng" once no new step came for 2+ minutes, else
// time left judged by the median of this agent's recent turns (3+ of them)
function setRunTime(row, run) {
  const now = Date.now(), quiet = now - run.activeAt, elapsed = now - run.startedAt, t = row.querySelector('.typing-time')
  const times = turnTimes.get(run.name), typical = times?.length >= 3 ? [...times].sort((a, b) => a - b)[times.length >> 1] : null
  t.textContent = clock(elapsed) + (quiet >= QUIET_MS ? ` · im lặng ${Math.floor(quiet / 60e3)} phút`
    : typical == null ? '' : typical > elapsed ? ` · còn ~${Math.max(1, Math.round((typical - elapsed) / 60e3))} phút` : ' · lâu hơn thường lệ')
  t.classList.toggle('quiet', quiet >= QUIET_MS)
}

function setStopButton(btn, run) {
  btn.textContent = run.stopping ? 'Đang dừng…' : 'Dừng'
  btn.disabled = run.stopping
}

// progress only changes a run's texts: patch them in place, so a click on "Dừng" never lands on a node being replaced
function patchRun(run) {
  const row = [...$('#typing').children].find(r => r.dataset.runId === run.runId)
  if (!row) return renderActiveUI()
  row.querySelector('.typing-label').textContent = typingText(run)
  setRunTime(row, run)
  setStopButton(row.querySelector('.btn-stop'), run)
  if (currentPopoverAgent !== run.name) return
  const pop = $('#member-popover')
  pop.querySelector('.mp-run').textContent = memberStatusText(run)
  const stop = pop.querySelector('.btn-stop')
  if (stop) setStopButton(stop, run)
}

function renderActiveUI() {
  withPreservedScroll(() => {
    document.querySelectorAll('.stack-btn').forEach(btn => {
      const name = btn.dataset.agent
      if (!name || !dir) return
      const isBusy = !!activeRuns.get(runKey(dir, name))
      btn.classList.toggle('busy', isBusy)
    })

    updateGrantButtonsState()

    if (currentPopoverAgent) {
      const agent = team.find(a => a.name === currentPopoverAgent)
      if (agent) updateMemberPopoverContent(agent)
    }

    if (!dir) {
      $('#typing').replaceChildren()
      return
    }
    const seen = new Set()
    const currentRuns = []
    for (const a of team) {
      const r = activeRuns.get(runKey(dir, a.name))
      if (r) { currentRuns.push(r); seen.add(r.runId) }
    }
    for (const [k, r] of activeRuns.entries()) {
      if (k.startsWith(dir + '\0') && !seen.has(r.runId)) {
        currentRuns.push(r)
      }
    }

    $('#typing').replaceChildren(...currentRuns.map(run => {
      const row = el('div', 'typing-row')
      row.dataset.runId = run.runId
      const lead = el('div', 'typing-lead')
      const pulse = el('i')
      pulse.style.setProperty('--agent', getAgentAvatar(run.name)?.color || '#a1a1aa')
      const label = el('span', 'typing-label', typingText(run))
      if (run.chain) label.title = 'Lượt: số lượt agent nối tiếp nhau kể từ tin gần nhất của bạn. Tới tối đa, chuỗi tạm dừng chờ bạn bấm Tiếp tục'
      lead.append(pulse, label)

      const time = el('span', 'typing-time')
      const limit = team.find(a => a.name === run.name)?.timeoutMinutes ?? 30
      time.title = `Chạy từ ${hhmm(run.startedAt)} · tự dừng khi quá ${limit} phút\n"còn ~": ước lượng theo trung vị các lượt gần đây của @${run.name}\n"im lặng": chưa có bước mới, agent có thể vẫn đang suy nghĩ hoặc chạy lệnh dài`

      const stopBtn = el('button', 'btn-stop box press')
      stopBtn.type = 'button'
      stopBtn.setAttribute('aria-label', `Dừng ${run.name}`)
      setStopButton(stopBtn, run)
      stopBtn.onclick = () => stopAgent(run.name, run.runId)

      row.append(lead, time, stopBtn)
      setRunTime(row, run)
      return row
    }))
  })
}

function renderTeam() {
  closeMemberPopover()
  $('#stack').replaceChildren(...team.map(a => {
    const key = runKey(dir, a.name)
    const isBusy = !!activeRuns.get(key)
    const btn = el('button', 'stack-btn press' + (isBusy ? ' busy' : ''))
    btn.type = 'button'
    btn.dataset.agent = a.name
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-controls', 'member-popover')
    btn.dataset.agentAvatar = a.name
    paintAvatar(btn, a.name, getAgentAvatar(a)?.color)

    btn.onmouseenter = () => openMemberPopover(a.name, btn)
    btn.onmouseleave = () => scheduleCloseMemberPopover()
    btn.onfocus = () => openMemberPopover(a.name, btn)
    btn.onblur = () => scheduleCloseMemberPopover()
    btn.onclick = (e) => {
      e.stopPropagation()
      if (currentPopoverAgent === a.name) {
        closeMemberPopover()
      } else {
        openMemberPopover(a.name, btn)
      }
    }
    return btn
  }))
  renderActiveUI()
}

const STATUS_MAP = {
  doing: 'Đang chạy',
  review: 'Chờ duyệt',
  todo: 'Cần làm',
  done: 'Xong'
}
let currentTasks = []
let taskGen = 0
const groupOpenStates = new Map()

async function loadTasks() {
  if (!dir) {
    currentTasks = []
    renderBoard()
    return
  }
  const reqDir = dir
  const thisGen = ++taskGen
  try {
    const board = await api.tasks(reqDir)
    if (thisGen !== taskGen || dir !== reqDir) return
    currentTasks = board.tasks || []
    renderBoard(board.error)
  } catch (e) {
    if (thisGen !== taskGen || dir !== reqDir) return
    renderBoard({ code: 'IO_ERROR', message: e.message.replace(/^.*?Error: /, '') })
  }
}

function renderBoard(error = null) {
  const errBanner = $('#task-error')
  if (error) {
    errBanner.textContent = `Lỗi dữ liệu task: ${error.message || error.code}`
    errBanner.hidden = false
  } else {
    errBanner.hidden = true
    errBanner.textContent = ''
  }

  const emptyEl = $('#tasks-empty')
  const treeEl = $('#tasks-tree')
  const done = currentTasks.filter(t => t.status === 'done').length
  $('#tasks-count').textContent = currentTasks.length ? `${done}/${currentTasks.length}` : ''
  $('#tasks-bar').style.width = `${currentTasks.length ? done / currentTasks.length * 100 : 0}%`
  $('#tasks-bar').parentElement.hidden = !currentTasks.length

  if (!dir || (!error && currentTasks.length === 0)) {
    emptyEl.hidden = false
    treeEl.replaceChildren()
    return
  }

  emptyEl.hidden = true

  // grouped by status, in the order that needs attention; "Xong" starts collapsed
  const numId = id => parseInt(id.replace(/\D/g, ''), 10) || 0
  treeEl.replaceChildren(...Object.entries(STATUS_MAP).flatMap(([status, label]) => {
    const tasks = currentTasks.filter(t => t.status === status).sort((a, b) => numId(a.id) - numId(b.id))
    if (!tasks.length) return []
    const details = el('details', 'task-group')
    details.open = groupOpenStates.get(status) ?? status !== 'done'
    details.ontoggle = () => groupOpenStates.set(status, details.open)
    const itemsDiv = el('div', 'task-group-items')
    itemsDiv.append(...tasks.map(renderTreeTaskRow))
    details.append(el('summary', 'task-group-sum', `${label} · ${tasks.length}`), itemsDiv)
    return [details]
  }))
}

function renderTreeTaskRow(task) {
  const isDone = task.status === 'done'
  const hasSpec = !!task.spec
  const row = el('div', 'tree-task-row' + (isDone ? ' done' : '') + (hasSpec ? ' has-spec' : ''))
  row.dataset.taskId = task.id

  const iconEl = el('span', 'tree-task-icon')
  iconEl.dataset.status = task.status
  iconEl.style.setProperty('--agent', getAgentAvatar(task.assignee)?.color || '#a1a1aa')
  iconEl.title = STATUS_MAP[task.status] || task.status
  row.append(iconEl)

  const idEl = el('span', 'tree-task-id', task.id)
  row.append(idEl)

  const titleEl = el('span', 'tree-task-title', task.title)
  titleEl.title = task.title
  row.append(titleEl)

  const assigneeEl = el('span', 'tree-task-assignee', '@' + task.assignee)
  row.append(assigneeEl)

  if (hasSpec) {
    row.tabIndex = 0
    row.role = 'button'
    row.title = `Mở spec: ${task.spec}`
    row.onclick = (e) => {
      e.stopPropagation()
      openFileViewer(task.spec, null)
    }
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        openFileViewer(task.spec, null)
      }
    }
  }

  return row
}


// ---- "Cần bạn": what waits for the user — agents' @user asks, paused chains, CLI permission requests ----
let needs = []
const NEED_LINE = /@user(?![\w-])/i
const needTitle = m => m.kind === 'chain-stop' ? 'Chuỗi agent tạm dừng, chờ bạn'
  : m.kind === 'permission-denied' ? `@${m.agent} bị CLI từ chối quyền`
    : m.from !== 'user' && m.from !== 'system' && NEED_LINE.test(m.text || '') ? `@${m.from} cần bạn` : null

async function refreshNeeds() {
  if (!dir) return
  const reqDir = dir, reqSeq = openSeq
  const res = await api.needs(reqDir).catch(() => null)
  if (!sameOpen(reqDir, reqSeq) || !res?.ok) return
  needs = res.items
  renderNeeds()
}

// a system notification while the window is in the background; clicking it brings the message up
function notifyNeed(d, m, title) {
  if (document.hasFocus()) return
  const line = String(m.text || '').split('\n').find(text => NEED_LINE.test(text)) || m.text || ''
  const note = new Notification(title, { body: line.replace(/\s+/g, ' ').trim().slice(0, 140) })
  note.onclick = () => { window.focus(); if (d === dir) jumpToMessage(m.seq); else openProject(d) }
}

function markActiveBadge() {
  const on = document.querySelector('.space.on')
  if (on) setSpaceBadge(on, needs.length + permissionRequests.length)
}

// the reply goes to the agent that asked and quotes the ask: it may have asked several things
function replyAbout(item) {
  const quote = item.text.replace(/@user(?![\w-])/gi, '').replace(/\s+/g, ' ').trim()
  return `(về tin ${hhmm(item.at)}: "${quote.length > 60 ? quote.slice(0, 60) + '…' : quote}")`
}
function prefill(text) {
  const inp = $('#input')
  inp.value = text
  resizeInput()
  inp.focus()
  inp.setSelectionRange(text.length, text.length)
}
function needButton(label, onclick, cls = 'btn sm') {
  const b = el('button', 'box press ' + cls, label)
  b.type = 'button'
  b.onclick = onclick
  return b
}
async function needAction(button, call) {
  button.disabled = true
  try {
    const res = await call()
    if (res?.ok === false) throw new Error(res.error?.message || 'Không thực hiện được')
  } catch (err) {
    showToast(err.message.replace(/^.*?Error: /, ''))
    button.disabled = false
  }
}

function renderNeeds() {
  const perms = permissionRequests.map(request => ({ kind: 'perm', from: request.agent,
    text: (request.denials || []).map(x => x.label || x.tool).filter(Boolean).join(', ') || 'CLI từ chối quyền' }))
  const items = [...perms, ...needs]
  $('#needs-sec').hidden = !items.length
  $('#needs-count').textContent = items.length
  markActiveBadge()
  $('#needs').replaceChildren(...items.map(item => {
    const card = el('div', 'need')
    const head = el('div', 'need-head')
    head.append(item.kind === 'chain' ? el('span', 'sq', '‖') : avatar(item.from, 'sq'),
      el('b', '', item.kind === 'chain' ? 'Chuỗi tạm dừng' : item.kind === 'perm' ? `@${item.from} cần quyền` : `@${item.from}`))
    if (item.at) head.append(el('time', '', hhmm(item.at)))
    if (item.kind !== 'perm') { // a permission request leaves once granted or dropped
      const hide = needButton('✕', () => needAction(hide, async () => {
        const res = await api.dismissNeed(dir, `${item.seq}:${item.at}`)
        if (res.ok) { needs = res.items; renderNeeds() }
        return res
      }), 'need-x')
      hide.title = 'Đã xem, ẩn khỏi danh sách'
      hide.setAttribute('aria-label', 'Ẩn mục này')
      head.append(hide)
    }
    const text = el('button', 'need-text', item.text)
    text.type = 'button'
    text.title = item.kind === 'perm' ? 'Mở mục Quyền' : 'Xem trong cuộc trò chuyện'
    text.onclick = () => item.kind === 'perm' ? openSettingsForAgent(item.from) : jumpToMessage(item.seq)
    const actions = el('div', 'need-actions')
    if (item.kind === 'ask') {
      const approve = needButton('Duyệt', () => needAction(approve, () => api.send(dir, `@${item.from} Duyệt ${replyAbout(item)}`)), 'btn sm primary')
      actions.append(approve,
        needButton('Yêu cầu sửa', () => prefill(`@${item.from} Yêu cầu sửa ${replyAbout(item)}: `)),
        needButton('Từ chối', () => prefill(`@${item.from} Từ chối ${replyAbout(item)}: `)))
    } else if (item.kind === 'chain') {
      const resume = needButton('Tiếp tục', () => needAction(resume, () => api.continueChain(dir, { messageId: item.seq })), 'btn sm primary')
      actions.append(resume)
    } else actions.append(needButton('Mở mục Quyền', () => openSettingsForAgent(item.from)))
    card.append(head, text, actions)
    return card
  }))
}

// ---- timeline: which agent ran when and for how long; the log's finished turns plus the ones running now ----
const TL_RANGES = [['1 giờ', 3600e3], ['6 giờ', 6 * 3600e3], ['24 giờ', 86400e3], ['7 ngày', 7 * 86400e3]]
const TL_OUTCOME = { success: 'xong', error: 'lỗi', timeout: 'quá giờ', stopped: 'đã dừng', running: 'đang chạy' }
let tl = null, tlSpan = null, tlGen = 0

// ponytail: reads back 7 days at most; add paging by range if older history matters
async function openTimeline() {
  const reqDir = dir, gen = ++tlGen, now = Date.now()
  if (!$('#timeline').open) $('#timeline').showModal()
  $('#timeline-body').replaceChildren(el('div', 'none', 'Đang tải…'))
  const res = await api.timeline(reqDir, now - TL_RANGES.at(-1)[1]).catch(err => ({ ok: false, error: { message: err.message } }))
  if (gen !== tlGen || dir !== reqDir) return
  if (!res.ok) return $('#timeline-body').replaceChildren(el('div', 'viewer-error', res.error?.message || 'Không đọc được lịch sử'))
  tl = { runs: res.runs, now }
  // opens on the shortest range that reaches the latest turn
  tlSpan = TL_RANGES.find(([, ms]) => res.last != null && now - res.last <= ms)?.[1] ?? TL_RANGES.at(-1)[1]
  renderTimeline()
}

const roughDuration = ms => ms < 60e3 ? `${Math.round(ms / 1e3)} giây` : ms < 3600e3 ? `${Math.round(ms / 60e3)} phút`
  : `${(ms / 3600e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`

function renderTimeline() {
  const { now } = tl, span = tlSpan, from = now - span, at = t => span > 86400e3 ? when(t) : hhmm(t)
  const running = [...activeRuns.entries()].filter(([key, r]) => key.startsWith(dir + '\0') && r.startedAt)
    .map(([, r]) => ({ agent: r.name, start: r.startedAt, end: now, outcome: 'running' }))
  const runs = [...tl.runs, ...running].filter(r => r.end >= from)
  const names = [...new Set([...team.map(a => a.name), ...runs.map(r => r.agent)])]
  const pct = t => `${(t - from) / span * 100}%`

  for (const b of $('#timeline-range').children) b.classList.toggle('on', +b.dataset.span === span)
  $('#timeline-sub').textContent = `${runs.length} lượt · ${at(from)} → bây giờ`

  // gridlines on local-time boundaries, at most 8 of them
  const step = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(m => m * 60e3).find(ms => span / ms <= 8)
  const zone = new Date().getTimezoneOffset() * 60e3, ticks = []
  for (let t = Math.ceil((from - zone) / step) * step + zone; t < now; t += step) ticks.push(t)
  const lines = () => ticks.map(t => { const line = el('i', 'tl-line'); line.style.left = pct(t); return line })

  const axis = el('div', 'tl-row tl-axis'), scale = el('div', 'tl-lane')
  scale.append(...ticks.map(t => { const tick = el('span', 'tl-tick', step >= 86400e3 ? when(t).split(' ')[0] : hhmm(t)); tick.style.left = pct(t); return tick }))
  axis.append(el('div'), scale)

  const rows = names.map(name => {
    const mine = runs.filter(r => r.agent === name)
    const busy = mine.reduce((n, r) => n + r.end - Math.max(r.start, from), 0)
    const row = el('div', 'tl-row'), who = el('div', 'tl-who'), lane = el('div', 'tl-lane')
    const label = el('div')
    label.append(el('b', '', '@' + name), el('small', '', mine.length ? `${mine.length} lượt · ${roughDuration(busy)}` : 'rảnh'))
    who.append(avatar(name, 'sq'), label)
    lane.style.setProperty('--agent', getAgentAvatar(name)?.color || '#a1a1aa')
    lane.append(...lines(), ...mine.map(r => {
      const start = Math.max(r.start, from), bar = el(r.seq != null ? 'button' : 'span', 'tl-bar ' + r.outcome)
      bar.style.left = pct(start)
      bar.style.width = `${(r.end - start) / span * 100}%`
      bar.title = `@${name} · ${at(r.start)}–${r.outcome === 'running' ? 'bây giờ' : hhmm(r.end)} · ${roughDuration(r.end - r.start)} · ${TL_OUTCOME[r.outcome] || r.outcome}`
      if (r.seq != null) {
        bar.type = 'button'
        bar.onclick = () => { $('#timeline').close(); jumpToMessage(r.seq) }
      }
      return bar
    }))
    row.append(who, lane)
    return row
  })

  const legend = el('div', 'tl-legend')
  for (const [cls, label] of [['success', 'Xong (màu của agent)'], ['error', 'Lỗi'], ['stopped', 'Dừng / quá giờ'], ['running', 'Đang chạy']]) {
    const item = el('span'), swatch = el('i', 'tl-bar ' + cls)
    swatch.style.setProperty('--agent', '#a1a1aa')
    item.append(swatch, label)
    legend.append(item)
  }
  $('#timeline-body').replaceChildren(axis, ...rows, ...(runs.length ? [] : [el('div', 'none', 'Không có lượt nào trong khoảng này.')]), legend)
}

$('#timeline-btn').onclick = openTimeline
$('#timeline-close').onclick = () => $('#timeline').close()
$('#timeline-range').replaceChildren(...TL_RANGES.map(([label, ms]) => {
  const b = el('button', '', label)
  b.type = 'button'
  b.dataset.span = ms
  b.onclick = () => { if (tl) { tlSpan = ms; renderTimeline() } }
  return b
}))

let currentViewerPath = null
let currentViewerCanExternal = false
let currentViewerWorkspace = null
let viewerGen = 0
let lastFocusBeforeViewer = null

async function openFileViewer(href, fromFile = null, workspace = null) {
  if (!dir || !href) return
  const thisGen = ++viewerGen
  lastFocusBeforeViewer = document.activeElement
  currentViewerWorkspace = workspace

  const dialog = $('#viewer')
  const titleEl = $('#viewer-title')
  const pathEl = $('#viewer-path')
  const bodyEl = $('#viewer-body')
  const extBtn = $('#viewer-external')

  const branchLabel = workspace?.branch ? ` [Nhánh ${workspace.branch} · chưa gộp]` : ''
  titleEl.textContent = base(href) + branchLabel
  pathEl.textContent = href
  bodyEl.replaceChildren(el('div', 'none', 'Đang tải…'))
  extBtn.disabled = true

  if (!dialog.open) {
    dialog.showModal()
  }
  $('#viewer-close').focus()

  try {
    const res = await api.readProjectFile(dir, href, fromFile, workspace?.id)
    if (thisGen !== viewerGen) return

    if (res.ok) {
      const file = res.file
      currentViewerPath = file.path
      currentViewerCanExternal = !!file.canOpenExternal
      titleEl.textContent = (file.name || base(file.path)) + branchLabel
      pathEl.textContent = file.path
      extBtn.disabled = !file.canOpenExternal

      if (file.format === 'markdown') {
        const rendered = renderMarkdown(file.content, { dir, fromFile: file.path, workspace })
        bodyEl.replaceChildren(rendered)
      } else {
        const pre = el('pre', 'viewer-text')
        pre.textContent = file.content
        bodyEl.replaceChildren(pre)
      }

      api.watchProject(dir, file.path, workspace?.id).catch(() => {})
    } else {
      currentViewerPath = res.file?.path || href
      currentViewerCanExternal = !!res.file?.canOpenExternal
      titleEl.textContent = (res.file?.name || base(href)) + branchLabel
      pathEl.textContent = currentViewerPath
      extBtn.disabled = !currentViewerCanExternal
      const errDiv = el('div', 'viewer-error', res.message || 'Không thể đọc file')
      bodyEl.replaceChildren(errDiv)
    }
  } catch (e) {
    if (thisGen !== viewerGen) return
    currentViewerPath = href
    currentViewerCanExternal = false
    extBtn.disabled = true
    const errDiv = el('div', 'viewer-error', e.message.replace(/^.*?Error: /, ''))
    bodyEl.replaceChildren(errDiv)
  }
}

function closeViewer() {
  ++viewerGen
  const dialog = $('#viewer')
  if (dialog.open) dialog.close()
  currentViewerPath = null
  currentViewerCanExternal = false
  currentViewerWorkspace = null
  if (dir) api.watchProject(dir, null).catch(() => {})
  lastFocusBeforeViewer?.focus()
}

async function refreshFiles() {
  if (!dir) return
  const reqDir = dir
  try {
    const list = await api.files(reqDir)
    if (dir !== reqDir) return
    $('#files').replaceChildren(...list.map(f => {
      const b = el('button', 'frow')
      b.title = f
      b.append(fileIcon(), el('span', '', base(f)))
      b.onclick = () => openFileViewer(f, null)
      return b
    }))
  } catch {}
}

$('#new').onclick = async () => {
  try { const p = await api.pick(); if (p) openProject(p.dir, p.chat) }
  catch (err) { showToast(err.message.replace(/^.*?Error: /, '')) }
}
$('#form').onsubmit = e => {
  e.preventDefault()
  const text = $('#input').value.trim()
  if (!text || !dir) return
  $('#input').value = ''
  closeMentionPopup()
  resizeInput()
  // main posts routing errors into the chat itself; what lands here failed before posting, so give the text back
  api.send(dir, text).catch(err => {
    if (!$('#input').value) { $('#input').value = text; resizeInput() }
    showToast(err.message.replace(/^.*?Error: /, ''))
  })
  if (logHasAfter) $('#jump-latest').click() // the window doesn't show the end, where this message goes
  else $('#log').scrollTop = $('#log').scrollHeight
}

const inp = $('#input')
inp.onkeydown = e => {
  if (e.isComposing || isComposing || e.keyCode === 229) {
    return
  }

  if (mentionState.open) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (mentionState.matches.length > 0) {
        mentionState.index = (mentionState.index + 1) % mentionState.matches.length
        renderMentionPopup()
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (mentionState.matches.length > 0) {
        mentionState.index = (mentionState.index - 1 + mentionState.matches.length) % mentionState.matches.length
        renderMentionPopup()
      }
      return
    }
    if (e.key === 'Enter' || e.key === 'ArrowRight') {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        if (mentionState.matches.length > 0) {
          applyMentionSelect(mentionState.matches[mentionState.index])
        }
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMentionPopup()
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      closeMentionPopup()
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    $('#form').requestSubmit()
  }
}

inp.addEventListener('compositionstart', () => {
  isComposing = true
  closeMentionPopup()
})
inp.addEventListener('compositionend', () => {
  isComposing = false
  resizeInput()
  updateMentionPopup()
})
inp.addEventListener('input', () => {
  resizeInput()
  updateMentionPopup()
})
inp.addEventListener('click', () => {
  updateMentionPopup()
})
inp.addEventListener('keyup', e => {
  if (['ArrowLeft', 'Home', 'End'].includes(e.key)) updateMentionPopup()
})

document.addEventListener('click', e => {
  if (mentionState.open && !e.target.closest('#form')) {
    closeMentionPopup()
  }
})

new ResizeObserver(() => resizeInput()).observe($('main'))
// tick the run clocks in place (rows are never rebuilt for this, so a click on "Dừng" can't miss)
setInterval(() => {
  for (const row of $('#typing').children) {
    const run = [...activeRuns.values()].find(r => r.runId === row.dataset.runId)
    if (run) setRunTime(row, run)
  }
}, 1000)

$('#viewer-close').onclick = () => closeViewer()
$('#viewer-reload').onclick = () => {
  if (currentViewerPath) openFileViewer(currentViewerPath, null, currentViewerWorkspace)
}
$('#viewer-external').onclick = async () => {
  if (currentViewerPath && currentViewerCanExternal) {
    try {
      await api.openFile(dir, currentViewerPath, currentViewerWorkspace?.id)
    } catch (e) {
      showToast(e.message.replace(/^.*?Error: /, ''))
    }
  }
}
$('#viewer').onclose = () => {
  closeViewer()
}
$('#reloadTasks').onclick = () => loadTasks()

const popEl = $('#member-popover')
popEl.onmouseenter = () => cancelCloseMemberPopover()
popEl.onmouseleave = () => scheduleCloseMemberPopover()

window.addEventListener('focus', () => {
  if (dir) {
    loadTasks()
    refreshFiles()
    loadWorktreeState()
  }
})

// ⌘K: type to filter the spaces, ↑↓ and Enter to open one
let switcherPick = 0
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
function renderSwitcher() {
  const q = fold($('#switcher-input').value.trim())
  const hits = projectList.filter(p => fold(`${p.name} ${p.dir} ${p.chat}`).includes(q))
  switcherPick = Math.max(0, Math.min(switcherPick, hits.length - 1))
  $('#switcher-list').replaceChildren(...hits.map((p, i) => {
    const b = el('button', 'switcher-item' + (i === switcherPick ? ' on' : ''))
    b.type = 'button'
    b.setAttribute('role', 'option')
    b.append(el('span', '', p.name), el('small', '', tilde(p.chat === '.chat' ? p.dir : `${p.dir} · ${p.chat}`)))
    if (!(p.dir === dir && p.chat === box)) setSpaceBadge(b, p.needs)
    b.onclick = () => { $('#switcher').close(); openProject(p.dir, p.chat) }
    return b
  }))
  if (!hits.length) $('#switcher-list').append(el('div', 'none', 'Không có không gian phù hợp'))
  $('#switcher-list .on')?.scrollIntoView({ block: 'nearest' })
}
$('#switcher-input').oninput = () => { switcherPick = 0; renderSwitcher() }
$('#switcher-input').onkeydown = e => {
  const n = $('#switcher-list').querySelectorAll('.switcher-item').length
  if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    switcherPick = (switcherPick + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    renderSwitcher()
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    $('#switcher-list .on')?.click()
  }
}
$('#switcher').onclick = e => { if (e.target === $('#switcher')) $('#switcher').close() } // backdrop

// the app menu (main.js) owns these accelerators; a modal that's open keeps the keyboard
api.on('menu', action => {
  if (document.querySelector('dialog[open]:not(#switcher)')) return
  if (action === 'switch') {
    if ($('#switcher').open) return $('#switcher').close()
    $('#switcher-input').value = ''
    switcherPick = 0
    renderSwitcher()
    $('#switcher').showModal()
    loadProjects().then(() => $('#switcher').open && renderSwitcher()) // fresh badges
  } else if ($('#switcher').open) {
    return
  } else if (action === 'next-need') {
    const at = projectList.findIndex(p => p.dir === dir && p.chat === box)
    const next = [...projectList.slice(at + 1), ...projectList.slice(0, Math.max(at, 0))].find(p => p.needs)
    if (next) openProject(next.dir, next.chat)
    else showToast('Không box nào khác đang cần bạn')
  } else if (action === 'search' && !$('#search-wrap').hidden) {
    $('#search-input').focus()
    $('#search-input').select()
  } else if (action === 'settings' && !$('#gear').hidden) {
    $('#gear').click()
  } else if (action === 'timeline' && !$('#timeline-btn').hidden) {
    openTimeline()
  } else if (action === 'about') {
    $('#about-btn').click()
  }
})

// Giới thiệu: version and author in the sidebar foot; the dialog adds the changelog
let about = null
api.about().then(info => {
  about = info
  $('#foot-version').textContent = `v${info.version}`
  $('#foot-author').textContent = `Developed by ${info.author.replaceAll(' ', '\u00a0')}` // a narrow sidebar breaks after "by", never inside the name
  $('#about-btn').hidden = false
}).catch(() => {})
$('#about-btn').onclick = () => {
  if (!about) return
  $('#about-title').textContent = `Agent Chat ${about.version}`
  $('#about-sub').textContent = `Developed by ${about.author}`
  $('#about-body').replaceChildren(renderMarkdown(about.changelog || 'Chưa có danh sách thay đổi.'))
  $('#about').showModal()
}
$('#about-close').onclick = () => $('#about').close()

document.addEventListener('keydown', e => {
  // ⌘1…9 / Ctrl+1…9: the nth space in the sidebar
  if ((MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key) && !document.querySelector('dialog[open]')) {
    const space = document.querySelectorAll('#projects .space')[e.key - 1]
    if (space) { e.preventDefault(); space.click() }
    return
  }
  if (e.key === 'Escape') {
    if (currentPopoverAgent) {
      const targetAgent = currentPopoverAgent
      closeMemberPopover()
      const btn = document.querySelector(`.stack-btn[data-agent="${CSS.escape(targetAgent)}"]`)
      if (btn) btn.focus()
    }
  }
})

document.addEventListener('click', e => {
  if (currentPopoverAgent && !e.target.closest('#member-popover') && !e.target.closest('.stack-btn')) {
    closeMemberPopover()
  }
})

api.on('message', (d, m, meta) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'message', msg: m, meta })
    return
  }
  const need = needTitle(m)
  if (need) notifyNeed(d, m, need)
  if (d !== dir && (need || m.from === 'user')) loadProjects() // that box's badge
  if (d === dir) {
    // the log was rewritten (e.g. a torn last line repaired) without a log-reset: seqs of the shown window no longer
    // line up and paging/search with the old generation fail, so start over from the new log
    if (meta.generation !== logGeneration) return openProject(dir)
    if (!firstSeen(meta.generation, m.seq)) return
    if (need || m.from === 'user' || m.kind === 'chain-continue') refreshNeeds()
    newestLiveSeq = Math.max(newestLiveSeq, m.seq)
    if (meta.totals) currentTotals = meta.totals
    updateHeaderStats()
    if (m.taskUpdates) loadTasks()

    const log = $('#log')
    const nearBottom = (log.scrollHeight - log.clientHeight - log.scrollTop) <= 48
    // the DOM window must stay one contiguous range of the log: while it doesn't reach the end, appending here
    // would leave a hole that paging (it continues from the last seq shown) never fills, so only count it
    if (!logHasAfter) {
      log.append(msgFragment([m]))
      markDays()
      trimLogWindow('append')
    }

    if (logHasAfter || (!nearBottom && m.from !== 'user')) {
      unreadNewMessagesCount++
      $('#jump-latest').hidden = false
      $('#jump-latest-badge').textContent = unreadNewMessagesCount
      $('#jump-latest-badge').hidden = false
    } else {
      log.scrollTop = log.scrollHeight
      unreadNewMessagesCount = 0
      $('#jump-latest').hidden = true
    }
  }
})

api.on('status', (d, name, on, runId) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'status', name, on, runId })
    return
  }
  const key = runKey(d, name)
  if (on) {
    activeRuns.set(key, { name, runId, label: 'đang khởi động…', stopping: false, phase: 'running', blockedBy: [], startedAt: Date.now(), activeAt: Date.now() })
  } else {
    const cur = activeRuns.get(key)
    if (cur && (!runId || cur.runId === runId)) activeRuns.delete(key)
  }
  if (d !== dir) return
  renderActiveUI() // not renderTeam: that would close an open member popover
  if (currentPopoverAgent === name) { const agent = team.find(a => a.name === name); if (agent) updateMemberPopoverContent(agent) } // Dừng appears/goes
})

api.on('progress', (d, name, data) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'progress', name, data })
    return
  }
  const key = runKey(d, name)
  const r = activeRuns.get(key)
  if (r && r.runId === data.runId) {
    r.label = data.label
    if (data.phase) r.phase = data.phase
    if (data.blockedBy) r.blockedBy = data.blockedBy
    if (data.stopping !== undefined) r.stopping = !!data.stopping
    if (data.chain !== undefined) r.chain = data.chain
    if (data.label === 'đang dừng…') r.stopping = true
    if (data.startedAt) Object.assign(r, { startedAt: data.startedAt, activeAt: data.activeAt })
    if (d === dir) patchRun(r)
  }
})

api.on('locks', (d, locks) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'locks', locks })
    return
  }
  if (d === dir) {
    orphanLocks = locks || []
    renderOrphanLocks()
  }
})

api.on('project-changed', (d, changed) => {
  if (d === dir && changed) {
    if (changed.tasks) loadTasks()
    if (changed.files) refreshFiles()
    if (changed.file && currentViewerPath === changed.file) {
      openFileViewer(currentViewerPath, null, currentViewerWorkspace)
    }
  }
})

api.on('worktree-state', (d, state) => {
  if (d === dir) {
    worktreeState = state
    renderWorktreeUI()
  }
})

api.on('project-settings', (d, data) => {
  if (d === dir && data) {
    if (data.settings) currentSettings = data.settings
    if (data.revision) currentSettingsRevision = data.revision
  }
})

api.on('log-reset', (d) => {
  if (d === dir) {
    openProject(dir)
  }
})

api.on('sessions-changed', (d, sessions) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'sessions-changed', sessions })
    return
  }
  if (d === dir) {
    sess = sessions || {}
    if (currentPopoverAgent) {
      const agent = team.find(a => a.name === currentPopoverAgent)
      if (agent) updateMemberPopoverContent(agent)
    }
  }
})

let savingTeam = false
api.on('team-changed', (d, data) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'team-changed', data })
    return
  }
  if (d === dir && data) {
    if (data.revision) currentTeamRevision = data.revision
    if (Array.isArray(data.team)) {
      team = data.team
      updateAllAgentAvatars()
      renderTeam()
    }
    if ($('#settings').open && !savingTeam) {
      $('#err').textContent = '⚠️ Cấu hình thành viên đã bị thay đổi bên ngoài. Hãy mở lại Cài đặt trước khi lưu.'
    }
  }
})

api.on('permissions-changed', (d, data) => {
  if (openingDir === d) {
    pendingEvents.push({ type: 'permissions-changed', data })
    return
  }
  if (d === dir && data) {
    permissionRequests = Array.isArray(data.requests) ? data.requests : []
    updateGrantButtonsState()
    renderNeeds()
  }
})

loadProjects()
