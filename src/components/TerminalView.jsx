import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

const NOTIFY_THRESHOLD_MS = 5000

export default function TerminalView({ session, active, onConnected }) {
  const containerRef   = useRef(null)
  const termRef        = useRef(null)
  const fitRef         = useRef(null)
  const startTimeRef   = useRef(null)
  const composingRef   = useRef(false)
  // onConnected는 매 렌더마다 새 함수로 생성되므로 ref로 안정화
  const onConnectedRef = useRef(onConnected)
  onConnectedRef.current = onConnected

  useEffect(() => {
    if (!containerRef.current) return

    let doCleanup = () => {}

    // setTimeout(0)으로 init을 지연시키면 Strict Mode ghost mount의
    // cleanup이 이 타이머를 취소 → xterm이 ghost mount에서 열리지 않으므로
    // RAF 에러 원천 차단, connect도 정확히 1회만 호출됨
    const initTimer = setTimeout(() => {
      if (!containerRef.current) return

      containerRef.current.innerHTML = ''

      const api = window.electronAPI

      const term = new Terminal({
        fontFamily: '"JetBrains Mono", "D2Coding", "Consolas", "Noto Sans Mono CJK KR", monospace',
        fontSize: 14,
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

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())
      term.open(containerRef.current)
      termRef.current = term
      fitRef.current  = fitAddon

      // 초기화 직후 컨테이너 크기에 맞게 fit (이걸 안 하면 기본 80×24로 고정됨)
      requestAnimationFrame(() => {
        if (!fitRef.current) return
        fitRef.current.fit()
        const api = window.electronAPI
        if (!api) return
        if (session.type === 'local') api.localResize(session.id, term.cols, term.rows)
        else if (session.type === 'ssh') api.sshResize(session.id, term.cols, term.rows)
      })

      // ── 복사 / 붙여넣기 ───────────────────────────────────────────────────
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true

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

      // ── 입력 처리 ──────────────────────────────────────────────────────────
      term.onData((data) => {
        if (composingRef.current) return
        sendInput(data)
        if (data === '\r') startTimeRef.current = Date.now()
      })

      const textarea = term.textarea
      textarea.addEventListener('compositionstart', () => { composingRef.current = true })
      textarea.addEventListener('compositionend', (e) => {
        composingRef.current = false
        if (e.data) sendInput(e.data)
      })

      // termRef.current === term: 이 인스턴스가 여전히 살아있는지 확인
      if (session.type === 'local') {
        api.localConnect(session.id, session.cwd || '').then((res) => {
          if (termRef.current !== term) return
          if (res.ok) onConnectedRef.current?.()
        }).catch((err) => {
          if (termRef.current !== term) return
          term.writeln(`\r\n\x1b[31m[연결 실패] ${err}\x1b[0m\r\n`)
        })

        const onData  = (data) => { if (termRef.current === term) { term.write(data); checkNotify(data) } }
        const onClose = ()     => { if (termRef.current === term) term.writeln('\r\n\x1b[33m[세션 종료]\x1b[0m') }
        api.onLocalData(session.id, onData)
        api.onLocalClose(session.id, onClose)

        doCleanup = () => {
          termRef.current = null
          fitRef.current  = null
          api.offLocalData(session.id, onData)
          api.offLocalClose(session.id, onClose)
          term.dispose()
          api.localDisconnect(session.id)
        }

      } else if (session.type === 'ssh') {
        term.writeln('\x1b[33m연결 중...\x1b[0m')
        api.sshConnect({
          id: session.id, host: session.host, port: session.port,
          username: session.username, password: session.password,
          privateKey: session.privateKey, keyPath: session.keyPath,
        }).then((res) => {
          if (termRef.current !== term) return
          if (res.ok) { onConnectedRef.current?.(); term.clear() }
        }).catch((err) => {
          if (termRef.current !== term) return
          term.writeln(`\r\n\x1b[31m[연결 실패] ${err}\x1b[0m\r\n`)
        })

        const onData  = (data) => { if (termRef.current === term) { term.write(data); checkNotify(data) } }
        const onClose = ()     => { if (termRef.current === term) term.writeln('\r\n\x1b[33m[연결 종료]\x1b[0m') }
        api.onSshData(session.id, onData)
        api.onSshClose(session.id, onClose)

        doCleanup = () => {
          termRef.current = null
          fitRef.current  = null
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
            api?.notify('Lounge', `작업 완료 (${Math.round(elapsed / 1000)}초 소요)`)
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

  return (
    <div
      ref={containerRef}
      style={{ display: active ? 'block' : 'none', width: '100%', height: '100%', padding: '6px 8px' }}
    />
  )
}
