const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, screen, protocol, session } = require('electron')
const { execFileSync, execFile } = require('child_process')
const { randomUUID, createHash, randomBytes } = require('crypto')
const { promisify } = require('util')
const fs = require('fs'), path = require('path')

if (protocol?.registerSchemesAsPrivileged) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'agent-preview', privileges: { standard: true, secure: true } }
  ])
}
const rawFs = process.versions.electron ? require('original-fs') : fs
const core = require('./core')

// Apps launched from Finder don't get the shell PATH, so claude/codex/agy wouldn't be found. (Windows apps inherit PATH.)
if (process.platform !== 'win32') try {
  const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 })
  process.env.PATH = out.split('__PATH__').pop()
} catch {}

const TASK_STATUS_LABELS = { todo: 'Cần làm', doing: 'Đang làm', review: 'Chờ duyệt', done: 'Xong' }
const RETRYABLE_MERGE_STATES = ['conflict', 'check-failed', 'blocked-dirty', 'blocked-config', 'needs-deps', 'error', 'paused']
const jobs = [], orphans = [], loadedRoots = new Set(), rootDirs = new Map()
const summaryUnavailable = new Set()
const summaryRetryAt = new Map() // root → ms: a failed or stopped summary waits instead of rerunning after every turn
const logGenerations = new Map(), appLogWrites = new Map()
const pendingPermissions = new Map(), permissionReservations = new Map()
let win, sequence = 0, pumping = false, pumpAgain = false, orphanTimer
let watched = { dir: null, root: null, file: null, watchers: [], timer: null, changed: null }

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json')
const projects = () => { try { return JSON.parse(fs.readFileSync(projectsFile(), 'utf8')) } catch { return [] } }
const rootOf = dir => fs.realpathSync(dir)
const execFileAsync = promisify(execFile)
const gitLocks = new Map(), worktreeRevisions = new Map(), mergeWorkers = new Set(), mergeControllers = new Map()
const redactManagedPath = value => String(value).split(path.join(app.getPath('userData'), 'worktrees')).join('[workspace]')
const gitError = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details })
async function git(cwd, args, options = {}) {
  try {
    // no repo hooks: an agent may have planted .git/hooks/* and app-run commits/merges must not execute them
    // ponytail: filter/diff/merge drivers from .git/config still apply; agents' sandboxes keep them out of .git
    const result = await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, ...options })
    return { stdout: result.stdout || '', stderr: result.stderr || '' }
  } catch (e) {
    if (e.code === 'ENOENT') throw gitError('GIT_MISSING', 'Không tìm thấy Git trong PATH của app')
    const message = redactManagedPath(String(e.stderr || e.stdout || e.message || 'Git lỗi').trim().slice(-2000))
    throw gitError('GIT_ERROR', message, { exitCode: Number.isInteger(e.code) ? e.code : null })
  }
}
const withGitLock = (root, action) => {
  const previous = gitLocks.get(root) || Promise.resolve()
  const current = previous.catch(() => {}).then(action)
  gitLocks.set(root, current)
  return current.finally(() => { if (gitLocks.get(root) === current) gitLocks.delete(root) })
}
const worktreeBase = root => path.join(app.getPath('userData'), 'worktrees', createHash('sha256').update(root).digest('hex'))
// Kept in userData, not in the box folder: agents can write .chat, and an entry names whose scope, allowlist and sandbox
// the merge checks run with.
const worktreeFile = root => path.join(worktreeBase(root), `registry${core.chatName(root)}.json`)
const isChatPath = file => /^\.chat\d*(\/|$)/.test(file) // any box's data folder, never committed or merged
function readWorktrees(root) {
  try {
    let text
    try { text = fs.readFileSync(worktreeFile(root), 'utf8') }
    catch (e) { // ponytail: one-time move of the pre-upgrade .chat/worktrees.json, trusted as it is
      // only for a box already using worktrees: otherwise an agent could plant .chat/worktrees.json to be adopted later
      if (e.code !== 'ENOENT' || !core.configTrust(root).trusted || !core.projectSettings(root).settings.worktreesEnabled) throw e
      text = fs.readFileSync(core.chat(root, 'worktrees.json'), 'utf8')
      writeWorktrees(root, JSON.parse(text)); fs.rmSync(core.chat(root, 'worktrees.json'), { force: true })
    }
    const data = JSON.parse(text)
    if (data?.version !== 1 || typeof data.targetRef !== 'string' || !Array.isArray(data.agents) || !Array.isArray(data.queue))
      throw new Error('schema')
    return data
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, targetRef: null, targetSha: null, agents: [], queue: [] }
    throw gitError('CONFIG_ERROR', 'Registry worktree không hợp lệ')
  }
}
function writeWorktrees(root, data) {
  fs.mkdirSync(worktreeBase(root), { recursive: true })
  core.atomicWrite(worktreeFile(root), JSON.stringify(data, null, 2))
  worktreeRevisions.set(root, (worktreeRevisions.get(root) || 0) + 1)
}
// Every write after an await goes through here: read, change and write in one synchronous step (atomic on the event
// loop). Holding a copy across awaits loses updates, since merge checks write the queue without the git lock.
function updateRegistry(root, change) {
  const registry = readWorktrees(root)
  change(registry); writeWorktrees(root, registry)
  return registry
}

const mergeSource = (registry, workspaceId, headSha) => registry.queue.findLast(entry =>
  entry.workspaceId === workspaceId && entry.headSha === headSha && !entry.supersededBy && entry.state !== 'replaced')

const controlFile = root => path.join(worktreeBase(root), `control${core.chatName(root)}.json`)

function readControlStore(root) {
  const file = controlFile(root)
  try {
    const text = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(text)
    if (data?.version === 1 && data.stops && !Array.isArray(data.stops) && typeof data.stops === 'object'
      && data.claims && !Array.isArray(data.claims) && typeof data.claims === 'object') {
      return { ...data, corrupted: false }
    }
    return { version: 1, stops: {}, claims: {}, corrupted: true }
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, stops: {}, claims: {}, corrupted: false }
    return { version: 1, stops: {}, claims: {}, corrupted: true }
  }
}

function writeControlStore(root, data) {
  fs.mkdirSync(worktreeBase(root), { recursive: true })
  core.atomicWrite(controlFile(root), JSON.stringify({ version: 1, stops: data.stops || {}, claims: data.claims || {} }, null, 2))
}

function updateControlStore(root, updater) {
  const store = readControlStore(root)
  if (store.corrupted) {
    throw gitError('CONFIG_ERROR', 'File điều phối hỏng hoặc không đọc được')
  }
  const res = updater(store)
  writeControlStore(root, store)
  return res !== undefined ? res : store
}

function computeContentKey(snapshotMap, scope, root) {
  if (!snapshotMap) return null
  const entries = []
  for (const [rel, val] of snapshotMap.entries()) {
    if (isChatPath(rel)) continue
    if (rel === '.git' || rel.startsWith('.git/') || rel === 'node_modules' || rel.startsWith('node_modules/') || rel === 'dist' || rel.startsWith('dist/')) continue
    if (typeof val === 'string' && val.startsWith('changing:')) return null
    if (scope && !core.scopeAllows(scope, rel)) continue
    const type = typeof val === 'string' && val.startsWith('link:') ? 'link' : typeof val === 'string' && val.startsWith('other:') ? 'other' : 'file'
    const digest = type === 'link' ? val.slice(5) : val
    entries.push(`${rel}\0${type}\0${digest}`)
  }
  entries.sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

const TASK_MILESTONES = { todo: 0, doing: 1, review: 2, done: 3 }

function taskSemanticKey(task) {
  if (!task) return ''
  const content = `${task.id}\0${task.createdAt}\0${task.assignee}\0${task.title || ''}\0${task.spec || ''}\0${task.acceptance || ''}`
  return createHash('sha256').update(content).digest('hex')
}

function buildMergeFailure(root, entry, phase, error, commandResult = null) {
  const code = error?.code || 'GIT_ERROR'
  let category = 'internal'
  if (code === 'CONFLICT') category = 'conflict'
  else if (code === 'CHECK_FAILED' || code === 'CHECK_MUTATED_TREE') category = 'check'
  else if (code === 'NEEDS_DEPS') category = 'dependency'
  else if (code === 'DIRTY_ROOT') category = 'workspace'
  else if (['CHECK_NOT_ALLOWED', 'TARGET_CHANGED', 'SCOPE_AUDIT', 'CONFIG_UNTRUSTED'].includes(code)) category = 'configuration'
  else if (code === 'PAUSED') category = 'stopped'

  let rawFiles = Array.isArray(error?.files) ? error.files : []
  const files = []
  for (const f of rawFiles) {
    if (typeof f === 'string' && !path.isAbsolute(f) && !f.startsWith('../')) {
      files.push(f)
    }
    if (files.length >= 50) break
  }
  const filesTruncated = rawFiles.length > 50

  const rawMsg = String(error?.message || 'Lỗi gộp nhánh')
  const message = redactManagedPath(rawMsg).slice(0, 2000)

  const rawExcerpt = String(error?.log || '')
  const excerpt = redactManagedPath(rawExcerpt).slice(0, 8192)
  const truncated = rawExcerpt.length > 8192

  let cmdRes = null
  if (commandResult && category === 'check' && code !== 'CHECK_MUTATED_TREE') {
    cmdRes = {
      command: commandResult.command,
      exitCode: commandResult.exitCode ?? null,
      signal: commandResult.signal ?? null,
      error: commandResult.error ? redactManagedPath(commandResult.error) : null
    }
  }

  const eventId = 'merge-failure:' + entry.attemptId

  return {
    version: 1,
    eventId,
    attemptId: entry.attemptId,
    attemptNo: entry.attemptNo || 1,
    queueId: entry.id,
    retryOf: entry.retryOf || null,
    agent: entry.agent,
    workspaceId: entry.workspaceId || null,
    branch: entry.branch || null,
    sourceSha: entry.headSha,
    candidateSha: entry.candidateSha || null,
    phase,
    state: entry.state,
    category,
    code,
    message,
    files,
    filesTruncated,
    commandResult: cmdRes,
    excerpt,
    truncated,
    at: new Date().toISOString()
  }
}

function managedPath(root, kind, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw gitError('CONFIG_ERROR', 'Workspace ID không hợp lệ')
  const base = worktreeBase(root), target = path.join(base, kind, id)
  if (!target.startsWith(base + path.sep)) throw gitError('CONFIG_ERROR', 'Workspace nằm ngoài vùng quản lý')
  return target
}
const nul = output => output.split('\0').filter(Boolean)
async function gitHead(root) { return (await git(root, ['rev-parse', 'HEAD'])).stdout.trim() }
async function repoProbe(root, { requireClean = false } = {}) {
  let top
  try { top = fs.realpathSync((await git(root, ['rev-parse', '--show-toplevel'])).stdout.trim()) }
  catch (e) { if (e.code === 'GIT_ERROR') throw gitError('NOT_REPO', 'Thư mục chưa phải Git repo'); throw e }
  if (top !== root) throw gitError('UNSUPPORTED_REPO', 'Dự án đang nằm trong một Git repo cha')
  let sha
  try { sha = await gitHead(root) } catch { throw gitError('UNBORN_HEAD', 'Repo chưa có commit đầu') }
  let branch
  try { branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim() }
  catch { throw gitError('UNSUPPORTED_REPO', 'HEAD phải đang ở một nhánh') }
  if (fs.existsSync(path.join(root, '.gitmodules'))) throw gitError('UNSUPPORTED_REPO', 'Sprint này chưa hỗ trợ submodule')
  const sparse = await git(root, ['config', '--bool', 'core.sparseCheckout']).catch(() => ({ stdout: '' }))
  if (sparse.stdout.trim() === 'true') throw gitError('UNSUPPORTED_REPO', 'Sprint này chưa hỗ trợ sparse checkout')
  const trackedChat = (await git(root, ['ls-files', '-z', '--', '.chat', core.chatName(root)])).stdout
  if (trackedChat) throw gitError('TRACKED_RUNTIME', `${core.chatName(root)} đang được Git theo dõi; hãy bỏ khỏi index trước`)
  for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']) {
    const markerPath = (await git(root, ['rev-parse', '--git-path', marker])).stdout.trim()
    if (fs.existsSync(path.resolve(root, markerPath))) throw gitError('UNSUPPORTED_REPO', 'Repo đang có thao tác Git chưa hoàn tất')
  }
  const dirty = !!(await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout
  if (requireClean && dirty) throw gitError('DIRTY_ROOT', 'Thư mục chính đang có thay đổi chưa commit')
  return { branch, sha, dirty }
}
async function ensureRuntimeExclude(root) {
  const relative = (await git(root, ['rev-parse', '--git-path', 'info/exclude'])).stdout.trim(), file = path.resolve(root, relative)
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch {}
  const existing = new Set(text.split(/\r?\n/)), missing = ['.chat', '.chat/', '.chat[0-9]*', 'node_modules/', 'dist/', '.DS_Store'].filter(line => !existing.has(line))
  if (missing.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // no symlink or hard link: appending would write into whatever it points at
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0))
    try {
      if (fs.fstatSync(fd).nlink > 1) throw gitError('UNSUPPORTED_REPO', 'info/exclude là hard link')
      fs.writeSync(fd, `${text && !text.endsWith('\n') ? '\n' : ''}${text.includes('# agent-chat runtime') ? '' : '# agent-chat runtime\n'}${missing.join('\n')}\n`)
    } finally { fs.closeSync(fd) }
  }
  const ignored = await git(root, ['check-ignore', '-q', `${core.chatName(root)}/log.jsonl`]).then(() => true).catch(() => false)
  if (!ignored) throw gitError('UNSUPPORTED_REPO', `Không thể loại ${core.chatName(root)} khỏi Git`)
}

async function verifyWorkspace(root, record) {
  const expected = managedPath(root, 'agents', record.id)
  if (path.resolve(record.path) !== expected || !fs.existsSync(expected) || fs.realpathSync(expected) !== fs.realpathSync(record.path))
    throw gitError('CONFIG_ERROR', `Workspace của ${record.agent} không hợp lệ`)
  const branch = (await git(expected, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
  if (branch !== record.branch) throw gitError('TARGET_CHANGED', `Nhánh workspace của ${record.agent} đã đổi`)
  const rootCommonRaw = (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim()
  const workCommonRaw = (await git(expected, ['rev-parse', '--git-common-dir'])).stdout.trim()
  const rootCommon = fs.realpathSync(path.resolve(root, rootCommonRaw)), workCommon = fs.realpathSync(path.resolve(expected, workCommonRaw))
  if (rootCommon !== workCommon) throw gitError('CONFIG_ERROR', 'Workspace không thuộc repo của box')
  const shared = path.join(expected, core.chatName(root))
  try {
    if (!fs.lstatSync(shared).isSymbolicLink() || fs.realpathSync(shared) !== fs.realpathSync(core.chat(root)))
      throw new Error('bad link')
  } catch { throw gitError('CONFIG_ERROR', '.chat trong workspace không trỏ đúng dữ liệu chung') }
  return expected
}

function manifestsCompatible(root, cwd) {
  const rootPkgPath = path.join(root, 'package.json'), cwdPkgPath = path.join(cwd, 'package.json')
  if (!fs.existsSync(rootPkgPath) || !fs.existsSync(cwdPkgPath)) return false
  try {
    const rootBuf = fs.readFileSync(rootPkgPath), cwdBuf = fs.readFileSync(cwdPkgPath)
    if (rootBuf.equals(cwdBuf)) {
      const rootLock = path.join(root, 'package-lock.json'), cwdLock = path.join(cwd, 'package-lock.json')
      if (fs.existsSync(rootLock) === fs.existsSync(cwdLock)) {
        if (!fs.existsSync(rootLock) || fs.readFileSync(rootLock).equals(fs.readFileSync(cwdLock))) return true
      }
    }
    const rootPkg = JSON.parse(rootBuf.toString('utf8'))
    const cwdPkg = JSON.parse(cwdBuf.toString('utf8'))
    const depKeys = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides']
    for (const k of depKeys) {
      if (JSON.stringify(rootPkg[k] || {}) !== JSON.stringify(cwdPkg[k] || {})) return false
    }
    return true
  } catch {
    return false
  }
}

async function bootstrapDependencies(root, cwd) {
  if (!manifestsCompatible(root, cwd)) return false
  const source = path.join(root, 'node_modules'), target = path.join(cwd, 'node_modules')
  if (!fs.existsSync(source)) return false
  if (!fs.existsSync(target)) {
    // original-fs: Electron's fs treats *.asar (electron/dist/…/default_app.asar) as folders and the copy fails.
    // Copy to a temp name and rename, so a failed copy never leaves a half-filled node_modules that later turns get reused.
    const partial = `${target}.partial-${process.pid}`
    await rawFs.promises.rm(partial, { recursive: true, force: true })
    await rawFs.promises.cp(source, partial, { recursive: true, verbatimSymlinks: true, mode: rawFs.constants.COPYFILE_FICLONE })
    await rawFs.promises.rename(partial, target)
  }
  return true
}

async function prepareWorkspace(root, agent) {
  const { settings } = core.projectSettings(root)
  const scope = core.normalizeScope(agent, root)
  if (!settings.worktreesEnabled || scope.readOnly) return { cwd: root, workspaceId: null, branch: null, worktree: false }
  return withGitLock(root, async () => {
    const probe = await repoProbe(root), registry = readWorktrees(root)
    if (registry.targetRef !== probe.branch) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
    let record = registry.agents.find(item => String(item.agent).toLowerCase() === String(agent.name).toLowerCase())
    if (!record) {
      const id = randomUUID(), boxKey = createHash('sha256').update(root).digest('hex').slice(0, 10)
      const branch = `agent-chat/${boxKey}/${id}`
      await git(root, ['check-ref-format', '--branch', branch])
      const cwd = managedPath(root, 'agents', id)
      fs.mkdirSync(path.dirname(cwd), { recursive: true })
      await git(root, ['worktree', 'add', '-b', branch, cwd, probe.sha])
      fs.symlinkSync(core.chat(root), path.join(cwd, core.chatName(root)), process.platform === 'win32' ? 'junction' : 'dir') // junction: no admin rights needed
      record = { id, agent: agent.name, branch, path: cwd, baseSha: probe.sha }
      updateRegistry(root, latest => latest.agents.push(record))
    }
    return { cwd: await verifyWorkspace(root, record), workspaceId: record.id, branch: record.branch, worktree: true }
  })
}

// When the turn starts, not when it is queued: until then an earlier turn of the same agent may still change the workspace.
async function startWorkspace(job) {
  return withGitLock(job.root, async () => {
    const probe = await repoProbe(job.root), registry = readWorktrees(job.root), record = registry.agents.find(item => item.id === job.workspaceId)
    if (registry.targetRef !== probe.branch) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
    if (!record) throw gitError('CONFIG_ERROR', 'Không tìm thấy workspace của agent')
    if (record.recoveryPending) throw gitError('BUSY', 'Workspace đang phục hồi; hãy hoàn tất thao tác Lấy main trong hàng chờ')
    const cwd = await verifyWorkspace(job.root, record), files = await workspaceChanges(cwd)
    // Left by an earlier turn (cut off, failed the audit, or a merge the agent didn't finish). Refusing would block the
    // agent for good, so they are committed under the same scope rule as an audited turn.
    if (files.length) {
      const unmerged = nul((await git(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout)
      if (unmerged.length || files.some(file => isChatPath(file) || !core.scopeAllows(job.scope, file)))
        throw gitError('DIRTY_WORKSPACE', `Workspace của ${job.name} có thay đổi chưa được app ghi nhận: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '…' : ''}`)
      await git(cwd, ['add', '--', ...files])
      await git(cwd, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', `${job.name} · Thay đổi còn lại từ lượt trước`])
    }
    // everything on the branch is already in main (merged, or squashed into it): start from main
    const head = await gitHead(cwd)
    if (head !== probe.sha && await contained(job.root, head, record, probe.sha)) await git(cwd, ['reset', '-q', '--hard', probe.sha])
    job.depsReady = await bootstrapDependencies(job.root, cwd)
    job.baseSha = await gitHead(cwd)
  })
}

function queueLabel(entry) {
  return ({ queued: 'Chờ gộp', merging: 'Đang gộp', checking: 'Đang kiểm tra', publishing: 'Đang xuất bản', merged: 'Đã gộp',
    conflict: 'Xung đột', 'check-failed': 'Check lỗi', 'blocked-dirty': 'Thư mục chính bẩn', 'blocked-config': 'Cấu hình đổi',
    'needs-deps': 'Thiếu dependency', paused: 'Đã dừng', error: 'Lỗi', replaced: 'Đã thay bằng main (có sao lưu)' })[entry.state] || entry.state
}

async function worktreeState(root) {
  const { settings } = core.projectSettings(root)
  let probe, reason = null
  try { probe = await repoProbe(root) } catch (e) { reason = e.message }
  const registry = readWorktrees(root), agents = []
  for (const record of registry.agents) {
    let ahead = 0
    try {
      ahead = Number((await git(root, ['rev-list', '--ignore-missing', '--count', record.branch, '--not', probe?.sha || registry.targetSha,
        ...(record.merged || [])])).stdout.trim() || 0)
    } catch {}
    agents.push({ name: record.agent, workspaceId: record.id, branch: record.branch, ahead,
      busy: jobs.some(job => job.root === root && job.workspaceId === record.id && !job.finished) })
  }
  const store = readControlStore(root)
  const queue = await Promise.all(registry.queue.filter(entry => !entry.supersededBy).map(async entry => {
    // Old registries keep failed attempts even after a retry (or a later commit) was merged.
    if (probe?.branch === registry.targetRef && RETRYABLE_MERGE_STATES.includes(entry.state)
      && await contained(root, entry.headSha, registry.agents.find(item => item.id === entry.workspaceId), probe.sha))
      entry = { ...entry, state: 'merged', error: null }
    const actionKey = 'repair:' + (entry.mergeEvent?.eventId || entry.id)
    const hasClaim = !!(store.claims?.[actionKey] || jobs.some(j => j.root === root && j.repairQueueId === entry.id && !j.finished))
    const canRepair = ['conflict', 'check-failed'].includes(entry.state) && !hasClaim
    return { id: entry.id, agent: entry.agent, headSha: entry.headSha, state: entry.state, label: queueLabel(entry),
      error: entry.error || null, mergeEvent: entry.mergeEvent || null, canRetry: RETRYABLE_MERGE_STATES.includes(entry.state),
      canReplace: RETRYABLE_MERGE_STATES.includes(entry.state),
      canRepair, canStop: ['queued', 'checking'].includes(entry.state) }
  }))
  return { revision: worktreeRevisions.get(root) || 0, enabled: settings.worktreesEnabled, available: !!probe, reason,
    targetBranch: registry.targetRef || probe?.branch || null, targetSha: probe?.sha || registry.targetSha || null, dirty: probe?.dirty || false, agents,
    queue }
}

async function emitWorktreeState(root) {
  const state = await worktreeState(root)
  win?.webContents.send('worktree-state', root, state)
  return state
}

function initialIgnore(existing = '') {
  const lines = ['.chat', '.chat/', '.chat[0-9]*', 'node_modules/', 'dist/', '.DS_Store', '.env*', '*.pem', '*.key', '*.p12']
  let text = existing
  for (const line of lines) if (!new RegExp(`(^|\\n)${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\n)`).test(text)) text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  return text
}
async function gitInitPreview(root) {
  if (fs.existsSync(path.join(root, '.git'))) throw gitError('UNSUPPORTED_REPO', 'Thư mục đã có .git')
  const files = [], fingerprints = []
  async function walk(folder, prefix = '') {
    for (const entry of await rawFs.promises.readdir(folder, { withFileTypes: true })) {
      if ((!prefix && (['.git', 'node_modules', 'dist'].includes(entry.name) || core.CHAT_DIR.test(entry.name))) || entry.name === '.DS_Store'
        || entry.name.startsWith('.env') || /\.(?:pem|key|p12)$/i.test(entry.name)) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name, absolute = path.join(folder, entry.name)
      if (entry.isDirectory()) await walk(absolute, relative)
      else if (entry.isFile()) {
        const stat = await rawFs.promises.stat(absolute), hash = createHash('sha256').update(await rawFs.promises.readFile(absolute)).digest('hex')
        files.push(relative); fingerprints.push(`${relative}\0${stat.size}\0${hash}`)
      } else if (entry.isSymbolicLink()) {
        const target = await rawFs.promises.readlink(absolute)
        files.push(relative); fingerprints.push(`${relative}\0link\0${target}`)
      }
    }
  }
  await walk(root)
  let existing = ''
  try { existing = fs.readFileSync(path.join(root, '.gitignore'), 'utf8') } catch {}
  const ignoreText = initialIgnore(existing)
  if (!files.includes('.gitignore')) { files.push('.gitignore'); fingerprints.push(`.gitignore\0${createHash('sha256').update(ignoreText).digest('hex')}`) }
  else fingerprints[files.indexOf('.gitignore')] = `.gitignore\0${createHash('sha256').update(ignoreText).digest('hex')}`
  files.sort(); fingerprints.sort()
  const token = createHash('sha256').update(JSON.stringify([files, fingerprints, ignoreText])).digest('hex')
  return { token, files, ignoreText, branch: 'main' }
}

async function initializeGit(root, request) {
  if (!request || typeof request.token !== 'string' || !Array.isArray(request.files)) throw gitError('INVALID_ARGUMENT', 'Yêu cầu khởi tạo Git không hợp lệ')
  const preview = await gitInitPreview(root)
  if (preview.token !== request.token) throw gitError('STALE_PREVIEW', 'File đã thay đổi từ lúc xem trước')
  const allowed = new Set(preview.files), selected = [...new Set(request.files)]
  if (!selected.length || selected.some(file => typeof file !== 'string' || !allowed.has(file)) || !selected.includes('.gitignore'))
    throw gitError('INVALID_ARGUMENT', 'Danh sách file commit đầu không hợp lệ')
  core.atomicWrite(path.join(root, '.gitignore'), preview.ignoreText) // replaces a planted symlink instead of writing through it
  await execFileAsync('git', ['init', '-b', 'main', root], { encoding: 'utf8' }).catch(e => {
    if (e.code === 'ENOENT') throw gitError('GIT_MISSING', 'Không tìm thấy Git trong PATH của app')
    throw gitError('GIT_ERROR', String(e.stderr || e.message).trim())
  })
  await git(root, ['add', '--', ...selected])
  await git(root, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', 'Initial commit'])
  return worktreeState(root)
}

async function enableWorktrees(root, settings) {
  await ensureRuntimeExclude(root)
  const probe = await repoProbe(root, { requireClean: true })
  for (const agent of core.team(root)) {
    const scope = core.normalizeScope(agent, root)
    if (!scope.readOnly) for (const command of settings.mergeChecks) if (!agent.allowedCommands.includes(command))
      throw gitError('CHECK_NOT_ALLOWED', `Lệnh "${command}" chưa được cho phép với @${agent.name}`)
  }
  const registry = readWorktrees(root)
  if (registry.targetRef && registry.targetRef !== probe.branch) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
  registry.targetRef = probe.branch; registry.targetSha = probe.sha
  writeWorktrees(root, registry)
}

async function workspaceChanges(cwd) {
  const tracked = nul((await git(cwd, ['diff', '--no-renames', '--name-only', '-z', 'HEAD'])).stdout)
  const staged = nul((await git(cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD'])).stdout)
  const untracked = nul((await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout)
  return [...new Set([...tracked, ...staged, ...untracked])]
}

// "dev-be · T43 Xem diff mỗi lượt", or the files a turn without a task touched: one line per turn in main's history
async function turnSubject(job, result, files) {
  const ids = core.parseTaskStatusBlock(result.text || '').changes?.map(change => change.id) || job.taskIds
  let title = null
  if (ids.length) try { title = (await core.taskBoardIndexed(job.root)).tasks.find(task => task.id === ids[0])?.title } catch {}
  const names = [...new Set(files.map(file => path.basename(file)))]
  const what = ids.length ? `${ids.slice(0, 3).join(' ')}${title ? ` ${title}` : ''}`
    : names.length ? `Sửa ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'Cập nhật'
  const subject = `${job.name} · ${what}${result.outcome === 'success' ? '' : ' (lượt chưa xong)'}`.replace(/\s+/g, ' ')
  return subject.length > 72 ? `${subject.slice(0, 71)}…` : subject
}

async function commitWorkspace(job, result, changed, auditComplete, outside) {
  if (!job.worktree || result.orphanState) return null
  return withGitLock(job.root, async () => {
    const registry = readWorktrees(job.root), record = registry.agents.find(item => item.id === job.workspaceId)
    if (!record) throw gitError('CONFIG_ERROR', 'Không tìm thấy workspace của agent')
    const cwd = await verifyWorkspace(job.root, record), beforeHead = await gitHead(cwd)
    // the agent may commit (or merge) by itself; only a rewritten history is refused
    if (beforeHead !== job.baseSha && !await git(cwd, ['merge-base', '--is-ancestor', job.baseSha, beforeHead]).then(() => true).catch(() => false))
      throw gitError('TARGET_CHANGED', 'Lịch sử nhánh workspace bị viết lại trong lúc agent chạy')
    const files = await workspaceChanges(cwd)
    if (outside.length) {
      const probe = await repoProbe(job.root).catch(() => null)
      if (probe?.sha) {
        const diff = nul((await git(cwd, ['diff', '--no-renames', '--name-only', '-z', probe.sha]).catch(() => ({ stdout: '' }))).stdout)
        const untracked = nul((await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => ({ stdout: '' }))).stdout)
        const diffSet = new Set([...diff, ...untracked])
        outside = outside.filter(file => isChatPath(file) || diffSet.has(file))
      }
    }
    if (!auditComplete || outside.length || files.some(file => !changed.includes(file) || isChatPath(file) || !core.scopeAllows(job.scope, file))) {
      if (files.length) throw gitError('SCOPE_AUDIT', 'Không tự commit vì thay đổi chưa qua kiểm tra phạm vi', { files })
      return null
    }
    let headSha = beforeHead, subject = null
    if (files.length) {
      await git(cwd, ['add', '--', ...files])
      const staged = nul((await git(cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD'])).stdout)
      if (!staged.length || staged.some(file => !files.includes(file) || !core.scopeAllows(job.scope, file)))
        throw gitError('SCOPE_AUDIT', 'Tập file chuẩn bị commit không hợp lệ', { files: staged })
      subject = await turnSubject(job, result, staged)
      await git(cwd, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', subject, '-m', `Agent-Chat-Run: ${job.runId}`])
      headSha = await gitHead(cwd)
    }
    const probe = await repoProbe(job.root), ahead = !await contained(job.root, headSha, record, probe.sha)
    let queuedEntryId = null
    if (result.outcome === 'success' && ahead) {
      const settings = core.projectSettings(job.root).settings
      // the agent committed by itself: name the squash after what the turn changed
      subject ??= await turnSubject(job, result, nul((await git(cwd, ['diff', '--no-renames', '--name-only', '-z', job.baseSha, headSha])).stdout))
      const entryId = randomUUID()
      updateRegistry(job.root, latest => {
        const existing = mergeSource(latest, job.workspaceId, headSha)
        if (existing) queuedEntryId = existing.id
        else {
          latest.queue.push({ id: entryId, agent: job.name,
            runId: job.runId, chainId: job.chain?.id || null, workspaceId: job.workspaceId, headSha, subject, checks: [...settings.mergeChecks], state: 'queued',
            baseSha: probe.sha, candidateSha: null, error: null,
            pgid: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
          queuedEntryId = entryId
        }
        latest.targetSha = probe.sha
      })
    }
    return { id: record.id, branch: record.branch, headSha, queuedEntryId }
  })
}

function mergeError(entry, code, message, files = [], log = '') {
  entry.state = code === 'DIRTY_ROOT' ? 'blocked-dirty' : code === 'CHECK_NOT_ALLOWED' || code === 'TARGET_CHANGED' || code === 'SCOPE_AUDIT' || code === 'CONFIG_UNTRUSTED'
    ? 'blocked-config' : code === 'NEEDS_DEPS' ? 'needs-deps' : code === 'CONFLICT' ? 'conflict' : code === 'CHECK_FAILED' || code === 'CHECK_MUTATED_TREE'
      ? 'check-failed' : code === 'PAUSED' ? 'paused' : 'error'
  entry.error = { code, message: redactManagedPath(message), files: files.slice(0, 50), log: redactManagedPath(String(log).slice(-32768)) }
  entry.updatedAt = new Date().toISOString(); entry.pgid = null
}

async function removeIntegration(root, entry) {
  const cwd = managedPath(root, 'integration', entry.id)
  if (fs.existsSync(cwd)) await git(root, ['worktree', 'remove', '--force', cwd]).catch(() => {})
}

function updateEntry(root, id, change) {
  let entry
  updateRegistry(root, registry => {
    entry = registry.queue.find(item => item.id === id)
    if (!entry) throw gitError('CONFIG_ERROR', 'Mục gộp không còn trong hàng chờ')
    change(entry, registry)
  })
  return entry
}
// Merges are squashed, so the agent's own commits never reach main's history. A commit's changes are in main when it is
// reachable from main or from a head already squashed into it (record.merged).
async function contained(root, sha, record, mainSha) {
  const out = await git(root, ['rev-list', '--ignore-missing', '--count', sha, '--not', mainSha, ...(record?.merged || [])]).catch(() => null)
  return out?.stdout.trim() === '0'
}
function rememberMerged(registry, entry) {
  const record = registry.agents.find(item => item.id === entry.workspaceId)
  // ponytail: last 50 heads; an older failed entry may show "Thử lại" again, and the retry finds nothing left to merge
  if (record && !record.merged?.includes(entry.headSha)) record.merged = [...(record.merged || []), entry.headSha].slice(-50)
}
// After a squash the agent's branch no longer leads to main: an idle, clean workspace is moved onto main now, a busy one
// when its next turn starts (startWorkspace)
async function syncWorkspace(root, workspaceId, mainSha) {
  if (jobs.some(job => job.root === root && job.workspaceId === workspaceId && !job.finished)) return
  const record = readWorktrees(root).agents.find(item => item.id === workspaceId)
  if (!record) return
  const cwd = await verifyWorkspace(root, record), head = await gitHead(cwd)
  if (head !== mainSha && !(await workspaceChanges(cwd)).length && await contained(root, head, record, mainSha))
    await git(cwd, ['reset', '-q', '--hard', mainSha])
}

// Explicit recovery for a source whose work was integrated/replaced elsewhere. This is not a successful merge.
// Keep a Git ref and the full registry/evidence snapshot before moving a clean, idle workspace.
async function replaceMergeSource(root, queueId) {
  const registry = readWorktrees(root), old = registry.queue.find(entry => entry.id === queueId)
  if (old?.supersededBy && registry.queue.some(entry => entry.id === old.supersededBy && entry.state === 'replaced')) return
  if (!old || old.supersededBy || !RETRYABLE_MERGE_STATES.includes(old.state))
    throw gitError('INVALID_ARGUMENT', 'Nguồn này không còn cần phục hồi')
  const record = registry.agents.find(item => item.id === old.workspaceId)
  if (!record) throw gitError('CONFIG_ERROR', 'Workspace không còn tồn tại')
  const assertIdle = () => {
    if (jobs.some(job => job.root === root && !job.finished) || orphans.some(job => job.root === root)
      || mergeWorkers.has(root) || registry.queue.some(entry => ['queued', 'merging', 'checking', 'publishing'].includes(entry.state) && !entry.supersededBy))
      throw gitError('BUSY', 'Chờ các lượt agent và hàng chờ đang chạy kết thúc trước khi lấy main')
  }
  assertIdle()
  const cwd = await verifyWorkspace(root, record), probe = await repoProbe(root, { requireClean: true })
  if (probe.branch !== registry.targetRef) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
  const pending = record.recoveryPending
  if (pending && (pending.sourceSha !== old.headSha || pending.targetSha !== probe.sha))
    throw gitError('TARGET_CHANGED', 'Main hoặc nguồn đã đổi từ lần phục hồi trước; giữ bản sao lưu để đối chiếu')
  const checkSource = async () => {
    assertIdle()
    const latest = await repoProbe(root, { requireClean: true }), source = await repoProbe(fs.realpathSync(cwd), { requireClean: true })
    if (latest.sha !== probe.sha || latest.branch !== registry.targetRef || source.branch !== record.branch
      || (source.sha !== old.headSha && !(pending && source.sha === pending.targetSha)))
      throw gitError('TARGET_CHANGED', 'Main hoặc workspace đã đổi; hãy kiểm lại trước khi phục hồi')
    return source.sha
  }
  await checkSource()
  const diff = (await git(root, ['diff', '--stat', old.headSha, probe.sha])).stdout.trim()
  const answer = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Lấy main và sao lưu nhánh',
    message: `Thay nguồn của ${record.agent} bằng ${probe.branch}?`,
    detail: `Nguồn ${old.headSha.slice(0, 12)} → main ${probe.sha.slice(0, 12)}.\nCác thay đổi riêng sẽ chỉ còn trong nhánh sao lưu. Đây không phải thao tác gộp; chỉ dùng sau khi đối chiếu phần cần giữ đã có trên main. Lịch sử lỗi và bằng chứng được giữ nguyên.\n\n${diff.slice(0, 6000)}`,
    checkboxLabel: 'Tôi đã đối chiếu và đồng ý thay nguồn này bằng main', checkboxChecked: false,
    buttons: ['Hủy', 'Sao lưu và lấy main'], defaultId: 0, cancelId: 0, noLink: true
  })
  if (answer.response !== 1 || !answer.checkboxChecked) throw gitError('CANCELLED', 'Đã hủy, workspace và hàng chờ giữ nguyên')
  await checkSource()
  const recovery = pending || { id: randomUUID(), sourceSha: old.headSha, targetSha: probe.sha, at: new Date().toISOString() }
  if (!pending) {
    recovery.backupRef = `refs/heads/agent-chat-backup/${record.id}/${recovery.id}`
    const snapshotDir = managedPath(root, 'recovery', recovery.id)
    fs.mkdirSync(path.dirname(snapshotDir), { recursive: true })
    fs.mkdirSync(snapshotDir, { recursive: false })
    fs.writeFileSync(path.join(snapshotDir, 'registry.json'), JSON.stringify(readWorktrees(root), null, 2), { flag: 'wx' })
    for (const [name, file] of [['locks.json', registryFile(root)], ['tasks.json', core.chat(root, 'tasks.json')]])
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(snapshotDir, name), fs.constants.COPYFILE_EXCL)
    fs.writeFileSync(path.join(snapshotDir, 'diff.patch'), (await git(root, ['diff', '--binary', probe.sha, old.headSha])).stdout, { flag: 'wx' })
    await git(root, ['update-ref', recovery.backupRef, old.headSha, '0'.repeat(old.headSha.length)])
    fs.writeFileSync(path.join(snapshotDir, 'recovery.json'), JSON.stringify(recovery, null, 2), { flag: 'wx' })
    updateRegistry(root, latest => { latest.agents.find(item => item.id === record.id).recoveryPending = recovery })
  }
  // Revalidate the backup even when completing an interrupted operation. Never discard an unrecorded source.
  if ((await git(root, ['rev-parse', '--verify', recovery.backupRef])).stdout.trim() !== old.headSha)
    throw gitError('CONFIG_ERROR', 'Nhánh sao lưu không khớp nguồn cần giữ')
  const head = await checkSource()
  if (head !== probe.sha) await git(cwd, ['reset', '--keep', probe.sha])
  if (await gitHead(cwd) !== probe.sha) throw gitError('TARGET_CHANGED', 'Không xác minh được nguồn sau phục hồi')
  updateRegistry(root, latest => {
    const at = new Date().toISOString()
    latest.queue.push({ id: recovery.id, workspaceId: record.id, agent: record.agent, headSha: old.headSha,
      state: 'replaced', replacementSha: probe.sha, backupRef: recovery.backupRef, snapshotId: recovery.id,
      checks: [], createdAt: recovery.at, updatedAt: at, error: null })
    for (const entry of latest.queue) if (entry.id !== recovery.id && entry.workspaceId === record.id
      && entry.headSha === old.headSha && !entry.supersededBy && RETRYABLE_MERGE_STATES.includes(entry.state)) entry.supersededBy = recovery.id
    delete latest.agents.find(item => item.id === record.id).recoveryPending
  })
  await post(root, 'system', `Đã sao lưu nguồn cũ của ${record.agent} và lấy main; các mục lỗi cùng nguồn đã được thay thế.`,
    { kind: 'merge-recovery', workspaceId: record.id, sourceSha: old.headSha, replacementSha: probe.sha, backupRef: recovery.backupRef, snapshotId: recovery.id })
}

async function processMerge(root, id) {
  let entry = readWorktrees(root).queue.find(item => item.id === id)
  if (!entry || entry.state !== 'queued' || entry.supersededBy || !core.projectSettings(root).settings.worktreesEnabled) return
  const now = () => new Date().toISOString()
  updateEntry(root, id, item => {
    item.attemptId = randomUUID()
    item.attemptNo = (item.attemptNo || 0) + 1
  })
  entry = readWorktrees(root).queue.find(item => item.id === id)
  let currentPhase = 'prepare'
  // re-checked at every state change: the user may stop (paused) or retry the entry while we wait for the dialog or the lock
  const stillQueued = item => item.state === 'queued' && !item.supersededBy
  const refuse = async (code, message) => {
    updateEntry(root, id, item => {
      if (stillQueued(item)) {
        mergeError(item, code, message)
        const mergeEvent = buildMergeFailure(root, item, 'prepare', { code, message }, null, null)
        item.mergeEvent = mergeEvent
      }
    })
    await emitWorktreeState(root).catch(() => {})
    const cur = readWorktrees(root).queue.find(item => item.id === id)
    if (cur?.mergeEvent) {
      const mergeEvent = cur.mergeEvent
      await postOnce(root, mergeEvent.eventId, 'system', `@${cur.agent} chưa gộp được nhánh: ${message}`, {
        kind: 'merge', eventId: mergeEvent.eventId, queueId: cur.id, owner: cur.agent, headSha: cur.headSha, error: cur.error, mergeEvent
      })
    }
  }
  try { await ensureTrustedConfig(root) } catch (e) { return refuse('CONFIG_UNTRUSTED', e.message) }
  const owner = core.team(root).find(agent => agent.name === entry.agent)
  if (!owner) return refuse('CHECK_NOT_ALLOWED', 'Agent sở hữu nhánh không còn trong nhóm')
  for (const command of entry.checks) if (!owner.allowedCommands.includes(command)) return refuse('CHECK_NOT_ALLOWED', `Lệnh "${command}" không còn được phép`)
  const integration = managedPath(root, 'integration', id)
  let probe, requeued = false, commandsRun = [], docsOnly = false
  try {
    currentPhase = 'merge'
    // 1. under the git lock: merge the branch into a throwaway integration worktree
    const done = await withGitLock(root, async () => {
      let stopped = false
      entry = updateEntry(root, id, item => { if (!stillQueued(item)) stopped = true; else { item.state = 'merging'; item.error = null; item.updatedAt = now() } })
      if (stopped) return true
      await emitWorktreeState(root)
      probe = await repoProbe(root, { requireClean: true })
      if (probe.branch !== readWorktrees(root).targetRef) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
      const alreadyMerged = async () => {
        updateEntry(root, id, (item, registry) => { item.state = 'merged'; item.updatedAt = now(); registry.targetSha = probe.sha; rememberMerged(registry, item) })
        await syncWorkspace(root, entry.workspaceId, probe.sha).catch(e => console.error(e))
        return true
      }
      if (await contained(root, entry.headSha, readWorktrees(root).agents.find(item => item.id === entry.workspaceId), probe.sha)) return alreadyMerged()
      const base = (await git(root, ['merge-base', probe.sha, entry.headSha])).stdout.trim()
      const files = nul((await git(root, ['diff', '--no-renames', '--name-only', '-z', `${base}..${entry.headSha}`])).stdout)
      const scope = core.normalizeScope(owner, root)
      if (files.some(file => !core.scopeAllows(scope, file) || isChatPath(file)))
        throw gitError('SCOPE_AUDIT', 'Nhánh chứa file ngoài phạm vi', { files })
      updateEntry(root, id, item => { item.baseSha = probe.sha })
      fs.mkdirSync(path.dirname(integration), { recursive: true })
      await git(root, ['worktree', 'add', '--detach', integration, probe.sha])
      try { await git(integration, ['merge', '--squash', entry.headSha]) }
      catch (e) {
        const conflicts = nul((await git(integration, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout)
        if (conflicts.length) throw gitError('CONFLICT', 'Nhánh xung đột với thay đổi đã gộp', { files: conflicts })
        throw e
      }
      // a branch whose changes main already has (squashed earlier, or the agent merged main and kept nothing new)
      const staged = nul((await git(integration, ['diff', '--cached', '--name-only', '-z'])).stdout)
      if (!staged.length) { await removeIntegration(root, entry); return alreadyMerged() }
      // reports and notes can't break the build: no install, no checks (CHANGELOG.md is checked against package.json)
      docsOnly = staged.every(file => file.startsWith('reports/') || (file.endsWith('.md') && file !== 'CHANGELOG.md'))
      currentPhase = 'dependencies'
      if (!docsOnly && !await bootstrapDependencies(root, integration)) throw gitError('NEEDS_DEPS', 'Integration worktree chưa có dependency phù hợp')
      await git(integration, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', entry.subject || `${entry.agent} · Cập nhật`,
        '-m', `Agent-Chat-Queue: ${entry.id}`])
      const candidateSha = await gitHead(integration)
      entry = updateEntry(root, id, item => { item.candidateSha = candidateSha; item.state = 'checking'; item.updatedAt = now() })
      return false
    })
    if (done) return
    await emitWorktreeState(root)
    currentPhase = 'checks'
    // 2. no lock: checks can take minutes, and agent turns need the lock to start (prepareWorkspace) and to commit
    const controller = new AbortController(); mergeControllers.set(root, { entry, controller })
    persistRegistry(root)
    let mergeFailed = null
    try {
      for (const command of docsOnly ? [] : entry.checks) {
        const timer = setTimeout(() => controller.abort('timeout'), core.timeoutMinutes(owner) * 60000)
        let result
        try {
          result = await core.runCommand(integration, command, { signal: controller.signal, agent: owner, onSpawn: pid => {
            entry.pgid = pid; entry.updatedAt = now(); updateEntry(root, id, item => { item.pgid = pid; item.updatedAt = entry.updatedAt }); persistRegistry(root)
          } })
        } finally { clearTimeout(timer) }
        entry.pgid = null; updateEntry(root, id, item => { item.pgid = null }); persistRegistry(root)
        commandsRun.push({ command, exitCode: result?.exitCode ?? null, signal: result?.signal ?? null, error: result?.error ?? null })
        if (controller.signal.aborted) {
          mergeFailed = gitError('PAUSED', controller.signal.reason === 'timeout' ? 'Kiểm tra gộp quá giờ' : 'Đã dừng kiểm tra gộp')
          break
        }
        if (result.error || result.exitCode !== 0) {
          mergeFailed = gitError('CHECK_FAILED', `Lệnh kiểm tra lỗi: ${command}`, { log: `${result.stdout}\n${result.stderr}` })
          break
        }
      }
    } finally { mergeControllers.delete(root) }
    const treeStatus = await git(integration, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => ({ stdout: '' }))
    if (!mergeFailed && treeStatus.stdout) mergeFailed = gitError('CHECK_MUTATED_TREE', 'Lệnh kiểm tra đã sửa cây source')
    if (mergeFailed) throw mergeFailed
    currentPhase = 'publish'
    // 3. under the lock again: publish only if the target branch hasn't moved since step 1
    await withGitLock(root, async () => {
      entry = updateEntry(root, id, item => { item.state = 'publishing'; item.updatedAt = now() }); await emitWorktreeState(root)
      const latest = await repoProbe(root, { requireClean: true })
      if (latest.branch !== readWorktrees(root).targetRef) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
      if (latest.sha !== probe.sha) {
        await removeIntegration(root, entry)
        updateEntry(root, id, (item, registry) => {
          item.state = 'queued'; item.baseSha = latest.sha; item.candidateSha = null; item.error = null; item.pgid = null
          item.updatedAt = now(); registry.targetSha = latest.sha
        })
        requeued = true
        return
      }
      await git(root, ['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', '--no-autostash', entry.candidateSha])
      const published = await gitHead(root)
      if (published !== entry.candidateSha) throw gitError('TARGET_CHANGED', 'Không xác minh được commit đã xuất bản')
      updateEntry(root, id, (item, registry) => { item.state = 'merged'; item.error = null; item.updatedAt = now(); registry.targetSha = published; rememberMerged(registry, item) })
      await removeIntegration(root, entry)
      await syncWorkspace(root, entry.workspaceId, published).catch(e => console.error(e)) // main is already published: a stuck workspace syncs at its next turn
    })
    if (!requeued) await post(root, 'system', `Đã gộp nhánh của ${entry.agent} sau khi kiểm tra đạt.`, { kind: 'merge', queueId: entry.id, owner: entry.agent, headSha: entry.headSha })
  } catch (e) {
    const lastCommandResult = commandsRun.find(c => c.error || (c.exitCode !== 0 && c.exitCode != null) || c.signal) || null
    entry = updateEntry(root, id, item => {
      mergeError(item, e.code || 'GIT_ERROR', e.message, e.files || [], e.log || '')
      const mergeEvent = buildMergeFailure(root, item, currentPhase, e, lastCommandResult)
      item.mergeEvent = mergeEvent
    })
    await removeIntegration(root, entry)
    const mergeEvent = entry.mergeEvent
    if (mergeEvent) {
      await postOnce(root, mergeEvent.eventId, 'system', `@${entry.agent} chưa gộp được nhánh: ${e.message}`, { kind: 'merge', eventId: mergeEvent.eventId, queueId: entry.id, owner: entry.agent,
        headSha: entry.headSha, error: entry.error, mergeEvent })
    }
  } finally {
    mergeControllers.delete(root)
    try { persistRegistry(root) } catch {}
    await emitWorktreeState(root).catch(() => {})
  }
}

async function pumpMerge(root) {
  if (mergeWorkers.has(root)) return
  mergeWorkers.add(root)
  try {
    while (core.projectSettings(root).settings.worktreesEnabled) {
      const entry = readWorktrees(root).queue.find(item => item.state === 'queued' && !item.supersededBy)
      if (!entry) break
      await processMerge(root, entry.id)
    }
  } finally { mergeWorkers.delete(root) }
}

async function post(dir, from, text, extra = {}, appendOptions = {}) {
  const msg = { from, text, at: new Date().toISOString(), ...extra }
  const root = rootOf(dir)
  appLogWrites.set(root, Infinity)
  let appended
  try { appended = await core.appendLogIndexed(dir, msg, appendOptions) }
  finally { appLogWrites.set(root, Date.now() + 500) }
  if (appended.duplicate) {
    return appended.message
  }
  logGenerations.set(root, appended.generation)
  win?.webContents.send('message', dir, appended.message, { generation: appended.generation, total: appended.total, totals: appended.totals })
  return { ...appended.message, ...(appended.taskError ? { taskError: appended.taskError } : {}) }
}

async function postOnce(dir, eventId, from, text, extra = {}, appendOptions = {}) {
  return post(dir, from, text, { eventId, ...extra }, appendOptions)
}

const runKey = (root, name) => root + '\0' + name
const permissionKey = (root, name) => root + '\0' + name
const permissionView = request => ({ id: request.id, agent: request.agent, cli: request.cli, workspaceId: request.workspaceId,
  sourceRunId: request.sourceRunId, denials: request.denials })
function pendingValid(request) {
  try {
    const agent = core.team(request.root).find(item => item.name === request.agent)
    const context = agent && agentSessionContext(request.root, agent.name)
    return !!agent && agent.cli === request.cli && core.teamRevision(request.root) === request.teamRevision
      && logGenerations.get(request.root) === request.generation && context?.workspaceId === request.workspaceId
      && !jobs.some(job => job.root === request.root && job.name === request.agent && !job.finished)
      && !orphans.some(lock => lock.root === request.root && lock.name === request.agent)
  } catch { return false }
}
function permissionRequests(root) {
  const out = []
  for (const [key, request] of pendingPermissions) if (request.root === root) {
    if (pendingValid(request)) out.push(permissionView(request)); else pendingPermissions.delete(key)
  }
  return out
}
function emitPermissions(root) {
  const requests = permissionRequests(root)
  win?.webContents.send('permissions-changed', root, { requests })
  return requests
}
function clearPending(root, name = null) {
  let changed = false
  for (const [key, request] of pendingPermissions) if (request.root === root && (!name || request.agent === name)) {
    pendingPermissions.delete(key); changed = true
  }
  if (changed) emitPermissions(root)
}
const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, partial: false })
function migrateTaskScope(dir) {
  const root = rootOf(dir), pmBusy = [...jobs, ...orphans].some(x => x.root === root && String(x.name).toLowerCase() === 'pm')
  if (!pmBusy) return core.migrateTaskScope(root)
}
const heads = () => jobs.filter((job, i) => !job.finished && !jobs.slice(0, i).some(x => !x.finished && x.key === job.key))
const activeFor = dir => {
  const root = rootOf(dir)
  return heads().filter(job => job.root === root && job.headStarted)
    .map(job => ({ name: job.name, runId: job.runId, label: job.label, detail: job.detail ?? null, detailTruncated: !!job.detailTruncated,
      stopping: job.stopping, phase: job.phase, blockedBy: job.blockedBy, chain: chainInfo(job),
      startedAt: job.startedAt, activeAt: job.activeAt }))
}
const orphanFor = dir => {
  const root = rootOf(dir)
  return orphans.filter(lock => lock.root === root).map(({ name, runId, scope, state }) => ({ name, runId, owns: core.ownsList(scope), readOnly: scope.readOnly, state }))
}
const chainInfo = job => job.chain ? { turns: job.chain.turns, limit: job.chain.chainLimit, costUsd: job.chain.costUsd, costIncomplete: !!job.chain.costIncomplete } : null
// activeAt: the last new step (CLI progress or a phase change), so the UI can tell a long silence from a busy turn
function progress(job, label = job.label, extra) {
  if (extra !== undefined) {
    job.detail = extra.detail ?? null
    job.detailTruncated = !!extra.detailTruncated
  } else if (label !== job.label) {
    job.detail = null
    job.detailTruncated = false
  }
  job.label = label
  job.activeAt = Date.now()
  win?.webContents.send('progress', job.dir, job.name,
    { runId: job.runId, label, detail: job.detail ?? null, detailTruncated: !!job.detailTruncated,
      phase: job.phase, blockedBy: job.blockedBy || [], stopping: job.stopping, chain: chainInfo(job),
      startedAt: job.startedAt, activeAt: job.activeAt })
}

async function terminal(job, result, waiting = false) {
  const text = result.outcome === 'stopped' ? `@${job.name} đã bị dừng${waiting ? ' khi chờ' : ''}`
    : result.outcome === 'timeout' ? `@${job.name} quá giờ${waiting ? ' khi chờ khóa' : ''}`
      : result.outcome === 'error' ? `@${job.name} lỗi: ${result.text}` : result.text
  const msg = await post(job.dir, result.outcome === 'success' ? job.name : 'system', text,
    { runId: job.runId, agent: job.name, cli: job.agent.cli, ...(result.model ? { model: result.model } : {}), outcome: result.outcome, usage: result.usage,
      chainId: job.chain?.id || null, sourceSeqs: (job.sourceRefs || []).map(r => r.seq),
      contextInputTokens: result.contextInputTokens ?? null,
      ...(result.taskUpdates?.length ? { taskUpdates: result.taskUpdates } : {}),
      ...(result.commandResults?.length ? { commandResults: result.commandResults } : {}), ...(result.logExtra || {}) },
    result.taskChanges ? { taskChanges: result.taskChanges, actor: job.name } : {})
  if (msg.taskUpdates) result.taskUpdates = msg.taskUpdates
  if (msg.taskError) result.taskError = msg.taskError
  return msg
}

function removeJob(job) {
  clearTimeout(job.timer)
  job.finished = true
  const i = jobs.indexOf(job)
  if (i >= 0) jobs.splice(i, 1)
  if (job.headStarted) win?.webContents.send('status', job.dir, job.name, false, job.runId)
  const next = jobs.find(x => !x.finished && x.key === job.key)
  if (next && !next.headStarted) startHead(next)
  pump()
}

async function finishWaiting(job, outcome, text) {
  if (job.finished) return
  job.finished = true
  const result = { outcome, text, usage: zeroUsage() }
  try { await terminal(job, result, outcome === 'stopped' || outcome === 'timeout') }
  finally {
    recordChainTurn(job, result, [], [], true)
    if (job.chain) {
      job.chain.runningJobs.delete(job.runId)
      if (job.chain.runningJobs.size === 0 && job.chain.state === 'halting') {
        job.chain.state = 'stopped'
        saveStopRecord(job.root, job.chain)
      }
    }
    removeJob(job)
  }
}

function stopJob(job, reason) {
  if (job.finished) return false
  if (job.phase === 'queued') {
    finishWaiting(job, reason === 'timeout' ? 'timeout' : 'stopped', '').catch(e => console.error(e))
    return true
  }
  job.stopping = true
  progress(job, 'đang dừng…')
  if (job.phase === 'checking') {
    if (!job.auditController.signal.aborted) job.auditController.abort('stopped')
  } else if (!job.controller.signal.aborted) job.controller.abort(reason)
  return true
}

const activeChains = new Map()

const newChain = (root, options = {}) => {
  const { chainLimit, costCeiling } = core.projectSettings(root).settings
  const id = options.id || randomUUID()
  const chain = {
    id,
    root,
    stopId: options.stopId || id,
    turns: 0,
    reservedTurns: 0,
    costUsd: 0,
    costIncomplete: false,
    chainLimit: typeof options.chainLimit === 'number' ? options.chainLimit : chainLimit,
    costCeiling: typeof options.costCeiling === 'number' ? options.costCeiling : costCeiling,
    threshold: 3,
    idleStreak: 0,
    idleRunIds: [],
    accountedRuns: new Set(),
    completedRuns: new Set(),
    seenProofs: new Set(),
    seenContentKeys: new Set(),
    milestones: new Map(),
    dispatchedKeys: new Set(),
    pending: [],
    runningJobs: new Map(),
    state: 'active',
    haltReason: null,
    stopPosted: false,
    revision: 1
  }
  activeChains.set(chain.id, chain)
  return chain
}

const sourceRef = msg => ({ seq: msg.seq, at: msg.at, textHash: createHash('sha256').update(msg.text || '').digest('hex') })
function mergePending(list, item) {
  let p = list.find(p => p.agent === item.agent && !!p.uncertain === !!item.uncertain && (p.runId || null) === (item.runId || null))
  if (!p) { p = { ...item, sourceRefs: [], taskIds: [] }; list.push(p) }
  for (const ref of item.sourceRefs || []) if (!p.sourceRefs.some(r => r.seq === ref.seq)) p.sourceRefs.push(ref)
  p.taskIds = [...new Set([...p.taskIds, ...(item.taskIds || [])])]
}
function storedPending(record) {
  return structuredClone(record.pending || (record.state?.pending || []).map(p => ({ ...p,
    sourceRefs: (p.sourceSeqs || []).map(seq => (record.sourceRefs || []).find(r => r.seq === seq)).filter(Boolean) })))
}
async function sourceMessages(root, refs) {
  if (!Array.isArray(refs) || !refs.length) throw gitError('UNAVAILABLE', 'Thiếu tin nguồn của công việc đang chờ')
  const messages = []
  for (const ref of refs) {
    if (!ref || !Number.isInteger(ref.seq) || !ref.at || !ref.textHash) throw gitError('UNAVAILABLE', 'Tham chiếu tin nguồn không hợp lệ')
    const msg = (await core.logPage(root, { around: ref.seq, limit: 1 })).messages[0]
    if (!msg || msg.seq !== ref.seq || msg.retracted || msg.at !== ref.at || sourceRef(msg).textHash !== ref.textHash)
      throw gitError('UNAVAILABLE', 'Tin nguồn đã thay đổi hoặc bị thu hồi; hãy kiểm tra lịch sử')
    messages.push(msg)
  }
  return messages.sort((a, b) => a.seq - b.seq)
}
async function findChainStop(root, id) {
  const index = await core.getLogIndex(root)
  if (index.error) throw gitError('UNAVAILABLE', 'Lịch sử lỗi; không thể xác minh Tiếp tục')
  const seq = Number.isInteger(id) ? id : index.records.findIndex(r => r.kind === 'chain-stop' && (r.stopId === id || r.chainId === id || r.runId === id))
  if (!Number.isInteger(seq) || seq < 0) throw gitError('INVALID_ARGUMENT', 'Không tìm thấy thẻ dừng')
  const stop = (await core.logPage(root, { around: seq, limit: 1 })).messages[0]
  if (stop?.seq !== seq || stop.kind !== 'chain-stop') throw gitError('INVALID_ARGUMENT', 'Không tìm thấy thẻ dừng')
  return stop
}
const stopKey = stop => stop.stopId || stop.chainId || stop.runId || String(stop.seq)
const controlRecovery = new Map()
async function withChainOperation(root, fn) {
  routing.set(root, (routing.get(root) || 0) + 1)
  try { return await fn() }
  finally { if (routing.get(root) > 1) routing.set(root, routing.get(root) - 1); else routing.delete(root) }
}
function recoverChainControl(root) {
  const key = core.chat(root)
  if (controlRecovery.has(key)) return controlRecovery.get(key)
  const work = withChainOperation(root, async () => {
    const store = readControlStore(root)
    if (store.corrupted) throw gitError('UNAVAILABLE', 'File điều phối hỏng; không thể xác minh Tiếp tục')
    const index = await core.getLogIndex(root)
    if (index.error) throw gitError('UNAVAILABLE', 'Lịch sử lỗi; không thể khôi phục điều phối')
    const terminals = new Map(index.records.flatMap((r, seq) => r.runId && r.outcome ? [[r.runId, { ...r, seq }]] : []))
    for (const claim of Object.values(store.claims)) {
      if (claim.kind !== 'continue' || activeChains.has(claim.childChainId)) continue
      if (!claim.childChainId || !Array.isArray(claim.dispatches)) throw gitError('UNAVAILABLE', 'Claim Tiếp tục thiếu dữ kiện')
      const parent = store.stops[claim.stopId]
      if (!parent?.state) throw gitError('UNAVAILABLE', 'Claim Tiếp tục không còn checkpoint cha')
      await sourceMessages(root, [parent.logMessageRef])
      const notice = index.records.find(r => r.kind === 'chain-continue' && (r.stopId === claim.stopId || r.continuedFrom === parent.logMessageRef.seq))
      if (notice?.childChainId && notice.childChainId !== claim.childChainId) throw gitError('UNAVAILABLE', 'Claim và lịch sử Tiếp tục không khớp')
      if (!notice) await postOnce(root, 'continue:' + claim.stopId, 'system', 'Khôi phục trạng thái Tiếp tục đã nhận; không tự chạy lại agent.',
        { kind: 'chain-continue', stopId: claim.stopId, childChainId: claim.childChainId, continuedFrom: parent.logMessageRef.seq, targets: claim.dispatches.map(d => d.agent) })
      const pending = []
      for (const d of claim.dispatches) {
        const terminal = terminals.get(d.runId)
        if (terminal) continue // An accepted terminal is never replayed, regardless of the last dispatch checkpoint.
        const source = storedPending(parent).find(p => p.agent === d.agent)
        mergePending(pending, { agent: d.agent, sourceRefs: d.sourceRefs || source?.sourceRefs || [], taskIds: d.taskIds || source?.taskIds || [],
          uncertain: d.state !== 'reserved' || !!d.runId, runId: d.runId || null })
      }
      // A terminal may have been appended before its outgoing routing was checkpointed.
      // Keep such referrals visible as uncertain; never infer that a missing terminal means no dispatch.
      const ended = [...terminals.values()].filter(t => t.chainId === claim.childChainId || claim.dispatches.some(d => d.runId === t.runId))
      let knownCost = 0
      if (!store.stops[claim.childChainId]) for (const terminal of ended) {
        const msg = (await core.logPage(root, { around: terminal.seq, limit: 1 })).messages[0]
        if (Number.isFinite(msg.usage?.costUsd) && msg.usage.costUsd >= 0) knownCost += msg.usage.costUsd
        if (terminal.outcome === 'success') for (const agent of core.mentions(msg.text, core.team(root), msg.from)) {
          if (!ended.some(t => t.from === agent.name && t.sourceSeqs?.includes(terminal.seq)))
            mergePending(pending, { agent: agent.name, sourceRefs: [sourceRef(msg)], taskIds: [], uncertain: true })
        }
      }
      updateControlStore(root, latest => {
        const p = latest.stops[claim.stopId]
        if (p.state.phase !== 'continued' || p.state.continuedTo !== claim.childChainId) {
          p.state = { ...p.state, phase: 'continued', canContinue: false, continuedTo: claim.childChainId, revision: String(Number(p.state.revision || 0) + 1) }
        }
        if (pending.length && !latest.stops[claim.childChainId]) {
          latest.stops[claim.childChainId] = { stopId: claim.childChainId, chainId: claim.childChainId, pending, running: [], accountedRunIds: ended.map(t => t.runId), sourceRefs: pending.flatMap(p => p.sourceRefs), logMessageRef: null,
            state: { ...p.state, stopId: claim.childChainId, chainId: claim.childChainId, revision: '1', phase: 'interrupted', continuedTo: null,
              reason: { code: 'restart-interrupted', text: 'Tiếp tục bị gián đoạn. Kiểm tra lượt chưa rõ kết quả; phần chưa chạy vẫn được giữ.' },
              turns: Math.max(ended.length, claim.dispatches.filter(d => d.state !== 'reserved').length), costUsd: knownCost, costIncomplete: true, running: [], pending: [], canContinue: false } }
        }
      })
    }
    for (const saved of Object.values(readControlStore(root).stops)) {
      if (!saved?.state || activeChains.has(saved.chainId)) continue
      if (saved.state.phase === 'continued') continue
      const pending = storedPending(saved), running = []
      const accounted = new Set(saved.accountedRunIds || [])
      let costUsd = saved.state.costUsd, costIncomplete = saved.state.costIncomplete
      for (const run of saved.running || saved.state.running || []) {
        const terminal = terminals.get(run.runId)
        if (terminal) {
          const msg = (await core.logPage(root, { around: terminal.seq, limit: 1 })).messages[0]
          if (!accounted.has(run.runId)) {
            const cost = msg.usage?.costUsd
            // Old checkpoints cannot tell whether this cost was already included.
            if (!saved.accountedRunIds) costIncomplete = true
            else {
              if (Number.isFinite(cost) && cost >= 0) costUsd += cost
              if (msg.usage?.partial || !Number.isFinite(cost) || cost < 0) costIncomplete = true
            }
            accounted.add(run.runId)
          }
          if (terminal.outcome === 'success') {
            for (const agent of core.mentions(msg.text, core.team(root), msg.from)) mergePending(pending, { agent: agent.name, sourceRefs: [sourceRef(msg)], taskIds: [], uncertain: false })
          }
        } else {
          mergePending(pending, { agent: run.agent, runId: run.runId, sourceRefs: run.sourceRefs || [], taskIds: run.taskIds || [], uncertain: true })
          if (orphans.some(o => o.root === root && o.runId === run.runId)) running.push(run)
        }
      }
      const remaining = pending.filter(p => !p.uncertain || !p.runId || !terminals.has(p.runId))
      let invalid = null
      try {
        if (saved.logMessageRef) await sourceMessages(root, [saved.logMessageRef])
        for (const p of remaining.filter(p => !p.uncertain)) await sourceMessages(root, p.sourceRefs)
      } catch (e) { invalid = e.message }
      const interrupted = saved.state.phase === 'draining' || saved.state.phase === 'interrupted' || remaining.some(p => p.uncertain) || orphans.some(o => o.root === root)
      const view = { ...saved.state, costUsd, costIncomplete, phase: invalid ? 'unavailable' : interrupted ? 'interrupted' : 'ready',
        reason: invalid ? { code: 'restart-interrupted', text: invalid } : interrupted ? { code: 'restart-interrupted', text: 'Chuỗi bị gián đoạn; không tự chạy lại lượt chưa rõ kết quả. Kiểm tra log và khóa cũ.' } : saved.state.reason,
        pending: remaining.map(p => ({ agent: p.agent, sourceSeqs: p.sourceRefs.map(r => r.seq), taskIds: p.taskIds || [], uncertain: !!p.uncertain })),
        running: running.map(r => ({ agent: r.agent, runId: r.runId, phase: 'orphan' })),
        canContinue: !invalid && !running.length && !orphans.some(o => o.root === root) && remaining.some(p => !p.uncertain) }
      if (JSON.stringify(view) !== JSON.stringify(saved.state)) view.revision = String(Number(saved.state.revision || 0) + 1)
      updateControlStore(root, latest => {
        const r = latest.stops[saved.stopId]
        r.state = view; r.pending = remaining; r.running = running; r.sourceRefs = remaining.flatMap(p => p.sourceRefs); r.accountedRunIds = [...accounted]
      })
      if (!saved.logMessageRef) {
        const msg = await postOnce(root, 'chain-stop:' + saved.stopId, 'system', view.reason.text, { kind: 'chain-stop', stopId: saved.stopId, chainId: saved.chainId,
          targets: remaining.map(p => p.agent), canContinue: view.canContinue, continuationTarget: remaining.map(p => '@' + p.agent).join(' '), costUsd: view.costUsd, costIncomplete: view.costIncomplete })
        updateControlStore(root, latest => { latest.stops[saved.stopId].logMessageRef = sourceRef(msg) })
      }
      if (view.revision !== saved.state.revision) win?.webContents.send('chain-changed', root, view)
    }
  }).finally(() => controlRecovery.delete(key))
  controlRecovery.set(key, work)
  return work
}
async function chainStopRecord(root, stop) {
  const id = stopKey(stop), store = readControlStore(root)
  if (store.corrupted) throw gitError('UNAVAILABLE', 'File điều phối hỏng')
  if (store.stops[id]) {
    // The log append can be visible before haltChain saves its returned reference.
    // Bind only the matching, verified log entry, never infer that the stop is unused.
    if (!store.stops[id].logMessageRef && stop.chainId === store.stops[id].chainId) {
      await sourceMessages(root, [sourceRef(stop)])
      updateControlStore(root, latest => { latest.stops[id].logMessageRef ||= sourceRef(stop) })
    }
    await sourceMessages(root, [readControlStore(root).stops[id].logMessageRef])
    return readControlStore(root).stops[id]
  }
  if (stop.stopId || stop.chainId) throw gitError('UNAVAILABLE', 'Thiếu checkpoint của thẻ dừng; không cấp lại mù')
  const index = await core.getLogIndex(root)
  const continued = index.records.find(r => r.kind === 'chain-continue' && r.continuedFrom === stop.seq)
  if (continued && !continued.childChainId) throw gitError('UNAVAILABLE', 'Không thể xác định chuỗi đã tiếp tục')
  const pending = (stop.targets || []).map(agent => ({ agent, sourceRefs: [sourceRef(stop)], taskIds: [], uncertain: false }))
  const chain = newChain(root, { id }); chain.pending = pending; chain.state = continued ? 'continued' : 'stopped'; chain.continuedTo = continued?.childChainId
  chain.haltReason = { code: 'restart-interrupted', text: stop.text || 'Dừng chuỗi' }
  saveStopRecord(root, chain, stop)
  return readControlStore(root).stops[id]
}

function getChainView(root, chain) {
  const pending = (chain.pending || []).map(p => ({
    agent: p.agent,
    sourceSeqs: (p.sourceRefs || []).map(r => r.seq).filter(Number.isInteger),
    taskIds: p.taskIds || [],
    uncertain: !!p.uncertain
  }))
  const running = Array.from((chain.runningJobs || new Map()).values()).map(j => ({
    agent: j.agent,
    runId: j.runId,
    phase: j.phase || 'running'
  }))
  const isDraining = (running.length > 0 || chain.reservedTurns > 0) && chain.state === 'halting'
  const isContinued = chain.state === 'continued'
  let phase = 'ready'
  if (isContinued) phase = 'continued'
  else if (isDraining) phase = 'draining'
  else if (chain.state === 'stopped' || chain.state === 'halting') phase = 'ready'
  if (phase === 'ready' && (pending.some(p => p.uncertain) || orphans.some(o => o.root === root))) phase = 'interrupted'
  const canContinue = ['ready', 'interrupted'].includes(phase) && pending.some(p => !p.uncertain) && !orphans.some(o => o.root === root)
  return {
    stopId: chain.stopId || chain.id,
    chainId: chain.id,
    box: core.chatName(root),
    revision: String(chain.revision || 1),
    phase,
    reason: chain.haltReason || { code: 'no-progress', text: 'Dừng chuỗi' },
    threshold: 3,
    idleRunIds: chain.idleRunIds ? [...chain.idleRunIds] : [],
    turns: chain.turns,
    limit: chain.chainLimit,
    costUsd: chain.costUsd,
    costIncomplete: !!chain.costIncomplete,
    pending,
    running,
    canContinue,
    continuedTo: chain.continuedTo || null
  }
}

function saveStopRecord(root, chain, lastMsg = null) {
  chain.revision = (chain.revision || 1) + 1
  const view = getChainView(root, chain)
  updateControlStore(root, store => {
    const stopId = chain.stopId || chain.id
    store.stops[stopId] = {
      stopId,
      chainId: chain.id,
      state: view,
      pending: structuredClone(chain.pending),
      running: Array.from(chain.runningJobs.values()).map(j => ({ ...j })),
      accountedRunIds: [...chain.accountedRuns],
      sourceRefs: chain.pending.flatMap(p => p.sourceRefs || []),
      logMessageRef: lastMsg ? { seq: lastMsg.seq, at: lastMsg.at, textHash: createHash('sha256').update(lastMsg.text || '').digest('hex') } : (store.stops[stopId]?.logMessageRef || null),
      at: new Date().toISOString()
    }
  })
  win?.webContents.send('chain-changed', root, view)
}

async function haltChain(dir, chain, reason, targets) {
  const root = rootOf(dir)
  chain.state = 'halting'
  chain.stopPosted = true
  chain.stopId = chain.id
  if (!chain.haltReason) {
    chain.haltReason = typeof reason === 'string' ? { code: 'no-progress', text: reason } : reason
  }
  for (const t of targets) {
    let p = chain.pending.find(item => item.agent === t.name)
    if (!p) {
      p = { agent: t.name, sourceRefs: [], taskIds: [], uncertain: false }
      chain.pending.push(p)
    }
  }
  const names = [...new Set(targets.map(agent => agent.name))]
  // Persist the checkpoint before publishing; recovery can finish a missing notification.
  saveStopRecord(root, chain)
  const stopMsg = await postOnce(dir, 'chain-stop:' + chain.stopId, 'system', chain.haltReason.text, {
    kind: 'chain-stop',
    canContinue: true,
    stopId: chain.stopId,
    chainId: chain.id,
    targets: names,
    continuationTarget: names.map(name => `@${name}`).join(' '),
    costUsd: chain.costUsd,
    costIncomplete: !!chain.costIncomplete
  })
  saveStopRecord(root, chain, stopMsg)
  return stopMsg
}

// routes in flight per folder: a box switch waits for them, or their turns would read and post into the other box
const routing = new Map()
async function route(dir, msg, hops, chain = null) {
  const root = rootOf(dir)
  routing.set(root, (routing.get(root) || 0) + 1)
  try { return await routeTargets(dir, msg, hops, chain) }
  finally { if (routing.get(root) > 1) routing.set(root, routing.get(root) - 1); else routing.delete(root) }
}

async function routeTargets(dir, msg, hops, chain) {
  const root = rootOf(dir)
  const members = core.team(dir)
  let targets = core.mentions(msg.text, members, msg.from)
  if (msg.from === 'user' && !targets.length)
    targets = [members.find(a => String(a.name).toLowerCase() === 'pm') || members[0]].filter(Boolean)
  if (!targets.length) return
  chain ||= newChain(root)

  // 1. Check cost ceiling
  if (chain.costCeiling != null && chain.costUsd >= chain.costCeiling && chain.state === 'active') {
    chain.state = 'halting'
    chain.haltReason = { code: 'cost-ceiling', text: `Dừng chuỗi vì chi phí đã đạt USD ${chain.costCeiling.toFixed(4)}.` }
  }

  // 2. S2 Deduplication for agent messages
  let filteredTargets = targets
  if (msg.from !== 'user') {
    let cleanText = (msg.text || '').replace(/```task-status[\s\S]*?```/g, '').replace(/```run-command[\s\S]*?```/g, '').replace(/```handoff[\s\S]*?```/g, '')
    cleanText = cleanText.replace(/\r\n/g, '\n').trim()
    const sortedTargetNames = targets.map(t => t.name.toLowerCase()).sort().join(',')
    const board = await core.taskBoardIndexed(root)
    const definitions = board.error ? null : board.tasks.map(taskSemanticKey).sort().join(',')
    const contextKey = `${chain.currentContentKey || ''}\0${definitions}\0${chain.seenProofs.size}`
    filteredTargets = []
    for (const target of targets) {
      const dedupeKey = createHash('sha256').update(
        `${chain.id}\0${msg.from.toLowerCase()}\0${target.name.toLowerCase()}\0${sortedTargetNames}\0${cleanText}\0${contextKey}`
      ).digest('hex')
      if (chain.currentContentKey && definitions !== null && chain.dispatchedKeys.has(dedupeKey)) {
        continue
      }
      target._dedupeKey = dedupeKey
      filteredTargets.push(target)
    }
  }

  // If all targets are duplicates, no new work to dispatch or add to pending
  if (!filteredTargets.length) {
    if ((chain.state === 'halting' || chain.state === 'stopped') && chain.pending.length > 0 && !chain.stopPosted) {
      await haltChain(dir, chain, chain.haltReason || { code: 'no-progress', text: 'Dừng chuỗi sau 3 lượt không có tiến triển mới (chat qua lại).' }, chain.pending.map(p => ({ name: p.agent })))
    }
    return
  }

  // 3. If chain is halting or stopped, put filteredTargets into pending and ensure stop posted
  if (chain.state === 'halting' || chain.state === 'stopped') {
    for (const target of filteredTargets) {
      if (target._dedupeKey) chain.dispatchedKeys.add(target._dedupeKey)
      let p = chain.pending.find(item => item.agent === target.name)
      if (!p) {
        p = { agent: target.name, sourceRefs: [], taskIds: [], uncertain: false }
        chain.pending.push(p)
      }
      p.sourceRefs.push({ seq: msg.seq, at: msg.at, textHash: createHash('sha256').update(msg.text || '').digest('hex') })
    }
    if (!chain.stopPosted) {
      await haltChain(dir, chain, chain.haltReason || { code: 'no-progress', text: 'Dừng chuỗi sau 3 lượt không có tiến triển mới (chat qua lại).' }, chain.pending.map(p => ({ name: p.agent })))
    } else {
      saveStopRecord(root, chain)
    }
    return
  }

  // 4. Admission loop with reservedTurns
  for (let i = 0; i < filteredTargets.length; i++) {
    const target = filteredTargets[i]
    if (chain.turns + chain.reservedTurns >= chain.chainLimit) {
      chain.state = 'halting'
      chain.haltReason = { code: 'turn-limit', text: `Dừng sau ${chain.chainLimit} lượt agent liên tiếp.` }
      const remaining = filteredTargets.slice(i)
      for (const rem of remaining) {
        if (rem._dedupeKey) chain.dispatchedKeys.add(rem._dedupeKey)
        let p = chain.pending.find(item => item.agent === rem.name)
        if (!p) {
          p = { agent: rem.name, sourceRefs: [], taskIds: [], uncertain: false }
          chain.pending.push(p)
        }
        p.sourceRefs.push({ seq: msg.seq, at: msg.at, textHash: createHash('sha256').update(msg.text || '').digest('hex') })
      }
      if (!chain.stopPosted) {
        await haltChain(dir, chain, chain.haltReason, remaining)
      } else {
        saveStopRecord(root, chain)
      }
      return
    }
    chain.reservedTurns++
    if (target._dedupeKey) chain.dispatchedKeys.add(target._dedupeKey)
    try {
      await ask(dir, target, hops, null, chain, msg)
    } catch (e) {
      chain.reservedTurns = Math.max(0, chain.reservedTurns - 1)
      await post(dir, 'system', `Chưa gọi được @${target.name}: ${e.message}`, { kind: 'route-error', agent: target.name })
    }
    for (const job of jobs) if (job.chain === chain && job.headStarted && !job.finished) progress(job)
  }
}

// One job at a time per agent; different agents run in parallel.
function sharedMetadataLocks(scope, root) {
  const files = ['memory.md', 'tasks.json', 'tasks.json.tmp'].map(file => `${core.chatName(root)}/${file}`)
  return files.filter(file => scopeAllowsForJob(scope, file)).map(file => ({ path: path.join(root, ...file.split('/')), tree: false }))
}
const scopeAllowsForJob = (scope, file) => !scope.readOnly && (!scope.owns.length || core.scopeAllows(scope, file))

async function ask(dir, agent, hops, special = null, chain = null, trigger = null, retryContext = null, grantRequestId = null) {
  const root = rootOf(dir)
  // An agent that already has a turn waiting to start gets nothing from a second one: that turn builds its prompt
  // from the latest log when it starts. Without this, each extra @ ran a stale turn ("Chưa có tin mới nào gọi …").
  // Checked again right before the push: the awaits below let a second @ for the same agent slip in meanwhile.
  // what asked for this turn: a user message's seq (so taking that message back can cancel it), anything else 'other'
  const reason = !special && !retryContext && !grantRequestId && trigger?.from === 'user' && Number.isInteger(trigger.seq) ? trigger.seq : 'other'
  const waitingTurn = () => {
    if (special?.kind === 'summary' || retryContext || grantRequestId) return null
    const waiting = jobs.find(job => job.key === runKey(root, agent.name) && job.chain === chain
      && !job.finished && job.phase === 'queued' && !job.kind)
    if (waiting) {
      waiting.reasons.add(reason)
      if (trigger && !waiting.sourceRefs.some(r => r.seq === trigger.seq)) waiting.sourceRefs.push(sourceRef(trigger))
    }
    return waiting
  }
  let waiting = waitingTurn()
  if (waiting) {
    if (chain) chain.reservedTurns = Math.max(0, chain.reservedTurns - 1)
    return waiting
  }
  const reserved = permissionReservations.get(permissionKey(root, agent.name))
  if (reserved && reserved.id !== grantRequestId) throw gitError('BUSY', `@${agent.name} đang cấp quyền`)
  if (!grantRequestId) clearPending(root, agent.name)
  let setupError
  try { await ensureTrustedConfig(root) } catch (e) { setupError = e.message }
  try { if (special?.kind !== 'summary' && !setupError) migrateTaskScope(dir) } catch (e) { if (String(agent.name).toLowerCase() === 'pm') setupError ||= `Không nâng được quyền task cho PM: ${e.message}` }
  agent = core.team(dir).find(a => a.name === agent.name) || agent
  if (special?.kind === 'summary') agent = { ...agent, effort: agent.effort && 'low', resume: false, allowedCommands: [], permissions: { mode: 'edit', allowTools: [], networkAccess: false }, owns: [], readOnly: true }
  const scope = core.normalizeScope(agent, root)
  let workspace = { cwd: root, workspaceId: null, branch: null, worktree: false }
  if (special?.kind !== 'summary' && !setupError) try { workspace = await prepareWorkspace(root, agent) } catch (e) { setupError ||= e.message } // unconfirmed config creates no worktrees
  let taskIds = [], taskSemanticKeys = {}
  if (special?.kind !== 'summary') try {
    const board = await core.taskBoardIndexed(root)
    if (!board.error) for (const task of board.tasks) {
      const key = taskSemanticKeys[task.id] = `${task.id}:${taskSemanticKey(task)}`
      if (chain && !chain.milestones.has(key)) chain.milestones.set(key, TASK_MILESTONES[task.status] ?? 0)
      if (task.assignee === agent.name && task.status !== 'done') taskIds.push(task.id)
    }
  } catch {}
  if (grantRequestId) {
    const grant = permissionReservations.get(permissionKey(root, agent.name))
    if (!grant || grant.id !== grantRequestId) throw gitError('CANCELLED', 'Thao tác cấp quyền đã bị huỷ')
    if (grant.retryRevision !== core.teamRevision(root) || grant.generation !== logGenerations.get(root)
      || grant.workspaceId !== workspace.workspaceId) throw gitError('CONFLICT', 'Dự án đã thay đổi sau khi lưu quyền')
  }
  const capturedTrigger = trigger && typeof trigger.from === 'string' && typeof trigger.text === 'string' && Buffer.byteLength(trigger.text) <= 32768
    ? { from: trigger.from, text: trigger.text, ...(Number.isInteger(trigger.seq) ? { seq: trigger.seq } : {}) } : null
  const job = { dir, root, name: agent.name, key: runKey(root, agent.name), runId: randomUUID(), seq: sequence++, hops,
    sourceRefs: trigger ? [sourceRef(trigger)] : [], taskSemanticKeys,
    agent: { ...agent, owns: core.ownsList(scope), readOnly: scope.readOnly, scopeNeedsReview: scope.scopeNeedsReview,
      allowedCommands: [...agent.allowedCommands], permissions: agent.permissions && typeof agent.permissions === 'object'
        ? { ...agent.permissions, allowTools: Array.isArray(agent.permissions.allowTools) ? [...agent.permissions.allowTools] : agent.permissions.allowTools } : agent.permissions,
      avatar: { ...agent.avatar } }, scope,
    locks: workspace.worktree ? sharedMetadataLocks(scope, root) : core.scopeLocks(scope, root), label: 'đang xếp hàng…', phase: 'queued', blockedBy: [], stopping: false,
    finished: false, headStarted: false, reserved: false, spawned: false, pgid: null, setupError,
    controller: new AbortController(), auditController: new AbortController(), timer: null, taskIds, chain, trigger: capturedTrigger, reasons: new Set([reason]),
    retryContext, ...workspace, ...(special || {}) }
  if ((waiting = waitingTurn())) {
    if (chain) chain.reservedTurns = Math.max(0, chain.reservedTurns - 1)
    return waiting
  }
  if (chain) {
    if (chain.state !== 'active') {
      chain.reservedTurns = Math.max(0, chain.reservedTurns - 1)
      let p = chain.pending.find(item => item.agent === agent.name)
      if (!p) {
        p = { agent: agent.name, sourceRefs: [], taskIds: [], uncertain: false }
        chain.pending.push(p)
      }
      if (trigger) p.sourceRefs.push(sourceRef(trigger))
      if (chain.stopPosted) saveStopRecord(root, chain)
      return null
    }
    chain.reservedTurns = Math.max(0, chain.reservedTurns - 1)
    chain.turns++
    chain.runningJobs.set(job.runId, { agent: job.name, runId: job.runId, phase: job.phase, sourceRefs: job.sourceRefs, taskIds })
  }
  jobs.push(job)
  if (heads().includes(job)) startHead(job)
  return job
}

async function scheduleSummary(dir) {
  const root = rootOf(dir)
  if (jobs.some(job => job.root === root && job.kind === 'summary') || summaryRetryAt.get(root) > Date.now()) return
  if (!core.configTrust(root).trusted) return // background work never pops the config dialog; the next agent turn will
  let batch
  try { batch = await core.summaryBatch(root) } catch (e) { console.error('Không kiểm tra được tóm tắt:', e); return }
  if (!batch || jobs.some(job => job.root === root && job.kind === 'summary')) return
  const pm = core.team(root).find(agent => String(agent.name).toLowerCase() === 'pm')
  if (!pm) {
    if (!summaryUnavailable.has(root)) { summaryUnavailable.add(root); await post(root, 'system', 'Không thể tự tóm tắt: nhóm chưa có PM.', { kind: 'summary-unavailable' }) }
    return
  }
  summaryUnavailable.delete(root)
  await ask(root, pm, 0, { kind: 'summary', summaryBatch: batch, initialPrompt: batch.prompt })
}

function startHead(job) {
  if (job.finished || job.headStarted) return
  job.headStarted = true
  job.startedAt = Date.now() // the turn's timeout counts from here too
  win?.webContents.send('status', job.dir, job.name, true, job.runId)
  progress(job)
  try { job.timer = setTimeout(() => stopJob(job, 'timeout'), core.timeoutMinutes(job.agent) * 60000) }
  catch (e) { return void finishWaiting(job, 'error', e.message).catch(error => console.error(error)) }
  if (job.setupError) return void finishWaiting(job, 'error', job.setupError).catch(error => console.error(error))
  if (job.scope.scopeNeedsReview) return void finishWaiting(job, 'error', 'Cần xác nhận phạm vi file trong Cài đặt trước khi chạy').catch(error => console.error(error))
  pump()
}

const conflict = (left, right) => {
  for (const a of left) for (const b of right) { const p = core.lockConflict(a, b); if (p) return p }
  return null
}
const displayPath = (job, file) => {
  if (!path.isAbsolute(file)) return file // already a readable pattern pair from lockConflict
  const relative = path.relative(job.root, file).split(path.sep).join('/')
  return relative && relative !== '..' && !relative.startsWith('../') ? relative : file
}

function blockers(job) {
  const out = []
  for (const old of orphans) {
    const file = old.root === job.root && old.name === job.name ? job.root : conflict(job.locks, old.locks)
    if (file) out.push({ name: old.name, runId: old.runId, path: displayPath(job, file), reason: 'orphan' })
  }
  for (const other of jobs) if (other !== job && other.reserved) {
    const file = conflict(job.locks, other.locks)
    if (file) out.push({ name: other.name, runId: other.runId, path: displayPath(job, file), reason: 'scope' })
  }
  for (const older of heads()) if (older !== job && older.phase === 'queued' && older.seq < job.seq) {
    const file = conflict(job.locks, older.locks)
    if (file) out.push({ name: older.name, runId: older.runId, path: displayPath(job, file), reason: 'previous' })
  }
  return out
}

function pump() {
  if (pumping) { pumpAgain = true; return }
  pumping = true
  try {
    let claimed
    do {
      claimed = false
      for (const job of heads()) if (job.headStarted && job.phase === 'queued' && !job.finished) {
        const blocked = blockers(job)
        if (blocked.length) {
          job.blockedBy = blocked
          progress(job, `chờ ${blocked[0].name} (${blocked[0].path})`)
          continue
        }
        job.blockedBy = []
        job.phase = 'running'
        job.reserved = true
        job.claimedAt = new Date().toISOString()
        progress(job, 'đang kiểm tra file…')
        try { persistRegistry(job.root) }
        catch (e) { job.reserved = false; finishWaiting(job, 'error', `Không lưu được khóa: ${e.message}`).catch(error => console.error(error)); continue }
        claimed = true
        executeJob(job).catch(e => failJob(job, e)).catch(e => console.error(e))
      }
    } while (claimed)
  } finally {
    pumping = false
    if (pumpAgain) { pumpAgain = false; queueMicrotask(pump) }
  }
}

async function failJob(job, error) {
  if (job.finished) return
  console.error(`Lượt @${job.name} lỗi ngoài dự kiến:`, error)
  const result = { outcome: 'error', text: error.message, usage: zeroUsage() }
  try { await terminal(job, result); if (job.spawned) await warning(job, [], false) }
  finally {
    recordChainTurn(job, result, [], [], false)
    if (job.chain) {
      job.chain.runningJobs.delete(job.runId)
      if (job.chain.runningJobs.size === 0 && job.chain.state === 'halting') {
        job.chain.state = 'stopped'
        saveStopRecord(job.root, job.chain)
      }
    }
    const state = job.spawned ? orphanState(job.pgid) : 'dead'
    if (state === 'dead') releaseReservation(job); else keepOrphan(job, state)
    removeJob(job)
  }
}

async function warning(job, paths, auditComplete) {
  if (auditComplete && !paths.length) return
  const shown = paths.slice(0, 10).join(', '), more = paths.length > 10 ? ` và ${paths.length - 10} file khác` : ''
  const text = auditComplete
    ? `Phát hiện file ngoài phạm vi thay đổi trong thời gian lượt @${job.name}; chưa xác định tác nhân, có lượt khác/editor có thể đang ghi: ${shown}${more}`
    : `Không thể kiểm tra đầy đủ thay đổi file trong thời gian lượt @${job.name}.`
  await post(job.dir, 'system', text, { kind: 'scope-warning', relatedRunId: job.runId, paths, auditComplete, attribution: 'unverified' })
}

function recordChainTurn(job, result, changed, metadataChanged, auditComplete, beforeContentKey = null, afterContentKey = null) {
  const chain = job.chain
  if (!chain) return
  if (!chain.accountedRuns) chain.accountedRuns = new Set()
  if (!chain.accountedRuns.has(job.runId)) {
    chain.accountedRuns.add(job.runId)
    const cost = result?.usage?.costUsd
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) {
      chain.costUsd += cost
    }
    if (result?.usage?.partial || typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      chain.costIncomplete = true
    }
  }
  if (!chain.completedRuns) chain.completedRuns = new Set()
  if (chain.completedRuns.has(job.runId)) return
  if (result.outcome !== 'success') return
  chain.completedRuns.add(job.runId)
  if (chain.state !== 'active') return // Late results retain cost, but cannot reset or grow a halted chain's tracking sets.

  let hasNewProof = false
  const remember = proof => {
    if (chain.seenProofs.has(proof) || chain.seenProofs.size >= 8192) return false
    chain.seenProofs.add(proof)
    return true
  }
  // 1. Source changes
  if (auditComplete && !job.scope.readOnly && changed.length > 0 && afterContentKey && afterContentKey !== beforeContentKey) {
    if (!chain.seenContentKeys.has(afterContentKey)) {
      chain.seenContentKeys.add(afterContentKey)
      const proof = 'source:' + afterContentKey
      if (remember(proof)) hasNewProof = true
    }
  }
  // 2. Task changes
  if (result.taskUpdates?.length) {
    for (const update of result.taskUpdates) {
      const ms = TASK_MILESTONES[update.status] ?? -1
      const taskKey = job.taskSemanticKeys?.[update.id] || update.id
      const currentMs = chain.milestones.get(taskKey) ?? -1
      if (ms > currentMs) {
        chain.milestones.set(taskKey, ms)
        if (remember(`task:${taskKey}:${ms}`)) hasNewProof = true
      }
    }
  }
  if (hasNewProof) {
    chain.idleStreak = 0
    chain.idleRunIds = []
  } else {
    chain.idleStreak = (chain.idleStreak || 0) + 1
    if (!chain.idleRunIds) chain.idleRunIds = []
    chain.idleRunIds.push(job.runId)
  }

  if (chain.seenProofs.size >= 8192 && chain.state === 'active') {
    chain.state = 'halting'
    chain.haltReason = { code: 'tracking-limit', text: 'Dừng chuỗi vì đã đạt giới hạn theo dõi (8192).' }
  } else if (chain.idleStreak >= chain.threshold && chain.state === 'active') {
    chain.state = 'halting'
    chain.haltReason = { code: 'no-progress', text: 'Dừng chuỗi sau 3 lượt không có tiến triển mới (chat qua lại).' }
  }
}
function permissionCandidate(job, result) {
  if (!job.trigger || job.kind || job.repairQueueId || result.orphanState || ['stopped', 'timeout'].includes(result.outcome)
    || !result.permissionDenials?.some(denial => denial.canGrant)) return null
  return { id: randomUUID(), root: job.root, agent: job.name, cli: job.agent.cli, workspaceId: job.workspaceId || null,
    sourceRunId: job.runId, denials: result.permissionDenials, trigger: job.trigger, teamRevision: core.teamRevision(job.root),
    generation: logGenerations.get(job.root), reserved: false }
}

async function executeJob(job) {
  let before, metadataBefore, result, paths = [], changed = [], metadataChanged = [], auditComplete = true, workspaceError, handoffError, pendingPermission
  let beforeContentKey = null, afterContentKey = null
  if (job.worktree) try { await startWorkspace(job) } catch (e) { result = { outcome: 'error', text: e.message, usage: zeroUsage() } }
  if (!result) try {
    before = await core.snapshot(job.cwd || job.root, { signal: job.controller.signal, excludeChat: job.worktree })
    beforeContentKey = computeContentKey(before, job.scope, job.root)
    if (job.chain && beforeContentKey) job.chain.seenContentKeys.add(beforeContentKey)
    if (job.worktree) metadataBefore = await core.snapshot(job.root, { signal: job.controller.signal, onlyChat: true })
  }
  catch (e) {
    const stopped = job.controller.signal.aborted
    if (stopped) result = { outcome: job.controller.signal.reason === 'timeout' ? 'timeout' : 'stopped', text: e.message, usage: zeroUsage() }
    else auditComplete = false
  }
  if (!result) {
    const latest = core.team(job.root).find(agent => agent.name === job.name), runAgent = latest
      ? { ...job.agent, sessionTokenLimit: latest.sessionTokenLimit, sessionConfigError: latest.sessionConfigError } : job.agent
    if (job.kind !== 'summary' && (runAgent.sessionConfigError || runAgent.permissionConfigError)) result = { outcome: 'error',
      text: runAgent.sessionConfigError || runAgent.permissionConfigError, usage: zeroUsage() }
    else result = await core.run(job.root, runAgent, {
      cwd: job.cwd || job.root, workspaceId: job.workspaceId,
      runId: job.runId, trackSession: job.kind !== 'summary', sessionTokenLimit: runAgent.sessionTokenLimit,
      signal: job.controller.signal,
      onProgress: (label, extra) => { if (!job.stopping) progress(job, label, extra) },
      onSpawn: pid => { job.spawned = true; job.pgid = pid; persistRegistry(job.root) },
      onSessionChanged: () => { try { emitSessions(job.root) } catch (e) { console.error('Không gửi được trạng thái phiên:', e) } },
      ...(job.retryContext ? { retryContext: job.retryContext } : {}),
      ...(job.initialPrompt ? { initialPrompt: job.initialPrompt } : {}),
      appContext: { continuationSources: job.continuationSources },
    })
  }
  clearTimeout(job.timer)
  if (job.spawned && !result.orphanState) {
    job.phase = 'checking'
    job.stopping = false
    progress(job, 'đang kiểm tra file…')
    try {
      if (!before) throw new Error('Không có snapshot ban đầu')
      const after = await core.snapshot(job.cwd || job.root, { signal: job.auditController.signal, excludeChat: job.worktree })
      afterContentKey = computeContentKey(after, job.scope, job.root)
      if (job.chain && afterContentKey) job.chain.currentContentKey = afterContentKey
      changed = core.changedPaths(before, after)
      paths = changed.filter(file => !core.scopeAllows(job.scope, file))
      // a file still being written (e.g. by a leftover child process) can't be audited, so it is never auto-committed
      const settled = snap => ![...snap.values()].some(value => value.startsWith('changing:'))
      if (!settled(before) || !settled(after)) auditComplete = false
      if (job.worktree) {
        if (!metadataBefore) throw new Error('Không có snapshot metadata ban đầu')
        const metadataAfter = await core.snapshot(job.root, { signal: job.auditController.signal, onlyChat: true })
        metadataChanged = core.changedPaths(metadataBefore, metadataAfter)
        if (!settled(metadataBefore) || !settled(metadataAfter)) auditComplete = false
        paths.push(...metadataChanged.filter(file => !core.scopeAllows(job.scope, file)))
      }
      if (job.worktree && paths.length) {
        const probe = await repoProbe(job.root).catch(() => null)
        if (probe?.sha) {
          const diff = nul((await git(job.cwd, ['diff', '--no-renames', '--name-only', '-z', probe.sha]).catch(() => ({ stdout: '' }))).stdout)
          const untracked = nul((await git(job.cwd, ['ls-files', '--others', '--exclude-standard', '-z']).catch(() => ({ stdout: '' }))).stdout)
          const diffSet = new Set([...diff, ...untracked])
          paths = paths.filter(file => isChatPath(file) || diffSet.has(file))
        }
      }
    } catch { auditComplete = false }
    if (job.auditController.signal.aborted) {
      result.outcome = 'stopped'
      result.text = '(đã dừng khi kiểm tra file)'
      result.usage.partial = true
      auditComplete = false
    }
  } else if (result.orphanState) auditComplete = false

  let msg, taskError, routeNext = false, workspace = null
  let parsedTaskChanges = null

  if (job.kind === 'summary') {
    try {
      if (result.outcome === 'success') {
        if (result.emptyResponse) throw new Error('PM không trả nội dung tóm tắt')
        const summary = await core.acceptSummary(job.root, job.summaryBatch, result.text, job.runId)
        result.logExtra = { kind: 'summary', summary }
        result.text = `Đã cập nhật [tóm tắt lịch sử](${core.chatName(job.root)}/summary.md) đến tin ${summary.through}.`
      }
      msg = await terminal(job, result)
      if (result.logExtra?.summary) {
        try { core.materializeSummary(job.root, result.logExtra.summary); notifyProjectChanged(job.root, { files: true, file: `${core.chatName(job.root)}/summary.md` }) }
        catch (e) { console.error('Không ghi được summary.md; sẽ khôi phục khi mở box:', e) }
      }
      if (job.spawned) await warning(job, paths, auditComplete)
    } catch (e) {
      result = { ...result, outcome: 'error', text: e.message, usage: result.usage || zeroUsage() }
      await terminal(job, result)
    } finally {
      if (result.outcome !== 'success') summaryRetryAt.set(job.root, Date.now() + 30 * 60000)
      if (result.orphanState) keepOrphan(job, result.orphanState); else releaseReservation(job)
      removeJob(job)
    }
    return
  }

  if (result.outcome === 'success') {
    const parsed = core.parseTaskStatusBlock(result.text)
    if (parsed.error || parsed.changes) result.text = parsed.text || '(không có phản hồi)'
    if (parsed.error) taskError = parsed.error
    else if (parsed.changes) parsedTaskChanges = parsed.changes
    const handoff = core.parseHandoffBlock(result.text)
    if (handoff.requested) result.text = handoff.text || '(không có phản hồi)'
    if (handoff.error) handoffError = handoff.error
    else if (handoff.handoff) try { core.writeHandoff(job.root, job.name, job.workspaceId || null, job.runId, handoff.handoff) }
      catch (e) { handoffError = e.message }
  }

  if (job.worktree && job.baseSha && !result.orphanState) try {
    workspace = await commitWorkspace(job, result, changed, auditComplete, paths)
    if (workspace) result.logExtra = { ...(result.logExtra || {}), workspace }
  } catch (e) { workspaceError = e }

  if (parsedTaskChanges && !taskError) result.taskChanges = parsedTaskChanges // core checks revision and who may move what

  try {
    msg = await terminal(job, result)
    taskError ||= result.taskError

    if (workspace?.queuedEntryId || core.projectSettings(job.root).settings.worktreesEnabled) pumpMerge(job.root).catch(e => console.error(e))

    if (result.taskUpdates?.length) {
      const changes = result.taskUpdates.map(update => `${update.id} sang ${TASK_STATUS_LABELS[update.status]}`).join('; ')
      await post(job.dir, 'system', `${job.name} chuyển ${changes}.`, { kind: 'task-status-note', relatedRunId: job.runId })
      notifyProjectChanged(job.root, { tasks: true })
    }
    if (taskError) await post(job.dir, 'system', `Không cập nhật được task: ${taskError}`, { kind: 'task-status-error', relatedRunId: job.runId })
    if (handoffError) await post(job.dir, 'system', `Không lưu được bàn giao: ${handoffError}`, { kind: 'handoff-error', relatedRunId: job.runId })
    if (result.sessionRotation) {
      const handoff = result.sessionRotation.handoffStatus === 'missing' ? ' Không có bàn giao hợp lệ từ lượt trước.'
        : result.sessionRotation.handoffStatus === 'older' ? ' Dùng bàn giao từ lượt cũ hơn.' : ''
      const tokens = result.sessionRotation.contextInputTokens?.toLocaleString('vi-VN') ?? 0
      const limit = result.sessionRotation.limit?.toLocaleString('vi-VN') ?? 0
      await post(job.dir, 'system', `${job.name} mở phiên mới: ngữ cảnh bước cuối lượt trước ${tokens} token, vượt ngưỡng ${limit}.${handoff}`,
        { kind: 'session-rotated', relatedRunId: job.runId, contextInputTokens: result.sessionRotation.contextInputTokens, limit: result.sessionRotation.limit })
    }
    if (workspaceError) await post(job.dir, 'system', `Không thể tạo commit cho @${job.name}: ${workspaceError.message}`,
      { kind: 'merge', owner: job.name, relatedRunId: job.runId, error: { code: workspaceError.code || 'GIT_ERROR', message: workspaceError.message,
        files: workspaceError.files || [], log: '' } })
    if (job.spawned) await warning(job, paths, auditComplete)
    recordChainTurn(job, result, changed, metadataChanged, auditComplete, beforeContentKey, afterContentKey)
    if (result.permissionDenials?.length) {
      pendingPermission = permissionCandidate(job, result)
      await post(job.dir, 'system', `${job.name} bị từ chối quyền: ${result.permissionDenials.map(denial => denial.label).join('; ')}`,
        { kind: 'permission-denied', relatedRunId: job.runId, agent: job.name, cli: job.agent.cli, workspaceId: job.workspaceId || null,
          permissionRequestId: pendingPermission?.id || null, denials: result.permissionDenials })
    }
    routeNext = result.outcome === 'success'
  } finally {
    if (result.orphanState) keepOrphan(job, result.orphanState)
    else releaseReservation(job)
    removeJob(job)
  }
  // after releasing: routing may wait on the config dialog, and this finished turn must not hold its locks meanwhile
  if (routeNext) await route(job.dir, msg, job.hops + 1, job.chain).catch(e => console.error(e))
  if (job.chain) {
    job.chain.runningJobs.delete(job.runId)
    if (job.chain.runningJobs.size === 0 && job.chain.state === 'halting') {
      job.chain.state = 'stopped'
      saveStopRecord(job.root, job.chain)
    }
  }
  if (pendingPermission && pendingValid(pendingPermission)) {
    pendingPermissions.set(permissionKey(job.root, job.name), pendingPermission)
    emitPermissions(job.root)
  }
  scheduleSummary(job.root).catch(e => console.error(e))
}

const registryFile = root => core.chat(root, 'locks.json')
function registryRecords(root) {
  const live = jobs.filter(j => j.root === root && j.reserved).map(j => ({ runId: j.runId, name: j.name, owns: core.ownsList(j.scope),
    readOnly: j.scope.readOnly, locks: j.locks, pgid: j.pgid, startedAt: j.claimedAt, workspaceId: j.workspaceId || null,
    kind: 'agent', cwd: j.workspaceId ? j.cwd : root }))
  const old = orphans.filter(o => o.root === root).map(o => ({ runId: o.runId, name: o.name, owns: core.ownsList(o.scope),
    readOnly: o.scope.readOnly, locks: o.locks, pgid: o.pgid, startedAt: o.startedAt, workspaceId: o.workspaceId || null,
    kind: o.kind || 'agent', cwd: o.cwd || root }))
  const integration = [...mergeControllers.entries()].filter(([key]) => key === root).map(([, value]) => ({ runId: value.entry.id,
    name: value.entry.agent, owns: [], readOnly: false, locks: [{ path: root, tree: true }], pgid: value.entry.pgid,
    startedAt: value.entry.updatedAt, workspaceId: null, kind: 'integration', cwd: managedPath(root, 'integration', value.entry.id) }))
  return [...live, ...old, ...integration]
}
function persistRegistry(root) {
  core.atomicWrite(registryFile(root), JSON.stringify({ version: 2, runs: registryRecords(root) }, null, 2))
}
function releaseReservation(job) {
  job.reserved = false
  try { persistRegistry(job.root) } catch (e) { console.error('Không cập nhật được locks.json:', e) }
}
function keepOrphan(job, state) {
  job.reserved = false
  orphans.push({ dir: job.dir, root: job.root, runId: job.runId, name: job.name, scope: job.scope, locks: job.locks,
    pgid: job.pgid, startedAt: job.claimedAt, state, workspaceId: job.workspaceId || null, kind: job.kind || 'agent', cwd: job.cwd || job.root })
  try { persistRegistry(job.root) } catch (e) { console.error('Không lưu được khóa còn sống:', e) }
  sendLocks(job.root)
  scheduleOrphanProbe()
}

const insideRoot = (root, file) => {
  const fold = ['darwin', 'win32'].includes(process.platform)
  const a = fold ? root.toLowerCase() : root
  const b = fold ? file.toLowerCase() : file
  return b === a || b.startsWith(a + path.sep)
}
function orphanState(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 0) return 'unknown'
  try { return core.groupAlive(pgid) ? 'alive' : 'dead' } catch { return 'unknown' }
}
function unknownOrphan(dir, root, name = 'agent cũ') {
  return { dir, root, runId: randomUUID(), name, scope: { owns: [], readOnly: false }, locks: [{ path: root, tree: true }],
    pgid: null, startedAt: null, state: 'unknown' }
}
function pauseInterruptedMerge(root, queueId) {
  let registry
  try { registry = readWorktrees(root) } catch { return }
  const entry = registry.queue.find(item => item.id === queueId)
  if (!entry || !['merging', 'checking', 'publishing'].includes(entry.state)) return
  mergeError(entry, 'PAUSED', 'App đã khởi động lại trước khi hoàn tất gộp; hãy thử lại')
  writeWorktrees(root, registry)
  removeIntegration(root, entry).catch(() => {})
}
function loadOrphans(dir) {
  let root
  try { root = rootOf(dir) } catch { return }
  if (loadedRoots.has(root)) return
  loadedRoots.add(root)
  rootDirs.set(root, dir)
  const file = registryFile(root)
  if (!fs.existsSync(file)) return
  let data
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { data = null }
  if (![1, 2].includes(data?.version) || !Array.isArray(data.runs)) orphans.push(unknownOrphan(dir, root))
  else for (const record of data.runs) {
    let scope, expectedLocks, derivedCwd = root, workspaceId = null, kind = 'agent'
    try {
      scope = core.normalizeScope({ owns: record?.owns, readOnly: record?.readOnly }, root)
      if (data.version === 2 && record.kind === 'integration') { kind = 'integration'; derivedCwd = managedPath(root, 'integration', record.runId); expectedLocks = [{ path: root, tree: true }] }
      else if (data.version === 2 && typeof record.workspaceId === 'string') {
        const workspace = readWorktrees(root).agents.find(item => item.id === record.workspaceId && item.agent === record.name)
        if (!workspace) throw new Error('workspace')
        workspaceId = workspace.id; derivedCwd = managedPath(root, 'agents', workspace.id); expectedLocks = sharedMetadataLocks(scope, root)
      } else expectedLocks = core.scopeLocks(scope, root)
    } catch {}
    const valid = record && typeof record.runId === 'string' && typeof record.name === 'string' && Array.isArray(record.owns)
      && record.owns.every(x => typeof x === 'string') && scope && expectedLocks
      && (data.version === 1 || (typeof record.cwd === 'string' && path.resolve(record.cwd) === derivedCwd))
      && typeof record.readOnly === 'boolean' && Array.isArray(record.locks) && record.locks.every(l => l && typeof l.path === 'string'
        && path.isAbsolute(l.path) && insideRoot(root, path.resolve(l.path)) && typeof l.tree === 'boolean')
    if (!valid) { orphans.push(unknownOrphan(dir, root, typeof record?.name === 'string' ? record.name : undefined)); continue }
    const stored = record.locks.map(l => ({ path: path.resolve(l.path), tree: l.tree }))
    if (expectedLocks.some(lock => !stored.some(saved => saved.path === lock.path && saved.tree === lock.tree))) {
      orphans.push(unknownOrphan(dir, root, record.name)); continue
    }
    const state = orphanState(record.pgid)
    if (state === 'dead') continue
    orphans.push({ dir, root, runId: record.runId, name: record.name,
      scope, locks: expectedLocks,
      pgid: Number.isInteger(record.pgid) && record.pgid > 0 ? record.pgid : null, startedAt: record.startedAt, state,
      workspaceId, kind, cwd: derivedCwd })
  }
  try {
    const active = new Set(orphans.filter(item => item.root === root && item.kind === 'integration').map(item => item.runId))
    for (const entry of readWorktrees(root).queue)
      if (['merging', 'checking', 'publishing'].includes(entry.state) && !active.has(entry.id)) pauseInterruptedMerge(root, entry.id)
  } catch {}
  try { persistRegistry(root) } catch (e) { console.error('Không chuẩn hóa được locks.json:', e) }
  scheduleOrphanProbe()
}
function sendLocks(root) {
  const dirs = new Set([rootDirs.get(root), ...orphans.filter(o => o.root === root).map(o => o.dir), ...jobs.filter(j => j.root === root).map(j => j.dir)])
  for (const dir of dirs) if (dir) win?.webContents.send('locks', dir, orphanFor(dir))
}
function scheduleOrphanProbe() {
  if (orphanTimer || !orphans.some(o => o.state === 'alive')) return
  orphanTimer = setInterval(() => {
    const roots = new Set()
    for (let i = orphans.length - 1; i >= 0; i--) if (orphans[i].state === 'alive') {
      const state = orphanState(orphans[i].pgid)
      if (state === 'dead') {
        roots.add(orphans[i].root)
        if (orphans[i].kind === 'integration') pauseInterruptedMerge(orphans[i].root, orphans[i].runId)
        orphans.splice(i, 1)
      }
      else if (state === 'unknown') { orphans[i].state = 'unknown'; roots.add(orphans[i].root) }
    }
    for (const root of roots) { try { persistRegistry(root) } catch {} sendLocks(root) }
    if (!orphans.some(o => o.state === 'alive')) { clearInterval(orphanTimer); orphanTimer = null }
    pump()
  }, 1000)
}

function clearProjectWatch() {
  clearTimeout(watched.timer)
  for (const watcher of watched.watchers) watcher.close()
  watched = { dir: null, root: null, file: null, watchers: [], timer: null, changed: null }
}
function notifyProjectChanged(dir, change) {
  let root
  try { root = rootOf(dir) } catch { return }
  if (!watched.root || watched.root !== root) return
  watched.changed ||= { tasks: false, files: false, file: null }
  watched.changed.tasks ||= !!change.tasks
  watched.changed.files ||= !!change.files
  if (change.file) watched.changed.file = change.file
  if (change.error) watched.changed.error = change.error
  clearTimeout(watched.timer)
  watched.timer = setTimeout(() => {
    const changed = watched.changed
    watched.changed = null; watched.timer = null
    if (changed && win && !win.isDestroyed()) win.webContents.send('project-changed', watched.dir, changed)
  }, 150)
}
async function refreshLog(root) {
  const previous = logGenerations.get(root)
  core.invalidateLogIndex(root)
  const index = await core.getLogIndex(root)
  logGenerations.set(root, index.generation)
  if (previous && previous !== index.generation) { clearPending(root); win?.webContents.send('log-reset', root, { generation: index.generation }) }
}
function viewerRoot(root, workspaceId, href = '') {
  if (!workspaceId || isChatPath(String(href).split(/[?#]/, 1)[0])) return root
  const record = readWorktrees(root).agents.find(item => item.id === workspaceId)
  if (!record) throw gitError('INVALID_ARGUMENT', 'Workspace không còn tồn tại')
  const expected = managedPath(root, 'agents', record.id)
  if (path.resolve(record.path) !== expected || !fs.existsSync(expected)) throw gitError('CONFIG_ERROR', 'Workspace không hợp lệ')
  return expected
}

// Absolute links in old replies may omit workspace metadata. Only this project's registered worktrees qualify.
function viewerTarget(root, href, fromFile, workspaceId) {
  const decoded = core.decodedPath(href)
  const contains = (base, file) => {
    const rel = path.relative(base, file)
    return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
  }
  if (path.isAbsolute(decoded)) {
    fromFile = null
    workspaceId = null
    let relative = contains(root, decoded) ? path.relative(root, decoded) : null
    if (relative === null) {
      const record = readWorktrees(root).agents.find(item => contains(managedPath(root, 'agents', item.id), decoded))
      if (record) {
        workspaceId = record.id
        relative = path.relative(viewerRoot(root, record.id), decoded)
        if (isChatPath(relative.split(path.sep).join('/'))) workspaceId = null
      }
    }
    // core resolves the root's realpath; a relative href also works when userData itself has a symlinked parent.
    if (relative !== null) href = relative.split(path.sep).map(encodeURIComponent).join('/') || '.'
  }
  const base = viewerRoot(root, workspaceId, decoded)
  const record = base === root ? null : readWorktrees(root).agents.find(item => item.id === workspaceId)
  return { base, href, fromFile, workspace: record ? { id: record.id, branch: record.branch } : null }
}

function watchProject(dir, file = null, workspaceId = null) {
  clearProjectWatch()
  if (dir == null) return { ok: true }
  const root = knownProject(dir)
  const contentRoot = viewerRoot(root, workspaceId, file || '')
  let current = null
  if (file != null) current = core.resolveProjectFile(contentRoot, file)
  watched.dir = dir; watched.root = root; watched.file = current?.relative || null
  const folders = new Map(), add = (folder, role) => {
    const roles = folders.get(folder) || new Set(); roles.add(role); folders.set(folder, roles)
  }
  add(core.chat(root), 'chat'); add(path.join(contentRoot, 'reports'), 'reports')
  if (current) add(path.dirname(current.real), 'file')
  try {
    for (const [folder, roles] of folders) {
      const watcher = rawFs.watch(folder, (event, filename) => {
        if (watched.root !== root) return
        const name = filename == null ? null : String(filename), changed = { tasks: false, files: false, file: null }
        if (roles.has('chat') && (name == null || name === 'tasks.json')) changed.tasks = true
        if (roles.has('chat') && (name == null || name === 'log.jsonl') && Date.now() > (appLogWrites.get(root) || 0))
          refreshLog(root).catch(e => notifyProjectChanged(root, { error: `Đọc lại lịch sử lỗi: ${e.message}` }))
        if (roles.has('reports')) changed.files = true
        if (current && roles.has('file') && (name == null || path.resolve(folder, name) === current.real)) changed.file = current.relative
        if (changed.tasks || changed.files || changed.file) notifyProjectChanged(root, changed)
      })
      watcher.on('error', e => notifyProjectChanged(root, { error: `Theo dõi file lỗi: ${e.message}` }))
      watched.watchers.push(watcher)
    }
    return { ok: true }
  } catch (e) {
    clearProjectWatch()
    return { ok: false, message: `Không theo dõi được dự án: ${e.message}` }
  }
}

// agents.json/project.json hold permissions, commands and merge checks, but live in the box folder agents can write.
// core runs on the text the user last accepted (the pin); a different file on disk is only a proposal, shown here
// before any agent runs. Accept pins exactly what was shown; "Hoàn tác" writes the accepted text back. A box the app
// never pinned has nothing to go back to: "Huỷ" holds until the next user message, so a chain of @ asks only once.
const trustPrompts = new Map(), trustDeclined = new Map()
function ensureTrustedConfig(root) {
  const check = core.configTrust(root)
  if (check.trusted) { trustDeclined.delete(root); return Promise.resolve() }
  const changes = check.changes.join('\n'), files = `${core.chatName(root)}/agents.json, project.json`
  const untrusted = () => gitError('CONFIG_UNTRUSTED', `Cấu hình (${files}) chưa được xác nhận. Gửi tin mới để được hỏi lại.`)
  if (!check.pinned && trustDeclined.get(root) === changes) return Promise.reject(untrusted())
  if (!trustPrompts.has(root)) trustPrompts.set(root, (async () => {
    const answer = await dialog.showMessageBox(win, { type: 'warning', defaultId: 0, cancelId: 0,
      buttons: check.pinned ? ['Hoàn tác thay đổi', 'Chấp nhận thay đổi'] : ['Huỷ', 'Tin cậy cấu hình này'],
      message: check.pinned ? `Cấu hình box «${path.basename(root)}» đã bị sửa ngoài app` : `Box «${path.basename(root)}» có cấu hình app chưa xác nhận`,
      detail: `${changes}\n\n${check.pinned ? 'Nếu không phải bạn sửa, có thể agent đã tự đổi quyền, lệnh hoặc phạm vi của mình.'
        : 'Cấu hình này không do app tạo (repo có sẵn, box cũ trước bản cập nhật, hoặc agent tạo). Chỉ tin nếu bạn đã kiểm tra.'}` })
    if (answer.response === 1) core.trustConfig(root, check.texts)
    else if (check.pinned) core.revertConfig(root)
    else { trustDeclined.set(root, changes); throw untrusted() }
    trustDeclined.delete(root)
    emitTeam(root)
    win?.webContents.send('project-settings', root, core.projectSettings(root))
  })().finally(() => trustPrompts.delete(root)))
  return trustPrompts.get(root)
}

function knownProject(dir) {
  if (typeof dir !== 'string') throw new Error('Dự án không hợp lệ')
  const root = rootOf(dir)
  if (!projects().some(p => { try { return rootOf(p) === root } catch { return false } })) throw new Error('Dự án chưa được mở trong app')
  return root
}
function agentSessionContext(root, name) {
  const settings = core.projectSettings(root).settings, agent = core.team(root).find(item => item.name === name)
  if (!settings.worktreesEnabled || !agent || core.normalizeScope(agent, root).readOnly) return { cwd: root, workspaceId: null }
  const record = readWorktrees(root).agents.find(item => item.agent === name)
  if (!record) return { cwd: null, workspaceId: null }
  return { cwd: managedPath(root, 'agents', record.id), workspaceId: record.id }
}
function sessionMap(root) {
  const out = {}
  for (const agent of core.team(root)) {
    if (agent.sessionConfigError) continue
    const context = agentSessionContext(root, agent.name)
    if (!context.cwd) continue
    const session = core.sessions(root, context.workspaceId)[agent.name]
    if (session?.cli === agent.cli) out[agent.name] = { ...session, workspaceId: context.workspaceId,
      sessionTokenLimit: agent.sessionTokenLimit, rotationPending: core.sessionRotationPending(agent, session) }
  }
  return out
}
function emitSessions(root) {
  const current = sessionMap(root)
  win?.webContents.send('sessions-changed', root, current)
  return current
}
function emitTeam(root, team = core.team(root)) {
  const data = { team, revision: core.teamRevision(root) }
  win?.webContents.send('team-changed', root, data)
  return data
}
function guardTeamChange(root, before, next) {
  for (const active of [...jobs, ...orphans]) if (active.root === root && !active.finished) {
    const old = before.find(agent => agent.name === active.name), changed = next.find(agent => agent.name === active.name)
    if (!old || !changed || old.cli !== changed.cli || (old.resume !== false) !== (changed.resume !== false)
      || old.readOnly !== changed.readOnly || JSON.stringify(old.owns) !== JSON.stringify(changed.owns)
      || JSON.stringify(old.allowedCommands) !== JSON.stringify(changed.allowedCommands)
      || JSON.stringify(old.permissions) !== JSON.stringify(changed.permissions))
      throw gitError('BUSY', `Không thể đổi tên, xoá, CLI, nhớ phiên, phạm vi, lệnh hoặc quyền của @${active.name} khi còn lượt/khóa`)
  }
  if (permissionReservations.size && [...permissionReservations.keys()].some(key => key.startsWith(root + '\0')))
    throw gitError('BUSY', 'Đang có thao tác cấp quyền')
  if (core.projectSettings(root).settings.worktreesEnabled) for (const workspace of readWorktrees(root).agents)
    if (!next.some(agent => agent.name === workspace.agent)) throw gitError('BUSY', `Không thể đổi tên hoặc xoá @${workspace.agent} khi agent còn workspace`)
}
function fullEscalations(before, next) {
  return next.filter(agent => agent.permissions.mode === 'full' && (() => {
    const old = before.find(item => item.name === agent.name)
    return !old || old.permissions.mode !== 'full' || old.cli !== agent.cli
  })())
}
function resolveFile(dir, input, workspaceId = null) {
  const root = knownProject(dir)
  const decoded = core.decodedPath(input)
  if (decoded.split('/').includes('..')) throw new Error('Đường dẫn không được chứa ..')
  const file = core.resolveProjectFile(viewerRoot(root, workspaceId, decoded), input)
  if (!file.canOpenExternal) throw new Error('Không hỗ trợ mở trực tiếp file này')
  return file.real
}

const validSender = event => {
  if (event.sender !== win?.webContents || (win?.webContents?.mainFrame && event.senderFrame !== win.webContents.mainFrame))
    throw new Error('Nguồn IPC không hợp lệ')
}
const apiError = error => {
  const detail = redactManagedPath(error.message || 'Thao tác thất bại')
  const message = error.permissionSaved ? `Đã lưu quyền nhưng chưa chạy lại: ${detail}` : detail
  return { ok: false, error: { code: error.code || 'IO_ERROR', message, ...(error.permissionSaved ? { permissionSaved: true } : {}) } }
}
const apiCall = async action => { try { return { ok: true, ...await action() } } catch (e) { return apiError(e) } }

let activePreview = null, previewGen = 0
function closeCurrentPreview() {
  if (activePreview) {
    activePreview.closed = true
    activePreview = null
    previewGen++
  }
}

async function handleAgentPreview(request) {
  const plain = (msg, status) => new Response(msg, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }
  })

  if (request.method !== 'GET') return plain('Method Not Allowed', 405)

  let url
  try { url = new URL(request.url) } catch { return plain('Bad Request', 400) }
  if (url.protocol !== 'agent-preview:') return plain('Bad Request', 400)
  if (url.username || url.password || url.port) return plain('Forbidden', 403)

  if (!activePreview || activePreview.closed || url.hostname !== activePreview.token) {
    return plain('Not Found', 404)
  }

  const current = activePreview
  const rawPath = request.url.slice(('agent-preview://' + url.host).length).split(/[?#]/, 1)[0]
  if (!rawPath.startsWith('/files/')) return plain('Forbidden', 403)
  if (/%2f/i.test(rawPath) || /%5c/i.test(rawPath) || rawPath.includes('\\') || /[\0-\x1f\x7f]/.test(rawPath)) {
    return plain('Bad Request', 400)
  }

  const subPath = rawPath.slice('/files/'.length)
  if (!subPath) return plain('Bad Request', 400)
  const segments = subPath.split('/')
  const decodedSegments = []
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return plain('Bad Request', 400)
    let dec
    try { dec = decodeURIComponent(seg) } catch { return plain('Bad Request', 400) }
    if (!dec || dec === '.' || dec === '..' || dec.includes('/') || dec.includes('\\') || /[\0-\x1f\x7f]/.test(dec)) {
      return plain('Bad Request', 400)
    }
    decodedSegments.push(dec)
  }
  const relative = decodedSegments.join('/')

  // Entry HTML
  if (relative === current.entryRelativePath) {
    if (current.closed) return plain('Not Found', 404)
    const token = current.token
    const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline' agent-preview://${token}; img-src agent-preview://${token}; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; sandbox`
    return new Response(current.htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'X-DNS-Prefetch-Control': 'off',
      }
    })
  }

  // Assets
  const ext = path.extname(relative).toLowerCase()
  const isCss = ext === '.css'
  const isImg = Boolean(core.IMAGE_EXTENSIONS[ext])
  if (!isCss && !isImg) return plain('Unsupported Media Type', 415)

  if (current.cache.has(relative)) {
    const cached = current.cache.get(relative)
    return new Response(cached.bytes, { status: 200, headers: cached.headers })
  }
  if (current.pending?.has(relative)) {
    await current.pending.get(relative)
    if (current.cache.has(relative)) {
      const cached = current.cache.get(relative)
      return new Response(cached.bytes, { status: 200, headers: cached.headers })
    }
  }

  const isNewPath = !current.resourcePaths.has(relative)
  if (isNewPath && current.resourcePaths.size >= 128) {
    return plain('Resource Limit Exceeded', 429)
  }
  if (isNewPath) current.resourcePaths.add(relative)

  let fileInfo
  try {
    fileInfo = core.resolveProjectFile(current.targetBase, relative)
  } catch (e) {
    if (isNewPath) current.resourcePaths.delete(relative)
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'OUTSIDE_PROJECT' ? 403 : 400
    return plain(e.message || 'File Error', status)
  }

  let fileSize = 0
  try {
    fileSize = rawFs.statSync(fileInfo.real).size
  } catch {
    if (isNewPath) current.resourcePaths.delete(relative)
    return plain('File Error', 400)
  }

  if (current.totalBytes + (current.pendingBytes || 0) + fileSize > 32 * 1024 * 1024) {
    if (isNewPath) current.resourcePaths.delete(relative)
    return plain('Total Size Limit Exceeded', 413)
  }
  current.pendingBytes = (current.pendingBytes || 0) + fileSize

  let readPromise
  const doRead = async () => {
    try {
      const limit = isCss ? 2 * 1024 * 1024 : 10 * 1024 * 1024
      const readRes = await core.readBoundedFile(fileInfo, limit, isCss ? 'CSS vượt quá 2 MiB' : 'Ảnh vượt quá 10 MiB')
      return readRes
    } finally {
      current.pendingBytes -= fileSize
    }
  }
  readPromise = doRead()
  if (current.pending) current.pending.set(relative, readPromise)

  let readRes
  try {
    readRes = await readPromise
  } catch (e) {
    if (isNewPath) current.resourcePaths.delete(relative)
    const status = e.code === 'TOO_LARGE' ? 413 : e.code === 'NOT_FOUND' ? 404 : 403
    return plain(e.message || 'Read Error', status)
  } finally {
    current.pending?.delete(relative)
  }

  if (current.closed) {
    if (isNewPath) current.resourcePaths.delete(relative)
    return plain('Not Found', 404)
  }

  const bytes = readRes.bytes

  if (isCss) {
    if (bytes.some(b => b < 32 && b !== 9 && b !== 10 && b !== 13)) {
      if (isNewPath) current.resourcePaths.delete(relative)
      return plain('CSS không phải UTF-8 hợp lệ', 400)
    }
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch {
      if (isNewPath) current.resourcePaths.delete(relative)
      return plain('CSS không phải UTF-8 hợp lệ', 400)
    }
  }

  let mime
  if (isImg) {
    const detectedType = core.imageType(bytes)
    if (!detectedType) {
      if (isNewPath) current.resourcePaths.delete(relative)
      return plain('File không phải ảnh hợp lệ', 415)
    }
    if (core.IMAGE_EXTENSIONS[ext] !== detectedType) {
      if (isNewPath) current.resourcePaths.delete(relative)
      return plain('File không đúng định dạng ảnh', 415)
    }
    mime = core.IMAGE_MIME[detectedType]
  } else {
    mime = 'text/css; charset=utf-8'
  }

  if (current.totalBytes + bytes.length > 32 * 1024 * 1024) {
    if (isNewPath) current.resourcePaths.delete(relative)
    return plain('Total Size Limit Exceeded', 413)
  }

  current.totalBytes += bytes.length

  const resHeaders = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  }
  current.cache.set(relative, { bytes, headers: resHeaders })

  return new Response(bytes, { status: 200, headers: resHeaders })
}

// One box per folder is open at a time (core.chatName). Switching while that folder still has turns, locks, merges or a
// permission grant in flight would land their results in the other box, so it waits until the folder is idle.
function assertIdle(root) {
  if ([...jobs, ...orphans].some(x => x.root === root) || mergeWorkers.has(root) || mergeControllers.has(root) || gitLocks.has(root) || routing.has(root)
    || [...permissionReservations.keys()].some(key => key.startsWith(root + '\0'))) {
    const current = core.boxes(root).find(box => box.chat === core.chatName(root))?.name || path.basename(root)
    throw new Error(`Box «${current}» cùng thư mục còn agent đang chạy hoặc khóa cũ. Chờ xong (hoặc mở lại box đó để Dừng) rồi chuyển.`)
  }
}
function switchBox(root, name) {
  if (!core.boxes(root).some(box => box.chat === name)) throw new Error('Box không còn tồn tại')
  assertIdle(root)
  if (activePreview && activePreview.root === root) closeCurrentPreview()
  clearPending(root); loadedRoots.delete(root); summaryUnavailable.delete(root)
  core.useBox(root, name)
}

// "Cần bạn" items the user closed without answering, per box data folder: "seq:at" keys, so a rewritten log can't hide
// a different message. In userData, not .chat/: an agent must not be able to clear what waits for the user
const needsFile = () => path.join(app.getPath('userData'), 'needs-dismissed.json')
let needsDismissed = null
function dismissedNeeds(root) {
  if (!needsDismissed) { try { needsDismissed = JSON.parse(fs.readFileSync(needsFile(), 'utf8')) } catch { needsDismissed = {} } }
  return new Set(needsDismissed[core.chat(root)] || [])
}
const needsFor = root => core.needsYou(root, dismissedNeeds(root))

ipcMain.handle('projects', async event => {
  validSender(event)
  return (await Promise.all(projects().map(async dir => {
    const found = core.boxes(dir)
    // ponytail: only the box each folder has open is counted (core reads one box per folder); others show no badge
    let needs = 0, running = 0
    try { running = activeFor(dir).length; needs = (await needsFor(rootOf(dir))).length } catch {}
    // jobs only run in the open box: switchBox refuses while a folder is busy
    return (found.length ? found : [{ chat: '.chat', name: path.basename(dir) }])
      .map(box => box.chat === core.chatName(dir) ? { dir, ...box, needs, running } : { dir, ...box, needs: 0, running: 0 })
  }))).flat()
})
ipcMain.handle('timeline', (event, dir, since) => {
  validSender(event)
  return apiCall(async () => {
    if (!Number.isFinite(since) || since < 0) throw gitError('INVALID_ARGUMENT', 'Khoảng thời gian không hợp lệ')
    return await core.timeline(knownProject(dir), since)
  })
})
ipcMain.handle('needs', (event, dir) => { validSender(event); return apiCall(async () => ({ items: await needsFor(knownProject(dir)) })) })
ipcMain.handle('dismissNeed', (event, dir, key) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    if (typeof key !== 'string' || !/^\d+:[\w.:+-]{1,40}$/.test(key)) throw gitError('INVALID_ARGUMENT', 'Mục không hợp lệ')
    const keys = [...dismissedNeeds(root), key].slice(-500) // loads the store before it's indexed
    needsDismissed[core.chat(root)] = keys
    core.atomicWrite(needsFile(), JSON.stringify(needsDismissed))
    return { items: await needsFor(root) }
  })
})
ipcMain.handle('pick', async event => {
  validSender(event)
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled) return null
  let picked = r.filePaths[0], chat = null
  // picked a box's data folder itself (e.g. copied from another machine) → open that box of the folder containing it
  if (core.CHAT_DIR.test(path.basename(picked).toLowerCase()) && fs.existsSync(path.join(picked, 'log.jsonl'))) {
    chat = path.basename(picked).toLowerCase(); picked = path.dirname(picked)
  }
  const dir = rootOf(picked), existing = core.boxes(dir)
  if (!chat && existing.length) {
    const current = existing.find(box => box.chat === core.chatName(dir)) || existing[0]
    const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['Huỷ', 'Mở box có sẵn', 'Tạo box mới'], defaultId: 2, cancelId: 0,
      message: `Thư mục này đã có box: ${existing.map(box => box.name).join(', ')}`,
      detail: 'Box mới có lịch sử chat, memory, task và phiên agent riêng, không đụng tới box cũ.',
      checkboxLabel: `Box mới dùng lại thành viên của «${current.name}»`, checkboxChecked: true })
    if (answer.response === 0) return null
    chat = current.chat
    if (answer.response === 2) {
      assertIdle(dir)
      chat = core.createBox(dir, { copyFrom: answer.checkboxChecked ? current.chat : null })
    }
  }
  if (chat && chat !== core.chatName(dir)) switchBox(dir, chat)
  core.init(dir)
  // git repo: keep .chat2… out of `git status`, or the folder looks dirty and worktree merges stop (not a repo → no-op)
  if (chat && chat !== '.chat') await ensureRuntimeExclude(dir).catch(() => {})
  loadOrphans(dir)
  try { migrateTaskScope(dir) } catch (e) { console.error('Không migrate được quyền task:', e) }
  fs.writeFileSync(projectsFile(), JSON.stringify([dir, ...projects().filter(d => d !== dir)]))
  return { dir, chat: core.chatName(dir) }
})
ipcMain.handle('open', async (event, dir, chat = null) => {
  validSender(event)
  const root = knownProject(dir)
  if (chat != null && chat !== core.chatName(root)) switchBox(root, chat) // no chat = stay in the open box (refreshes)
  core.init(root); loadOrphans(root)
  await recoverChainControl(root).catch(e => console.error('Không khôi phục được điều phối:', e.message))
  try { migrateTaskScope(root) } catch (e) { console.error('Không migrate được quyền task:', e) }
  await core.recoverSummary(root).catch(e => console.error('Không khôi phục được summary.md:', e))
  const history = await core.logPage(root), index = await core.getLogIndex(root), config = core.projectSettings(root)
  logGenerations.set(root, index.generation)
  scheduleSummary(root).catch(e => console.error(e))
  if (config.settings.worktreesEnabled) pumpMerge(root).catch(e => console.error(e))
  return { history, totals: core.logTotals(index), settings: config.settings, settingsRevision: config.revision,
    team: core.team(root), teamRevision: core.teamRevision(root), permissionRequests: permissionRequests(root),
    sessions: sessionMap(root), active: activeFor(root), orphanLocks: orphanFor(root), chat: core.chatName(root) }
})
ipcMain.handle('logPage', (event, dir, options) => { validSender(event); return apiCall(async () => ({ page: await core.logPage(knownProject(dir), options) })) })
ipcMain.handle('searchLog', (event, dir, options) => { validSender(event); return apiCall(() => core.searchLog(knownProject(dir), options)) })
ipcMain.handle('projectSettings', (event, dir) => { validSender(event); return apiCall(async () => core.projectSettings(knownProject(dir))) })
ipcMain.handle('saveProjectSettings', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    if (!request || typeof request !== 'object') throw Object.assign(new Error('Yêu cầu cấu hình không hợp lệ'), { code: 'INVALID_ARGUMENT' })
    const current = core.projectSettings(root), nextSettings = core.normalizeProjectSettings(request.settings)
    if (request.expectedRevision !== current.revision) throw gitError('CONFLICT', 'Cấu hình đã thay đổi, hãy tải lại')
    const togglesWorktrees = nextSettings.worktreesEnabled !== current.settings.worktreesEnabled
      || JSON.stringify(nextSettings.mergeChecks) !== JSON.stringify(current.settings.mergeChecks)
    if (togglesWorktrees && ([...jobs, ...orphans].some(item => item.root === root) || mergeControllers.has(root) || mergeWorkers.has(root)
      || [...permissionReservations.keys()].some(key => key.startsWith(root + '\0'))))
      throw gitError('BUSY', 'Đang có lượt, khóa hoặc kiểm tra gộp; chưa thể đổi cấu hình worktree')
    if (!current.settings.worktreesEnabled && nextSettings.worktreesEnabled) await enableWorktrees(root, nextSettings)
    if (current.settings.worktreesEnabled && !nextSettings.worktreesEnabled) {
      const registry = readWorktrees(root)
      for (const entry of registry.queue) if (entry.state === 'queued') entry.state = 'paused'
      writeWorktrees(root, registry)
    }
    const saved = core.writeProjectSettings(root, nextSettings, request.expectedRevision)
    if (!saved.settings.autoSummary) for (const job of jobs.filter(item => item.root === root && item.kind === 'summary')) stopJob(job, 'stopped')
    win?.webContents.send('project-settings', root, saved)
    await emitWorktreeState(root).catch(() => {})
    if (togglesWorktrees) clearPending(root)
    emitSessions(root)
    if (saved.settings.autoSummary) scheduleSummary(root).catch(e => console.error(e))
    if (saved.settings.worktreesEnabled) pumpMerge(root).catch(e => console.error(e))
    return saved
  })
})
ipcMain.handle('worktreeState', (event, dir) => { validSender(event); return apiCall(async () => ({ state: await worktreeState(knownProject(dir)) })) })
ipcMain.handle('prepareGitInit', (event, dir) => { validSender(event); return apiCall(() => gitInitPreview(knownProject(dir))) })
ipcMain.handle('initGit', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => ({ state: await withGitLock(knownProject(dir), () => initializeGit(knownProject(dir), request)) }))
})
ipcMain.handle('retryMerge', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    await withGitLock(root, async () => {
      const registry = readWorktrees(root), old = registry.queue.find(entry => entry.id === request?.queueId)
      if (old?.supersededBy) return
      if (!old || !RETRYABLE_MERGE_STATES.includes(old.state)) throw gitError('INVALID_ARGUMENT', 'Mục gộp không thể thử lại')
      const probe = await repoProbe(root)
      if (probe.branch === registry.targetRef
        && await contained(root, old.headSha, registry.agents.find(item => item.id === old.workspaceId), probe.sha)) return
      const workspace = registry.agents.find(item => item.id === old.workspaceId)
      if (!workspace) throw gitError('CONFIG_ERROR', 'Workspace không còn tồn tại')
      if (workspace.recoveryPending) throw gitError('BUSY', 'Hãy hoàn tất thao tác Lấy main trước khi thử gộp lại')
      const headSha = await gitHead(await verifyWorkspace(root, workspace)), settings = core.projectSettings(root).settings
      const id = randomUUID()
      updateRegistry(root, latest => {
        const current = latest.queue.find(entry => entry.id === old.id)
        if (!current || current.supersededBy || !RETRYABLE_MERGE_STATES.includes(current.state)) return // changed while we waited
        // An automatic finish may already have queued the new head; a double retry of legacy duplicates converges on one attempt
        let next = latest.queue.find(entry => entry.workspaceId === old.workspaceId && entry.headSha === headSha
          && !entry.supersededBy && ['queued', 'merging', 'checking', 'publishing'].includes(entry.state))
        if (!next) {
          next = { ...current, id, runId: randomUUID(), headSha, checks: [...settings.mergeChecks], state: 'queued',
          baseSha: probe.sha, candidateSha: null, error: null, pgid: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          retryOf: current.id, attemptNo: 0 }
          delete next.mergeEvent; delete next.attemptId
          latest.queue.push(next)
        }
        for (const previous of latest.queue) {
          if (previous.id === next.id || previous.supersededBy || previous.workspaceId !== current.workspaceId
            || ![current.headSha, headSha].includes(previous.headSha) || !RETRYABLE_MERGE_STATES.includes(previous.state)) continue
          previous.supersededBy = next.id
        }
      })
    })
    pumpMerge(root).catch(e => console.error(e))
    return { state: await emitWorktreeState(root) }
  })
})
ipcMain.handle('replaceMergeSource', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    await withGitLock(root, () => replaceMergeSource(root, request?.queueId))
    return { state: await emitWorktreeState(root) }
  })
})
ipcMain.handle('stopMerge', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir), registry = readWorktrees(root), entry = registry.queue.find(item => item.id === request?.queueId)
    if (!entry) throw gitError('INVALID_ARGUMENT', 'Không tìm thấy mục gộp')
    if (entry.state === 'queued') await withGitLock(root, async () => {
      const latest = readWorktrees(root), pending = latest.queue.find(item => item.id === entry.id)
      if (pending?.state !== 'queued') throw gitError('BUSY', 'Mục gộp không còn ở trạng thái chờ')
      mergeError(pending, 'PAUSED', 'Đã dừng trước khi kiểm tra'); writeWorktrees(root, latest)
    })
    else if (entry.state === 'checking' && mergeControllers.get(root)?.entry.id === entry.id) mergeControllers.get(root).controller.abort('stopped')
    else throw gitError('BUSY', 'Không thể dừng trong bước Git hiện tại')
    return { state: await emitWorktreeState(root) }
  })
})
ipcMain.handle('requestMergeRepair', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    let preResult = null
    let actionKey, entryId, repairChainId, repairEventId, targetEventId, owner, detail, repairContext
    await withGitLock(root, async () => {
      const registry = readWorktrees(root), entry = registry.queue.find(item => item.id === request?.queueId)
      if (!entry) throw gitError('INVALID_ARGUMENT', 'Không tìm thấy mục gộp')
      actionKey = 'repair:' + (entry.mergeEvent?.eventId || entry.id)
      const store = readControlStore(root)
      if (store.claims[actionKey]) {
        const claim = store.claims[actionKey]
        preResult = { runId: claim.runId, chainId: claim.chainId }
        return
      }
      const existing = jobs.find(job => job.root === root && job.repairQueueId === entry.id && !job.finished)
      if (existing) {
        preResult = { runId: existing.runId }
        return
      }
      if (entry.supersededBy) throw gitError('INVALID_ARGUMENT', 'Mục gộp đã bị thay thế')
      const probe = await repoProbe(root).catch(() => null)
      if (probe?.branch === registry.targetRef && await contained(root, entry.headSha, registry.agents.find(item => item.id === entry.workspaceId), probe.sha)) {
        throw gitError('INVALID_ARGUMENT', 'Mục gộp đã nằm trong main')
      }
      if (!['conflict', 'check-failed'].includes(entry.state))
        throw gitError('INVALID_ARGUMENT', 'Mục gộp không còn cần agent sửa')
      owner = core.team(root).find(agent => agent.name === entry.agent)
      if (!owner) throw gitError('CONFIG_ERROR', 'Không tìm thấy agent sở hữu nhánh')
      entryId = entry.id
      repairChainId = randomUUID()
      repairEventId = actionKey
      targetEventId = entry.mergeEvent?.eventId || null
      updateControlStore(root, s => {
        s.claims[actionKey] = {
          kind: 'repair',
          actionKey,
          queueId: entry.id,
          eventId: repairEventId,
          targetEventId,
          chainId: repairChainId,
          at: new Date().toISOString()
        }
      })
      detail = `${entry.error?.message || 'Lỗi gộp'}${entry.error?.files?.length ? `: ${entry.error.files.join(', ')}` : ''}`
      repairContext = entry.mergeEvent ? {
        category: entry.mergeEvent.category,
        phase: entry.mergeEvent.phase,
        code: entry.mergeEvent.code,
        message: entry.mergeEvent.message,
        files: entry.mergeEvent.files,
        commandResult: entry.mergeEvent.commandResult,
        excerpt: entry.mergeEvent.excerpt,
        checkIds: entry.mergeEvent.checkIds,
        untrusted: true
      } : null
    })
    if (preResult) return preResult

    await postOnce(root, repairEventId, 'system', `@${owner.name} sửa lỗi trên nhánh của bạn rồi báo lại: ${detail}`, {
      kind: 'merge-repair', initiatedBy: 'user', queueId: entryId, eventId: repairEventId, targetEventId
    })
    const chain = newChain(root, { id: repairChainId })
    let job
    try {
      job = await ask(root, owner, 0, { repairQueueId: entryId, repairContext }, chain)
    } catch (err) {
      updateControlStore(root, s => { delete s.claims[actionKey] })
      throw err
    }
    updateControlStore(root, s => {
      if (s.claims[actionKey]) s.claims[actionKey].runId = job.runId
    })
    emitWorktreeState(root).catch(() => {})
    return { runId: job.runId, chainId: repairChainId }
  })
})
ipcMain.handle('files', (event, dir) => { validSender(event); return core.files(knownProject(dir)) })
ipcMain.handle('continueChain', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    return withChainOperation(root, async () => {
      loadOrphans(root)
      await recoverChainControl(root)
      const stop = await findChainStop(root, request?.messageId), stopId = stopKey(stop), claimKey = 'continue:' + stopId
      const record = await chainStopRecord(root, stop)
      const prior = readControlStore(root).claims[claimKey]
      if (prior || record.state.phase === 'continued') {
        const childId = prior?.childChainId || record.state.continuedTo
        if (!childId) throw gitError('UNAVAILABLE', 'Không thể xác định chuỗi đã tiếp tục')
        return { chainId: childId, alreadyContinued: true, state: record.state }
      }
      const origin = activeChains.get(record.chainId)
      const view = origin ? getChainView(root, origin) : record.state
      if (!view.canContinue || view.phase === 'draining' || orphans.some(o => o.root === root)) throw gitError('INVALID_STATE', 'Chưa thể tiếp tục: đang chờ lượt hoặc khóa cũ, hay thiếu dữ kiện nguồn')
      const pending = origin ? structuredClone(origin.pending) : storedPending(record)
      const targets = []
      for (const p of pending.filter(p => !p.uncertain)) {
        const agent = core.team(root).find(a => a.name === p.agent)
        if (!agent) throw gitError('CONFIG_ERROR', 'Agent cần tiếp tục không còn trong nhóm: ' + p.agent)
        targets.push({ agent, pending: p, sources: await sourceMessages(root, p.sourceRefs) })
      }
      if (!targets.length) throw gitError('UNAVAILABLE', 'Không có công việc chắc chắn chưa chạy; hãy kiểm tra log và gửi yêu cầu mới')
      // Recheck after source IO, before the one atomic claim and any side effect.
      const concurrentClaim = readControlStore(root).claims[claimKey]
      if (concurrentClaim) return { chainId: concurrentClaim.childChainId, alreadyContinued: true, state: readControlStore(root).stops[stopId].state }
      if ((origin && !getChainView(root, origin).canContinue) || orphans.some(o => o.root === root)) throw gitError('INVALID_STATE', 'Chuỗi chưa sẵn sàng')
      let created = false
      const claim = updateControlStore(root, store => {
        if (store.claims[claimKey]) return store.claims[claimKey]
        const c = { kind: 'continue', stopId, childChainId: randomUUID(), at: new Date().toISOString(),
          dispatches: targets.map(t => ({ agent: t.agent.name, sourceRefs: t.pending.sourceRefs, taskIds: t.pending.taskIds, state: 'reserved', runId: null })) }
        store.claims[claimKey] = c
        const saved = store.stops[stopId]
        saved.state = { ...saved.state, phase: 'continued', canContinue: false, continuedTo: c.childChainId, revision: String(Number(saved.state.revision || 0) + 1) }
        created = true
        return c
      })
      if (!created) return { chainId: claim.childChainId, alreadyContinued: true, state: readControlStore(root).stops[stopId].state }
      if (origin) { origin.state = 'continued'; origin.continuedTo = claim.childChainId; origin.revision = Number(readControlStore(root).stops[stopId].state.revision) }
      const child = newChain(root, { id: claim.childChainId })
      child.pending = pending.filter(p => p.uncertain)
      try {
        await postOnce(root, 'continue:' + stopId, 'system', `Tiếp tục chuỗi với ${targets.map(t => '@' + t.agent.name).join(' ')}.`,
          { kind: 'chain-continue', continuedFrom: stop.seq, stopId, childChainId: child.id, targets: targets.map(t => t.agent.name) })
        for (const target of targets) {
          if (child.state !== 'active' || child.turns + child.reservedTurns >= child.chainLimit) {
            child.state = 'halting'; child.haltReason ||= { code: 'turn-limit', text: `Dừng sau ${child.chainLimit} lượt agent liên tiếp.` }
            mergePending(child.pending, target.pending)
            continue
          }
          const runId = randomUUID()
          updateControlStore(root, s => { const d = s.claims[claimKey].dispatches.find(d => d.agent === target.agent.name); d.state = 'dispatching'; d.runId = runId })
          child.reservedTurns++
          try {
            const job = await ask(root, target.agent, 0, { runId, sourceRefs: target.pending.sourceRefs, continuationSources: target.sources }, child, target.sources[0])
            updateControlStore(root, s => { const d = s.claims[claimKey].dispatches.find(d => d.agent === target.agent.name); d.state = job ? 'admitted' : 'reserved'; d.runId = job?.runId || null })
            if (!job) mergePending(child.pending, target.pending)
          } catch (e) {
            child.reservedTurns = Math.max(0, child.reservedTurns - 1)
            mergePending(child.pending, target.pending)
            updateControlStore(root, s => { const d = s.claims[claimKey].dispatches.find(d => d.agent === target.agent.name); d.state = 'reserved'; d.runId = null })
          }
        }
        if (child.pending.length && !child.stopPosted) await haltChain(root, child,
          child.haltReason || { code: 'restart-interrupted', text: 'Còn công việc chưa cấp hoặc chưa rõ kết quả; kiểm tra trước khi tiếp tục.' }, child.pending.map(p => ({ name: p.agent })))
      } catch (e) { activeChains.delete(child.id); await recoverChainControl(root); throw e }
      const state = readControlStore(root).stops[stopId].state
      win?.webContents.send('chain-changed', root, state)
      return { chainId: child.id, alreadyContinued: false, state }
    })
  })
})
ipcMain.handle('chainState', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    return withChainOperation(root, async () => {
      loadOrphans(root)
      await recoverChainControl(root)
      const stop = await findChainStop(root, request?.messageId)
      const record = await chainStopRecord(root, stop), chain = activeChains.get(record.chainId)
      return { state: chain ? getChainView(root, chain) : record.state }
    })
  })
})
ipcMain.handle('send', async (event, dir, text) => {
  validSender(event)
  const root = knownProject(dir), msg = await post(root, 'user', text)
  trustDeclined.delete(root) // a new message from the user may answer the config dialog differently
  // the message is posted: from here on a failure goes into the chat, never back to the input (resending would duplicate it)
  try { await route(root, msg, 0) } catch (e) { await post(root, 'system', `Chưa gọi được agent: ${e.message}`, { kind: 'route-error' }) }
  scheduleSummary(root).catch(e => console.error(e))
})
// Taking a message back: agents get "(tin đã được thu hồi)" in its place from now on, and turns that only this message asked
// for stop (waiting or running). Turns it set off further down a chain keep going; they see the note in the log.
ipcMain.handle('retract', (event, dir, seq) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir), index = await core.getLogIndex(root)
    if (!Number.isInteger(seq) || index.records[seq]?.from !== 'user') throw gitError('INVALID_ARGUMENT', 'Chỉ thu hồi được tin của bạn')
    if (index.retracted.has(seq)) throw gitError('CONFLICT', 'Tin này đã được thu hồi')
    const [msg] = (await core.logPage(root, { around: seq, limit: 1 })).messages
    const at = new Date(msg.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    await post(root, 'system', `Tin lúc ${at} của End-User đã được thu hồi; bỏ qua yêu cầu trong tin đó.`, { kind: 'retract', target: seq })
    for (const job of [...jobs]) if (job.root === root && !job.finished && job.reasons?.delete(seq) && !job.reasons.size) stopJob(job, 'stopped')
    return { text: msg.text }
  })
})
ipcMain.handle('tasks', async (event, dir) => { validSender(event); return core.taskBoardIndexed(knownProject(dir)) })
ipcMain.handle('readProjectFile', async (event, dir, href, fromFile, workspaceId) => {
  validSender(event)
  const root = knownProject(dir), target = viewerTarget(root, href, fromFile, workspaceId)
  return { ...await core.readProjectFile(target.base, target.href, target.fromFile), workspace: target.workspace }
})
ipcMain.handle('saveImage', (event, dir, data) => { validSender(event); return apiCall(async () => ({ path: core.saveImage(knownProject(dir), data) })) })
// ---- Right panel "Dự án": the files of the main folder or of an agent's worktree with what changed in it, or the files one
// commit changed (Antigravity's Uncommitted / Branch / Agent Edits). Letters: M sửa, A thêm, D xoá, U mới chưa theo dõi.
const TREE_LIMIT = 5000, DIFF_LIMIT = 512 * 1024
function treeSource(root, source) {
  if (source?.commit != null) {
    if (!/^[0-9a-f]{40}$/.test(source.commit)) throw gitError('INVALID_ARGUMENT', 'Commit không hợp lệ')
    return { cwd: root, commit: source.commit, workspaceId: null }
  }
  const workspaceId = source?.workspace || null
  return { cwd: viewerRoot(root, workspaceId), commit: null, workspaceId }
}
const pairs = list => { const out = {}; for (let i = 0; i + 1 < list.length; i += 2) out[list[i + 1]] = list[i][0]; return out }
// where the agent's branch left main: its changes since then, committed or not, are what it will merge
const branchBase = async (root, cwd) => (await git(cwd, ['merge-base', 'HEAD', await gitHead(root)])).stdout.trim()

async function projectTree(root, source) {
  const { cwd, commit, workspaceId } = treeSource(root, source)
  const big = { maxBuffer: 32 * 1024 * 1024 }
  const isGit = await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true).catch(() => false)
  let files = [], changes = {}
  if (commit) {
    changes = pairs(nul((await git(root, ['show', '--no-renames', '--name-status', '-z', '--diff-merges=first-parent', '--format=', commit], big)).stdout))
    files = Object.keys(changes)
  } else if (isGit) {
    files = nul((await git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], big)).stdout)
    if (workspaceId) {
      changes = pairs(nul((await git(cwd, ['diff', '--no-renames', '--name-status', '-z', await branchBase(root, cwd)], big)).stdout))
      for (const file of nul((await git(cwd, ['ls-files', '-z', '--others', '--exclude-standard'], big)).stdout)) changes[file] = 'U'
    } else {
      const prefix = (await git(cwd, ['rev-parse', '--show-prefix'])).stdout.trim() // status paths are relative to the repo root
      for (const item of nul((await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], big)).stdout)) {
        const code = item.slice(0, 2), file = item.slice(3)
        if (file.startsWith(prefix)) changes[file.slice(prefix.length)] = code === '??' ? 'U' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : 'M'
      }
    }
  } else {
    async function walk(folder, prefix = '') {
      for (const entry of await rawFs.promises.readdir(folder, { withFileTypes: true })) {
        if (files.length >= TREE_LIMIT) return
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (['.git', 'node_modules', '.DS_Store'].includes(entry.name) || (!prefix && entry.name === 'dist')) continue
        if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative)
        else if (entry.isFile()) files.push(relative)
      }
    }
    await walk(cwd)
  }
  files = files.filter(file => !isChatPath(file))
  const commits = isGit || commit ? nul((await git(root, ['log', '-30', '-z', '--format=%H%x1f%s%x1f%cI']).catch(() => ({ stdout: '' }))).stdout)
    .map(line => { const [sha, subject, at] = line.split('\x1f'); return { sha: sha.trim(), subject, at } }) : []
  return { base: cwd, git: isGit || !!commit, files: files.slice(0, TREE_LIMIT), truncated: files.length > TREE_LIMIT, changes, commits,
    workspaces: readWorktrees(root).agents.map(record => ({ id: record.id, agent: record.agent })) }
}

async function fileDiff(root, source, file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || path.isAbsolute(file) || file.split('/').includes('..') || isChatPath(file))
    throw gitError('INVALID_ARGUMENT', 'Đường dẫn không hợp lệ')
  const { cwd, commit, workspaceId } = treeSource(root, source)
  const flags = ['--no-color', '--no-ext-diff', '--no-textconv'], big = { maxBuffer: 8 * 1024 * 1024 }
  let text = (await git(cwd, commit ? ['show', ...flags, '--diff-merges=first-parent', '--format=', commit, '--', file]
    : ['diff', ...flags, workspaceId ? await branchBase(root, cwd) : 'HEAD', '--', file], big)).stdout
  if (!text && !commit) { // not tracked yet: the whole file is new
    const read = await core.readProjectFile(cwd, file.split('/').map(encodeURIComponent).join('/'))
    if (!read.ok) throw gitError(read.code, read.message)
    const lines = read.file.content.replace(/\n$/, '').split('\n')
    text = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`
  }
  return { diff: text.slice(0, DIFF_LIMIT), truncated: text.length > DIFF_LIMIT }
}
ipcMain.handle('projectTree', (event, dir, source) => { validSender(event); return apiCall(() => projectTree(knownProject(dir), source)) })
ipcMain.handle('fileDiff', (event, dir, source, file) => { validSender(event); return apiCall(() => fileDiff(knownProject(dir), source, file)) })

ipcMain.handle('readImage', async (event, dir, href, fromFile, workspaceId) => {
  validSender(event)
  const root = knownProject(dir), target = viewerTarget(root, href, fromFile, workspaceId)
  const res = await core.readImage(target.base, target.href, target.fromFile)
  return { ...res, workspace: target.workspace }
})
ipcMain.handle('createHtmlPreview', async (event, dir, href, fromFile, workspaceId) => {
  validSender(event)
  const myGen = ++previewGen
  try {
    const root = knownProject(dir), target = viewerTarget(root, href, fromFile, workspaceId)
    const ext = path.extname(target.href.split(/[?#]/, 1)[0]).toLowerCase()
    if (ext !== '.html' && ext !== '.htm') {
      return { ok: false, code: 'UNSUPPORTED', message: 'Chỉ xem trước file HTML' }
    }
    const readRes = await core.readProjectFile(target.base, target.href, target.fromFile)
    if (!readRes.ok) return { ok: false, code: readRes.code, message: readRes.message }
    const fileExt = path.extname(readRes.file.path).toLowerCase()
    if (fileExt !== '.html' && fileExt !== '.htm') {
      return { ok: false, code: 'UNSUPPORTED', message: 'Chỉ xem trước file HTML' }
    }
    if (myGen !== previewGen) {
      return { ok: false, code: 'PREVIEW_EXPIRED', message: 'Phiên xem trước đã bị thay thế' }
    }
    closeCurrentPreview()
    const token = randomBytes(16).toString('hex')
    const encodedEntry = readRes.file.path.split('/').map(encodeURIComponent).join('/')
    const url = `agent-preview://${token}/files/${encodedEntry}`
    activePreview = {
      id: token,
      token,
      root,
      workspace: target.workspace,
      targetBase: target.base,
      entryRelativePath: readRes.file.path,
      htmlContent: readRes.file.content,
      resourcePaths: new Set([readRes.file.path]),
      totalBytes: Buffer.byteLength(readRes.file.content, 'utf8'),
      cache: new Map(),
      closed: false,
      navigated: false,
    }
    return {
      ok: true,
      file: {
        path: readRes.file.path,
        name: readRes.file.name,
        format: 'text',
        content: readRes.file.content,
        version: readRes.file.version,
      },
      workspace: target.workspace,
      preview: { id: token, url },
    }
  } catch (e) {
    const code = ['INVALID_PATH', 'OUTSIDE_PROJECT', 'NOT_FOUND', 'UNSUPPORTED', 'TOO_LARGE', 'FILE_CHANGED'].includes(e.code) ? e.code : 'IO_ERROR'
    return { ok: false, code, message: e.message || 'Không tạo được xem trước HTML' }
  }
})
ipcMain.handle('closeHtmlPreview', (event, previewId) => {
  validSender(event)
  if (activePreview && activePreview.id === previewId) {
    activePreview.closed = true
    activePreview = null
    previewGen++
  }
  return { ok: true }
})
ipcMain.handle('openHtmlExternal', async (event, dir, href, workspaceId = null) => {
  validSender(event)
  try {
    const root = knownProject(dir), target = viewerTarget(root, href, null, workspaceId)
    const fileInfo = core.resolveProjectFile(target.base, target.href)
    const ext = path.extname(fileInfo.real).toLowerCase()
    if (ext !== '.html' && ext !== '.htm') {
      return { ok: false, code: 'UNSUPPORTED', message: 'Chỉ hỗ trợ mở file HTML' }
    }
    const statBefore = rawFs.statSync(fileInfo.real)
    const branchInfo = target.workspace?.branch ? ` (nhánh ${target.workspace.branch})` : ''
    const answer = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Huỷ', 'Mở'],
      defaultId: 1,
      cancelId: 0,
      message: 'Mở HTML bằng ứng dụng mặc định?',
      detail: `File: ${fileInfo.relative}${branchInfo}\nJavaScript và truy cập mạng có thể hoạt động.`
    })
    if (answer.response !== 1) return { ok: true, opened: false }
    const verified = core.resolveProjectFile(target.base, target.href)
    const statAfter = rawFs.statSync(verified.real)
    if (verified.real !== fileInfo.real || statAfter.dev !== statBefore.dev || statAfter.ino !== statBefore.ino) {
      return { ok: false, code: 'FILE_CHANGED', message: 'File thay đổi trong lúc xác nhận' }
    }
    const verifiedExt = path.extname(verified.real).toLowerCase()
    if (verifiedExt !== '.html' && verifiedExt !== '.htm') {
      return { ok: false, code: 'UNSUPPORTED', message: 'Chỉ hỗ trợ mở file HTML' }
    }
    const error = await shell.openPath(verified.real)
    if (error) return { ok: false, code: 'IO_ERROR', message: error }
    return { ok: true, opened: true }
  } catch (e) {
    const code = ['INVALID_PATH', 'OUTSIDE_PROJECT', 'NOT_FOUND', 'UNSUPPORTED', 'TOO_LARGE', 'FILE_CHANGED'].includes(e.code) ? e.code : 'IO_ERROR'
    return { ok: false, code, message: e.message || 'Không mở được file' }
  }
})
ipcMain.handle('watchProject', (event, dir, file, workspaceId) => { validSender(event); return watchProject(dir, file, workspaceId) })
ipcMain.handle('openFile', async (event, dir, file, workspaceId) => { validSender(event); const error = await shell.openPath(resolveFile(dir, file, workspaceId)); if (error) throw new Error(error) })
ipcMain.handle('openLink', async (event, dir, href, text = null) => {
  validSender(event)
  if (typeof href !== 'string' || !href || /[\0-\x1f\x7f]/.test(href) || href.startsWith('//')) throw new Error('Liên kết không hợp lệ')
  let url
  try { url = new URL(href) } catch {}
  if (url) {
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Chỉ hỗ trợ liên kết http/https')
    // agent-written markdown can label a link "reports/plan.md" and point it anywhere: show where it really goes
    const shown = typeof text === 'string' ? text.trim() : ''
    if (shown && shown !== href && shown !== url.href) {
      const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['Huỷ', 'Mở'], defaultId: 1, cancelId: 0,
        message: `Mở liên kết ngoài ${url.hostname}?`, detail: `Chữ hiển thị: ${shown.slice(0, 200)}\nĐịa chỉ thật: ${url.href.slice(0, 500)}` })
      if (answer.response !== 1) return
    }
    return shell.openExternal(url.href)
  }
  const error = await shell.openPath(resolveFile(dir, href))
  if (error) throw new Error(error)
})
ipcMain.handle('saveTeam', (event, dir, members, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    if (!request || typeof request.expectedRevision !== 'string') throw gitError('INVALID_ARGUMENT', 'Thiếu revision cấu hình nhóm')
    let revision = core.teamRevision(root), before = core.team(root)
    if (request.expectedRevision !== revision) throw gitError('CONFLICT', 'Cấu hình nhóm đã thay đổi, hãy tải lại')
    let next = core.normalizeTeam(root, members)
    guardTeamChange(root, before, next)
    const escalations = fullEscalations(before, next)
    if (escalations.length) {
      const answer = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Bật Toàn quyền'], defaultId: 0, cancelId: 0,
        message: `Bật Toàn quyền cho ${escalations.map(agent => `${agent.name} (${agent.cli})`).join(', ')}?`,
        detail: `Dự án: ${root}\nAgent có thể chạy lệnh, dùng mạng và tác động tới file ngoài dự án theo quyền tài khoản máy. Phạm vi file của app không phải sandbox bảo vệ hệ điều hành.` })
      if (answer.response !== 1) throw gitError('CANCELLED', 'Đã huỷ bật Toàn quyền')
      revision = core.teamRevision(root); before = core.team(root)
      if (request.expectedRevision !== revision) throw gitError('CONFLICT', 'Cấu hình nhóm đã thay đổi trong lúc xác nhận')
      next = core.normalizeTeam(root, members); guardTeamChange(root, before, next)
    }
    const saved = core.saveTeam(root, next), data = emitTeam(root, saved)
    clearPending(root); emitSessions(root)
    return data
  })
})
ipcMain.handle('grantPermissionAndRetry', (event, dir, input) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir)
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join('\0') !== 'denialId\0requestId'
      || typeof input.requestId !== 'string' || typeof input.denialId !== 'string')
      throw gitError('INVALID_ARGUMENT', 'Yêu cầu cấp quyền không hợp lệ')
    const entry = [...pendingPermissions.entries()].find(([, item]) => item.root === root && item.id === input.requestId)
    if (!entry) throw gitError('EXPIRED', 'Yêu cầu cấp quyền đã hết hiệu lực; hãy gửi lại yêu cầu')
    const [key, request] = entry, denial = request.denials.find(item => item.id === input.denialId)
    if (!pendingValid(request)) { pendingPermissions.delete(key); emitPermissions(root); throw gitError('EXPIRED', 'Yêu cầu cấp quyền đã hết hiệu lực') }
    if (request.reserved || permissionReservations.has(key)) throw gitError('BUSY', 'Yêu cầu cấp quyền đang được xử lý')
    if (!denial?.canGrant || !denial.rule) throw gitError('UNSUPPORTED', denial?.reason || 'Không thể tự cấp quyền này')
    const members = core.team(root), agent = members.find(item => item.name === request.agent)
    if (!agent || agent.cli !== request.cli || agent.permissions.mode === 'full' || core.permissionRules(agent).includes(denial.rule))
      throw gitError('CONFLICT', 'Quyền hoặc agent đã thay đổi')
    const permissions = { ...agent.permissions, mode: 'custom',
      allowTools: agent.permissions.mode === 'custom' ? [...new Set([...agent.permissions.allowTools, denial.rule])] : [denial.rule] }
    const next = core.normalizeTeam(root, members.map(item => item.name === agent.name ? { ...item, permissions } : item))
    guardTeamChange(root, members, next)
    request.reserved = true; permissionReservations.set(key, request)
    let permissionSaved = false
    try {
      const saved = core.saveTeam(root, next)
      permissionSaved = true
      const changed = emitTeam(root, saved)
      request.retryRevision = changed.revision
      pendingPermissions.delete(key); emitPermissions(root)
      const updated = saved.find(item => item.name === agent.name), chain = newChain(root)
      chain.turns = 1
      let job
      try { job = await ask(root, updated, 0, null, chain, request.trigger,
        { rule: denial.rule, trigger: request.trigger }, request.id) }
      catch (e) { e.permissionSaved = true; throw e }
      return { runId: job.runId, team: changed.team, teamRevision: changed.revision }
    } catch (e) {
      if (permissionSaved) e.permissionSaved = true
      throw e
    } finally {
      request.reserved = false; permissionReservations.delete(key)
    }
  })
})
ipcMain.handle('accounts', event => { validSender(event); return core.accounts() })
// Giới thiệu: version and author from package.json, the changelog shipped beside it
ipcMain.handle('about', event => {
  validSender(event)
  let changelog = ''
  try { changelog = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8') } catch {}
  const { author, license, homepage } = require('./package.json')
  return { version: app.getVersion(), author, license, homepage, changelog }
})
// Cài đặt › CLI Agent. Kept in userData, not .chat/: it names what the app executes, and agents can write .chat
const cliPathsFile = () => path.join(app.getPath('userData'), 'cli-paths.json')
function savedCliPaths() {
  try { const saved = JSON.parse(fs.readFileSync(cliPathsFile(), 'utf8')); return saved && typeof saved === 'object' ? saved : {} } catch { return {} }
}
// the user's pick, else the first a scan finds: an app opened from Finder may not have the folder on its PATH
function applyCliPaths() {
  const saved = savedCliPaths(), found = core.findClis()
  core.setCliPaths(Object.fromEntries(core.CLI_BINS.map(bin => [bin, saved[bin] || found[bin][0]])))
  return { bins: core.CLI_BINS.map(bin => ({ bin, path: typeof saved[bin] === 'string' ? saved[bin] : null, found: found[bin] })), accounts: core.accounts() }
}
const cliBin = bin => { if (!core.CLI_BINS.includes(bin)) throw new Error('CLI không hợp lệ'); return bin }
ipcMain.handle('cliSettings', event => { validSender(event); return applyCliPaths() })
ipcMain.handle('setCliPath', (event, bin, file) => {
  validSender(event)
  return apiCall(() => {
    const saved = savedCliPaths()
    if (file == null) delete saved[cliBin(bin)]
    else if (typeof file === 'string' && path.isAbsolute(file) && fs.statSync(file, { throwIfNoEntry: false })?.isFile()) saved[cliBin(bin)] = file
    else throw new Error('Không phải file chạy được')
    core.atomicWrite(cliPathsFile(), JSON.stringify(saved, null, 2))
    return applyCliPaths()
  })
})
ipcMain.handle('pickCliPath', async (event, bin) => {
  validSender(event)
  const picked = await dialog.showOpenDialog(win, { title: `Chọn file chạy của ${cliBin(bin)}`, properties: ['openFile', 'showHiddenFiles'] })
  return picked.canceled ? null : picked.filePaths[0]
})
ipcMain.handle('checkClis', (event, bin) => {
  validSender(event)
  return core.checkClis(core.accounts().filter(name => !bin || core.account(name)?.bin === bin))
})
ipcMain.handle('sessions', (event, dir) => {
  validSender(event)
  return sessionMap(knownProject(dir))
})
ipcMain.handle('cliSessions', (event, cli, dir, agentName) => {
  validSender(event)
  const root = knownProject(dir), enabled = core.projectSettings(root).settings.worktreesEnabled
  if (enabled && !agentName) throw gitError('INVALID_ARGUMENT', 'Cần chọn agent khi worktree đang bật')
  const context = agentName ? agentSessionContext(root, agentName) : { cwd: root, workspaceId: null }
  if (!context.cwd) return []
  return core.cliSessions(cli, context.cwd)
})
ipcMain.handle('models', (event, cli) => { validSender(event); return core.models(cli) })
ipcMain.handle('useSession', async (event, dir, name, cli, id, workspaceId = null) => {
  validSender(event)
  const root = knownProject(dir)
  const busy = () => jobs.some(j => j.root === root && j.name === name) || orphans.some(o => o.root === root && o.name === name)
    || permissionReservations.has(permissionKey(root, name))
  if (busy()) throw new Error(`@${name} còn lượt, khóa cũ hoặc thao tác cấp quyền`)
  let context = agentSessionContext(root, name)
  if (context.workspaceId !== workspaceId) throw gitError('INVALID_ARGUMENT', 'Workspace của phiên không còn đúng')
  const index = await core.getLogIndex(root)
  if (busy()) throw new Error(`@${name} còn lượt, khóa cũ hoặc thao tác cấp quyền`)
  context = agentSessionContext(root, name)
  if (context.workspaceId !== workspaceId) throw gitError('INVALID_ARGUMENT', 'Workspace của phiên không còn đúng')
  core.setSession(dir, name, { id, cli, seen: index.records.length, seenHash: index.prefixHashes[index.records.length], at: new Date().toISOString(), adopted: true }, context.workspaceId)
  clearPending(root, name)
  emitSessions(root)
})
ipcMain.handle('resetSession', (event, dir, name) => {
  validSender(event)
  const root = knownProject(dir), busy = [...jobs, ...orphans].some(x => x.root === root && (!name || x.name === name))
    || [...permissionReservations.keys()].some(key => key.startsWith(root + '\0') && (!name || key === permissionKey(root, name)))
  if (busy) throw new Error(name ? `@${name} còn lượt hoặc khóa cũ` : 'Box đang có lượt hoặc khóa cũ')
  if (name) core.setSession(dir, name, null, agentSessionContext(root, name).workspaceId)
  else {
    core.setSession(dir, null, null)
    for (const workspace of readWorktrees(root).agents) core.setSession(root, null, null, workspace.id)
  }
  clearPending(root, name)
  emitSessions(root)
}) // name null → reset all
ipcMain.handle('stop', (event, dir, name, runId) => {
  validSender(event)
  if (![dir, name, runId].every(v => typeof v === 'string' && v)) throw new Error('Tham số Dừng không hợp lệ')
  const root = knownProject(dir), job = jobs.find(j => j.root === root && j.name === name && j.runId === runId)
  return { accepted: job ? stopJob(job, 'stopped') : false }
})
ipcMain.handle('releaseLock', async (event, dir, runId) => {
  validSender(event)
  const root = knownProject(dir), lock = orphans.find(o => o.root === root && o.runId === runId)
  if (!lock || lock.state !== 'unknown') return { released: false }
  const state = orphanState(lock.pgid)
  if (state === 'alive') { lock.state = 'alive'; sendLocks(root); scheduleOrphanProbe(); return { released: false } }
  if (state !== 'dead') {
    const answer = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Huỷ', 'Giải phóng'], defaultId: 0, cancelId: 0,
      message: 'Chỉ giải phóng sau khi bạn đã kiểm tra CLI cũ không còn chạy.', detail: `Agent: ${lock.name}\nRun: ${lock.runId}` })
    if (answer.response !== 1) return { released: false }
  }
  if (lock.kind === 'integration') pauseInterruptedMerge(root, lock.runId)
  orphans.splice(orphans.indexOf(lock), 1)
  persistRegistry(root); sendLocks(root); pump()
  return { released: true }
})

// theme: set natively, so the page's prefers-color-scheme, menus, dialogs and scrollbars all follow; kept across restarts
const THEMES = ['system', 'light', 'dark']
const themeFile = () => path.join(app.getPath('userData'), 'theme.json')
const windowBg = () => nativeTheme.shouldUseDarkColors ? '#151517' : '#f7f7f8' // --bg: no white flash before the page paints
ipcMain.handle('theme', (event, source) => {
  validSender(event)
  if (source != null) {
    if (!THEMES.includes(source)) throw new Error('Giao diện không hợp lệ')
    nativeTheme.themeSource = source
    try { core.atomicWrite(themeFile(), JSON.stringify(source)) } catch {}
  }
  return nativeTheme.themeSource
})

// size/position survive restarts; a spot on a screen that's gone (unplugged monitor) falls back to the default
const windowFile = () => path.join(app.getPath('userData'), 'window.json')
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(windowFile(), 'utf8'))
    if (![b.x, b.y, b.width, b.height].every(Number.isInteger)) return {}
    const seen = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100)
    return seen ? { x: b.x, y: b.y, width: b.width, height: b.height, maximized: b.maximized === true } : {}
  } catch { return {} }
}

// menu items only tell the renderer: it owns the dialogs and the open box
function setMenu() {
  const send = action => () => win?.webContents.send('menu', action)
  const settings = { label: 'Cài đặt nhóm…', accelerator: 'CmdOrCtrl+,', click: send('settings') }
  const about = { label: 'Giới thiệu Agent Chat', click: send('about') } // own dialog: version, author, changelog on both OSes
  const appSettings = { label: 'Cài đặt chung…', click: send('app-settings') }
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    mac ? { label: app.name, submenu: [about, { type: 'separator' }, appSettings, settings, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
      : { label: 'Tệp', submenu: [about, appSettings, settings, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'Đi tới', submenu: [
      { label: 'Chuyển không gian…', accelerator: 'CmdOrCtrl+K', click: send('switch') },
      { label: 'Box tiếp theo đang cần bạn', accelerator: 'CmdOrCtrl+J', click: send('next-need') },
      { label: 'Tìm trong lịch sử', accelerator: 'CmdOrCtrl+F', click: send('search') },
      { label: 'Timeline agent', accelerator: 'CmdOrCtrl+Shift+T', click: send('timeline') }] },
    { label: 'Xem', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
  ]))
}

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else app.whenReady().then(() => {
  core.setTrustFile(path.join(app.getPath('userData'), 'trust.json'))
  applyCliPaths()
  for (const dir of projects()) loadOrphans(dir)
  setMenu()
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'build/icon.png')) // packaged builds carry it in the bundle
  try { const t = JSON.parse(fs.readFileSync(themeFile(), 'utf8')); if (THEMES.includes(t)) nativeTheme.themeSource = t } catch {}
  const { maximized, ...bounds } = savedBounds()
  win = new BrowserWindow({ width: 1280, height: 820, ...bounds, minWidth: 960, minHeight: 560,
    backgroundColor: windowBg(),
    // macOS: the sidebar runs up under the traffic lights (index.html pads body.mac for them)
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
    } })
  if (session?.defaultSession?.protocol?.handle) {
    session.defaultSession.protocol.handle('agent-preview', async request => handleAgentPreview(request))
  }
  if (session?.defaultSession?.webRequest?.onBeforeRequest) {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*', 'agent-preview://*/*'] }, (details, callback) => {
      if (!win || win.isDestroyed?.()) return callback({ cancel: true })
      if (details.webContentsId && win.webContents?.id && details.webContentsId !== win.webContents.id) {
        return callback({ cancel: true })
      }
      const isMainFrame = details.frame && win.webContents?.mainFrame && details.frame === win.webContents.mainFrame
      if (isMainFrame && details.resourceType !== 'subFrame') {
        return callback({ cancel: false })
      }
      if (details.method !== 'GET') return callback({ cancel: true })
      if (!activePreview || activePreview.closed) return callback({ cancel: true })
      let url
      try { url = new URL(details.url) } catch { return callback({ cancel: true }) }
      if (url.protocol !== 'agent-preview:' || url.hostname !== activePreview.token) return callback({ cancel: true })
      if (url.username || url.password || url.port) return callback({ cancel: true })
      if (!url.pathname.startsWith('/files/')) return callback({ cancel: true })
      if (details.resourceType === 'subFrame') {
        const encodedEntry = activePreview.entryRelativePath.split('/').map(encodeURIComponent).join('/')
        if (url.pathname !== `/files/${encodedEntry}`) return callback({ cancel: true })
        return callback({ cancel: false })
      }
      if (details.resourceType === 'stylesheet') {
        const ext = path.extname(url.pathname.split(/[?#]/, 1)[0]).toLowerCase()
        if (ext !== '.css') return callback({ cancel: true })
        return callback({ cancel: false })
      }
      if (details.resourceType === 'image') {
        const ext = path.extname(url.pathname.split(/[?#]/, 1)[0]).toLowerCase()
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return callback({ cancel: true })
        return callback({ cancel: false })
      }
      return callback({ cancel: true })
    })
  }
  if (session?.defaultSession?.on) {
    session.defaultSession.on('will-download', (event, item, wc) => {
      if (wc && win.webContents && wc === win.webContents && activePreview && !activePreview.closed) {
        event.preventDefault()
      }
    })
  }
  win.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame) return
    if (activePreview && !activePreview.closed) {
      let parsed
      try { parsed = new URL(event.url) } catch {}
      if (parsed && parsed.protocol === 'agent-preview:' && parsed.hostname === activePreview.token) {
        if (!activePreview.navigated) {
          activePreview.navigated = true
          return
        }
      }
    }
    event.preventDefault()
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      if (activePreview && !activePreview.closed) {
        win?.webContents?.send('html-preview-escape', activePreview.id)
      }
    }
  })
  if (maximized) win.maximize()
  const onThemeUpdated = () => {
    if (!win || win.isDestroyed()) return
    win.setBackgroundColor(windowBg())
  }
  nativeTheme.on('updated', onThemeUpdated)
  win.on('closed', () => {
    nativeTheme.removeListener('updated', onThemeUpdated)
    win = null
  })
  win.on('close', () => {
    closeCurrentPreview()
    try { core.atomicWrite(windowFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })) } catch {}
  })
  // Closing never stops agents (the user chose that): CLIs keep running detached and may still edit files, but their
  // answers and the queue are lost, so ask first. Cmd+Q closes the window too, so this covers both.
  win.on('close', event => {
    const busy = [...new Set(jobs.filter(job => !job.finished).map(job => `@${job.name}`))]
    if (mergeWorkers.size) busy.push('kiểm tra gộp')
    if (!busy.length) return
    const answer = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Ở lại', 'Vẫn thoát'], defaultId: 0, cancelId: 0,
      message: `${busy.join(', ')} vẫn đang chạy hoặc chờ`,
      detail: 'App không dừng tiến trình: CLI vẫn chạy ngầm và có thể tiếp tục sửa file, nhưng câu trả lời và hàng chờ của lượt này sẽ mất.' })
    if (answer !== 1) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadFile('index.html').then(() => win.webContents.on('will-navigate', event => { event.preventDefault(); closeCurrentPreview() }))
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
})
app.on('window-all-closed', () => { clearProjectWatch(); app.quit() })
