const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  projects: () => ipcRenderer.invoke('projects'),
  pick: () => ipcRenderer.invoke('pick'),
  open: (dir, chat) => ipcRenderer.invoke('open', dir, chat),
  logPage: (dir, options) => ipcRenderer.invoke('logPage', dir, options),
  searchLog: (dir, options) => ipcRenderer.invoke('searchLog', dir, options),
  projectSettings: dir => ipcRenderer.invoke('projectSettings', dir),
  saveProjectSettings: (dir, request) => ipcRenderer.invoke('saveProjectSettings', dir, request),
  worktreeState: dir => ipcRenderer.invoke('worktreeState', dir),
  prepareGitInit: dir => ipcRenderer.invoke('prepareGitInit', dir),
  initGit: (dir, request) => ipcRenderer.invoke('initGit', dir, request),
  retryMerge: (dir, request) => ipcRenderer.invoke('retryMerge', dir, request),
  stopMerge: (dir, request) => ipcRenderer.invoke('stopMerge', dir, request),
  requestMergeRepair: (dir, request) => ipcRenderer.invoke('requestMergeRepair', dir, request),
  files: dir => ipcRenderer.invoke('files', dir),
  continueChain: (dir, request) => ipcRenderer.invoke('continueChain', dir, request),
  send: (dir, text) => ipcRenderer.invoke('send', dir, text),
  tasks: dir => ipcRenderer.invoke('tasks', dir),
  readProjectFile: (dir, href, fromFile = null, workspaceId = null) => ipcRenderer.invoke('readProjectFile', dir, href, fromFile, workspaceId),
  watchProject: (dir, file = null, workspaceId = null) => ipcRenderer.invoke('watchProject', dir, file, workspaceId),
  stop: (dir, name, runId) => ipcRenderer.invoke('stop', dir, name, runId),
  openFile: (dir, file, workspaceId = null) => ipcRenderer.invoke('openFile', dir, file, workspaceId),
  openLink: (dir, href) => ipcRenderer.invoke('openLink', dir, href),
  releaseLock: (dir, runId) => ipcRenderer.invoke('releaseLock', dir, runId),
  probeAgents: (dir, members) => ipcRenderer.invoke('probeAgents', dir, members),
  saveTeam: (dir, team, options) => ipcRenderer.invoke('saveTeam', dir, team, options),
  grantPermissionAndRetry: (dir, request) => ipcRenderer.invoke('grantPermissionAndRetry', dir, request),
  accounts: () => ipcRenderer.invoke('accounts'),
  sessions: dir => ipcRenderer.invoke('sessions', dir),
  cliSessions: (cli, dir, agentName = null) => ipcRenderer.invoke('cliSessions', cli, dir, agentName),
  models: cli => ipcRenderer.invoke('models', cli),
  useSession: (dir, name, cli, id, workspaceId = null) => ipcRenderer.invoke('useSession', dir, name, cli, id, workspaceId),
  resetSession: (dir, name) => ipcRenderer.invoke('resetSession', dir, name),
  on: (channel, fn) => {
    const handler = (_, ...args) => fn(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
