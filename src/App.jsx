import { useState, useEffect, useCallback } from 'react'
import './App.css'
import TerminalView from './components/TerminalView'
import SessionSidebar from './components/SessionSidebar'

function App() {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profiles, setProfiles] = useState([])

  const addSession = useCallback((session) => {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newSession = { ...session, id }
    setSessions(prev => [...prev, newSession])
    setActiveId(id)
  }, [])

  const refreshProfiles = useCallback(() => {
    window.electronAPI?.getProfiles().then(setProfiles)
  }, [])

  // 앱 시작: 프로필 로드 + 자동 연결
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.getProfiles().then(list => {
      setProfiles(list)
      // 자동 연결 프로필 순차 실행 (ID 충돌 방지)
      list.filter(p => p.autoConnect).forEach((p, i) => {
        setTimeout(() => addSession({
          type:       p.type,
          label:      p.name,
          host:       p.host,
          port:       p.port,
          username:   p.username,
          password:   p.password,
          privateKey: p.privateKey,
        }), i * 100)
      })
    })
  }, [addSession])

  const removeSession = (id) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    setActiveId(prev => {
      if (prev !== id) return prev
      const remaining = sessions.filter(s => s.id !== id)
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null
    })
  }

  return (
    <div className="app">
      {/* 타이틀바: 드래그 영역 + 로고만 */}
      <div className="titlebar">
        <span className="titlebar-logo">&gt;_ lounge</span>
      </div>

      <div className="main">
        {/* 좌측 세션 탭 패널 */}
        <div className="tab-sidebar">
          <div className="tab-sidebar-sessions">
            {sessions.length === 0 ? (
              <p className="tab-sidebar-empty">No open sessions</p>
            ) : (
              sessions.map(s => (
                <div
                  key={s.id}
                  className={`tab-item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => setActiveId(s.id)}
                  title={s.label}
                >
                  <span className={`tab-dot ${s.connected ? 'connected' : ''}`} />
                  <span className="tab-item-label">{s.label}</span>
                  <span
                    className="tab-item-close"
                    onClick={e => { e.stopPropagation(); removeSession(s.id) }}
                  >×</span>
                </div>
              ))
            )}
          </div>
          <div className="tab-sidebar-footer">
            <button
              className={`btn-new-session ${sidebarOpen ? 'active' : ''}`}
              onClick={() => setSidebarOpen(v => !v)}
            >
              <span className="btn-new-session-icon">{sidebarOpen ? '−' : '+'}</span>
              New Session
            </button>
          </div>
        </div>

        {/* 연결 패널 (토글) */}
        {sidebarOpen && (
          <SessionSidebar
            profiles={profiles}
            onConnect={(session) => { addSession(session); setSidebarOpen(false) }}
            onClose={() => setSidebarOpen(false)}
            onRefresh={refreshProfiles}
          />
        )}

        {/* 터미널 패널들 */}
        <div className="terminal-area">
          {sessions.length === 0 ? (
            <div className="splash">
              <div className="splash-logo">&gt;_</div>
              <p>Open a session to get started</p>
              <div className="splash-actions">
                <button className="btn-primary" onClick={() => setSidebarOpen(true)}>New Session</button>
              </div>
            </div>
          ) : (
            sessions.map(s => (
              <TerminalView
                key={s.id}
                session={s}
                active={s.id === activeId}
                onConnected={() => {
                  setSessions(prev => prev.map(p => p.id === s.id ? { ...p, connected: true } : p))
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default App
