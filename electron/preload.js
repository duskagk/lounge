const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // SSH
  sshConnect:    (cfg)            => ipcRenderer.invoke('ssh:connect', cfg),
  sshInput:      (id, data)       => ipcRenderer.send('ssh:input', { id, data }),
  sshResize:     (id, cols, rows) => ipcRenderer.send('ssh:resize', { id, cols, rows }),
  sshDisconnect: (id)             => ipcRenderer.send('ssh:disconnect', { id }),
  sshCheckin:    (id)             => ipcRenderer.invoke('ssh:checkin', { id }),
  onSshData:     (id, cb)         => ipcRenderer.on(`ssh:data:${id}`, (_, d) => cb(d)),
  onSshClose:    (id, cb)         => ipcRenderer.on(`ssh:close:${id}`, cb),
  offSshData:    (id, cb)         => ipcRenderer.removeListener(`ssh:data:${id}`, cb),
  offSshClose:   (id, cb)         => ipcRenderer.removeListener(`ssh:close:${id}`, cb),

  // Local PTY
  localCheckin:    ()               => ipcRenderer.invoke('local:checkin'),
  localConnect:    (id, cwd)        => ipcRenderer.invoke('local:connect', { id, cwd }),
  localInput:      (id, data)       => ipcRenderer.send('local:input', { id, data }),
  localResize:     (id, cols, rows) => ipcRenderer.send('local:resize', { id, cols, rows }),
  localDisconnect: (id)             => ipcRenderer.send('local:disconnect', { id }),
  onLocalData:     (id, cb)         => ipcRenderer.on(`local:data:${id}`, (_, d) => cb(d)),
  onLocalClose:    (id, cb)         => ipcRenderer.on(`local:close:${id}`, cb),
  offLocalData:    (id, cb)         => ipcRenderer.removeListener(`local:data:${id}`, cb),
  offLocalClose:   (id, cb)         => ipcRenderer.removeListener(`local:close:${id}`, cb),

  // 클립보드
  readClipboard:  ()     => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard:write', text),

  // 파일/폴더 탐색
  browseFile:   () => ipcRenderer.invoke('dialog:openFile'),
  browseFolder: () => ipcRenderer.invoke('dialog:openFolder'),

  // 프로필 (SQLite 영구 저장)
  getProfiles:   ()  => ipcRenderer.invoke('profiles:getAll'),
  saveProfile:   (p) => ipcRenderer.invoke('profiles:save', p),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),

  // 알림
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),

  // 설정
  getSettings:  ()       => ipcRenderer.invoke('settings:get'),
  saveSettings: (s)      => ipcRenderer.invoke('settings:set', s),

  // 터미널 로그
  logAppend:       (data) => ipcRenderer.invoke('log:append', data),
  logSearch:       (opts) => ipcRenderer.invoke('log:search', opts),
  logPurge:        (opts) => ipcRenderer.invoke('log:purge', opts),
  logClearSession: (sessionId) => ipcRenderer.invoke('log:clear-session', { sessionId }),
  logCount:        (opts) => ipcRenderer.invoke('log:count', opts),
})
