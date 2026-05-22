import { useState, useEffect, useCallback } from 'react'
import './App.css'
import TerminalView from './components/TerminalView'
import SessionSidebar from './components/SessionSidebar'

function App() {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
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
      {/* 타이틀바 */}
      <div className="titlebar">
        <span className="titlebar-logo">&gt;_ lounge</span>
        <div className="titlebar-tabs">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`tab ${s.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              <span className={`tab-dot ${s.connected ? 'connected' : ''}`} />
              <span className="tab-label">{s.label}</span>
              <span className="tab-close" onClick={e => { e.stopPropagation(); removeSession(s.id) }}>×</span>
            </div>
          ))}
          <button className="btn-new-tab" onClick={() => setSidebarOpen(true)}>+</button>
        </div>
      </div>

      <div className="main">
        {/* 사이드바 */}
        {sidebarOpen && (
          <SessionSidebar
            profiles={profiles}
            onConnect={addSession}
            onClose={() => setSidebarOpen(false)}
            onRefresh={refreshProfiles}
          />
        )}

        {/* 터미널 패널들 */}
        <div className="terminal-area">
          {sessions.length === 0 ? (
            <div className="splash">
              <div className="splash-logo">&gt;_</div>
              <p>세션을 추가하고 작업을 시작하세요</p>
              <div className="splash-actions">
                <button className="btn-primary" onClick={() => setSidebarOpen(true)}>터미널 열기</button>
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
