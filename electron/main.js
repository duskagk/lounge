const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { Client } = require('ssh2')
const pty = require('node-pty')
const os = require('os')

const isDev = process.env.NODE_ENV === 'development'
console.log('Node Version:', process.versions.node)
console.log('Electron Version:', process.versions.electron)

let db

function initDB() {
  const Database = require('better-sqlite3')
  const dbPath = path.join(app.getPath('userData'), 'wterm.db')
  db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id           TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL,
      type         TEXT    NOT NULL DEFAULT 'ssh',
      host         TEXT    DEFAULT '',
      port         INTEGER DEFAULT 22,
      username     TEXT    DEFAULT '',
      password     TEXT    DEFAULT '',
      private_key  TEXT    DEFAULT '',
      cwd          TEXT    DEFAULT '',
      key_path     TEXT    DEFAULT '',
      auto_connect INTEGER DEFAULT 0,
      sort_order   INTEGER DEFAULT 0,
      created_at   INTEGER NOT NULL
    )
  `)
  // 기존 DB 마이그레이션
  try { db.exec(`ALTER TABLE profiles ADD COLUMN cwd      TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN key_path TEXT DEFAULT ''`) } catch (_) {}
}

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
  initDB()
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

ipcMain.handle('ssh:connect', async (event, { id, host, port, username, password, privateKey, keyPath }) => {
  return new Promise((resolve, reject) => {
    // keyPath가 있으면 파일에서 키를 읽어옴, 없으면 직접 입력한 키 사용
    let resolvedKey = privateKey || ''
    if (keyPath) {
      try {
        resolvedKey = fs.readFileSync(keyPath.trim(), 'utf8')
      } catch (err) {
        return reject(`키 파일을 읽을 수 없습니다: ${keyPath}\n${err.message}`)
      }
    }

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

    // keyboard-interactive 인증 (Ubuntu 등 많은 서버가 password 대신 이 방식 사용)
    conn.on('keyboard-interactive', (_name, _inst, _lang, prompts, finish) => {
      finish(prompts.map(() => password || ''))
    })

    conn.on('error', (err) => reject(err.message))

    const cfg = {
      host,
      port:              port || 22,
      username,
      readyTimeout:      10000,
      keepaliveInterval: 30000,
      tryKeyboard:       true,   // keyboard-interactive 인증 시도 허용
    }
    if (resolvedKey)   cfg.privateKey = resolvedKey
    else if (password) cfg.password   = password   // 빈 문자열이면 아예 안 보냄
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

ipcMain.handle('local:connect', async (event, { id, cwd }) => {
  return new Promise((resolve, reject) => {
    try {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash')
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
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

// ── 프로필 (SQLite) ───────────────────────────────────────────────────────────
ipcMain.handle('profiles:getAll', () => {
  return db.prepare(
    'SELECT * FROM profiles ORDER BY sort_order ASC, created_at ASC'
  ).all().map(r => ({
    id:          r.id,
    name:        r.name,
    type:        r.type,
    host:        r.host,
    port:        r.port,
    username:    r.username,
    password:    r.password,
    privateKey:  r.private_key,
    keyPath:     r.key_path,
    cwd:         r.cwd,
    autoConnect: r.auto_connect === 1,
    sortOrder:   r.sort_order,
  }))
})

ipcMain.handle('profiles:save', (_, p) => {
  db.prepare(`
    INSERT INTO profiles
      (id, name, type, host, port, username, password, private_key, key_path, cwd, auto_connect, sort_order, created_at)
    VALUES
      (@id, @name, @type, @host, @port, @username, @password, @privateKey, @keyPath, @cwd, @autoConnect, @sortOrder, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      name=@name, type=@type, host=@host, port=@port,
      username=@username, password=@password, private_key=@privateKey,
      key_path=@keyPath, cwd=@cwd, auto_connect=@autoConnect, sort_order=@sortOrder
  `).run({
    id:          p.id,
    name:        p.name,
    type:        p.type        || 'ssh',
    host:        p.host        || '',
    port:        p.port        || 22,
    username:    p.username    || '',
    password:    p.password    || '',
    privateKey:  p.privateKey  || '',
    keyPath:     p.keyPath     || '',
    cwd:         p.cwd         || '',
    autoConnect: p.autoConnect ? 1 : 0,
    sortOrder:   p.sortOrder   || 0,
    createdAt:   Date.now(),
  })
  return { ok: true }
})

ipcMain.handle('profiles:delete', (_, id) => {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  return { ok: true }
})

// ── 파일 탐색 다이얼로그 ──────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'SSH 키 파일 선택',
    properties: ['openFile'],
    filters: [
      { name: 'SSH Keys', extensions: ['', 'pem', 'key', 'ppk'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    title: '시작 디렉토리 선택',
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── 알림 ──────────────────────────────────────────────────────────────────────
ipcMain.on('notify', (_, { title, body }) => {
  new Notification({ title, body }).show()
})
