const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const { execFileSync, execFile } = require('child_process')
const { randomUUID, createHash } = require('crypto')
const { promisify } = require('util')
const fs = require('fs'), path = require('path')
const rawFs = process.versions.electron ? require('original-fs') : fs
const core = require('./core')

// Apps launched from Finder don't get the shell PATH, so claude/codex/agy wouldn't be found.
try {
  const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__PATH__%s" "$PATH"'], { encoding: 'utf8' })
  process.env.PATH = out.split('__PATH__').pop()
} catch {}

const TASK_STATUS_LABELS = { todo: 'Cần làm', doing: 'Đang làm', review: 'Chờ duyệt', done: 'Xong' }
const RETRYABLE_MERGE_STATES = ['conflict', 'check-failed', 'blocked-dirty', 'blocked-config', 'needs-deps', 'error', 'paused']
const jobs = [], orphans = [], loadedRoots = new Set(), rootDirs = new Map()
const summaryUnavailable = new Set()
const logGenerations = new Map(), appLogWrites = new Map()
const continuedChains = new Set()
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
    const result = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, ...options })
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
const worktreeFile = root => path.join(root, '.chat', 'worktrees.json')
function readWorktrees(root) {
  try {
    const data = JSON.parse(fs.readFileSync(worktreeFile(root), 'utf8'))
    if (data?.version !== 1 || typeof data.targetRef !== 'string' || !Array.isArray(data.agents) || !Array.isArray(data.queue))
      throw new Error('schema')
    return data
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, targetRef: null, targetSha: null, agents: [], queue: [] }
    throw gitError('CONFIG_ERROR', 'Registry worktree không hợp lệ')
  }
}
function writeWorktrees(root, data) {
  const file = worktreeFile(root), temp = file + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(data, null, 2)); fs.renameSync(temp, file)
  worktreeRevisions.set(root, (worktreeRevisions.get(root) || 0) + 1)
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
  const trackedChat = (await git(root, ['ls-files', '-z', '--', '.chat'])).stdout
  if (trackedChat) throw gitError('TRACKED_RUNTIME', '.chat đang được Git theo dõi; hãy bỏ khỏi index trước')
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
  const existing = new Set(text.split(/\r?\n/)), missing = ['.chat', '.chat/', 'node_modules/', 'dist/', '.DS_Store'].filter(line => !existing.has(line))
  if (missing.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}${text.includes('# agent-chat runtime') ? '' : '# agent-chat runtime\n'}${missing.join('\n')}\n`)
  }
  const ignored = await git(root, ['check-ignore', '-q', '.chat/log.jsonl']).then(() => true).catch(() => false)
  if (!ignored) throw gitError('UNSUPPORTED_REPO', 'Không thể loại .chat khỏi Git')
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
  const shared = path.join(expected, '.chat')
  try {
    if (!fs.lstatSync(shared).isSymbolicLink() || fs.realpathSync(shared) !== fs.realpathSync(path.join(root, '.chat')))
      throw new Error('bad link')
  } catch { throw gitError('CONFIG_ERROR', '.chat trong workspace không trỏ đúng dữ liệu chung') }
  return expected
}

async function bootstrapDependencies(root, cwd) {
  const manifests = ['package.json', 'package-lock.json']
  for (const file of manifests) {
    const left = path.join(root, file), right = path.join(cwd, file)
    if (fs.existsSync(left) !== fs.existsSync(right) || (fs.existsSync(left) && !fs.readFileSync(left).equals(fs.readFileSync(right)))) return false
  }
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
      fs.symlinkSync(path.join(root, '.chat'), path.join(cwd, '.chat'), 'dir')
      record = { id, agent: agent.name, branch, path: cwd, baseSha: probe.sha }
      registry.agents.push(record); writeWorktrees(root, registry)
    }
    const cwd = await verifyWorkspace(root, record), status = (await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout
    if (status) throw gitError('DIRTY_WORKSPACE', `Workspace của ${agent.name} có thay đổi chưa được app ghi nhận`)
    const head = await gitHead(cwd), behind = await git(cwd, ['merge-base', '--is-ancestor', head, probe.sha]).then(() => true).catch(() => false)
    const ahead = Number((await git(cwd, ['rev-list', '--count', `${probe.sha}..${head}`])).stdout.trim() || 0)
    if (behind && !ahead && head !== probe.sha) await git(cwd, ['merge', '--ff-only', probe.sha])
    const depsReady = await bootstrapDependencies(root, cwd)
    return { cwd, workspaceId: record.id, branch: record.branch, worktree: true, baseSha: await gitHead(cwd), depsReady }
  })
}

function queueLabel(entry) {
  return ({ queued: 'Chờ gộp', merging: 'Đang gộp', checking: 'Đang kiểm tra', publishing: 'Đang xuất bản', merged: 'Đã gộp',
    conflict: 'Xung đột', 'check-failed': 'Check lỗi', 'blocked-dirty': 'Thư mục chính bẩn', 'blocked-config': 'Cấu hình đổi',
    'needs-deps': 'Thiếu dependency', paused: 'Đã dừng', error: 'Lỗi' })[entry.state] || entry.state
}

async function worktreeState(root) {
  const { settings } = core.projectSettings(root)
  let probe, reason = null
  try { probe = await repoProbe(root) } catch (e) { reason = e.message }
  const registry = readWorktrees(root), agents = []
  for (const record of registry.agents) {
    let ahead = 0
    try { ahead = Number((await git(root, ['rev-list', '--count', `${probe?.sha || registry.targetSha}..${record.branch}`])).stdout.trim() || 0) } catch {}
    agents.push({ name: record.agent, workspaceId: record.id, branch: record.branch, ahead,
      busy: jobs.some(job => job.root === root && job.workspaceId === record.id && !job.finished) })
  }
  const queue = await Promise.all(registry.queue.filter(entry => !entry.supersededBy).map(async entry => {
    // Old registries keep failed attempts even after a retry (or a later commit) was merged.
    if (probe?.branch === registry.targetRef && RETRYABLE_MERGE_STATES.includes(entry.state)
      && await git(root, ['merge-base', '--is-ancestor', entry.headSha, probe.sha]).then(() => true).catch(() => false))
      entry = { ...entry, state: 'merged', error: null }
    return { id: entry.id, agent: entry.agent, headSha: entry.headSha, state: entry.state, label: queueLabel(entry),
      error: entry.error || null, canRetry: RETRYABLE_MERGE_STATES.includes(entry.state),
      canRepair: ['conflict', 'check-failed'].includes(entry.state), canStop: ['queued', 'checking'].includes(entry.state) }
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
  const lines = ['.chat', '.chat/', 'node_modules/', 'dist/', '.DS_Store', '.env*', '*.pem', '*.key', '*.p12']
  let text = existing
  for (const line of lines) if (!new RegExp(`(^|\\n)${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\n)`).test(text)) text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`
  return text
}
async function gitInitPreview(root) {
  if (fs.existsSync(path.join(root, '.git'))) throw gitError('UNSUPPORTED_REPO', 'Thư mục đã có .git')
  const files = [], fingerprints = []
  async function walk(folder, prefix = '') {
    for (const entry of await rawFs.promises.readdir(folder, { withFileTypes: true })) {
      if ((!prefix && ['.git', '.chat', 'node_modules', 'dist'].includes(entry.name)) || entry.name === '.DS_Store'
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
  fs.writeFileSync(path.join(root, '.gitignore'), preview.ignoreText)
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

async function commitWorkspace(job, result, changed, auditComplete, outside) {
  if (!job.worktree || result.orphanState) return null
  return withGitLock(job.root, async () => {
    const registry = readWorktrees(job.root), record = registry.agents.find(item => item.id === job.workspaceId)
    if (!record) throw gitError('CONFIG_ERROR', 'Không tìm thấy workspace của agent')
    const cwd = await verifyWorkspace(job.root, record), beforeHead = await gitHead(cwd)
    if (beforeHead !== job.baseSha) throw gitError('TARGET_CHANGED', 'HEAD workspace đã đổi trong lúc agent chạy')
    const files = await workspaceChanges(cwd)
    if (!auditComplete || outside.length || files.some(file => !changed.includes(file) || file === '.chat' || file.startsWith('.chat/') || !core.scopeAllows(job.scope, file))) {
      if (files.length) throw gitError('SCOPE_AUDIT', 'Không tự commit vì thay đổi chưa qua kiểm tra phạm vi', { files })
      return null
    }
    let headSha = beforeHead
    if (files.length) {
      await git(cwd, ['add', '--', ...files])
      const staged = nul((await git(cwd, ['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD'])).stdout)
      if (!staged.length || staged.some(file => !files.includes(file) || !core.scopeAllows(job.scope, file)))
        throw gitError('SCOPE_AUDIT', 'Tập file chuẩn bị commit không hợp lệ', { files: staged })
      const ids = job.taskIds.length ? ` [${job.taskIds.join(', ')}]` : ''
      const message = `agent ${job.name}${ids}: ${result.outcome === 'success' ? 'hoàn tất lượt' : 'checkpoint lượt chưa hoàn tất'}`
      await git(cwd, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', message, '-m', `Agent-Chat-Run: ${job.runId}`])
      headSha = await gitHead(cwd)
    }
    const probe = await repoProbe(job.root), ahead = await git(job.root, ['merge-base', '--is-ancestor', headSha, probe.sha]).then(() => false).catch(() => true)
    if (result.outcome === 'success' && ahead) {
      const settings = core.projectSettings(job.root).settings
      if (!registry.queue.some(entry => entry.runId === job.runId && entry.headSha === headSha)) registry.queue.push({ id: randomUUID(), agent: job.name,
        runId: job.runId, workspaceId: job.workspaceId, headSha, checks: [...settings.mergeChecks], state: job.depsReady === false ? 'needs-deps' : 'queued',
        baseSha: probe.sha, candidateSha: null, error: job.depsReady === false ? { code: 'NEEDS_DEPS', message: 'Workspace chưa có dependency phù hợp', files: [], log: '' } : null,
        pgid: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      registry.targetSha = probe.sha
      writeWorktrees(job.root, registry)
      pumpMerge(job.root).catch(e => console.error(e))
    }
    return { id: record.id, branch: record.branch, headSha }
  })
}

function mergeError(entry, code, message, files = [], log = '') {
  entry.state = code === 'DIRTY_ROOT' ? 'blocked-dirty' : code === 'CHECK_NOT_ALLOWED' || code === 'TARGET_CHANGED' || code === 'SCOPE_AUDIT'
    ? 'blocked-config' : code === 'NEEDS_DEPS' ? 'needs-deps' : code === 'CONFLICT' ? 'conflict' : code === 'CHECK_FAILED' || code === 'CHECK_MUTATED_TREE'
      ? 'check-failed' : code === 'PAUSED' ? 'paused' : 'error'
  entry.error = { code, message: redactManagedPath(message), files: files.slice(0, 50), log: redactManagedPath(String(log).slice(-32768)) }
  entry.updatedAt = new Date().toISOString(); entry.pgid = null
}

async function removeIntegration(root, entry) {
  const cwd = managedPath(root, 'integration', entry.id)
  if (fs.existsSync(cwd)) await git(root, ['worktree', 'remove', '--force', cwd]).catch(() => {})
}

async function processMerge(root, queued) {
  const registry = readWorktrees(root), entry = registry.queue.find(item => item.id === queued.id), settings = core.projectSettings(root).settings
  if (!entry || entry.state !== 'queued' || entry.supersededBy) return
  if (!settings.worktreesEnabled) return
  const owner = core.team(root).find(agent => agent.name === entry.agent)
  if (!owner) { mergeError(entry, 'CHECK_NOT_ALLOWED', 'Agent sở hữu nhánh không còn trong nhóm'); writeWorktrees(root, registry); return }
  for (const command of entry.checks) if (!owner.allowedCommands.includes(command)) {
    mergeError(entry, 'CHECK_NOT_ALLOWED', `Lệnh "${command}" không còn được phép`); writeWorktrees(root, registry); return
  }
  let integration = managedPath(root, 'integration', entry.id)
  try {
    entry.state = 'merging'; entry.error = null; entry.updatedAt = new Date().toISOString(); writeWorktrees(root, registry); await emitWorktreeState(root)
    const probe = await repoProbe(root, { requireClean: true })
    if (probe.branch !== registry.targetRef) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
    const included = await git(root, ['merge-base', '--is-ancestor', entry.headSha, probe.sha]).then(() => true).catch(() => false)
    if (included) { entry.state = 'merged'; entry.updatedAt = new Date().toISOString(); registry.targetSha = probe.sha; writeWorktrees(root, registry); return }
    const base = (await git(root, ['merge-base', probe.sha, entry.headSha])).stdout.trim()
    const files = nul((await git(root, ['diff', '--no-renames', '--name-only', '-z', `${base}..${entry.headSha}`])).stdout)
    const scope = core.normalizeScope(owner, root)
    if (files.some(file => !core.scopeAllows(scope, file) || file === '.chat' || file.startsWith('.chat/')))
      throw gitError('SCOPE_AUDIT', 'Nhánh chứa file ngoài phạm vi', { files })
    entry.baseSha = probe.sha
    fs.mkdirSync(path.dirname(integration), { recursive: true })
    await git(root, ['worktree', 'add', '--detach', integration, probe.sha])
    if (!await bootstrapDependencies(root, integration)) throw gitError('NEEDS_DEPS', 'Integration worktree chưa có dependency phù hợp')
    try { await git(integration, ['merge', '--no-ff', '--no-commit', entry.headSha]) }
    catch (e) {
      const conflicts = nul((await git(integration, ['diff', '--name-only', '--diff-filter=U', '-z'])).stdout)
      if (conflicts.length) throw gitError('CONFLICT', 'Nhánh xung đột với thay đổi đã gộp', { files: conflicts })
      throw e
    }
    await git(integration, ['-c', 'user.name=Agent Chat', '-c', 'user.email=agent-chat@local', 'commit', '-m', `merge agent ${entry.agent}`, '-m', `Agent-Chat-Queue: ${entry.id}`])
    entry.candidateSha = await gitHead(integration); entry.state = 'checking'; entry.updatedAt = new Date().toISOString(); writeWorktrees(root, registry); await emitWorktreeState(root)
    const controller = new AbortController(); mergeControllers.set(root, { entry, controller })
    persistRegistry(root)
    try {
      for (const command of entry.checks) {
        const timer = setTimeout(() => controller.abort('timeout'), core.timeoutMinutes(owner) * 60000)
        const result = await core.runCommand(integration, command, { signal: controller.signal, onSpawn: pid => {
          entry.pgid = pid; entry.updatedAt = new Date().toISOString(); writeWorktrees(root, registry); persistRegistry(root)
        } })
        clearTimeout(timer); entry.pgid = null; writeWorktrees(root, registry); persistRegistry(root)
        if (controller.signal.aborted) throw gitError('PAUSED', controller.signal.reason === 'timeout' ? 'Kiểm tra gộp quá giờ' : 'Đã dừng kiểm tra gộp')
        if (result.error || result.exitCode !== 0) throw gitError('CHECK_FAILED', `Lệnh kiểm tra lỗi: ${command}`, { log: `${result.stdout}\n${result.stderr}` })
      }
    } finally { mergeControllers.delete(root) }
    if ((await git(integration, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).stdout)
      throw gitError('CHECK_MUTATED_TREE', 'Lệnh kiểm tra đã sửa cây source')
    entry.state = 'publishing'; entry.updatedAt = new Date().toISOString(); writeWorktrees(root, registry); await emitWorktreeState(root)
    const latest = await repoProbe(root, { requireClean: true })
    if (latest.branch !== registry.targetRef) throw gitError('TARGET_CHANGED', 'Nhánh chính đã đổi ngoài app')
    if (latest.sha !== probe.sha) {
      await removeIntegration(root, entry)
      entry.state = 'queued'; entry.baseSha = latest.sha; entry.candidateSha = null; entry.error = null; entry.pgid = null
      entry.updatedAt = new Date().toISOString(); registry.targetSha = latest.sha; writeWorktrees(root, registry)
      return
    }
    await git(root, ['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', '--no-autostash', entry.candidateSha])
    const published = await gitHead(root)
    if (published !== entry.candidateSha) throw gitError('TARGET_CHANGED', 'Không xác minh được commit đã xuất bản')
    entry.state = 'merged'; entry.error = null; entry.updatedAt = new Date().toISOString(); registry.targetSha = published; writeWorktrees(root, registry)
    await removeIntegration(root, entry)
    await post(root, 'system', `Đã gộp nhánh của ${entry.agent} sau khi kiểm tra đạt.`, { kind: 'merge', queueId: entry.id, owner: entry.agent, headSha: entry.headSha })
  } catch (e) {
    mergeError(entry, e.code || 'GIT_ERROR', e.message, e.files || [], e.log || '')
    writeWorktrees(root, registry)
    await post(root, 'system', `@${entry.agent} chưa gộp được nhánh: ${e.message}`, { kind: 'merge', queueId: entry.id, owner: entry.agent,
      headSha: entry.headSha, error: entry.error })
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
      const registry = readWorktrees(root), entry = registry.queue.find(item => item.state === 'queued')
      if (!entry) break
      await withGitLock(root, () => processMerge(root, entry))
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
  logGenerations.set(root, appended.generation)
  win?.webContents.send('message', dir, appended.message, { generation: appended.generation, total: appended.total, totals: appended.totals })
  return { ...appended.message, ...(appended.taskError ? { taskError: appended.taskError } : {}) }
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
    .map(({ name, runId, label, stopping, phase, blockedBy }) => ({ name, runId, label, stopping, phase, blockedBy }))
}
const orphanFor = dir => {
  const root = rootOf(dir)
  return orphans.filter(lock => lock.root === root).map(({ name, runId, scope, state }) => ({ name, runId, owns: scope.owns, readOnly: scope.readOnly, state }))
}
function progress(job, label = job.label) {
  job.label = label
  win?.webContents.send('progress', job.dir, job.name,
    { runId: job.runId, label, phase: job.phase, blockedBy: job.blockedBy || [], stopping: job.stopping })
}

async function terminal(job, result, waiting = false) {
  const text = result.outcome === 'stopped' ? `@${job.name} đã bị dừng${waiting ? ' khi chờ' : ''}`
    : result.outcome === 'timeout' ? `@${job.name} quá giờ${waiting ? ' khi chờ khóa' : ''}`
      : result.outcome === 'error' ? `@${job.name} lỗi: ${result.text}` : result.text
  const msg = await post(job.dir, result.outcome === 'success' ? job.name : 'system', text,
    { runId: job.runId, agent: job.name, cli: job.agent.cli, outcome: result.outcome, usage: result.usage,
      ...(result.taskUpdates?.length ? { taskUpdates: result.taskUpdates } : {}),
      ...(result.commandResults?.length ? { commandResults: result.commandResults } : {}), ...(result.logExtra || {}) },
    result.taskChanges ? { taskChanges: result.taskChanges, actor: job.name } : {})
  if (msg.taskUpdates) result.taskUpdates = msg.taskUpdates
  if (msg.taskError) result.taskError = msg.taskError
  win?.webContents.send('usage', job.dir, job.name, { runId: job.runId, usage: result.usage })
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
  try { await terminal(job, { outcome, text, usage: zeroUsage() }, outcome === 'stopped' || outcome === 'timeout') }
  finally { removeJob(job) }
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

const newChain = root => {
  const { chainLimit, costCeiling } = core.projectSettings(root).settings
  return { id: randomUUID(), turns: 0, costUsd: 0, chainLimit, costCeiling, noProgress: [], pingPong: null }
}
async function haltChain(dir, chain, reason, targets) {
  const names = [...new Set(targets.map(agent => agent.name))]
  return post(dir, 'system', reason, { kind: 'chain-stop', canContinue: true, runId: chain.id, targets: names,
    continuationTarget: names.map(name => `@${name}`).join(' ') })
}
async function route(dir, msg, hops, chain = null) {
  const members = core.team(dir)
  let targets = core.mentions(msg.text, members, msg.from)
  if (msg.from === 'user' && !targets.length) targets = members.slice(0, 1) // no @ → first member (PM)
  if (!targets.length) return
  chain ||= newChain(rootOf(dir))
  if (chain.pingPong) return haltChain(dir, chain, `${chain.pingPong.join(' và ')} đã chat qua lại 3 vòng mà không có file hoặc task thay đổi.`, targets)
  if (chain.costCeiling != null && chain.costUsd >= chain.costCeiling)
    return haltChain(dir, chain, `Dừng chuỗi vì chi phí đã đạt USD ${chain.costCeiling.toFixed(4)}.`, targets)
  for (let i = 0; i < targets.length; i++) {
    if (chain.turns >= chain.chainLimit)
      return haltChain(dir, chain, `Dừng sau ${chain.chainLimit} lượt agent liên tiếp.`, targets.slice(i))
    chain.turns++
    await ask(dir, targets[i], hops, null, chain, msg)
  }
}

// One job at a time per agent; different agents run in parallel.
function sharedMetadataLocks(scope, root) {
  const files = ['.chat/memory.md', '.chat/tasks.json', '.chat/tasks.json.tmp']
  return files.filter(file => scopeAllowsForJob(scope, file)).map(file => ({ path: path.join(root, ...file.split('/')), tree: false }))
}
const scopeAllowsForJob = (scope, file) => !scope.readOnly && (!scope.owns.length || core.scopeAllows(scope, file))

async function ask(dir, agent, hops, special = null, chain = null, trigger = null, retryContext = null, grantRequestId = null) {
  const root = rootOf(dir)
  const reserved = permissionReservations.get(permissionKey(root, agent.name))
  if (reserved && reserved.id !== grantRequestId) throw gitError('BUSY', `@${agent.name} đang cấp quyền`)
  if (!grantRequestId) clearPending(root, agent.name)
  let setupError
  try { if (!special) migrateTaskScope(dir) } catch (e) { if (String(agent.name).toLowerCase() === 'pm') setupError = `Không nâng được quyền task cho PM: ${e.message}` }
  agent = core.team(dir).find(a => a.name === agent.name) || agent
  if (special?.kind === 'summary') agent = { ...agent, resume: false, allowedCommands: [], permissions: { mode: 'edit', allowTools: [], networkAccess: false }, owns: [], readOnly: true }
  const scope = core.normalizeScope(agent, root)
  let workspace = { cwd: root, workspaceId: null, branch: null, worktree: false }
  if (!special) try { workspace = await prepareWorkspace(root, agent) } catch (e) { setupError ||= e.message }
  let taskIds = []
  if (!special) try { taskIds = (await core.taskBoardIndexed(root)).tasks.filter(task => task.assignee === agent.name && task.status !== 'done').map(task => task.id) } catch {}
  if (grantRequestId) {
    const grant = permissionReservations.get(permissionKey(root, agent.name))
    if (!grant || grant.id !== grantRequestId) throw gitError('CANCELLED', 'Thao tác cấp quyền đã bị huỷ')
    if (grant.retryRevision !== core.teamRevision(root) || grant.generation !== logGenerations.get(root)
      || grant.workspaceId !== workspace.workspaceId) throw gitError('CONFLICT', 'Dự án đã thay đổi sau khi lưu quyền')
  }
  const capturedTrigger = trigger && typeof trigger.from === 'string' && typeof trigger.text === 'string' && Buffer.byteLength(trigger.text) <= 32768
    ? { from: trigger.from, text: trigger.text, ...(Number.isInteger(trigger.seq) ? { seq: trigger.seq } : {}) } : null
  const job = { dir, root, name: agent.name, key: runKey(root, agent.name), runId: randomUUID(), seq: sequence++, hops,
    agent: { ...agent, owns: [...scope.owns], readOnly: scope.readOnly, scopeNeedsReview: scope.scopeNeedsReview,
      allowedCommands: [...agent.allowedCommands], permissions: agent.permissions && typeof agent.permissions === 'object'
        ? { ...agent.permissions, allowTools: Array.isArray(agent.permissions.allowTools) ? [...agent.permissions.allowTools] : agent.permissions.allowTools } : agent.permissions,
      avatar: { ...agent.avatar } }, scope,
    locks: workspace.worktree ? sharedMetadataLocks(scope, root) : core.scopeLocks(scope, root), label: 'đang xếp hàng…', phase: 'queued', blockedBy: [], stopping: false,
    finished: false, headStarted: false, reserved: false, spawned: false, pgid: null, setupError,
    controller: new AbortController(), auditController: new AbortController(), timer: null, taskIds, chain, trigger: capturedTrigger,
    retryContext, ...workspace, ...(special || {}) }
  jobs.push(job)
  if (heads().includes(job)) startHead(job)
  return job
}

async function scheduleSummary(dir) {
  const root = rootOf(dir)
  if (jobs.some(job => job.root === root && job.kind === 'summary')) return
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

function recordChainTurn(job, result, changed, metadataChanged, auditComplete) {
  const chain = job.chain
  if (!chain || result.outcome !== 'success') return
  if (typeof result.usage?.costUsd === 'number') chain.costUsd += result.usage.costUsd
  if (!auditComplete || changed.length || metadataChanged.length || result.taskUpdates?.length) {
    chain.noProgress = []; chain.pingPong = null; return
  }
  chain.noProgress.push(job.name)
  chain.noProgress = chain.noProgress.slice(-6)
  if (chain.noProgress.length === 6 && new Set(chain.noProgress.map(name => name.toLowerCase())).size === 2
    && chain.noProgress.every((name, index, list) => index < 2 || name.toLowerCase() === list[index - 2].toLowerCase()))
    chain.pingPong = [...new Set(chain.noProgress.map(name => name.toLowerCase()))]
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
  try {
    before = await core.snapshot(job.cwd || job.root, { signal: job.controller.signal, excludeChat: job.worktree })
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
      onProgress: label => { if (!job.stopping) progress(job, label) },
      onSpawn: pid => { job.spawned = true; job.pgid = pid; persistRegistry(job.root) },
      onSessionChanged: () => { try { emitSessions(job.root) } catch (e) { console.error('Không gửi được trạng thái phiên:', e) } },
      ...(job.retryContext ? { retryContext: job.retryContext } : {}),
      ...(job.initialPrompt ? { initialPrompt: job.initialPrompt } : {}),
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
      changed = core.changedPaths(before, after)
      paths = changed.filter(file => !core.scopeAllows(job.scope, file))
      if (job.worktree) {
        if (!metadataBefore) throw new Error('Không có snapshot metadata ban đầu')
        const metadataAfter = await core.snapshot(job.root, { signal: job.auditController.signal, onlyChat: true })
        metadataChanged = core.changedPaths(metadataBefore, metadataAfter)
        paths.push(...metadataChanged.filter(file => !core.scopeAllows(job.scope, file)))
      }
    } catch { auditComplete = false }
    if (job.auditController.signal.aborted) {
      result.outcome = 'stopped'
      result.text = '(đã dừng khi kiểm tra file)'
      result.usage.partial = true
      auditComplete = false
    }
  } else if (result.orphanState) auditComplete = false

  if (job.worktree && !result.orphanState) try {
    const workspace = await commitWorkspace(job, result, changed, auditComplete, paths)
    if (workspace) result.logExtra = { ...(result.logExtra || {}), workspace }
  } catch (e) { workspaceError = e }

  let msg, taskError
  if (job.kind === 'summary') {
    try {
      if (result.outcome === 'success') {
        if (result.emptyResponse) throw new Error('PM không trả nội dung tóm tắt')
        const summary = await core.acceptSummary(job.root, job.summaryBatch, result.text, job.runId)
        result.logExtra = { kind: 'summary', summary }
        result.text = `Đã cập nhật [tóm tắt lịch sử](.chat/summary.md) đến tin ${summary.through}.`
      }
      msg = await terminal(job, result)
      if (result.logExtra?.summary) {
        try { core.materializeSummary(job.root, result.logExtra.summary); notifyProjectChanged(job.root, { files: true, file: '.chat/summary.md' }) }
        catch (e) { console.error('Không ghi được summary.md; sẽ khôi phục khi mở box:', e) }
      }
      if (job.spawned) await warning(job, paths, auditComplete)
    } catch (e) {
      result = { ...result, outcome: 'error', text: e.message, usage: result.usage || zeroUsage() }
      await terminal(job, result)
    } finally {
      if (result.orphanState) keepOrphan(job, result.orphanState); else releaseReservation(job)
      removeJob(job)
    }
    return
  }
  if (result.outcome === 'success') {
    const parsed = core.parseTaskStatusBlock(result.text)
    if (parsed.error || parsed.changes) result.text = parsed.text || '(không có phản hồi)'
    if (parsed.error) taskError = parsed.error
    else if (parsed.changes) result.taskChanges = parsed.changes
    const handoff = core.parseHandoffBlock(result.text)
    if (handoff.requested) result.text = handoff.text || '(không có phản hồi)'
    if (handoff.error) handoffError = handoff.error
    else if (handoff.handoff) try { core.writeHandoff(job.root, job.name, job.workspaceId || null, job.runId, handoff.handoff) }
      catch (e) { handoffError = e.message }
  }
  try {
    msg = await terminal(job, result)
    taskError ||= result.taskError
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
      await post(job.dir, 'system', `${job.name} mở phiên mới: lượt trước ${result.sessionRotation.inputTokens.toLocaleString('vi-VN')} token vào, vượt ngưỡng ${result.sessionRotation.limit.toLocaleString('vi-VN')}.${handoff}`,
        { kind: 'session-rotated', relatedRunId: job.runId })
    }
    if (workspaceError) await post(job.dir, 'system', `Không thể tạo commit cho @${job.name}: ${workspaceError.message}`,
      { kind: 'merge', owner: job.name, relatedRunId: job.runId, error: { code: workspaceError.code || 'GIT_ERROR', message: workspaceError.message,
        files: workspaceError.files || [], log: '' } })
    if (job.spawned) await warning(job, paths, auditComplete)
    recordChainTurn(job, result, changed, metadataChanged, auditComplete)
    if (result.permissionDenials?.length) {
      pendingPermission = permissionCandidate(job, result)
      await post(job.dir, 'system', `${job.name} bị từ chối quyền: ${result.permissionDenials.map(denial => denial.label).join('; ')}`,
        { kind: 'permission-denied', relatedRunId: job.runId, agent: job.name, cli: job.agent.cli, workspaceId: job.workspaceId || null,
          permissionRequestId: pendingPermission?.id || null, denials: result.permissionDenials })
    }
    if (result.outcome === 'success') await route(job.dir, msg, job.hops + 1, job.chain)
  } finally {
    if (result.orphanState) keepOrphan(job, result.orphanState)
    else releaseReservation(job)
    removeJob(job)
  }
  if (pendingPermission && pendingValid(pendingPermission)) {
    pendingPermissions.set(permissionKey(job.root, job.name), pendingPermission)
    emitPermissions(job.root)
  }
  scheduleSummary(job.root).catch(e => console.error(e))
}

const registryFile = root => path.join(root, '.chat', 'locks.json')
function registryRecords(root) {
  const live = jobs.filter(j => j.root === root && j.reserved).map(j => ({ runId: j.runId, name: j.name, owns: j.scope.owns,
    readOnly: j.scope.readOnly, locks: j.locks, pgid: j.pgid, startedAt: j.claimedAt, workspaceId: j.workspaceId || null,
    kind: 'agent', cwd: j.workspaceId ? j.cwd : root }))
  const old = orphans.filter(o => o.root === root).map(o => ({ runId: o.runId, name: o.name, owns: o.scope.owns,
    readOnly: o.scope.readOnly, locks: o.locks, pgid: o.pgid, startedAt: o.startedAt, workspaceId: o.workspaceId || null,
    kind: o.kind || 'agent', cwd: o.cwd || root }))
  const integration = [...mergeControllers.entries()].filter(([key]) => key === root).map(([, value]) => ({ runId: value.entry.id,
    name: value.entry.agent, owns: [], readOnly: false, locks: [{ path: root, tree: true }], pgid: value.entry.pgid,
    startedAt: value.entry.updatedAt, workspaceId: null, kind: 'integration', cwd: managedPath(root, 'integration', value.entry.id) }))
  return [...live, ...old, ...integration]
}
function persistRegistry(root) {
  const file = registryFile(root), temp = file + '.tmp'
  fs.writeFileSync(temp, JSON.stringify({ version: 2, runs: registryRecords(root) }, null, 2))
  fs.renameSync(temp, file)
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
  const a = process.platform === 'darwin' ? root.toLowerCase() : root
  const b = process.platform === 'darwin' ? file.toLowerCase() : file
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
  if (!workspaceId || String(href).split(/[?#]/, 1)[0].startsWith('.chat/')) return root
  const record = readWorktrees(root).agents.find(item => item.id === workspaceId)
  if (!record) throw gitError('INVALID_ARGUMENT', 'Workspace không còn tồn tại')
  const expected = managedPath(root, 'agents', record.id)
  if (path.resolve(record.path) !== expected || !fs.existsSync(expected)) throw gitError('CONFIG_ERROR', 'Workspace không hợp lệ')
  return expected
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
  add(path.join(root, '.chat'), 'chat'); add(path.join(contentRoot, 'reports'), 'reports')
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
  if (typeof input !== 'string' || !input || /[\0-\x1f\x7f]/.test(input) || input.includes('\\')) throw new Error('Đường dẫn không hợp lệ')
  let decoded
  const raw = input.split('#')[0].split('?')[0]
  try { decoded = path.isAbsolute(raw) && fs.existsSync(raw) ? raw : decodeURIComponent(raw) } catch { throw new Error('Đường dẫn mã hóa không hợp lệ') }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) || decoded.startsWith('//')) throw new Error('Không hỗ trợ kiểu liên kết này')
  if (decoded.split('/').includes('..')) throw new Error('Đường dẫn không được chứa ..')
  const file = core.resolveProjectFile(viewerRoot(root, workspaceId, decoded), decoded)
  if (!file.canOpenExternal) throw new Error('Không hỗ trợ mở trực tiếp file này')
  return file.real
}

const validSender = event => { if (event.sender !== win?.webContents) throw new Error('Nguồn IPC không hợp lệ') }
const apiError = error => {
  const detail = redactManagedPath(error.message || 'Thao tác thất bại')
  const message = error.permissionSaved ? `Đã lưu quyền nhưng chưa chạy lại: ${detail}` : detail
  return { ok: false, error: { code: error.code || 'IO_ERROR', message, ...(error.permissionSaved ? { permissionSaved: true } : {}) } }
}
const apiCall = async action => { try { return { ok: true, ...await action() } } catch (e) { return apiError(e) } }

ipcMain.handle('projects', event => { validSender(event); return projects() })
ipcMain.handle('pick', async event => {
  validSender(event)
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (r.canceled) return null
  const dir = rootOf(r.filePaths[0])
  core.init(dir)
  loadOrphans(dir)
  try { migrateTaskScope(dir) } catch (e) { console.error('Không migrate được quyền task:', e) }
  fs.writeFileSync(projectsFile(), JSON.stringify([dir, ...projects().filter(d => d !== dir)]))
  return dir
})
ipcMain.handle('open', async (event, dir) => {
  validSender(event)
  const root = knownProject(dir)
  core.init(root); loadOrphans(root)
  try { migrateTaskScope(root) } catch (e) { console.error('Không migrate được quyền task:', e) }
  await core.recoverSummary(root).catch(e => console.error('Không khôi phục được summary.md:', e))
  const history = await core.logPage(root), index = await core.getLogIndex(root), config = core.projectSettings(root)
  logGenerations.set(root, index.generation)
  scheduleSummary(root).catch(e => console.error(e))
  if (config.settings.worktreesEnabled) pumpMerge(root).catch(e => console.error(e))
  return { history, totals: core.logTotals(index), settings: config.settings, settingsRevision: config.revision,
    team: core.team(root), teamRevision: core.teamRevision(root), permissionRequests: permissionRequests(root),
    sessions: sessionMap(root), active: activeFor(root), orphanLocks: orphanFor(root) }
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
    if (togglesWorktrees && ([...jobs, ...orphans].some(item => item.root === root) || mergeControllers.has(root)
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
        && await git(root, ['merge-base', '--is-ancestor', old.headSha, probe.sha]).then(() => true).catch(() => false)) return
      const workspace = registry.agents.find(item => item.id === old.workspaceId)
      if (!workspace) throw gitError('CONFIG_ERROR', 'Workspace không còn tồn tại')
      const headSha = await gitHead(await verifyWorkspace(root, workspace)), settings = core.projectSettings(root).settings
      const id = randomUUID()
      registry.queue.push({ ...old, id, runId: randomUUID(), headSha, checks: [...settings.mergeChecks], state: 'queued',
        baseSha: probe.sha, candidateSha: null, error: null, pgid: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      old.supersededBy = id
      writeWorktrees(root, registry)
    })
    pumpMerge(root).catch(e => console.error(e))
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
    const root = knownProject(dir), registry = readWorktrees(root), entry = registry.queue.find(item => item.id === request?.queueId)
    if (!entry || !(await worktreeState(root)).queue.some(item => item.id === entry.id && item.canRepair))
      throw gitError('INVALID_ARGUMENT', 'Mục gộp không còn cần agent sửa')
    const existing = jobs.find(job => job.root === root && job.repairQueueId === entry.id && !job.finished)
    if (existing) return { runId: existing.runId }
    const owner = core.team(root).find(agent => agent.name === entry.agent)
    if (!owner) throw gitError('CONFIG_ERROR', 'Không tìm thấy agent sở hữu nhánh')
    const detail = `${entry.error?.message || 'Lỗi gộp'}${entry.error?.files?.length ? `: ${entry.error.files.join(', ')}` : ''}`
    await post(root, 'user', `@${owner.name} sửa lỗi trên nhánh của bạn rồi báo lại: ${detail}`, { kind: 'merge-repair', queueId: entry.id })
    const job = await ask(root, owner, 0, { repairQueueId: entry.id })
    return { runId: job.runId }
  })
})
ipcMain.handle('files', (event, dir) => { validSender(event); return core.files(knownProject(dir)) })
ipcMain.handle('continueChain', (event, dir, request) => {
  validSender(event)
  return apiCall(async () => {
    const root = knownProject(dir), id = request?.messageId
    let stop = null
    if (Number.isInteger(id) && id >= 0) stop = (await core.logPage(root, { around: id, limit: 1 })).messages[0]
    else if (typeof id === 'string' && id) {
      let before
      do {
        const page = await core.logPage(root, { ...(before == null ? {} : { before }), limit: 100 })
        stop = page.messages.find(message => message.runId === id)
        before = page.hasBefore ? page.start : null
      } while (!stop && before != null)
    }
    if (!stop || stop.kind !== 'chain-stop' || !Array.isArray(stop.targets) || !stop.targets.length)
      throw gitError('INVALID_ARGUMENT', 'Không tìm thấy chuỗi có thể tiếp tục')
    const key = `${stop.seq}:${stop.runId || ''}`
    if (continuedChains.has(key)) throw gitError('CONFLICT', 'Chuỗi này đã được tiếp tục')
    const members = core.team(root), targets = stop.targets.map(name => members.find(agent => agent.name.toLowerCase() === String(name).toLowerCase()))
    if (targets.some(target => !target)) throw gitError('CONFIG_ERROR', 'Agent cần tiếp tục không còn trong nhóm')
    continuedChains.add(key)
    try {
      const chain = newChain(root)
      await post(root, 'system', `Tiếp tục chuỗi với ${targets.map(target => `@${target.name}`).join(' ')}.`,
        { kind: 'chain-continue', continuedFrom: stop.seq, runId: chain.id })
      await route(root, { from: 'user', text: targets.map(target => `@${target.name}`).join(' ') }, 0, chain)
      return { chainId: chain.id }
    } catch (e) { continuedChains.delete(key); throw e }
  })
})
ipcMain.handle('send', async (event, dir, text) => {
  validSender(event)
  const root = knownProject(dir), msg = await post(root, 'user', text)
  await route(root, msg, 0); scheduleSummary(root).catch(e => console.error(e))
})
ipcMain.handle('tasks', (event, dir) => { validSender(event); return core.taskBoardIndexed(knownProject(dir)) })
ipcMain.handle('readProjectFile', (event, dir, href, fromFile, workspaceId) => {
  validSender(event)
  const root = knownProject(dir), base = viewerRoot(root, workspaceId, href)
  return core.readProjectFile(base, href, fromFile)
})
ipcMain.handle('watchProject', (event, dir, file, workspaceId) => { validSender(event); return watchProject(dir, file, workspaceId) })
ipcMain.handle('openFile', async (event, dir, file, workspaceId) => { validSender(event); const error = await shell.openPath(resolveFile(dir, file, workspaceId)); if (error) throw new Error(error) })
ipcMain.handle('openLink', async (event, dir, href) => {
  validSender(event)
  if (typeof href !== 'string' || !href || /[\0-\x1f\x7f]/.test(href) || href.startsWith('//')) throw new Error('Liên kết không hợp lệ')
  let url
  try { url = new URL(href) } catch {}
  if (url) {
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Chỉ hỗ trợ liên kết http/https')
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

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
else app.whenReady().then(() => {
  for (const dir of projects()) loadOrphans(dir)
  win = new BrowserWindow({ width: 1280, height: 820, webPreferences: { preload: path.join(__dirname, 'preload.js') } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.loadFile('index.html').then(() => win.webContents.on('will-navigate', event => event.preventDefault()))
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
})
app.on('window-all-closed', () => { clearProjectWatch(); app.quit() })
