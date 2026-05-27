import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import TerminalView from './components/TerminalView'
import SessionSidebar from './components/SessionSidebar'
import FontSettingsPanel from './components/FontSettingsPanel'
import LogSearchPanel from './components/LogSearchPanel'

const SIDEBAR_STATES = ['expanded', 'icons', 'hidden']
const HANDLE_PX = 4

// ── Tree utilities ────────────────────────────────────────────────────────────
// Leaf:  { type: 'leaf', sessionId }
// Split: { type: 'split', dir: 'h'|'v', ratio: 0..1, first: Node, second: Node }

function genId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// 재시작해도 일관성 있는 로그 검색 키
// 프로필 기반 → profile:<id>, 임시 SSH → ssh:host:port:user, 임시 로컬 → local:cwd
function getStableLogId(session) {
  if (session.profileId) return `profile:${session.profileId}`
  if (session.type === 'ssh') return `ssh:${session.host}:${session.port || 22}:${session.username}`
  return `local:${session.cwd || 'home'}`
}

function getFirstLeafId(node) {
  if (!node) return null
  if (node.type === 'leaf') return node.sessionId
  return getFirstLeafId(node.first)
}

function getAllLeafIds(node) {
  if (!node) return []
  if (node.type === 'leaf') return [node.sessionId]
  return [...getAllLeafIds(node.first), ...getAllLeafIds(node.second)]
}

function splitLeafInTree(node, sessionId, dir, newId) {
  const newSplit = {
    type: 'split', dir, ratio: 0.5,
    first:  { type: 'leaf', sessionId },
    second: { type: 'leaf', sessionId: newId },
  }
  if (!node) return newSplit
  if (node.type === 'leaf') return node.sessionId === sessionId ? newSplit : node
  return { ...node, first: splitLeafInTree(node.first, sessionId, dir, newId),
                    second: splitLeafInTree(node.second, sessionId, dir, newId) }
}

// Returns { newTree, siblingId, found }
function removeLeafFromTree(node, sessionId) {
  if (!node) return { newTree: null, siblingId: null, found: false }
  if (node.type === 'leaf') {
    if (node.sessionId === sessionId) return { newTree: null, siblingId: null, found: true }
    return { newTree: node, siblingId: null, found: false }
  }
  const { first, second } = node
  if (first.type  === 'leaf' && first.sessionId  === sessionId)
    return { newTree: second, siblingId: getFirstLeafId(second), found: true }
  if (second.type === 'leaf' && second.sessionId === sessionId)
    return { newTree: first,  siblingId: getFirstLeafId(first),  found: true }

  const r1 = removeLeafFromTree(first, sessionId)
  if (r1.found) {
    if (!r1.newTree) return { newTree: second, siblingId: getFirstLeafId(second), found: true }
    return { newTree: { ...node, first: r1.newTree }, siblingId: r1.siblingId, found: true }
  }
  const r2 = removeLeafFromTree(second, sessionId)
  if (r2.found) {
    if (!r2.newTree) return { newTree: first, siblingId: getFirstLeafId(first), found: true }
    return { newTree: { ...node, second: r2.newTree }, siblingId: r2.siblingId, found: true }
  }
  return { newTree: node, siblingId: null, found: false }
}

function updateRatioAtPath(node, path, ratio) {
  if (!node) return node
  if (path.length === 0) return { ...node, ratio }
  const [head, ...rest] = path
  return { ...node, [head]: updateRatioAtPath(node[head], rest, ratio) }
}

// ── Layout computation ────────────────────────────────────────────────────────
function computeLeafRects(node, bounds = { x: 0, y: 0, w: 100, h: 100 }) {
  if (!node) return []
  if (node.type === 'leaf') {
    return [{ sessionId: node.sessionId, style: {
      position: 'absolute',
      left: `${bounds.x}%`, top:    `${bounds.y}%`,
      width:`${bounds.w}%`, height: `${bounds.h}%`,
      overflow: 'hidden',
    }}]
  }
  const { dir, ratio, first, second } = node
  if (dir === 'h') {
    const sw = bounds.w * ratio
    return [
      ...computeLeafRects(first,  { x: bounds.x,      y: bounds.y, w: sw,            h: bounds.h }),
      ...computeLeafRects(second, { x: bounds.x + sw, y: bounds.y, w: bounds.w - sw, h: bounds.h }),
    ]
  }
  const sh = bounds.h * ratio
  return [
    ...computeLeafRects(first,  { x: bounds.x, y: bounds.y,      w: bounds.w, h: sh            }),
    ...computeLeafRects(second, { x: bounds.x, y: bounds.y + sh, w: bounds.w, h: bounds.h - sh }),
  ]
}

function computeHandles(node, bounds = { x: 0, y: 0, w: 100, h: 100 }, path = []) {
  if (!node || node.type === 'leaf') return []
  const { dir, ratio, first, second } = node
  const H = HANDLE_PX / 2
  const handles = []
  if (dir === 'h') {
    const sw = bounds.w * ratio
    handles.push({ dir: 'h', path, bounds, style: {
      position: 'absolute', cursor: 'col-resize', zIndex: 10,
      left: `calc(${bounds.x + sw}% - ${H}px)`, top: `${bounds.y}%`,
      height: `${bounds.h}%`, width: `${HANDLE_PX}px`,
    }})
    handles.push(...computeHandles(first,  { x: bounds.x,      y: bounds.y, w: sw,            h: bounds.h }, [...path, 'first']))
    handles.push(...computeHandles(second, { x: bounds.x + sw, y: bounds.y, w: bounds.w - sw, h: bounds.h }, [...path, 'second']))
  } else {
    const sh = bounds.h * ratio
    handles.push({ dir: 'v', path, bounds, style: {
      position: 'absolute', cursor: 'row-resize', zIndex: 10,
      top: `calc(${bounds.y + sh}% - ${H}px)`, left: `${bounds.x}%`,
      width: `${bounds.w}%`, height: `${HANDLE_PX}px`,
    }})
    handles.push(...computeHandles(first,  { x: bounds.x, y: bounds.y,      w: bounds.w, h: sh            }, [...path, 'first']))
    handles.push(...computeHandles(second, { x: bounds.x, y: bounds.y + sh, w: bounds.w, h: bounds.h - sh }, [...path, 'second']))
  }
  return handles
}

// ── SplitHandle ───────────────────────────────────────────────────────────────
function SplitHandle({ handle, onDragHandle }) {
  const { dir, style, path, bounds } = handle
  const isH = dir === 'h'

  const onMouseDown = useCallback((e) => {
    e.preventDefault()
    const area = e.currentTarget.closest('.terminal-area')
    area?.classList.add('is-dragging')
    const onMove = (mv) => {
      const rect = area.getBoundingClientRect()
      let r
      if (isH) {
        r = (mv.clientX - rect.left - rect.width  * (bounds.x / 100)) / (rect.width  * (bounds.w / 100))
      } else {
        r = (mv.clientY - rect.top  - rect.height * (bounds.y / 100)) / (rect.height * (bounds.h / 100))
      }
      onDragHandle(path, Math.max(0.1, Math.min(0.9, r)))
    }
    const onUp = () => {
      area?.classList.remove('is-dragging')
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [isH, bounds, path, onDragHandle])

  return <div className={`split-handle split-handle--${dir}`} style={style} onMouseDown={onMouseDown} />
}

// ─────────────────────────────────────────────────────────────────────────────

function App() {
  // allSessions: primary sessions (primaryTabId=null, shown in sidebar)
  //            + sub-pane sessions (primaryTabId=owning tab id, hidden from sidebar)
  const [allSessions,       setAllSessions]       = useState([])
  const [activeTabId,       setActiveTabId]       = useState(null)
  // Per-tab split layout: { [primaryTabId]: SplitNode | null }
  const [tabSplitTrees,     setTabSplitTrees]     = useState({})
  // Per-tab focused pane: { [primaryTabId]: sessionId }  (defaults to primary tab's own id)
  const [tabActivePaneId,   setTabActivePaneId]   = useState({})

  const [panelOpen,       setPanelOpen]       = useState(false)
  const [profiles,        setProfiles]        = useState([])
  const [tabState,        setTabState]        = useState('expanded')
  const [fontFamily,      setFontFamily]      = useState('JetBrains Mono')
  const [fontSize,        setFontSize]        = useState(14)
  const [fontPanelOpen,   setFontPanelOpen]   = useState(false)
  // 로그 캡처: 세션별 on/off { [sessionId]: boolean }
  const [sessionLogging,  setSessionLogging]  = useState({})
  const [logSearchOpen,   setLogSearchOpen]   = useState(false)
  // 체크인: SSH 접속 시 자동 스캔 결과 { [sessionId]: { os, arch, cpu, mem, disk, tools, services } }
  const [checkinData,     setCheckinData]     = useState({})

  // Refs (stale-closure prevention)
  const activeTabIdRef     = useRef(activeTabId)
  const tabActivePaneIdRef = useRef(tabActivePaneId)
  const allSessionsRef     = useRef(allSessions)
  const tabSplitTreesRef   = useRef(tabSplitTrees)
  activeTabIdRef.current     = activeTabId
  tabActivePaneIdRef.current = tabActivePaneId
  allSessionsRef.current     = allSessions
  tabSplitTreesRef.current   = tabSplitTrees

  const cycleTabSidebar = () =>
    setTabState(s => SIDEBAR_STATES[(SIDEBAR_STATES.indexOf(s) + 1) % SIDEBAR_STATES.length])

  // ── Session lifecycle ──────────────────────────────────────────────────────

  // addSession: creates a new PRIMARY session (= new sidebar tab)
  const addSession = useCallback((session) => {
    const id    = genId()
    const logId = getStableLogId(session)  // 재시작 후에도 동일한 stable key
    setAllSessions(prev => [...prev, { ...session, id, logId, primaryTabId: null, connected: false }])
    setActiveTabId(id)
    // tabSplitTrees[id] is implicitly null (no split)
    // tabActivePaneId[id] is implicitly id (primary pane is focused)
  }, [])

  const refreshProfiles = useCallback(() => {
    window.electronAPI?.getProfiles().then(setProfiles)
  }, [])

  useEffect(() => {
    window.electronAPI?.getSettings().then(s => {
      if (s.fontFamily) setFontFamily(s.fontFamily)
      if (s.fontSize)   setFontSize(s.fontSize)
    })
  }, [])

  function handleFontChange({ fontFamily: f, fontSize: s }) {
    setFontFamily(f); setFontSize(s)
    window.electronAPI?.saveSettings({ fontFamily: f, fontSize: s })
  }

  useEffect(() => {
    if (!window.electronAPI) return
    let cancelled = false
    window.electronAPI.getProfiles().then(list => {
      if (cancelled) return
      setProfiles(list)
      list.filter(p => p.autoConnect).forEach((p, i) => {
        setTimeout(() => {
          if (!cancelled) addSession({
            type: p.type, label: p.name, host: p.host, port: p.port,
            username: p.username, password: p.password, privateKey: p.privateKey, cwd: p.cwd,
            profileId: p.id,
          })
        }, i * 100)
      })
    })
    return () => { cancelled = true }
  }, [addSession])

  // ── Split (within the active tab) ─────────────────────────────────────────
  const splitActive = useCallback((dir) => {
    const curTabId  = activeTabIdRef.current
    if (!curTabId) return

    const curPaneId     = tabActivePaneIdRef.current[curTabId] ?? curTabId
    const curPaneSession = allSessionsRef.current.find(s => s.id === curPaneId)
    if (!curPaneSession) return

    const newId = genId()

    // Sub-pane: clone of the focused pane, owned by this tab (NOT in sidebar)
    // logId는 원본 패인과 동일하게 상속 (같은 서버에 대한 분리 뷰이므로)
    setAllSessions(prev => [...prev, { ...curPaneSession, id: newId, primaryTabId: curTabId, connected: false }])

    // Update this tab's split tree
    setTabSplitTrees(prev => ({
      ...prev,
      [curTabId]: splitLeafInTree(prev[curTabId] ?? null, curPaneId, dir, newId),
    }))

    // Focus the new pane
    setTabActivePaneId(prev => ({ ...prev, [curTabId]: newId }))
  }, [])

  // ── Remove session or pane ─────────────────────────────────────────────────
  const removeSession = useCallback((id) => {
    if (!id) return
    const sessions = allSessionsRef.current
    const target   = sessions.find(s => s.id === id)
    if (!target) return

    if (target.primaryTabId === null) {
      // ── Removing a PRIMARY tab → remove it + all its sub-panes ──
      setAllSessions(prev => prev.filter(s => s.id !== id && s.primaryTabId !== id))
      setTabSplitTrees(prev => { const n = { ...prev }; delete n[id]; return n })
      setTabActivePaneId(prev => { const n = { ...prev }; delete n[id]; return n })
      setCheckinData(prev => { const n = { ...prev }; delete n[id]; return n })

      if (activeTabIdRef.current === id) {
        const remaining = sessions.filter(s => s.primaryTabId === null && s.id !== id)
        setActiveTabId(remaining.at(-1)?.id ?? null)
      }
    } else {
      // ── Removing a SUB-PANE → update owning tab's split tree ──
      const parentTabId = target.primaryTabId
      const curTree     = tabSplitTreesRef.current[parentTabId]

      setAllSessions(prev => prev.filter(s => s.id !== id))

      if (curTree) {
        const { newTree, siblingId } = removeLeafFromTree(curTree, id)
        if (!newTree || newTree.type === 'leaf') {
          // Split fully collapsed
          setTabSplitTrees(prev => { const n = { ...prev }; delete n[parentTabId]; return n })
          setTabActivePaneId(prev => ({
            ...prev, [parentTabId]: newTree?.sessionId ?? parentTabId,
          }))
        } else {
          setTabSplitTrees(prev => ({ ...prev, [parentTabId]: newTree }))
          if ((tabActivePaneIdRef.current[parentTabId] ?? parentTabId) === id) {
            setTabActivePaneId(prev => ({ ...prev, [parentTabId]: siblingId }))
          }
        }
      }
    }
  }, [])

  // 현재 포커스 페인의 로그 캡처 토글 (ref 사용 — 파생 상태보다 앞에 위치)
  const toggleLogging = useCallback(() => {
    const curTabId = activeTabIdRef.current
    if (!curTabId) return
    const paneId = tabActivePaneIdRef.current[curTabId] ?? curTabId
    setSessionLogging(prev => ({ ...prev, [paneId]: !(prev[paneId] ?? false) }))
  }, [])

  const onDragHandle = useCallback((path, ratio) => {
    const curTabId = activeTabIdRef.current
    setTabSplitTrees(prev => ({
      ...prev,
      [curTabId]: prev[curTabId] ? updateRatioAtPath(prev[curTabId], path, ratio) : prev[curTabId],
    }))
  }, [])

  // Ctrl+Shift+H/V = split; Ctrl+Shift+W = close pane; Ctrl+Shift+F = log search
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey) return
      if (e.code === 'KeyH') { e.preventDefault(); splitActive('h') }
      if (e.code === 'KeyV') { e.preventDefault(); splitActive('v') }
      if (e.code === 'KeyF') { e.preventDefault(); setLogSearchOpen(v => !v) }
      if (e.code === 'KeyW') {
        e.preventDefault()
        const curTabId = activeTabIdRef.current
        if (tabSplitTreesRef.current[curTabId]) {
          removeSession(tabActivePaneIdRef.current[curTabId] ?? curTabId)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [splitActive, removeSession])

  // ── Derived layout for the active tab ─────────────────────────────────────
  const isIcons    = tabState === 'icons'
  const isHidden   = tabState === 'hidden'
  const isExpanded = tabState === 'expanded'

  const primarySessions    = allSessions.filter(s => s.primaryTabId === null)
  const currentTree        = activeTabId ? (tabSplitTrees[activeTabId] ?? null) : null
  const currentActivePaneId = activeTabId ? (tabActivePaneId[activeTabId] ?? activeTabId) : null

  // Leaf rects: if no split → primary tab fills the whole area
  const leafRects   = currentTree
    ? computeLeafRects(currentTree)
    : activeTabId
      ? [{ sessionId: activeTabId, style: { position: 'absolute', inset: 0 } }]
      : []
  const leafRectMap = Object.fromEntries(leafRects.map(r => [r.sessionId, r.style]))
  const handles     = currentTree ? computeHandles(currentTree) : []
  const leafIds     = currentTree ? getAllLeafIds(currentTree) : (activeTabId ? [activeTabId] : [])

  return (
    <div className="app">
      {/* ── Titlebar ─────────────────────────────────────────────────────── */}
      <div className="titlebar">
        <button className="btn-sidebar-toggle" onClick={cycleTabSidebar} title="Toggle sidebar">
          {isHidden ? '›' : '‹'}
        </button>
        <span className="titlebar-logo">&gt;_ lounge</span>
        <div className="titlebar-spacer" />
        <div className="titlebar-actions">
          <button
            className="btn-sidebar-toggle"
            onClick={() => splitActive('h')}
            title="Split Right (Ctrl+Shift+H)"
            disabled={!activeTabId}
          >▐</button>
          <button
            className="btn-sidebar-toggle"
            onClick={() => splitActive('v')}
            title="Split Down (Ctrl+Shift+V)"
            disabled={!activeTabId}
          >▄</button>
          {currentTree && (
            <button
              className="btn-sidebar-toggle"
              onClick={() => removeSession(currentActivePaneId)}
              title="Close Pane (Ctrl+Shift+W)"
            >⊠</button>
          )}
          <div className="titlebar-sep" />
          <button
            className={`btn-sidebar-toggle log-toggle ${currentActivePaneId && sessionLogging[currentActivePaneId] ? 'recording' : ''}`}
            onClick={toggleLogging}
            title={currentActivePaneId && sessionLogging[currentActivePaneId] ? 'Stop logging' : 'Start logging'}
            disabled={!currentActivePaneId}
          >●</button>
          <button
            className={`btn-sidebar-toggle ${logSearchOpen ? 'active' : ''}`}
            onClick={() => setLogSearchOpen(v => !v)}
            title="Search logs (Ctrl+Shift+F)"
            disabled={!currentActivePaneId}
          >⌕</button>
          <div className="titlebar-sep" />
          <button
            className={`btn-sidebar-toggle ${fontPanelOpen ? 'active' : ''}`}
            onClick={() => setFontPanelOpen(v => !v)}
            title="Font settings"
          >⚙</button>
        </div>
      </div>

      {fontPanelOpen && (
        <FontSettingsPanel
          fontFamily={fontFamily} fontSize={fontSize}
          onChange={handleFontChange} onClose={() => setFontPanelOpen(false)}
        />
      )}

      {logSearchOpen && (
        <LogSearchPanel
          logId={allSessions.find(s => s.id === currentActivePaneId)?.logId ?? currentActivePaneId}
          sessionLabel={allSessions.find(s => s.id === currentActivePaneId)?.label ?? ''}
          onClose={() => setLogSearchOpen(false)}
        />
      )}

      <div className="main">
        {/* ── Sidebar: primary sessions only ───────────────────────────── */}
        <div className={`tab-sidebar tab-sidebar--${tabState}`}>
          <div className="tab-sidebar-sessions">
            {primarySessions.length === 0 && isExpanded && (
              <p className="tab-sidebar-empty">No open sessions</p>
            )}
            {primarySessions.map(s => {
              const ci = checkinData[s.id]
              return (
                <div
                  key={s.id}
                  className={`tab-item ${s.id === activeTabId ? 'active' : ''}`}
                  onClick={() => setActiveTabId(s.id)}
                  title={s.label}
                >
                  <div className="tab-item-row">
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
                  {isExpanded && ci && (
                    <div className="tab-checkin">
                      <div className="tab-checkin-os">{ci.os}{ci.arch ? ` · ${ci.arch}` : ''}</div>
                      {(ci.tools.length > 0 || ci.services.length > 0) && (
                        <div className="tab-checkin-tags">
                          {ci.services.slice(0, 3).map(t => (
                            <span key={t} className="tab-checkin-tag tab-checkin-tag--svc">{t}</span>
                          ))}
                          {ci.tools.slice(0, 4).map(t => (
                            <span key={t} className="tab-checkin-tag">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
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

        {/* ── Connection panel ─────────────────────────────────────────── */}
        {panelOpen && (
          <SessionSidebar
            profiles={profiles}
            onConnect={(session) => { addSession(session); setPanelOpen(false) }}
            onClose={() => setPanelOpen(false)}
            onRefresh={refreshProfiles}
          />
        )}

        {/* ── Terminal area ─────────────────────────────────────────────── */}
        <div className="terminal-area">
          {primarySessions.length === 0 ? (
            <div className="splash">
              <div className="splash-logo">&gt;_</div>
              <p>Open a session to get started</p>
              <div className="splash-actions">
                <button className="btn-primary" onClick={() => setPanelOpen(true)}>New Session</button>
              </div>
            </div>
          ) : (
            <>
              {allSessions.map(s => {
                // Belongs to active tab = primary session itself OR its sub-panes
                const belongsToActive = s.id === activeTabId || s.primaryTabId === activeTabId
                const inLayout        = leafIds.includes(s.id)
                const isFocused       = belongsToActive && s.id === currentActivePaneId

                const paneStyle = !belongsToActive
                  ? { display: 'none' }
                  : inLayout
                    ? leafRectMap[s.id]
                    : { display: 'none' }

                return (
                  <div
                    key={s.id}
                    className={`pane-wrapper${currentTree && isFocused ? ' pane-wrapper--focused' : ''}`}
                    style={paneStyle}
                    onMouseDown={() => {
                      if (currentTree && belongsToActive)
                        setTabActivePaneId(prev => ({ ...prev, [activeTabId]: s.id }))
                    }}
                  >
                    <TerminalView
                      session={s}
                      logId={s.logId ?? s.id}
                      active={isFocused}
                      visible={belongsToActive ? inLayout : false}
                      fontFamily={fontFamily}
                      fontSize={fontSize}
                      logEnabled={sessionLogging[s.id] ?? false}
                      onConnected={() => {
                        setAllSessions(prev => prev.map(p => p.id === s.id ? { ...p, connected: true } : p))
                        if (s.type === 'ssh') {
                          window.electronAPI?.sshCheckin(s.id).then(data => {
                            if (data) setCheckinData(prev => ({ ...prev, [s.id]: data }))
                          }).catch(() => {})
                        }
                      }}
                    />
                  </div>
                )
              })}

              {handles.map(handle => (
                <SplitHandle
                  key={handle.path.join('-') || 'root'}
                  handle={handle}
                  onDragHandle={onDragHandle}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
