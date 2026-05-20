const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // SSH
  sshConnect:    (cfg)            => ipcRenderer.invoke('ssh:connect', cfg),
  sshInput:      (id, data)       => ipcRenderer.send('ssh:input', { id, data }),
  sshResize:     (id, cols, rows) => ipcRenderer.send('ssh:resize', { id, cols, rows }),
  sshDisconnect: (id)             => ipcRenderer.send('ssh:disconnect', { id }),
  onSshData:     (id, cb)         => ipcRenderer.on(`ssh:data:${id}`, (_, d) => cb(d)),
  onSshClose:    (id, cb)         => ipcRenderer.on(`ssh:close:${id}`, cb),
  offSshData:    (id, cb)         => ipcRenderer.removeListener(`ssh:data:${id}`, cb),
  offSshClose:   (id, cb)         => ipcRenderer.removeListener(`ssh:close:${id}`, cb),

  // Local PTY
  localConnect:    (id)             => ipcRenderer.invoke('local:connect', { id }),
  localInput:      (id, data)       => ipcRenderer.send('local:input', { id, data }),
  localResize:     (id, cols, rows) => ipcRenderer.send('local:resize', { id, cols, rows }),
  localDisconnect: (id)             => ipcRenderer.send('local:disconnect', { id }),
  onLocalData:     (id, cb)         => ipcRenderer.on(`local:data:${id}`, (_, d) => cb(d)),
  onLocalClose:    (id, cb)         => ipcRenderer.on(`local:close:${id}`, cb),
  offLocalData:    (id, cb)         => ipcRenderer.removeListener(`local:data:${id}`, cb),
  offLocalClose:   (id, cb)         => ipcRenderer.removeListener(`local:close:${id}`, cb),

  // 알림
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
})
