import { useState } from 'react'
import './App.css'
import TerminalView from './components/TerminalView'
import SessionSidebar from './components/SessionSidebar'

function App() {
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const addSession = (session) => {
    const id = `session-${Date.now()}`
    const newSession = { ...session, id }
    setSessions(prev => [...prev, newSession])
    setActiveId(id)
  }

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
      {/* 타이틀바 - 드래그 가능 영역 */}
      <div className="titlebar">
        <span className="titlebar-logo">&gt;_ wterm</span>
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
            onConnect={addSession}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        {/* 터미널 패널들 */}
        <div className="terminal-area">
          {sessions.length === 0 ? (
            <div className="splash">
              <div className="splash-logo">&gt;_</div>
              <p>새 터미널을 열어 시작하세요</p>
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
