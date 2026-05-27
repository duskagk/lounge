const { app, BrowserWindow, ipcMain, Notification, dialog, clipboard } = require('electron')
const fs = require('fs')
const net = require('net')
const path = require('path')
const { Client } = require('ssh2')
const pty = require('node-pty')
const os = require('os')

// Suppress Electron security warnings in dev (removes red dashed border)
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const isDev = process.env.NODE_ENV === 'development'

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
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS port_forwards (
      id          TEXT    PRIMARY KEY,
      profile_id  TEXT    NOT NULL,
      local_port  INTEGER NOT NULL,
      remote_host TEXT    NOT NULL DEFAULT 'localhost',
      remote_port INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      label      TEXT    DEFAULT '',
      timestamp  INTEGER NOT NULL,
      command    TEXT    DEFAULT '',
      output     TEXT    DEFAULT '',
      mode       TEXT    DEFAULT 'command'
    );
  `)
  // FTS5 가상 테이블 + 동기화 트리거 (FTS5 미지원 환경 대비 try/catch)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS terminal_logs_fts USING fts5(
        command, output,
        content=terminal_logs,
        content_rowid=id
      );
      CREATE TRIGGER IF NOT EXISTS tl_ai AFTER INSERT ON terminal_logs BEGIN
        INSERT INTO terminal_logs_fts(rowid, command, output)
        VALUES (new.id, new.command, new.output);
      END;
      CREATE TRIGGER IF NOT EXISTS tl_ad AFTER DELETE ON terminal_logs BEGIN
        INSERT INTO terminal_logs_fts(terminal_logs_fts, rowid, command, output)
        VALUES ('delete', old.id, old.command, old.output);
      END;
    `)
  } catch (_) {}
  // 기존 DB 마이그레이션
  try { db.exec(`ALTER TABLE profiles ADD COLUMN cwd           TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN key_path      TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN jump_host     TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN jump_port     INTEGER DEFAULT 22`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN jump_username TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN jump_password TEXT DEFAULT ''`) } catch (_) {}
  try { db.exec(`ALTER TABLE profiles ADD COLUMN jump_key_path TEXT DEFAULT ''`) } catch (_) {}
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

// keyPath로 키 파일 읽기 헬퍼
function readKey(keyPath, privateKey) {
  if (keyPath) {
    try { return fs.readFileSync(keyPath.trim(), 'utf8') } catch (e) {
      throw new Error(`키 파일을 읽을 수 없습니다: ${keyPath}\n${e.message}`)
    }
  }
  return privateKey || ''
}

// SSH Client 빌드 헬퍼
function buildSshCfg({ host, port, username, password, privateKey, keyPath }) {
  const key = readKey(keyPath, privateKey)
  const cfg = { host, port: port || 22, username, readyTimeout: 10000, keepaliveInterval: 30000, tryKeyboard: true }
  if (key)      cfg.privateKey = key
  else if (password) cfg.password = password
  return cfg
}

ipcMain.handle('ssh:connect', async (event, { id, host, port, username, password, privateKey, keyPath,
                                              jumpHost, jumpPort, jumpUsername, jumpPassword, jumpKeyPath,
                                              portForwards }) => {
  return new Promise((resolve, reject) => {
    // ── 공통: shell 열기 + 포트포워딩 설정 ──────────────────────────────
    function openShell(conn, jumpConn) {
      conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
        if (err) return reject(err.message)

        const tcpServers = []
        for (const fwd of (portForwards || [])) {
          const server = net.createServer((socket) => {
            conn.forwardOut('127.0.0.1', fwd.localPort, fwd.remoteHost || 'localhost', fwd.remotePort, (err, ch) => {
              if (err) { socket.destroy(); return }
              socket.pipe(ch); ch.pipe(socket)
              socket.on('error', () => { try { ch.destroy()     } catch (_) {} })
              ch.on('error',     () => { try { socket.destroy() } catch (_) {} })
              ch.on('close',     () => { try { socket.destroy() } catch (_) {} })
            })
          })
          server.on('error', (e) => console.error(`[portfwd] ${fwd.localPort}: ${e.message}`))
          server.listen(fwd.localPort, '127.0.0.1', () =>
            console.log(`[portfwd] 127.0.0.1:${fwd.localPort} → ${fwd.remoteHost || 'localhost'}:${fwd.remotePort}`)
          )
          tcpServers.push(server)
        }

        sshSessions.set(id, { conn, jumpConn, stream, tcpServers })

        stream.on('data',       (data) => event.sender.send(`ssh:data:${id}`, data.toString('utf8')))
        stream.stderr.on('data',(data) => event.sender.send(`ssh:data:${id}`, data.toString('utf8')))
        stream.on('close', () => {
          tcpServers.forEach(s => { try { s.close() } catch (_) {} })
          event.sender.send(`ssh:close:${id}`)
          sshSessions.delete(id)
        })
        resolve({ ok: true })
      })
    }

    // ── 직접 연결 ────────────────────────────────────────────────────────
    if (!jumpHost) {
      let cfg
      try { cfg = buildSshCfg({ host, port, username, password, privateKey, keyPath }) }
      catch (e) { return reject(e.message) }

      const conn = new Client()
      conn.on('ready', () => openShell(conn, null))
      conn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password || '')))
      conn.on('error', (e) => reject(e.message))
      conn.connect(cfg)

    // ── ProxyJump ─────────────────────────────────────────────────────────
    } else {
      let jumpCfg, targetCfg
      try {
        jumpCfg   = buildSshCfg({ host: jumpHost, port: jumpPort, username: jumpUsername, password: jumpPassword, keyPath: jumpKeyPath })
        targetCfg = buildSshCfg({ host, port, username, password, privateKey, keyPath })
      } catch (e) { return reject(e.message) }

      const jumpConn = new Client()
      jumpConn.on('ready', () => {
        jumpConn.forwardOut('127.0.0.1', 0, host, port || 22, (err, stream) => {
          if (err) return reject(`ProxyJump forward failed: ${err.message}`)

          const conn = new Client()
          conn.on('ready', () => openShell(conn, jumpConn))
          conn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password || '')))
          conn.on('error', (e) => reject(e.message))
          conn.connect({ ...targetCfg, sock: stream })
        })
      })
      jumpConn.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => jumpPassword || '')))
      jumpConn.on('error', (e) => reject(`Jump host error: ${e.message}`))
      jumpConn.connect(jumpCfg)
    }
  })
})

ipcMain.on('ssh:input',      (_, { id, data })       => { sshSessions.get(id)?.stream?.write(data) })
ipcMain.on('ssh:resize',     (_, { id, cols, rows }) => { sshSessions.get(id)?.stream?.setWindow(rows, cols, 0, 0) })
ipcMain.on('ssh:disconnect', (_, { id }) => {
  const s = sshSessions.get(id)
  if (s) {
    s.tcpServers?.forEach(srv => { try { srv.close()  } catch (_) {} })
    s.stream?.close()
    s.conn?.end()
    s.jumpConn?.end()
    sshSessions.delete(id)
  }
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
  const rows = db.prepare('SELECT * FROM profiles ORDER BY sort_order ASC, created_at ASC').all()
  const fwdRows = db.prepare('SELECT * FROM port_forwards ORDER BY local_port ASC').all()
  const fwdMap = {}
  for (const f of fwdRows) {
    ;(fwdMap[f.profile_id] ||= []).push({
      id: f.id, localPort: f.local_port, remoteHost: f.remote_host, remotePort: f.remote_port,
    })
  }
  return rows.map(r => ({
    id:           r.id,
    name:         r.name,
    type:         r.type,
    host:         r.host,
    port:         r.port,
    username:     r.username,
    password:     r.password,
    privateKey:   r.private_key,
    keyPath:      r.key_path,
    cwd:          r.cwd,
    autoConnect:  r.auto_connect === 1,
    sortOrder:    r.sort_order,
    portForwards: fwdMap[r.id] || [],
    jumpHost:     r.jump_host     || '',
    jumpPort:     r.jump_port     || 22,
    jumpUsername: r.jump_username || '',
    jumpPassword: r.jump_password || '',
    jumpKeyPath:  r.jump_key_path || '',
  }))
})

ipcMain.handle('profiles:save', (_, p) => {
  db.prepare(`
    INSERT INTO profiles
      (id, name, type, host, port, username, password, private_key, key_path, cwd,
       auto_connect, sort_order, created_at,
       jump_host, jump_port, jump_username, jump_password, jump_key_path)
    VALUES
      (@id, @name, @type, @host, @port, @username, @password, @privateKey, @keyPath, @cwd,
       @autoConnect, @sortOrder, @createdAt,
       @jumpHost, @jumpPort, @jumpUsername, @jumpPassword, @jumpKeyPath)
    ON CONFLICT(id) DO UPDATE SET
      name=@name, type=@type, host=@host, port=@port,
      username=@username, password=@password, private_key=@privateKey,
      key_path=@keyPath, cwd=@cwd, auto_connect=@autoConnect, sort_order=@sortOrder,
      jump_host=@jumpHost, jump_port=@jumpPort, jump_username=@jumpUsername,
      jump_password=@jumpPassword, jump_key_path=@jumpKeyPath
  `).run({
    id:           p.id,
    name:         p.name,
    type:         p.type         || 'ssh',
    host:         p.host         || '',
    port:         p.port         || 22,
    username:     p.username     || '',
    password:     p.password     || '',
    privateKey:   p.privateKey   || '',
    keyPath:      p.keyPath      || '',
    cwd:          p.cwd          || '',
    autoConnect:  p.autoConnect ? 1 : 0,
    sortOrder:    p.sortOrder    || 0,
    createdAt:    Date.now(),
    jumpHost:     p.jumpHost     || '',
    jumpPort:     p.jumpPort     || 22,
    jumpUsername: p.jumpUsername || '',
    jumpPassword: p.jumpPassword || '',
    jumpKeyPath:  p.jumpKeyPath  || '',
  })
  // port forwards 교체 저장
  db.prepare('DELETE FROM port_forwards WHERE profile_id = ?').run(p.id)
  for (const f of (p.portForwards || [])) {
    db.prepare(
      'INSERT INTO port_forwards (id, profile_id, local_port, remote_host, remote_port) VALUES (?, ?, ?, ?, ?)'
    ).run(f.id || `fwd-${Date.now()}-${Math.random().toString(36).slice(2)}`, p.id, f.localPort, f.remoteHost || 'localhost', f.remotePort)
  }
  return { ok: true }
})

ipcMain.handle('profiles:delete', (_, id) => {
  db.prepare('DELETE FROM port_forwards WHERE profile_id = ?').run(id)
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  return { ok: true }
})

// ── 클립보드 ──────────────────────────────────────────────────────────────────
ipcMain.handle('clipboard:read',  ()         => clipboard.readText())
ipcMain.on(    'clipboard:write', (_, text)  => clipboard.writeText(text))

// ── 파일 탐색 다이얼로그 ──────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select SSH Key File',
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
    title: 'Select Start Directory',
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── 설정 (SQLite) ─────────────────────────────────────────────────────────────
const SETTING_DEFAULTS = { fontFamily: 'JetBrains Mono', fontSize: '14', logRetentionDays: '30' }

ipcMain.handle('settings:get', () => {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const map  = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    fontFamily:       map.fontFamily       || SETTING_DEFAULTS.fontFamily,
    fontSize:         parseInt(map.fontSize         || SETTING_DEFAULTS.fontSize,         10),
    logRetentionDays: parseInt(map.logRetentionDays || SETTING_DEFAULTS.logRetentionDays, 10),
  }
})

ipcMain.handle('settings:set', (_, settings) => {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  )
  for (const [key, value] of Object.entries(settings)) stmt.run(key, String(value))
  return { ok: true }
})

// ── 터미널 로그 (SQLite + FTS5) ───────────────────────────────────────────────
const OUTPUT_LIMIT = 500_000   // 레코드당 최대 500KB

// FTS5 쿼리 안전 변환: 특수문자 제거 후 각 단어를 prefix 검색으로
function buildFtsQuery(input) {
  const words = input.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  return words.map(w => w.replace(/['"*()^-]/g, '') + '*').filter(Boolean).join(' ')
}

ipcMain.handle('log:append', (_, { sessionId, label, command, output, mode, timestamp }) => {
  try {
    db.prepare(`
      INSERT INTO terminal_logs (session_id, label, timestamp, command, output, mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      label    || '',
      timestamp || Date.now(),
      (command || '').trim(),
      (output  || '').slice(0, OUTPUT_LIMIT),
      mode     || 'command'
    )
    console.log(`[log:append] saved cmd="${(command||'').trim().slice(0,40)}" sid=${sessionId?.slice(-8)}`)
  } catch (err) {
    console.error('[log:append] INSERT failed:', err.message)
  }
  return { ok: true }
})

// 진단용: 세션별 레코드 수 반환
ipcMain.handle('log:count', (_, { sessionId } = {}) => {
  try {
    if (sessionId) {
      return db.prepare('SELECT COUNT(*) as n FROM terminal_logs WHERE session_id = ?').get(sessionId)?.n ?? 0
    }
    return db.prepare('SELECT COUNT(*) as n FROM terminal_logs').get()?.n ?? 0
  } catch (e) {
    console.error('[log:count]', e.message)
    return -1
  }
})

ipcMain.handle('log:search', (_, { query, sessionId, limit = 100 }) => {
  if (!query || !query.trim()) return []
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []

  // snippet() 은 대용량 output 전체를 스캔해 느리므로
  // 앞 600자만 가져와 JS 쪽에서 하이라이팅 처리.
  // GROUP BY 는 반드시 WHERE 조건이 모두 끝난 뒤에 위치해야 함.
  try {
    const base = `
      SELECT l.id, l.session_id, l.label, l.timestamp, l.command, l.mode,
             SUBSTR(l.output, 1, 600) AS out_snip
      FROM   terminal_logs_fts f
      JOIN   terminal_logs l ON l.id = f.rowid
      WHERE  terminal_logs_fts MATCH ?`

    return sessionId
      ? db.prepare(base + ` AND l.session_id = ? GROUP BY l.id ORDER BY l.timestamp DESC LIMIT ?`).all(ftsQuery, sessionId, limit)
      : db.prepare(base + ` GROUP BY l.id ORDER BY l.timestamp DESC LIMIT ?`).all(ftsQuery, limit)
  } catch (e) {
    // FTS5 query 오류 → LIKE 폴백
    console.warn('[log:search] FTS5 fallback:', e.message)
    const like = `%${query}%`
    const base = `
      SELECT id, session_id, label, timestamp, command, SUBSTR(output, 1, 600) AS out_snip, mode
      FROM terminal_logs
      WHERE (command LIKE ? OR output LIKE ?)`
    return sessionId
      ? db.prepare(base + ` AND session_id = ? GROUP BY id ORDER BY timestamp DESC LIMIT ?`).all(like, like, sessionId, limit)
      : db.prepare(base + ` GROUP BY id ORDER BY timestamp DESC LIMIT ?`).all(like, like, limit)
  }
})

ipcMain.handle('log:purge', (_, { retentionDays }) => {
  const days = Math.max(1, retentionDays || 30)
  const cutoff = Date.now() - days * 86_400_000
  const r = db.prepare('DELETE FROM terminal_logs WHERE timestamp < ?').run(cutoff)
  return { deleted: r.changes }
})

ipcMain.handle('log:clear-session', (_, { sessionId }) => {
  const r = db.prepare('DELETE FROM terminal_logs WHERE session_id = ?').run(sessionId)
  return { deleted: r.changes }
})

// ── 알림 ──────────────────────────────────────────────────────────────────────
ipcMain.on('notify', (_, { title, body }) => {
  new Notification({ title, body }).show()
})
