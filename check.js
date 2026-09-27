// node check.js — sanity check for @mention routing, project files, stream parsers, usage and Stop
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path')
const core = require('./core')
if (process.argv[2] === '--main') return void mainHarness().then(() => process.exit(0), e => { console.error(e); process.exit(1) })

const t = [{ name: 'dev' }, { name: 'dev-fe' }, { name: 'pm' }]
assert.deepStrictEqual(core.mentions('@dev-fe làm UI', t, 'pm').map(a => a.name), ['dev-fe'])
assert.deepStrictEqual(core.mentions('@DEV, @pm ok', t, 'pm').map(a => a.name), ['dev']) // case-insensitive, never self
assert.deepStrictEqual(core.mentions('email a@devx.com', t, 'pm'), [])

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-'))
core.init(dir)
core.appendLog(dir, { from: 'user', text: 'hi' })
assert.strictEqual(core.readLog(dir).length, 1)
assert.ok(core.prompt(dir, core.team(dir)[0]).includes('[user] hi'))

// resume: fresh prompt has full context, resumed prompt only what's new
assert.ok(!core.prompt(dir, core.team(dir)[0], { id: 'x', seen: 1 }).includes('[user] hi'))
core.appendLog(dir, { from: 'dev', text: 'xong' })
assert.ok(core.prompt(dir, core.team(dir)[0], { id: 'x', seen: 1 }).includes('[dev] xong'))
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
{ id: 't1', text: 'hi', usage: U(10, 0), error: null }) // 0 is a valid count
assert.ok(cx.parse(J({ type: 'thread.started', thread_id: 't1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'nửa' } })).error) // no terminal
assert.ok(cx.parse(J({ type: 'thread.started', thread_id: 't1' }, { type: 'turn.failed', error: { message: 'boom' } })).error.includes('boom'))
assert.deepStrictEqual(cx.parse(J({ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: '5' } })).usage, U(null, null, null, true))

// claude: stream-json; result.total_cost_usd is cumulative on resume → delta against checkpoint
const cl = core.CLI.claude
const claudeOut = total => J({ type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/p/a.js' } }] } },
  { type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'subagent' }] } },
  { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: total })
assert.deepStrictEqual(cl.parse(claudeOut(0.10), { costBaseline: 0 }), { id: 's1', text: 'ok', usage: U(3, 4, 0.1), error: null })
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
assert.deepStrictEqual(ag.parse(agyOut, { resumed: true }), { id: 'c1', text: 'ok', usage: U(6, 3), error: null })
assert.deepStrictEqual(ag.parse('{"conversation_id":"c1","response":"ok"}').text, 'ok') // old single-JSON fixture
assert.ok(ag.parse(J({ event: 'result', result: { response: 'x', status: 'ERROR' } })).error)
assert.ok(ag.parse(J({ event: 'init', conversation_id: 'c1' })).error) // no terminal

// progress labels: one plain line, project-relative, no raw output
const label = (cli, e) => core.CLI[cli].event(e, core.CLI[cli].state({}), { dir: '/p' })
assert.strictEqual(label('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/p/core.js' } }] } }), 'sửa core.js')
assert.strictEqual(label('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run check' } }] } }), 'chạy npm run check')
assert.strictEqual(label('codex', { type: 'item.started', item: { type: 'command_execution', command: 'npm run check' } }), 'chạy npm run check')
assert.strictEqual(label('agy', { event: 'step_update', step_update: { tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'ls' } } } }), 'chạy ls')

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
// adopted session: first turn resumes it but still sends the full team briefing
assert.ok(core.prompt(dir, core.team(dir)[0], { id: 'x', seen: 2, adopted: true }).includes('Quy tắc nhóm'))

// ---- Sprint 2: owns/readOnly scope, locks, audit snapshot, migration ----
const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-scope-')))
core.init(proj); fs.mkdirSync(path.join(proj, 'src')); fs.writeFileSync(path.join(proj, 'index.html'), '')
const S = (owns, readOnly = false) => core.normalizeScope({ name: 'x', owns, readOnly }, proj)
assert.deepStrictEqual(S('check.js'), { owns: ['check.js'], readOnly: false })
assert.deepStrictEqual(S('index.html, reports/').owns, ['index.html', 'reports/**'])
assert.deepStrictEqual(S('reports').owns, ['reports/**']) // existing dir → tree
assert.deepStrictEqual(S(['./src/**/*.js', 'src/**/*.js', '']).owns, ['src/**/*.js']) // trim ./, drop empty, dedupe
assert.deepStrictEqual(S('reports/ (chỉ đọc code)'), { owns: [], readOnly: false, ownsLegacy: 'reports/ (chỉ đọc code)', scopeNeedsReview: true }) // prose: not readOnly, not full access
for (const bad of ['../x', 'src/../x', '/etc/passwd', 'a\\b', '!x', '{a,b}', 'a**/b', 'C:x'])
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

const locks = (owns, readOnly) => core.scopeLocks(S(owns, readOnly), proj)
const clash = (a, b) => a.some(x => b.some(y => core.lockConflict(x, y)))
assert.deepStrictEqual(locks([]), [{ path: proj, tree: true }])
assert.deepStrictEqual(locks(['a.js'], true), []) // reader holds nothing
assert.deepStrictEqual(locks(['new.txt']), [{ path: path.join(proj, 'new.txt'), tree: false }]) // file not yet created is still locked
assert.ok(!clash(locks(['index.html']), locks(['main.js', 'core.js', 'preload.js']))) // FE ∥ BE
assert.ok(clash(locks(['index.html']), locks(['index.html'])))
assert.ok(clash(locks(['src/**/*.js']), locks(['src/**/*.css']))) // same glob prefix → conservative wait
assert.ok(clash(locks(['src/**']), locks(['src/a/b.js'])) && clash(locks([]), locks(['check.js'])))
assert.ok(!clash(locks(['src/**']), locks(['src2/a.js']))) // segment boundary
if (process.platform === 'darwin') assert.ok(clash(locks(['Index.html']), locks(['index.html'])))

async function auditChecks() {
  const f = n => path.join(proj, n)
  fs.writeFileSync(f('a.txt'), 'aaaa'); fs.writeFileSync(f('b.txt'), 'b')
  fs.mkdirSync(f('node_modules')); fs.writeFileSync(f('node_modules/x.js'), '1')
  fs.mkdirSync(f('dist')); fs.writeFileSync(f('dist/app.asar'), '1')
  const before = await core.snapshot(proj), st = fs.statSync(f('a.txt'))
  fs.writeFileSync(f('a.txt'), 'bbbb'); fs.utimesSync(f('a.txt'), st.atime, st.mtime) // same size + mtime, new content
  fs.rmSync(f('b.txt')); fs.writeFileSync(f('c.txt'), 'c')
  fs.appendFileSync(f('.chat/memory.md'), '- x\n') // memory is audited
  core.appendLog(proj, { from: 'user', text: 'x' }); fs.writeFileSync(f('node_modules/x.js'), '2'); fs.writeFileSync(f('dist/app.asar'), '2'); fs.writeFileSync(f('src/.DS_Store'), 'x') // excluded
  const changed = core.changedPaths(before, await core.snapshot(proj))
  assert.deepStrictEqual(changed, ['.chat/memory.md', 'a.txt', 'b.txt', 'c.txt'])
  assert.deepStrictEqual(changed.filter(p => !core.scopeAllows(S(['a.txt', 'c.txt']), p)), ['.chat/memory.md', 'b.txt'])
  const c = new AbortController(); c.abort()
  await assert.rejects(core.snapshot(proj, { signal: c.signal }))
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
assert.ok(core.prompt(proj, tm().techlead).includes('Chỉ sửa: reports/**'))
assert.ok(core.prompt(proj, { name: 'r', role: 'x', readOnly: true }).includes('Chỉ đọc'))
assert.ok(core.prompt(proj, { name: 'r', role: 'x' }, { id: 's', seen: 0 }).includes('toàn bộ dự án')) // resumed prompt too

// Markdown: pinned parser, html:false → raw HTML shows as text. The renderer itself is smoke-tested in the app.
assert.strictEqual(require('./package.json').dependencies['markdown-it'], '15.0.2')
const page = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
assert.ok(page.includes('node_modules/markdown-it/dist/browser/markdown-it.umd.min.js') && /markdownit\(\{ html: false/.test(page))
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
const at = '2026-09-27T12:00:00.000Z', later = '2026-09-27T13:00:00.000Z', tasksFile = path.join(box, '.chat/tasks.json')
const T = (id, x = {}) => ({ id, title: `Việc ${id}`, assignee: 'dev', spec: 'reports/s.md', createdAt: at, updatedAt: at, ...x })
const writeTasks = (...tasks) => fs.writeFileSync(tasksFile, JSON.stringify({ version: 1, tasks }))
const board = () => core.taskBoard(box), task = id => board().tasks.find(t => t.id === id)
const code = fn => { try { fn(); return 'OK' } catch (e) { return e.code } }
const change = (id, status, actor = 'pm', rev = task(id).revision) => core.validateTaskChanges(board(), [{ id, status, expectedRevision: rev }], actor)
const commit = (from, taskUpdates) => core.appendLog(box, { from, text: 'x', at: new Date().toISOString(), kind: 'task-status', taskUpdates })
const statuses = () => board().tasks.map(t => [t.id, t.status])

assert.deepStrictEqual(board(), { tasks: [], error: null }) // no file yet = empty board, not an error
for (const bad of ['{"version":1,"tasks":[', { version: 2, tasks: [] }, { version: 1, tasks: [T('T1'), T('T1')] },
  { version: 1, tasks: [{ ...T('T1'), status: 'done' }] }, { version: 1, tasks: [T('T0')] }, { version: 1, tasks: [T('T1', { title: '' })] },
  { version: 1, tasks: [T('T1', { spec: '../x.md' })] }, { version: 1, tasks: [T('T1', { spec: 'https://x.dev' })] }])
  assert.strictEqual(code(() => core.parseTaskDefinitions(typeof bad === 'string' ? bad : JSON.stringify(bad), box)), 'DATA_ERROR', JSON.stringify(bad))

writeTasks(T('T1'), T('T2', { assignee: 'qa' }))
assert.deepStrictEqual(statuses(), [['T1', 'todo'], ['T2', 'todo']])
const r1 = task('T1').revision; assert.strictEqual(task('T1').revision, r1) // stable across reads
commit('system', change('T1', 'doing'))
assert.strictEqual(task('T1').status, 'doing')
assert.strictEqual(code(() => change('T1', 'review', 'pm', r1)), 'CONFLICT') // second request on the same revision loses
assert.strictEqual(code(() => change('T1', 'doing', 'pm', r1)), 'CONFLICT') // stale even if status is the same
assert.deepStrictEqual(change('T1', 'doing'), []) // no-op, nothing to append
assert.strictEqual(code(() => change('T1', 'review', 'qa')), 'INVALID') // agent may only move its own task
assert.strictEqual(code(() => change('T2', 'done', 'user')), 'INVALID') // S4: End-User has no write path any more
assert.strictEqual(change('T2', 'doing', 'PM').length, 1) // S4: PM (any case) may move anyone's task
const b0 = board()
assert.strictEqual(code(() => core.validateTaskChanges(b0, b0.tasks.map(t => ({ id: t.id, status: 'done', expectedRevision: t.revision })), 'dev')), 'INVALID') // batch is all-or-nothing
commit('dev', change('T1', 'review', 'dev'))
assert.strictEqual(task('T1').status, 'review')
commit('qa', [{ id: 'T1', createdAt: at, assignee: 'qa', status: 'done', eventId: '00000000-0000-4000-8000-000000000000' }])
assert.strictEqual(task('T1').status, 'review') // forged event for someone else's task is ignored

// broken data keeps the last good board and blocks changes; never resets statuses to todo
const goodTasks = fs.readFileSync(tasksFile), logFile = path.join(box, '.chat/log.jsonl'), goodLog = fs.readFileSync(logFile)
fs.writeFileSync(tasksFile, '{"version":1,')
const broken = board()
assert.strictEqual(broken.error.code, 'DATA_ERROR'); assert.deepStrictEqual(broken.tasks.map(t => t.status), ['review', 'todo'])
assert.strictEqual(code(() => core.validateTaskChanges(broken, [{ id: 'T2', status: 'done', expectedRevision: broken.tasks[1].revision }], 'pm')), 'DATA_ERROR')
fs.writeFileSync(tasksFile, goodTasks)
fs.appendFileSync(logFile, '{"from":"system","taskUpd\n')
assert.strictEqual(board().error.code, 'DATA_ERROR'); assert.strictEqual(board().tasks[0].status, 'review')
fs.writeFileSync(logFile, goodLog)
assert.strictEqual(board().error, null)

// deleted task is not revived; PM adding T3 while the user moves T2 keeps both
writeTasks(T('T2', { assignee: 'qa' }))
assert.deepStrictEqual(statuses(), [['T2', 'todo']])
writeTasks(T('T1'), T('T2', { assignee: 'qa' }))
assert.strictEqual(board().error.code, 'DATA_ERROR')
writeTasks(T('T2', { assignee: 'qa' }))
commit('system', change('T2', 'doing'))
writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Mới' }))
assert.deepStrictEqual(statuses(), [['T2', 'doing'], ['T3', 'todo']])
writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Mới' }), T('T4', { assignee: 'ghost' }))
assert.strictEqual(board().error.code, 'DATA_ERROR') // new task must go to a current member
const r3 = task('T3').revision
writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Sửa' }))
assert.strictEqual(board().error.code, 'DATA_ERROR') // edit without bumping updatedAt
writeTasks(T('T2', { assignee: 'qa' }), T('T3', { title: 'Sửa', updatedAt: later }))
assert.strictEqual(board().error, null)
assert.strictEqual(code(() => change('T3', 'doing', 'pm', r3)), 'CONFLICT') // metadata edit invalidates old revision
delete require.cache[require.resolve('./core')] // "restart": fresh module, same files
assert.deepStrictEqual(require('./core').taskBoard(box).tasks.map(t => [t.id, t.status]), [['T2', 'doing'], ['T3', 'todo']])

// prompt: own tasks with revision, fresh and resumed
const rev3 = task('T3').revision
assert.ok(core.prompt(box, { name: 'dev', role: 'x' }).includes(rev3))
assert.ok(core.prompt(box, { name: 'dev', role: 'x' }, { id: 's', seen: 0 }).includes(rev3))
assert.ok(!core.prompt(box, { name: 'qa', role: 'x' }).includes(rev3))
const pmPrompt = core.prompt(box, { name: 'pm', role: 'x' }, { id: 's', seen: 0 }) // S4: PM sees every task, with revision
assert.ok(pmPrompt.includes(rev3) && pmPrompt.includes(task('T2').revision))
for (const f of ['preload.js', 'main.js']) assert.ok(!fs.readFileSync(path.join(__dirname, f), 'utf8').includes('setTaskStatus'), `${f} còn setTaskStatus`)
// S7 K3: prompt lists only unfinished tasks + "Đã xong N task." (per visible set); board/validator keep done tasks
assert.ok(pmPrompt.includes('Đã xong 0 task.') && core.prompt(box, { name: 'qa', role: 'x' }).includes('Đã xong 0 task.'))
commit('pm', change('T3', 'done'))
const k3 = (name, s) => core.prompt(box, { name, role: 'x' }, s)
assert.ok(!k3('pm').includes('"T3"') && k3('pm').includes('"T2"') && k3('pm').includes('Đã xong 1 task.'))
assert.ok(!k3('dev', { id: 's', seen: 0 }).includes('"T3"') && k3('dev', { id: 's', seen: 0 }).includes('Đã xong 1 task.')) // resume too
assert.ok(k3('qa').includes('"T2"') && k3('qa').includes('Đã xong 0 task.')) // T3 was dev's, not counted for qa
assert.deepStrictEqual(statuses(), [['T2', 'doing'], ['T3', 'done']]) // full board still has it
assert.strictEqual(change('T3', 'review')[0].status, 'review') // PM can still reopen via the full board revision

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
assert.ok(core.prompt(av, tv[0]).includes('run-command') && core.prompt(av, tv[0], { id: 's', seen: 0 }).includes('npm run check'))
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
  assert.strictEqual((await R('reports/bom.md')).file.content, 'xin chào')
  for (const [href, from, want] of [['../x', null, 'OUTSIDE_PROJECT'], ['%2e%2e/%2e%2e/etc/hosts', null, 'OUTSIDE_PROJECT'],
    ['reports/../../x', null, 'OUTSIDE_PROJECT'], [`../${path.basename(box)}x/s.md`, null, 'OUTSIDE_PROJECT'],
    ['reports/out.md', null, 'OUTSIDE_PROJECT'], ['/etc/hosts', null, 'OUTSIDE_PROJECT'], ['roadmap.md', '../../etc/hosts', 'OUTSIDE_PROJECT'],
    ['javascript:alert(1)', null, 'INVALID_PATH'], ['file:///etc/hosts', null, 'INVALID_PATH'], ['a\\b', null, 'INVALID_PATH'], ['%zz', null, 'INVALID_PATH'],
    ['reports/nope.md', null, 'NOT_FOUND'], ['reports/bin.dat', null, 'UNSUPPORTED'], ['reports', null, 'UNSUPPORTED'], ['reports/big.txt', null, 'TOO_LARGE']]) {
    r = await R(href, from); assert.strictEqual(r.code, want, `${href} → ${r.code}`)
  }
  assert.ok(!('file' in await R('reports/out.md'))) // no metadata for files outside the project
  assert.strictEqual((await R('reports/big.txt')).file.path, 'reports/big.txt') // TOO_LARGE keeps metadata for "open external"
}

// ---- core.run with a fake `codex` on PATH: stream split mid-UTF-8, Stop kills the process group, session survives ----
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cli-')), argsLog = path.join(bin, 'args'), pidFile = path.join(bin, 'pid')
fs.writeFileSync(path.join(bin, 'codex'), `#!${process.execPath}
const fs = require('fs'), out = s => process.stdout.write(s)
fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.env.FAKE_MODE === 'gone' && process.argv.includes('resume')) { process.stderr.write('Error: no rollout found for thread id T1\\n'); process.exit(1) }
out(JSON.stringify({ type: 'thread.started', thread_id: process.env.FAKE_TID || 'T1' }) + '\\n')
if (process.env.FAKE_MODE === 'slow') {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(require('child_process').spawn('sleep', ['30']).pid))
  out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '@pm làm tiếp' } }) + '\\n')
  setInterval(() => {}, 1000)
} else if (process.env.FAKE_MODE !== 'ok') { // Sprint 5 modes: cmd:<command>, loop, empty, empty2, task, broken
  const mode = process.env.FAKE_MODE, argv = process.argv.slice(2), p = argv[argv.length - 1], F = '\\x60'.repeat(3)
  const ask = command => 'Chạy\\n' + F + 'run-command\\n' + JSON.stringify({ command }) + '\\n' + F
  const reply = text => { if (text) out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n'); out(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: process.env.FAKE_IN === 'null' ? null : Number(process.env.FAKE_IN || 3), output_tokens: 2 } }) + '\\n') }
  if (mode === 'broken') process.exit(1)
  else if (p.includes('DỮ LIỆU KHÔNG TIN CẬY')) reply(mode === 'loop' ? ask('node ok.js') : 'kết quả ' + (/"exitCode":(\\d+|null)/.exec(p) || [])[1] + (p.includes('"error"') ? ' lỗi' : ''))
  else if (p.includes('Bạn chưa gửi tin trả lời')) reply(mode === 'empty' ? 'đã trả lời' : '')
  else if (mode.startsWith('cmd:')) reply(ask(mode.slice(4)))
  else if (mode === 'loop') reply(ask('node ok.js'))
  else if (mode === 'gone') reply('phiên mới')
  else if (mode === 'text') reply(process.env.FAKE_TEXT)
  else if (mode === 'task') reply(F + 'task-status\\n[{"id":"T1","status":"done","expectedRevision":"r"}]\\n' + F)
  else reply('')
} else {
  const b = Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'xin chào' } }) + '\\n')
  const cut = b.indexOf(Buffer.from('à')) + 1 // split inside the 2-byte "à"
  out(b.subarray(0, cut))
  setTimeout(() => { out(b.subarray(cut)); out(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } })) }, 50)
}
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
  j = await job('cmd:node fail.js'); assert.deepStrictEqual([j.text, j.commandResults[0].exitCode], ['kết quả 1 lỗi', 1]) // red stays red
  for (const bad of ['node ok.js --x', 'node', 'rm -rf x', 'node ok.js; rm x', 'node $(id)']) {
    j = await job('cmd:' + bad)
    assert.ok(j.commandResults[0].error && j.commandResults[0].exitCode === null && j.text === 'kết quả null lỗi', bad)
  }
  assert.strictEqual(ran(), 1) // nothing outside the allowlist was spawned
  j = await job('cmd:node ok.js', { ...dev5, allowedCommands: [] }); assert.ok(j.commandResults[0].error) // [] = off
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
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'pm', cli: 'claude', role: 'PM' }, { name: 'k', cli: 'codex', role: 'Dev' }]))
  // config: missing → 150000, 0 kept, old payload keeps value, junk refused
  assert.deepStrictEqual(core.team(d).map(a => a.sessionTokenLimit), [150000, 150000])
  assert.strictEqual(fs.readFileSync(agentsFile, 'utf8').includes('sessionTokenLimit'), false) // opening doesn't rewrite
  let tm = core.saveTeam(d, core.team(d).map(a => a.name === 'pm' ? { ...a, sessionTokenLimit: 0 } : a))
  assert.deepStrictEqual(tm.map(a => a.sessionTokenLimit), [0, 150000]) // each agent independent, 0 is not "default"
  tm = core.saveTeam(d, core.team(d).map(({ sessionTokenLimit, ...a }) => a)); assert.strictEqual(tm[0].sessionTokenLimit, 0)
  for (const bad of [-1, 1.5, '1', null, NaN]) assert.throws(() => core.saveTeam(d, core.team(d).map((a, i) => i ? a : { ...a, sessionTokenLimit: bad })), undefined, String(bad))
  const good = fs.readFileSync(agentsFile, 'utf8')
  fs.writeFileSync(agentsFile, JSON.stringify([{ name: 'k', cli: 'codex', role: 'Dev', sessionTokenLimit: -5 }]))
  assert.ok(core.team(d)[0].sessionConfigError)
  const bad = await core.run(d, core.team(d)[0]); assert.strictEqual(bad.outcome, 'error') // no spawn with a broken limit
  fs.writeFileSync(agentsFile, good)

  const k = core.team(d).find(a => a.name === 'k'), calls = () => fs.readFileSync(argsLog, 'utf8').trim().split('\n').length
  const go = async (env, a = k, runId) => {
    Object.assign(process.env, { FAKE_MODE: 'text', FAKE_TEXT: 'ok', FAKE_TID: 'S1', FAKE_IN: '3' }, env)
    const n = calls(), r = await core.run(d, a, { runId }); return { ...r, calls: calls() - n, args: lastArgs(), s: core.sessions(d).k }
  }
  let r = await go({ FAKE_IN: '150000' }, k, 'run-1')
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens, r.s.lastTurn.runId, r.sessionRotation], ['S1', 150000, 'run-1', null])
  assert.ok(!core.sessionRotationPending(k, r.s)) // = limit → no rotation
  r = await go({ FAKE_IN: '150001' }, k, 'run-2'); assert.ok(r.args.includes('resume') && r.args.includes('S1'))
  assert.ok(core.sessionRotationPending(k, r.s))
  core.appendLog(d, { from: 'user', text: 'tin gần đây K2' }); fs.appendFileSync(path.join(d, '.chat', 'memory.md'), '- nhớ K1\n')
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
  assert.ok(!r.args.includes('resume') && !r.args.includes('S1'), r.args.join(' '))
  const fresh = r.args[r.args.length - 1]
  for (const want of ['- nhớ K1', 'tin gần đây K2', '- đang làm K1', 'Bàn giao từ lượt gần nhất', '```handoff']) assert.ok(fresh.includes(want), want)
  assert.deepStrictEqual(r.sessionRotation, { previousSessionId: 'S1', previousRunId: 'run-2', inputTokens: 150001, limit: 150000, handoffStatus: 'current' })
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens], ['S2', 3])
  r = await go({ FAKE_TID: 'S2' }, k, 'run-4'); assert.ok(r.args.includes('resume') && r.args.includes('S2') && !r.sessionRotation)
  // limit 0 = off; changing the limit applies to the next turn
  await go({ FAKE_TID: 'S2', FAKE_IN: '200000' })
  r = await go({ FAKE_TID: 'S2' }, { ...k, sessionTokenLimit: 0 }); assert.ok(r.args.includes('resume') && !r.sessionRotation)
  await go({ FAKE_TID: 'S2', FAKE_IN: '200000' })
  r = await go({ FAKE_TID: 'S2' }, { ...k, sessionTokenLimit: 300000 }); assert.ok(r.args.includes('resume'))
  // null input → no guess; 80k + 80k in one turn (empty retry) keeps the id and only rotates the next turn
  r = await go({ FAKE_TID: 'S2', FAKE_IN: 'null' }); assert.strictEqual(r.s.lastTurn.inputTokens, null)
  r = await go({ FAKE_TID: 'S2' }); assert.ok(r.args.includes('resume'))
  r = await go({ FAKE_MODE: 'empty', FAKE_TID: 'S2', FAKE_IN: '80000' })
  assert.deepStrictEqual([r.calls, r.usage.inputTokens, r.s.lastTurn.inputTokens, r.s.id], [2, 160000, 160000, 'S2'])
  assert.ok(r.args.includes('resume') && r.args.includes('S2')) // the retry stayed in S2
  r = await go({ FAKE_TID: 'S3' }); assert.ok(!r.args.includes('resume') && r.sessionRotation?.previousSessionId === 'S2')
  // resume:false → measurement record only (id null), never resumed or rotated
  r = await go({ FAKE_TID: 'S9', FAKE_IN: '999999' }, { ...k, resume: false }, 'run-nr')
  assert.deepStrictEqual([r.s.id, r.s.lastTurn.inputTokens], [null, 999999])
  r = await go({ FAKE_TID: 'S9' }, { ...k, resume: false }, 'run-nr2'); assert.ok(!r.args.includes('resume') && !r.sessionRotation)
  // summary job (trackSession:false) does not touch the session record
  const before = JSON.stringify(core.sessions(d)); process.env.FAKE_TID = 'SX'
  await core.run(d, k, { trackSession: false, initialPrompt: 'tóm tắt' }); assert.strictEqual(JSON.stringify(core.sessions(d)), before)
  // handoff symlink is refused on read and write
  const hf = path.join(d, '.chat', 'handoff', 'k.md'); fs.rmSync(hf); fs.symlinkSync('/etc/hosts', hf)
  assert.strictEqual(core.readHandoff(d, 'k', null), null)
  assert.throws(() => core.writeHandoff(d, 'k', null, 'r', '1\n2\n3')); assert.strictEqual(fs.readlinkSync(hf), '/etc/hosts')
  for (const key of ['FAKE_TEXT', 'FAKE_TID', 'FAKE_IN']) delete process.env[key]
  // T27 (static; the popup/⚙ still need a manual look): labels from the contract and the sessions event are wired
  const ui = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  for (const s of ['Ngưỡng xoay phiên (token vào)', '0 = tắt. Áp dụng cho lượt kế tiếp.', 'Token vào lượt gần nhất', 'Chưa có số đo',
    'Tự xoay: tắt', 'Sẽ mở phiên mới ở lượt kế tiếp', 'Không nhớ phiên', "'sessions-changed'"]) assert.ok(ui.includes(s), `index.html thiếu: ${s}`)
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

  // T23: token & cost panel lives in the right column between the task board and File chung, not in the header
  const ui = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), aside = ui.indexOf('<aside>')
  const [tasksAt, statsAt, filesAt] = ['id="tasks-sec"', 'id="stats-sec"', '<h3>File chung</h3>'].map(x => ui.indexOf(x, aside))
  assert.ok(aside > 0 && aside < tasksAt && tasksAt < statsAt && statsAt < filesAt, 'panel token không nằm giữa Bảng task và File chung')
  assert.strictEqual(ui.split('id="stats"').length, 2)
}

// Run the real settings/merge handlers with a minimal DOM; no Electron/CLI lookup needed.
async function rendererChecks() {
  const ui = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), vm = require('vm'), nodes = new Map(), notices = []
  const el = (tag, className = '', textContent = '') => ({ tag, className, textContent, style: {}, children: [],
    append(...children) { this.children.push(...children) }, replaceChildren(...children) { this.children = children },
    setAttribute() {}, showModal() { this.open = true } })
  const $ = id => { if (!nodes.has(id)) nodes.set(id, el('div')); return nodes.get(id) }
  const session = { id: 'saved-session', cli: 'codex', workspaceId: 'workspace', seen: 42, at: '2026-09-27T00:00:00Z' }
  const context = vm.createContext({ $, el, structuredClone, dir: '/box', openSeq: 1, notices,
    team: [{ name: 'dev', cli: 'codex', avatar: { gender: 'male', color: '#abc' } }],
    currentSettings: { worktreesEnabled: true }, currentSettingsRevision: null,
    worktreeState: { enabled: true, agents: [{ name: 'dev', workspaceId: 'workspace' }] }, currentPopoverAgent: null,
    AVATAR_PALETTE: ['#abc'], PALETTE_NAMES: {}, createAvatarSvg: () => el('svg'), avatar: () => el('svg'),
    Option: function (label, value, defaultSelected, selected) { return { label, value, selected } },
    showToast: message => notices.push(message),
    api: { sessions: async () => ({ dev: session }), accounts: async () => ['codex'],
      models: async () => ({ models: [] }), cliSessions: async () => [],
      retryMerge: async () => ({ ok: false, error: { code: 'BUSY', message: 'merge busy' } }),
      requestMergeRepair: async () => ({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'repair rejected' } }),
      stopMerge: async () => ({ ok: false, error: { code: 'BUSY', message: 'stop busy' } }) } })
  vm.runInContext(ui.slice(ui.indexOf('  // ---- settings:'), ui.indexOf('  let gitInitToken')), context)
  await $('#gear').onclick()
  assert.strictEqual($('#settings').open, true, 'gear must open settings for agents that remember sessions')
  const all = node => [node, ...(node.children || []).flatMap(all)]
  let options = all($('#editors')).filter(node => node.value === 'saved-session')
  assert.ok(options.some(node => node.selected), 'current workspace session must be selected')
  vm.runInContext("draft[0].cli = 'claude'; renderEditors()", context)
  options = all($('#editors')).filter(node => node.value === 'saved-session')
  assert.strictEqual(options.length, 0, 'switching CLI must not reuse the previous CLI session')

  vm.runInContext(ui.slice(ui.indexOf('  // --- Sprint 6: Worktree & Merge Queue UI'), ui.indexOf('  function resizeInput()')), context)
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

// ---- Sprint 6 H + J through the real main.js: Electron stubbed, a sample git repo, a fake codex. Own process: main.js registers IPC globally ----
function mainChecks() {
  const r = require('child_process').spawnSync(process.execPath, [__filename, '--main'], { encoding: 'utf8', timeout: 300000,
    env: { ...process.env, SHELL: '/nonexistent' } }) // SHELL: main.js must not replace PATH (fake CLI) with the login shell's
  assert.strictEqual(r.status, 0, 'main.js (chuỗi agent / worktree / merge) lỗi:\n' + String(r.stdout + r.stderr).slice(-4000))
}

async function mainHarness() {
  const Module = require('module'), { execFileSync } = require('child_process')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-ud-')), handlers = {}
  const webContents = { send() {}, setWindowOpenHandler() {}, on() {} }
  const electron = { app: { getPath: () => userData, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, quit() {} },
    BrowserWindow: function () { return { webContents, loadFile: () => Promise.resolve(), isMinimized: () => false } },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn } }, dialog: {}, shell: {} }
  const load = Module._load
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : load.call(this, request, ...rest) }

  // fake codex: agent name from the prompt; FAKE_EDITS {agent: [[file, line, text]]}, FAKE_REPLY {agent: text}, FAKE_PROGRESS → touch a file
  const mbin = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-main-'))
  fs.writeFileSync(path.join(mbin, 'codex'), `#!${process.execPath}
const fs = require('fs'), p = process.argv[process.argv.length - 1], me = (/Bạn là @([\\w-]+)/.exec(p) || [])[1] || '?'
const out = o => process.stdout.write(JSON.stringify(o) + '\\n')
for (const [file, line, text] of JSON.parse(process.env.FAKE_EDITS || '{}')[me] || []) {
  const lines = fs.readFileSync(file, 'utf8').split('\\n'); lines[line] = text; fs.writeFileSync(file, lines.join('\\n'))
}
if (process.env.FAKE_PROGRESS) fs.appendFileSync('progress-' + me + '.txt', 'x')
out({ type: 'thread.started', thread_id: 'M' + process.pid })
out({ type: 'item.completed', item: { type: 'agent_message', text: JSON.parse(process.env.FAKE_REPLY || '{}')[me] || 'xong' } })
out({ type: 'turn.completed', usage: { input_tokens: Number(process.env.FAKE_IN || 1), output_tokens: 1 } })
`, { mode: 0o755 })
  process.env.PATH = mbin + path.delimiter + process.env.PATH

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-git-'))), at = f => path.join(root, f)
  core.init(root)
  fs.writeFileSync(at('.chat/agents.json'), JSON.stringify(['dev-a', 'dev-b', 'dev-c', 'dev-r'].map(name =>
    ({ name, cli: 'codex', role: 'Dev', owns: ['*.txt'], resume: name === 'dev-r', allowedCommands: ['npm run check'],
      ...(name === 'dev-r' ? { sessionTokenLimit: 100 } : {}) }))))
  fs.writeFileSync(at('a.txt'), Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'))
  fs.writeFileSync(at('package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { check: 'node chk.js' } }))
  fs.writeFileSync(at('chk.js'), 'if (require("fs").readFileSync("a.txt", "utf8").includes("RED")) { console.error("check đỏ"); process.exit(1) }')
  fs.writeFileSync(at('.gitignore'), '.chat/\nnode_modules/\n'); fs.mkdirSync(at('node_modules')); fs.writeFileSync(at('node_modules/.keep'), '')
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=QA', '-c', 'user.email=qa@local', ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main'); git('add', 'a.txt', 'package.json', 'chk.js', '.gitignore'); git('commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify([root]))

  require('./main'); await new Promise(r => setImmediate(r))
  const ev = { sender: webContents }, call = (name, ...args) => handlers[name](ev, ...args)
  await call('open', root)
  const log = () => core.readLog(root), queue = () => { try { return JSON.parse(fs.readFileSync(at('.chat/worktrees.json'), 'utf8')).queue } catch { return [] } }
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
  assert.deepStrictEqual([sm['dev-r'].lastTurn.inputTokens, sm['dev-r'].sessionTokenLimit, sm['dev-r'].rotationPending], [500, 100, true])
  process.env.FAKE_IN = '1'; mark = log().length; await call('send', root, '@dev-r tiếp')
  const rotated = await waitFor('tin xoay phiên', () => log().slice(mark).find(m => m.kind === 'session-rotated'))
  assert.ok(rotated.text.includes('dev-r mở phiên mới') && rotated.text.includes('vượt ngưỡng 100'), rotated.text)
  await waitFor('trả lời dev-r lần 2', () => log().slice(mark).some(m => m.from === 'dev-r'))
  sm = await call('sessions', root); assert.deepStrictEqual([sm['dev-r'].lastTurn.inputTokens, sm['dev-r'].rotationPending], [1, false])
  assert.ok(!log().some(m => m.from === 'dev-a')) // "@dev-a" inside the handoff never routed
  delete process.env.FAKE_REPLY; delete process.env.FAKE_IN

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
  assert.ok(log().some(m => m.from === 'system' && m.text.startsWith('@dev-a chưa gộp được nhánh')))
  assert.strictEqual(lines()[0], 'l0')
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
  const legacy = JSON.parse(fs.readFileSync(at('.chat/worktrees.json'), 'utf8'))
  delete legacy.queue[0].supersededBy
  fs.writeFileSync(at('.chat/worktrees.json'), JSON.stringify(legacy))
  visible = (await call('worktreeState', root)).state.queue
  const old = visible.find(e => e.id === blockedId)
  assert.strictEqual(old.state, 'merged'); assert.strictEqual(old.error, null); assert.strictEqual(old.canRetry, false)
  // Historical check-failure messages must not schedule paid repair turns once resolved.
  legacy.queue[0].state = 'check-failed'; legacy.queue[0].error = { code: 'CHECK_FAILED', message: 'old check failure' }
  for (const supersededBy of [legacy.queue[1].id, undefined]) {
    legacy.queue[0].supersededBy = supersededBy
    fs.writeFileSync(at('.chat/worktrees.json'), JSON.stringify(legacy))
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
  assert.ok(log().some(m => m.from === 'system' && m.text.startsWith('@dev-c chưa gộp được nhánh')))

  // two devs edit different lines of the same file in parallel → both merged automatically
  await edit({ 'dev-a': [['a.txt', 2, 'A2']], 'dev-b': [['a.txt', 8, 'B8']] }, '@dev-a @dev-b sửa a.txt')
  entries = await settle(2, 'merge song song khác dòng')
  assert.deepStrictEqual(entries.map(e => e.state), ['merged', 'merged']); assert.deepStrictEqual([lines()[2], lines()[8]], ['A2', 'B8']); clean()

  // same line → the first merges, the second gets a conflict message naming the file
  await edit({ 'dev-a': [['a.txt', 4, 'A4']], 'dev-b': [['a.txt', 4, 'B4']] }, '@dev-a @dev-b cùng sửa dòng 4')
  entries = await settle(2, 'merge cùng dòng')
  const lost = entries.find(e => e.state === 'conflict'), won = entries.find(e => e.state === 'merged')
  assert.ok(lost && won, JSON.stringify(entries.map(e => [e.agent, e.state])))
  assert.deepStrictEqual(lost.error.files, ['a.txt']); assert.strictEqual(lines()[4], won.agent === 'dev-a' ? 'A4' : 'B4'); clean()
  assert.ok(log().some(m => m.from === 'system' && m.text.startsWith(`@${lost.agent} chưa gộp được nhánh`)))

  // A stopped pending retry stays paused, without overwriting other queue entries.
  const stoppedConfig = core.projectSettings(root)
  core.writeProjectSettings(root, { ...stoppedConfig.settings, worktreesEnabled: false }, stoppedConfig.revision)
  assert.ok((await call('retryMerge', root, { queueId: lost.id })).ok)
  const pending = queue().at(-1), otherEntries = queue().slice(0, -1)
  assert.strictEqual(pending.state, 'queued')
  assert.ok((await call('stopMerge', root, { queueId: pending.id })).ok)
  assert.strictEqual(queue().at(-1).state, 'paused')
  assert.deepStrictEqual(queue().slice(0, -1), otherEntries)
}
auditChecks().then(viewerChecks).then(runChecks).then(sprint7Checks).then(sprint6Checks).then(rendererChecks).then(mainChecks).then(() => console.log('ok'), e => { console.error(e); process.exit(1) })
