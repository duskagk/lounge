import { useState, useEffect, useCallback } from 'react'
import './App.css'
import TerminalView from './components/TerminalView'
import SessionSidebar from './components/SessionSidebar'

// tab sidebar states: 'expanded' | 'icons' | 'hidden'
const SIDEBAR_STATES = ['expanded', 'icons', 'hidden']

function App() {
  const [sessions, setSessions]       = useState([])
  const [activeId, setActiveId]       = useState(null)
  const [panelOpen, setPanelOpen]     = useState(false)
  const [profiles, setProfiles]       = useState([])
  const [tabState, setTabState]       = useState('expanded')

  const cycleTabSidebar = () =>
    setTabState(s => SIDEBAR_STATES[(SIDEBAR_STATES.indexOf(s) + 1) % SIDEBAR_STATES.length])

  const addSession = useCallback((session) => {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setSessions(prev => [...prev, { ...session, id }])
    setActiveId(id)
  }, [])

  const refreshProfiles = useCallback(() => {
    window.electronAPI?.getProfiles().then(setProfiles)
  }, [])

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.getProfiles().then(list => {
      setProfiles(list)
      list.filter(p => p.autoConnect).forEach((p, i) => {
        setTimeout(() => addSession({
          type: p.type, label: p.name, host: p.host, port: p.port,
          username: p.username, password: p.password, privateKey: p.privateKey,
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

  const isIcons    = tabState === 'icons'
  const isHidden   = tabState === 'hidden'
  const isExpanded = tabState === 'expanded'

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <button className="btn-sidebar-toggle" onClick={cycleTabSidebar} title="Toggle sidebar">
          {isHidden ? '›' : '‹'}
        </button>
        <span className="titlebar-logo">&gt;_ lounge</span>
      </div>

      <div className="main">
        {/* Left session tab sidebar */}
        <div className={`tab-sidebar tab-sidebar--${tabState}`}>
          <div className="tab-sidebar-sessions">
            {sessions.length === 0 && isExpanded && (
              <p className="tab-sidebar-empty">No open sessions</p>
            )}
            {sessions.map(s => (
              <div
                key={s.id}
                className={`tab-item ${s.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(s.id)}
                title={s.label}
              >
                <span className={`tab-dot ${s.connected ? 'connected' : ''}`} />
                {!isIcons && (
                  <>
                    <span className="tab-item-label">{s.label}</span>
                    <span
                      className="tab-item-close"
                      onClick={e => { e.stopPropagation(); removeSession(s.id) }}
                    >×</span>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="tab-sidebar-footer">
            <button
              className={`btn-new-session ${panelOpen ? 'active' : ''}`}
              onClick={() => setPanelOpen(v => !v)}
              title="New Session"
            >
              <span className="btn-new-session-icon">{panelOpen ? '−' : '+'}</span>
              {!isIcons && <span>New Session</span>}
            </button>
          </div>
        </div>

        {/* Connection panel */}
        {panelOpen && (
          <SessionSidebar
            profiles={profiles}
            onConnect={(session) => { addSession(session); setPanelOpen(false) }}
            onClose={() => setPanelOpen(false)}
            onRefresh={refreshProfiles}
          />
        )}

        {/* Terminal area */}
        <div className="terminal-area">
          {sessions.length === 0 ? (
            <div className="splash">
              <div className="splash-logo">&gt;_</div>
              <p>Open a session to get started</p>
              <div className="splash-actions">
                <button className="btn-primary" onClick={() => setPanelOpen(true)}>New Session</button>
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
