// node check.js — sanity check for @mention routing, project files, stream parsers, usage and Stop
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path')
const core = require('./core')
if (process.argv[2] === '--electron') return void electronChecks()
if (process.argv[2] === '--main') return void mainHarness().then(() => process.exit(0), e => { console.error(e); process.exit(1) })

const t = [{ name: 'dev' }, { name: 'dev-fe' }, { name: 'pm' }]
assert.deepStrictEqual(core.mentions('@dev-fe làm UI', t, 'pm').map(a => a.name), ['dev-fe'])
assert.deepStrictEqual(core.mentions('@DEV, @pm ok', t, 'pm').map(a => a.name), ['dev']) // case-insensitive, never self
assert.deepStrictEqual(core.mentions('email a@devx.com', t, 'pm'), [])

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-'))
core.init(dir)
const promptOf = async (d, agent, session = null) => (await core.promptIndexed(d, agent, session)).text
async function logChecks() {
  await core.appendLogIndexed(dir, { from: 'user', text: 'hi' })
  assert.strictEqual((await core.getLogIndex(dir)).records.length, 1)
  assert.ok((await promptOf(dir, core.team(dir)[0])).includes('[user] hi'))
  // resume: fresh prompt has full context, resumed prompt only what's new
  assert.ok(!(await promptOf(dir, core.team(dir)[0], { id: 'x', seen: 1 })).includes('[user] hi'))
  await core.appendLogIndexed(dir, { from: 'dev', text: 'xong' })
  assert.ok((await promptOf(dir, core.team(dir)[0], { id: 'x', seen: 1 })).includes('[dev] xong'))
  // adopted session: first turn resumes it but still sends the full team briefing
  assert.ok((await promptOf(dir, core.team(dir)[0], { id: 'x', seen: 2, adopted: true })).includes('Quy tắc nhóm'))
  // no allowedCommands field → default allowlist offered via run-command, fresh and resumed
  const plain = { name: 'pm', role: 'x' }
  assert.ok((await promptOf(dir, plain)).includes('run-command') && (await promptOf(dir, plain, { id: 's', seen: 0 })).includes('npm run check'))
}
core.setSession(dir, 'pm', { id: 'a', seen: 2 }); core.setSession(dir, 'qa', { id: 'b', seen: 2 })
core.setSession(dir, 'pm', null); assert.deepStrictEqual(Object.keys(core.sessions(dir)), ['qa'])
core.setSession(dir, null, null); assert.deepStrictEqual(core.sessions(dir), {})

// ---- CLI stream parsers: {id, text, usage, error} ----
const J = (...events) => events.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') // last line has no newline
const U = (i, o, c = null, partial = false) => ({ inputTokens: i, outputTokens: o, costUsd: c, durationMs: 0, partial })

// codex: success only with turn.completed; cached tokens are a breakdown, not added
const cx = core.CLI.codex
assert.deepStrictEqual(cx.parse(J({ type: 'thread.started', thread_id: 't1' }, 'noise', { type: 'mystery' },
  { type: 'item.completed', item: { type: 'command_execution', command: 'ls', aggregated_output: 'SECRET' } },
  { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 8, output_tokens: 0 } })),
{ id: 't1', text: 'hi', usage: U(10, 0), contextInputTokens: null, error: null }) // 0 is a valid count
assert.ok(cx.parse(J({ type: 'thread.started', thread_id: 't1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'nửa' } })).error) // no terminal
assert.ok(cx.parse(J({ type: 'thread.started', thread_id: 't1' }, { type: 'turn.failed', error: { message: 'boom' } })).error.includes('boom'))
assert.deepStrictEqual(cx.parse(J({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: '5' } })).usage, U(null, null, null, true))

// claude: stream-json; result.total_cost_usd is cumulative on resume → delta against checkpoint
const cl = core.CLI.claude
const claudeOut = total => J({ type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/a.js' } }] } },
  { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'subagent' }] } },
  { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: total })
assert.deepStrictEqual(cl.parse(claudeOut(0.10), { costBaseline: 0 }), { id: 's1', text: 'ok', usage: U(3, 4, 0.1), contextInputTokens: null, error: null })
assert.strictEqual(cl.parse(claudeOut(0.16), { costBaseline: 0.10 }).usage.costUsd, 0.06) // 0.10 → 0.16 = 0.10 + 0.06
const noBase = cl.parse(claudeOut(0.16), { costBaseline: null }) // adopted / checkpoint lost after stop
assert.strictEqual(noBase.usage.costUsd, null); assert.strictEqual(noBase.usage.partial, true)
assert.strictEqual(cl.parse(claudeOut(0.05), { costBaseline: 0.10 }).usage.costUsd, null) // counter went backwards
assert.ok(cl.parse(J({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's1' })).error)
assert.ok(cl.parse(J({ type: 'system', subtype: 'init', session_id: 's1' })).error) // no terminal
assert.deepStrictEqual(cl.parse('{"session_id":"s1","result":"ok"}').text, 'ok') // old single-JSON fixture

// agy: discriminator is `event`; count finished steps once, only after the new user_input on resume
const ag = core.CLI.agy
const step = (i, usage, extra = {}) => ({ event: 'step_update', step_update: { step_index: i, status: 'DONE', usage, ...extra } })
const agyOut = J({ event: 'init', conversation_id: 'c1' },
  step(0, { input_tokens: 100, output_tokens: 100 }), // history of the resumed conversation
  { event: 'user_input' },
  step(1, { input_tokens: 5, output_tokens: 2 }), step(1, { input_tokens: 5, output_tokens: 2 }), // repeated event
  step(2, { input_tokens: 1, output_tokens: 1 }),
  { event: 'result', result: { response: 'ok', status: 'SUCCESS', usage: { input_tokens: 999, output_tokens: 999 } } })
assert.deepStrictEqual(ag.parse(agyOut, { resumed: true }), { id: 'c1', text: 'ok', usage: U(6, 3), contextInputTokens: null, error: null })
assert.deepStrictEqual(ag.parse('{"conversation_id":"c1","response":"ok"}').text, 'ok') // old single-JSON fixture
assert.ok(ag.parse(J({ event: 'result', result: { response: 'x', status: 'ERROR' } })).error)
// resumed after a failed turn: agy still says ERROR with the old error though this turn answered (agy 1.3.3)
const agyStale = (...steps) => ag.parse(J({ event: 'user_input' }, ...steps.map((t, i) => step(i, null, { step_type: t })),
  { event: 'result', result: { response: 'ok2', status: 'ERROR', error: 'Individual quota reached. Resets in 4h10m8s.' } }), { resumed: true })
assert.deepStrictEqual([agyStale('system_message', 'agent_response').error, agyStale('error_message', 'agent_response').error], [null, null])
assert.ok(agyStale('agent_response', 'error_message').error.includes('quota'))
assert.ok(ag.parse(J({ event: 'init', conversation_id: 'c1' })).error) // no terminal

// progress labels: one plain line, project-relative, no raw output
const label = (cli, e) => core.CLI[cli].event(e, core.CLI[cli].state({}), { dir: '/p' })
assert.strictEqual(label('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/core.js' } }] } }), 'sửa core.js')
assert.strictEqual(label('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run check' } }] } }), 'Đang chạy lệnh')
assert.strictEqual(label('codex', { type: 'item.started', item: { type: 'command_execution', command: 'npm run check' } }), 'Đang chạy lệnh')
assert.strictEqual(label('agy', { event: 'step_update', step_update: { tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'ls' } } } }), 'Đang chạy lệnh')

assert.throws(() => core.saveTeam(dir, [{ name: 'a b', cli: 'claude' }]))
assert.throws(() => core.saveTeam(dir, [{ name: 'dev', cli: 'claude' }, { name: 'DEV', cli: 'codex' }]))
for (const bad of [0, 1441, 1.5, '30']) assert.throws(() => core.saveTeam(dir, [{ name: 'x', cli: 'codex', timeoutMinutes: bad }]))
assert.strictEqual(core.timeoutMinutes({ name: 'x' }), 30)
assert.strictEqual(core.account('codex2').env.CODEX_HOME, path.join(os.homedir(), '.codex2'))
assert.strictEqual(core.account('claude').env.CLAUDE_CONFIG_DIR, undefined)
assert.strictEqual(core.account('claude2').bin, 'claude')
assert.strictEqual(core.account('agy2'), null)

// model/effort flags per CLI
assert.deepStrictEqual(core.CLI.codex.args('p', 'T', { model: 'm1', effort: 'high' }).slice(-5), ['-m', 'm1', '-c', 'model_reasoning_effort="high"', 'T', 'p'].slice(-5))
assert.ok(core.CLI.claude.args('p', null, { model: 'opus', effort: 'max' }).join(' ').includes('--model opus --effort max'))
assert.ok(core.CLI.claude.args('p').join(' ').includes('--output-format stream-json --verbose'))
assert.throws(() => core.saveTeam(dir, [{ name: 'x', cli: 'codex', effort: 'high"; rm' }]))

// ---- Sprint 2: owns/readOnly scope, locks, audit snapshot, migration ----
const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-scope-')))
core.init(proj); fs.mkdirSync(path.join(proj, 'src')); fs.writeFileSync(path.join(proj, 'index.html'), '')
const S = (owns, readOnly = false) => core.normalizeScope({ name: 'x', owns, readOnly }, proj)
assert.deepStrictEqual(S('check.js'), { owns: ['check.js'], readOnly: false })
assert.deepStrictEqual(S('index.html, reports/').owns, ['index.html', 'reports/**'])
assert.deepStrictEqual(S('reports').owns, ['reports/**']) // existing dir → tree
assert.deepStrictEqual(S(['./src/**/*.js', 'src/**/*.js', '']).owns, ['src/**/*.js']) // trim ./, drop empty, dedupe
assert.deepStrictEqual(S('reports/ (chỉ đọc code)'), { owns: [], readOnly: false, ownsLegacy: 'reports/ (chỉ đọc code)', scopeNeedsReview: true }) // prose: not readOnly, not full access
for (const bad of ['../x', 'src/../x', '/etc/passwd', 'a\\b', 'a!b', '{a,b}', 'a**/b', 'C:x'])
  assert.throws(() => S([bad]), undefined, `phải từ chối phạm vi ${bad}`)
fs.symlinkSync(os.tmpdir(), path.join(proj, 'link'))
assert.throws(() => S(['link/**']), /symlink/)

const allows = (owns, file, readOnly) => core.scopeAllows(S(owns, readOnly), file)
assert.ok(allows([], 'any/where.js')) // [] = whole project
assert.ok(!allows([], 'a.js', true) && !allows(['a.js'], 'a.js', true)) // readOnly never writes
assert.ok(allows(['reports/**'], 'reports/a.md') && allows(['reports/**'], 'reports/.hidden'))
assert.ok(!allows(['reports/**'], 'reports2/a.md') && !allows(['index.html'], 'index.html.bak'))
assert.ok(allows(['src/**/*.js'], 'src/a/b.js') && !allows(['src/**/*.js'], 'src/a.css'))
assert.ok(!allows([], '../outside.txt'))

const locks = (owns, readOnly) => core.scopeLocks(S(owns, readOnly), proj).map(({ path, tree }) => ({ path, tree }))
const plocks = owns => core.scopeLocks(S(owns), proj) // with pattern/excludes, as the scheduler uses them
const clash = (a, b) => plocks(a).some(x => plocks(b).some(y => core.lockConflict(x, y)))
assert.deepStrictEqual(locks([]), [{ path: proj, tree: true }])
assert.deepStrictEqual(locks(['a.js'], true), []) // reader holds nothing
assert.deepStrictEqual(locks(['new.txt']), [{ path: path.join(proj, 'new.txt'), tree: false }]) // file not yet created is still locked
assert.ok(!clash((['index.html']), (['main.js', 'core.js', 'preload.js']))) // FE ∥ BE
assert.ok(clash((['index.html']), (['index.html'])))
assert.ok(!clash((['src/**/*.js']), (['src/**/*.css']))) // globs compared precisely, not by directory prefix
assert.ok(!clash((['reports/dev-*']), (['reports/review-*'])) && clash((['reports/dev-*']), (['reports/*'])))
assert.ok(clash((['CL/**']), (['**/_review/**']))) // _review/ inside CL/ really overlaps…
assert.ok(!clash((['CL/**', 'tools/**', '!**/_review/**']), (['**/_review/**', 'process.md']))) // …unless dev excludes it
assert.ok(clash(([]), (['**/_review/**'])) && !clash((['!**/_review/**']), (['**/_review/**']))) // [] minus exclusion
assert.ok(!allows(['CL/**', '!**/_review/**'], 'CL/A/_review/r.md') && allows(['CL/**', '!**/_review/**'], 'CL/A/INPUT/x'))
assert.deepStrictEqual(S(['CL/**', '!**/_review/**']), { owns: ['CL/**'], excludes: ['**/_review/**'], readOnly: false })
assert.ok(clash((['src/**']), (['src/a/b.js'])) && clash(([]), (['check.js'])))
assert.ok(!clash((['src/**']), (['src2/a.js']))) // segment boundary
if (process.platform === 'darwin') assert.ok(clash((['Index.html']), (['index.html'])))
// * covers dotfiles (config/* ⊇ config/.env) in scopes, exclusions and locks; scopes fold case like locks
assert.ok(allows(['config/*'], 'config/.env') && !allows(['secrets/**', '!secrets/*'], 'secrets/.env') && clash((['config/*']), (['config/.env'])))
if (process.platform === 'darwin') assert.ok(allows(['Src/**'], 'src/a.js') && !allows(['a.js', '!A.js'], 'a.js'))

async function auditChecks() {
  const f = n => path.join(proj, n)
  fs.writeFileSync(f('a.txt'), 'aaaa'); fs.writeFileSync(f('b.txt'), 'b')
  fs.mkdirSync(f('node_modules')); fs.writeFileSync(f('node_modules/x.js'), '1')
  fs.mkdirSync(f('dist')); fs.writeFileSync(f('dist/app.asar'), '1')
  const before = await core.snapshot(proj), st = fs.statSync(f('a.txt'))
  fs.writeFileSync(f('a.txt'), 'bbbb'); fs.utimesSync(f('a.txt'), st.atime, st.mtime) // same size + mtime, new content
  fs.rmSync(f('b.txt')); fs.writeFileSync(f('c.txt'), 'c')
  fs.appendFileSync(f('.chat/memory.md'), '- x\n') // memory is audited
  await core.appendLogIndexed(proj, { from: 'user', text: 'x' }); fs.writeFileSync(f('node_modules/x.js'), '2'); fs.writeFileSync(f('dist/app.asar'), '2'); fs.writeFileSync(f('src/.DS_Store'), 'x') // excluded
  const changed = core.changedPaths(before, await core.snapshot(proj))
  assert.deepStrictEqual(changed, ['.chat/memory.md', 'a.txt', 'b.txt', 'c.txt'])
  assert.deepStrictEqual(changed.filter(p => !core.scopeAllows(S(['a.txt', 'c.txt']), p)), ['.chat/memory.md', 'b.txt'])
  const c = new AbortController(); c.abort()
  await assert.rejects(core.snapshot(proj, { signal: c.signal }))
  // a folder vanishing mid-scan (build temp files) is skipped instead of voiding the whole audit
  fs.mkdirSync(f('vanish')); for (let i = 0; i < 50; i++) fs.writeFileSync(f(`vanish/${i}`), 'x')
  const scanning = core.snapshot(proj); fs.rmSync(f('vanish'), { recursive: true })
  assert.ok(!(await scanning).has('vanish/0'))
  // scope in the prompt (proj's team was migrated above)
  assert.ok((await promptOf(proj, tm().techlead)).includes('Chỉ sửa: reports/**'))
  assert.ok((await promptOf(proj, { name: 'r', role: 'x', readOnly: true })).includes('Chỉ đọc'))
  assert.ok((await promptOf(proj, { name: 'r', role: 'x' }, { id: 's', seen: 0 })).includes('toàn bộ dự án')) // resumed prompt too
}

// migration: team() normalizes without writing; saveTeam keeps review flag until confirmed, backs up the original once
const legacy = JSON.stringify([{ name: 'pm', cli: 'claude', role: 'PM', owns: 'reports/, .chat/memory.md' },
  { name: 'techlead', cli: 'claude', role: 'TL', owns: 'reports/ (chỉ đọc code)', model: 'opus' }], null, 2)
fs.writeFileSync(path.join(proj, '.chat/agents.json'), legacy)
const tm = () => Object.fromEntries(core.team(proj).map(a => [a.name, a]))
assert.deepStrictEqual(tm().pm.owns, ['reports/**', '.chat/memory.md'])
assert.strictEqual(tm().techlead.scopeNeedsReview, true); assert.strictEqual(tm().techlead.readOnly, false)
assert.strictEqual(fs.readFileSync(path.join(proj, '.chat/agents.json'), 'utf8'), legacy) // opening a box does not rewrite
let saved = core.saveTeam(proj, core.team(proj).map(a => ({ ...a, timeoutMinutes: 45 })))
assert.strictEqual(saved[1].scopeNeedsReview, true) // saving timeout alone must not grant full access
assert.strictEqual(saved[1].model, 'opus')
saved = core.saveTeam(proj, core.team(proj).map(a => a.name === 'techlead' ? { ...a, owns: ['reports/**'], scopeConfirmed: true } : a)) // stale scopeNeedsReview:true from team() must still be cleared
assert.ok(!('scopeNeedsReview' in saved[1]) && !('scopeConfirmed' in saved[1]))
assert.ok(!JSON.parse(fs.readFileSync(path.join(proj, '.chat/agents.json'), 'utf8'))[1].scopeConfirmed)
assert.strictEqual(fs.readFileSync(path.join(proj, '.chat/agents.json.pre-sprint-2.bak'), 'utf8'), legacy) // backup not overwritten

// Markdown: pinned parser, html:false → raw HTML shows as text. The renderer itself is smoke-tested in the app.
assert.strictEqual(require('./package.json').dependencies['markdown-it'], '15.0.2')
const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), rendererJs = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8')
assert.ok(page.includes('node_modules/markdown-it/dist/browser/markdown-it.umd.min.js') && /markdownit\(\{ html: false/.test(rendererJs))
// a release bumps package.json and says what changed: the Giới thiệu dialog shows this file
assert.ok(fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8').includes(`## ${require('./package.json').version} · `), 'CHANGELOG.md thiếu mục cho phiên bản hiện tại')
const html = require('markdown-it')({ html: false, linkify: false, breaks: true }).disable('image')
  .render('**đạt**\n\n- a\n\n```\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n| a | b |\n|---|---|\n| 1 | 2 |')
assert.ok(html.includes('<strong>đạt</strong>') && html.includes('<li>a</li>') && html.includes('<table>'))
assert.ok(html.includes('&lt;script&gt;') && html.includes('&lt;img src=x onerror=alert(1)&gt;'))
assert.ok(!/<img|<script|href="javascript/i.test(html))

// ---- Sprint 3: PM task scope migration ----
assert.deepStrictEqual(core.migrateTaskScope(proj), { changed: true })
assert.deepStrictEqual(core.team(proj)[0].owns, ['reports/**', '.chat/memory.md', '.chat/tasks.json', '.chat/tasks.json.tmp'])
assert.deepStrictEqual(core.migrateTaskScope(proj), { changed: false }) // idempotent
assert.strictEqual(fs.readFileSync(path.join(proj, '.chat/agents.json.pre-sprint-2.bak'), 'utf8'), legacy) // S2 backup untouched
assert.ok(fs.existsSync(path.join(proj, '.chat/agents.json.pre-sprint-3.bak')))
assert.deepStrictEqual(core.team(proj)[1].owns, ['reports/**']) // techlead not touched
const mig = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mig-'))); core.init(mig)
const migrate = agents => { fs.writeFileSync(path.join(mig, '.chat/agents.json'), JSON.stringify(agents)); return core.migrateTaskScope(mig) }
assert.deepStrictEqual(migrate([{ name: 'PM', cli: 'claude', owns: ['reports/**'], readOnly: true }]), { changed: false, reason: 'REVIEW' }) // never lifts readOnly
assert.deepStrictEqual(migrate([{ name: 'pm', cli: 'claude', owns: [] }]), { changed: false }) // [] already = whole project
assert.strictEqual(migrate([{ name: 'lead', cli: 'claude', owns: ['reports/**'] }]).reason, 'MISSING_PM')

// ---- Sprint 3: task board = definitions (.chat/tasks.json) + status events (log.jsonl) ----
const box = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tasks-'))); core.init(box) // default team: pm, techlead, dev, qa
async function taskChecks() {
  const at = '2026-09-27T12:00:00.000Z', later = '2026-09-27T13:00:00.000Z', tasksFile = path.join(box, '.chat/tasks.json')
  const T = (id, x = {}) => ({ id, title: `Việc ${id}`, assignee: 'dev', spec: 'reports/s.md', createdAt: at, updatedAt: at, ...x })
  const writeTasks = (...tasks) => fs.writeFileSync(tasksFile, JSON.stringify({ version: 1, tasks }))
  const board = () => core.taskBoardIndexed(box), task = async id => (await board()).tasks.find(t => t.id === id)
  const code = async fn => { try { await fn(); return 'OK' } catch (e) { return e.code } }
  const change = async (id, status, actor = 'pm', rev, approval) => core.validateTaskChanges(await board(), [{ id, status, expectedRevision: rev ?? (await task(id)).revision, ...(status === 'done' ? { approval: approval || { kind: 'manual', reason: 'ok' } } : {}) }], actor)
  const commit = async (from, taskUpdates) => core.appendLogIndexed(box, { from, text: 'x', at: new Date().toISOString(), kind: 'task-status', taskUpdates: await taskUpdates })
  const statuses = async () => (await board()).tasks.map(t => [t.id, t.status])

  assert.deepStrictEqual(await board(), { tasks: [], error: null }) // no file yet = empty board, not an error
  for (const bad of ['{"version":1,"tasks":[', { version: 2, tasks: [] }, { version: 1, tasks: [T('T1'), T('T1')] },
    { version: 1, tasks: [{ ...T('T1'), status: 'done' }] }, { version: 1, tasks: [T('T0')] }, { version: 1, tasks: [T('T1', { title: '' })] },
    { version: 1, tasks: [T('T1', { spec: '../x.md' })] }, { version: 1, tasks: [T('T1', { spec: 'https://x.dev' })] }])
    assert.strictEqual(await code(() => core.parseTaskDefinitions(typeof bad === 'string' ? bad : JSON.stringify(bad), box)), 'DATA_ERROR', JSON.stringify(bad))

  writeTasks(T('T1'), T('T2', { assignee: 'qa' }))
  assert.deepStrictEqual(await statuses(), [['T1', 'todo'], ['T2', 'todo']])
  const r1 = (await task('T1')).revision; assert.strictEqual((await task('T1')).revision, r1) // stable across reads
  await commit('system', change('T1', 'doing'))
  assert.strictEqual((await task('T1')).status, 'doing')
  assert.strictEqual(await code(() => change('T1', 'review', 'pm', r1)), 'CONFLICT') // second request on the same revision loses
  assert.strictEqual(await code(() => change('T1', 'doing', 'pm', r1)), 'CONFLICT') // stale even if status is the same
  assert.deepStrictEqual(await change('T1', 'doing'), []) // no-op, nothing to append
  assert.strictEqual(await code(() => change('T1', 'review', 'qa')), 'INVALID') // agent may only move its own task
  assert.strictEqual(await code(() => change('T2', 'done', 'user')), 'INVALID') // S4: End-User has no write path any more
  assert.strictEqual((await change('T2', 'doing', 'PM')).length, 1) // S4: PM (any case) may move anyone's task
  const b0 = await board()
  assert.strictEqual(await code(() => core.validateTaskChanges(b0, b0.tasks.map(t => ({ id: t.id, status: 'done', expectedRevision: t.revision })), 'dev')), 'INVALID') // batch is all-or-nothing
  await commit('dev', change('T1', 'review', 'dev'))
  assert.strictEqual((await task('T1')).status, 'review')
  await commit('qa', [{ id: 'T1', createdAt: at, assignee: 'qa', status: 'done', eventId: '00000000-0000-4000-8000-000000000000' }])
  assert.strictEqual((await task('T1')).status, 'review') // forged event for someone else's task is ignored

  // broken data keeps the last good board and blocks changes; never resets statuses to todo
  const goodTasks = fs.readFileSync(tasksFile), logFile = path.join(box, '.chat/log.jsonl'), goodLog = fs.readFileSync(logFile)
  fs.writeFileSync(tasksFile, '{"version":1,')
  const broken = await board()
  assert.strictEqual(broken.error.code, 'DATA_ERROR'); assert.deepStrictEqual(broken.tasks.map(t => t.status), ['review', 'todo'])
  assert.strictEqual(await code(() => core.validateTaskChanges(broken, [{ id: 'T2', status: 'done', expectedRevision: broken.tasks[1].revision }], 'pm')), 'DATA_ERROR')
  fs.writeFileSync(tasksFile, goodTasks)
  fs.appendFileSync(logFile, '{"from":"system","taskUpdates":[1]}\n') // valid JSON, broken task metadata (a broken JSON line is LOG_CORRUPT)
  assert.strictEqual((await board()).error.code, 'DATA_ERROR'); assert.strictEqual((await board()).tasks[0].status, 'review')
  fs.writeFileSync(logFile, goodLog)
  assert.strictEqual((await board()).error, null)

  // deleted task is not revived; PM adding T3 while the user moves T2 keeps both
  writeTasks(T('T2', { assignee: 'qa' }))
  assert.deepStrictEqual(await statuses(), [['T2', 'todo']])
  writeTasks(T('T1'), T('T2', { assignee: 'qa' }))
  assert.strictEqual((await board()).error.code, 'DATA_ERROR')
  writeTasks(T('T2', { assignee: 'qa' }))
  await commit('system', change('T2', 'doing'))
  writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Mới' }))
  assert.deepStrictEqual(await statuses(), [['T2', 'doing'], ['T3', 'todo']])
  writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Mới' }), T('T4', { assignee: 'ghost' }))
  assert.strictEqual((await board()).error.code, 'DATA_ERROR') // new task must go to a current member
  const r3 = (await task('T3')).revision
  writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Sửa' }))
  assert.strictEqual((await board()).error.code, 'DATA_ERROR') // edit without bumping updatedAt
  writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Sửa', updatedAt: later }))
  assert.strictEqual((await board()).error, null)
  assert.strictEqual(await code(() => change('T3', 'doing', 'pm', r3)), 'CONFLICT') // metadata edit invalidates old revision
  delete require.cache[require.resolve('./core')] // "restart": fresh module, same files
  assert.deepStrictEqual((await require('./core').taskBoardIndexed(box)).tasks.map(t => [t.id, t.status]), [['T2', 'doing'], ['T3', 'todo']])

  // prompt: own tasks with revision, fresh and resumed
  const rev3 = (await task('T3')).revision, k3 = (name, s) => promptOf(box, { name, role: 'x' }, s)
  assert.ok((await k3('dev')).includes(rev3))
  assert.ok((await k3('dev', { id: 's', seen: 0 })).includes(rev3))
  assert.ok(!(await k3('qa')).includes(rev3))
  const pmPrompt = await k3('pm', { id: 's', seen: 0 }) // S4: PM sees every task, with revision
  assert.ok(pmPrompt.includes(rev3) && pmPrompt.includes((await task('T2')).revision))
  for (const f of ['preload.js', 'main.js']) assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes('setTaskStatus'), `${f} còn setTaskStatus`)
  // S7 K3: prompt lists only unfinished tasks + "Đã xong N task." (per visible set); board/validator keep done tasks
  assert.ok(pmPrompt.includes('Đã xong 0 task.') && (await k3('qa')).includes('Đã xong 0 task.'))
  await commit('pm', change('T3', 'done'))
  const pm3 = await k3('pm'), dev3 = await k3('dev', { id: 's', seen: 0 }), qa3 = await k3('qa')
  assert.ok(!pm3.includes('"T3"') && pm3.includes('"T2"') && pm3.includes('Đã xong 1 task.'))
  assert.ok(!dev3.includes('"T3"') && dev3.includes('Đã xong 1 task.')) // resume too
  assert.ok(qa3.includes('"T2"') && qa3.includes('Đã xong 0 task.')) // T3 was dev's, not counted for qa
  assert.deepStrictEqual(await statuses(), [['T2', 'doing'], ['T3', 'done']]) // full board still has it
  assert.strictEqual((await change('T3', 'review'))[0].status, 'review') // PM can still reopen via the full board revision
}

// task-status block: only a closed ```task-status fence at the very end of the final answer
const P = core.parseTaskStatusBlock, blk = j => '```task-status\n' + j + '\n```', one = '[{"id":"T1","status":"review","expectedRevision":"r"}]'
const got = P('Xong @pm.\n' + blk(one) + '\n\n')
assert.deepStrictEqual([got.text, got.changes.length, got.error], ['Xong @pm.', 1, null])
assert.strictEqual(P(blk(one) + '\nthêm chữ').changes, null) // not last
assert.deepStrictEqual(P('Mẫu:\n~~~\n' + blk(one) + '\n~~~').changes, null) // example inside another fence
assert.strictEqual(P('> ' + blk(one)).changes, null) // inside blockquote
const unclosed = P('a\n```task-status\n' + one); assert.ok(unclosed.error); assert.strictEqual(unclosed.text, 'a')
const junk = P('a\n' + blk('{nope')); assert.deepStrictEqual([junk.text, junk.changes], ['a', null]); assert.ok(junk.error)
assert.ok(P('a\n' + blk('[{"id":"T1","status":"done","expectedRevision":"r","actor":"user"}]')).error) // no actor from the model
assert.ok(P('a\n' + blk(JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ id: `T${i + 1}`, status: 'done', expectedRevision: 'r' }))))).error)

// ---- Sprint 5 D: agents route only @ at line start outside code; the User keeps old behavior ----
const team5 = [{ name: 'dev' }, { name: 'dev-fe' }, { name: 'dev-be' }, { name: 'qa' }, { name: 'pm' }]
const who = (text, from = 'pm') => core.mentions(text, team5, from).map(a => a.name)
for (const text of ['@qa kiểm tra', '- @qa kiểm tra', '* @qa kiểm tra', '1. @qa kiểm tra', 'xong\r\n@qa kiểm tra', '@qa @qa', '   @qa'])
  assert.deepStrictEqual(who(text), ['qa'], JSON.stringify(text))
assert.deepStrictEqual(who('@dev-be @dev-fe làm song song'), ['dev-fe', 'dev-be'])
assert.deepStrictEqual(who('@dev-be xong thì @qa kiểm tra'), ['dev-be'])
assert.deepStrictEqual(who('@dev-fe làm UI'), ['dev-fe']) // not dev
for (const text of ['Xong thì dev-be làm tiếp, @qa kiểm tra sau', '`@qa`', 'a `x\n@qa` b', '```\n@qa\n```', '~~~\n@qa\n~~~', '    @qa',
  '> @qa', '\\@qa', '**@qa**', '@ghost', '@pm tự gọi mình'])
  assert.deepStrictEqual(who(text), [], JSON.stringify(text))
assert.deepStrictEqual(who('@PM @qa', 'PM'), ['qa']) // self excluded, any case
assert.deepStrictEqual(who('nhờ bạn xem `@dev` rồi @qa', 'user'), ['dev', 'qa']) // User: every @, as before
assert.deepStrictEqual(who('@qa', 'system'), [])

// ---- Sprint 5 A config: exact argv allowlist ----
assert.deepStrictEqual(core.normalizeAllowedCommands([' npm  run\tcheck ', 'npm run check', 'node check.js']), ['npm run check', 'node check.js'])
for (const bad of ['npm run check; rm -rf /', 'npm run $(id)', 'npm run check && x', 'a\nb', '-rf x', 'A=1 npm', 'npm "x"', 'ls *', 'cat a|b', 'x'.repeat(257)])
  assert.throws(() => core.normalizeAllowedCommands([bad]), undefined, JSON.stringify(bad))
assert.throws(() => core.normalizeAllowedCommands(Array.from({ length: 21 }, (_, i) => `c${i}`)))

// ---- Sprint 5 avatar + allowedCommands schema in agents.json ----
const av = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-av-'))); core.init(av) // default team, no avatar/commands yet
const avFile = path.join(av, '.chat/agents.json'), avRaw = fs.readFileSync(avFile, 'utf8')
let tv = core.team(av)
assert.deepStrictEqual(tv.map(a => a.allowedCommands), tv.map(() => ['npm run check'])) // missing field → default
assert.deepStrictEqual(tv.map(a => [a.avatar.gender, a.avatar.color]), [['male', '#ff8fab'], ['female', '#7cb4ff'], ['male', '#5fe0b0'], ['female', '#ffa94d']])
assert.strictEqual(fs.readFileSync(avFile, 'utf8'), avRaw) // reading does not write
let sv = core.saveTeam(av, tv.map((a, i) => i ? a : { ...a, allowedCommands: [], avatar: { gender: 'female', color: '#ffd23f' } }))
assert.deepStrictEqual([sv[0].allowedCommands, sv[0].avatar], [[], { gender: 'female', color: '#ffd23f' }]) // [] stays off
sv = core.saveTeam(av, core.team(av).map(({ allowedCommands, ...a }) => a)) // old client without the field
assert.deepStrictEqual(sv[0].allowedCommands, []) // keeps saved [] instead of re-granting the default
assert.ok(!('commandConfigError' in sv[0]))
for (const avatar of [{ gender: 'x', color: '#7cb4ff' }, { gender: 'male', color: '#000000' }, { gender: 'male', color: '#7cb4ff', svg: '<svg/>' }, 'url(x)'])
  assert.throws(() => core.saveTeam(av, core.team(av).map((a, i) => i ? a : { ...a, avatar })), undefined, JSON.stringify(avatar))
assert.throws(() => core.saveTeam(av, core.team(av).map((a, i) => i ? a : { ...a, allowedCommands: ['rm -rf /;'] })))
fs.writeFileSync(avFile, JSON.stringify([{ name: 'pm', cli: 'claude', role: 'PM', allowedCommands: ['rm -rf /;'] }])) // hand-edited junk
tv = core.team(av); assert.deepStrictEqual(tv[0].allowedCommands, []); assert.ok(tv[0].commandConfigError)
sv = core.saveTeam(av, Array.from({ length: 20 }, (_, i) => ({ name: `a${i}`, cli: 'codex', role: 'x' }))) // > 16 agents
assert.ok(sv.every(a => ['male', 'female'].includes(a.avatar.gender) && /^#[0-9a-f]{6}$/.test(a.avatar.color)))
assert.strictEqual(new Set(sv.slice(0, 8).map(a => a.avatar.color)).size, 8) // first 8 get distinct colors

async function viewerChecks() {
  const w = (rel, data) => { fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true }); fs.writeFileSync(path.join(box, rel), data) }
  w('reports/a.md', '# A\n[r](roadmap.md)'); w('reports/roadmap.md', '<img src=x onerror=alert(1)>'); w('src/x.js', 'const a = 1')
  w('reports/bom.md', '\uFEFFxin chào'); w('reports/bin.dat', Buffer.from([0x41, 0, 0x42])); w('reports/big.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))
  fs.symlinkSync('/etc/hosts', path.join(box, 'reports/out.md'))
  fs.mkdirSync(box + 'x'); fs.writeFileSync(path.join(box + 'x', 's.md'), 'secret') // sibling folder with the same prefix
  const R = (href, from) => core.readProjectFile(box, href, from)
  let r = await R('reports/roadmap.md')
  assert.deepStrictEqual([r.ok, r.file.format, r.file.path, r.file.content, r.file.version.length, r.file.canOpenExternal],
    [true, 'markdown', 'reports/roadmap.md', '<img src=x onerror=alert(1)>', 64, true])
  assert.strictEqual((await R('roadmap.md', 'reports/a.md')).file.path, 'reports/roadmap.md') // link between reports
  assert.strictEqual((await R('./roadmap.md?x=1#h', 'reports/a.md')).file.path, 'reports/roadmap.md')
  r = await R('../src/x.js', 'reports/a.md'); assert.deepStrictEqual([r.file.path, r.file.format, r.file.canOpenExternal], ['src/x.js', 'text', false])
  assert.ok((await R(path.join(box, 'reports/roadmap.md'))).ok) // absolute link from old chats
  const fileURL = rel => require('url').pathToFileURL(path.join(box, rel)).href
  for (const rel of ['index.html', 'renderer.js', 'data.json', 'config.yaml', 'table.csv', 'notes.txt', 'src/việt #%.tsx']) {
    w(rel, '<script>this is source, not executable HTML</script>')
    const source = await R(fileURL(rel))
    assert.deepStrictEqual([source.ok, source.file.path, source.file.format, source.file.canOpenExternal], [true, rel, 'text', false])
    assert.strictEqual(source.file.content, '<script>this is source, not executable HTML</script>')
  }
  assert.strictEqual((await R(fileURL('reports/out.md'))).code, 'OUTSIDE_PROJECT')
  assert.strictEqual((await R('file://remote.example/a.js')).code, 'INVALID_PATH')
  assert.strictEqual((await R(fileURL('renderer.js') + '%00')).code, 'INVALID_PATH')
  assert.strictEqual((await R('reports/bom.md')).file.content, 'xin chào')
  for (const [href, from, want] of [['../x', null, 'OUTSIDE_PROJECT'], ['%2e%2e/%2e%2e/etc/hosts', null, 'OUTSIDE_PROJECT'],
    ['reports/../../x', null, 'OUTSIDE_PROJECT'], [`../${path.basename(box)}x/s.md`, null, 'OUTSIDE_PROJECT'],
    ['reports/out.md', null, 'OUTSIDE_PROJECT'], ['/etc/hosts', null, 'OUTSIDE_PROJECT'], ['roadmap.md', '../../etc/hosts', 'OUTSIDE_PROJECT'],
    ['javascript:alert(1)', null, 'INVALID_PATH'], ['file:///etc/hosts', null, 'OUTSIDE_PROJECT'], ['a\\b', null, process.platform === 'win32' ? 'NOT_FOUND' : 'INVALID_PATH'], ['%zz', null, 'INVALID_PATH'],
    ['reports/nope.md', null, 'NOT_FOUND'], ['reports/bin.dat', null, 'UNSUPPORTED'], ['reports', null, 'UNSUPPORTED'], ['reports/big.txt', null, 'TOO_LARGE']]) {
    r = await R(href, from); assert.strictEqual(r.code, want, `${href} → ${r.code}`)
  }
  assert.ok(!('file' in await R('reports/out.md'))) // no metadata for files outside the project
  assert.strictEqual((await R('reports/big.txt')).file.path, 'reports/big.txt') // TOO_LARGE keeps metadata for "open external"
}

// ---- core.run with a fake `codex` on PATH: stream split mid-UTF-8, Stop kills the process group, session survives ----
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-')), argsLog = path.join(bin, 'args'), pidFile = path.join(bin, 'pid'), sandboxLog = path.join(bin, 'sandbox')
fs.writeFileSync(path.join(bin, 'codex'), `#!${process.execPath}
const fs = require('fs'), out = s => process.stdout.write(s)
if (process.argv[2] === 'sandbox') { // codex sandbox … -C <dir> -- <cmd…>: log it, run the command
  const argv = process.argv.slice(2), i = argv.indexOf('--')
  fs.appendFileSync(${JSON.stringify(sandboxLog)}, JSON.stringify(argv) + '\\n')
  process.exit(require('child_process').spawnSync(argv[i + 1], argv.slice(i + 2), { cwd: argv[argv.indexOf('-C') + 1], stdio: 'inherit' }).status ?? 1)
}
const argv = process.argv.slice(2), p = argv.at(-1) === '-' ? fs.readFileSync(0, 'utf8') : argv.at(-1) // "-" = prompt over stdin
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify([...argv, p]) + '\\n') // logged with the prompt last
if (process.env.FAKE_MODE === 'gone' && process.argv.includes('resume')) { process.stderr.write('Error: no rollout found for thread id T1\\n'); process.exit(1) }
out(JSON.stringify({ type: 'thread.started', thread_id: process.env.FAKE_TID || 'T1' }) + '\\n')
// like real codex: turn.completed carries the thread's running total, not this turn's tokens
const usage = (i, o) => {
  const f = ${JSON.stringify(path.join(bin, 'totals.json'))}, tid = process.env.FAKE_TID || 'T1'
  let all = {}; try { all = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
  const prev = process.argv.includes('resume') && all[tid] || { i: 0, o: 0 }
  const next = { i: i == null ? null : prev.i + i, o: prev.o + o }
  if (i != null) { all[tid] = next; fs.writeFileSync(f, JSON.stringify(all)) }
  return { input_tokens: next.i, output_tokens: next.o }
}
if (process.env.FAKE_MODE === 'slow') {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(require('child_process').spawn('sleep', ['30']).pid))
  out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '@pm làm tiếp' } }) + '\\n')
  setInterval(() => {}, 1000)
} else if (process.env.FAKE_MODE !== 'ok') { // Sprint 5 modes: cmd:<command>, loop, empty, empty2, task, broken
  const mode = process.env.FAKE_MODE, F = '\\x60'.repeat(3)
  const ask = command => 'Chạy\\n' + F + 'run-command\\n' + JSON.stringify({ command }) + '\\n' + F
  const reply = text => { if (text) out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n'); out(JSON.stringify({ type: 'turn.completed', usage: usage(process.env.FAKE_IN === 'null' ? null : Number(process.env.FAKE_IN || 3), 2) }) + '\\n') }
  if (mode === 'broken') process.exit(1)
  else if (mode === 'quota') { process.stderr.write('.\\nAGY_ERROR: {"short_error":"Hết quota. Reset sau 4h."}\\n'); out(JSON.stringify({ type: 'turn.failed', error: { message: 'Hết quota. Reset sau 4h.' } }) + '\\n'); process.exit(1) }
  else if (p.includes('DỮ LIỆU KHÔNG TIN CẬY')) reply(mode === 'loop' ? ask('node ok.js') : 'kết quả ' + (/"exitCode":(\\d+|null)/.exec(p) || [])[1] + (p.includes('"error"') ? ' lỗi' : ''))
  else if (p.includes('Bạn chưa gửi tin trả lời')) reply(mode === 'empty' ? 'đã trả lời' : '')
  else if (mode.startsWith('cmd:')) reply(ask(mode.slice(4)))
  else if (mode === 'loop') reply(ask('node ok.js'))
  else if (mode === 'gone') reply('phiên mới')
  else if (mode === 'text') reply(process.env.FAKE_TEXT)
  else if (mode === 'task') reply(F + 'task-status\\n[{"id":"T1","status":"review","expectedRevision":"r"}]\\n' + F)
  else reply('')
} else {
  const b = Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'xin chào' } }) + '\\n')
  const cut = b.indexOf(Buffer.from('à')) + 1 // split inside the 2-byte "à"
  out(b.subarray(0, cut))
  setTimeout(() => { out(b.subarray(cut)); out(JSON.stringify({ type: 'turn.completed', usage: usage(3, 2) })) }, 50)
}
`, { mode: 0o755 })
fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs'), out = s => process.stdout.write(s)
const argv = process.argv.slice(2)
let p = ''
const pIdx = argv.indexOf('-p')
if (pIdx >= 0) {
  if (argv[pIdx + 1] && !argv[pIdx + 1].startsWith('--')) p = argv[pIdx + 1]
  else {
    try { p = fs.readFileSync(0, 'utf8') } catch {}
    argv.splice(pIdx + 1, 0, p)
  }
}
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify([...argv, p]) + '\\n')
const tid = process.env.FAKE_TID || 'S1'
out(JSON.stringify({ type: 'system', subtype: 'init', session_id: tid }) + '\\n')
const inVal = process.env.FAKE_IN === 'null' ? null : Number(process.env.FAKE_IN || 3)
const mode = process.env.FAKE_MODE
const reply = (text, ctx) => {
  if (ctx != null) out(JSON.stringify({ type: 'assistant', message: { id: 'M' + tid, content: [{ type: 'text', text: text || '' }], usage: { input_tokens: ctx } } }) + '\\n')
  out(JSON.stringify({ type: 'result', subtype: 'success', result: text || '', session_id: tid, usage: { input_tokens: inVal, output_tokens: 2 } }) + '\\n')
}
if (mode === 'steps') { // S9 R7: FAKE_STEPS = raw stream events, then one result (FAKE_ERR=1 → is_error)
  for (const e of JSON.parse(process.env.FAKE_STEPS)) out(JSON.stringify(e) + '\\n')
  const err = process.env.FAKE_ERR === '1'
  out(JSON.stringify({ type: 'result', subtype: err ? 'error_during_execution' : 'success', is_error: err, result: 'ok', session_id: tid, usage: { input_tokens: inVal, output_tokens: 2 } }) + '\\n')
} else if (mode === 'text') reply(process.env.FAKE_TEXT || 'ok', inVal)
else if (mode === 'empty') {
  if (p.includes('Bạn chưa gửi tin trả lời')) reply('đã trả lời', inVal)
  else reply('', inVal)
} else reply('xin chào', inVal)
`, { mode: 0o755 })
process.env.PATH = bin + path.delimiter + process.env.PATH
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
const lastArgs = () => JSON.parse(fs.readFileSync(argsLog, 'utf8').trim().split('\n').pop())

async function runChecks() {
  const agent = { name: 'dev', cli: 'codex', role: 'Developer' }
  process.env.FAKE_MODE = 'ok'
  const labels = [], ok = await core.run(dir, agent, { onProgress: l => labels.push(l) })
  assert.strictEqual(ok.outcome, 'success'); assert.strictEqual(ok.text, 'xin chào')
  assert.deepStrictEqual([ok.usage.inputTokens, ok.usage.outputTokens, ok.usage.partial], [3, 2, false])
  assert.ok(ok.usage.durationMs > 0); assert.ok(labels.includes('đang trả lời…'))
  const seen = core.sessions(dir).dev.seen
  assert.deepStrictEqual(core.sessions(dir).dev.id, 'T1')
  assert.ok(!('adopted' in core.sessions(dir).dev) && lastArgs().at(-2) === '-') // briefing read → not "adopted"; prompt went over stdin

  // Stop mid-turn: ≤2s, whole group gone (incl. child sleep), session T1 and seen kept. No-route of the @mention is main.js's job.
  process.env.FAKE_MODE = 'slow'; fs.rmSync(pidFile, { force: true })
  const c = new AbortController(), running = core.run(dir, agent, { signal: c.signal })
  while (!fs.existsSync(pidFile)) await new Promise(r => setTimeout(r, 20))
  await new Promise(r => setTimeout(r, 200))
  const t0 = Date.now(); c.abort('stopped')
  const stopped = await running
  assert.ok(Date.now() - t0 <= 2000, `Dừng mất ${Date.now() - t0}ms`)
  assert.strictEqual(stopped.outcome, 'stopped'); assert.strictEqual(stopped.usage.partial, true)
  assert.ok(!alive(Number(fs.readFileSync(pidFile, 'utf8'))), 'process con (sleep) vẫn sống sau Dừng')
  assert.deepStrictEqual([core.sessions(dir).dev.id, core.sessions(dir).dev.seen], ['T1', seen])

  // aborted before spawn (timeout) → no process at all
  const n = fs.readFileSync(argsLog, 'utf8').split('\n').length, late = new AbortController(); late.abort('timeout')
  assert.strictEqual((await core.run(dir, agent, { signal: late.signal })).outcome, 'timeout')
  assert.strictEqual(fs.readFileSync(argsLog, 'utf8').split('\n').length, n)

  // next turn resumes the same session
  process.env.FAKE_MODE = 'ok'
  assert.strictEqual((await core.run(dir, agent)).outcome, 'success')
  const a = lastArgs(); assert.ok(a.includes('resume') && a.includes('T1'), 'lượt sau không resume T1: ' + a.join(' '))
  assert.ok(a.at(-1).startsWith('## Tin nhắn mới trong nhóm'), 'lượt resume lại gửi cả briefing') // incremental prompt only

  // ---- Sprint 5 A: agent asks, app runs the exact allowed command, same session gets the real result ----
  const put = (f, s) => fs.writeFileSync(path.join(dir, f), s)
  put('ok.js', 'require("fs").appendFileSync("ran.txt", "x"); console.log("@pm xanh")')
  put('fail.js', 'console.error("đỏ"); process.exit(1)')
  put('slow.js', 'require("fs").writeFileSync("slow.pid", String(process.pid)); setInterval(() => {}, 1000)')
  const dev5 = { ...agent, allowedCommands: ['node ok.js', 'node fail.js'] }
  const calls = () => fs.readFileSync(argsLog, 'utf8').trim().split('\n').length
  const ran = () => fs.existsSync(path.join(dir, 'ran.txt')) ? fs.readFileSync(path.join(dir, 'ran.txt'), 'utf8').length : 0
  const job = async (mode, a = dev5, options) => { process.env.FAKE_MODE = mode; const n = calls(), r = await core.run(dir, a, options); return { ...r, calls: calls() - n } }
  let j = await job('cmd:node ok.js')
  assert.deepStrictEqual([j.outcome, j.text, j.calls, j.commandResults.length, j.commandResults[0].exitCode], ['success', 'kết quả 0', 2, 1, 0])
  assert.ok(j.commandResults[0].stdout.includes('@pm xanh') && ran() === 1)
  assert.deepStrictEqual([j.usage.inputTokens, j.usage.outputTokens], [6, 4]) // both CLI segments summed into one terminal
  assert.ok(lastArgs().includes('resume') && lastArgs().includes('T1')) // result goes back to the same session
  const sandboxed = () => fs.existsSync(sandboxLog) ? fs.readFileSync(sandboxLog, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []
  assert.deepStrictEqual([sandboxed().at(-1), j.commandResults[0].command], [['sandbox', '--permission-profile', ':workspace', '-C', dir, '--', 'node', 'ok.js'], 'node ok.js']) // codex agent: inside codex's sandbox
  j = await job('cmd:node fail.js'); assert.deepStrictEqual([j.text, j.commandResults[0].exitCode], ['kết quả 1 lỗi', 1]) // red stays red
  for (const bad of ['node ok.js --x', 'node', 'rm -rf x', 'node ok.js; rm x', 'node $(id)']) {
    j = await job('cmd:' + bad)
    assert.ok(j.commandResults[0].error && j.commandResults[0].exitCode === null && j.text === 'kết quả null lỗi', bad)
  }
  assert.strictEqual(ran(), 1) // nothing outside the allowlist was spawned
  j = await job('cmd:node ok.js', { ...dev5, allowedCommands: [] }); assert.ok(j.commandResults[0].error) // [] = off
  const nSandbox = sandboxed().length
  j = await job('cmd:node ok.js', { ...dev5, permissions: { mode: 'full', allowTools: [], networkAccess: false } })
  assert.deepStrictEqual([j.commandResults[0].exitCode, sandboxed().length], [0, nSandbox]) // full access: runs directly
  // agy has no sandbox of its own: its commands borrow codex's; without a codex CLI they are refused, never run bare
  const agyRun = await core.runCommand(dir, 'node ok.js', { agent: { cli: 'agy', permissions: { mode: 'edit', allowTools: [], networkAccess: false } } })
  assert.deepStrictEqual([agyRun.exitCode, sandboxed().length, sandboxed().at(-1).slice(-3)], [0, nSandbox + 1, ['--', 'node', 'ok.js']])
  const realPath = process.env.PATH; process.env.PATH = ''
  const noCodex = await core.runCommand(dir, 'node ok.js', { agent: { cli: 'agy' } }); process.env.PATH = realPath
  assert.ok(noCodex.error.startsWith('Cần cài codex CLI'), noCodex.error)
  j = await job('loop'); assert.deepStrictEqual([j.outcome, j.calls, j.commandResults.length], ['error', 4, 3]); assert.ok(j.text.includes('3 lần'))

  // Stop while the runner is busy: group dies, no resume afterwards
  const pidFile5 = path.join(dir, 'slow.pid'); fs.rmSync(pidFile5, { force: true })
  process.env.FAKE_MODE = 'cmd:node slow.js'
  const n5 = calls(), c5 = new AbortController(), running5 = core.run(dir, { ...dev5, allowedCommands: ['node slow.js'] }, { signal: c5.signal })
  while (!fs.existsSync(pidFile5) || !fs.readFileSync(pidFile5, 'utf8')) await new Promise(r => setTimeout(r, 20))
  const t5 = Date.now(); c5.abort('stopped'); const s5 = await running5
  assert.ok(Date.now() - t5 <= 2000, `Dừng runner mất ${Date.now() - t5}ms`)
  assert.deepStrictEqual([s5.outcome, calls() - n5], ['stopped', 1])
  assert.ok(!alive(Number(fs.readFileSync(pidFile5, 'utf8'))), 'lệnh vẫn sống sau Dừng')

  // ---- Sprint 5 B: empty success → exactly one retry in the same session ----
  j = await job('empty'); assert.deepStrictEqual([j.outcome, j.text, j.calls, j.usage.inputTokens], ['success', 'đã trả lời', 2, 6])
  j = await job('empty2'); assert.deepStrictEqual([j.text, j.calls], ['(không có phản hồi)', 2])
  j = await job('task'); assert.strictEqual(j.calls, 1) // task-status-only answer is not empty
  j = await job('broken'); assert.deepStrictEqual([j.outcome, j.calls], ['error', 1]) // errors are not retried
  j = await job('quota'); assert.deepStrictEqual([j.outcome, j.text], ['error', 'Hết quota. Reset sau 4h.']) // stderr that only repeats the error is not appended
  const saved5 = JSON.stringify(core.sessions(dir))
  j = await job('empty', { ...dev5, resume: false }); assert.deepStrictEqual([j.text, j.calls], ['đã trả lời', 2])
  assert.ok(lastArgs().includes('T1')); assert.strictEqual(JSON.stringify(core.sessions(dir)), saved5) // RAM-only id for resume:false
  const stopped5 = new AbortController(); stopped5.abort('stopped')
  j = await job('empty', dev5, { signal: stopped5.signal }); assert.deepStrictEqual([j.outcome, j.calls], ['stopped', 0])

  // ---- Sprint 6 hotfix: resume id the CLI cannot open → drop it, one fresh session; a real error keeps the session ----
  assert.strictEqual(core.sessions(dir).dev.id, 'T1')
  j = await job('gone'); assert.deepStrictEqual([j.outcome, j.text, j.calls], ['success', 'phiên mới', 2])
  assert.ok(!lastArgs().includes('resume'), 'phiên chết vẫn bị resume: ' + lastArgs().join(' '))
  j = await job('broken'); assert.deepStrictEqual([j.outcome, j.calls, core.sessions(dir).dev.id], ['error', 1, 'T1'])
}

// ---- Sprint 7 K1/K2/K4 core: per-agent token limit, rotate at the next turn, handoff block + file ----
async function sprint7Checks() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s7-')); core.init(d)
  const agentsFile = path.join(d, '.chat', 'agents.json')
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'pm', cli: 'claude', role: 'PM' }, { name: 'k', cli: 'claude', role: 'Dev' }]))
  // config: missing → 150000, 0 kept, old payload keeps value, junk refused
  assert.deepStrictEqual(core.team(d).map(a => a.sessionTokenLimit), [150000, 150000])
  assert.strictEqual(fs.readFileSync(agentsFile, 'utf8').includes('sessionTokenLimit'), false) // opening doesn't rewrite
  let tm = core.saveTeam(d, core.team(d).map(a => a.name === 'pm' ? { ...a, sessionTokenLimit: 0 } : a))
  assert.deepStrictEqual(tm.map(a => a.sessionTokenLimit), [0, 150000]) // each agent independent, 0 is not "default"
  tm = core.saveTeam(d, core.team(d).map(({ sessionTokenLimit, ...a }) => a)); assert.strictEqual(tm[0].sessionTokenLimit, 0)
  for (const bad of [-1, 1.5, '1', null, NaN]) assert.throws(() => core.saveTeam(d, core.team(d).map((a, i) => i ? a : { ...a, sessionTokenLimit: bad })), undefined, String(bad))
  const good = fs.readFileSync(agentsFile, 'utf8')
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'k', cli: 'claude', role: 'Dev', sessionTokenLimit: -5 }]))
  assert.ok(core.team(d)[0].sessionConfigError)
  const bad = await core.run(d, core.team(d)[0]); assert.strictEqual(bad.outcome, 'error') // no spawn with a broken limit
  fs.writeFileSync(agentsFile, good)

  const k = core.team(d).find(a => a.name === 'k'), calls = () => fs.readFileSync(argsLog, 'utf8').trim().split('\n').length
  const go = async (env, a = k, runId) => {
    Object.assign(process.env, { FAKE_MODE: 'text', FAKE_TEXT: 'ok', FAKE_TID: 'S1', FAKE_IN: '3' }, env)
    const n = calls(), r = await core.run(d, a, { runId }); return { ...r, calls: calls() - n, args: lastArgs(), s: core.sessions(d)[a.name] }
  }
  let r = await go({ FAKE_IN: '150000' }, k, 'run-1')
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens, r.s.lastTurn.contextInputTokens, r.s.lastTurn.runId, r.sessionRotation], ['S1', 150000, 150000, 'run-1', null])
  assert.ok(!core.sessionRotationPending(k, r.s)) // = limit → no rotation
  r = await go({ FAKE_IN: '150001' }, k, 'run-2'); assert.ok(r.args.some(a => a.includes('resume')) && r.args.includes('S1'))
  assert.ok(core.sessionRotationPending(k, r.s))
  await core.appendLogIndexed(d, { from: 'user', text: 'tin gần đây K2' }); fs.appendFileSync(path.join(d, '.chat', 'memory.md'), '- nhớ K1\n')
  // K2 parser: 3–5 lines, may precede task-status, never with run-command
  const F = '`'.repeat(3), ho = body => `Tin cho nhóm @pm.\n${F}handoff\n${body}\n${F}`
  let p = core.parseHandoffBlock(ho('- a\n- b @dev\n- c'))
  assert.deepStrictEqual([p.error, p.handoff, p.text.includes(F)], [null, '- a\n- b @dev\n- c', false])
  assert.ok(core.parseHandoffBlock(ho('- a\n- b')).error && core.parseHandoffBlock(ho('1\n2\n3\n4\n5\n6')).error)
  assert.ok(core.parseHandoffBlock(ho('- ' + 'x'.repeat(4096) + '\n- b\n- c')).error)
  const ts = core.parseTaskStatusBlock(ho('- a\n- b\n- c') + `\n${F}task-status\n[{"id":"T1","status":"review","expectedRevision":"r"}]\n${F}`)
  assert.ok(ts.changes && core.parseHandoffBlock(ts.text).handoff === '- a\n- b\n- c')
  assert.ok(core.parseRunCommandBlock(`${F}handoff\n1\n2\n3\n${F}\n${F}run-command\n{"command":"npm run check"}\n${F}`).error)
  core.writeHandoff(d, 'k', null, 'run-2', '- đang làm K1\n- đã sửa core\n- còn thử UI')
  assert.strictEqual(core.readHandoff(d, 'k', null).text, '- đang làm K1\n- đã sửa core\n- còn thử UI')
  assert.strictEqual(core.readHandoff(d, 'k', 'other-ws'), null) // workspace mismatch → ignored
  // K1: > limit → next turn is fresh (no resume id), full briefing + current handoff, rotation reported once
  r = await go({ FAKE_TID: 'S2' }, k, 'run-3')
  assert.ok(!r.args.some(a => a.includes('resume')) && !r.args.includes('S1'), r.args.join(' '))
  const fresh = r.args[r.args.length - 1]
  for (const want of ['- nhớ K1', 'tin gần đây K2', '- đang làm K1', 'Bàn giao từ lượt gần nhất', '```handoff']) assert.ok(fresh.includes(want), want)
  assert.deepStrictEqual(r.sessionRotation, { previousSessionId: 'S1', previousRunId: 'run-2', contextInputTokens: 150001, limit: 150000, handoffStatus: 'current' })
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens, r.s.lastTurn.contextInputTokens], ['S2', 3, 3])
  r = await go({ FAKE_TID: 'S2' }, k, 'run-4'); assert.ok(r.args.some(a => a.includes('resume')) && r.args.includes('S2') && !r.sessionRotation)
  // limit 0 = off; changing the limit applies to the next turn
  await go({ FAKE_TID: 'S2', FAKE_IN: '200000' })
  r = await go({ FAKE_TID: 'S2' }, { ...k, sessionTokenLimit: 0 }); assert.ok(r.args.some(a => a.includes('resume')) && !r.sessionRotation)
  await go({ FAKE_TID: 'S2', FAKE_IN: '200000' })
  r = await go({ FAKE_TID: 'S2' }, { ...k, sessionTokenLimit: 300000 }); assert.ok(r.args.some(a => a.includes('resume')))
  // null input → no guess; 80k + 80k in one turn (empty retry) keeps the id and only rotates the next turn
  r = await go({ FAKE_TID: 'S2', FAKE_IN: 'null' }); assert.strictEqual(r.s.lastTurn.contextInputTokens, null)
  r = await go({ FAKE_TID: 'S2' }); assert.ok(r.args.some(a => a.includes('resume')))
  r = await go({ FAKE_MODE: 'empty', FAKE_TID: 'S2', FAKE_IN: '80000' })
  assert.deepStrictEqual([r.calls, r.usage.inputTokens, r.s.lastTurn.inputTokens, r.s.lastTurn.contextInputTokens, r.s.id], [2, 160000, 160000, 80000, 'S2'])
  assert.ok(r.args.some(a => a.includes('resume')) && r.args.includes('S2')) // the retry stayed in S2
  r = await go({ FAKE_TID: 'S2', FAKE_IN: '150001' })
  r = await go({ FAKE_TID: 'S3' }); assert.ok(!r.args.some(a => a.includes('resume')) && r.sessionRotation?.previousSessionId === 'S2')
  // resume:false → measurement record only (id null), never resumed or rotated
  r = await go({ FAKE_TID: 'S9', FAKE_IN: '999999' }, { ...k, resume: false }, 'run-nr')
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens, r.s.lastTurn.contextInputTokens], [null, 999999, 999999])
  r = await go({ FAKE_TID: 'S9' }, { ...k, resume: false }, 'run-nr2'); assert.ok(!r.args.some(a => a.includes('resume')) && !r.sessionRotation)
  // Codex / legacy: returns contextInputTokens: null and never rotates
  const codexDev = { name: 'codex-dev', cli: 'codex', role: 'Dev', sessionTokenLimit: 150000 }
  const rCodex = await go({ FAKE_IN: '999999' }, codexDev, 'run-cx')
  assert.strictEqual(rCodex.s.lastTurn.contextInputTokens, null)
  assert.ok(!core.sessionRotationPending(codexDev, rCodex.s))
  // summary job (trackSession:false) does not touch the session record
  const before = JSON.stringify(core.sessions(d)); process.env.FAKE_TID = 'SX'
  await core.run(d, k, { trackSession: false, initialPrompt: 'tóm tắt' }); assert.strictEqual(JSON.stringify(core.sessions(d)), before)
  // a temp file planted as a hard link is replaced, never written into
  const hf = path.join(d, '.chat', 'handoff', 'k.md'), victim = path.join(d, 'victim.txt'); fs.writeFileSync(victim, 'nguyên vẹn'); fs.linkSync(victim, hf + '.tmp')
  core.writeHandoff(d, 'k', null, 'r', '1\n2\n3'); assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'nguyên vẹn')
  // handoff symlink is refused on read and write
  fs.rmSync(hf); fs.symlinkSync('/etc/hosts', hf)
  assert.strictEqual(core.readHandoff(d, 'k', null), null)
  assert.throws(() => core.writeHandoff(d, 'k', null, 'r', '1\n2\n3')); assert.strictEqual(fs.readlinkSync(hf), '/etc/hosts')
  for (const key of ['FAKE_TEXT', 'FAKE_TID', 'FAKE_IN']) delete process.env[key]
  // T27 (static; the popup/⚙ still need a manual look): labels from the contract and the sessions event are wired
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8')
  for (const s of ['Ngưỡng xoay phiên (token ngữ cảnh)', '0 = tắt. Áp dụng cho lượt kế tiếp khi có số đo ngữ cảnh.', 'Ngữ cảnh bước cuối', 'Chưa có dữ liệu',
    'Tự xoay: tắt', 'Sẽ mở phiên mới ở lượt kế tiếp', 'Không nhớ phiên', "'sessions-changed'"]) assert.ok(ui.includes(s), `renderer.js thiếu: ${s}`)
}

// ---- Sprint 8 P core: permissions schema/migration, argv per CLI (fresh + resume), denial normalization ----
function sprint8Checks() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s8-')); core.init(d)
  const agentsFile = path.join(d, '.chat', 'agents.json'), DEF = { mode: 'edit', allowTools: [], networkAccess: false }
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'c', cli: 'claude', role: 'x' }, { name: 'x', cli: 'codex2', role: 'x', allowedCommands: [] }]))
  let tm = core.team(d)
  assert.deepStrictEqual(tm.map(a => [a.permissions, a.allowedCommands]), [[DEF, ['npm run check']], [DEF, []]]) // missing → defaults, [] stays []
  assert.ok(!fs.readFileSync(agentsFile, 'utf8').includes('permissions')) // opening doesn't rewrite
  const custom = { mode: 'custom', allowTools: ['Bash(npm test:*)', ' WebFetch ', '', 'Bash(npm run check)', 'mcp__github__get_issue'], networkAccess: false }
  tm = core.saveTeam(d, tm.map(a => a.name === 'c' ? { ...a, permissions: custom } : a))
  assert.deepStrictEqual(tm[0].permissions.allowTools, ['Bash(npm test:*)', 'WebFetch', 'Bash(npm run check)', 'mcp__github__get_issue'])
  tm = core.saveTeam(d, core.team(d).map(({ permissions, ...a }) => a)); assert.strictEqual(tm[0].permissions.mode, 'custom') // old payload keeps
  const rejects = [['c', { ...DEF, networkAccess: true }], ['c', { ...DEF, mode: 'root' }], ['c', null], ['c', []], ['c', { mode: 'edit', allowTools: [] }],
    ['c', { ...DEF, allowTools: ['mcp__x'] }], ['c', { ...DEF, allowTools: ['mcp__*'] }], ['c', { ...DEF, allowTools: ['Bash(a'] }], ['c', { ...DEF, allowTools: ['a\nb'] }],
    ['c', { ...DEF, allowTools: Array(33).fill('WebFetch') }], ['x', { ...DEF, allowTools: ['WebFetch'] }], ['x', { mode: 'custom', allowTools: ['Bash(ls)'], networkAccess: true }]]
  for (const [name, permissions] of rejects)
    assert.throws(() => core.saveTeam(d, core.team(d).map(a => a.name === name ? { ...a, permissions } : a)), undefined, `${name} ${JSON.stringify(permissions)}`)
  assert.throws(() => core.normalizePermissions({ ...DEF, mode: 'custom' }, 'agy')) // agy custom unsupported
  const saved = fs.readFileSync(agentsFile, 'utf8')
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'c', cli: 'claude', role: 'x', permissions: { mode: 'full' } }])) // hand-edited junk
  assert.ok(core.team(d)[0].permissionConfigError) // blocked, never falls back to full (run() re-normalizes → error before spawn)
  fs.writeFileSync(agentsFile, saved)

  // argv: Claude prompt right after -p, each rule its own argv, commands first as exact Bash(cmd), dedup; resume keeps flags
  const A = (cli, permissions, extra = {}) => ({ name: 'a', cli, allowedCommands: ['npm run check'], permissions, ...extra })
  const flags = (args, name) => {
    const i = args.indexOf(name), end = args.findIndex((x, j) => j > i && x.startsWith('--'))
    return i < 0 ? null : args.slice(i + 1, end < 0 ? args.length : end)
  }
  let args = core.CLI.claude.args('P', null, A('claude', DEF))
  assert.deepStrictEqual(args.slice(0, 2), ['-p', 'P'])
  assert.deepStrictEqual([flags(args, '--permission-mode'), flags(args, '--allowedTools')], [['acceptEdits'], ['Bash(npm run check)']])
  args = core.CLI.claude.args('P', null, A('claude', DEF, { allowedCommands: [] })) // pre-Sprint-8 flags when nothing is granted
  assert.ok(args.includes('acceptEdits') && !args.includes('--allowedTools') && !args.includes('bypassPermissions'))
  args = core.CLI.claude.args('P', null, A('claude', { ...custom, allowTools: tm[0].permissions.allowTools }))
  assert.deepStrictEqual(flags(args, '--allowedTools'), ['Bash(npm run check)', 'Bash(npm test:*)', 'WebFetch', 'mcp__github__get_issue'])
  args = core.CLI.claude.args('P', null, A('claude', { ...custom, mode: 'edit', allowTools: ['WebFetch'] })) // inactive custom list
  assert.deepStrictEqual(flags(args, '--allowedTools'), ['Bash(npm run check)'])
  args = core.CLI.claude.args('P', 'S', A('claude', { ...DEF, mode: 'full' }, { sharedChat: '/c' }))
  assert.deepStrictEqual([args.slice(0, 2), flags(args, '--permission-mode'), args.includes('--allowedTools'), args.slice(-2), flags(args, '--add-dir')],
    [['-p', 'P'], ['bypassPermissions'], false, ['--resume', 'S'], ['/c']])
  // Codex: -c TOML pairs on exec and exec resume, never Bash(...)
  const toml = args => args.flatMap((x, i) => args[i - 1] === '-c' ? [x] : [])
  for (const id of [null, 'T']) {
    args = core.CLI.codex.args('P', id, A('codex', DEF, { sharedChat: '/c' }))
    assert.deepStrictEqual(toml(args), ['sandbox_mode="workspace-write"', 'approval_policy="never"', 'sandbox_workspace_write.network_access=false'])
    assert.ok(!args.some(x => x.startsWith('Bash(')) && args.at(-1) === 'P' && args.includes('/c') && (id ? args.includes('resume') && args.at(-2) === 'T' : !args.includes('resume')))
    assert.strictEqual(toml(core.CLI.codex.args('P', id, A('codex', { ...DEF, mode: 'custom', networkAccess: true })))[2], 'sandbox_workspace_write.network_access=true')
    assert.strictEqual(toml(core.CLI.codex.args('P', id, A('codex', { ...DEF, networkAccess: true })))[2], 'sandbox_workspace_write.network_access=false') // edit ignores it
    assert.deepStrictEqual(toml(core.CLI.codex.args('P', id, A('codex', { ...DEF, mode: 'full' }))), ['sandbox_mode="danger-full-access"', 'approval_policy="never"'])
  }
  assert.ok(!core.CLI.agy.args('P', null, A('agy', DEF)).includes('--dangerously-skip-permissions'))
  assert.ok(core.CLI.agy.args('P', 'C', A('agy', { ...DEF, mode: 'full' })).includes('--dangerously-skip-permissions'))
  // readOnly is enforced by each CLI and wins over full: claude never bypasses (default mode, Bash only for its commands,
  // no edit tools), codex read-only sandbox, agy plan mode
  const ro = (cli, mode) => A(cli, { ...DEF, mode }, { readOnly: true })
  args = core.CLI.claude.args('P', 'S', ro('claude', 'full'))
  assert.deepStrictEqual([args.slice(0, 2), flags(args, '--permission-mode'), flags(args, '--allowedTools'), flags(args, '--disallowedTools'),
    core.CLI.claude.stdinArgs('S', ro('claude', 'edit')).includes('NotebookEdit')], [['-p', 'P'], ['default'], ['Bash(npm run check)'], ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], true])
  assert.deepStrictEqual(toml(core.CLI.codex.args('P', 'T', ro('codex', 'full'))), ['sandbox_mode="read-only"', 'approval_policy="never"'])
  args = core.CLI.agy.args('P', null, ro('agy', 'full')); assert.ok(flags(args, '--mode')[0] === 'plan' && !args.includes('--dangerously-skip-permissions'))
  // trust: the text pinned in userData is what the app uses; the disk is only a proposal until the user confirms what they saw
  const errorCode = fn => { try { fn() } catch (e) { return e.code } }
  core.setTrustFile(path.join(d, 'trust.json'))
  let ct = core.configTrust(d) // never-seen box (cloned repo, agent-made .chatN): untrusted, listing what every agent may do
  assert.deepStrictEqual([ct.trusted, ct.pinned, ct.changes[0].startsWith('@c: {') && ct.changes[0].includes('"cli":"claude"') && ct.changes[0].includes('"mode":"custom"')], [false, false, true])
  core.saveTeam(d, core.team(d)); ct = core.configTrust(d); assert.strictEqual(ct.pinned, false) // an app write (scope migration…) never confirms a box
  core.trustConfig(d, ct.texts); assert.ok(core.configTrust(d).trusted)
  const forged = JSON.parse(ct.texts['agents.json']); forged[0].permissions = { ...DEF, mode: 'full' }
  fs.writeFileSync(agentsFile, JSON.stringify(forged)); ct = core.configTrust(d)
  assert.deepStrictEqual([ct.trusted, ct.changes.length, /^@c: permissions \{"mode":"custom".* → \{"mode":"full"/.test(ct.changes[0]), core.team(d)[0].permissions.mode],
    [false, 1, true, 'custom']) // team() keeps the pinned text while the disk differs
  fs.writeFileSync(agentsFile, '[]'); core.trustConfig(d, ct.texts)
  assert.strictEqual(core.team(d)[0].permissions.mode, 'full') // pins the texts the dialog showed, not the disk now
  core.revertConfig(d); assert.strictEqual(fs.readFileSync(agentsFile, 'utf8'), ct.texts['agents.json']) // revert puts the confirmed text back
  core.saveTeam(d, core.team(d)); assert.ok(core.configTrust(d).trusted) // an app write pins exactly what it writes
  // a symlinked box folder is refused: pins are keyed by the box path, a link would swap the config under it
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sbox-')); fs.mkdirSync(path.join(sb, 'copy')); fs.symlinkSync(path.join(sb, 'copy'), path.join(sb, '.chat'))
  ct = core.configTrust(sb)
  assert.deepStrictEqual([ct.trusted, /symlink/.test(ct.changes[0]), errorCode(() => core.init(sb)), errorCode(() => core.trustConfig(sb, ct.texts))], [false, true, 'UNSUPPORTED', 'UNSUPPORTED'])
  core.setTrustFile(null)
  // init and temp+rename writes never write through a planted (dangling) symlink
  const sl = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-')), out = path.join(sl, 'outside')
  fs.mkdirSync(path.join(sl, '.chat')); fs.symlinkSync(out, path.join(sl, '.chat', 'agents.json')); fs.symlinkSync(out, path.join(sl, '.chat', 'sessions.json.tmp'))
  core.init(sl); core.setSession(sl, 'pm', { id: 'a', seen: 0 })
  assert.ok(!fs.existsSync(out) && fs.lstatSync(path.join(sl, '.chat', 'agents.json')).isSymbolicLink() && core.sessions(sl).pm.id === 'a')
  assert.deepStrictEqual(core.permissionRules({ cli: 'codex2', allowedCommands: ['npm run check'], permissions: DEF }), []) // suffixed account → codex rules
  assert.deepStrictEqual(core.permissionRules({ cli: 'claude2', allowedCommands: ['npm run check'], permissions: DEF }), ['Bash(npm run check)'])

  // denials: only narrow rules are grantable; junk/HTML/@/oversized never crash, never produce broad rules
  const agent = { cli: 'claude', allowedCommands: ['npm run check'], permissions: DEF }
  const den = core.normalizePermissionDenials([
    { tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm  test' } },
    { tool_name: 'Bash', tool_use_id: 'u2', tool_input: { command: 'npm test' } }, // same rule → dedup
    { tool_name: 'Bash', tool_input: { command: 'npm test && rm -rf /' } },
    { tool_name: 'Bash', tool_input: { command: 'npm run check' } }, // already granted
    { tool_name: 'WebFetch', tool_input: { url: 'https://docs.example.com/a?b=1' } },
    { tool_name: 'WebFetch', tool_input: { url: 'https://u:p@evil.com/' } },
    { tool_name: 'mcp__github__get_issue', tool_input: {} },
    { tool_name: 'Write', tool_input: { file_path: '/etc/x' } },
    { tool_name: '<img src=x onerror=alert(1)> @dev', tool_input: {} },
    { tool_name: 'Bash', tool_input: { command: 'x'.repeat(9000) } },
    'junk', null, { tool_name: 'Bash', tool_input: ['npm test'] }], agent)
  const grantable = den.filter(x => x.canGrant).map(x => x.rule)
  assert.deepStrictEqual(grantable, ['Bash(npm test)', 'WebFetch(domain:docs.example.com)', 'mcp__github__get_issue'])
  assert.ok(den.every(x => typeof x.id === 'string' && typeof x.label === 'string' && (x.canGrant || x.reason)))
  assert.ok(!den.some(x => /^(Bash|WebFetch)$|\*|&&/.test(x.rule || ''))) // never a broad or compound rule
  assert.deepStrictEqual(core.normalizePermissionDenials([{ tool_name: 'Bash', tool_input: { command: 'npm test' } }], { ...agent, permissions: { ...DEF, mode: 'full' } })
    .map(x => x.canGrant), [false])
  assert.deepStrictEqual(core.normalizePermissionDenials(Array(33).fill({ tool_name: 'Bash', tool_input: { command: 'ls' } }), agent).map(x => x.canGrant), [false])
}

// ---- Sprint 9 R7 (context of the last main step) + R4 (progress detail): parser fixtures and core.run with a fake claude ----
async function sprint9Checks() {
  const cl = core.CLI.claude, J = (...events) => events.map(e => JSON.stringify(e)).join('\n')
  const A = (id, usage, extra = {}) => ({ type: 'assistant', ...extra, message: { ...(id ? { id } : {}), content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }], ...(usage === undefined ? {} : { usage }) } })
  const R = (input, extra = {}) => ({ type: 'result', subtype: 'success', result: 'ok', session_id: 's', usage: { input_tokens: input, output_tokens: 1 }, ...extra })
  const ctx = (...events) => cl.parse(J(...events, R(1)), { costBaseline: 0 }).contextInputTokens
  const k = n => ({ input_tokens: n })
  let r = cl.parse(J(A('m1', k(60000)), A('m2', k(65000)), A('m3', k(70000)), R(195000)), { costBaseline: 0 })
  assert.deepStrictEqual([r.usage.inputTokens, r.contextInputTokens], [195000, 70000]) // usage = sum, context = last step
  assert.strictEqual(ctx(A('m1', { input_tokens: 4, cache_read_input_tokens: 30000, cache_creation_input_tokens: 500,
    cache_creation: { ephemeral_5m_input_tokens: 500 } })), 30504) // breakdown not added twice
  assert.strictEqual(ctx(A('m1', k(100)), A('m1', k(120))), 120) // same ID = same step: snapshot, not 220
  assert.strictEqual(ctx(A('m1', k(100)), A('m2', k(200)), A('m1', k(100))), 200) // an old ID repeated does not replace the newer step
  assert.strictEqual(ctx(A('m1', k(70000)), A('s1', k(300000), { parent_tool_use_id: 't' })), 70000) // subagent (event level)
  assert.strictEqual(ctx(A('m1', k(70000)), { type: 'assistant', message: { id: 's2', parent_tool_use_id: 't', content: [], usage: k(300000) } }), 70000)
  assert.strictEqual(ctx(A('m1', k(200000)), A('m2', k(70000))), 70000) // last step, not max
  assert.strictEqual(ctx(A('m1', k(70000)), A('m2')), null) // new step without usage → null, not the previous step
  assert.strictEqual(ctx(A('m1', k(70000)), A(null, k(5))), null) // no message ID → no measurement
  assert.strictEqual(ctx(A('m1', { input_tokens: 5 })), 5) // cache fields missing = 0 …
  assert.strictEqual(ctx(A('m1', { input_tokens: 5, cache_read_input_tokens: null })), null) // … present but broken = null
  for (const bad of ['5', -1, 1.5, null, 2 ** 53]) assert.strictEqual(ctx(A('m1', k(bad))), null, String(bad))
  assert.strictEqual(ctx(A('m1', { input_tokens: 2 ** 52, cache_read_input_tokens: 2 ** 52 })), null) // sum beyond safe integers
  assert.strictEqual(ctx(A('m1', k(0))), 0) // 0 is a valid measurement
  assert.strictEqual(ctx(A('m1', k(70000)), { type: 'system', subtype: 'compact' }), null) // compaction drops the old snapshot
  assert.strictEqual(cl.parse(J(A('m1', k(70000)), R(1, { subtype: 'error_during_execution', is_error: true }))).contextInputTokens, null)
  assert.strictEqual(core.CLI.codex.parse(J({ type: 'turn.completed', usage: { input_tokens: 999999, output_tokens: 1 } })).contextInputTokens, null)

  // R4: the full command (not the 160-char label) as runtime detail; capped at 8192, control chars dropped, never HTML
  const s = cl.state(), ev = e => cl.event(e, s, { dir: '/p' }), bash = command => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } })
  const long = 'npm run check -- ' + 'x'.repeat(300)
  assert.strictEqual(ev(bash(long)), 'Đang chạy lệnh'); assert.deepStrictEqual(s.progressDetail, { detail: long, detailTruncated: false })
  ev(bash('y'.repeat(9000))); assert.deepStrictEqual([s.progressDetail.detail.length, s.progressDetail.detailTruncated], [8192, true])
  ev(bash('<script>alert(1)</script>\n\tok\x07')); assert.strictEqual(s.progressDetail.detail, '<script>alert(1)</script>\n\tok')
  ev({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/src/a.js' } }] } })
  assert.strictEqual(s.progressDetail.detail, '/p/src/a.js') // label shows the basename, detail the full path
  ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'xong' }] } }); assert.strictEqual(s.progressDetail.detail, null) // new activity clears it

  // core.run: context of the last spawn decides the next turn; usage still sums; two commands with one label both reported
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s9-')); core.init(d)
  fs.writeFileSync(path.join(d, '.chat', 'agents.json'), JSON.stringify([{ name: 'q', cli: 'claude', role: 'Dev' }]))
  const q = core.team(d)[0]
  const go = async (steps, env = {}, a = q) => {
    Object.assign(process.env, { FAKE_MODE: 'steps', FAKE_STEPS: JSON.stringify(steps), FAKE_TID: 'Q1', FAKE_IN: '195000', FAKE_ERR: '0' }, env)
    const progress = [], res = await core.run(d, a, { runId: 'r' + Math.random(), onProgress: (label, extra) => progress.push([label, extra?.detail ?? null]) })
    return { ...res, progress, args: lastArgs(), s: core.sessions(d)[a.name] }
  }
  r = await go([A('m1', k(60000)), A('m2', k(65000)), A('m3', k(150001))])
  assert.deepStrictEqual([r.usage.inputTokens, r.s.lastTurn.inputTokens, r.s.lastTurn.contextInputTokens], [195000, 195000, 150001])
  assert.ok(core.sessionRotationPending(q, r.s))
  r = await go([A('m1', k(70000))], { FAKE_TID: 'Q2' }); assert.ok(!r.args.includes('--resume') && r.sessionRotation?.contextInputTokens === 150001)
  r = await go([A('m1', k(200000)), A('m2', k(150000))], { FAKE_TID: 'Q2', FAKE_IN: '999999' }) // usage huge, last step = limit
  assert.ok(r.args.includes('--resume') && r.s.lastTurn.contextInputTokens === 150000 && !core.sessionRotationPending(q, r.s))
  r = await go([A('m1', k(999999))], { FAKE_TID: 'Q2', FAKE_ERR: '1' }) // error: usage kept, context not trusted
  assert.deepStrictEqual([r.outcome, r.usage.inputTokens, r.s.lastTurn.contextInputTokens], ['error', 195000, null])
  r = await go([A('m1', k(5))], { FAKE_TID: 'Q2' }); assert.ok(r.args.includes('--resume'))
  // legacy record: only a huge inputTokens, no context → never rotates
  core.setSession(d, 'q', { ...core.sessions(d).q, lastTurn: { runId: 'old', inputTokens: 5000000, partial: false, at: new Date().toISOString() } })
  assert.ok(!core.sessionRotationPending(q, core.sessions(d).q))
  r = await go([bash('npm test -- a'), { ...bash('npm test -- b'), message: { id: 'z', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test -- b' } }] } }], { FAKE_TID: 'Q2' })
  assert.deepStrictEqual(r.progress.filter(([label]) => label === 'Đang chạy lệnh').map(([, detail]) => detail), ['npm test -- a', 'npm test -- b'])
  for (const key of ['FAKE_STEPS', 'FAKE_TID', 'FAKE_IN', 'FAKE_ERR']) delete process.env[key]
  console.log('ok (sprint 9 R7/R4)')
}

async function sprint11CoreChecks() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s11-')); core.init(d)
  const at = '2026-10-14T12:00:00.000Z'
  const tasksFile = path.join(d, '.chat', 'tasks.json')
  const T = (id, x = {}) => ({ id, title: `Task ${id}`, assignee: 'dev', spec: 'reports/s.md', createdAt: at, updatedAt: at, ...x })

  // 1. Acceptance parsing & defaults
  const rawTasks = [
    T('T1', { acceptance: 'code' }),
    T('T2', { acceptance: 'manual' }),
    T('T3') // defaults to code
  ]
  const defs = core.parseTaskDefinitions(JSON.stringify({ version: 1, tasks: rawTasks }), d)
  assert.strictEqual(defs[0].acceptance, 'code')
  assert.strictEqual(defs[1].acceptance, 'manual')
  assert.strictEqual(defs[2].acceptance, 'code')
  assert.strictEqual(defs[2].rawAcceptance, null)
  fs.writeFileSync(tasksFile, JSON.stringify({ version: 1, tasks: rawTasks }))

  const b1 = await core.taskBoardIndexed(d)
  assert.strictEqual(b1.tasks[0].acceptance, 'code')
  assert.strictEqual(b1.tasks[1].acceptance, 'manual')
  assert.strictEqual(b1.tasks[2].acceptance, 'code')
  assert.ok(b1.tasks[0].definitionRevision)

  // 2. Acceptance update bumps revision and definitionRevision
  const defsMod = [
    T('T1', { acceptance: 'manual', updatedAt: '2026-10-14T13:00:00.000Z' }),
    T('T2', { acceptance: 'manual' }),
    T('T3')
  ]
  fs.writeFileSync(tasksFile, JSON.stringify({ version: 1, tasks: defsMod }))
  const b2 = await core.taskBoardIndexed(d)
  assert.notStrictEqual(b2.tasks[0].definitionRevision, b1.tasks[0].definitionRevision)
  assert.notStrictEqual(b2.tasks[0].revision, b1.tasks[0].revision)

  // 3. validateTaskChanges gate
  assert.throws(() => core.validateTaskChanges(b2, [{ id: 'T1', status: 'done', expectedRevision: b2.tasks[0].revision }], 'dev'), /approval/)
  assert.throws(() => core.validateTaskChanges(b2, [{ id: 'T1', status: 'done', expectedRevision: b2.tasks[0].revision, approval: { kind: 'manual', reason: 'done' } }], 'dev'), /Chỉ PM/)

  assert.throws(() => core.validateTaskChanges(b2, [{ id: 'T1', status: 'done', expectedRevision: b2.tasks[0].revision }], 'pm'), /approval/)

  const approved = core.validateTaskChanges(b2, [{ id: 'T1', status: 'done', expectedRevision: b2.tasks[0].revision, approval: { kind: 'manual', reason: 'đã nghiệm thu' } }], 'pm')
  assert.strictEqual(approved.length, 1)
  assert.strictEqual(approved[0].status, 'done')
  assert.strictEqual(approved[0].approval.kind, 'manual')
  assert.strictEqual(approved[0].approval.reviewer, 'pm')

  // 4. parseTaskStatusBlock
  const blk = j => '```task-status\n' + j + '\n```'
  const pDoneValid = core.parseTaskStatusBlock('Xong\n' + blk('[{"id":"T1","status":"done","expectedRevision":"r","approval":{"kind":"checks","checkIds":["00000000-0000-4000-8000-000000000001"],"note":"note"}}]'))
  assert.strictEqual(pDoneValid.error, null)
  assert.strictEqual(pDoneValid.changes[0].approval.kind, 'checks')
  assert.deepStrictEqual(pDoneValid.changes[0].approval.checkIds, ['00000000-0000-4000-8000-000000000001'])

  const pDoneNoApproval = core.parseTaskStatusBlock('Xong\n' + blk('[{"id":"T1","status":"done","expectedRevision":"r"}]'))
  assert.ok(pDoneNoApproval.error)

  // 5. parseRunCommandBlock with tasks array
  const cmdBlk = j => '```run-command\n' + j + '\n```'
  const pCmdValid = core.parseRunCommandBlock('Chạy\n' + cmdBlk('{"command":"npm test","tasks":[{"id":"T1","expectedRevision":"r1"}]}'))
  assert.strictEqual(pCmdValid.requested, true)
  assert.strictEqual(pCmdValid.command, 'npm test')
  assert.deepStrictEqual(pCmdValid.tasks, [{ id: 'T1', expectedRevision: 'r1' }])

  const pCmdTooManyTasks = core.parseRunCommandBlock('Chạy\n' + cmdBlk(JSON.stringify({ command: 'npm test', tasks: Array.from({ length: 21 }, (_, i) => ({ id: `T${i + 1}`, expectedRevision: 'r' })) })))
  assert.ok(pCmdTooManyTasks.error)

  // 6. PM prompt contains work distribution rules
  const pmPrompt = await core.promptIndexed(d, { name: 'pm', role: 'PM' }, null)
  assert.ok(pmPrompt.text.includes('Luật chia việc cho PM:'))
  assert.ok(pmPrompt.text.includes('acceptance: "code" cho code sản phẩm, "manual"'))

  const devPrompt = await core.promptIndexed(d, { name: 'dev', role: 'Dev' }, null)
  assert.ok(!devPrompt.text.includes('Luật chia việc cho PM:'))
  assert.ok(devPrompt.text.includes('Chỉ PM được đóng task (done).'))

  // 7. formatAppFacts & prompt app context
  const facts = {
    version: 1,
    capturedAt: '2026-10-14T12:00:00.000Z',
    source: 'worktree',
    branch: 'feat',
    headSha: '0123456789abcdef0123456789abcdef01234567',
    diff: { files: 2, insertions: 10, deletions: 2, untracked: 1, binary: 0, paths: ['a.js', 'b.js'], truncated: false },
    latestCheck: { outcome: 'passed', finishedAt: '2026-10-14T11:59:00.000Z', current: true }
  }
  const promptWithFacts = await core.promptIndexed(d, { name: 'dev', role: 'Dev' }, null, { appContext: { facts } })
  assert.ok(promptWithFacts.text.includes('Dữ kiện hiện tại do app cung cấp'))
  assert.ok(promptWithFacts.text.includes('HEAD: 0123456789'))
  assert.ok(promptWithFacts.text.includes('Diff: 2 file, +10 -2, 1 file mới'))
  assert.ok(promptWithFacts.text.includes('Check gần nhất: passed'))

  console.log('ok (sprint 11 core G1-G6)')
}

// ---- Sprint 6 F: indexed log, accent-insensitive search, 10k messages, J settings, summary checkpoint ----
async function sprint6Checks() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s6-')); core.init(d)
  const at = new Date().toISOString(), log = path.join(d, '.chat', 'log.jsonl')
  fs.writeFileSync(log, Array.from({ length: 10000 }, (_, i) => JSON.stringify({ from: i % 3 ? 'dev' : 'user', at,
    text: i === 42 ? 'Sprint 2: làm KHÓA FILE thật' : i === 43 ? 'khoa file không dấu' : `tin ${i}` })).join('\n') + '\n')
  let t0 = performance.now(), page = await core.logPage(d)
  assert.ok(performance.now() - t0 < 2000, `mở log 10k mất ${performance.now() - t0}ms`)
  assert.deepStrictEqual([page.total, page.messages.length, page.messages[99].seq, page.hasBefore], [10000, 100, 9999, true])
  t0 = performance.now(); const s = await core.searchLog(d, { query: 'khóa file' })
  assert.ok(performance.now() - t0 < 500, `tìm mất ${performance.now() - t0}ms`)
  assert.deepStrictEqual(s.results.map(r => r.seq), [43, 42]) // có dấu/không dấu, hoa/thường, mới nhất trước
  const hit = s.results[1]; assert.strictEqual(hit.excerpt.slice(...hit.matches[0]), 'KHÓA FILE') // highlight on the original text
  assert.deepStrictEqual((await core.searchLog(d, { query: 'KHOA FILE', from: 'user' })).results.map(r => r.seq), [42])
  assert.deepStrictEqual((await core.searchLog(d, { query: 'khoa file', from: 'dev' })).results.map(r => r.seq), [43])
  assert.deepStrictEqual((await core.logPage(d, { around: 42, limit: 5 })).messages.map(m => m.seq), [40, 41, 42, 43, 44]) // jump to hit
  t0 = performance.now(); const appended = await core.appendLogIndexed(d, { from: 'user', text: 'mới', at })
  assert.ok(performance.now() - t0 < 200, `ghi 1 tin vào log 10k mất ${performance.now() - t0}ms`)
  assert.deepStrictEqual([appended.message.seq, appended.generation], [10000, page.generation]) // append keeps generation
  // J settings: default 12, range 1–50, cost ceiling optional and > 0
  const st = core.projectSettings(d).settings
  assert.deepStrictEqual([st.chainLimit, st.costCeiling, st.autoSummary, st.worktreesEnabled], [12, null, true, false])
  for (const bad of [{ chainLimit: 0 }, { chainLimit: 51 }, { chainLimit: 1.5 }, { costCeiling: 0 }, { costCeiling: -1 }, { costCeiling: '1' }])
    assert.throws(() => core.normalizeProjectSettings(bad), undefined, JSON.stringify(bad))
  assert.strictEqual(core.normalizeProjectSettings({ chainLimit: 50, costCeiling: 0.5 }).chainLimit, 50)
  // F3: ≥100 old messages → PM batch; the accepted summary is a checkpoint record, the log itself is kept
  const batch = await core.summaryBatch(d); assert.deepStrictEqual([batch.through, batch.end], [0, 100])
  assert.ok(batch.prompt.includes('[42] [user] Sprint 2: làm KHÓA FILE thật'))
  const summary = await core.acceptSummary(d, batch, '# Tóm tắt\n- khóa file ở Sprint 2', 'run-s')
  core.materializeSummary(d, summary); await core.appendLogIndexed(d, { from: 'pm', at, kind: 'summary', summary, runId: 'run-s', text: 'tóm tắt' })
  assert.ok(fs.readFileSync(path.join(d, '.chat', 'summary.md'), 'utf8').includes('khóa file ở Sprint 2'))
  assert.deepStrictEqual([(await core.summaryBatch(d)).through, (await core.logPage(d)).total], [100, 10002])
  assert.ok((await core.promptIndexed(d, core.team(d)[0], null)).text.includes('khóa file ở Sprint 2')) // new session gets the summary
  await assert.rejects(core.acceptSummary(d, batch, 'x', 'r2')) // stale checkpoint refused
  core.writeProjectSettings(d, { ...st, autoSummary: false }, core.projectSettings(d).revision)
  assert.strictEqual(await core.summaryBatch(d), null) // turned off in ⚙
  // a crash mid-append (unfinished last line) moves to log.jsonl.bad-* on the next append instead of blocking the log for good
  const total = (await core.getLogIndex(d)).records.length
  fs.appendFileSync(log, '{"from":"dev","text":"đứt')
  const fixed = await core.appendLogIndexed(d, { from: 'user', text: 'sau sự cố', at })
  const bad = fs.readdirSync(path.join(d, '.chat')).filter(f => f.startsWith('log.jsonl.bad-'))
  assert.deepStrictEqual([fixed.message.seq, bad.length, fs.readFileSync(path.join(d, '.chat', bad[0]), 'utf8')], [total, 1, '{"from":"dev","text":"đứt'])
  fs.renameSync(log, log + '.real'); fs.symlinkSync(log + '.real', log) // log.jsonl must be a real file…
  await assert.rejects(core.appendLogIndexed(d, { from: 'user', text: 'x', at }), { code: 'LOG_CORRUPT' })
  fs.rmSync(log); fs.renameSync(log + '.real', log)
  fs.linkSync(log, log + '.link') // …and not a hard link (an agent could link it to a file outside its sandbox)
  await assert.rejects(core.appendLogIndexed(d, { from: 'user', text: 'x', at }), { code: 'LOG_CORRUPT' })
  fs.rmSync(log + '.link')

  // token & cost panel lives in the timeline dialog, not in the right column
  const ui = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), tlAt = ui.indexOf('<dialog id="timeline"')
  assert.ok(tlAt > 0 && ui.indexOf('id="stats"', tlAt) < ui.indexOf('</dialog>', tlAt) && !ui.includes('id="stats-sec"'), 'panel token không nằm trong Timeline')
  assert.strictEqual(ui.split('id="stats"').length, 2)
}

// "Cần bạn": an @user ask stays open until the user writes to that agent (no @ → PM); a chain stop until any user
// message or a continue; a dismissed key hides only that message
async function needsChecks() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-needs-'))); core.init(d)
  const say = (from, text, extra = {}) => core.appendLogIndexed(d, { from, text, at: new Date().toISOString(), ...extra })
  const open = async (dismissed) => (await core.needsYou(d, dismissed)).map(item => [item.kind, item.from, item.text])
  await say('pm', 'Đã chia việc.\n@user Bản 4 có 4 chỗ cần bạn chốt'); await say('dev', '@user xong T18, mời xem')
  await say('qa', 'email: a@user.com') // not a mention
  assert.deepStrictEqual(await open(), [['ask', 'dev', '@user xong T18, mời xem'], ['ask', 'pm', '@user Bản 4 có 4 chỗ cần bạn chốt']])
  await say('user', '@dev ok') // answers dev only
  assert.deepStrictEqual(await open(), [['ask', 'pm', '@user Bản 4 có 4 chỗ cần bạn chốt']])
  await say('user', 'chốt theo phương án A') // no @ goes to the PM
  assert.deepStrictEqual(await open(), [])
  await say('system', 'Chuỗi dừng ở 12 lượt', { kind: 'chain-stop', targets: ['dev'] })
  const [stop] = await core.needsYou(d)
  assert.deepStrictEqual([stop.kind, (await core.needsYou(d, new Set([`${stop.seq}:${stop.at}`]))).length], ['chain', 0])
  await say('system', 'Tiếp tục chuỗi với @dev.', { kind: 'chain-continue', continuedFrom: stop.seq })
  assert.deepStrictEqual(await open(), [])
}

// timeline bars: a turn's result (answer or error) spans [at - durationMs, at]; other system lines are not turns
async function timelineChecks() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tl-'))); core.init(d)
  const t0 = Date.parse('2026-10-08T08:00:00Z'), at = ms => new Date(t0 + ms).toISOString()
  const usage = durationMs => ({ inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs, partial: false })
  await core.appendLogIndexed(d, { from: 'user', text: 'go', at: at(0) })
  await core.appendLogIndexed(d, { from: 'pm', text: 'ok', at: at(60e3), runId: 'r1', agent: 'pm', outcome: 'success', usage: usage(50e3) })
  await core.appendLogIndexed(d, { from: 'system', text: '@dev lỗi: x', at: at(120e3), runId: 'r2', agent: 'dev', outcome: 'error', usage: usage(30e3) })
  await core.appendLogIndexed(d, { from: 'system', text: 'Tiếp tục chuỗi', at: at(130e3), kind: 'chain-continue', runId: 'c1' })
  const { runs, last } = await core.timeline(d, 0)
  assert.deepStrictEqual(runs.map(r => [r.agent, r.start - t0, r.end - t0, r.outcome]), [['pm', 10e3, 60e3, 'success'], ['dev', 90e3, 120e3, 'error']])
  assert.strictEqual(last, t0 + 120e3)
  assert.deepStrictEqual((await core.timeline(d, t0 + 100e3)).runs.map(r => r.agent), ['dev']) // only turns ending in range
}

// Run the real settings/merge handlers with a minimal DOM; no Electron/CLI lookup needed.
async function rendererChecks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm'), nodes = new Map(), notices = []
  const part = (from, to) => ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from)))
  const all = node => [node, ...(node.children || []).flatMap(all)]
  const el = (tag, className = '', textContent = '') => ({ tag, className, textContent, style: {}, children: [],
    append(...children) { this.children.push(...children) }, prepend(...children) { this.children.unshift(...children) },
    replaceChildren(...children) { this.children = children }, focus() { context.document.activeElement = this },
    querySelectorAll() { return all(this).slice(1).filter(node => ['input', 'textarea', 'select', 'button'].includes(node.tag)) },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, setAttribute() {}, showModal() { this.open = true } })
  const $ = id => { if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id) }
  const session = { id: 'saved-session', cli: 'codex', workspaceId: 'workspace', seen: 42, at: '2026-09-27T00:00:00Z' }
  const context = vm.createContext({ $, el, structuredClone, dir: '/box', openSeq: 1, openingDir: null, notices, document: { activeElement: null },
    team: [{ name: 'dev', cli: 'codex', avatar: { gender: 'male', color: '#abc' } }], currentTeamRevision: 'team-r1',
    currentSettings: { worktreesEnabled: true }, currentSettingsRevision: null,
    worktreeState: { enabled: true, agents: [{ name: 'dev', workspaceId: 'workspace' }] }, currentPopoverAgent: null,
    AVATAR_PALETTE: ['#abc'], PALETTE_NAMES: {}, paintAvatar: node => node, avatar: () => el('svg'), icon: () => el('span'),
    warnBanner: text => el('div', 'task-error-banner', text),
    Option: function (label, value, defaultSelected, selected) { return { label, value, selected } },
    showToast: message => notices.push(message),
    api: { sessions: async () => ({ dev: session }), accounts: async () => ['codex'],
      models: async () => ({ models: [] }), cliSessions: async () => [],
      projectSettings: async () => ({ ok: false }), worktreeState: async () => ({ ok: false }),
      retryMerge: async () => ({ ok: false, error: { code: 'BUSY', message: 'merge busy' } }),
      requestMergeRepair: async () => ({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'repair rejected' } }),
      stopMerge: async () => ({ ok: false, error: { code: 'BUSY', message: 'stop busy' } }) } })
  vm.runInContext(part('function validateAllowedCommands', 'const hhmm'), context)
  vm.runInContext(part('// ---- settings:', 'let toastTimer'), context)
  await $('#gear').onclick()
  assert.strictEqual($('#settings').open, true, 'gear must open settings for agents that remember sessions')
  let options = all($('#editors')).filter(node => node.value === 'saved-session')
  assert.ok(options.some(node => node.selected), 'current workspace session must be selected')
  vm.runInContext("draft[0].cli = 'claude'; renderEditors()", context)
  options = all($('#editors')).filter(node => node.value === 'saved-session')
  assert.strictEqual(options.length, 0, 'switching CLI must not reuse the previous CLI session')

  // Save sends the revision the draft was read at: a team change meanwhile (e.g. a permission just granted) must
  // come back as CONFLICT, not be overwritten by the stale draft
  await $('#gear').onclick()
  context.currentTeamRevision = 'team-r2' // team-changed while the dialog is open
  $('#setting-chain-limit').value = '12'
  let sentRevision
  context.api.saveTeam = async (d, members, opts) => { sentRevision = opts.expectedRevision; return { ok: false, error: { message: 'conflict' } } }
  await $('#save').onclick()
  assert.deepStrictEqual([sentRevision, $('#err').textContent], ['team-r1', 'conflict'])

  // ⚙ whose lookups return after a project switch must not open A's team under B
  let release
  context.api.accounts = () => new Promise(resolve => { release = resolve })
  $('#settings').open = false
  const opening = $('#gear').onclick()
  context.dir = '/other-box'; context.openSeq++
  release(['codex']); await opening
  assert.strictEqual($('#settings').open, false, 'settings opened for the previous project')
  context.dir = '/box'; context.api.accounts = async () => ['codex']
  // …nor while a project is still opening (openSeq already moved, `team` is still the old one's)
  context.openingDir = '/other-box'
  await $('#gear').onclick()
  assert.strictEqual($('#settings').open, false, 'settings opened with the previous project\'s team')
  context.openingDir = null

  // after Xoá, focus must not land on the next member's Xoá (one Enter away from deleting it too)
  context.team = [...context.team, { name: 'qa', cli: 'codex', avatar: { gender: 'female', color: '#abc' } }]
  await $('#gear').onclick()
  const xoa = () => all($('#editors')).filter(node => node.tag === 'button' && node.textContent === 'Xoá')
  xoa()[0].focus(); xoa()[0].onclick()
  assert.strictEqual(xoa().length, 1)
  assert.notStrictEqual(context.document.activeElement, xoa()[0], 'focus moved onto the next member\'s Xoá')

  // a page only moves the edge it extended; a live message past the page end keeps "more after"
  Object.assign(context, { logGeneration: null, logHasBefore: false, logHasAfter: false, newestLiveSeq: 120, last: null,
    unreadNewMessagesCount: 0, isPagingLoading: false, msgFragment: () => el('frag') })
  vm.runInContext(part('let seenMsgs', 'const activeRuns'), context)
  vm.runInContext(part('let logWindow', "$('#log').addEventListener('scroll'"), context)
  context.renderLoadedPage({ generation: 'g', hasBefore: true, hasAfter: true, end: 100, messages: [] }, 'prepend')
  assert.deepStrictEqual([context.logHasBefore, context.logHasAfter], [true, false], 'a `before` page must not mark the end unloaded')
  context.renderLoadedPage({ generation: 'g', hasBefore: false, hasAfter: false, end: 110, messages: [{ seq: 109 }] }, 'append')
  assert.deepStrictEqual([context.logHasBefore, context.logHasAfter], [true, true], 'live message 120 is past this page')
  assert.strictEqual(vm.runInContext("firstSeen('g', 109)", context), false, 'a paged message must not be appended again by its live event')
  // date rules: calendar days in local time, not 24h spans
  const noon = new Date(2026, 9, 8, 12)
  assert.deepStrictEqual([new Date(2026, 9, 8, 0, 5), new Date(2026, 9, 7, 23, 55), new Date(2026, 9, 1)].map(d => context.dayLabel(d.toISOString(), noon)),
    ['Hôm nay', 'Hôm qua', new Date(2026, 9, 1).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' })])
  assert.match(context.dayLabel(new Date(2025, 9, 1).toISOString(), noon), /2025/, 'another year shows the year')
  // a paging reply that lands after a jump (replace) belongs to the old window: drop it
  let reply
  context.api.logPage = () => new Promise(resolve => { reply = resolve })
  context.document.querySelectorAll = () => [{ dataset: { seq: '109' } }]
  const paging = context.loadLaterPage()
  context.renderLoadedPage({ generation: 'g', hasBefore: true, hasAfter: false, end: 130, messages: [] }, 'replace')
  reply({ ok: true, page: { generation: 'g', hasBefore: true, hasAfter: true, end: 120, messages: [] } }); await paging
  assert.deepStrictEqual([$('#log').children.length, context.logHasAfter], [1, false], 'stale paging reply appended after a jump')

  vm.runInContext(part('// --- Sprint 6: Worktree & Merge Queue UI', 'function resizeInput()'), context)
  vm.runInContext("renderMergeQueue([{id:'done',agent:'dev',state:'merged'}, {id:'blocked',agent:'dev',state:'blocked-dirty',canRetry:true,canRepair:true,canStop:true}])", context)
  assert.strictEqual(Number($('#merge-count').textContent), 1, 'merged history is not pending work')
  assert.strictEqual($('#merge-queue').children.length, 1)
  const buttons = all($('#merge-queue')).filter(node => node.tag === 'button')
  for (const [button, message] of buttons.map((button, i) => [button, ['merge busy', 'repair rejected', 'stop busy'][i]])) {
    notices.length = 0; await button.onclick()
    assert.deepStrictEqual(notices, [message], 'IPC ok:false must show the error instead of success')
    assert.strictEqual(button.disabled, false)
  }
  let finish
  context.api.retryMerge = () => new Promise(resolve => { finish = resolve })
  const pending = buttons[0].onclick(); notices.length = 0
  context.dir = '/other-box'; context.openSeq++
  finish({ ok: false, error: { message: 'stale error' } }); await pending
  assert.deepStrictEqual(notices, [], 'merge response from the previous box must be ignored')
}

// File links: exercise the renderer's routing and viewer state, alongside the real main/core checks below.
async function rendererFileChecks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm'), nodes = new Map(), opened = [], watched = []
  const part = (from, to) => ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from)))
  const el = (tag, className = '', textContent = '') => ({ tag, className, textContent, children: [], attrs: {},
    append(...c) { this.children.push(...c) }, replaceChildren(...c) { this.children = c }, setAttribute(k, v) { this.attrs[k] = v },
    getAttribute(k) { return this.attrs[k] }, focus() {}, showModal() { this.open = true }, close() { this.open = false } })
  const $ = id => { if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id) }
  const workspace = { id: 'dev-tree', branch: 'agents/dev' }, content = '<script>alert(1)</script>', name = 'việt #%.html'
  const ctx = vm.createContext({ $, el, dir: '/p', team: [{ name: 'pm' }], base: p => p.split('/').pop(), NodeFilter: { SHOW_TEXT: 4 },
    window: { markdownit: require('markdown-it') }, document: { activeElement: null, createTextNode: text => el('text', '', text),
      createDocumentFragment: () => el('frag'), createTreeWalker: root => { let i = 0; return { nextNode: () => root.textNodes[i++] } } },
    api: { readProjectFile: async (...args) => { opened.push(args); return { ok: true, workspace, file: { path: name, name, format: 'text', content } } },
      watchProject: async (...args) => watched.push(args), openLink: () => assert.fail('file link must not open the browser') } })
  vm.runInContext(part('let mdInstance', 'function loadImages'), ctx)
  vm.runInContext(part('let currentViewerPath', 'async function refreshFiles'), ctx)
  const href = 'file:///Users/a/Library/Application%20Support/Agent%20Chat/renderer.js'
  const md = ctx.initMarkdown()
  assert.ok(md.render(`[renderer.js](${href})`).includes(`href="${href}"`), 'the link from the screenshot must be clickable')
  for (const denied of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//remote/x.js']) assert.strictEqual(md.validateLink(denied), false)
  const linked = (text, parent = '') => {
    const node = { nodeValue: text, parentElement: { closest: selector => selector === parent },
      parentNode: { replaceChild: frag => { node.fragment = frag } } }
    ctx.linkifyFiles({ textNodes: [node] })
    return node.fragment?.children.filter(n => n.tag === 'a').map(n => n.attrs.href) || []
  }
  assert.deepStrictEqual(linked('renderer.js index.html src/view.ts config.yaml data.json .chat2/memory.md reports/custom.abc'),
    ['renderer.js', 'index.html', 'src/view.ts', 'config.yaml', 'data.json', '.chat2/memory.md', 'reports/custom.abc'])
  assert.deepStrictEqual(linked(href), [href])
  assert.deepStrictEqual(linked('https://example.com/a.js x@example.js console.log()'), [])
  assert.deepStrictEqual(linked('renderer.js', 'pre'), [])
  assert.deepStrictEqual(linked('renderer.js', 'a'), [])
  let click, prevented = false
  const anchor = el('a', '', 'renderer.js'); anchor.setAttribute('href', href)
  ctx.bindLinkHandler({ querySelectorAll: () => [anchor], addEventListener: (event, handler) => { click = handler } })
  await click({ target: { closest: () => anchor }, preventDefault: () => { prevented = true } })
  assert.ok(prevented)
  assert.deepStrictEqual(opened[0], ['/p', href, null, undefined])
  assert.deepStrictEqual(watched[0], ['/p', 'vi%E1%BB%87t%20%23%25.html', workspace.id])
  assert.strictEqual($('#viewer-body').children[0].tag, 'pre')
  assert.strictEqual($('#viewer-body').children[0].textContent, content, 'HTML source must remain inert text')
  assert.strictEqual($('#viewer-title').textContent, name + ' [Nhánh agents/dev]')
  await vm.runInContext('openFileViewer(currentViewerHref, null, currentViewerWorkspace)', ctx)
  assert.deepStrictEqual(opened[1], ['/p', 'vi%E1%BB%87t%20%23%25.html', null, workspace.id])
  console.log('ok (file links and viewer)')
}

// ---- Sprint 9 FE: R2 grouping rule and R3 File chung, run from renderer.js in a vm (geometry/keyboard/theme still need Electron) ----
async function rendererS9Checks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm'), nodes = new Map(), store = new Map(), opened = []
  const part = (from, to) => ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from)))
  const el = (tag, className = '', textContent = '') => ({ tag, className, textContent, title: '', attrs: {}, children: [],
    append(...c) { this.children.push(...c) }, replaceChildren(...c) { this.children = c }, setAttribute(k, v) { this.attrs[k] = v } })
  const $ = id => { if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id) }
  let list = []
  const ctx = vm.createContext({ $, el, base: p => p.split(/[\\/]/).pop(), fileIcon: () => el('svg'), openFileViewer: f => opened.push(f),
    document: { createDocumentFragment: () => el('frag') }, dir: '/p', box: '.chat', openSeq: 1, api: { files: async () => list },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v) } })
  vm.runInContext(part('const fileHref', 'let currentViewerHref'), ctx)
  vm.runInContext(part('function isGroupableSystemMsg', 'function createMsgElement'), ctx)
  vm.runInContext(part('async function refreshFiles', "$('#new').onclick"), ctx)
  // R2: only the allowlisted success kinds are folded; never by text, never errors/actions
  const sys = (x = {}) => ({ from: 'system', seq: 5, at: '2026-10-13T00:00:00Z', text: 'Đã gộp nhánh của dev-a sau khi kiểm tra đạt.', ...x })
  const yes = [sys({ kind: 'task-status-note', relatedRunId: 'r1' }), sys({ kind: 'merge', queueId: 'q', headSha: 'h' })]
  const no = [sys({ kind: 'merge', queueId: 'q', headSha: 'h', error: { code: 'CONFLICT' } }), sys({ kind: 'merge', queueId: 'q' }),
    sys({ kind: 'task-status-note', relatedRunId: ' ' }), sys({ kind: 'permission-denied' }), sys({ kind: 'chain-stop', canContinue: true }),
    sys({ kind: 'session-rotated' }), sys({ kind: 'scope-warning' }), sys({ kind: 'retract' }), sys({ kind: 'mystery' }), sys(),
    sys({ kind: 'merge', queueId: 'q', headSha: 'h', retracted: true }), sys({ kind: 'merge', queueId: 'q', headSha: 'h', seq: undefined }),
    sys({ kind: 'merge', queueId: 'q', headSha: 'h', usage: { inputTokens: 1 } }), { ...sys({ kind: 'task-status-note', relatedRunId: 'r' }), from: 'pm' }]
  assert.deepStrictEqual(yes.map(m => ctx.isGroupableSystemMsg(m)), [true, true])
  no.forEach((m, i) => assert.strictEqual(ctx.isGroupableSystemMsg(m), false, `R2 gom nhầm #${i}: ${m.kind}`))
  // R3: pins (this box's memory, reports/roadmap.md once), sprint groups N desc with the spec first, the rest in "Khác"
  list = ['agents.json', 'reports/sprint-9-design.md', '.chat2/memory.md', 'reports/hotfix.md', 'reports/sprint-10.md', 'docs/roadmap.md',
    'reports/sprint-9.md', 'reports/roadmap.md', '.chat/memory.md', 'reports/sprint-9-proposal.md', 'reports/sprint-2.md', 'reports/sprint-09.md',
    'reports/xsprint-9.md', 'reports/sprint-9.txt']
  const view = () => $('#files').children[0].children.map(n => n.tag === 'button' ? n.title
    : [n.children[0].textContent, ...n.children[1].children.map(b => b.title)])
  store.set('file-groups:v1:' + JSON.stringify(['/p', '.chat']), JSON.stringify({ 'sprint:99': true, 'sprint:9': true }))
  await ctx.refreshFiles()
  assert.deepStrictEqual(view(), ['.chat/memory.md', 'reports/roadmap.md', ['Sprint 10 · 1', 'reports/sprint-10.md'],
    ['Sprint 9 · 3', 'reports/sprint-9.md', 'reports/sprint-9-design.md', 'reports/sprint-9-proposal.md'], ['Sprint 2 · 1', 'reports/sprint-2.md'],
    ['Khác · 7', 'agents.json', 'reports/hotfix.md', '.chat2/memory.md', 'docs/roadmap.md', 'reports/sprint-09.md', 'reports/sprint-9.txt', 'reports/xsprint-9.md']])
  const groups = $('#files').children[0].children.filter(n => n.tag === 'details')
  assert.deepStrictEqual(groups.map(g => !!g.open), [false, true, false, false]) // default closed, remembered state restored
  assert.deepStrictEqual(JSON.parse(store.get('file-groups:v1:' + JSON.stringify(['/p', '.chat']))), { 'sprint:9': true }) // gone group pruned
  groups[0].open = true; groups[0].ontoggle()
  assert.strictEqual(JSON.parse(store.get('file-groups:v1:' + JSON.stringify(['/p', '.chat'])))['sprint:10'], true)
  $('#files').children[0].children[0].onclick(); assert.deepStrictEqual(opened, ['.chat/memory.md']) // full path, not the basename
  ctx.box = '.chat2'; await ctx.refreshFiles(); assert.strictEqual(view()[0], '.chat2/memory.md') // the open box's memory
  assert.ok(!store.has('file-groups:v1:' + JSON.stringify(['/p', '.chat2'])) || !JSON.parse(store.get('file-groups:v1:' + JSON.stringify(['/p', '.chat2'])))['sprint:9'])
  ctx.localStorage.getItem = () => '{hỏng'; await ctx.refreshFiles(); assert.strictEqual(view()[0], '.chat2/memory.md') // broken storage: defaults
  // Absolute paths (core.files output): normalized against dir, original path preserved for openFileViewer
  ctx.box = '.chat'; ctx.localStorage.getItem = k => store.has(k) ? store.get(k) : null
  list = ['/p/agents.json', '/p/reports/sprint-9-design.md', '/p/reports/sprint-9.md', '/p/reports/roadmap.md', '/p/.chat/memory.md']
  await ctx.refreshFiles()
  assert.deepStrictEqual(view(), ['/p/.chat/memory.md', '/p/reports/roadmap.md',
    ['Sprint 9 · 2', '/p/reports/sprint-9.md', '/p/reports/sprint-9-design.md'],
    ['Khác · 1', '/p/agents.json']])
  opened.length = 0; $('#files').children[0].children[0].onclick()
  assert.deepStrictEqual(opened, ['/p/.chat/memory.md'])
  // Windows absolute paths with backslashes
  ctx.dir = 'C:\\p'; ctx.box = '.chat'
  list = ['C:\\p\\agents.json', 'C:\\p\\reports\\sprint-9.md', 'C:\\p\\reports\\roadmap.md', 'C:\\p\\.chat\\memory.md']
  await ctx.refreshFiles()
  assert.deepStrictEqual(view(), ['C:\\p\\.chat\\memory.md', 'C:\\p\\reports\\roadmap.md',
    ['Sprint 9 · 1', 'C:\\p\\reports\\sprint-9.md'],
    ['Khác · 1', 'C:\\p\\agents.json']])
  ctx.dir = '/p'
  // a reply for the previous box (same folder) must not overwrite the panel
  let release; ctx.api.files = () => new Promise(r => { release = r })
  const before = $('#files').children[0], pending = ctx.refreshFiles(); ctx.box = '.chat'; ctx.openSeq++
  release(['reports/sprint-1.md']); await pending
  assert.strictEqual($('#files').children[0], before, 'R3: danh sách file của box cũ ghi đè box mới')
  // T39: 4 right column headers have lead SVG icons and bold --ink styling; dropdown summaries have arrows
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.ok(html.includes('<i data-icon="user" class="lead"></i>Cần bạn'), 'T39: thiếu icon Cần bạn')
  assert.ok(html.includes('<i data-icon="tasks" class="lead"></i>Bảng task'), 'T39: thiếu icon Bảng task')
  assert.ok(html.includes('<i data-icon="branch" class="lead"></i>Hàng chờ merge'), 'T39: thiếu icon Hàng chờ merge')
  assert.ok(html.includes('<i data-icon="files" class="lead"></i>File chung'), 'T39: thiếu icon File chung')
  assert.ok(ui.includes("user: '<path") && ui.includes("tasks: '<rect") && ui.includes("files: '<path"), 'T39: thiếu icons trong ICONS map')
  assert.ok(html.includes(':is(.task-group-sum, .file-group-sum, .merge-summary)::before'), 'T39: thiếu CSS mũi tên ::before')
  assert.ok(html.includes(':is(.task-group, .file-group, #merge-details)[open]'), 'T39: thiếu CSS xoay mũi tên khi mở')
  console.log('ok (sprint 9 FE R2/R3/T39)')
}

// ---- Sprint 10 FE: V1 layout/resizing, V2 image/SVG blobs & modes, V3 HTML preview iframe & sandbox ----
async function rendererS10Checks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm')
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

  // 1. Static HTML & CSS contract assertions
  assert.ok(html.includes("frame-src agent-preview:"), 'CSP: thiếu frame-src agent-preview:')
  assert.ok(!html.includes("frame-src *") && !html.includes("frame-src 'unsafe-inline'"), 'CSP: không được nới lỏng frame-src')
  assert.ok(html.includes('id="viewer-img-controls"') && html.includes('id="viewer-img-fit"') && html.includes('id="viewer-img-orig"'), 'V2: thiếu controls ảnh fit/100%')
  assert.ok(html.includes('id="viewer-html-tabs"') && html.includes('id="viewer-tab-preview"') && html.includes('id="viewer-tab-source"'), 'V3: thiếu tab Xem trước | Mã nguồn')
  assert.ok(html.includes('id="viewer-html-external"'), 'V3: thiếu nút Mở bằng trình duyệt')
  assert.ok(html.includes('id="viewer-max"') && html.includes('id="viewer-resize-grip"'), 'V1: thiếu nút phóng to hoặc tay nắm đổi cỡ')
  assert.ok(html.includes('id="viewer-notice"') && html.includes('Xem trước tĩnh · Không chạy JavaScript hoặc tải tài nguyên mạng'), 'V3: thiếu thông báo tĩnh')
  assert.ok(html.includes('.viewer-dialog.maximized') && html.includes('.viewer-resize-grip'), 'V1: thiếu CSS maximized hoặc grip')
  assert.ok(html.includes('.viewer-img.fit') && html.includes('.viewer-img.orig'), 'V2: thiếu CSS fit/orig')
  assert.ok(html.includes('.viewer-iframe'), 'V3: thiếu CSS viewer-iframe')

  // 2. VM DOM & functional tests
  const part = (from, to) => ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from)))
  const nodes = new Map(), store = new Map()
  const el = (tag, className = '', textContent = '') => ({
    tag, className, textContent, style: {}, children: [], attrs: {},
    append(...c) { this.children.push(...c) },
    appendChild(c) { this.children.push(c) },
    replaceChildren(...c) { this.children = c },
    setAttribute(k, v) { this.attrs[k] = v },
    getAttribute(k) { return this.attrs[k] },
    classList: {
      _classes: new Set(className ? className.split(' ') : []),
      add(c) { this._classes.add(c) },
      remove(c) { this._classes.delete(c) },
      contains(c) { return this._classes.has(c) }
    },
    querySelector(sel) {
      const match = node => {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1)
          if ((node.className || '').split(' ').includes(cls)) return node
        }
        for (const child of node.children || []) {
          const found = match(child)
          if (found) return found
        }
        return null
      }
      for (const child of this.children || []) {
        const found = match(child)
        if (found) return found
      }
      return null
    },
    focus() { ctx.document.activeElement = this },
    showModal() { this.open = true },
    close() { this.open = false },
    contains(target) { return target === this || this.children.some(c => c === target) }
  })
  const $ = id => {
    const key = id.replace(/^#/, '')
    if (!nodes.has(key)) nodes.set(key, el('div', '', ''))
    return nodes.get(key)
  }

  let closedPreviews = [], createdPreviews = [], readImages = [], openedExternal = [], blobCounter = 0, revokedBlobs = []
  const listeners = new Map()
  const fakeBlobUrl = () => `blob:agent-preview/${++blobCounter}`

  const ctx = vm.createContext({
    $, el, dir: '/test-dir', base: p => p.split(/[\\/]/).pop(),
    document: { activeElement: null, getElementById: id => $(id) },
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
    Blob: function (bytes, opts) { this.bytes = bytes; this.type = opts?.type },
    URL: { createObjectURL: fakeBlobUrl, revokeObjectURL: u => revokedBlobs.push(u) },
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v))
    },
    api: {
      readProjectFile: async (d, h) => ({ ok: true, file: { path: h, name: h, format: 'text', content: 'text content' } }),
      readImage: async (d, h, from, wsId) => {
        readImages.push({ d, h, from, wsId })
        const isSvg = h.endsWith('.svg')
        return {
          ok: true, path: h, name: h,
          mime: isSvg ? 'image/svg+xml' : 'image/png',
          bytes: Buffer.from(isSvg ? '<svg></svg>' : 'fake-bytes'),
          version: 'sha-img-1', canOpenExternal: !isSvg, workspace: null
        }
      },
      createHtmlPreview: async (d, h, from, wsId) => {
        createdPreviews.push({ d, h, from, wsId })
        return {
          ok: true,
          file: { path: h, name: h, format: 'text', content: '<h1>hello</h1>', version: 'sha-html-1' },
          workspace: null,
          preview: { id: 'prev-123', url: 'agent-preview://tok-123/files/' + h }
        }
      },
      closeHtmlPreview: async id => { closedPreviews.push(id); return { ok: true } },
      openHtmlExternal: async (d, h, wsId) => { openedExternal.push({ d, h, wsId }); return { ok: true, opened: true } },
      watchProject: async () => {},
      on: (ev, fn) => listeners.set(ev, fn)
    }
  })

  vm.runInContext(part('let currentViewerPath', 'async function refreshFiles'), ctx)
  vm.runInContext(part("$('#viewer-close').onclick", "$('#reloadTasks').onclick"), ctx)

  // Test V1: load layout defaults & persistence
  const dump = o => JSON.parse(JSON.stringify(o))
  assert.deepStrictEqual(dump(ctx.loadViewerLayout()), { width: 880, height: 720, maximized: false })
  store.set('viewer-layout:v1', 'corrupt JSON{')
  assert.deepStrictEqual(dump(ctx.loadViewerLayout()), { width: 880, height: 720, maximized: false }, 'corrupt JSON must fallback to defaults')
  store.set('viewer-layout:v1', JSON.stringify({ width: 'NaN', height: 700 }))
  assert.deepStrictEqual(dump(ctx.loadViewerLayout()), { width: 880, height: 720, maximized: false }, 'NaN dimension must fallback to defaults')
  store.set('viewer-layout:v1', JSON.stringify({ width: 900, height: 600, maximized: true }))
  assert.deepStrictEqual(dump(ctx.loadViewerLayout()), { width: 900, height: 600, maximized: true })

  // Test V1: clamping
  const c1 = ctx.clampViewerDims(2000, 2000)
  assert.ok(c1.width <= 1200 - 32 && c1.height <= 800 - 32, 'clamp must not exceed viewport minus margin')
  const c2 = ctx.clampViewerDims(100, 100)
  assert.ok(c2.width >= 480 && c2.height >= 320, 'clamp must enforce min bounds')

  // Test V1: maximize & restore
  ctx.applyViewerLayout()
  assert.strictEqual($('#viewer').style.width, '880px')
  assert.strictEqual($('#viewer-max').attrs['aria-pressed'], 'false')
  ctx.toggleViewerMaximize()
  assert.strictEqual($('#viewer').style.width, 'calc(100vw - 32px)')
  assert.strictEqual($('#viewer-max').attrs['aria-pressed'], 'true')
  assert.strictEqual(JSON.parse(store.get('viewer-layout:v1')).maximized, true)
  assert.strictEqual(JSON.parse(store.get('viewer-layout:v1')).width, 880, 'normal width must be preserved when maximized')
  ctx.toggleViewerMaximize()
  assert.strictEqual($('#viewer').style.width, '880px')
  assert.strictEqual($('#viewer-max').attrs['aria-pressed'], 'false')

  // Test V1: keyboard resize grip
  ctx.handleViewerResizeKey({ key: 'ArrowRight', preventDefault() {} })
  assert.strictEqual($('#viewer').style.width, '912px', 'ArrowRight must step by 32px (880 + 32 = 912)')
  ctx.handleViewerResizeKey({ key: 'ArrowDown', preventDefault() {} })
  assert.strictEqual($('#viewer').style.height, '752px', 'ArrowDown must step by 32px (720 + 32 = 752)')

  // Test V2: images & SVG via readImage + blob URL
  const buttonOpener = el('button', '', 'open')
  ctx.document.activeElement = buttonOpener
  await ctx.openFileViewer('photo.png')
  assert.strictEqual(readImages.length, 1)
  assert.strictEqual(readImages[0].h, 'photo.png')
  const imgWrap = $('#viewer-body').children[0]
  assert.strictEqual(imgWrap.className, 'viewer-img-wrap')
  const imgEl = imgWrap.children[0]
  assert.ok(imgEl.src.startsWith('blob:agent-preview/'))
  assert.strictEqual($('#viewer-img-fit').attrs['aria-pressed'], 'true', 'default image mode must be fit')
  ctx.setImageMode('orig')
  assert.strictEqual($('#viewer-img-orig').attrs['aria-pressed'], 'true')
  assert.ok(imgEl.className.includes('orig'))

  // SVG via <img>, canOpenExternal=false
  await ctx.openFileViewer('icon.svg')
  assert.strictEqual(readImages.length, 2)
  assert.strictEqual($('#viewer-external').disabled, true, 'SVG external button must be disabled')
  assert.strictEqual(revokedBlobs.length, 1, 'previous image blob must be revoked')

  // Test V3: HTML preview iframe with sandbox & tabs
  await ctx.openFileViewer('test.html')
  assert.strictEqual(createdPreviews.length, 1)
  const iframe = $('#viewer-body').children[0]
  assert.strictEqual(iframe.tag, 'iframe')
  assert.strictEqual(iframe.attrs.sandbox, '', 'sandbox attribute must be empty string')
  assert.strictEqual(iframe.attrs.referrerpolicy, 'no-referrer')
  assert.ok(iframe.src.startsWith('agent-preview://'))
  assert.strictEqual($('#viewer-notice').style.display, '')
  assert.strictEqual($('#viewer-tab-preview').attrs['aria-selected'], 'true')

  // Tab switch to source
  ctx.setHtmlTab('source')
  assert.strictEqual($('#viewer-tab-source').attrs['aria-selected'], 'true')
  assert.strictEqual($('#viewer-notice').style.display, 'none')
  const pre = $('#viewer-body').children[1]
  assert.strictEqual(pre.tag, 'pre')
  assert.strictEqual(pre.textContent, '<h1>hello</h1>', 'source tab must show raw HTML')
  assert.strictEqual(iframe.style.display, 'none')

  // openHtmlExternal
  await $('#viewer-html-external').onclick()
  assert.strictEqual(openedExternal.length, 1)
  assert.strictEqual(openedExternal[0].h, 'test.html')

  // Escape via html-preview-escape event closes preview and restores focus
  const escHandler = listeners.get('html-preview-escape')
  assert.ok(typeof escHandler === 'function', 'html-preview-escape listener must be registered')
  escHandler('prev-123')
  assert.strictEqual($('#viewer').open, false, 'dialog must be closed on escape')
  assert.strictEqual(closedPreviews.includes('prev-123'), true, 'closeHtmlPreview must be called')
  // Test loadImages: passes workspace?.id, zoomable click routes to openFileViewer
  let loadImgArgs = []
  ctx.openFileViewer = (href, from, ws) => { loadImgArgs.push({ href, from, ws }) }
  let lastReadImageWsId = undefined
  ctx.api.readImage = async (d, href, from, wsId) => {
    lastReadImageWsId = wsId
    return { ok: true, path: 'docs/diagram.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg></svg>'), workspace: { id: 'ws1', branch: 'b1' } }
  }
  const imgTag = el('img')
  imgTag.dataset = { src: 'docs/diagram.svg' }
  imgTag.alt = 'diagram'
  imgTag.closest = () => null
  imgTag.replaceWith = () => {}
  const mdWrap = el('div')
  mdWrap.querySelectorAll = () => [imgTag]
  ctx.logHasAfter = false
  vm.runInContext(part('function loadImages', 'function renderMarkdown'), ctx)
  ctx.loadImages(mdWrap, { dir: '/test-dir', workspace: { id: 'ws1', branch: 'b1' } })
  await new Promise(r => setImmediate(r))
  assert.strictEqual(lastReadImageWsId, 'ws1', 'loadImages must pass workspace?.id, not the workspace object')
  assert.ok(imgTag.classList.contains('zoomable'), 'image without anchor must be zoomable')
  imgTag.onclick()
  assert.strictEqual(loadImgArgs.length, 1)
  assert.strictEqual(loadImgArgs[0].href, 'docs/diagram.svg')
  assert.deepStrictEqual(loadImgArgs[0].ws, { id: 'ws1', branch: 'b1' })

  console.log('ok (sprint 10 FE V1/V2/V3)')
}

// ---- Sprint 11 FE: task verification badges, test change warning, evidence panel, chain cost incomplete ----
async function rendererS11Checks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm')
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

  // 1. Static HTML & CSS contract assertions
  assert.ok(html.includes('.tree-task-badge'), 'CSS: thiếu .tree-task-badge')
  assert.ok(html.includes('.tree-task-badge-ready') && html.includes('.tree-task-badge-approved'), 'CSS: thiếu badge ready/approved')
  assert.ok(html.includes('.tree-task-badge-failed') && html.includes('.tree-task-badge-stale'), 'CSS: thiếu badge failed/stale')
  assert.ok(html.includes('.tree-task-badge-pending') && html.includes('.tree-task-badge-manual'), 'CSS: thiếu badge pending/manual')
  assert.ok(html.includes('.tree-task-badge-legacy') && html.includes('.tree-task-badge-unavailable'), 'CSS: thiếu badge legacy/unavailable')
  assert.ok(html.includes('.tree-task-warn-badge'), 'CSS: thiếu .tree-task-warn-badge')
  assert.ok(html.includes('.tree-task-evidence-btn'), 'CSS: thiếu .tree-task-evidence-btn')
  assert.ok(html.includes('.tree-task-evidence-panel'), 'CSS: thiếu .tree-task-evidence-panel')
  assert.ok(html.includes('.check-excerpt'), 'CSS: thiếu .check-excerpt')
  assert.ok(html.includes('.tree-task-spec-link'), 'CSS: thiếu .tree-task-spec-link')
  assert.ok(html.includes('.chain-cost-notice'), 'CSS: thiếu .chain-cost-notice')

  // UI strings in renderer.js
  assert.ok(ui.includes('taskEvidence'), 'renderer: thiếu gọi api.taskEvidence')
  assert.ok(ui.includes('getTaskVerificationBadge'), 'renderer: thiếu getTaskVerificationBadge')
  assert.ok(ui.includes('renderTaskEvidencePanel'), 'renderer: thiếu renderTaskEvidencePanel')
  assert.ok(ui.includes('renderEvidenceContent'), 'renderer: thiếu renderEvidenceContent')
  assert.ok(ui.includes('Chi phí chuỗi chưa đủ dữ liệu'), 'renderer: thiếu thông báo Chi phí chuỗi chưa đủ dữ liệu')

  // 2. VM DOM & functional tests
  const part = (from, to) => ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from)))
  const nodes = new Map()
  const el = (tag, className = '', initialText = '') => {
    let _text = initialText
    return {
      tag, className, style: { setProperty() {} }, children: [], attrs: {}, dataset: {},
      get textContent() {
        if (this.children.length > 0) {
          return this.children.map(c => typeof c === 'string' ? c : (c.textContent || '')).join(' ')
        }
        return _text
      },
      set textContent(v) {
        _text = String(v)
        this.children = []
      },
      append(...c) { this.children.push(...c) },
      appendChild(c) { this.children.push(c) },
      replaceChildren(...c) { this.children = c; _text = '' },
      setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return this.attrs[k] },
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter(c => c !== this)
      }
    },
    classList: {
      _classes: new Set(className ? className.split(' ').filter(Boolean) : []),
      add(c) { this._classes.add(c) },
      remove(c) { this._classes.delete(c) },
      contains(c) { return this._classes.has(c) }
    },
    querySelector(sel) {
      const match = node => {
        if (!node) return null
        if (sel.startsWith('.')) {
          const cls = sel.slice(1)
          if ((node.className || '').split(' ').includes(cls)) return node
        }
        if (sel.startsWith('#')) {
          const id = sel.slice(1)
          if (node.id === id) return node
        }
        for (const child of node.children || []) {
          const found = match(child)
          if (found) return found
        }
        return null
      }
      for (const child of this.children || []) {
        const found = match(child)
        if (found) return found
      }
      return null
    },
    querySelectorAll(sel) {
      const results = []
      const search = node => {
        if (!node) return
        if (sel.startsWith('.')) {
          const cls = sel.slice(1)
          if ((node.className || '').split(' ').includes(cls)) results.push(node)
        }
        for (const child of node.children || []) search(child)
      }
      for (const child of this.children || []) search(child)
      return results
    },
    closest(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1)
        if ((this.className || '').split(' ').includes(cls)) return this
      }
      return null
    },
    focus() { ctx.document.activeElement = this }
  }
}

  const patchAppend = node => {
    const oldAppend = node.append
    node.append = function (...c) {
      for (const child of c) { if (child && typeof child === 'object') child.parent = this }
      oldAppend.apply(this, c)
    }
  }

  const $ = id => {
    const key = id.replace(/^#/, '')
    if (!nodes.has(key)) {
      const node = el('div', '', '')
      node.id = key
      node.parentElement = el('div')
      nodes.set(key, node)
    }
    return nodes.get(key)
  }

  let evidenceCalls = [], viewerCalls = [], copiedTexts = []
  const ctx = vm.createContext({
    $, el: (tag, cls = '', txt = '') => {
      const node = el(tag, cls, txt)
      patchAppend(node)
      return node
    },
    dir: '/test-dir', box: '.chat', openSeq: 1,
    document: { activeElement: null },
    navigator: { clipboard: { writeText: async txt => copiedTexts.push(txt) } },
    showToast: () => {},
    openFileViewer: (href, from) => viewerCalls.push({ href, from }),
    getAgentAvatar: () => ({ color: '#3b82f6' }),
    hhmm: () => '12:00',
    STATUS_MAP: { doing: 'Đang chạy', review: 'Chờ duyệt', todo: 'Cần làm', done: 'Xong' },
    api: {
      tasks: async () => ({ tasks: [] }),
      taskEvidence: async (d, opts) => {
        evidenceCalls.push({ d, opts })
        return {
          ok: true,
          taskId: opts.taskId,
          revision: opts.expectedRevision,
          verification: {
            state: 'ready',
            reason: null,
            warnings: { files: [{ path: 'check.js', reason: 'test' }], total: 1, truncated: false },
            approval: null
          },
          review: {
            workspaceId: 'ws-dev',
            at: '2026-10-14T09:00:00Z',
            sourceSha: '0123456789abcdef0123456789abcdef01234567',
            baseSha: 'fedcba9876543210fedcba9876543210fedcba98'
          },
          checks: [
            {
              origin: 'merge',
              outcome: 'passed',
              finishedAt: '2026-10-14T09:05:00Z',
              candidateSha: 'abcdef0123456789abcdef0123456789abcdef01',
              sourceSha: '0123456789abcdef0123456789abcdef01234567',
              commands: [
                {
                  command: 'npm run check',
                  exitCode: 0,
                  durationMs: 1200,
                  excerpt: 'All 42 checks passed',
                  truncated: false
                }
              ]
            }
          ],
          total: 1,
          truncated: false
        }
      }
    }
  })

  vm.runInContext(part('let currentTasks', '// ---- "Cần bạn"'), ctx)
  vm.runInContext(part('function getRunDetailText', 'const QUIET_MS'), ctx)

  // Test 1: getTaskVerificationBadge mapping
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'todo' }).label, 'Chưa có dữ liệu kiểm')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'todo' }).state, 'none')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'doing', verification: { state: 'pending' } }).label, 'Chờ kiểm')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'ready' } }).label, 'Đã kiểm · chờ PM duyệt')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'stale', reason: 'code đổi' } }).label, 'Cần kiểm lại')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'stale', reason: 'code đổi' } }).reason, 'code đổi')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'failed' } }).label, 'Kiểm tra lỗi')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'manual' } }).label, 'Cần nghiệm thu')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'legacy' } }).label, 'Lịch sử cũ')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'unavailable' } }).label, 'Chưa xác minh được')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'review', verification: { state: 'none' } }).label, 'Chưa có bằng chứng')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'done', verification: { approval: { reviewer: 'pm', kind: 'checks' } } }).label, 'Đã duyệt')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'done', verification: { approval: { reviewer: 'pm', kind: 'checks' } } }).state, 'approved')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'done', verification: { state: 'legacy' } }).label, 'Lịch sử cũ')
  assert.strictEqual(ctx.getTaskVerificationBadge({ status: 'done' }).label, 'Lịch sử cũ')

  // Test 2: renderTreeTaskRow separation of controls & spec link
  const taskWithSpec = { id: 'T48', title: 'Task FE', assignee: 'dev-fe', status: 'doing', spec: 'reports/sprint-11.md', revision: 'rev1' }
  const itemEl = ctx.renderTreeTaskRow(taskWithSpec)
  const rowEl = itemEl.children[0]
  assert.strictEqual(rowEl.attrs['role'], undefined, 'row must NOT have role="button"')
  assert.strictEqual(rowEl.attrs['tabindex'], undefined, 'row must NOT have tabindex')
  const titleEl = rowEl.children.find(c => (c.className || '').includes('tree-task-title'))
  assert.ok(titleEl.attrs['role'] === 'button', 'titleEl must have role="button" when spec is present')
  assert.strictEqual(titleEl.attrs['tabindex'], '0')
  titleEl.onclick({ stopPropagation() {} })
  assert.strictEqual(viewerCalls.length, 1)
  assert.strictEqual(viewerCalls[0].href, 'reports/sprint-11.md')

  // Test 3: Test warning badge on row
  const taskWithWarn = {
    id: 'T47', title: 'Task BE', assignee: 'dev-be', status: 'review', revision: 'rev2',
    verification: { state: 'ready', warnings: { total: 1, files: [{ path: 'check.js', reason: 'test' }] } }
  }
  const warnItem = ctx.renderTreeTaskRow(taskWithWarn)
  const warnBadge = warnItem.children[0].children.find(c => (c.className || '').includes('tree-task-warn-badge'))
  assert.ok(warnBadge, 'row must render warning badge when warnings.total > 0')
  assert.strictEqual(warnBadge.textContent, '⚠️ Đổi test')
  assert.ok(warnBadge.title.includes('check.js'), 'warn tooltip must include modified check/test file')

  // Test 4: Evidence button toggle & api.taskEvidence panel
  const evBtn = itemEl.querySelector('.tree-task-evidence-btn')
  assert.ok(evBtn, 'task row must have evidence button')
  assert.strictEqual(evBtn.attrs['aria-expanded'], 'false')
  evBtn.onclick({ stopPropagation() {} })
  assert.strictEqual(evBtn.attrs['aria-expanded'], 'true')
  assert.strictEqual(evidenceCalls.length, 1)
  assert.strictEqual(evidenceCalls[0].opts.taskId, 'T48')

  // Wait for taskEvidence resolution
  await new Promise(r => setImmediate(r))
  const panel = itemEl.querySelector('.tree-task-evidence-panel')
  assert.ok(panel, 'evidence panel must be rendered')
  assert.ok(panel.textContent.includes('Hàng chờ merge'), 'panel must render check origin')
  assert.ok(panel.textContent.includes('npm run check'), 'panel must render command')
  const excerptPre = panel.querySelector('.check-excerpt')
  assert.ok(excerptPre, 'panel must have .check-excerpt')
  assert.strictEqual(excerptPre.textContent, 'All 42 checks passed', 'excerpt must be inert textContent')

  // Escape closes panel and returns focus to button
  let escPrevented = false
  panel.onkeydown({ key: 'Escape', preventDefault() { escPrevented = true }, stopPropagation() {} })
  assert.ok(escPrevented, 'Escape must be handled')
  assert.strictEqual(evBtn.attrs['aria-expanded'], 'false')
  assert.strictEqual(ctx.document.activeElement, evBtn, 'Escape must restore focus to evidence button')
  assert.strictEqual(itemEl.querySelector('.tree-task-evidence-panel'), null, 'panel must be removed after close')

  // Test 5: Conflict error triggers loadTasks refresh
  let loadTasksCalled = false
  ctx.api.tasks = async () => { loadTasksCalled = true; return { tasks: [] } }
  ctx.api.taskEvidence = async () => ({ ok: false, error: { code: 'CONFLICT', message: 'Task revision changed' } })
  evBtn.onclick({ stopPropagation() {} })
  await new Promise(r => setImmediate(r))
  assert.strictEqual(loadTasksCalled, true, 'CONFLICT must trigger loadTasks()')

  // Test 6: Cost incomplete in getRunDetailText
  const run1 = { label: 'Task run', chain: { turns: 3, limit: 12, costIncomplete: true } }
  assert.ok(ctx.getRunDetailText(run1).includes('Chi phí chuỗi chưa đủ dữ liệu'), 'getRunDetailText must include cost incomplete warning')
  const run2 = { label: 'Task run', chain: { turns: 3, limit: 12, costIncomplete: false } }
  assert.ok(!ctx.getRunDetailText(run2).includes('Chi phí chuỗi chưa đủ dữ liệu'), 'getRunDetailText must not include warning when cost is complete')

  console.log('ok (sprint 11 FE task verification & evidence)')
}

// ---- T45 (QA): V1/V2/V3 on the real Electron, real main.js + renderer.js. Opt-in, opens a window: `node check.js --electron` ----
// Not in `npm run check` (the merge queue has no display). Fixture project + a loopback server that counts every request.
function electronChecks() {
  const { spawnSync } = require('child_process'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-e2e-')), appDir = path.join(tmp, 'app')
  fs.mkdirSync(appDir) // loadFile('index.html') resolves against the entry's folder: mirror the project there with symlinks
  for (const f of fs.readdirSync(__dirname)) fs.symlinkSync(path.join(__dirname, f), path.join(appDir, f))
  fs.writeFileSync(path.join(appDir, 'qa-entry.js'), `(${qaElectronEntry})()`)
  const r = spawnSync(path.join(__dirname, 'node_modules', '.bin', 'electron'), [path.join(appDir, 'qa-entry.js')], { encoding: 'utf8', timeout: 150000,
    env: { ...process.env, QA_MAIN: path.join(appDir, 'main.js'), SHELL: '/nonexistent' } })
  fs.rmSync(tmp, { recursive: true, force: true })
  const line = String(r.stdout + r.stderr).split('\n').find(l => l.startsWith('E2E '))
  if (!line) { console.error(String(r.stdout + r.stderr).slice(-3000)); process.exit(1) }
  const out = JSON.parse(line.slice(4))
  console.log(`Electron ${out.electron || '?'}${out.timeout ? ' — HẾT GIỜ' : ''}`)
  for (const x of out.results) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}${x.ok ? '' : ' — ' + x.info}`)
  process.exit(!out.timeout && out.results.length && out.results.every(x => x.ok) ? 0 : 1)
}
function qaElectronEntry() { // runs inside Electron, serialized by electronChecks
  const { app, BrowserWindow, session } = require('electron')
  const fs = require('fs'), path = require('path'), os = require('os'), http = require('http')
  const MAIN = process.env.QA_MAIN
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-e2e-ud-')); app.setPath('userData', ud)
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-e2e-root-')))
  const results = [], hits = [], consoleMsgs = [], served = [], navs = []
  const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); }
  const server = http.createServer((req, res) => { hits.push(req.url); res.end('x') })
  server.listen(0, '127.0.0.1', async () => {
    const P = `http://127.0.0.1:${server.address().port}`
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
    const w = (f, d) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), d) }
    w('img.png', png); w('sub/bg.png', png)
    w('pic.svg', `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20" onload="console.log('SVG-RAN')"><script>console.log('SVG-RAN')</script><image href="${P}/svg-img" width="5" height="5"/><rect width="20" height="20" fill="red"/></svg>`)
    w('style.css', `@import "sub/deep.css"; @import url("${P}/css-import"); body{background:#00ff00} .bg{background:url(sub/bg.png);width:5px;height:5px} .ext{background:url(${P}/css-url)}`)
    w('sub/deep.css', 'h1{color:#0000ff}')
    w('page.html', `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="refresh" content="1;url=${P}/meta-refresh">
  <meta http-equiv="Content-Security-Policy" content="default-src *; script-src * 'unsafe-inline'">
  <base href="${P}/base/">
  <link rel="stylesheet" href="style.css"><link rel="stylesheet" href="${P}/ext.css">
  <link rel="prefetch" href="${P}/prefetch"><link rel="preconnect" href="${P}"><link rel="dns-prefetch" href="${P}">
  <script>console.log('JS-RAN'); try { parent.document.title = 'PWNED' } catch (e) {}; new Image().src = '${P}/js-img'</script>
  <script src="${P}/ext.js"></script>
  <style>a#go{position:fixed;left:0;top:0;width:200px;height:60px;display:block;background:#f0f}</style></head>
  <body onload="console.log('ONLOAD-RAN')"><a id="go" href="${P}/click" target="_top">go</a>
  <h1>Tiêu đề</h1><img src="img.png"><img src="${P}/ext-img"><img srcset="${P}/srcset 1x"><div class="bg"></div><div class="ext"></div>
  <form action="${P}/form" method="post"><input name="a" value="1" autofocus></form>
  <a href="javascript:console.log('JSLINK-RAN')">js</a><a href="${P}/dl" download>dl</a>
  <iframe src="${P}/inner"></iframe><iframe srcdoc="<script>console.log('SRCDOC-RAN')</script>"></iframe>
  <object data="${P}/obj"></object><embed src="${P}/embed">
  <svg onload="console.log('INLINE-SVG-RAN')"><image href="${P}/inline-svg-img" width="5" height="5"/></svg>
  <video src="${P}/video"></video><audio src="${P}/audio"></audio>
  </body></html>`)
    fs.writeFileSync(path.join(ud, 'projects.json'), JSON.stringify([root]))
    require(MAIN)
    await app.whenReady()
    const core = require(path.join(path.dirname(MAIN), 'core.js'))
    const fonts = []
    session.defaultSession.webRequest.onCompleted({ urls: ['agent-preview://*/*', 'https://fonts.googleapis.com/*'] }, d => d.url.startsWith('https:') ? fonts.push('ok') : served.push([new URL(d.url).pathname, d.statusCode, d.resourceType]))
    session.defaultSession.webRequest.onErrorOccurred({ urls: ['https://fonts.googleapis.com/*'] }, d => fonts.push(d.error))
    let win; while (!(win = BrowserWindow.getAllWindows()[0])) await new Promise(r => setTimeout(r, 50))
    win.webContents.on('console-message', (...a) => { const m = typeof a[0] === 'object' && a[0].message !== undefined ? a[0].message : a[2]; consoleMsgs.push(String(m)) })
    win.webContents.on('did-frame-navigate', (e, url, code, status, isMain) => navs.push([url, isMain]))
    await new Promise(r => win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r())
    try { core.trustConfig(root, core.configTrust(root).texts) } catch {}
    const js = code => win.webContents.executeJavaScript(code, true)
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    await js(`openProject(${JSON.stringify(root)})`); await sleep(800)
    await js(`openFileViewer('page.html')`); await sleep(2500)
    const iframe = await js(`(() => { const f = document.querySelector('#viewer iframe'); if (!f) return null; const r = f.getBoundingClientRect();
      let doc = 'blocked'; try { doc = f.contentDocument === null ? null : 'READABLE' } catch {}
      return { sandbox: f.getAttribute('sandbox'), ref: f.getAttribute('referrerpolicy'), src: f.src, x: r.x, y: r.y, w: r.width, h: r.height, doc, title: document.title } })()`)
    check('iframe có sandbox="" + no-referrer + agent-preview', iframe && iframe.sandbox === '' && iframe.ref === 'no-referrer' && iframe.src.startsWith('agent-preview://'), JSON.stringify(iframe))
    check('parent không đọc được DOM preview, trang không đổi title app', iframe && iframe.doc !== 'READABLE' && iframe.title !== 'PWNED', JSON.stringify(iframe))
    const okServed = p => served.some(([u, s]) => u.endsWith(p) && s === 200)
    check('nạp được entry, CSS tương đối, @import cấp 2, ảnh, ảnh nền CSS', ['page.html', 'style.css', 'sub/deep.css', 'img.png', 'sub/bg.png'].every(okServed), JSON.stringify(served))
    // click the full-width link at the iframe's top-left; then Enter on the focused form field
    if (iframe) {
      const x = Math.round(iframe.x + 20), y = Math.round(iframe.y + 20)
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'middle', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'middle', clickCount: 1 })
      await sleep(1500)
    }
    const frameUrls = win.webContents.mainFrame.framesInSubtree.map(f => f.url)
    check('không JS nào chạy (script, onload, javascript:, srcdoc, SVG)', !consoleMsgs.some(m => /-RAN/.test(m)), consoleMsgs.filter(m => /-RAN/.test(m)).join(','))
    check('server loopback nhận 0 request (preview)', hits.length === 0, hits.join(' '))
    check('iframe vẫn ở entry sau meta refresh và click link (frame lồng bị CSP chặn)', frameUrls.filter(u => u.startsWith('agent-preview://')).length === 1
      && frameUrls.some(u => /^agent-preview:\/\/[0-9a-f]+\/files\/page\.html$/.test(u)), JSON.stringify(frameUrls))
    check('cửa sổ chính không bị điều hướng', win.webContents.getURL().startsWith('file:') && win.webContents.getURL().endsWith('index.html'), win.webContents.getURL())
    // Esc with focus inside the iframe closes the viewer
    if (iframe) { const x = Math.round(iframe.x + iframe.w / 2), y = Math.round(iframe.y + iframe.h / 2)
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); await sleep(200) }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await sleep(500)
    check('Esc khi focus trong iframe đóng viewer', !(await js(`document.querySelector('#viewer').open`)))
    // SVG with script as an image in the viewer
    consoleMsgs.length = 0; const hitsBefore = hits.length
    await js(`openFileViewer('pic.svg')`); await sleep(1500)
    const svgImg = await js(`(() => { const i = document.querySelector('#viewer-body img'); return i ? { src: i.src.slice(0, 5), w: i.naturalWidth } : null })()`)
    check('SVG hiện bằng <img blob:>, script/onload không chạy, không tải href ngoài', svgImg && svgImg.src === 'blob:' && svgImg.w > 0 && !consoleMsgs.some(m => /RAN/.test(m)) && hits.length === hitsBefore, JSON.stringify(svgImg) + consoleMsgs.join(','))
    await js(`closeViewer()`)
    // V1: small window → dialog inside the viewport, Đóng visible; maximize/restore keeps the normal size
    win.setSize(960, 560); await sleep(400)
    await js(`openFileViewer('style.css')`); await sleep(800)
    const geo = await js(`(() => { const d = document.querySelector('#viewer').getBoundingClientRect(), c = document.querySelector('#viewer-close').getBoundingClientRect();
      return { vw: innerWidth, vh: innerHeight, d: [d.left, d.top, d.right, d.bottom], c: [c.left, c.top, c.right, c.bottom] } })()`)
    check('V1: cửa sổ nhỏ, khung xem nằm trong viewport, nút Đóng thấy được', geo.d[0] >= 0 && geo.d[1] >= 0 && geo.d[2] <= geo.vw && geo.d[3] <= geo.vh && geo.c[2] <= geo.vw && geo.c[1] >= 0, JSON.stringify(geo))
    await js(`closeViewer()`)
    // main frame UI requests are not cancelled by the preview gate (same session)
    await js(`openFileViewer('page.html')`); await sleep(1000) // a preview is active again
    await js(`document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter&qa=' + Date.now() }))`); await sleep(3000)
    check('font Google của UI chính không bị cổng preview huỷ (kể cả khi preview đang mở)', fonts.length > 0 && !fonts.includes('net::ERR_BLOCKED_BY_CLIENT'), JSON.stringify(fonts))
    await js(`closeViewer()`)
    console.log('E2E ' + JSON.stringify({ electron: process.versions.electron, results }))
    app.exit(results.every(r => r.ok) ? 0 : 1)
  })
  setTimeout(() => { console.log('E2E ' + JSON.stringify({ timeout: true, results })); app.exit(2) }, 60000)
}

// ---- Sprint 6 H + J through the real main.js: Electron stubbed, a sample git repo, a fake codex. Own process: main.js registers IPC globally ----
function mainChecks() {
  const r = require('child_process').spawnSync(process.execPath, [__filename, '--main'], { encoding: 'utf8', timeout: 300000,
    env: { ...process.env, SHELL: '/nonexistent' } }) // SHELL: main.js must not replace PATH (fake CLI) with the login shell's
  assert.strictEqual(r.status, 0, 'main.js (chuỗi agent / worktree / merge) lỗi:\n' + String(r.stdout + r.stderr).slice(-4000))
  for (const line of String(r.stdout).split('\n')) if (/^(BUG|ĐÃ SỬA) /.test(line)) console.log(line)
}

async function mainHarness() {
  const Module = require('module'), { execFileSync } = require('child_process')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-ud-')), handlers = {}, sent = []
  let dialogs = 0, dialogAnswer = 0, pickPath = null, onDialog = null
  const openedPaths = [], mainFrame = { id: 1 }
  const webContents = { send: (...a) => sent.push(a), setWindowOpenHandler() {},
    on(event, fn) { if (!this._listeners) this._listeners = {}; (this._listeners[event] = this._listeners[event] || []).push(fn) },
    emit(event, ...args) { for (const fn of this._listeners?.[event] || []) fn(...args) }, mainFrame, id: 1 }
  const registeredSchemes = []
  const protocolHandlers = {}
  let webRequestFilter = null, webRequestCallback = null
  const protocol = {
    registerSchemesAsPrivileged: schemes => { registeredSchemes.push(...schemes) },
    handle: (scheme, fn) => { protocolHandlers[scheme] = fn }
  }
  const session = {
    defaultSession: {
      protocol,
      webRequest: {
        onBeforeRequest: (filter, cb) => { webRequestFilter = filter; webRequestCallback = cb }
      },
      on: () => {}
    }
  }
  const electron = { app: { getPath: () => userData, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, quit() {} },
    BrowserWindow: function () { return { webContents, loadFile: () => Promise.resolve(), isMinimized: () => false, on(e, fn) { webContents.on(e, fn) }, isDestroyed: () => false } },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, shell: { openPath: async p => { openedPaths.push(p); return '' } },
    Menu: { setApplicationMenu() {}, buildFromTemplate: t => t }, nativeTheme: { themeSource: 'system', on() {} }, screen: { getAllDisplays: () => [] },
    dialog: { showMessageBox: async () => { dialogs++; await onDialog?.(); return { response: dialogAnswer, checkboxChecked: true } },
      showMessageBoxSync: () => 0,
      showOpenDialog: async () => ({ canceled: !pickPath, filePaths: [pickPath] }) },
    protocol, session }
  const load = Module._load
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : load.call(this, request, ...rest) }

  // fake codex: agent name from the prompt; FAKE_EDITS {agent: [[file, line, text]]}, FAKE_REPLY {agent: text}, FAKE_PROGRESS → touch a file
  const mbin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-main-'))
  fs.writeFileSync(path.join(mbin, 'codex'), `#!${process.execPath}
const fs = require('fs'), last = process.argv.at(-1)
if (process.argv[2] === 'sandbox') { // codex sandbox … -C <dir> -- <cmd…> (app-run checks): just run the command there
  const a = process.argv.slice(2), i = a.indexOf('--')
  process.exit(require('child_process').spawnSync(a[i + 1], a.slice(i + 2), { cwd: a[a.indexOf('-C') + 1], stdio: 'inherit' }).status ?? 1)
}
const p = last === '-' ? fs.readFileSync(0, 'utf8') : last, me = (/Bạn là @([\\w-]+)/.exec(p) || [])[1] || '?' // "-" = prompt over stdin
const out = o => process.stdout.write(JSON.stringify(o) + '\\n')
for (const [file, line, text] of JSON.parse(process.env.FAKE_EDITS || '{}')[me] || []) {
  const lines = fs.readFileSync(file, 'utf8').split('\\n'); lines[line] = text; fs.writeFileSync(file, lines.join('\\n'))
}
if (JSON.parse(process.env.FAKE_COMMIT || '{}')[me]) require('child_process').execFileSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qam', 'tự commit'])
const mergeRef = JSON.parse(process.env.FAKE_MERGE || '{}')[me] // the agent merges a branch into its own (S9: fixing a red branch)
if (mergeRef) require('child_process').execFileSync('git', ['-c', 'user.name=x', '-c', 'user.email=x@x', 'merge', '-q', '--no-edit', mergeRef])
if (process.env.FAKE_PROGRESS) fs.appendFileSync('progress-' + me + '.txt', 'x')
if (process.env.FAKE_SLOW_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_SLOW_MS))
out({ type: 'thread.started', thread_id: 'M' + process.pid })
out({ type: 'item.completed', item: { type: 'agent_message', text: JSON.parse(process.env.FAKE_REPLY || '{}')[me] || 'xong' } })
out({ type: 'turn.completed', usage: { input_tokens: Number(process.env.FAKE_IN || 1), output_tokens: 1 } })
`, { mode: 0o755 })
  // fake claude: denies Bash(npm test) unless granted via --allowedTools or full; FAKE_CLAUDE=emptydeny|emptynodeny for the retry rules
  const claudeLog = path.join(mbin, 'claude-args')
  fs.writeFileSync(path.join(mbin, 'claude'), `#!${process.execPath}
const fs = require('fs'), argv = process.argv.slice(2), mode = process.env.FAKE_CLAUDE || ''
if (argv[argv.indexOf('-p') + 1].startsWith('--')) argv.splice(argv.indexOf('-p') + 1, 0, fs.readFileSync(0, 'utf8')) // stdin prompt, logged where argv had it
const p = argv[argv.indexOf('-p') + 1]
fs.appendFileSync(${JSON.stringify(claudeLog)}, JSON.stringify(argv) + '\\n')
const out = o => process.stdout.write(JSON.stringify(o) + '\\n'), i = argv.indexOf('--allowedTools')
const granted = (i >= 0 && argv.slice(i + 1).includes('Bash(npm test)')) || argv.includes('bypassPermissions')
const retry = p.includes('Bạn chưa gửi tin trả lời'), deny = !granted && !retry && mode !== 'emptynodeny'
const denials = deny ? [{ tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'npm test' } },
  { tool_name: 'Bash', tool_input: { command: 'npm test && rm -rf /' } }, { tool_name: '<b>x</b> @dev-a', tool_input: {} }] : []
const customReply = JSON.parse(process.env.FAKE_REPLY || '{}')['dev-r']
const text = customReply !== undefined ? customReply : (granted ? 'đã chạy npm test' : retry ? 'đã trả lời' : mode.startsWith('empty') ? '' : 'bị chặn')
out({ type: 'system', subtype: 'init', session_id: 'C' + process.pid })
out({ type: 'assistant', message: { id: 'M' + process.pid, content: [{ type: 'text', text: text || '' }], usage: { input_tokens: Number(process.env.FAKE_IN || 1) } } })
out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'C' + process.pid,
  usage: { input_tokens: Number(process.env.FAKE_IN || 1), output_tokens: 1 }, total_cost_usd: 0.001, permission_denials: denials })
`, { mode: 0o755 })
  process.env.PATH = mbin + path.delimiter + process.env.PATH

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-git-'))), at = f => path.join(root, f)
  core.init(root)
  fs.writeFileSync(at('.chat/agents.json'), JSON.stringify(['dev-a', 'dev-b', 'dev-c', 'dev-r'].map(name =>
    ({ name, cli: name === 'dev-r' ? 'claude' : 'codex', role: 'Dev', owns: name === 'dev-r' ? ['*.txt'] : ['*.txt', 'package.json'], resume: name === 'dev-r', allowedCommands: ['npm run check'],
      ...(name === 'dev-r' ? { sessionTokenLimit: 100 } : {}) }))))
  fs.writeFileSync(at('a.txt'), Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'))
  fs.writeFileSync(at('package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { check: 'node chk.js' } }))
  fs.writeFileSync(at('chk.js'), 'if (process.env.CHECK_SLOW_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.CHECK_SLOW_MS))\n'
    + 'if (require("fs").readFileSync("a.txt", "utf8").includes("RED")) { console.error("check đỏ"); process.exit(1) }')
  fs.writeFileSync(at('.gitignore'), '.chat/\nnode_modules/\n'); fs.mkdirSync(at('node_modules')); fs.writeFileSync(at('node_modules/.keep'), '')
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=QA', '-c', 'user.email=qa@local', ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main'); git('add', 'a.txt', 'package.json', 'chk.js', '.gitignore'); git('commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify([root]))

  require('./main'); await new Promise(r => setImmediate(r))
  core.trustConfig(root, core.configTrust(root).texts) // the fixture team is the user's own: pin it as accepted
  const ev = { sender: webContents, senderFrame: mainFrame }, call = (name, ...args) => handlers[name](ev, ...args)
  await call('open', root)
  assert.strictEqual(await call('theme', 'dark'), 'dark') // theme: only the three sources, kept in userData
  assert.throws(() => call('theme', 'red'))
  assert.deepStrictEqual([await call('theme'), JSON.parse(fs.readFileSync(path.join(userData, 'theme.json'), 'utf8'))], ['dark', 'dark'])
  const log = () => { try { return fs.readFileSync(at('.chat/log.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) } catch { return [] } } // sync, for polling
  const registryFile = path.join(userData, 'worktrees', require('crypto').createHash('sha256').update(root).digest('hex'), 'registry.chat.json')
  const queue = () => { try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')).queue } catch { return [] } }
  const waitFor = async (what, test, ms = 60000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 50))) { const v = test(); if (v) return v }
    throw new Error(`Hết giờ chờ: ${what}\n` + log().slice(-8).map(m => `[${m.from}] ${m.text}`).join('\n'))
  }
  const turns = from => log().slice(from).filter(m => /^dev-/.test(m.from)).length
  const stops = () => log().map((m, seq) => ({ ...m, seq })).filter(m => m.kind === 'chain-stop')
  const pingPong = JSON.stringify({ 'dev-a': '@dev-b tiếp', 'dev-b': '@dev-a tiếp' })

  // S7 K1/K2/K4 through executeJob: handoff saved by the app and stripped from chat, @ inside it not routed,
  // turn > limit → next turn opens a new session with one system note; sessions IPC shows the measurement
  const F = '`'.repeat(3)
  process.env.FAKE_REPLY = JSON.stringify({ 'dev-r': `Xong.\n${F}handoff\n- đang làm K\n- nhờ @dev-a sau\n- còn UI\n${F}` })
  process.env.FAKE_IN = '500'
  let mark = log().length; await call('send', root, '@dev-r làm')
  const reply = await waitFor('trả lời dev-r', () => log().slice(mark).find(m => m.from === 'dev-r'))
  assert.strictEqual(reply.text, 'Xong.')
  assert.ok(fs.readFileSync(at('.chat/handoff/dev-r.md'), 'utf8').includes('- nhờ @dev-a sau'))
  let sm = await call('sessions', root)
  assert.deepStrictEqual([sm['dev-r'].lastTurn.inputTokens, sm['dev-r'].lastTurn.contextInputTokens, sm['dev-r'].sessionTokenLimit, sm['dev-r'].rotationPending], [500, 500, 100, true])
  process.env.FAKE_IN = '1'; mark = log().length; await call('send', root, '@dev-r tiếp')
  const rotated = await waitFor('tin xoay phiên', () => log().slice(mark).find(m => m.kind === 'session-rotated'))
  assert.ok(rotated.text.includes('dev-r mở phiên mới') && rotated.text.includes('vượt ngưỡng 100'), rotated.text)
  await waitFor('trả lời dev-r lần 2', () => log().slice(mark).some(m => m.from === 'dev-r'))
  sm = await call('sessions', root); assert.deepStrictEqual([sm['dev-r'].lastTurn.inputTokens, sm['dev-r'].lastTurn.contextInputTokens, sm['dev-r'].rotationPending], [1, 1, false])
  assert.ok(!log().some(m => m.from === 'dev-a')) // "@dev-a" inside the handoff never routed
  delete process.env.FAKE_REPLY; delete process.env.FAKE_IN

  // taking a message back: a turn only it asked for stops (here one waiting for dev-a's lock); a waiting turn that another
  // message also asked for still runs; only the user's own messages, once each
  process.env.FAKE_SLOW_MS = '1500'
  mark = log().length
  for (const text of ['@dev-a giữ khoá', '@dev-b việc 1', '@dev-c việc 2', '@dev-c việc 3']) await call('send', root, text)
  const seqOf = text => log().findIndex(m => m.from === 'user' && m.text === text)
  assert.deepStrictEqual(await call('retract', root, seqOf('@dev-b việc 1')), { ok: true, text: '@dev-b việc 1' })
  assert.ok((await call('retract', root, seqOf('@dev-c việc 2'))).ok)
  await waitFor('dev-b dừng khi chờ', () => log().slice(mark).some(m => m.text === '@dev-b đã bị dừng khi chờ'))
  await waitFor('dev-c vẫn chạy', () => log().slice(mark).some(m => m.from === 'dev-c'))
  assert.ok(log().slice(mark).some(m => m.from === 'dev-a') && !log().slice(mark).some(m => m.from === 'dev-b'))
  assert.strictEqual((await call('retract', root, seqOf('@dev-b việc 1'))).error.code, 'CONFLICT')
  assert.strictEqual((await call('retract', root, log().findIndex(m => m.from === 'dev-a'))).error.code, 'INVALID_ARGUMENT')
  delete process.env.FAKE_SLOW_MS

  // S8 P: saveTeam envelope + revision, native confirm for Toàn quyền, denial → pending → grant → exactly one retry
  const cArgs = () => fs.existsSync(claudeLog) ? fs.readFileSync(claudeLog, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  const agentsRaw = () => fs.readFileSync(at('.chat/agents.json'), 'utf8'), rev = () => core.teamRevision(root)
  const save = (members, expectedRevision = rev()) => call('saveTeam', root, members, { expectedRevision })
  const DEF = { mode: 'edit', allowTools: ['WebFetch'], networkAccess: false } // inactive custom rule must never be enabled by a grant
  const devp = { name: 'dev-p', cli: 'claude', role: 'Dev', owns: ['*.txt'], resume: true, allowedCommands: ['npm run check'], permissions: DEF }
  let res = await save([...core.team(root), devp], 'stale'); assert.strictEqual(res.error?.code, 'CONFLICT')
  res = await save([...core.team(root), devp]); assert.ok(res.ok && typeof res.revision === 'string' && Array.isArray(res.team), JSON.stringify(res))
  assert.strictEqual(res.revision, rev()); assert.strictEqual(dialogs, 0)
  const withP = permissions => core.team(root).map(a => a.name === 'dev-p' ? { ...a, permissions } : a)
  let raw = agentsRaw(); dialogAnswer = 0
  res = await save(withP({ ...DEF, mode: 'full' })); assert.deepStrictEqual([res.error?.code, dialogs, agentsRaw() === raw], ['CANCELLED', 1, true])
  dialogAnswer = 1; res = await save(withP({ ...DEF, mode: 'full' }))
  assert.deepStrictEqual([res.ok, dialogs, core.team(root).find(a => a.name === 'dev-p').permissions.mode], [true, 2, 'full'])
  // summary-style run (trackSession:false) never inherits full; empty + denial → no empty retry, empty without denial → one retry
  const pFull = core.team(root).find(a => a.name === 'dev-p'), nClaude = () => cArgs().length
  let n0 = nClaude(), r0 = await core.run(root, pFull, { trackSession: false, initialPrompt: 'tóm tắt' })
  assert.ok(cArgs().at(-1).includes('acceptEdits') && !cArgs().at(-1).includes('bypassPermissions'), cArgs().at(-1).join(' '))
  process.env.FAKE_CLAUDE = 'emptydeny'; n0 = nClaude(); r0 = await core.run(root, pFull, { trackSession: false, initialPrompt: 'x' })
  assert.deepStrictEqual([nClaude() - n0, r0.outcome, r0.permissionDenials.some(x => x.rule === 'Bash(npm test)')], [1, 'success', true])
  process.env.FAKE_CLAUDE = 'emptynodeny'; n0 = nClaude(); r0 = await core.run(root, pFull, { trackSession: false, initialPrompt: 'x' })
  assert.deepStrictEqual([nClaude() - n0, r0.text], [2, 'đã trả lời']); delete process.env.FAKE_CLAUDE
  res = await save(core.team(root).map(a => a.name === 'dev-p' ? { ...a, avatar: { ...a.avatar, gender: a.avatar.gender === 'male' ? 'female' : 'male' } } : a))
  assert.deepStrictEqual([res.ok, dialogs], [true, 2]) // editing a full agent's avatar does not ask again
  res = await save(withP(DEF)); assert.deepStrictEqual([res.ok, dialogs], [true, 2]) // turning full off does not ask

  const draftRevision = rev(); n0 = nClaude(); sent.length = 0
  mark = log().length; await call('send', root, '@dev-p chạy npm test')
  const denied = await waitFor('tin bị từ chối quyền', () => log().slice(mark).find(m => m.kind === 'permission-denied'))
  assert.ok(denied.permissionRequestId && !JSON.stringify(denied).includes('rm -rf /"}'), JSON.stringify(denied)) // no raw tool_input kept
  const grantable = denied.denials.filter(x => x.canGrant)
  assert.deepStrictEqual(grantable.map(x => x.rule), ['Bash(npm test)']) // compound command and unknown tool never grantable
  const pReq = await waitFor('permissions-changed', () => sent.filter(e => e[0] === 'permissions-changed' && e[1] === root).at(-1)?.[2].requests[0])
  assert.deepStrictEqual([pReq.id, pReq.agent, pReq.denials.length], [denied.permissionRequestId, 'dev-p', denied.denials.length])
  for (const bad of [{ requestId: 'nope', denialId: grantable[0].id }, { requestId: pReq.id, denialId: grantable[0].id, extra: 1 }, 'x'])
    assert.strictEqual((await call('grantPermissionAndRetry', root, bad)).ok, false, JSON.stringify(bad))
  const blocked = denied.denials.find(x => !x.canGrant)
  assert.strictEqual((await call('grantPermissionAndRetry', root, { requestId: pReq.id, denialId: blocked.id })).error?.code, 'UNSUPPORTED')
  const grants = await Promise.all([1, 2].map(() => call('grantPermissionAndRetry', root, { requestId: pReq.id, denialId: grantable[0].id })))
  assert.strictEqual(grants.filter(g => g.ok).length, 1, JSON.stringify(grants)) // double click → one job
  const granted = grants.find(g => g.ok); assert.ok(granted.runId && granted.teamRevision === rev())
  assert.deepStrictEqual(core.team(root).find(a => a.name === 'dev-p').permissions, { mode: 'custom', allowTools: ['Bash(npm test)'], networkAccess: false })
  await waitFor('dev-p chạy lại', () => log().slice(mark).some(m => m.from === 'dev-p' && m.text === 'đã chạy npm test'))
  await new Promise(r => setTimeout(r, 300))
  assert.strictEqual(nClaude() - n0, 2) // the denied turn + exactly one retry, no automatic loop
  const retryArgs = cArgs().at(-1), retryPrompt = retryArgs[retryArgs.indexOf('-p') + 1]
  assert.deepStrictEqual(retryArgs.slice(retryArgs.indexOf('--allowedTools') + 1, retryArgs.indexOf('--allowedTools') + 3), ['Bash(npm run check)', 'Bash(npm test)'])
  assert.ok(retryPrompt.includes('chạy npm test') && retryPrompt.includes('Bash(npm test)'), 'prompt chạy lại thiếu yêu cầu cũ hoặc quyền vừa cấp')
  assert.ok(!log().slice(mark).some(m => m.from === 'dev-a')) // "@dev-a" in a denial label never routed
  assert.ok(sent.some(e => e[0] === 'team-changed' && e[1] === root && e[2].revision === rev()))
  res = await save(core.team(root), draftRevision); assert.strictEqual(res.error?.code, 'CONFLICT') // stale ⚙ draft can't undo the grant
  assert.strictEqual((await call('grantPermissionAndRetry', root, { requestId: pReq.id, denialId: grantable[0].id })).error?.code, 'EXPIRED')

  // J3: two agents ping-pong without file/task changes → stopped after 3 rounds; "Tiếp tục" starts a fresh chain
  process.env.FAKE_REPLY = pingPong
  mark = log().length; await call('send', root, '@dev-a bắt đầu')
  let stop = await waitFor('phanh chat qua lại', () => stops()[0])
  assert.ok(stop.canContinue && stop.text.includes('qua lại'), stop.text); assert.strictEqual(turns(mark), 6)
  mark = log().length; assert.ok((await call('continueChain', root, { messageId: stop.seq })).ok)
  stop = await waitFor('phanh lần 2 sau Tiếp tục', () => stops()[1]); assert.strictEqual(turns(mark), 6)
  assert.strictEqual((await call('continueChain', root, { messageId: stops()[0].seq })).ok, false) // one continue per stop

  // J1/J2: a chain that makes progress runs all 12 (default) turns — 8 valid turns are never cut
  process.env.FAKE_PROGRESS = '1'; mark = log().length; await call('send', root, '@dev-a làm')
  stop = await waitFor('giới hạn 12 lượt', () => stops()[2])
  assert.ok(stop.text.includes('12 lượt'), stop.text); assert.strictEqual(turns(mark), 12)
  delete process.env.FAKE_PROGRESS; delete process.env.FAKE_REPLY
  for (const f of fs.readdirSync(root)) if (f.startsWith('progress-')) fs.rmSync(at(f))

  // H: enable worktrees (repo clean), every agent works in its own branch; merges go through `npm run check`
  const cfg = await call('projectSettings', root)
  let on // the last chain turn may still be releasing its job → BUSY for a moment
  for (let i = 0; i < 100 && (!on || on.error?.code === 'BUSY'); i++) {
    if (on) await new Promise(r => setTimeout(r, 50))
    on = await call('saveProjectSettings', root, { settings: { ...cfg.settings, worktreesEnabled: true }, expectedRevision: cfg.revision })
  }
  assert.ok(on.ok, JSON.stringify(on.error))
  const enabledAt = git('rev-parse', 'HEAD').trim(), mergeCommits = () => git('log', '--merges', '--format=%h %s', `${enabledAt}..main`)
  const lines = () => fs.readFileSync(at('a.txt'), 'utf8').split('\n'), clean = () => assert.strictEqual(git('status', '--porcelain'), '')
  const done = e => !['queued', 'merging', 'checking', 'publishing'].includes(e.state)
  let q0 = 0, entries
  const settle = async (count, what) => {
    const from = q0; await waitFor(what, () => queue().length >= from + count && queue().every(done)); q0 += count; return queue().slice(from)
  }
  const edit = (edits, text) => { process.env.FAKE_EDITS = JSON.stringify(edits); return call('send', root, text) }

  // dirty main folder → merge stops and tells the agent; after cleaning, "retry" merges
  fs.writeFileSync(at('dirty.tmp'), 'x')
  await edit({ 'dev-a': [['a.txt', 0, 'A0']] }, '@dev-a sửa dòng 0')
  entries = await settle(1, 'merge dev-a (thư mục bẩn)')
  assert.deepStrictEqual(entries.map(e => [e.agent, e.state]), [['dev-a', 'blocked-dirty']])
  await waitFor('tin báo chưa gộp', () => log().some(m => m.from === 'system' && m.text.startsWith('@dev-a chưa gộp được nhánh')))
  assert.strictEqual(lines()[0], 'l0')
  // A file:// link from an agent's unmerged worktree must show that tree, including old replies without workspace metadata.
  const linkedWorkspace = JSON.parse(fs.readFileSync(registryFile, 'utf8')).agents.find(a => a.agent === 'dev-a')
  const toURL = require('url').pathToFileURL
  let viewed = await call('readProjectFile', root, toURL(path.join(linkedWorkspace.path, 'a.txt')).href)
  assert.ok(viewed.ok, JSON.stringify(viewed))
  assert.deepStrictEqual([viewed.file.content.split('\n')[0], viewed.workspace.id], ['A0', linkedWorkspace.id])
  viewed = await call('readProjectFile', root, viewed.file.path, null, viewed.workspace.id)
  assert.strictEqual(viewed.file.content.split('\n')[0], 'A0', 'reload must keep the inferred worktree')
  viewed = await call('readProjectFile', root, toURL(at('a.txt')).href, 'missing.md', linkedWorkspace.id)
  assert.deepStrictEqual([viewed.file.content.split('\n')[0], viewed.workspace], ['l0', null], 'absolute main link overrides the reply workspace')
  viewed = await call('readProjectFile', root, toURL(path.join(linkedWorkspace.path, '.chat/memory.md')).href)
  assert.deepStrictEqual([viewed.ok, viewed.workspace, viewed.file.path], [true, null, '.chat/memory.md'])
  const linkedSource = path.join(linkedWorkspace.path, 'việt #%.html')
  fs.writeFileSync(linkedSource, '<script>source</script>')
  try {
    viewed = await call('readProjectFile', root, toURL(linkedSource).href)
    assert.deepStrictEqual([viewed.file.format, viewed.file.content], ['text', '<script>source</script>'])
    const href = viewed.file.path.split('/').map(encodeURIComponent).join('/')
    assert.strictEqual((await call('readProjectFile', root, href, null, viewed.workspace.id)).file.content, viewed.file.content)
  } finally { fs.unlinkSync(linkedSource) }
  const siblingWorkspace = linkedWorkspace.path + '-other'
  fs.mkdirSync(siblingWorkspace); fs.writeFileSync(path.join(siblingWorkspace, 'secret.txt'), 'outside')
  try {
    viewed = await call('readProjectFile', root, toURL(path.join(siblingWorkspace, 'secret.txt')).href, null, linkedWorkspace.id)
    assert.strictEqual(viewed.code, 'OUTSIDE_PROJECT')
  } finally { fs.rmSync(siblingWorkspace, { recursive: true, force: true }) }
  // T41 (QA, independent review): no way out of the project or the registered agent worktrees through main's IPC
  {
    const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-outside-'))), secret = path.join(outsideDir, 'secret.txt')
    fs.writeFileSync(secret, 'BÍ MẬT')
    const wt = linkedWorkspace.path, integrationDir = path.join(path.dirname(path.dirname(wt)), 'integration', require('crypto').randomUUID())
    fs.symlinkSync(secret, path.join(wt, 'leak.txt')); fs.symlinkSync(outsideDir, path.join(wt, 'leakdir'))
    fs.symlinkSync(secret, at('leak-root.txt'))
    fs.mkdirSync(integrationDir, { recursive: true }); fs.writeFileSync(path.join(integrationDir, 'a.txt'), 'BÍ MẬT')
    const rel = path.relative(root, secret), wtRel = path.relative(wt, secret)
    const attempts = [
      ['file://' + root + '/../' + path.basename(outsideDir) + '/secret.txt'], [root + '/reports/../../' + path.basename(outsideDir) + '/secret.txt'],
      ['file://' + root + '/reports/%2e%2e/%2e%2e/' + path.basename(outsideDir) + '/secret.txt'], [toURL(secret).href], [secret],
      ['file://localhost' + secret], ['file://evil.example' + at('a.txt')], [toURL(path.join(wt, 'leak.txt')).href], [toURL(path.join(wt, 'leakdir', 'secret.txt')).href],
      [toURL(at('leak-root.txt')).href], ['leak-root.txt'], [toURL(path.join(integrationDir, 'a.txt')).href], [toURL(path.join(wt, '.chat', '..', '..', path.basename(outsideDir), 'secret.txt')).href],
      [rel], [wtRel, null, linkedWorkspace.id], ['leak.txt', null, linkedWorkspace.id], ['leakdir/secret.txt', null, linkedWorkspace.id],
      ['secret.txt', path.relative(wt, path.join(outsideDir, 'x.md')), linkedWorkspace.id], ['a.txt', null, '00000000-0000-0000-0000-000000000000'], ['a.txt', null, '../../x']]
    for (const [href, from = null, ws] of attempts) {
      let res
      try { res = await call('readProjectFile', root, href, from, ws) } catch (e) { res = { ok: false, code: e.code || 'THROW' } }
      assert.ok(!res.ok && !JSON.stringify(res).includes('BÍ MẬT'), `T41: đọc được ngoài dự án: ${href} ${from} ${ws} → ${JSON.stringify(res).slice(0, 200)}`)
    }
    for (const href of [toURL(secret).href, toURL(path.join(wt, 'leak.txt')).href, 'file://' + root + '/reports/%2e%2e/%2e%2e/' + path.basename(outsideDir) + '/secret.txt'])
      await assert.rejects(Promise.resolve().then(() => call('openFile', root, href)), undefined, `T41: mở ngoài bằng app khác: ${href}`)
    for (const href of [toURL(secret).href, toURL(path.join(wt, 'leak.txt')).href]) {
      let res; try { res = await call('readImage', root, href, null, null) } catch (e) { res = { ok: false } }
      assert.ok(!res?.ok, `T41: readImage ngoài dự án: ${href}`)
    }
    assert.ok((await call('readProjectFile', root, 'file://localhost' + at('a.txt'))).ok) // localhost host is the same machine
    fs.rmSync(path.join(wt, 'leak.txt')); fs.rmSync(path.join(wt, 'leakdir')); fs.rmSync(at('leak-root.txt'))
    fs.rmSync(integrationDir, { recursive: true, force: true }); fs.rmSync(outsideDir, { recursive: true, force: true })
    console.log('ok (T41 file scope)')
  }
  // Sprint 10 BE: senderFrame validation, readImage with workspace, HTML preview lifecycle, protocol handling, openHtmlExternal
  {
    // 1. senderFrame validation
    await assert.rejects(handlers['readProjectFile']({ sender: webContents, senderFrame: { id: 2 } }, root, 'a.txt'), /Nguồn IPC không hợp lệ/)
    await assert.rejects(handlers['createHtmlPreview']({ sender: webContents, senderFrame: { id: 2 } }, root, 'page.html'), /Nguồn IPC không hợp lệ/)
    await assert.rejects(handlers['openHtmlExternal']({ sender: webContents, senderFrame: { id: 2 } }, root, 'page.html'), /Nguồn IPC không hợp lệ/)
    await assert.rejects(handlers['readImage']({ sender: webContents, senderFrame: { id: 2 } }, root, 'test.png'), /Nguồn IPC không hợp lệ/)
    await assert.rejects(handlers['readProjectFile']({ sender: {}, senderFrame: mainFrame }, root, 'a.txt'), /Nguồn IPC không hợp lệ/)

    // 2. readImage with workspace routing
    const pngSample = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
    fs.writeFileSync(at('test.png'), pngSample)
    const imgRoot = await call('readImage', root, 'test.png')
    assert.strictEqual(imgRoot.ok, true)
    assert.strictEqual(imgRoot.mime, 'image/png')
    assert.strictEqual(imgRoot.workspace, null)
    assert.strictEqual(typeof imgRoot.canOpenExternal, 'boolean')

    const wt = linkedWorkspace.path
    const svgStr = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    fs.writeFileSync(path.join(wt, 'test-wt.svg'), svgStr)
    const imgWt = await call('readImage', root, 'test-wt.svg', null, linkedWorkspace.id)
    assert.strictEqual(imgWt.ok, true)
    assert.strictEqual(imgWt.mime, 'image/svg+xml')
    assert.strictEqual(imgWt.canOpenExternal, false)
    assert.deepStrictEqual(imgWt.workspace, { id: linkedWorkspace.id, branch: linkedWorkspace.branch })

    fs.writeFileSync(at('fake.png'), svgStr)
    const imgFake = await call('readImage', root, 'fake.png')
    assert.strictEqual(imgFake.ok, false)
    assert.strictEqual(imgFake.code, 'UNSUPPORTED')

    // 3. createHtmlPreview
    const htmlStr = '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1><img src="test.png"></body></html>'
    fs.writeFileSync(at('page.html'), htmlStr)
    fs.writeFileSync(at('style.css'), 'h1 { color: red; }')
    const previewRes = await call('createHtmlPreview', root, 'page.html')
    assert.strictEqual(previewRes.ok, true)
    assert.strictEqual(previewRes.file.path, 'page.html')
    assert.strictEqual(previewRes.file.format, 'text')
    assert.strictEqual(previewRes.file.content, htmlStr)
    assert.strictEqual(previewRes.workspace, null)
    assert.ok(previewRes.preview.id)
    assert.strictEqual(previewRes.preview.url, 'agent-preview://' + previewRes.preview.id + '/files/page.html')

    const nonHtmlRes = await call('createHtmlPreview', root, 'a.txt')
    assert.strictEqual(nonHtmlRes.ok, false)
    assert.strictEqual(nonHtmlRes.code, 'UNSUPPORTED')

    const notFoundRes = await call('createHtmlPreview', root, 'nonexistent.html')
    assert.strictEqual(notFoundRes.ok, false)
    assert.strictEqual(notFoundRes.code, 'NOT_FOUND')

    // 4. Protocol handler
    const entryReq = new Request(previewRes.preview.url, { method: 'GET' })
    const entryResp = await protocolHandlers['agent-preview'](entryReq)
    assert.strictEqual(entryResp.status, 200)
    assert.strictEqual(entryResp.headers.get('Content-Type'), 'text/html; charset=utf-8')
    assert.ok(entryResp.headers.get('Content-Security-Policy').includes('agent-preview://' + previewRes.preview.id))
    assert.ok(entryResp.headers.get('Content-Security-Policy').includes('sandbox'))
    assert.strictEqual(entryResp.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.strictEqual(await entryResp.text(), htmlStr)

    const postReq = new Request(previewRes.preview.url, { method: 'POST' })
    const postResp = await protocolHandlers['agent-preview'](postReq)
    assert.strictEqual(postResp.status, 405)

    const cssUrl = 'agent-preview://' + previewRes.preview.id + '/files/style.css'
    const cssReq = new Request(cssUrl, { method: 'GET' })
    const cssResp = await protocolHandlers['agent-preview'](cssReq)
    assert.strictEqual(cssResp.status, 200)
    assert.strictEqual(cssResp.headers.get('Content-Type'), 'text/css; charset=utf-8')
    assert.strictEqual(await cssResp.text(), 'h1 { color: red; }')

    const imgAssetUrl = 'agent-preview://' + previewRes.preview.id + '/files/test.png'
    const imgAssetResp = await protocolHandlers['agent-preview'](new Request(imgAssetUrl, { method: 'GET' }))
    assert.strictEqual(imgAssetResp.status, 200)
    assert.strictEqual(imgAssetResp.headers.get('Content-Type'), 'image/png')

    fs.writeFileSync(at('script.js'), 'console.log(1)')
    const jsUrl = 'agent-preview://' + previewRes.preview.id + '/files/script.js'
    const jsResp = await protocolHandlers['agent-preview'](new Request(jsUrl, { method: 'GET' }))
    assert.strictEqual(jsResp.status, 415)

    const badUrls = [
      'agent-preview://' + previewRes.preview.id + '/files/../secret.txt',
      'agent-preview://' + previewRes.preview.id + '/files/%2e%2e/secret.txt',
      'agent-preview://' + previewRes.preview.id + '/files/a%2fb.css',
      'agent-preview://' + previewRes.preview.id + '/files/sub\\style.css'
    ]
    for (const badUrl of badUrls) {
      const badResp = await protocolHandlers['agent-preview'](new Request(badUrl, { method: 'GET' }))
      assert.ok(badResp.status >= 400, 'traversal phải bị từ chối: ' + badUrl)
    }

    // 5. webRequest filter
    let allowedCss = false
    webRequestCallback({ url: cssUrl, method: 'GET', resourceType: 'stylesheet', frame: { id: 2 } }, res => { allowedCss = !res.cancel })
    assert.strictEqual(allowedCss, true)

    let blockedExt = false
    webRequestCallback({ url: 'https://evil.example/font.woff', method: 'GET', resourceType: 'font', frame: { id: 2 } }, res => { blockedExt = res.cancel })
    assert.strictEqual(blockedExt, true)

    let blockedScript = false
    webRequestCallback({ url: jsUrl, method: 'GET', resourceType: 'script', frame: { id: 2 } }, res => { blockedScript = res.cancel })
    assert.strictEqual(blockedScript, true)

    // 6. Esc key notification
    sent.length = 0
    webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' })
    assert.ok(sent.some(([channel, id]) => channel === 'html-preview-escape' && id === previewRes.preview.id))

    // 7. closeHtmlPreview
    const closeRes = await call('closeHtmlPreview', previewRes.preview.id)
    assert.strictEqual(closeRes.ok, true)
    const deadResp = await protocolHandlers['agent-preview'](new Request(previewRes.preview.url, { method: 'GET' }))
    assert.strictEqual(deadResp.status, 404)

    // 8. openHtmlExternal
    const badOpen = await call('openHtmlExternal', root, 'a.txt')
    assert.strictEqual(badOpen.ok, false)
    assert.strictEqual(badOpen.code, 'UNSUPPORTED')

    dialogAnswer = 0
    const cancelOpen = await call('openHtmlExternal', root, 'page.html')
    assert.strictEqual(cancelOpen.ok, true)
    assert.strictEqual(cancelOpen.opened, false)

    dialogAnswer = 1
    const okOpen = await call('openHtmlExternal', root, 'page.html')
    assert.strictEqual(okOpen.ok, true)
    assert.strictEqual(okOpen.opened, true)

    await assert.rejects(call('openFile', root, 'page.html'))
    await assert.rejects(call('openFile', root, 'test-wt.svg', null, linkedWorkspace.id))

    fs.unlinkSync(at('test.png'))
    fs.unlinkSync(path.join(wt, 'test-wt.svg'))
    fs.unlinkSync(at('fake.png'))
    fs.unlinkSync(at('page.html'))
    fs.unlinkSync(at('style.css'))
    fs.unlinkSync(at('script.js'))
    console.log('ok (sprint 10 BE IPC & protocol)')
  }
  // T45 (QA, independent): V2/V3 hold the T41 read scope, caps hold under parallel requests, old tokens die, the gates fail closed
  {
    const handle = req => protocolHandlers['agent-preview'](new Request(req, { method: 'GET' }))
    const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-s10-'))), wt = linkedWorkspace.path
    const png = n => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)])
    fs.writeFileSync(path.join(outsideDir, 'x.html'), '<p>BÍ MẬT</p>'); fs.writeFileSync(path.join(outsideDir, 'x.css'), 'p{}/*BÍ MẬT*/')
    fs.writeFileSync(path.join(outsideDir, 'x.png'), png(16))
    fs.symlinkSync(path.join(outsideDir, 'x.html'), at('leak.html')); fs.symlinkSync(path.join(outsideDir, 'x.html'), path.join(wt, 'leak.html'))
    fs.symlinkSync(path.join(outsideDir, 'x.css'), at('leak.css')); fs.symlinkSync(path.join(outsideDir, 'x.png'), at('leak.png'))
    const integrationDir = path.join(path.dirname(path.dirname(wt)), 'integration', require('crypto').randomUUID())
    fs.mkdirSync(integrationDir, { recursive: true }); fs.writeFileSync(path.join(integrationDir, 'x.html'), '<p>BÍ MẬT</p>')
    const toURL = require('url').pathToFileURL
    // the T41 attempts, through the two new readers
    for (const [href, from = null, ws] of [[toURL(path.join(outsideDir, 'x.html')).href], [root + '/../' + path.basename(outsideDir) + '/x.html'],
      ['file://' + root + '/%2e%2e/' + path.basename(outsideDir) + '/x.html'], ['leak.html'], [toURL(path.join(wt, 'leak.html')).href], ['leak.html', null, linkedWorkspace.id],
      [toURL(path.join(integrationDir, 'x.html')).href], ['x.html', path.relative(root, path.join(outsideDir, 'y.md'))], ['page.html', null, '00000000-0000-0000-0000-000000000000'],
      ['file://evil.example' + at('page.html')]]) {
      let res; try { res = await call('createHtmlPreview', root, href, from, ws) } catch (e) { res = { ok: false, threw: e.message } }
      assert.ok(!res.ok && !JSON.stringify(res).includes('BÍ MẬT'), `T45: xem trước HTML ngoài phạm vi: ${href} → ${JSON.stringify(res).slice(0, 160)}`)
    }
    for (const href of [toURL(path.join(outsideDir, 'x.png')).href, 'leak.png', '../' + path.basename(outsideDir) + '/x.png']) {
      let res; try { res = await call('readImage', root, href) } catch (e) { res = { ok: false } }
      assert.ok(!res.ok, `T45: readImage ngoài phạm vi: ${href}`)
    }
    // assets: symlink out, second HTML, script, json/font, encoded separators; then old token after a new preview
    fs.writeFileSync(at('qa.html'), '<link rel=stylesheet href="leak.css">'); fs.writeFileSync(at('two.html'), '<p>2</p>'); fs.writeFileSync(at('d.json'), '{}')
    let pv = await call('createHtmlPreview', root, 'qa.html'); assert.ok(pv.ok, JSON.stringify(pv))
    const u = rel => `agent-preview://${pv.preview.id}/files/${rel}`
    for (const rel of ['leak.css', 'leak.png', 'two.html', 'd.json', 'x.woff', '.git/config', '%2e%2e/a.txt', 'a%5cb.css', '%252e%252e/a.css']) {
      const r = await handle(u(rel)); const body = await r.text()
      assert.ok(r.status >= 400 && !body.includes('BÍ MẬT') && !body.includes('<p>2</p>'), `T45: asset ${rel} → ${r.status}`)
    }
    const first = pv.preview
    const pv2 = await call('createHtmlPreview', root, 'two.html'); assert.ok(pv2.ok)
    assert.strictEqual((await handle(first.url)).status, 404, 'T45: token cũ vẫn phục vụ sau khi mở preview mới')
    assert.deepStrictEqual(await call('closeHtmlPreview', first.id), { ok: true })
    assert.strictEqual((await handle(pv2.preview.url)).status, 200, 'đóng nhầm id cũ không được đóng preview hiện tại')
    // navigation gate: the first load of the entry only, nothing else, never again
    const nav = (url, isMainFrame = false) => { let prevented = false; webContents.emit('will-frame-navigate', { url, isMainFrame, preventDefault: () => { prevented = true } }); return prevented }
    assert.deepStrictEqual([nav(pv2.preview.url), nav(pv2.preview.url), nav('https://evil.example/'), nav('javascript:alert(1)'), nav(pv2.preview.url.replace('two.html', 'qa.html'))],
      [false, true, true, true, true], 'T45: chặn điều hướng iframe sau lần nạp đầu')
    // request gate: fail closed for unknown frames, other webContents, other methods/types/schemes
    const gate = d => { let out; webRequestCallback({ method: 'GET', webContentsId: 1, frame: { id: 2 }, ...d }, r => { out = r.cancel }); return out }
    const css = `agent-preview://${pv2.preview.id}/files/style.css`
    assert.deepStrictEqual([gate({ url: css, resourceType: 'stylesheet' }), gate({ url: css, resourceType: 'stylesheet', method: 'POST' }),
      gate({ url: css, resourceType: 'stylesheet', webContentsId: 9 }), gate({ url: css, resourceType: 'script' }), gate({ url: css, resourceType: 'xhr' }),
      gate({ url: 'https://fonts.example/x.css', resourceType: 'stylesheet' }), gate({ url: 'http://127.0.0.1:9/x.png', resourceType: 'image' }),
      gate({ url: css.replace(pv2.preview.id, first.id), resourceType: 'stylesheet' }), gate({ url: pv2.preview.url.replace('two.html', 'qa.html'), resourceType: 'subFrame' }),
      gate({ url: 'https://evil.example/', resourceType: 'subFrame', frame: mainFrame }), gate({ url: css, resourceType: 'stylesheet', frame: undefined }),
      gate({ url: 'https://fonts.googleapis.com/css2', resourceType: 'stylesheet', frame: mainFrame })],
    [false, true, true, true, true, true, true, true, true, true, false, false])
    // caps: 128 distinct paths and 32 MiB per preview must hold when requests arrive together
    fs.mkdirSync(at('cap'), { recursive: true })
    for (let i = 0; i < 200; i++) fs.writeFileSync(at(`cap/${i}.png`), png(16))
    for (let i = 0; i < 5; i++) fs.writeFileSync(at(`cap/big${i}.png`), png(8 * 1024 * 1024))
    pv = await call('createHtmlPreview', root, 'qa.html')
    const many = await Promise.all(Array.from({ length: 200 }, (_, i) => handle(u(`cap/${i}.png`))))
    const servedMany = many.filter(r => r.status === 200).length
    pv = await call('createHtmlPreview', root, 'qa.html')
    const big = await Promise.all(Array.from({ length: 5 }, (_, i) => handle(u(`cap/big${i}.png`))))
    const servedBig = big.filter(r => r.status === 200).length
    assert.ok(servedMany <= 127 && servedBig <= 3, `gửi cùng lúc: 200 ảnh → phục vụ ${servedMany} (trần 128 path gồm entry); 5 ảnh 8 MiB → phục vụ ${servedBig} (trần 32 MiB)`)
    // open in browser: the file confirmed in the dialog is the one opened; a symlink swapped meanwhile is refused
    fs.writeFileSync(at('a1.html'), '<p>1</p>'); fs.writeFileSync(at('a2.html'), '<p>2</p>'); fs.symlinkSync('a1.html', at('swap.html'))
    dialogAnswer = 1; openedPaths.length = 0
    onDialog = () => { fs.rmSync(at('swap.html')); fs.symlinkSync(path.join(outsideDir, 'x.html'), at('swap.html')) }
    let ext = await call('openHtmlExternal', root, 'swap.html')
    assert.ok(!ext.opened && openedPaths.length === 0, 'T45: symlink đổi ra ngoài trong lúc xác nhận vẫn được mở')
    fs.rmSync(at('swap.html')); fs.symlinkSync('a1.html', at('swap.html'))
    onDialog = () => { fs.rmSync(at('swap.html')); fs.symlinkSync('a2.html', at('swap.html')) }
    ext = await call('openHtmlExternal', root, 'swap.html'); onDialog = null; dialogAnswer = 0
    assert.ok(!ext.opened && openedPaths.length === 0, `symlink đổi sang file khác trong dự án trong lúc xác nhận → vẫn mở ${openedPaths.map(p => path.basename(p))}`)
    await call('closeHtmlPreview', pv.preview.id)
    for (const f of ['leak.html', 'leak.css', 'leak.png', 'qa.html', 'two.html', 'd.json', 'a1.html', 'a2.html', 'swap.html']) fs.rmSync(at(f), { force: true })
    fs.rmSync(path.join(wt, 'leak.html')); fs.rmSync(at('cap'), { recursive: true, force: true })
    fs.rmSync(integrationDir, { recursive: true, force: true }); fs.rmSync(outsideDir, { recursive: true, force: true })
    console.log('ok (T45 V2/V3 scope)')
  }
  fs.rmSync(at('dirty.tmp'))
  const blockedId = entries[0].id
  assert.ok((await call('retryMerge', root, { queueId: blockedId })).ok)
  assert.ok((await call('retryMerge', root, { queueId: blockedId })).ok)
  entries = await settle(1, 'thử lại merge dev-a')
  assert.strictEqual(queue().length, 2, 'repeated retry must enqueue only once')
  assert.deepStrictEqual(entries.map(e => e.state), ['merged']); assert.strictEqual(lines()[0], 'A0'); clean()
  let visible = (await call('worktreeState', root)).state.queue
  assert.strictEqual(visible.filter(e => e.canRetry || e.canRepair).length, 0, 'successful retry must retire the old error')
  // Registry from the previous app version: old error + successful retry for the same SHA.
  const legacy = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
  delete legacy.queue[0].supersededBy
  fs.writeFileSync(registryFile, JSON.stringify(legacy))
  visible = (await call('worktreeState', root)).state.queue
  const old = visible.find(e => e.id === blockedId)
  assert.strictEqual(old.state, 'merged'); assert.strictEqual(old.error, null); assert.strictEqual(old.canRetry, false)
  // Historical check-failure messages must not schedule paid repair turns once resolved.
  legacy.queue[0].state = 'check-failed'; legacy.queue[0].error = { code: 'CHECK_FAILED', message: 'old check failure' }
  for (const supersededBy of [legacy.queue[1].id, undefined]) {
    legacy.queue[0].supersededBy = supersededBy
    fs.writeFileSync(registryFile, JSON.stringify(legacy))
    const beforeRepair = log().length
    const repair = await call('requestMergeRepair', root, { queueId: blockedId })
    assert.strictEqual(repair.ok, false, 'superseded/already-merged failures must reject repair')
    assert.strictEqual(log().length, beforeRepair, 'rejected repair must not post a new agent request')
  }

  // red check → not merged, the owner is called with the log
  await edit({ 'dev-c': [['a.txt', 5, 'RED']] }, '@dev-c sửa dòng 5')
  entries = await settle(1, 'merge dev-c (check đỏ)')
  assert.deepStrictEqual(entries.map(e => [e.agent, e.state]), [['dev-c', 'check-failed']])
  assert.ok(entries[0].error.log.includes('check đỏ')); assert.strictEqual(lines()[5], 'l5'); clean()
  visible = (await call('worktreeState', root)).state.queue
  assert.ok(visible.find(e => e.id === entries[0].id).canRepair, 'unmerged check failure must remain actionable')
  await waitFor('tin báo chưa gộp', () => log().some(m => m.from === 'system' && m.text.startsWith('@dev-c chưa gộp được nhánh')))

  // two devs edit different lines of the same file in parallel → both merged automatically
  await edit({ 'dev-a': [['a.txt', 2, 'A2']], 'dev-b': [['a.txt', 8, 'B8']] }, '@dev-a @dev-b sửa a.txt')
  entries = await settle(2, 'merge song song khác dòng')
  assert.deepStrictEqual(entries.map(e => e.state), ['merged', 'merged']); assert.deepStrictEqual([lines()[2], lines()[8]], ['A2', 'B8']); clean()
  // squash: main stays linear, one commit per turn named after the agent and what it changed; idle branches move onto main
  assert.deepStrictEqual([mergeCommits(), git('log', '-2', '--format=%s').trim().split('\n').sort()], ['', ['dev-a · Sửa a.txt', 'dev-b · Sửa a.txt']])
  const branchHead = agent => execFileSync('git', ['-C', JSON.parse(fs.readFileSync(registryFile, 'utf8')).agents.find(a => a.agent === agent).path,
    'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const onMain = agent => { try { git('merge-base', '--is-ancestor', branchHead(agent), 'main'); return true } catch { return false } }
  await waitFor('nhánh agent rảnh về main sau squash', () => ['dev-a', 'dev-b'].every(onMain))

  // a slow merge check runs outside the git lock: another agent's turn still starts (send returns) and both merge
  process.env.CHECK_SLOW_MS = '4000'
  await edit({ 'dev-a': [['a.txt', 6, 'A6']] }, '@dev-a sửa dòng 6')
  await waitFor('check chậm đang chạy', () => queue().slice(q0).some(e => e.state === 'checking'))
  const sentAt = Date.now()
  await edit({ 'dev-b': [['a.txt', 9, 'B9']] }, '@dev-b sửa dòng 9') // not next to line 6: adjacent hunks conflict in git
  assert.ok(Date.now() - sentAt < 3000, 'send waited for the merge check to finish')
  delete process.env.CHECK_SLOW_MS
  entries = await settle(2, 'merge khi check chậm')
  assert.deepStrictEqual(entries.map(e => e.state), ['merged', 'merged']); assert.deepStrictEqual([lines()[6], lines()[9]], ['A6', 'B9']); clean()

  // same line → the first merges, the second gets a conflict message naming the file
  await edit({ 'dev-a': [['a.txt', 4, 'A4']], 'dev-b': [['a.txt', 4, 'B4']] }, '@dev-a @dev-b cùng sửa dòng 4')
  entries = await settle(2, 'merge cùng dòng')
  const lost = entries.find(e => e.state === 'conflict'), won = entries.find(e => e.state === 'merged')
  assert.ok(lost && won, JSON.stringify(entries.map(e => [e.agent, e.state])))
  assert.deepStrictEqual(lost.error.files, ['a.txt']); assert.strictEqual(lines()[4], won.agent === 'dev-a' ? 'A4' : 'B4'); clean()
  await waitFor('tin báo chưa gộp', () => log().some(m => m.from === 'system' && m.text.startsWith(`@${lost.agent} chưa gộp được nhánh`)))

  // the workspace is checked when a turn starts: a turn queued behind the same agent's running turn is not refused
  // for that turn's edits, nor told HEAD moved when the running turn commits (the merge winner: its branch is clean)
  const me = won.agent, ws = () => JSON.parse(fs.readFileSync(registryFile, 'utf8')).agents.find(a => a.agent === me).path
  const failed = from => log().slice(from).filter(m => m.from === 'system' && /lỗi:|Không thể tạo commit/.test(m.text)).map(m => m.text)
  mark = log().length; process.env.FAKE_SLOW_MS = '1500'
  await edit({ [me]: [['a.txt', 1, 'R1']] }, `@${me} sửa dòng 1`)
  await waitFor(`${me} đang sửa`, () => fs.readFileSync(path.join(ws(), 'a.txt'), 'utf8').split('\n')[1] === 'R1')
  await edit({ [me]: [['a.txt', 3, 'R3']] }, `@${me} sửa dòng 3`)
  delete process.env.FAKE_SLOW_MS
  entries = await settle(2, `merge hai lượt nối tiếp của ${me}`)
  assert.deepStrictEqual([entries.map(e => e.state), lines()[1], lines()[3], failed(mark)], [['merged', 'merged'], 'R1', 'R3', []]); clean()
  // the agent commits by itself → still merged
  process.env.FAKE_COMMIT = JSON.stringify({ [me]: 1 })
  await edit({ [me]: [['a.txt', 7, 'R7']] }, `@${me} sửa dòng 7 rồi tự commit`)
  entries = await settle(1, `merge lượt ${me} tự commit`)
  delete process.env.FAKE_COMMIT
  assert.ok(require('child_process').execFileSync('git', ['-C', ws(), 'log', '-1', '--format=%s', entries[0].headSha]).toString().startsWith('tự commit'))
  assert.deepStrictEqual([entries.map(e => e.state), lines()[7], failed(mark)], [['merged'], 'R7', []]); clean()
  // leftovers of an earlier turn: committed when in scope, else the turn is refused naming them
  fs.writeFileSync(path.join(ws(), 'left.txt'), 'x\n')
  await edit({}, `@${me} tiếp`)
  entries = await settle(1, `merge thay đổi còn lại của ${me}`)
  assert.deepStrictEqual([entries.map(e => e.state), fs.existsSync(at('left.txt')), failed(mark)], [['merged'], true, []]); clean()
  fs.writeFileSync(path.join(ws(), 'left.md'), 'x\n')
  await edit({}, `@${me} tiếp`)
  await waitFor(`${me} bị chặn vì file ngoài phạm vi`, () => failed(mark).some(t => t.includes('chưa được app ghi nhận: left.md')))
  fs.rmSync(path.join(ws(), 'left.md'))
  delete process.env.FAKE_EDITS

  // T38 hotfix: main bumps package.json version while agent has unmerged commits -> merges successfully
  const pkg = JSON.parse(fs.readFileSync(at('package.json'), 'utf8'))
  pkg.version = '0.6.0'
  fs.writeFileSync(at('package.json'), JSON.stringify(pkg, null, 2))
  git('add', 'package.json'); git('commit', '-q', '-m', 'bump version to 0.6.0')
  mark = log().length
  await edit({ [me]: [['a.txt', 4, 'R4']] }, `@${me} sửa dòng 4 khi main bump version`)
  entries = await settle(1, `merge lượt ${me} sau khi main bump version`)
  assert.deepStrictEqual([entries.map(e => e.state), lines()[4], failed(mark)], [['merged'], 'R4', []]); clean()

  // S9/T37: every refused merge has exactly one system message (refuse() and the catch both post)
  const errorMsgs = id => log().filter(m => m.kind === 'merge' && m.queueId === id && m.error).length
  for (const e of queue().filter(e => e.error)) assert.strictEqual(errorMsgs(e.id), 1, `${e.state} ${e.id}: ${errorMsgs(e.id)} tin lỗi`)
  // S9/T37: an agent repairs its red branch by committing and merging main itself (what PM asked dev-be to do). Files that
  // came from main are not the agent's edits: the turn must still queue the branch, or the old error entry stays forever
  fs.writeFileSync(at('notes.md'), 'main\n'); git('add', 'notes.md'); git('commit', '-q', '-m', 'notes on main') // outside dev-c's scope
  mark = log().length
  process.env.FAKE_COMMIT = JSON.stringify({ 'dev-c': 1 }); process.env.FAKE_MERGE = JSON.stringify({ 'dev-c': 'main' })
  await edit({ 'dev-c': [['a.txt', 5, 'l5']] }, '@dev-c bỏ RED ở dòng 5, tự commit rồi merge main')
  await waitFor('dev-c trả lời', () => log().slice(mark).some(m => m.from === 'dev-c'))
  delete process.env.FAKE_COMMIT; delete process.env.FAKE_MERGE
  try { await waitFor('mục gộp mới của dev-c', () => queue().length > q0 && queue().every(done), 15000) }
  catch { throw new Error('agent tự merge main → không có mục gộp mới, mục check-failed cũ vẫn kẹt; tin hệ thống: '
    + JSON.stringify(log().slice(mark).filter(m => m.from === 'system').map(m => m.text))) }
  entries = queue().slice(q0); q0 = queue().length
  assert.deepStrictEqual([entries.map(e => e.state), lines()[5]], [['merged'], 'l5']); clean()
  const scopeWarnings = from => log().slice(from).filter(m => m.kind === 'scope-warning').map(m => m.text)
  assert.deepStrictEqual(scopeWarnings(mark), [], 'files main brought in must not be blamed on the agent')
  // a branch that only bumps the version is checked and merged (manifests compared after the merge)
  mark = log().length
  await edit({ 'dev-c': [['package.json', 6, '  "version": "0.6.1"']] }, '@dev-c chỉ tăng version')
  entries = await settle(1, 'merge nhánh dev-c chỉ đổi version')
  assert.deepStrictEqual([entries.map(e => e.state), JSON.parse(fs.readFileSync(at('package.json'), 'utf8')).version], [['merged'], '0.6.1']); clean()
  // a real out-of-scope edit by the agent is still caught after the main-diff filter: warned, named, not committed or queued
  mark = log().length; const q1 = queue().length
  await edit({ 'dev-c': [['notes.md', 0, 'dev-c sửa']] }, '@dev-c sửa notes.md (ngoài phạm vi)')
  await waitFor('cảnh báo ngoài phạm vi của dev-c', () => scopeWarnings(mark).some(t => t.includes('@dev-c') && t.includes('notes.md')))
  await waitFor('dev-c trả lời', () => log().slice(mark).some(m => m.from === 'dev-c'))
  await new Promise(r => setTimeout(r, 300))
  assert.deepStrictEqual([queue().length, fs.readFileSync(at('notes.md'), 'utf8')], [q1, 'main\n'])
  // T38: only a version bump passes, but a branch that changes real dependencies must not be checked/merged with the old
  // node_modules: blocked (one message), main untouched
  mark = log().length; const pkgBefore = fs.readFileSync(at('package.json'), 'utf8')
  await edit({ [me]: [['package.json', 1, '  "dependencies": { "left-pad": "1.3.0" }, "name": "fixture",']] }, `@${me} thêm dependency left-pad`)
  entries = await settle(1, `merge lượt ${me} đổi dependencies`)
  assert.notStrictEqual(entries[0].state, 'merged', 'nhánh đổi dependencies thật vẫn được gộp, check chạy với node_modules cũ')
  assert.strictEqual(fs.readFileSync(at('package.json'), 'utf8'), pkgBefore)
  await waitFor('một tin báo chặn deps', () => errorMsgs(entries[0].id) === 1, 5000)
  delete process.env.FAKE_EDITS

  assert.strictEqual(mergeCommits(), '', 'gộp phải là squash: main không có merge commit, kể cả khi agent tự merge main vào nhánh')

  // "Dự án" tab: main folder's uncommitted changes, an agent's unmerged branch, one commit; nothing outside the project
  fs.writeFileSync(at('new.txt'), 'n1\nn2\n'); fs.appendFileSync(at('chk.js'), '\n// x')
  let tr = await call('projectTree', root, null)
  assert.deepStrictEqual([tr.ok, tr.changes['new.txt'], tr.changes['chk.js'], tr.files.includes('a.txt'), tr.files.some(f => f.startsWith('.chat'))],
    [true, 'U', 'M', true, false], JSON.stringify(tr).slice(0, 300))
  let df = await call('fileDiff', root, null, 'chk.js'); assert.ok(df.ok && df.diff.includes('+// x'), JSON.stringify(df))
  df = await call('fileDiff', root, null, 'new.txt'); assert.ok(df.ok && df.diff.includes('+n2'), JSON.stringify(df))
  tr = await call('projectTree', root, { workspace: lost.workspaceId }) // its same-line edit never merged
  df = await call('fileDiff', root, { workspace: lost.workspaceId }, 'a.txt')
  assert.ok(tr.changes['a.txt'] === 'M' && df.diff.includes(lost.agent === 'dev-a' ? '+A4' : '+B4'), JSON.stringify([tr.changes, df]))
  const headSha = git('rev-parse', 'HEAD').trim()
  tr = await call('projectTree', root, { commit: headSha })
  df = await call('fileDiff', root, { commit: headSha }, tr.files[0])
  assert.ok(tr.ok && tr.files.length && tr.commits[0].sha === headSha && df.diff.includes('@@'), JSON.stringify([tr, df]).slice(0, 400))
  for (const bad of ['../x', path.join(root, 'a.txt'), '.chat/log.jsonl', 'a\0b', '']) assert.strictEqual((await call('fileDiff', root, null, bad)).ok, false, bad)
  for (const bad of [{ commit: 'HEAD' }, { commit: '--output=/tmp/x' }, { workspace: '../../x' }]) assert.strictEqual((await call('projectTree', root, bad)).ok, false, JSON.stringify(bad))
  fs.rmSync(at('new.txt')); git('checkout', '--', 'chk.js')

  // A stopped pending retry stays paused, without overwriting other queue entries.
  const stoppedConfig = core.projectSettings(root)
  core.writeProjectSettings(root, { ...stoppedConfig.settings, worktreesEnabled: false }, stoppedConfig.revision)
  assert.ok((await call('retryMerge', root, { queueId: lost.id })).ok)
  const pending = queue().at(-1), otherEntries = queue().slice(0, -1)
  assert.strictEqual(pending.state, 'queued')
  assert.ok((await call('stopMerge', root, { queueId: pending.id })).ok)
  assert.strictEqual(queue().at(-1).state, 'paused')
  assert.deepStrictEqual(queue().slice(0, -1), otherEntries)

  // Boxes: one folder, independent .chat / .chat2; one open at a time, switching or creating waits until the folder is idle
  {
    const two = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-boxes-'))), in2 = f => path.join(two, f)
    const text = f => { try { return fs.readFileSync(in2(f), 'utf8') } catch { return '' } }
    const whenIdle = async fn => { for (let i = 0; ; i++) try { return await fn() } catch (e) {
      if (i > 400 || !/còn agent/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 25)) } }
    pickPath = two; const asked = dialogs
    assert.deepStrictEqual(await call('pick'), { dir: two, chat: '.chat' }); assert.strictEqual(dialogs, asked) // new folder: no question
    // team written outside the app (an agent could do this): asked before any turn runs; "Hoàn tác" restores the app's copy
    const appTeam = text('.chat/agents.json'), outside = JSON.stringify([{ name: 'pm', cli: 'codex', role: 'PM', owns: ['.chat/memory.md', 'notes/**'] }])
    fs.writeFileSync(in2('.chat/agents.json'), outside)
    dialogAnswer = 0; await call('send', two, 'thử')
    assert.deepStrictEqual([dialogs, text('.chat/agents.json')], [asked + 1, appTeam])
    await waitFor('pm của team gốc trả lời', () => text('.chat/log.jsonl').includes('"from":"pm"')) // the reverted team ran
    fs.writeFileSync(in2('.chat/agents.json'), outside)
    process.env.FAKE_REPLY = JSON.stringify({ pm: 'R1' })
    dialogAnswer = 1; await call('send', two, 'chào') // accepting pins exactly what was shown
    assert.deepStrictEqual([dialogs, core.configTrust(two).trusted, core.team(two)[0].cli], [asked + 2, true, 'codex'])
    dialogAnswer = 2 // "Tạo box mới", keep the team
    await assert.rejects(call('pick'), /còn agent đang chạy/) // pm still running → nothing created
    assert.ok(!fs.existsSync(in2('.chat2')))
    assert.deepStrictEqual(await whenIdle(() => call('pick')), { dir: two, chat: '.chat2' })
    assert.deepStrictEqual(JSON.parse(text('.chat2/agents.json'))[0].owns, ['.chat2/memory.md', 'notes/**', '.chat2/tasks.json', '.chat2/tasks.json.tmp']) // scope follows the new box
    const opened = await call('open', two, '.chat2')
    assert.deepStrictEqual([opened.chat, opened.history.total], ['.chat2', 0])
    const p2 = (await core.promptIndexed(two, core.team(two)[0], null)).text
    assert.ok(p2.includes('.chat2/memory.md') && !p2.includes('.chat/'))
    process.env.FAKE_REPLY = JSON.stringify({ pm: 'R2' }); await call('send', two, 'chào')
    await waitFor('pm ở box 2', () => text('.chat2/log.jsonl').includes('"text":"R2"'))
    assert.ok(text('.chat/log.jsonl').includes('"text":"R1"') && !text('.chat/log.jsonl').includes('R2') && !text('.chat2/log.jsonl').includes('R1'))
    assert.ok(Object.keys(JSON.parse(text('.chat2/sessions.json'))).includes('pm'))
    const snap = await core.snapshot(two); await core.appendLogIndexed(two, { from: 'user', text: 'x' }) // runtime files of any box are not "changes"
    assert.deepStrictEqual(core.changedPaths(snap, await core.snapshot(two)), [])
    const cfg = await call('projectSettings', two)
    assert.ok((await call('saveProjectSettings', two, { expectedRevision: cfg.revision, settings: { ...cfg.settings, name: '  Review ' } })).ok)
    assert.deepStrictEqual((await call('projects')).filter(b => b.dir === two).map(b => [b.chat, b.name]), [['.chat', path.basename(two)], ['.chat2', 'Review']])
    const back = await whenIdle(() => call('open', two, '.chat'))
    assert.deepStrictEqual([back.chat, back.history.messages.some(m => m.text === 'R1'), back.history.messages.some(m => m.text === 'R2')], ['.chat', true, false])
    // "Cần bạn" through IPC: counted on the open box's sidebar entry; a dismissal is kept in userData, not in the box
    await core.appendLogIndexed(two, { from: 'pm', text: 'xong phần 1\n@user chốt A hay B?', at: new Date().toISOString() })
    const asks = (await call('needs', two)).items, badge = async () => (await call('projects')).find(b => b.dir === two && b.chat === '.chat').needs
    assert.deepStrictEqual([asks.map(item => item.text), await badge()], [['@user chốt A hay B?'], 1])
    assert.strictEqual((await call('dismissNeed', two, '../x')).ok, false)
    assert.deepStrictEqual([(await call('dismissNeed', two, `${asks[0].seq}:${asks[0].at}`)).items, await badge()], [[], 0])
    assert.ok(fs.readFileSync(path.join(userData, 'needs-dismissed.json'), 'utf8').includes(`${asks[0].seq}:${asks[0].at}`))
    pickPath = in2('.chat2'); assert.deepStrictEqual(await call('pick'), { dir: two, chat: '.chat2' }) // picking a box's folder opens that box
    delete process.env.FAKE_REPLY; pickPath = null; dialogAnswer = 0
    console.log('ok (boxes)')
  }

  // Sprint 11 G1-G6: verification records, tasks IPC with verification, taskEvidence IPC
  {
    const boardRes = await call('tasks', root)
    assert.ok(Array.isArray(boardRes.tasks))
    for (const t of boardRes.tasks) {
      assert.ok(t.verification, `task ${t.id} missing verification`)
      assert.ok(typeof t.verification.state === 'string')
    }

    if (boardRes.tasks.length > 0) {
      const firstTask = boardRes.tasks[0]
      const evidence = await call('taskEvidence', root, { taskId: firstTask.id, expectedRevision: firstTask.revision })
      assert.strictEqual(evidence.ok, true)
      assert.strictEqual(evidence.taskId, firstTask.id)
      assert.strictEqual(evidence.revision, firstTask.revision)
      assert.ok(evidence.verification)
      assert.ok(Array.isArray(evidence.checks))

      const conflictEvidence = await call('taskEvidence', root, { taskId: firstTask.id, expectedRevision: 'wrong-rev' })
      assert.strictEqual(conflictEvidence.ok, false)
      assert.strictEqual(conflictEvidence.error.code, 'CONFLICT')
    }

    const badEvidence = await call('taskEvidence', root, {})
    assert.strictEqual(badEvidence.ok, false)
    assert.strictEqual(badEvidence.error.code, 'INVALID_ARGUMENT')
    console.log('ok (sprint 11 BE IPC & verification)')
  }
}
// Cài đặt › CLI Agent: a scan lists each real file once, PATH first and executables only; a check reads the version and
// each account's login through the picked file; a turn whose file is gone points to the setting
async function cliPathChecks() {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-a-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-b-'))
  const fake = (d, name, body) => fs.writeFileSync(path.join(d, name), `#!${process.execPath}\nconst a = process.argv.slice(2).join(' ')\n${body}`, { mode: 0o755 })
  fake(a, 'claude', `if (a === '--version') console.log('9.9.9 (Claude Code)')
if (a === 'auth status') { console.log(JSON.stringify({ loggedIn: !process.env.CLAUDE_CONFIG_DIR, email: 'me@x' })); process.exit(process.env.CLAUDE_CONFIG_DIR ? 1 : 0) }`)
  fs.symlinkSync(path.join(a, 'claude'), path.join(b, 'claude'))
  fake(b, 'codex', `if (a === '--version') console.log('codex-cli 1.0')
if (a === 'login status') { const ok = require('path').basename(process.env.CODEX_HOME) === '.codex'; console.log(ok ? 'Logged in using ChatGPT' : 'Not logged in'); process.exit(ok ? 0 : 1) }`)
  fs.writeFileSync(path.join(b, 'agy'), 'not executable')
  const found = core.findClis({ PATH: [a, b].join(path.delimiter) })
  assert.deepStrictEqual([found.claude[0], found.codex[0], found.claude.includes(path.join(b, 'claude')), found.agy.includes(path.join(b, 'agy'))],
    [path.join(a, 'claude'), path.join(b, 'codex'), false, false])
  core.setCliPaths({ claude: path.join(b, 'claude'), codex: path.join(b, 'codex'), agy: path.join(a, 'gone'), extra: '/x', bad: 'relative' })
  assert.deepStrictEqual([core.account('claude2').file, core.account('agy').file], [path.join(b, 'claude'), path.join(a, 'gone')])
  try {
    const r = await core.checkClis(['claude', 'claude2', 'codex', 'codex2', 'agy'])
    assert.deepStrictEqual(r.bins.claude, { file: path.join(b, 'claude'), version: '9.9.9 (Claude Code)' })
    assert.deepStrictEqual([r.bins.codex.version, r.bins.agy.error], ['codex-cli 1.0', 'Không tìm thấy file chạy'])
    assert.deepStrictEqual(r.accounts, { claude: { ok: true, detail: 'me@x' }, claude2: { ok: false, error: 'Chưa đăng nhập' },
      codex: { ok: true, detail: 'Logged in using ChatGPT' }, codex2: { ok: false, error: 'Chưa đăng nhập' }, agy: { ok: false, error: 'Không tìm thấy file chạy' } })
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-path-')); core.init(d)
    const p = await core.run(d, core.normalizeTeam(d, [{ name: 'qa', cli: 'agy', role: 'QA' }])[0])
    assert.ok(p.outcome === 'error' && p.text.includes('Cài đặt › Agent'), p.text)
  } finally { core.setCliPaths({}) }
  assert.strictEqual(core.account('claude').file, 'claude') // unset → by name on PATH, as before
  console.log('ok (cli paths)')
}

// Cài đặt chung: the search narrows sections and rows (accents optional), and moves off a section it hides
function appSettingsChecks() {
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm')
  const code = ui.slice(ui.indexOf('let appPane = '), ui.indexOf('function openAppSettings('))
  const row = (text, keys = '') => ({ textContent: text, dataset: { keys }, hidden: false })
  const sections = {
    font: { label: 'Font chữ', keys: 'font phông', rows: [row('Font giao diện', 'typeface'), row('Cỡ chữ tin nhắn', 'font size')] },
    agent: { label: 'Agent', keys: 'agent cli', rows: [row('claude 2.1 codex agy', 'đường dẫn path')] },
    mcp: { label: 'MCPsắp có', keys: 'mcp server', rows: [] },
  }
  const panes = Object.entries(sections).map(([name, s]) => ({ dataset: { pane: name, keys: s.keys }, hidden: false, querySelectorAll: () => s.rows }))
  const navs = Object.fromEntries(Object.entries(sections).map(([name, s]) => [name, { textContent: s.label, hidden: false, active: false,
    classList: { toggle(c, on) { navs[name].active = on } } }]))
  const search = { value: '' }, empty = { hidden: true }, scans = []
  const ctx = { fold: s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase(), cliState: null, scanClis: () => scans.push(1),
    renderFont() {}, about: null, aboutShown: false, $: s => s === '#app-settings-search' ? search : empty,
    document: { querySelectorAll: () => panes, querySelector: s => navs[/data-pane="(\w+)"/.exec(s)[1]] } }
  vm.createContext(ctx); vm.runInContext(code + '\n;this.filter = filterAppSettings; this.pane = () => appPane', ctx)
  const shown = () => panes.filter(p => !p.hidden).map(p => p.dataset.pane), navShown = () => Object.keys(navs).filter(n => !navs[n].hidden)
  ctx.filter()
  assert.deepStrictEqual([shown(), navShown(), empty.hidden], [['font'], ['font', 'agent', 'mcp'], true])
  search.value = 'co chu'; ctx.filter() // no accents typed, only the size row
  assert.deepStrictEqual([shown(), navShown(), sections.font.rows.map(r => r.hidden)], [['font'], ['font'], [true, false]])
  search.value = 'CODEX'; ctx.filter() // the section shown no longer matches: move to the one that does, which scans
  assert.deepStrictEqual([shown(), navShown(), ctx.pane(), navs.agent.active, scans.length], [['agent'], ['agent'], 'agent', true, 1])
  search.value = 'font'; ctx.filter() // a section's own name shows all of it
  assert.deepStrictEqual([shown(), navShown(), sections.font.rows.map(r => r.hidden)], [['font'], ['font'], [false, false]])
  search.value = 'zzz'; ctx.filter()
  assert.deepStrictEqual([shown(), navShown(), empty.hidden], [[], [], false])
  search.value = ''; ctx.filter()
  assert.deepStrictEqual([shown(), navShown()], [['font'], ['font', 'agent', 'mcp']])
  console.log('ok (app settings search)')
}

logChecks().then(needsChecks).then(timelineChecks).then(taskChecks).then(auditChecks).then(viewerChecks).then(runChecks).then(cliPathChecks).then(appSettingsChecks).then(sprint7Checks).then(sprint8Checks).then(sprint9Checks).then(sprint11CoreChecks).then(sprint6Checks).then(rendererChecks).then(rendererFileChecks).then(rendererS9Checks).then(rendererS10Checks).then(rendererS11Checks).then(mainChecks).then(() => console.log('ok'), e => { console.error(e); process.exit(1) })

// PM creates a task and moves it in the same turn (no revision yet): "" is accepted only for PM on a todo task
{
  const board = { tasks: [{ id: 'T1', assignee: 'dev', createdAt: 'x', status: 'todo', revision: 'r1' }, { id: 'T2', assignee: 'dev', createdAt: 'x', status: 'doing', revision: 'r2' }] }
  const V = (changes, actor) => core.validateTaskChanges(board, changes, actor)
  assert.strictEqual(V([{ id: 'T1', status: 'doing', expectedRevision: '' }], 'pm').length, 1)
  assert.throws(() => V([{ id: 'T1', status: 'doing', expectedRevision: '' }], 'dev'), /thay đổi/) // others still need the revision
  assert.throws(() => V([{ id: 'T2', status: 'done', expectedRevision: '', approval: { kind: 'manual', reason: 'ok' } }], 'pm'), /thay đổi/)   // already moved → revision required
  console.log('ok (task revision)')
}
// Claude: cache reads/writes are tokens sent too (without them a turn showed "Vào 4")
assert.strictEqual(core.CLI.claude.parse(J({ type: 'result', subtype: 'success', result: 'ok', session_id: 's', usage: { input_tokens: 4, cache_read_input_tokens: 30000, cache_creation_input_tokens: 500, output_tokens: 9 }, total_cost_usd: 0.1 }), { costBaseline: 0 }).usage.inputTokens, 30504)
console.log('ok (claude cache tokens)')
// "!x" exclusions survive a round trip through team() → ⚙ save → team() (they used to be dropped on save)
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-excl-')); core.init(d)
  const members = core.team(d).map(a => a.name === core.team(d)[0].name ? { ...a, owns: ['src/**', '!src/gen/**'] } : a)
  core.saveTeam(d, members)
  const back = core.team(d)[0]
  assert.deepStrictEqual(back.owns, ['src/**', '!src/gen/**'])
  core.saveTeam(d, core.team(d)) // saving what the form shows again keeps it
  assert.deepStrictEqual(core.team(d)[0].owns, ['src/**', '!src/gen/**'])
  assert.ok(!core.scopeAllows(core.normalizeScope(core.team(d)[0], d), 'src/gen/a.js'))
  console.log('ok (exclusions persist)')
}
// Windows .cmd shims: args are escaped for cmd.exe the way cross-spawn does it (prompt itself goes over stdin)
assert.strictEqual(core.winArg('a b'), '^"a^ b^"')
assert.strictEqual(core.winArg('x"y'), '^"x\\^"y^"')
assert.strictEqual(core.winArg('model_reasoning_effort="high"'), '^"model_reasoning_effort=\\^"high\\^"^"')
assert.strictEqual(core.winArg('C:\\dir\\'), '^"C:\\dir\\\\^"') // trailing backslash doubled so it can't eat the closing quote
assert.deepStrictEqual(core.CLI.claude.stdinArgs('S1', {}).slice(0, 2), ['-p', '--output-format']) // no prompt argument
assert.ok(core.CLI.claude.stdinArgs('S1', {}).includes('S1') && core.CLI.codex.stdinArgs('T1', {}).slice(-2).join(' ') === 'T1 -')
console.log('ok (windows args)')
// npm .cmd shims on Windows: find the real target so we can run it without cmd.exe
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'))
  const put = (rel, text = '') => { const f = path.join(d, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f }
  const head = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n'
  const exe = put('node_modules/@anthropic-ai/claude-code/bin/claude.exe')
  const claude = put('claude.cmd', head + '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
  assert.deepStrictEqual(core.shimTarget(claude), { file: exe, pre: [] }) // native binary → run directly
  const js = put('node_modules/@openai/codex/bin/codex.js'), node = put('node.exe')
  const codex = put('codex.cmd', head + 'IF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n'
    + 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n')
  assert.deepStrictEqual(core.shimTarget(codex), { file: node, pre: [js] }) // JS → node next to the shim + script
  const npm = put('npm.cmd', '@ECHO OFF\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%NODE_EXE%" "%NPM_CLI_JS%" %*\r\n')
  assert.strictEqual(core.shimTarget(npm), null) // unknown layout → cmd.exe fallback
  console.log('ok (cmd shims)')
}
// values from the box folder never become CLI flags: no sharedChat (--add-dir) from the file, no "-…" model or session id
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-argv-'))
  core.init(d)
  fs.writeFileSync(path.join(d, '.chat/agents.json'), JSON.stringify([{ name: 'x', cli: 'claude', role: 'r', sharedChat: '/', model: '--dangerously-skip-permissions' }]))
  const [x] = core.team(d)
  assert.strictEqual(x.sharedChat, undefined)
  core.run(d, x).then(r => {
    assert.ok(r.outcome === 'error' && /không hợp lệ/.test(r.text), JSON.stringify(r)) // rejected before anything is spawned
    console.log('ok (argv values)')
  }).catch(e => { console.error(e); process.exit(1) })
}
// images: saved by content type under the box, read back only from inside the project, unseen by the scope audit
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-img-')); core.init(d)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
  const saved = core.saveImage(d, new Uint8Array(png))
  assert.match(saved, /^\.chat\/attachments\/img-[0-9a-f]{12}\.png$/)
  assert.throws(() => core.saveImage(d, new Uint8Array(Buffer.from('<svg onload="alert(1)"></svg>'))), { code: 'UNSUPPORTED' })
  assert.throws(() => core.saveImage(d, 'abc'), { code: 'INVALID_ARGUMENT' })
  fs.writeFileSync(path.join(d, 'reports/fake.png'), 'not an image at all')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-img-out-')); fs.writeFileSync(path.join(outside, 'x.png'), png)
  // markdown images never get a src the browser would fetch on its own (remote ones become links, local ones load via main)
  const ui = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'), vm = require('vm')
  const md = vm.runInNewContext(ui.slice(ui.indexOf('let mdInstance'), ui.indexOf('function bindLinkHandler')) + ';initMarkdown()',
    { window: { markdownit: require('markdown-it') } })
  const html = md.render('![a](http://e.com/a.png) ![b" onerror="x](reports/a.png) ![c](javascript:x)')
  assert.ok(!/\ssrc=/.test(html) && html.includes('data-src="reports/a.png"') && !html.includes('" onerror') && !html.includes('data-src="javascript'), html)
  Promise.all([core.readImage(d, saved), core.readImage(d, 'reports/fake.png'), core.readImage(d, path.join(outside, 'x.png')),
    core.readImage(d, `../${path.basename(outside)}/x.png`), core.snapshot(d), core.promptIndexed(d, core.team(d)[0], null)])
    .then(([ok, fake, abs, rel, snap, briefing]) => {
      assert.deepStrictEqual([ok.ok, ok.mime, ok.path, Buffer.compare(ok.bytes, png)], [true, 'image/png', saved, 0])
      assert.deepStrictEqual([fake.ok, fake.code, abs.code, rel.code], [false, 'UNSUPPORTED', 'OUTSIDE_PROJECT', 'OUTSIDE_PROJECT'])
      assert.ok(![...snap.keys()].some(k => k.includes('attachments'))) // a paste during a turn is not the agent's change
      assert.ok(briefing.text.includes('![mô tả](.chat/attachments/'))
      console.log('ok (images)')
    }).catch(e => { console.error(e); process.exit(1) })
}
// SVG detection, image types, and bounded file reading
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svg-')); core.init(d)
  const validSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'
  const bomSvg = '\ufeff<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>'
  const xmlDeclSvg = '<?xml version="1.0" encoding="utf-8"?>\n<!-- note -->\n<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>'
  const selfCloseSvg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" />'
  for (const s of [validSvg, bomSvg, xmlDeclSvg, selfCloseSvg]) {
    assert.strictEqual(core.isSvgBytes(Buffer.from(s, 'utf8')), true, 'must be recognized as SVG: ' + s)
    assert.strictEqual(core.imageType(Buffer.from(s, 'utf8')), 'svg')
  }

  const badSvgs = [
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<!ENTITY secret SYSTEM "file:///etc/passwd"><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<?xml-stylesheet type="text/css" href="style.css"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<html><body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>',
    '<svg width="10"><rect/></svg>', // missing xmlns
    '<svg', // truncated
    'plain text',
  ]
  for (const bad of badSvgs) {
    assert.strictEqual(core.isSvgBytes(Buffer.from(bad, 'utf8')), false, 'must reject: ' + bad)
  }

  // 5 image types
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
  const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0, 0, 0, 0, 0])
  const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'latin1')
  const webpBytes = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')])
  assert.strictEqual(core.imageType(pngBytes), 'png')
  assert.strictEqual(core.imageType(jpgBytes), 'jpg')
  assert.strictEqual(core.imageType(gifBytes), 'gif')
  assert.strictEqual(core.imageType(webpBytes), 'webp')

  // readImage with SVG
  fs.writeFileSync(path.join(d, 'reports/icon.svg'), validSvg)
  // Fake extension
  fs.writeFileSync(path.join(d, 'reports/fake.svg'), pngBytes)
  fs.writeFileSync(path.join(d, 'reports/fake.png'), Buffer.from(validSvg, 'utf8'))

  Promise.all([
    core.readImage(d, 'reports/icon.svg'),
    core.readImage(d, 'reports/fake.svg'),
    core.readImage(d, 'reports/fake.png'),
  ]).then(([svgRes, fakeSvgRes, fakePngRes]) => {
    assert.strictEqual(svgRes.ok, true)
    assert.strictEqual(svgRes.mime, 'image/svg+xml')
    assert.strictEqual(svgRes.name, 'icon.svg')
    assert.strictEqual(svgRes.canOpenExternal, false) // SVG canOpenExternal is always false
    assert.strictEqual(fakeSvgRes.ok, false)
    assert.strictEqual(fakeSvgRes.code, 'UNSUPPORTED')
    assert.strictEqual(fakePngRes.ok, false)
    assert.strictEqual(fakePngRes.code, 'UNSUPPORTED')
    console.log('ok (svg & image types)')
  }).catch(e => { console.error(e); process.exit(1) })
}
// the model a turn ran on: claude's init event names it; codex from -m or config.toml, named like its models_cache
{
  const r = core.CLI.claude.parse('{"type":"system","subtype":"init","session_id":"S","model":"claude-opus-5-5"}\n{"type":"result","subtype":"success","result":"ok","session_id":"S"}')
  assert.strictEqual(r.model, 'claude-opus-5-5')
  assert.strictEqual(core.modelLabel({ model: 'opus' }, { bin: 'claude' }, r.model), 'opus-5-5')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
  fs.writeFileSync(path.join(home, 'config.toml'), 'model = "gpt-6.1-sol"\n[profiles.x]\nmodel = "other"\n')
  fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' }] }))
  const codex = { bin: 'codex', home }
  assert.deepStrictEqual([core.modelLabel({}, codex), core.modelLabel({ model: 'gpt-x' }, codex), core.modelLabel({}, { bin: 'codex', home: '/nope' }),
    core.modelLabel({ model: 'gemini-3' }, { bin: 'agy' }), core.modelLabel({}, { bin: 'agy' })], ['GPT-6.1-Sol', 'gpt-x', null, 'gemini-3', null])
  console.log('ok (model label)')
}
// taking a message back: only main's own record for an earlier user message counts; prompts get a placeholder
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-retract-')); core.init(d)
  const add = m => core.appendLogIndexed(d, { at: new Date().toISOString(), ...m })
  ;(async () => {
    await add({ from: 'user', text: 'xoá bảng users' })
    await add({ from: 'pm', text: 'ok' })
    await add({ from: 'pm', text: 'giả', kind: 'retract', target: 0 }) // an agent's record takes nothing back
    await add({ from: 'system', text: 'x', kind: 'retract', target: 1 }) // nor one for an agent's message
    await add({ from: 'system', text: 'x', kind: 'retract', target: -1 })
    assert.deepStrictEqual((await core.logPage(d)).messages.map(m => !!m.retracted), [false, false, false, false, false])
    await add({ from: 'system', text: 'thu hồi', kind: 'retract', target: 0 })
    assert.deepStrictEqual((await core.logPage(d)).messages.map(m => !!m.retracted), [true, false, false, false, false, false])
    const briefing = (await core.promptIndexed(d, core.team(d)[0], null)).text
    assert.ok(!briefing.includes('xoá bảng users') && briefing.includes('[user] (tin đã được thu hồi, bỏ qua)'))
    core.invalidateLogIndex(d) // rebuilt from the file: same answer
    assert.ok((await core.logPage(d)).messages[0].retracted)
    console.log('ok (retract)')
  })().catch(e => { console.error(e); process.exit(1) })
}
