// node check.js — sanity check for @mention routing, project files, stream parsers, usage and Stop
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path')
const core = require('./core')

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
out(JSON.stringify({ type: 'thread.started', thread_id: 'T1' }) + '\\n')
if (process.env.FAKE_MODE === 'slow') {
  fs.writeFileSync(${JSON.stringify(pidFile)}, String(require('child_process').spawn('sleep', ['30']).pid))
  out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '@pm làm tiếp' } }) + '\\n')
  setInterval(() => {}, 1000)
} else if (process.env.FAKE_MODE !== 'ok') { // Sprint 5 modes: cmd:<command>, loop, empty, empty2, task, broken
  const mode = process.env.FAKE_MODE, argv = process.argv.slice(2), p = argv[argv.length - 1], F = '\\x60'.repeat(3)
  const ask = command => 'Chạy\\n' + F + 'run-command\\n' + JSON.stringify({ command }) + '\\n' + F
  const reply = text => { if (text) out(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) + '\\n'); out(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } }) + '\\n') }
  if (mode === 'broken') process.exit(1)
  else if (p.includes('DỮ LIỆU KHÔNG TIN CẬY')) reply(mode === 'loop' ? ask('node ok.js') : 'kết quả ' + (/"exitCode":(\\d+|null)/.exec(p) || [])[1] + (p.includes('"error"') ? ' lỗi' : ''))
  else if (p.includes('Bạn chưa gửi tin trả lời')) reply(mode === 'empty' ? 'đã trả lời' : '')
  else if (mode.startsWith('cmd:')) reply(ask(mode.slice(4)))
  else if (mode === 'loop') reply(ask('node ok.js'))
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
}
auditChecks().then(viewerChecks).then(runChecks).then(() => console.log('ok'), e => { console.error(e); process.exit(1) })
