const { app, BrowserWindow, ipcMain, Notification } = require('electron')
const path = require('path')
const { Client } = require('ssh2')
const pty = require('node-pty')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development'
console.log('Node Version:', process.versions.node);
console.log('Electron Version:', process.versions.electron);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0e1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#161b22',
      symbolColor: '#8b949e',
      height: 42,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── SSH ───────────────────────────────────────────────────────────────────────
const sshSessions = new Map()

ipcMain.handle('ssh:connect', async (event, { id, host, port, username, password, privateKey }) => {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
        if (err) return reject(err.message)
        sshSessions.set(id, { conn, stream })

        stream.on('data', (data) => {
          event.sender.send(`ssh:data:${id}`, data.toString('utf8'))
        })
        stream.stderr.on('data', (data) => {
          event.sender.send(`ssh:data:${id}`, data.toString('utf8'))
        })
        stream.on('close', () => {
          event.sender.send(`ssh:close:${id}`)
          sshSessions.delete(id)
        })
        resolve({ ok: true })
      })
    })

    conn.on('error', (err) => reject(err.message))

    const cfg = { host, port: port || 22, username, readyTimeout: 10000, keepaliveInterval: 30000 }
    if (privateKey) cfg.privateKey = privateKey
    else cfg.password = password
    conn.connect(cfg)
  })
})

ipcMain.on('ssh:input',      (_, { id, data })       => { sshSessions.get(id)?.stream?.write(data) })
ipcMain.on('ssh:resize',     (_, { id, cols, rows }) => { sshSessions.get(id)?.stream?.setWindow(rows, cols, 0, 0) })
ipcMain.on('ssh:disconnect', (_, { id }) => {
  const s = sshSessions.get(id)
  if (s) { s.stream?.close(); s.conn?.end(); sshSessions.delete(id) }
})

// ── Local PTY ─────────────────────────────────────────────────────────────────
const localSessions = new Map()

ipcMain.handle('local:connect', async (event, { id }) => {
  return new Promise((resolve, reject) => {
    try {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        // useConpty: false
      })

      localSessions.set(id, ptyProcess)

      ptyProcess.onData((data) => {
        event.sender.send(`local:data:${id}`, data)
      })

      ptyProcess.onExit(() => {
        event.sender.send(`local:close:${id}`)
        localSessions.delete(id)
      })

      resolve({ ok: true })
    } catch (err) {
      reject(err.message)
    }
  })
})

ipcMain.on('local:input',      (_, { id, data })       => { localSessions.get(id)?.write(data) })
ipcMain.on('local:resize',     (_, { id, cols, rows }) => { localSessions.get(id)?.resize(cols, rows) })
ipcMain.on('local:disconnect', (_, { id }) => {
  localSessions.get(id)?.kill()
  localSessions.delete(id)
})

// ── 알림 ──────────────────────────────────────────────────────────────────────
ipcMain.on('notify', (_, { title, body }) => {
  new Notification({ title, body }).show()
})