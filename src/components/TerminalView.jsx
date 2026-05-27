import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

const NOTIFY_THRESHOLD_MS = 5000

const SEARCH_DECORATIONS = {
  matchBackground:               '#58a6ff2e',  // SearchAddon은 #RRGGBBAA 포맷 사용
  matchBorder:                   '#58a6ff73',
  matchOverviewRuler:            '#58a6ff',
  activeMatchBackground:         '#58a6ff8c',
  activeMatchBorder:             '#79c0ff',
  activeMatchColorOverviewRuler: '#79c0ff',
}

// ANSI 이스케이프 코드 제거 (DB 저장 전 정제용)
function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')          // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()][0-9A-Za-z]/g, '')              // charset sequences
    .replace(/\x1b[MOPQRZ78=><]/g, '')                // simple escapes
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // control chars
}

export default function TerminalView({ session, logId, active, visible, fontFamily, fontSize, logEnabled = false, onConnected }) {
  const containerRef   = useRef(null)
  const termRef        = useRef(null)
  const fitRef         = useRef(null)
  const startTimeRef   = useRef(null)
  const composingRef   = useRef(false)
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected

  // 로그 캡처 상태
  const logEnabledRef = useRef(logEnabled)
  logEnabledRef.current = logEnabled
  const logStateRef = useRef({
    pendingCommand: '',
    lastCommand:    '',
    output:         '',
    mode:           'command',
    startTime:      Date.now(),
    inAltScreen:    false,
  })

  // ── 검색 상태 ────────────────────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [matchInfo,  setMatchInfo]  = useState({ count: 0, index: -1 })

  const searchAddonRef  = useRef(null)
  const showSearchRef   = useRef(false)
  showSearchRef.current = showSearch
  const searchInputRef  = useRef(null)
  const closeSearchRef  = useRef(null)

  const closeSearch = useCallback(() => {
    setShowSearch(false)
    setSearchTerm('')
    setMatchInfo({ count: 0, index: -1 })
    searchAddonRef.current?.clearDecorations?.()
    termRef.current?.focus()
  }, [])
  closeSearchRef.current = closeSearch

  const doFind = useCallback((term, forward = true) => {
    const sa = searchAddonRef.current
    if (!sa || !term) return
    const opts = { decorations: SEARCH_DECORATIONS }
    if (forward) sa.findNext(term, opts)
    else         sa.findPrevious(term, opts)
  }, [])

  // 검색창이 닫히면 하이라이트 제거
  useEffect(() => {
    if (!showSearch) {
      searchAddonRef.current?.clearDecorations?.()
    }
  }, [showSearch])

  // 검색어 변경 시 debounce 후 검색 (즉시 호출 시 5000줄 동기 스캔으로 UI 블록)
  useEffect(() => {
    if (!showSearch) return
    if (!searchTerm) {
      searchAddonRef.current?.clearDecorations?.()
      setMatchInfo({ count: 0, index: -1 })
      return
    }
    const t = setTimeout(() => doFind(searchTerm, true), 150)
    return () => clearTimeout(t)
  }, [searchTerm, showSearch, doFind])

  useEffect(() => {
    if (!containerRef.current) return

    let doCleanup = () => {}

    // setTimeout(0)으로 init을 지연시키면 Strict Mode ghost mount의
    // cleanup이 이 타이머를 취소 → xterm이 ghost mount에서 열리지 않으므로
    // RAF 에러 원천 차단, connect도 정확히 1회만 호출됨
    const initTimer = setTimeout(async () => {
      if (!containerRef.current) return

      // 폰트가 실제로 로드된 후 터미널을 초기화해야 xterm이 올바른 문자 폭을 측정함.
      try {
        await document.fonts.load(`${fontSize ?? 14}px "${fontFamily}"`)
      } catch (_) { /* 폰트 확인 실패 시 그냥 진행 */ }

      if (!containerRef.current) return

      containerRef.current.innerHTML = ''

      const api = window.electronAPI

      const term = new Terminal({
        allowProposedApi: true,
        fontFamily: `"${fontFamily}", "D2Coding", "Nanum Gothic Coding", monospace`,
        fontSize: fontSize ?? 14,
        lineHeight: 1.45,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        convertEol: true,
        theme: {
          background: '#0e1117', foreground: '#e6edf3', cursor: '#58a6ff', cursorAccent: '#0e1117',
          black: '#484f58', red: '#f85149', green: '#3fb950', yellow: '#d29922',
          blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
          brightBlack: '#6e7681', brightRed: '#ff7b72', brightGreen: '#56d364',
          brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
          selectionBackground: 'rgba(88,166,255,0.25)',
        },
      })

      const fitAddon    = new FitAddon()
      const searchAddon = new SearchAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())
      term.loadAddon(searchAddon)
      term.open(containerRef.current)
      termRef.current        = term
      fitRef.current         = fitAddon
      searchAddonRef.current = searchAddon

      // 검색 결과 개수 업데이트
      searchAddon.onDidChangeResults?.((results) => {
        if (results) setMatchInfo({ count: results.resultCount, index: results.resultIndex })
        else         setMatchInfo({ count: 0, index: -1 })
      })

      // 초기화 직후 컨테이너 크기에 맞게 fit
      requestAnimationFrame(() => {
        if (!fitRef.current) return
        fitRef.current.fit()
        const api = window.electronAPI
        if (!api) return
        if (session.type === 'local') api.localResize(session.id, term.cols, term.rows)
        else if (session.type === 'ssh') api.sshResize(session.id, term.cols, term.rows)
      })

      // ── 복사 / 붙여넣기 / 검색 ────────────────────────────────────────────────
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true

        // Ctrl+F → 터미널 내 검색 토글 (e.preventDefault 필수: native find-in-page 방지)
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
          e.preventDefault()
          setShowSearch(v => !v)
          return false
        }

        // Escape → 검색창 닫기
        if (e.code === 'Escape' && showSearchRef.current) {
          e.preventDefault()
          closeSearchRef.current?.()
          return false
        }

        // Ctrl+Shift+F → 앱 레벨에서 로그 검색 패널을 열도록 전달
        if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyF') return false

        // Ctrl+V → 붙여넣기
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyV') {
          api.readClipboard().then(text => { if (text) sendInput(text) })
          return false
        }

        // Ctrl+C → 선택 텍스트 있으면 복사, 없으면 SIGINT 그대로 전달
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC') {
          const sel = term.getSelection()
          if (sel) {
            api.writeClipboard(sel)
            term.clearSelection()
            return false
          }
        }

        // Ctrl+Shift+C → 명시적 복사
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
          const sel = term.getSelection()
          if (sel) api.writeClipboard(sel)
          return false
        }

        return true
      })

      // 우클릭 → 붙여넣기 (Windows Terminal 방식)
      containerRef.current.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        api.readClipboard().then(text => { if (text) sendInput(text) })
      })

      // ── 로그 캡처 헬퍼 ────────────────────────────────────────────────────
      const stableLogId = logId ?? session.id

      function flushLog(forcedMode) {
        if (!logEnabledRef.current) {
          console.log('[lounge:log] flushLog skipped — logging disabled')
          return
        }
        const s = logStateRef.current
        if (!s.lastCommand && !s.output) {
          console.log('[lounge:log] flushLog skipped — both empty (cmd=' + JSON.stringify(s.lastCommand) + ')')
          return
        }
        console.log('[lounge:log] flushLog SAVING', { cmd: s.lastCommand, outLen: s.output.length })
        api?.logAppend({
          sessionId: stableLogId,
          label:     session.label || '',
          command:   s.lastCommand,
          output:    s.output.slice(0, 500_000),
          mode:      forcedMode ?? s.mode,
          timestamp: s.startTime,
        })
        s.lastCommand = ''
        s.output      = ''
        s.startTime   = Date.now()
        s.mode        = 'command'
      }

      // ── 입력 처리 ──────────────────────────────────────────────────────────
      term.onData((data) => {
        if (composingRef.current) return
        sendInput(data)
        if (data === '\r') startTimeRef.current = Date.now()

        if (!logEnabledRef.current || logStateRef.current.inAltScreen) return

        if (data === '\r') {
          flushLog()
          const ls = logStateRef.current
          ls.lastCommand    = ls.pendingCommand
          ls.pendingCommand = ''
          ls.output         = ''
          ls.startTime      = Date.now()
        } else if (data === '\x03') {
          flushLog('stream')
          const ls = logStateRef.current
          ls.pendingCommand = ''
          ls.lastCommand    = ''
        } else if (data === '\x7f' || data === '\b') {
          logStateRef.current.pendingCommand = logStateRef.current.pendingCommand.slice(0, -1)
        } else if (data.length === 1 && data >= ' ') {
          logStateRef.current.pendingCommand += data
        }
      })

      const textarea = term.textarea
      textarea.addEventListener('compositionstart', () => { composingRef.current = true })
      textarea.addEventListener('compositionend', (e) => {
        composingRef.current = false
        if (e.data) sendInput(e.data)
      })

      function handleOutputLog(data) {
        if (!logEnabledRef.current) return
        const ls = logStateRef.current

        if (data.includes('\x1b[?1049h')) {
          flushLog()
          ls.inAltScreen = true
          ls.mode        = 'app'
          ls.startTime   = Date.now()
          return
        }
        if (data.includes('\x1b[?1049l')) {
          if (ls.inAltScreen) {
            api?.logAppend({
              sessionId: stableLogId, label: session.label || '',
              command: '[interactive app]', output: '',
              mode: 'app', timestamp: ls.startTime,
            })
            logStateRef.current = {
              pendingCommand: '', lastCommand: '', output: '', mode: 'command',
              startTime: Date.now(), inAltScreen: false,
            }
          }
          return
        }
        if (!ls.inAltScreen) {
          ls.output += stripAnsi(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        }
      }

      if (session.type === 'local') {
        api.localConnect(session.id, session.cwd || '').then((res) => {
          if (termRef.current !== term) return
          if (res.ok) onConnectedRef.current?.()
        }).catch((err) => {
          if (termRef.current !== term) return
          term.writeln(`\r\n\x1b[31m[connection failed] ${err}\x1b[0m\r\n`)
        })

        const onData  = (data) => {
          if (termRef.current !== term) return
          term.write(data); checkNotify(data); handleOutputLog(data)
        }
        const onClose = ()     => { if (termRef.current === term) term.writeln('\r\n\x1b[33m[session closed]\x1b[0m') }
        api.onLocalData(session.id, onData)
        api.onLocalClose(session.id, onClose)

        doCleanup = () => {
          flushLog()
          termRef.current        = null
          fitRef.current         = null
          searchAddonRef.current = null
          api.offLocalData(session.id, onData)
          api.offLocalClose(session.id, onClose)
          term.dispose()
          api.localDisconnect(session.id)
        }

      } else if (session.type === 'ssh') {
        const MAX_RETRIES    = 5
        const RETRY_DELAYS   = [2000, 4000, 8000, 16000, 30000]
        let connectedOnce    = false
        let retryCount       = 0
        let retryTimer       = null

        function sshConnect() {
          api.sshConnect({
            id: session.id, host: session.host, port: session.port,
            username: session.username, password: session.password,
            privateKey: session.privateKey, keyPath: session.keyPath,
            portForwards: session.portForwards || [],
            jumpHost:     session.jumpHost     || '',
            jumpPort:     session.jumpPort     || 22,
            jumpUsername: session.jumpUsername || '',
            jumpPassword: session.jumpPassword || '',
            jumpKeyPath:  session.jumpKeyPath  || '',
          }).then((res) => {
            if (termRef.current !== term) return
            if (res.ok) {
              if (!connectedOnce) { onConnectedRef.current?.(); term.clear() }
              connectedOnce = true
              retryCount    = 0
            }
          }).catch((err) => {
            if (termRef.current !== term) return
            term.writeln(`\r\n\x1b[31m[connection failed] ${err}\x1b[0m`)
            if (connectedOnce) scheduleRetry()
          })
        }

        function scheduleRetry() {
          if (retryCount >= MAX_RETRIES) {
            term.writeln('\x1b[31m[reconnect failed — giving up]\x1b[0m\r\n')
            return
          }
          const delay = RETRY_DELAYS[retryCount]
          retryCount++
          term.writeln(`\x1b[33m[reconnecting in ${delay / 1000}s... (${retryCount}/${MAX_RETRIES})]\x1b[0m`)
          retryTimer = setTimeout(() => {
            if (termRef.current !== term) return
            sshConnect()
          }, delay)
        }

        term.writeln('\x1b[33mConnecting...\x1b[0m')
        sshConnect()

        const onData  = (data) => {
          if (termRef.current !== term) return
          term.write(data); checkNotify(data); handleOutputLog(data)
        }
        const onClose = () => {
          if (termRef.current !== term) return
          term.writeln('\r\n\x1b[33m[disconnected]\x1b[0m')
          scheduleRetry()
        }
        api.onSshData(session.id, onData)
        api.onSshClose(session.id, onClose)

        doCleanup = () => {
          clearTimeout(retryTimer)
          flushLog()
          termRef.current        = null
          fitRef.current         = null
          searchAddonRef.current = null
          api.offSshData(session.id, onData)
          api.offSshClose(session.id, onClose)
          term.dispose()
          api.sshDisconnect(session.id)
        }
      }

      function sendInput(data) {
        if (!api) return
        if (session.type === 'local') api.localInput(session.id, data)
        else if (session.type === 'ssh') api.sshInput(session.id, data)
      }

      function checkNotify(data) {
        if (startTimeRef.current && /[$#>]\s*$/.test(data)) {
          const elapsed = Date.now() - startTimeRef.current
          if (elapsed > NOTIFY_THRESHOLD_MS) {
            api?.notify('Lounge', `Task completed (${Math.round(elapsed / 1000)}s)`)
          }
          startTimeRef.current = null
        }
      }
    }, 0)

    return () => {
      clearTimeout(initTimer)
      doCleanup()
    }
  }, [session.id])

  // 로그 꺼질 때 미완성 레코드 flush
  useEffect(() => {
    if (logEnabled) return
    const s = logStateRef.current
    if (!s.lastCommand && !s.output) return
    window.electronAPI?.logAppend({
      sessionId: logId ?? session.id, label: session.label || '',
      command: s.lastCommand, output: s.output.slice(0, 500_000),
      mode: s.mode, timestamp: s.startTime,
    })
    logStateRef.current = {
      pendingCommand: '', lastCommand: '', output: '', mode: 'command',
      startTime: Date.now(), inAltScreen: false,
    }
  }, [logEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const apply = async () => {
      try { await document.fonts.load(`${fontSize ?? 14}px "${fontFamily}"`) } catch (_) {}
      if (!termRef.current) return
      term.options.fontFamily = `"${fontFamily}", "D2Coding", "Nanum Gothic Coding", monospace`
      term.options.fontSize   = fontSize ?? 14
      requestAnimationFrame(() => {
        fitRef.current?.fit()
        term.refresh(0, term.rows - 1)
      })
    }
    apply()
  }, [fontFamily, fontSize])

  useEffect(() => {
    if (active && fitRef.current) {
      setTimeout(() => {
        fitRef.current?.fit()
        const term = termRef.current
        if (!term || !window.electronAPI) return
        if (session.type === 'local') window.electronAPI.localResize(session.id, term.cols, term.rows)
        else if (session.type === 'ssh') window.electronAPI.sshResize(session.id, term.cols, term.rows)
      }, 50)
      termRef.current?.focus()
    }
  }, [active])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!active || !fitRef.current) return
      fitRef.current.fit()
      const term = termRef.current
      if (!term || !window.electronAPI) return
      if (session.type === 'local') window.electronAPI.localResize(session.id, term.cols, term.rows)
      else if (session.type === 'ssh') window.electronAPI.sshResize(session.id, term.cols, term.rows)
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [active])

  const isVisible = visible !== undefined ? visible : active

  return (
    <div style={{ position: 'relative', display: isVisible ? 'block' : 'none', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', padding: '6px 8px' }} />

      {showSearch && (
        <div className="term-search-bar" onMouseDown={e => e.stopPropagation()}>
          <input
            ref={searchInputRef}
            autoFocus
            className="term-search-input"
            type="text"
            placeholder="Find in terminal..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.shiftKey ? doFind(searchTerm, false) : doFind(searchTerm, true)
              }
              if (e.key === 'Escape') closeSearch()
              // Ctrl+F도 닫기 (포커스가 input에 있을 때)
              if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') {
                e.preventDefault()
                closeSearch()
              }
            }}
          />
          <span className="term-search-count">
            {searchTerm
              ? matchInfo.count === 0
                ? 'No results'
                : `${matchInfo.index + 1} / ${matchInfo.count}`
              : ''}
          </span>
          <button className="term-search-btn" onClick={() => doFind(searchTerm, false)} title="Previous (Shift+Enter)">▲</button>
          <button className="term-search-btn" onClick={() => doFind(searchTerm, true)}  title="Next (Enter)">▼</button>
          <button className="term-search-btn" onClick={closeSearch}                     title="Close (Esc)">✕</button>
        </div>
      )}
    </div>
  )
}
