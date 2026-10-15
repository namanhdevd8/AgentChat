// Focused, opt-in probe. One Electron launch; no CLI agents and no production data.
// Run: node reports/sprint-12-electron-comparison.cjs
const fs = require('fs'), path = require('path'), os = require('os')
const { spawnSync, execFileSync } = require('child_process')
const { createHash, randomUUID } = require('crypto')
const repo = path.resolve(__dirname, '..'), prefix = path.join(__dirname, 'sprint-12-electron-comparison')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-s12-electron-'))
const appDir = path.join(tmp, 'app'), ud = path.join(tmp, 'userData'), root = path.join(fs.realpathSync(tmp), 'project')
for (const d of [appDir, ud, root]) fs.mkdirSync(d)
const core = require(path.join(repo, 'core.js'))
core.init(root)
const otherBox = core.createBox(root, { copyFrom: '.chat' })
const parent = randomUUID(), child = randomUUID(), otherStop = randomUUID(), at = new Date().toISOString()
const source = { from: 'user', text: '@pm fixture chưa cấp lượt', at }
const stop = { from: 'system', text: 'Dừng fixture', kind: 'chain-stop', stopId: parent, chainId: parent, targets: ['pm'], at }
const ref = (m, seq) => ({ seq, at: m.at, textHash: createHash('sha256').update(m.text).digest('hex') })
const pending = [{ agent: 'pm', sourceRefs: [ref(source, 0)], taskIds: [], uncertain: false }]
const view = { stopId: parent, chainId: parent, box: '.chat', revision: '3', phase: 'continued',
  reason: { code: 'no-progress', text: 'Fixture' }, threshold: 3, idleRunIds: [], turns: 3, limit: 12,
  costUsd: 0, costIncomplete: false, pending: [{ agent: 'pm', sourceSeqs: [0], taskIds: [], uncertain: false }],
  running: [], canContinue: false, continuedTo: child }
const record = { stopId: parent, chainId: parent, pending, running: [], accountedRunIds: [], sourceRefs: [ref(source, 0)], logMessageRef: ref(stop, 1), state: view }
const ctrlDir = path.join(ud, 'worktrees', createHash('sha256').update(root).digest('hex'))
fs.mkdirSync(ctrlDir, { recursive: true })
fs.writeFileSync(path.join(root, '.chat/log.jsonl'), [source, stop].map(m => JSON.stringify(m)).join('\n') + '\n')
fs.writeFileSync(path.join(ctrlDir, 'control.chat.json'), JSON.stringify({ version: 1, stops: { [parent]: record }, claims: {
  ['continue:' + parent]: { kind: 'continue', stopId: parent, childChainId: child, at,
    dispatches: [{ agent: 'pm', state: 'reserved', runId: null, sourceRefs: [ref(source, 0)], taskIds: [] }] }
} }))
// The second box deliberately uses the same log seq as the recovered child's stop (3).
const stop2 = { ...stop, stopId: otherStop, chainId: otherStop, canContinue: true }
const otherView = { ...view, stopId: otherStop, chainId: otherStop, box: otherBox, revision: '1', phase: 'ready', canContinue: true, continuedTo: null }
fs.writeFileSync(path.join(root, otherBox, 'log.jsonl'), [source, source, source, stop2].map(m => JSON.stringify(m)).join('\n') + '\n')
fs.writeFileSync(path.join(ctrlDir, `control${otherBox}.json`), JSON.stringify({ version: 1, claims: {}, stops: {
  [otherStop]: { ...record, stopId: otherStop, chainId: otherStop, logMessageRef: ref(stop2, 3), state: otherView }
} }))
fs.writeFileSync(path.join(ud, 'projects.json'), JSON.stringify([root]))
for (const f of fs.readdirSync(repo)) fs.symlinkSync(path.join(repo, f), path.join(appDir, f))
fs.writeFileSync(path.join(appDir, 'probe-entry.cjs'), `(${electronEntry})()`)
const binary = require('electron'), start = Date.now()
const run = spawnSync(binary, [path.join(appDir, 'probe-entry.cjs')], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL',
  env: { ...process.env, SHELL: '/nonexistent', PROBE_MAIN: path.join(appDir, 'main.js'), PROBE_ROOT: root, PROBE_UD: ud,
    PROBE_CHILD: child, PROBE_BOX: otherBox, PROBE_OTHER_VIEW: JSON.stringify(otherView) } })
fs.writeFileSync(prefix + '.stdout.txt', run.stdout || '')
fs.writeFileSync(prefix + '.stderr.txt', run.stderr || '')
const resultLine = (run.stdout || '').split('\n').find(l => l.startsWith('RESULT '))
const result = resultLine ? JSON.parse(resultLine.slice(7)) : null
const meta = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  startedAt: new Date(start).toISOString(), durationMs: Date.now() - start, binary, realBinary: fs.realpathSync(binary),
  electronPackage: require('electron/package.json').version, node: process.version, platform: process.platform, arch: process.arch,
  shellOverride: '/nonexistent', timeoutMs: 60000, permissionContext: 'techlead / danger-full-access (existing permissions)',
  exitCode: run.status, signal: run.signal, error: run.error?.message || null,
  enteredJavaScript: (run.stdout || '').includes('PHASE javascript'), enteredFixture: (run.stdout || '').includes('PHASE fixture'), result }
fs.writeFileSync(prefix + '.json', JSON.stringify(meta, null, 2) + '\n')
console.log(JSON.stringify(meta, null, 2))
fs.rmSync(tmp, { recursive: true, force: true })
process.exitCode = run.status === 0 && result?.results?.length && result.results.every(r => r.ok) ? 0 : 1

async function electronEntry() {
  console.log('PHASE javascript ' + new Date().toISOString())
  const { app, BrowserWindow, ipcMain } = require('electron')
  const assert = require('assert'), fs = require('fs'), path = require('path')
  const root = process.env.PROBE_ROOT, otherBox = process.env.PROBE_BOX, results = [], errors = []
  app.setPath('userData', process.env.PROBE_UD)
  const finish = (code, error = null) => {
    console.log('RESULT ' + JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, results, errors, error }))
    app.exit(code)
  }
  process.on('uncaughtException', e => { errors.push(String(e.stack || e)); finish(1, 'uncaughtException') })
  process.on('unhandledRejection', e => { errors.push(String(e?.stack || e)); finish(1, 'unhandledRejection') })
  setTimeout(() => finish(2, 'fixture timeout 45s'), 45000)
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const until = async (label, f) => {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) { const v = await f(); if (v) return v; await sleep(20) }
    throw new Error('Timeout: ' + label)
  }
  const check = async (name, f) => {
    try { const info = await f(); results.push({ name, ok: true, info: info ?? null }); console.log('PASS ' + name) }
    catch (e) { results.push({ name, ok: false, error: String(e.stack || e) }); throw e }
  }
  try {
    require(process.env.PROBE_MAIN)
    await app.whenReady()
    console.log('PHASE ready ' + new Date().toISOString())
    const win = await until('main window', () => BrowserWindow.getAllWindows()[0])
    win.webContents.on('render-process-gone', (_, details) => finish(1, 'renderer gone: ' + JSON.stringify(details)))
    const js = code => win.webContents.executeJavaScript(code, true)
    await until('renderer loaded', async () => !win.webContents.isLoadingMainFrame() && await js('typeof openProject === "function"'))
    win.focus(); win.webContents.focus()
    const core = require(path.join(path.dirname(process.env.PROBE_MAIN), 'core.js'))
    core.trustConfig(root, core.configTrust(root).texts)
    await js(`openProject(${JSON.stringify(root)}, '.chat')`)
    await js('refreshNeeds()')
    const messages = await js(`api.logPage(${JSON.stringify(root)})`)
    const message = messages.page.messages.find(m => m.kind === 'chain-stop' && m.chainId === process.env.PROBE_CHILD)
    assert.ok(message && Number.isInteger(message.seq), 'recovery must post child with real seq')
    const recovered = await js(`api.chainState(${JSON.stringify(root)}, {messageId:${message.seq}})`)
    assert.ok(recovered.ok)
    let state = recovered.state, readReply = recovered, releaseContinue, requests = [], reads = []
    console.log('PHASE fixture ' + new Date().toISOString())
    console.log('RECOVERED ' + JSON.stringify({ message, state }))
    await js(`window.__probeSeq=${message.seq}; window.__probeSeen=0;
      api.on('chain-changed', () => window.__probeSeen++);
      window.__chatButton=()=>document.querySelector('#log [data-seq="'+window.__probeSeq+'"] .chain-stop-actions button');
      window.__needCard=()=>[...document.querySelectorAll('#needs .need')][needs.findIndex(n=>n.seq===window.__probeSeq)];
      window.__needButton=()=>window.__needCard()?.querySelector('.need-actions button');
      window.__verifyButton=(where)=>[...(where==='chat'?document.querySelector('#log [data-seq="'+window.__probeSeq+'"] .chain-stop-actions'):window.__needCard().querySelector('.need-actions')).querySelectorAll('button')].find(b=>b.textContent==='Kiểm tra lại');
      window.__both=(disabled)=>[window.__chatButton(),window.__needButton()].every(b=>b && b.disabled===disabled);`)
    await check('Recovery BE thật -> interrupted/canContinue:true; hai nút bật', async () => {
      assert.ok(state.phase === 'interrupted' && state.canContinue && state.pending.some(p => !p.uncertain))
      await until('both enabled', () => js('__both(false)'))
      return { seq: message.seq, phase: state.phase, canContinue: state.canContinue }
    })
    // Only the two action responses are now controlled. The real preload/IPC transport and renderer stay intact.
    ipcMain.removeHandler('continueChain')
    ipcMain.handle('continueChain', (event, dir, request) => {
      assert.strictEqual(event.senderFrame, win.webContents.mainFrame)
      requests.push({ dir, request }); return new Promise(resolve => { releaseContinue = resolve })
    })
    ipcMain.removeHandler('chainState')
    ipcMain.handle('chainState', (event, dir, request) => {
      assert.strictEqual(event.senderFrame, win.webContents.mainFrame)
      reads.push({ dir, request })
      return core.chatName(root) === otherBox ? { ok: true, state: JSON.parse(process.env.PROBE_OTHER_VIEW) } : readReply
    })
    const emit = async value => {
      const seen = await js('__probeSeen')
      win.webContents.send('chain-changed', root, value)
      await until('chain-changed delivered', async () => await js('__probeSeen') > seen)
    }
    const fail = async where => {
      const count = requests.length
      await js(`window.__${where}Button().click()`)
      await until('continue reaches main', () => requests.length === count + 1)
      releaseContinue({ ok: false, error: { code: 'PROBE_ERROR', message: 'Lỗi API mô phỏng' } })
      await until('error stored', () => js(`chainErrors.has(String(__probeSeq)) && !continuingChains.size`))
    }
    const verify = async (where, reply) => {
      readReply = reply; const count = reads.length
      await js(`window.__verification=window.__verifyButton('${where}'); if(!__verification) throw Error('missing Kiểm tra lại'); __verification.click()`)
      await until('verification finished', async () => reads.length > count && await js('!__verification.disabled'))
    }
    await check('Bấm trùng chat/Cần bạn chỉ gửi một request đúng seq', async () => {
      await js('__needButton().click(); __needButton().click(); __chatButton().click()')
      await until('one request pending', () => requests.length === 1)
      assert.strictEqual(requests[0].request.messageId, message.seq); assert.strictEqual(requests[0].dir, root)
      releaseContinue({ ok: false, error: { message: 'Lỗi API mô phỏng' } })
      await until('both locked', () => js('__both(true) && !continuingChains.size'))
      assert.strictEqual(requests.length, 1)
      return requests[0].request
    })
    await check('Lỗi API giữ qua render/event khác stop; chat và Cần bạn cùng khóa', async () => {
      await emit({ ...state, stopId: 'unrelated', chainId: 'unrelated', revision: '100' })
      await js('renderNeeds()'); assert.ok(await js('__both(true)'))
      for (const v of [state, { ...state, revision: '0' }, { ...state, box: otherBox, revision: '101' }]) {
        await emit(v); assert.ok(await js('__both(true)'))
      }
    })
    await check('Kiểm tra lại sai stop/box hoặc lỗi không mở khóa', async () => {
      const before = requests.length
      for (const reply of [{ ok: false }, { ok: true, state: { ...state, stopId: 'wrong' } }, { ok: true, state: { ...state, box: otherBox } }]) {
        await verify('need', reply); assert.ok(await js('__both(true)'))
      }
      assert.strictEqual(requests.length, before)
    })
    await check('Xác nhận mới false vẫn khóa; true mở cả hai; lỗi từ chat cũng giữ', async () => {
      state = { ...state, revision: String(Number(state.revision) + 1), canContinue: false }
      await emit(state); assert.ok(await js('__both(true)'))
      state = { ...state, revision: String(Number(state.revision) + 1), canContinue: true }
      await emit(state); assert.ok(await js('__both(false)'))
      await fail('chat'); await js('renderNeeds()'); assert.ok(await js('__both(true)'))
    })
    await check('Kiểm tra lại đúng stop cùng revision mở cả hai, chưa chạy agent', async () => {
      const before = requests.length
      await verify('need', { ok: true, state }); assert.ok(await js('__both(false)'))
      assert.strictEqual(requests.length, before)
    })
    await check('Response thành công hiển thị Đã tiếp tục ở cả hai nơi', async () => {
      const before = requests.length
      await js('__needButton().click()'); await until('request', () => requests.length === before + 1)
      releaseContinue({ ok: true, chainId: 'probe-child', state: { ...state, revision: String(Number(state.revision) + 1), phase: 'continued', canContinue: false } })
      await until('both continued', () => js('__both(true) && __chatButton().textContent === "Đã tiếp tục" && __needButton().textContent === "Đã tiếp tục"'))
    })
    await check('Đổi box: response cũ không ghi lỗi vào cùng seq ở box mới', async () => {
      readReply = recovered
      await js(`openProject(${JSON.stringify(root)}, '.chat');`); await js('refreshNeeds()')
      await until('reset fixture controls', () => js('__both(false)'))
      const before = requests.length
      await js('window.__oldButton=__needButton(); __oldButton.click()')
      await until('pending old box', () => requests.length === before + 1)
      await js(`openProject(${JSON.stringify(root)}, ${JSON.stringify(otherBox)})`); await js('refreshNeeds()')
      await until('new box ready', () => js(`box===${JSON.stringify(otherBox)} && __both(false)`))
      releaseContinue({ ok: false, error: { message: 'Lỗi từ box cũ' } })
      await until('old request handled', () => js('!continuingChains.size'))
      // Wait behind the response on the real IPC path before evaluating the new box.
      await js('api.chainState(dir, {messageId:__probeSeq})')
      assert.ok(await js('__both(false) && chainErrors.size===0'))
      await js('__oldButton.disabled=false; __oldButton.click()')
      await js('api.chainState(dir, {messageId:__probeSeq})')
      assert.strictEqual(requests.length, before + 1)
    })
    await check('Cần bạn embedded/fallback giữ lỗi khi không có cache chat', async () => {
      await js(`openProject(${JSON.stringify(root)}, '.chat')`); await js('refreshNeeds()')
      for (const mode of ['embedded', 'fallback']) {
        state = { ...recovered.state, stopId: 'probe-' + mode, chainId: 'probe-' + mode, revision: '1' }
        readReply = { ok: true, state }
        const item = { kind: 'chain', seq: message.seq, text: mode, stopId: state.stopId,
          ...(mode === 'embedded' ? { chainView: state } : state) }
        await js(`chainViewsByMsg.clear(); chainStopUpdateCallbacks.clear(); chainErrors.clear(); $('#log').replaceChildren(); needs=[${JSON.stringify(item)}]; renderNeeds()`)
        await fail('need')
        await emit({ ...state, stopId: 'other-' + mode, revision: '100' })
        assert.ok(await js('__needButton().disabled'))
        await verify('need', { ok: true, state }); assert.ok(await js('!__needButton().disabled'))
      }
    })
    finish(0)
  } catch (e) { finish(1, String(e.stack || e)) }
}
